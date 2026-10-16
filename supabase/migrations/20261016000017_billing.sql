-- Penagihan: katalog harga, order, dan buku besar diskon "pertama per periode". Uang dihitung di database, bukan klien.

create table public.price_catalog (
  kind text not null check (kind in ('STANDARD_REVIEW', 'MEMBERSHIP_MONTHLY', 'MEMBERSHIP_ANNUAL', 'BUNDLE')),
  variant text not null,
  amount_idr integer not null check (amount_idr > 0),
  credits integer check (credits is null or credits > 0),
  credit_days integer check (credit_days is null or credit_days > 0),
  primary key (kind, variant)
);
alter table public.price_catalog enable row level security;
revoke all on public.price_catalog from anon, authenticated;
-- Nilai terkunci v8. Harga tahunan dan bundle sengaja tidak ada (UNKNOWN) sampai pemilik mengisi lewat set_price.
insert into public.price_catalog (kind, variant, amount_idr) values
  ('STANDARD_REVIEW', 'FREE', 50000), ('STANDARD_REVIEW', 'MEMBER_FIRST', 30000), ('STANDARD_REVIEW', 'MEMBER_LATER', 35000),
  ('MEMBERSHIP_MONTHLY', 'DEFAULT', 19000);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  kind text not null check (kind in ('MEMBERSHIP_MONTHLY', 'MEMBERSHIP_ANNUAL', 'BUNDLE', 'STANDARD_REVIEW')),
  ref_id uuid,
  status text not null check (status in ('PENDING_PAYMENT', 'PAID', 'EXPIRED', 'CANCELLED', 'RECONCILIATION_REQUIRED')),
  amount_idr integer not null check (amount_idr >= 0),
  price_snapshot jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  fulfilled_at timestamptz,
  unique (user_id, idempotency_key)
);
create index orders_user_idx on public.orders (user_id, created_at desc);
create index orders_pending_idx on public.orders (status, expires_at);
-- Satu order review aktif/selesai per versi: pagar keras di luar pemeriksaan fungsi.
create unique index orders_one_active_review on public.orders (ref_id)
  where kind = 'STANDARD_REVIEW' and status in ('PENDING_PAYMENT', 'PAID', 'RECONCILIATION_REQUIRED');
alter table public.orders enable row level security;
revoke all on public.orders from anon, authenticated;

create table public.review_discount_entitlements (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships(id),
  order_id uuid not null unique references public.orders(id),
  status text not null check (status in ('RESERVED', 'CONSUMED', 'RELEASED')),
  created_at timestamptz not null default now()
);
create unique index review_discount_one_per_period on public.review_discount_entitlements (membership_id)
  where status in ('RESERVED', 'CONSUMED');
alter table public.review_discount_entitlements enable row level security;
revoke all on public.review_discount_entitlements from anon, authenticated;

create table public.review_credits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  order_id uuid not null references public.orders(id),
  expires_at timestamptz not null,
  status text not null check (status in ('AVAILABLE', 'RESERVED', 'CONSUMED', 'EXPIRED')),
  reserved_by_order uuid references public.orders(id),
  created_at timestamptz not null default now()
);
create index review_credits_user_idx on public.review_credits (user_id, status, expires_at);
alter table public.review_credits enable row level security;
revoke all on public.review_credits from anon, authenticated;

-- Harga untuk pengguna pada waktu tertentu. Fungsi harga tunggal dipakai pratinjau dan pembuatan order.
create function public.quote_price(p_user uuid, p_kind text, p_now timestamptz)
returns table (amount_idr integer, variant text, membership_id uuid, credit_id uuid, credits integer, credit_days integer)
language plpgsql security definer set search_path = public as $$
declare v_m uuid; v_c uuid; v_variant text; v_row public.price_catalog%rowtype;
begin
  if p_kind = 'STANDARD_REVIEW' then
    select c.id into v_c from public.review_credits c
     where c.user_id = p_user and c.status = 'AVAILABLE' and c.expires_at > p_now order by c.expires_at limit 1;
    if v_c is not null then
      return query select 0, 'CREDIT'::text, null::uuid, v_c, null::integer, null::integer;
      return;
    end if;
    select m.id into v_m from public.memberships m
     where m.user_id = p_user and m.status = 'ACTIVE' and m.period_start <= p_now and p_now < m.period_end
     order by m.period_end desc limit 1;
    if v_m is null then
      v_variant := 'FREE';
    elsif exists (select 1 from public.review_discount_entitlements e where e.membership_id = v_m and e.status in ('RESERVED', 'CONSUMED')) then
      v_variant := 'MEMBER_LATER';
    else
      v_variant := 'MEMBER_FIRST';
    end if;
  elsif p_kind in ('MEMBERSHIP_MONTHLY', 'MEMBERSHIP_ANNUAL', 'BUNDLE') then
    v_variant := 'DEFAULT';
  else
    raise exception 'INVALID_KIND';
  end if;
  select pc.* into v_row from public.price_catalog pc where pc.kind = p_kind and pc.variant = v_variant;
  if not found then
    raise exception 'PRODUCT_UNAVAILABLE';
  end if;
  return query select v_row.amount_idr, v_variant, v_m, null::uuid, v_row.credits, v_row.credit_days;
end;
$$;

create function public.preview_price(p_user uuid, p_kind text, p_ref uuid, p_now timestamptz)
returns table (amount_idr integer, variant text, uses_credit boolean)
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  if p_kind = 'STANDARD_REVIEW' then
    perform 1 from public.document_versions v join public.documents d on d.id = v.document_id
     where v.id = p_ref and d.owner_id = p_user;
    if not found then
      raise exception 'NOT_FOUND';
    end if;
  end if;
  select * into q from public.quote_price(p_user, p_kind, p_now);
  return query select q.amount_idr, q.variant, q.credit_id is not null;
end;
$$;

-- Kedaluwarsa order PENDING_PAYMENT: lepas entitlement RESERVED dan tandai pembayaran PENDING kedaluwarsa.
create function public.expire_orders_scoped(p_user uuid, p_now timestamptz) returns integer
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[];
begin
  select coalesce(array_agg(o.id), '{}') into v_ids from public.orders o
   where o.status = 'PENDING_PAYMENT' and o.expires_at <= p_now and (p_user is null or o.user_id = p_user);
  if cardinality(v_ids) = 0 then
    return 0;
  end if;
  update public.orders o set status = 'EXPIRED' where o.id = any (v_ids);
  update public.review_discount_entitlements e set status = 'RELEASED' where e.order_id = any (v_ids) and e.status = 'RESERVED';
  update public.payments p set status = 'EXPIRED' where p.order_id = any (v_ids) and p.status = 'PENDING';
  return cardinality(v_ids);
end;
$$;

create function public.expire_orders(p_now timestamptz) returns integer
language sql security definer set search_path = public as $$
  select public.expire_orders_scoped(null, p_now);
$$;

create function public.create_order(p_user uuid, p_kind text, p_ref uuid, p_key text, p_now timestamptz)
returns table (order_id uuid, status text, amount_idr integer, duplicate boolean)
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; q record; v_id uuid; v_status text;
begin
  perform pg_advisory_xact_lock(hashtextextended('order:' || p_user::text, 0));
  select o.* into v_o from public.orders o where o.user_id = p_user and o.idempotency_key = p_key;
  if found then
    return query select v_o.id, v_o.status, v_o.amount_idr, true;
    return;
  end if;
  perform public.expire_orders_scoped(p_user, p_now);

  if p_kind = 'STANDARD_REVIEW' then
    perform 1 from public.document_versions v join public.documents d on d.id = v.document_id
     where v.id = p_ref and d.owner_id = p_user;
    if not found then
      raise exception 'NOT_FOUND';
    end if;
    if exists (select 1 from public.orders o where o.ref_id = p_ref and o.kind = 'STANDARD_REVIEW'
                and o.status in ('PENDING_PAYMENT', 'PAID', 'RECONCILIATION_REQUIRED')) then
      raise exception 'ALREADY_REVIEWED';
    end if;
  else
    p_ref := null;
  end if;

  select * into q from public.quote_price(p_user, p_kind, p_now);
  v_status := case when q.amount_idr = 0 then 'PAID' else 'PENDING_PAYMENT' end;
  insert into public.orders (user_id, kind, ref_id, status, amount_idr, price_snapshot, idempotency_key, expires_at, paid_at)
  values (p_user, p_kind, p_ref, v_status, q.amount_idr,
          jsonb_build_object('variant', q.variant, 'amount_idr', q.amount_idr, 'credits', q.credits, 'credit_days', q.credit_days),
          p_key, p_now + interval '24 hours', case when q.amount_idr = 0 then p_now end)
  returning id into v_id;

  if q.variant = 'MEMBER_FIRST' then
    insert into public.review_discount_entitlements (membership_id, order_id, status) values (q.membership_id, v_id, 'RESERVED');
  end if;
  if q.credit_id is not null then
    update public.review_credits c set status = 'CONSUMED', reserved_by_order = v_id where c.id = q.credit_id and c.status = 'AVAILABLE';
    perform public.fulfill_order(v_id, p_now);
  end if;
  return query select v_id, v_status, q.amount_idr, false;
end;
$$;

-- Hanya harga yang masih UNKNOWN (tahunan dan bundle) yang dapat diisi; harga review dan bulanan terkunci v8.
create function public.set_price(p_admin uuid, p_kind text, p_variant text, p_amount integer, p_credits integer, p_credit_days integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.user_roles r where r.user_id = p_admin and r.role = 'platform_admin') then
    raise exception 'FORBIDDEN';
  end if;
  if p_kind not in ('MEMBERSHIP_ANNUAL', 'BUNDLE') or p_variant <> 'DEFAULT' then
    raise exception 'PRICE_LOCKED';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_PRICE';
  end if;
  if p_kind = 'BUNDLE' and (p_credits is null or p_credit_days is null) then
    raise exception 'INVALID_BUNDLE';
  end if;
  insert into public.price_catalog (kind, variant, amount_idr, credits, credit_days)
  values (p_kind, p_variant, p_amount, case when p_kind = 'BUNDLE' then p_credits end, case when p_kind = 'BUNDLE' then p_credit_days end)
  on conflict (kind, variant) do update set amount_idr = excluded.amount_idr, credits = excluded.credits, credit_days = excluded.credit_days;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_admin, 'price_set', 'price_catalog', p_kind || ':' || p_variant, jsonb_build_object('amount_idr', p_amount));
end;
$$;

revoke execute on function
  public.quote_price(uuid, text, timestamptz), public.preview_price(uuid, text, uuid, timestamptz),
  public.expire_orders_scoped(uuid, timestamptz), public.expire_orders(timestamptz),
  public.create_order(uuid, text, uuid, text, timestamptz), public.set_price(uuid, text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function
  public.quote_price(uuid, text, timestamptz), public.preview_price(uuid, text, uuid, timestamptz),
  public.expire_orders_scoped(uuid, timestamptz), public.expire_orders(timestamptz),
  public.create_order(uuid, text, uuid, text, timestamptz), public.set_price(uuid, text, text, integer, integer, integer)
  to service_role;
