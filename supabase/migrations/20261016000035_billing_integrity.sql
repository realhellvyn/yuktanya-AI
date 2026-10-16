-- Integritas penagihan (audit A: A15, A21, A22, A23). Tanda tangan fungsi tetap; hak eksekusi hanya service_role.
-- Tanpa perintah penghapusan objek atau baris: dapat diterapkan apa adanya ke staging.
--
-- A15  Aktivasi rekonsiliasi order Member pertama: entitlement order itu dipesan ulang lalu dipakai. Bila diskon periode itu
--      sudah dipakai order lain, aktivasi ditolak (DISCOUNT_TAKEN); uang tetap tercatat di rekonsiliasi untuk dikembalikan.
-- A21  Pembayaran PENDING dengan metode sama dipakai ulang (klik ganda). Pembayaran kedua yang tetap masuk pada order yang
--      sudah lunas (DISPUTED) dapat dicatat pengembaliannya oleh admin; waktu dana diterima disimpan untuk angka "ditahan".
-- A22  Fulfilment membership berurutan per pengguna (kunci advisory) sehingga periode tidak tumpang tindih; order membership
--      atau paket yang masih menunggu pembayaran dipakai ulang, bukan digandakan.
-- A23  Pratinjau harga menyapu order kedaluwarsa milik pengguna lebih dulu (penyapuan terjadwal ada di /api/jobs/expire-orders);
--      sapuan tidak lagi dapat menimpa order yang baru saja dibayar oleh transaksi lain.

alter table public.payments add column if not exists received_at timestamptz;

-- A23: sapuan kini juga berjalan terjadwal untuk semua pengguna, berpapasan dengan settlement. Status diperiksa ulang di
-- UPDATE itu sendiri, jadi order yang baru saja dibayar atau dihidupkan kembali oleh transaksi lain tidak ikut kedaluwarsa.
create or replace function public.expire_orders_scoped(p_user uuid, p_now timestamptz) returns integer
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[];
begin
  with x as (
    update public.orders o set status = 'EXPIRED'
     where o.status = 'PENDING_PAYMENT' and o.expires_at <= p_now and (p_user is null or o.user_id = p_user)
    returning o.id
  )
  select coalesce(array_agg(x.id), '{}') into v_ids from x;
  if cardinality(v_ids) = 0 then
    return 0;
  end if;
  update public.review_discount_entitlements e set status = 'RELEASED' where e.order_id = any (v_ids) and e.status = 'RESERVED';
  update public.payments p set status = 'EXPIRED' where p.order_id = any (v_ids) and p.status = 'PENDING';
  return cardinality(v_ids);
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
    -- Klik ganda dengan kunci berbeda: order jenis sama yang masih menunggu pembayaran dipakai ulang (dikunci per pengguna di atas).
    select o.* into v_o from public.orders o
     where o.user_id = p_user and o.kind = p_kind and o.ref_id is null and o.status = 'PENDING_PAYMENT' and o.expires_at > p_now
     order by o.created_at desc limit 1;
    if found then
      return query select v_o.id, v_o.status, v_o.amount_idr, true;
      return;
    end if;
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
    -- Settlement serentak untuk pengguna yang sama menunggu di sini, lalu membaca akhir periode yang sudah di-commit.
    perform pg_advisory_xact_lock(hashtextextended('membership:' || v_o.user_id::text, 0));
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
  update public.payments p set received_amount_idr = p_amount, received_at = v_at where p.id = v_p.id;
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

-- A15 + A21: rekonsiliasi admin.
create or replace function public.admin_resolve_reconciliation(p_admin uuid, p_order uuid, p_action text, p_note text, p_now timestamptz) returns text
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_p public.payments%rowtype; v_ok boolean; v_user uuid; v_e public.review_discount_entitlements%rowtype;
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
  select o.user_id into v_user from public.orders o where o.id = p_order;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  -- Kunci yang sama dengan create_order: pemesanan ulang diskon tidak dapat berpapasan dengan order baru pengguna ini.
  perform pg_advisory_xact_lock(hashtextextended('order:' || v_user::text, 0));
  select o.* into v_o from public.orders o where o.id = p_order for update;

  if v_o.status = 'PAID' then
    -- Pembayaran tambahan yang masuk setelah order lunas: hanya pengembalian dana yang dapat dicatat; order tetap lunas.
    select p.* into v_p from public.payments p where p.order_id = p_order and p.status = 'DISPUTED' order by p.created_at desc limit 1 for update;
    if not found or p_action <> 'REFUND_RECORDED' then
      raise exception 'NOT_RECONCILIATION';
    end if;
    update public.payments p set status = 'REFUNDED' where p.id = v_p.id;
    insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
    values (p_admin, 'reconciliation_resolved', 'order', p_order::text,
            jsonb_build_object('action', p_action, 'note', left(p_note, 300), 'payment_id', v_p.id, 'extra_payment', true));
    return 'REFUND_RECORDED';
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
    if v_o.kind = 'STANDARD_REVIEW' and v_o.price_snapshot ->> 'variant' = 'MEMBER_FIRST' then
      -- Harga Rp30.000 hanya sah dengan entitlement periode itu. Entitlement yang dilepas saat kedaluwarsa dipesan ulang;
      -- bila diskon periode sudah dipakai order lain, aktivasi ditolak dan uang tetap di rekonsiliasi untuk dikembalikan.
      select e.* into v_e from public.review_discount_entitlements e where e.order_id = p_order for update;
      if not found then
        raise exception 'DISCOUNT_TAKEN';
      end if;
      if v_e.status = 'RELEASED' then
        if exists (select 1 from public.review_discount_entitlements x where x.membership_id = v_e.membership_id
                    and x.id <> v_e.id and x.status in ('RESERVED', 'CONSUMED')) then
          raise exception 'DISCOUNT_TAKEN';
        end if;
        update public.review_discount_entitlements e set status = 'RESERVED' where e.id = v_e.id;
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

create or replace function public.preview_price(p_user uuid, p_kind text, p_ref uuid, p_now timestamptz)
returns table (amount_idr integer, variant text, uses_credit boolean)
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  -- A23: diskon yang masih tercatat dipesan oleh order lewat batas bayar tidak boleh membuat layar menawarkan harga lain
  -- dari yang akan ditagih create_order (yang juga menyapu lebih dulu).
  perform public.expire_orders_scoped(p_user, p_now);
  if p_kind = 'STANDARD_REVIEW' then
    perform 1 from public.document_versions v join public.documents d on d.id = v.document_id
     where v.id = p_ref and d.owner_id = p_user;
    if not found then
      raise exception 'NOT_FOUND';
    end if;
    if exists (select 1 from public.document_versions v join public.special_cases c on c.document_id = v.document_id
                where v.id = p_ref and c.status in ('SUBMITTED', 'TRIAGED', 'QUOTED', 'ACCEPTED')) then
      raise exception 'SPECIAL_CASE_OPEN';
    end if;
  end if;
  select * into q from public.quote_price(p_user, p_kind, p_now);
  return query select q.amount_idr, q.variant, q.credit_id is not null;
end;
$$;

create or replace function public.create_payment(p_user uuid, p_order uuid, p_provider text, p_provider_ref text, p_now timestamptz) returns uuid
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
  if v_o.kind = 'STANDARD_REVIEW' and exists (
       select 1 from public.document_versions v join public.special_cases c on c.document_id = v.document_id
        where v.id = v_o.ref_id and c.status in ('SUBMITTED', 'TRIAGED', 'QUOTED', 'ACCEPTED')) then
    raise exception 'SPECIAL_CASE_OPEN';
  end if;
  -- A21: klik ganda "bayar" dengan metode sama memakai pembayaran yang masih menunggu (baris order dikunci di atas).
  select p.id into v_id from public.payments p where p.order_id = p_order and p.provider = p_provider and p.status = 'PENDING'
   order by p.created_at limit 1;
  if found then
    return v_id;
  end if;
  insert into public.payments (order_id, provider, provider_ref, status, amount_idr)
  values (p_order, p_provider, p_provider_ref, 'PENDING', v_o.amount_idr) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_overview(p_admin uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_ai_any boolean; v_ai_req bigint; v_ai_ok bigint; v_ai_fail bigint; v_p50 numeric; v_p95 numeric;
  v_rev jsonb; v_collected bigint; v_refunds bigint; v_fees bigint; v_pay_n bigint; v_refund_n bigint;
  v_sla50 numeric; v_sla95 numeric; v_completed bigint;
  v_registered bigint; v_new bigint; v_activated bigint;
  v_cohort uuid[]; v_held bigint; v_now timestamptz := least(p_to, now());
begin
  if not public.is_platform_admin(p_admin) then
    raise exception 'FORBIDDEN';
  end if;

  -- AI: dari product_events (latensi ms; tanpa prompt). Tanpa satu pun event AI → null.
  select exists (select 1 from public.product_events e where e.event_name in ('ai_request_succeeded', 'ai_request_failed')) into v_ai_any;
  select count(*) filter (where e.event_name = 'ai_request_succeeded'), count(*) filter (where e.event_name = 'ai_request_failed'),
         percentile_cont(0.5) within group (order by (e.metadata_safe ->> 'latency_ms')::numeric) filter (where e.event_name = 'ai_request_succeeded' and e.metadata_safe ? 'latency_ms'),
         percentile_cont(0.95) within group (order by (e.metadata_safe ->> 'latency_ms')::numeric) filter (where e.event_name = 'ai_request_succeeded' and e.metadata_safe ? 'latency_ms')
    into v_ai_ok, v_ai_fail, v_p50, v_p95
    from public.product_events e
   where e.event_name in ('ai_request_succeeded', 'ai_request_failed') and e.occurred_at >= p_from and e.occurred_at < p_to;
  v_ai_req := v_ai_ok + v_ai_fail;

  -- Pendapatan dikumpulkan: pembayaran VERIFIED dalam rentang, per jenis order.
  -- Uang yang pernah terverifikasi tetap dihitung walau kemudian ditahan (DISPUTED) atau dikembalikan (REFUNDED); verified_at menjadi dasar.
  select count(*), coalesce(sum(p.amount_idr), 0), coalesce(sum(p.fee_idr), 0) into v_pay_n, v_collected, v_fees
    from public.payments p where p.verified_at is not null and p.status in ('VERIFIED', 'DISPUTED', 'REFUNDED') and p.verified_at >= p_from and p.verified_at < p_to;
  select coalesce(jsonb_object_agg(k.kind, k.total), '{}'::jsonb) into v_rev
    from (select o.kind, sum(p.amount_idr) as total from public.payments p join public.orders o on o.id = p.order_id
           where p.verified_at is not null and p.status in ('VERIFIED', 'DISPUTED', 'REFUNDED') and p.verified_at >= p_from and p.verified_at < p_to group by o.kind) k;
  -- A21: "ditahan" = uang yang sudah masuk dan menunggu keputusan rekonsiliasi, termasuk pembayaran ganda atau terlambat yang
  -- belum pernah terverifikasi. Tanggal: saat terverifikasi, atau saat dana diterima.
  select coalesce(sum(coalesce(p.received_amount_idr, p.amount_idr)), 0) into v_held from public.payments p
   where p.status = 'DISPUTED' and coalesce(p.verified_at, p.received_at, p.created_at) >= p_from
     and coalesce(p.verified_at, p.received_at, p.created_at) < p_to;
  -- Pengembalian hanya untuk uang yang pernah dihitung sebagai terkumpul; transfer yang tak pernah terverifikasi bukan pengurang.
  select count(*), coalesce(sum(coalesce(pay.received_amount_idr, pay.amount_idr)), 0) into v_refund_n, v_refunds
    from public.audit_events a
    join public.payments pay on pay.order_id::text = a.entity_id and pay.status = 'REFUNDED' and pay.verified_at is not null
   where a.event_type = 'reconciliation_resolved' and a.metadata_safe ->> 'action' = 'REFUND_RECORDED' and a.created_at >= p_from and a.created_at < p_to;

  select count(*) into v_registered from public.profiles;
  select count(*) into v_new from public.profiles pr where pr.created_at >= p_from and pr.created_at < p_to;
  select count(distinct d.owner_id) into v_activated from public.document_versions v join public.documents d on d.id = v.document_id
   where v.created_at >= p_from and v.created_at < p_to;

  select coalesce(array_agg(pr.id), '{}') into v_cohort from public.profiles pr where pr.created_at >= p_from and pr.created_at < p_to;

  select count(*), percentile_cont(0.5) within group (order by extract(epoch from (r.completed_at - pay.verified_at)) / 3600),
         percentile_cont(0.95) within group (order by extract(epoch from (r.completed_at - pay.verified_at)) / 3600)
    into v_completed, v_sla50, v_sla95
    from public.review_requests r
    left join public.payments pay on pay.order_id = r.order_id and pay.status = 'VERIFIED'
   where r.status = 'COMPLETED' and r.completed_at >= p_from and r.completed_at < p_to and pay.verified_at is not null;

  return jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'users', jsonb_build_object('registered', v_registered, 'new', v_new, 'activated', v_activated),
    'ai', case when not v_ai_any then null else jsonb_build_object(
            'requests', v_ai_req, 'succeeded', v_ai_ok, 'failed', v_ai_fail,
            'success_rate', case when v_ai_req > 0 then round(v_ai_ok::numeric / v_ai_req, 4) end, 'p50_ms', v_p50, 'p95_ms', v_p95) end,
    'documents', jsonb_build_object(
      'started', (select count(*) from public.documents d where d.created_at >= p_from and d.created_at < p_to),
      'versions', (select count(*) from public.document_versions v where v.created_at >= p_from and v.created_at < p_to)),
    'funnel', jsonb_build_object(
      'registered', cardinality(v_cohort),
      'ai_used', (select count(distinct e.actor_user_id) from public.product_events e where e.actor_user_id = any (v_cohort) and e.event_name = 'ai_request_succeeded'),
      'doc_started', (select count(distinct d.owner_id) from public.documents d where d.owner_id = any (v_cohort)),
      'version_created', (select count(distinct d.owner_id) from public.document_versions v join public.documents d on d.id = v.document_id where d.owner_id = any (v_cohort)),
      'review_requested', (select count(distinct o.user_id) from public.orders o where o.user_id = any (v_cohort) and o.kind = 'STANDARD_REVIEW'),
      'review_paid', (select count(distinct r.owner_id) from public.review_requests r where r.owner_id = any (v_cohort)),
      'review_completed', (select count(distinct r.owner_id) from public.review_requests r where r.owner_id = any (v_cohort) and r.status = 'COMPLETED')),
    'reviews', jsonb_build_object(
      'unassigned', (select count(*) from public.review_requests r where r.status = 'QUEUED'),
      'backlog_by_age', jsonb_build_object(
        'lt_24h', (select count(*) from public.review_requests r where r.status in ('QUEUED', 'ASSIGNED', 'IN_REVIEW') and r.created_at > v_now - interval '24 hours'),
        'd1_3', (select count(*) from public.review_requests r where r.status in ('QUEUED', 'ASSIGNED', 'IN_REVIEW') and r.created_at <= v_now - interval '24 hours' and r.created_at > v_now - interval '3 days'),
        'gt_3d', (select count(*) from public.review_requests r where r.status in ('QUEUED', 'ASSIGNED', 'IN_REVIEW') and r.created_at <= v_now - interval '3 days')),
      'completed', v_completed, 'sla_median_hours', round(v_sla50, 2), 'sla_p95_hours', round(v_sla95, 2)),
    'revenue', case when v_pay_n = 0 and v_refund_n = 0 and v_held = 0 then null else jsonb_build_object(
                 'collected_by_kind', v_rev, 'collected', v_collected, 'held', v_held, 'refunds', v_refunds, 'net', v_collected - v_refunds, 'fees', v_fees,
                 'paying_users', (select count(distinct o.user_id) from public.payments p join public.orders o on o.id = p.order_id
                                   where p.status = 'VERIFIED' and p.verified_at >= p_from and p.verified_at < p_to)) end,
    'members', jsonb_build_object('active', (select count(distinct m.user_id) from public.memberships m where m.status = 'ACTIVE' and m.period_start <= v_now and v_now < m.period_end)),
    'incidents', jsonb_build_object(
      'reconciliation', (select count(*) from public.orders o where o.status = 'RECONCILIATION_REQUIRED'),
      'failed_outbox', (select count(*) from public.outbox_events x where x.status = 'FAILED'),
      'ai_failures', case when v_ai_any then v_ai_fail end));
end;
$$;

revoke execute on function
  public.create_order(uuid, text, uuid, text, timestamptz), public.fulfill_order(uuid, timestamptz),
  public.settle_payment(text, text, text, integer, integer, timestamptz, timestamptz),
  public.admin_resolve_reconciliation(uuid, uuid, text, text, timestamptz), public.preview_price(uuid, text, uuid, timestamptz),
  public.create_payment(uuid, uuid, text, text, timestamptz), public.admin_overview(uuid, timestamptz, timestamptz),
  public.expire_orders_scoped(uuid, timestamptz), public.expire_orders(timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.create_order(uuid, text, uuid, text, timestamptz), public.fulfill_order(uuid, timestamptz),
  public.settle_payment(text, text, text, integer, integer, timestamptz, timestamptz),
  public.admin_resolve_reconciliation(uuid, uuid, text, text, timestamptz), public.preview_price(uuid, text, uuid, timestamptz),
  public.create_payment(uuid, uuid, text, text, timestamptz), public.admin_overview(uuid, timestamptz, timestamptz),
  public.expire_orders_scoped(uuid, timestamptz), public.expire_orders(timestamptz)
  to service_role;
