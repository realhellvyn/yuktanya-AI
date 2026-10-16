-- Pembayaran dan settlement idempoten. Hanya settle_payment (dipanggil adapter tepercaya) yang membuat order PAID.

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  provider text not null check (provider in ('mock', 'manual')),
  provider_ref text not null,
  status text not null check (status in ('PENDING', 'VERIFIED', 'FAILED', 'EXPIRED', 'REFUNDED', 'DISPUTED')),
  amount_idr integer not null check (amount_idr > 0),
  fee_idr integer not null default 0 check (fee_idr >= 0),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_ref)
);
create index payments_order_idx on public.payments (order_id);
create table public.payment_events (
  provider text not null,
  event_id text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
revoke all on public.payments, public.payment_events from anon, authenticated;

create function public.create_payment(p_user uuid, p_order uuid, p_provider text, p_provider_ref text, p_now timestamptz) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_id uuid;
begin
  select o.* into v_o from public.orders o where o.id = p_order and o.user_id = p_user for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if v_o.status <> 'PENDING_PAYMENT' or v_o.expires_at <= p_now or v_o.amount_idr <= 0 then
    raise exception 'ORDER_NOT_PAYABLE';
  end if;
  insert into public.payments (order_id, provider, provider_ref, status, amount_idr)
  values (p_order, p_provider, p_provider_ref, 'PENDING', v_o.amount_idr) returning id into v_id;
  return v_id;
end;
$$;

create function public.fulfill_order(p_order uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_start timestamptz; v_i integer; v_n integer; v_days integer;
begin
  select o.* into v_o from public.orders o where o.id = p_order for update;
  if not found or v_o.status <> 'PAID' then
    raise exception 'ORDER_NOT_PAID';
  end if;
  if v_o.fulfilled_at is not null then
    return;
  end if;
  if v_o.kind in ('MEMBERSHIP_MONTHLY', 'MEMBERSHIP_ANNUAL') then
    select greatest(p_now, coalesce(max(m.period_end), p_now)) into v_start from public.memberships m
     where m.user_id = v_o.user_id and m.status = 'ACTIVE' and m.period_end > p_now;
    v_n := case when v_o.kind = 'MEMBERSHIP_ANNUAL' then 12 else 1 end;
    for v_i in 1..v_n loop
      insert into public.memberships (user_id, status, period_start, period_end)
      values (v_o.user_id, 'ACTIVE', v_start, v_start + interval '1 month');
      v_start := v_start + interval '1 month';
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
  end if;
  update public.orders o set fulfilled_at = p_now where o.id = v_o.id;
end;
$$;

create function public.settle_payment(p_provider text, p_provider_ref text, p_event_id text, p_amount integer, p_fee integer, p_now timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare v_p public.payments%rowtype; v_o public.orders%rowtype; v_rows integer;
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
  select o.* into v_o from public.orders o where o.id = v_p.order_id for update;

  if v_o.status = 'PENDING_PAYMENT' and v_o.expires_at <= p_now then
    perform public.expire_orders_scoped(v_o.user_id, p_now);
    v_o.status := 'EXPIRED';
  end if;
  if v_o.status <> 'PENDING_PAYMENT' then
    -- Terlambat atau order sudah dibayar lewat pembayaran lain: uang masuk tanpa aktivasi, perlu rekonsiliasi manual.
    update public.payments p set status = 'DISPUTED', fee_idr = greatest(p_fee, 0) where p.id = v_p.id;
    if v_o.status in ('EXPIRED', 'CANCELLED') then
      update public.orders o set status = 'RECONCILIATION_REQUIRED' where o.id = v_o.id;
    end if;
    return 'RECONCILIATION_REQUIRED';
  end if;
  if p_amount <> v_o.amount_idr then
    update public.payments p set status = 'DISPUTED', fee_idr = greatest(p_fee, 0) where p.id = v_p.id;
    update public.orders o set status = 'RECONCILIATION_REQUIRED' where o.id = v_o.id;
    return 'AMOUNT_MISMATCH';
  end if;
  update public.payments p set status = 'VERIFIED', verified_at = p_now, fee_idr = greatest(p_fee, 0) where p.id = v_p.id;
  update public.orders o set status = 'PAID', paid_at = p_now where o.id = v_o.id;
  perform public.fulfill_order(v_o.id, p_now);
  return 'SETTLED';
end;
$$;

create function public.confirm_manual_payment(p_admin uuid, p_payment uuid, p_bank_ref text, p_amount integer, p_now timestamptz) returns text
language plpgsql security definer set search_path = public as $$
declare v_p public.payments%rowtype; v_r text;
begin
  if not exists (select 1 from public.user_roles r where r.user_id = p_admin and r.role = 'platform_admin') then
    raise exception 'FORBIDDEN';
  end if;
  select p.* into v_p from public.payments p where p.id = p_payment and p.provider = 'manual';
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  v_r := public.settle_payment('manual', v_p.provider_ref, 'manual:' || p_payment::text, p_amount, 0, p_now);
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_admin, 'manual_payment_confirmed', 'payment', p_payment::text, jsonb_build_object('result', v_r, 'amount_idr', p_amount, 'bank_ref', left(p_bank_ref, 64)));
  return v_r;
end;
$$;

revoke execute on function
  public.create_payment(uuid, uuid, text, text, timestamptz), public.fulfill_order(uuid, timestamptz),
  public.settle_payment(text, text, text, integer, integer, timestamptz),
  public.confirm_manual_payment(uuid, uuid, text, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.create_payment(uuid, uuid, text, text, timestamptz), public.fulfill_order(uuid, timestamptz),
  public.settle_payment(text, text, text, integer, integer, timestamptz),
  public.confirm_manual_payment(uuid, uuid, text, integer, timestamptz)
  to service_role;
