-- Deep Review: harga tambahan, kelayakan, order, permintaan, penugasan, dan ketergantungan pada verifikasi induk.

alter table public.price_catalog drop constraint price_catalog_kind_check;
alter table public.price_catalog add constraint price_catalog_kind_check
  check (kind in ('STANDARD_REVIEW', 'MEMBERSHIP_MONTHLY', 'MEMBERSHIP_ANNUAL', 'BUNDLE', 'DEEP_REVIEW'));
alter table public.orders drop constraint orders_kind_check;
alter table public.orders add constraint orders_kind_check
  check (kind in ('MEMBERSHIP_MONTHLY', 'MEMBERSHIP_ANNUAL', 'BUNDLE', 'STANDARD_REVIEW', 'DEEP_REVIEW'));
insert into public.price_catalog (kind, variant, amount_idr) values ('DEEP_REVIEW', 'FREE', 200000), ('DEEP_REVIEW', 'MEMBER', 150000);
create unique index orders_one_active_deep on public.orders (ref_id) where kind = 'DEEP_REVIEW' and status in ('PENDING_PAYMENT', 'PAID');

create table public.deep_requests (
  id uuid primary key default gen_random_uuid(),
  parent_request_id uuid not null references public.review_requests(id),
  order_id uuid not null unique references public.orders(id),
  owner_id uuid not null references auth.users(id),
  version_id uuid not null references public.document_versions(id),
  version_sha256 text not null check (version_sha256 ~ '^[0-9a-f]{64}$'),
  firm_id uuid references public.firms(id),
  status text not null default 'QUEUED' check (status in ('QUEUED', 'IN_REVIEW', 'READY_FOR_DECISION', 'COMPLETED', 'CANCELLED', 'ON_HOLD')),
  outcome text check (outcome in ('ENHANCED_APPROVED', 'COMPLETED_WITH_NOTES', 'INCONCLUSIVE', 'REFERRED_SPECIAL_CASE')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index deep_requests_one_live on public.deep_requests (parent_request_id)
  where status in ('QUEUED', 'IN_REVIEW', 'READY_FOR_DECISION', 'COMPLETED', 'ON_HOLD');
create table public.deep_assignments (
  id uuid primary key default gen_random_uuid(),
  deep_id uuid not null references public.deep_requests(id),
  reviewer_id uuid not null references auth.users(id),
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null,
  ended_at timestamptz,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ENDED'))
);
create unique index deep_assignments_one_active on public.deep_assignments (deep_id) where status = 'ACTIVE';
create index deep_assignments_reviewer_idx on public.deep_assignments (reviewer_id, status);
alter table public.deep_requests enable row level security;
alter table public.deep_assignments enable row level security;
revoke all on public.deep_requests, public.deep_assignments from anon, authenticated;

-- Kelayakan. p_exclude_order: abaikan order ini sendiri saat memeriksa duplikat (untuk penyelesaian pembayaran yang sah).
create function public.deep_eligibility(p_user uuid, p_parent uuid, p_now timestamptz, p_exclude_order uuid default null)
returns table (eligible boolean, reason text)
language plpgsql security definer set search_path = public as $$
declare v_r public.review_requests%rowtype;
begin
  select r.* into v_r from public.review_requests r where r.id = p_parent and r.owner_id = p_user;
  if not found then
    return query select false, 'NOT_FOUND'::text;
    return;
  end if;
  if v_r.status <> 'COMPLETED' or v_r.outcome is distinct from 'WITH_NOTES' then
    return query select false, 'PARENT_NOT_COMPLETED'::text;
    return;
  end if;
  if not exists (select 1 from public.document_verifications dv where dv.request_id = p_parent and dv.kind = 'LEGAL' and dv.status = 'ACTIVE') then
    return query select false, 'PARENT_NOT_ACTIVE'::text;
    return;
  end if;
  if not exists (select 1 from public.legal_notes n join public.review_reports rp on rp.id = n.report_id
                  where rp.request_id = p_parent and rp.status = 'FINAL' and n.status = 'PUBLISHED' and n.actionable and n.severity <> 'INFO') then
    return query select false, 'NO_ACTIONABLE_NOTES'::text;
    return;
  end if;
  if not exists (select 1 from public.document_versions v where v.id = v_r.version_id
                  and encode(sha256(convert_to(v.canonical_text, 'UTF8')), 'hex') = v_r.version_sha256) then
    return query select false, 'VERSION_MISMATCH'::text;
    return;
  end if;
  if exists (select 1 from public.deep_requests d where d.parent_request_id = p_parent and d.status in ('QUEUED', 'IN_REVIEW', 'READY_FOR_DECISION', 'COMPLETED', 'ON_HOLD'))
     or exists (select 1 from public.orders o where o.kind = 'DEEP_REVIEW' and o.ref_id = p_parent and o.status in ('PENDING_PAYMENT', 'PAID')
                 and (p_exclude_order is null or o.id <> p_exclude_order)) then
    return query select false, 'DEEP_EXISTS'::text;
    return;
  end if;
  return query select true, 'OK'::text;
end;
$$;

create or replace function public.quote_price(p_user uuid, p_kind text, p_now timestamptz)
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
  elsif p_kind = 'DEEP_REVIEW' then
    -- Tambahan tanpa diskon pertama: Member aktif Rp150.000, selain itu Rp200.000.
    v_variant := case when exists (select 1 from public.memberships m where m.user_id = p_user and m.status = 'ACTIVE'
                                    and m.period_start <= p_now and p_now < m.period_end) then 'MEMBER' else 'FREE' end;
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

create or replace function public.create_order(p_user uuid, p_kind text, p_ref uuid, p_key text, p_now timestamptz)
returns table (order_id uuid, status text, amount_idr integer, duplicate boolean)
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; q record; v_id uuid; v_status text; v_elig record;
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
                and o.status in ('PENDING_PAYMENT', 'PAID')) then
      raise exception 'ALREADY_REVIEWED';
    end if;
  elsif p_kind = 'DEEP_REVIEW' then
    select e.eligible, e.reason into v_elig from public.deep_eligibility(p_user, p_ref, p_now) e;
    if v_elig.reason = 'NOT_FOUND' then
      raise exception 'NOT_FOUND';
    end if;
    if not v_elig.eligible then
      raise exception 'NOT_ELIGIBLE: %', v_elig.reason;
    end if;
  else
    p_ref := null;
  end if;

  select * into q from public.quote_price(p_user, p_kind, p_now);
  v_status := case when q.amount_idr = 0 then 'PAID' else 'PENDING_PAYMENT' end;
  insert into public.orders (user_id, kind, ref_id, status, amount_idr, price_snapshot, idempotency_key, expires_at, paid_at)
  values (p_user, p_kind, p_ref, v_status, q.amount_idr,
          jsonb_build_object('variant', q.variant, 'amount_idr', q.amount_idr, 'credits', q.credits, 'credit_days', q.credit_days,
                             'parent_request_id', case when p_kind = 'DEEP_REVIEW' then p_ref end),
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

create or replace function public.fulfill_order(p_order uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_first timestamptz; v_i integer; v_n integer; v_days integer;
begin
  select o.* into v_o from public.orders o where o.id = p_order for update;
  if not found or v_o.status <> 'PAID' then
    raise exception 'ORDER_NOT_PAID';
  end if;
  if v_o.fulfilled_at is not null then
    return;
  end if;
  if v_o.kind in ('MEMBERSHIP_MONTHLY', 'MEMBERSHIP_ANNUAL') then
    select greatest(p_now, coalesce(max(m.period_end), p_now)) into v_first from public.memberships m
     where m.user_id = v_o.user_id and m.status = 'ACTIVE' and m.period_end > p_now;
    v_n := case when v_o.kind = 'MEMBERSHIP_ANNUAL' then 12 else 1 end;
    for v_i in 1..v_n loop
      insert into public.memberships (user_id, status, period_start, period_end)
      values (v_o.user_id, 'ACTIVE', v_first + make_interval(months => v_i - 1), v_first + make_interval(months => v_i));
    end loop;
  elsif v_o.kind = 'BUNDLE' then
    v_n := (v_o.price_snapshot ->> 'credits')::integer;
    v_days := (v_o.price_snapshot ->> 'credit_days')::integer;
    for v_i in 1..v_n loop
      insert into public.review_credits (user_id, order_id, expires_at, status)
      values (v_o.user_id, v_o.id, p_now + make_interval(days => v_days), 'AVAILABLE');
    end loop;
  elsif v_o.kind = 'STANDARD_REVIEW' then
    perform public.create_review_request(v_o.id, p_now);
    update public.review_discount_entitlements e set status = 'CONSUMED' where e.order_id = v_o.id and e.status = 'RESERVED';
  elsif v_o.kind = 'DEEP_REVIEW' then
    perform public.create_deep_request(v_o.id, p_now);
  end if;
  update public.orders o set fulfilled_at = p_now where o.id = v_o.id;
end;
$$;

create or replace function public.settle_payment(p_provider text, p_provider_ref text, p_event_id text, p_amount integer, p_fee integer, p_now timestamptz, p_received timestamptz default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_p public.payments%rowtype; v_o public.orders%rowtype; v_rows integer; v_at timestamptz := coalesce(p_received, p_now); v_ok boolean;
begin
  select p.* into v_p from public.payments p where p.provider = p_provider and p.provider_ref = p_provider_ref for update;
  if not found then
    return 'NOT_FOUND';
  end if;
  insert into public.payment_events (provider, event_id, received_at) values (p_provider, p_event_id, p_now) on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 or v_p.status = 'VERIFIED' then
    return 'DUPLICATE';
  end if;
  if v_p.status not in ('PENDING', 'EXPIRED') then
    return 'RECONCILIATION_REQUIRED';
  end if;
  update public.payments p set received_amount_idr = p_amount where p.id = v_p.id;
  select o.* into v_o from public.orders o where o.id = v_p.order_id for update;

  if v_o.status = 'PENDING_PAYMENT' and v_o.expires_at <= v_at then
    perform public.expire_orders_scoped(v_o.user_id, v_at);
    select o.* into v_o from public.orders o where o.id = v_p.order_id;
  end if;
  if v_o.status = 'EXPIRED' and v_at <= v_o.expires_at and public.revive_expired_order(v_o.id) then
    select o.* into v_o from public.orders o where o.id = v_p.order_id;
  end if;
  if v_o.status <> 'PENDING_PAYMENT' then
    -- Terlambat atau order sudah dibayar lewat pembayaran lain: uang masuk tanpa aktivasi. Order tidak dikembalikan ke status
    -- yang dilindungi indeks keunikan sehingga pencatatan ini tidak dapat gagal.
    update public.payments p set status = 'DISPUTED', fee_idr = greatest(p_fee, 0) where p.id = v_p.id;
    if v_o.status in ('EXPIRED', 'CANCELLED') then
      update public.orders o set status = 'RECONCILIATION_REQUIRED' where o.id = v_o.id;
    end if;
    return 'RECONCILIATION_REQUIRED';
  end if;
  if p_amount <> v_o.amount_idr then
    update public.payments p set status = 'DISPUTED', fee_idr = greatest(p_fee, 0) where p.id = v_p.id;
    update public.orders o set status = 'RECONCILIATION_REQUIRED' where o.id = v_o.id;
    update public.review_discount_entitlements e set status = 'RELEASED' where e.order_id = v_o.id and e.status = 'RESERVED';
    return 'AMOUNT_MISMATCH';
  end if;
  if v_o.kind = 'DEEP_REVIEW' then
    -- Kelayakan dicek ulang (mengabaikan order ini sendiri). Induk dicabut/berubah: uang tercatat, tanpa pekerjaan.
    select e.eligible into v_ok from public.deep_eligibility(v_o.user_id, v_o.ref_id, p_now, v_o.id) e;
    if not coalesce(v_ok, false) then
      update public.payments p set status = 'DISPUTED', fee_idr = greatest(p_fee, 0) where p.id = v_p.id;
      update public.orders o set status = 'RECONCILIATION_REQUIRED' where o.id = v_o.id;
      return 'RECONCILIATION_REQUIRED';
    end if;
  end if;
  update public.payments p set status = 'VERIFIED', verified_at = p_now, fee_idr = greatest(p_fee, 0) where p.id = v_p.id;
  update public.orders o set status = 'PAID', paid_at = p_now where o.id = v_o.id;
  perform public.fulfill_order(v_o.id, p_now);
  return 'SETTLED';
end;
$$;

create or replace function public.admin_resolve_reconciliation(p_admin uuid, p_order uuid, p_action text, p_note text, p_now timestamptz) returns text
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_p public.payments%rowtype; v_ok boolean;
begin
  if not public.is_platform_admin(p_admin) then
    raise exception 'FORBIDDEN';
  end if;
  if p_note is null or length(trim(p_note)) < 5 then
    raise exception 'NOTE_REQUIRED';
  end if;
  if p_action not in ('ACTIVATE', 'REFUND_RECORDED', 'CLOSE') then
    raise exception 'INVALID_ACTION';
  end if;
  select o.* into v_o from public.orders o where o.id = p_order for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if v_o.status <> 'RECONCILIATION_REQUIRED' then
    raise exception 'NOT_RECONCILIATION';
  end if;
  select p.* into v_p from public.payments p where p.order_id = p_order and p.status = 'DISPUTED' order by p.created_at desc limit 1 for update;

  if p_action = 'ACTIVATE' then
    if not found or v_p.received_amount_idr is distinct from v_o.amount_idr then
      raise exception 'AMOUNT_MISMATCH';
    end if;
    if v_o.kind = 'STANDARD_REVIEW' and exists (select 1 from public.orders x where x.ref_id = v_o.ref_id and x.kind = v_o.kind
         and x.id <> v_o.id and x.status in ('PENDING_PAYMENT', 'PAID')) then
      raise exception 'CONFLICT';
    end if;
    if v_o.kind = 'DEEP_REVIEW' then
      select e.eligible into v_ok from public.deep_eligibility(v_o.user_id, v_o.ref_id, p_now, v_o.id) e;
      if not coalesce(v_ok, false) then
        raise exception 'NOT_ELIGIBLE';
      end if;
    end if;
    update public.payments p set status = 'VERIFIED', verified_at = p_now where p.id = v_p.id;
    update public.orders o set status = 'PAID', paid_at = p_now where o.id = p_order;
    perform public.fulfill_order(p_order, p_now);
  elsif p_action = 'REFUND_RECORDED' then
    if found then
      update public.payments p set status = 'REFUNDED' where p.id = v_p.id;
    end if;
    update public.orders o set status = 'CANCELLED' where o.id = p_order;
    update public.review_discount_entitlements e set status = 'RELEASED' where e.order_id = p_order and e.status = 'RESERVED';
  else
    update public.orders o set status = 'CANCELLED' where o.id = p_order;
    update public.review_discount_entitlements e set status = 'RELEASED' where e.order_id = p_order and e.status = 'RESERVED';
  end if;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_admin, 'reconciliation_resolved', 'order', p_order::text, jsonb_build_object('action', p_action, 'note', left(p_note, 300)));
  return case p_action when 'ACTIVATE' then 'ACTIVATED' else p_action end || case p_action when 'CLOSE' then 'D' else '' end;
end;
$$;

create or replace function public.assign_review_internal(p_actor uuid, p_request uuid, p_reviewer uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v_r public.review_requests%rowtype; v_firm uuid; v_active integer;
begin
  select r.* into v_r from public.review_requests r where r.id = p_request for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if not (public.is_platform_admin(p_actor)
          or (v_r.firm_id is not null and exists (select 1 from public.firm_members m
               where m.firm_id = v_r.firm_id and m.user_id = p_actor and m.role = 'coordinator'))) then
    raise exception 'FORBIDDEN';
  end if;
  if v_r.status not in ('QUEUED', 'ASSIGNED', 'IN_REVIEW') then
    raise exception 'NOT_ASSIGNABLE';
  end if;
  if p_reviewer = v_r.owner_id then
    raise exception 'REVIEWER_NOT_AUTHORIZED';
  end if;
  v_firm := v_r.firm_id;
  if v_firm is null then
    select m.firm_id into v_firm from public.firm_members m
     where m.user_id = p_reviewer and public.reviewer_has_authority(p_reviewer, m.firm_id, p_now) limit 1;
  end if;
  if v_firm is null or not public.reviewer_has_authority(p_reviewer, v_firm, p_now) then
    raise exception 'REVIEWER_NOT_AUTHORIZED';
  end if;
  select (select count(*) from public.review_assignments a where a.reviewer_id = p_reviewer and a.status = 'ACTIVE')
       + (select count(*) from public.deep_assignments a where a.reviewer_id = p_reviewer and a.status = 'ACTIVE') into v_active;
  if v_active >= 10 then
    raise exception 'REVIEWER_AT_CAPACITY';
  end if;
  update public.review_assignments a set status = 'ENDED', ended_at = p_now where a.request_id = p_request and a.status = 'ACTIVE';
  insert into public.review_assignments (request_id, reviewer_id, assigned_by, assigned_at) values (p_request, p_reviewer, p_actor, p_now);
  update public.review_requests r set status = 'ASSIGNED', firm_id = v_firm where r.id = p_request;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_actor, 'review_assigned', 'review_request', p_request::text, jsonb_build_object('reviewer_id', p_reviewer));
end;
$$;

create or replace function public.revoke_verification(p_actor uuid, p_id uuid, p_reason text, p_private text, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v public.document_verifications%rowtype; v_firm uuid; v_allowed boolean;
begin
  select dv.* into v from public.document_verifications dv where dv.id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  v_allowed := public.is_platform_admin(p_actor);
  if not v_allowed and v.request_id is not null and (v.issuer ->> 'reviewer_id') = p_actor::text then
    select r.firm_id into v_firm from public.review_requests r where r.id = v.request_id;
    v_allowed := v_firm is not null and public.reviewer_has_authority(p_actor, v_firm, p_now);
  end if;
  if not v_allowed then
    raise exception 'FORBIDDEN';
  end if;
  if p_reason not in ('ERROR', 'MISLEADING', 'AUTHORITY_REVOKED', 'OWNER_REQUEST', 'OTHER') then
    raise exception 'INVALID_REASON';
  end if;
  if v.status = 'REVOKED' then
    return;
  end if;
  insert into public.verification_revocations (verification_id, reason_code, private_reason, actor_id, created_at)
  values (p_id, p_reason, left(p_private, 2000), p_actor, p_now);
  update public.document_verifications dv set status = 'REVOKED' where dv.id = p_id;
  -- Ketergantungan induk: Enhanced turunan ditangguhkan dan deep yang belum selesai ditahan. Enhanced yang dicabut tidak mencabut induk.
  update public.document_verifications dv set status = 'SUSPENDED' where dv.parent_verification_id = p_id and dv.status = 'ACTIVE';
  if v.kind = 'LEGAL' and v.request_id is not null then
    update public.deep_requests d set status = 'ON_HOLD'
     where d.parent_request_id = v.request_id and d.status in ('QUEUED', 'IN_REVIEW', 'READY_FOR_DECISION');
  end if;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_actor, 'verification_revoked', 'document_verification', p_id::text, jsonb_build_object('reason_code', p_reason));
end;
$$;

create function public.create_deep_request(p_order uuid, p_now timestamptz) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_r public.review_requests%rowtype; v_id uuid;
begin
  select o.* into v_o from public.orders o where o.id = p_order;
  if not found or v_o.kind <> 'DEEP_REVIEW' or v_o.status <> 'PAID' then
    raise exception 'ORDER_NOT_PAID';
  end if;
  select d.id into v_id from public.deep_requests d where d.order_id = p_order;
  if found then
    return v_id;
  end if;
  select r.* into v_r from public.review_requests r where r.id = v_o.ref_id;
  insert into public.deep_requests (parent_request_id, order_id, owner_id, version_id, version_sha256, firm_id)
  values (v_r.id, p_order, v_o.user_id, v_r.version_id, v_r.version_sha256, v_r.firm_id) returning id into v_id;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (v_o.user_id, 'deep_requested', 'deep_request', v_id::text, '{}'::jsonb);
  return v_id;
end;
$$;

create function public.assign_deep_internal(p_actor uuid, p_deep uuid, p_reviewer uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v_d public.deep_requests%rowtype; v_firm uuid; v_active integer;
begin
  select d.* into v_d from public.deep_requests d where d.id = p_deep for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if not (public.is_platform_admin(p_actor)
          or (v_d.firm_id is not null and exists (select 1 from public.firm_members m
               where m.firm_id = v_d.firm_id and m.user_id = p_actor and m.role = 'coordinator'))) then
    raise exception 'FORBIDDEN';
  end if;
  if v_d.status not in ('QUEUED', 'IN_REVIEW', 'READY_FOR_DECISION') then
    raise exception 'NOT_ASSIGNABLE';
  end if;
  if p_reviewer = v_d.owner_id then
    raise exception 'REVIEWER_NOT_AUTHORIZED';
  end if;
  v_firm := v_d.firm_id;
  if v_firm is null then
    select m.firm_id into v_firm from public.firm_members m
     where m.user_id = p_reviewer and public.reviewer_has_authority(p_reviewer, m.firm_id, p_now) limit 1;
  end if;
  if v_firm is null or not public.reviewer_has_authority(p_reviewer, v_firm, p_now) then
    raise exception 'REVIEWER_NOT_AUTHORIZED';
  end if;
  select (select count(*) from public.review_assignments a where a.reviewer_id = p_reviewer and a.status = 'ACTIVE')
       + (select count(*) from public.deep_assignments a where a.reviewer_id = p_reviewer and a.status = 'ACTIVE') into v_active;
  if v_active >= 10 then
    raise exception 'REVIEWER_AT_CAPACITY';
  end if;
  update public.deep_assignments a set status = 'ENDED', ended_at = p_now where a.deep_id = p_deep and a.status = 'ACTIVE';
  insert into public.deep_assignments (deep_id, reviewer_id, assigned_by, assigned_at) values (p_deep, p_reviewer, p_actor, p_now);
  update public.deep_requests d set firm_id = v_firm where d.id = p_deep;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_actor, 'deep_assigned', 'deep_request', p_deep::text, jsonb_build_object('reviewer_id', p_reviewer));
end;
$$;

create function public.assign_deep(p_actor uuid, p_deep uuid, p_reviewer uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select d.status from public.deep_requests d where d.id = p_deep) is distinct from 'QUEUED' then
    raise exception 'NOT_ASSIGNABLE';
  end if;
  perform public.assign_deep_internal(p_actor, p_deep, p_reviewer, p_now);
end;
$$;

create function public.reassign_deep(p_actor uuid, p_deep uuid, p_reviewer uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce((select d.status from public.deep_requests d where d.id = p_deep), 'NONE') not in ('QUEUED', 'IN_REVIEW', 'READY_FOR_DECISION') then
    raise exception 'NOT_ASSIGNABLE';
  end if;
  perform public.assign_deep_internal(p_actor, p_deep, p_reviewer, p_now);
end;
$$;

create function public.deep_queue(p_reviewer uuid)
returns table (deep_id uuid, status text, created_at timestamptz, assigned_at timestamptz, category text)
language sql stable security definer set search_path = public as $$
  select d.id, d.status, d.created_at, a.assigned_at, doc.category
    from public.deep_assignments a
    join public.deep_requests d on d.id = a.deep_id
    join public.document_versions v on v.id = d.version_id
    join public.documents doc on doc.id = v.document_id
   where a.reviewer_id = p_reviewer and a.status = 'ACTIVE' and d.status in ('QUEUED', 'IN_REVIEW', 'READY_FOR_DECISION')
   order by a.assigned_at;
$$;

create function public.deep_unassigned(p_actor uuid)
returns table (deep_id uuid, created_at timestamptz, category text)
language sql stable security definer set search_path = public as $$
  select d.id, d.created_at, doc.category
    from public.deep_requests d
    join public.document_versions v on v.id = d.version_id
    join public.documents doc on doc.id = v.document_id
   where d.status = 'QUEUED' and not exists (select 1 from public.deep_assignments a where a.deep_id = d.id and a.status = 'ACTIVE')
     and (public.is_platform_admin(p_actor)
          or (d.firm_id is not null and exists (select 1 from public.firm_members m where m.firm_id = d.firm_id and m.user_id = p_actor and m.role = 'coordinator')))
   order by d.created_at;
$$;

create function public.deep_inflight(p_actor uuid, p_now timestamptz)
returns table (deep_id uuid, status text, created_at timestamptz, category text, reviewer_id uuid, reviewer_authorized boolean)
language sql stable security definer set search_path = public as $$
  select d.id, d.status, d.created_at, doc.category, a.reviewer_id,
         d.firm_id is not null and public.reviewer_has_authority(a.reviewer_id, d.firm_id, p_now)
    from public.deep_requests d
    join public.deep_assignments a on a.deep_id = d.id and a.status = 'ACTIVE'
    join public.document_versions v on v.id = d.version_id
    join public.documents doc on doc.id = v.document_id
   where d.status in ('QUEUED', 'IN_REVIEW', 'READY_FOR_DECISION')
     and (public.is_platform_admin(p_actor)
          or (d.firm_id is not null and exists (select 1 from public.firm_members m where m.firm_id = d.firm_id and m.user_id = p_actor and m.role = 'coordinator')))
   order by d.created_at;
$$;

revoke execute on function
  public.deep_eligibility(uuid, uuid, timestamptz, uuid), public.create_deep_request(uuid, timestamptz),
  public.assign_deep_internal(uuid, uuid, uuid, timestamptz), public.assign_deep(uuid, uuid, uuid, timestamptz),
  public.reassign_deep(uuid, uuid, uuid, timestamptz), public.deep_queue(uuid), public.deep_unassigned(uuid), public.deep_inflight(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.deep_eligibility(uuid, uuid, timestamptz, uuid), public.create_deep_request(uuid, timestamptz),
  public.assign_deep_internal(uuid, uuid, uuid, timestamptz), public.assign_deep(uuid, uuid, uuid, timestamptz),
  public.reassign_deep(uuid, uuid, uuid, timestamptz), public.deep_queue(uuid), public.deep_unassigned(uuid), public.deep_inflight(uuid, timestamptz)
  to service_role;
