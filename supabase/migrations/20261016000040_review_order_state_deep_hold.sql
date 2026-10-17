-- Task 23: status pesanan Legal Review per versi (A06), Deep Review yang tertahan setelah pencabutan induk (A08/B-32), dan
-- pelunasan Deep Review yang berpapasan dengan pencabutan induk (B-13).
-- Ditulis tanpa perintah penghapusan objek atau baris: varian staging (supabase/staging/20261016000040_*) isinya sama.
-- Semua fungsi SECURITY DEFINER dengan search_path = public; hak eksekusi hanya service_role. Angka harga, kuota, dan
-- hak Legal Review pertama per periode tidak berubah.
--
-- A06  preview_price menolak versi yang sudah punya pesanan STANDARD_REVIEW aktif dengan ALREADY_REVIEWED, syarat yang sama
--      dengan create_order (PENDING_PAYMENT atau PAID, setelah menyapu pesanan lewat batas bayar). Fungsi baca-saja baru
--      standard_review_order_for_version memberi tahu halaman dokumen pesanan mana (dan pemeriksaan mana) yang ditautkan.
-- B-32 admin_resolve_reconciliation: REFUND_RECORDED atau CLOSE pada pesanan Deep Review membatalkan permintaan Deep Review
--      yang ON_HOLD (status akhir CANCELLED yang sudah ada di skema; pekerjaan tidak akan pernah dilanjutkan karena
--      verifikasi induk yang dicabut tidak dapat aktif kembali). Dicatat di audit_events sebagai deep_cancelled.
--      Baris lama yang sudah terlanjur tertahan (ON_HOLD dengan pesanan CANCELLED) ikut ditutup sekali di akhir berkas ini.
-- B-13 settle_payment, create_deep_request, dan admin_resolve_reconciliation mengunci baris verifikasi LEGAL induk
--      (FOR SHARE) sebelum memeriksa kelayakan. Urutan kunci: verifikasi induk lebih dulu, baru pembayaran/pesanan/deep,
--      sama dengan revoke_verification (FOR UPDATE induk lebih dulu) dan decide_deep (FOR SHARE induk lebih dulu).

-- ===== A06: pesanan Legal Review aktif untuk satu versi (baca-saja) =====
-- Pesanan menunggu bayar yang sudah lewat batas tidak dihitung walau belum disapu (sama dengan hasil create_order, yang
-- menyapu lebih dulu). Hanya milik pemilik dokumen; pengguna lain mendapat hasil kosong.
create or replace function public.standard_review_order_for_version(p_user uuid, p_version uuid, p_now timestamptz)
returns table (order_id uuid, order_status text, request_id uuid)
language sql stable security definer set search_path = public as $$
  select o.id, o.status, r.id
    from public.orders o
    join public.document_versions v on v.id = o.ref_id
    join public.documents d on d.id = v.document_id and d.owner_id = p_user
    left join public.review_requests r on r.order_id = o.id
   where o.kind = 'STANDARD_REVIEW' and o.ref_id = p_version and o.user_id = p_user
     and (o.status = 'PAID' or (o.status = 'PENDING_PAYMENT' and o.expires_at > p_now))
   order by o.created_at desc
   limit 1;
$$;

-- Isi sama dengan migrasi 35, ditambah pemeriksaan ALREADY_REVIEWED dari create_order.
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
    -- Task 23 (A06): versi yang sudah punya pesanan aktif tidak ditawari harga lagi (create_order akan menolaknya).
    if exists (select 1 from public.orders o where o.ref_id = p_ref and o.kind = 'STANDARD_REVIEW'
                and o.status in ('PENDING_PAYMENT', 'PAID')) then
      raise exception 'ALREADY_REVIEWED';
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

-- ===== B-13: settle_payment (isi sama dengan migrasi 39, ditambah kunci induk untuk Deep Review) =====
create or replace function public.settle_payment(p_provider text, p_provider_ref text, p_event_id text, p_amount integer, p_fee integer, p_now timestamptz, p_received timestamptz default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_p public.payments%rowtype; v_o public.orders%rowtype; v_rows integer; v_at timestamptz := coalesce(p_received, p_now); v_ok boolean; v_reason text;
  v_user uuid; v_kind text; v_ref uuid;
begin
  select o.user_id, o.kind, o.ref_id into v_user, v_kind, v_ref from public.payments p join public.orders o on o.id = p.order_id
   where p.provider = p_provider and p.provider_ref = p_provider_ref;
  if found and v_kind = 'DEEP_REVIEW' then
    -- Task 23 (B-13): verifikasi LEGAL induk dikunci FOR SHARE lebih dulu (urutan sama dengan revoke_verification dan
    -- decide_deep). Pencabutan yang sedang berjalan ditunggu sampai selesai, lalu kelayakan di bawah membaca status
    -- terbarunya; pencabutan yang datang belakangan menunggu pelunasan ini dan kemudian menahan permintaan yang baru dibuat.
    perform 1 from public.document_verifications dv where dv.request_id = v_ref and dv.kind = 'LEGAL' order by dv.id for share;
  end if;
  -- Pembayaran ini dan pembayaran order lewat batas milik pengguna yang sama (yang akan disapu di bawah) dikunci dalam satu
  -- pernyataan menurut id, sama dengan urutan sapuan global, sebelum order mana pun dikunci.
  if v_user is not null then
    perform 1 from public.payments p join public.orders o on o.id = p.order_id
     where (p.provider = p_provider and p.provider_ref = p_provider_ref)
        or (o.user_id = v_user and o.status = 'PENDING_PAYMENT' and o.expires_at <= v_at)
     order by p.id
     for update of p;
  end if;
  select p.* into v_p from public.payments p where p.provider = p_provider and p.provider_ref = p_provider_ref for update;
  if not found then
    return 'NOT_FOUND';
  end if;
  insert into public.payment_events (provider, event_id, received_at) values (p_provider, p_event_id, p_now) on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 or v_p.status = 'VERIFIED' then
    return 'DUPLICATE';
  end if;
  -- Task 21: FAILED ikut diterima. Notifikasi gagal (mis. deny) dapat disusul pembayaran sukses pada transaksi yang sama;
  -- status itu sudah dikonfirmasi ke API penyedia, jadi dana yang masuk diproses (lunas, atau rekonsiliasi bila pesanan sudah
  -- tidak dapat dibayar), bukan diabaikan.
  if v_p.status not in ('PENDING', 'EXPIRED', 'FAILED') then
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
    -- Kelayakan dicek ulang (mengabaikan order ini sendiri) di bawah kunci induk. Induk dicabut/berubah: uang tercatat,
    -- tanpa pekerjaan.
    select e.eligible, e.reason into v_ok, v_reason from public.deep_eligibility(v_o.user_id, v_o.ref_id, p_now, v_o.id) e;
    if not coalesce(v_ok, false) then
      update public.payments p set status = 'DISPUTED', fee_idr = greatest(p_fee, 0) where p.id = v_p.id;
      update public.orders o set status = 'RECONCILIATION_REQUIRED' where o.id = v_o.id;
      insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
      values (v_o.user_id, 'deep_eligibility_rejected', 'review_request', v_o.ref_id::text,
              jsonb_build_object('reason', coalesce(v_reason, 'UNKNOWN'), 'stage', 'SETTLEMENT', 'order_id', v_o.id));
      return 'RECONCILIATION_REQUIRED';
    end if;
  end if;
  update public.payments p set status = 'VERIFIED', verified_at = p_now, fee_idr = greatest(p_fee, 0) where p.id = v_p.id;
  update public.orders o set status = 'PAID', paid_at = p_now where o.id = v_o.id;
  perform public.fulfill_order(v_o.id, p_now);
  return 'SETTLED';
end;
$$;

-- ===== B-13: create_deep_request (isi sama dengan migrasi 23, ditambah kunci dan penjaga induk) =====
-- Pemanggil (settle_payment, aktivasi rekonsiliasi) sudah mengunci induk dan memeriksa kelayakan dalam transaksi yang sama,
-- sehingga penjaga ini tidak pernah terpicu di jalur normal. Bila suatu jalur baru lupa memeriksa, permintaan tidak dibuat
-- (fail closed) dan seluruh transaksi dibatalkan, bukan Deep Review QUEUED di atas verifikasi yang sudah dicabut.
create or replace function public.create_deep_request(p_order uuid, p_now timestamptz) returns uuid
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
  perform 1 from public.document_verifications dv where dv.request_id = v_o.ref_id and dv.kind = 'LEGAL' order by dv.id for share;
  if not exists (select 1 from public.document_verifications dv where dv.request_id = v_o.ref_id and dv.kind = 'LEGAL' and dv.status = 'ACTIVE') then
    raise exception 'NOT_ELIGIBLE: PARENT_NOT_ACTIVE';
  end if;
  select r.* into v_r from public.review_requests r where r.id = v_o.ref_id;
  insert into public.deep_requests (parent_request_id, order_id, owner_id, version_id, version_sha256, firm_id)
  values (v_r.id, p_order, v_o.user_id, v_r.version_id, v_r.version_sha256, v_r.firm_id) returning id into v_id;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (v_o.user_id, 'deep_requested', 'deep_request', v_id::text, '{}'::jsonb);
  return v_id;
end;
$$;

-- B-32: Deep Review yang ditahan karena induknya dicabut ditutup (CANCELLED) setelah pesanannya dibatalkan lewat
-- rekonsiliasi. Hanya ON_HOLD yang berubah; deep yang berjalan/selesai tidak pernah disentuh. Dipanggil hanya dari
-- admin_resolve_reconciliation (yang sudah memeriksa peran admin dan memegang kunci induk + pesanan).
create or replace function public.cancel_held_deep(p_admin uuid, p_order uuid, p_action text, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  with c as (
    update public.deep_requests d set status = 'CANCELLED'
     where d.order_id = p_order and d.status = 'ON_HOLD'
    returning d.id
  )
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe, created_at)
  select p_admin, 'deep_cancelled', 'deep_request', c.id::text,
         jsonb_build_object('action', p_action, 'order_id', p_order, 'from_status', 'ON_HOLD'), p_now
    from c;
end;
$$;

-- ===== B-32 + B-13: rekonsiliasi admin (isi sama dengan migrasi 36, ditambah kunci induk dan pembatalan deep ON_HOLD) =====
create or replace function public.admin_resolve_reconciliation(p_admin uuid, p_order uuid, p_action text, p_note text, p_now timestamptz) returns text
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_p public.payments%rowtype; v_ok boolean; v_user uuid; v_e public.review_discount_entitlements%rowtype;
  v_kind text; v_ref uuid; v_found boolean;
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
  select o.user_id, o.kind, o.ref_id into v_user, v_kind, v_ref from public.orders o where o.id = p_order;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  -- Kunci yang sama dengan create_order: pemesanan ulang diskon tidak dapat berpapasan dengan order baru pengguna ini.
  perform pg_advisory_xact_lock(hashtextextended('order:' || v_user::text, 0));
  if v_kind = 'DEEP_REVIEW' then
    -- Task 23 (B-13): induk dikunci lebih dulu, sebelum pesanan, pembayaran, dan deep (urutan sama dengan settle_payment).
    perform 1 from public.document_verifications dv where dv.request_id = v_ref and dv.kind = 'LEGAL' order by dv.id for share;
  end if;
  -- (c) Order lewat batas yang belum disapu tidak boleh tetap memegang diskon periode.
  perform public.expire_orders_scoped(v_user, p_now);
  select o.* into v_o from public.orders o where o.id = p_order for update;

  if v_o.status in ('PAID', 'CANCELLED') then
    -- Pembayaran yang masuk setelah order lunas atau sudah dibatalkan: hanya pengembalian dana yang dapat dicatat;
    -- status order tidak berubah.
    select p.* into v_p from public.payments p where p.order_id = p_order and p.status = 'DISPUTED' order by p.created_at desc limit 1 for update;
    if not found or p_action <> 'REFUND_RECORDED' then
      raise exception 'NOT_RECONCILIATION';
    end if;
    update public.payments p set status = 'REFUNDED' where p.id = v_p.id;
    insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
    values (p_admin, 'reconciliation_resolved', 'order', p_order::text,
            jsonb_build_object('action', p_action, 'note', left(p_note, 300), 'payment_id', v_p.id, 'extra_payment', true, 'order_status', v_o.status));
    if v_o.status = 'CANCELLED' then
      perform public.cancel_held_deep(p_admin, p_order, p_action, p_now);
    end if;
    return 'REFUND_RECORDED';
  end if;
  if v_o.status <> 'RECONCILIATION_REQUIRED' then
    raise exception 'NOT_RECONCILIATION';
  end if;
  select p.* into v_p from public.payments p where p.order_id = p_order and p.status = 'DISPUTED' order by p.created_at desc limit 1 for update;
  v_found := found;

  if p_action = 'ACTIVATE' then
    if not v_found or v_p.received_amount_idr is distinct from v_o.amount_idr then
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
    if v_found then
      update public.payments p set status = 'REFUNDED' where p.id = v_p.id;
    end if;
    update public.orders o set status = 'CANCELLED' where o.id = p_order;
    update public.review_discount_entitlements e set status = 'RELEASED' where e.order_id = p_order and e.status = 'RESERVED';
    perform public.cancel_held_deep(p_admin, p_order, p_action, p_now);
  else
    update public.orders o set status = 'CANCELLED' where o.id = p_order;
    update public.review_discount_entitlements e set status = 'RELEASED' where e.order_id = p_order and e.status = 'RESERVED';
    perform public.cancel_held_deep(p_admin, p_order, p_action, p_now);
  end if;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_admin, 'reconciliation_resolved', 'order', p_order::text, jsonb_build_object('action', p_action, 'note', left(p_note, 300)));
  return case p_action when 'ACTIVATE' then 'ACTIVATED' else p_action end || case p_action when 'CLOSE' then 'D' else '' end;
end;
$$;

revoke execute on function
  public.standard_review_order_for_version(uuid, uuid, timestamptz), public.preview_price(uuid, text, uuid, timestamptz),
  public.settle_payment(text, text, text, integer, integer, timestamptz, timestamptz),
  public.create_deep_request(uuid, timestamptz),
  public.admin_resolve_reconciliation(uuid, uuid, text, text, timestamptz),
  public.cancel_held_deep(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.standard_review_order_for_version(uuid, uuid, timestamptz), public.preview_price(uuid, text, uuid, timestamptz),
  public.settle_payment(text, text, text, integer, integer, timestamptz, timestamptz),
  public.create_deep_request(uuid, timestamptz),
  public.admin_resolve_reconciliation(uuid, uuid, text, text, timestamptz),
  public.cancel_held_deep(uuid, uuid, text, timestamptz)
  to service_role;

-- B-32, data lama: Deep Review yang sudah terlanjur ON_HOLD dengan pesanan yang sudah dibatalkan lewat rekonsiliasi
-- (sebelum migrasi ini) ditutup sekali. Idempoten: menjalankan ulang tidak mengubah apa pun.
with c as (
  update public.deep_requests d set status = 'CANCELLED'
    from public.orders o
   where o.id = d.order_id and d.status = 'ON_HOLD' and o.status = 'CANCELLED'
  returning d.id, d.order_id
)
insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
select null, 'deep_cancelled', 'deep_request', c.id::text,
       jsonb_build_object('action', 'BACKFILL_MIGRATION_40', 'order_id', c.order_id, 'from_status', 'ON_HOLD')
  from c;
