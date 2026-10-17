-- Task 21: pembayaran Midtrans (Snap, mode redirect). Spec: docs/superpowers/specs/2026-10-17-midtrans-design.md.
-- Semua fungsi SECURITY DEFINER memakai search_path = public; hak eksekusi hanya service_role.
--
-- 1. payments.provider menerima 'midtrans' (constraint CHECK diganti dengan versi yang lebih luas).
-- 2. payments.checkout_url: URL halaman bayar penyedia (redirect_url Snap) agar klik ganda "Bayar" memakai transaksi yang
--    sama, bukan membuat transaksi Midtrans kedua yang tidak terhubung ke pembayaran mana pun. Bukan data rahasia.
-- 3. create_hosted_payment: create_payment (semua pemeriksaan kelayakan tetap) + simpan URL dalam satu transaksi.
--    Dipanggil SETELAH Midtrans membuat transaksi, sehingga galat Midtrans tidak meninggalkan pembayaran setengah jadi.
-- 4. fail_payment: notifikasi gagal yang sudah dikonfirmasi API penyedia. Hanya PENDING → FAILED/EXPIRED; idempoten per
--    event; tidak pernah menyentuh pembayaran yang sudah VERIFIED/DISPUTED/REFUNDED. Pesanan tetap PENDING_PAYMENT sehingga
--    dapat dibayar ulang selama belum kedaluwarsa.
-- 5. record_payment_event: status antara (pending, challenge, refund dari dashboard) hanya dicatat sebagai event.
-- 6. settle_payment: sama dengan migrasi 37, kecuali pembayaran FAILED dapat dilunasi (lihat komentar di fungsi).

-- Catatan staging: satu-satunya penghapusan objek adalah constraint CHECK provider yang langsung diganti versi yang lebih
-- luas; varian supabase/staging/20261016000039_midtrans_nodrop.sql menulisnya sebagai SQL dinamis.
alter table public.payments drop constraint payments_provider_check;
alter table public.payments add constraint payments_provider_check check (provider in ('mock', 'manual', 'midtrans'));

alter table public.payments add column if not exists checkout_url text
  constraint payments_checkout_url_check check (checkout_url is null or (char_length(checkout_url) <= 500 and checkout_url ~ '^https?://'));

-- ===== Pembayaran hosted (Midtrans Snap): pembayaran + URL halaman bayar dalam satu transaksi =====
create or replace function public.create_hosted_payment(p_user uuid, p_order uuid, p_provider text, p_provider_ref text, p_checkout_url text, p_now timestamptz)
returns table (payment_id uuid, checkout_url text)
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  -- create_payment mengunci order, memeriksa kelayakan bayar, dan memakai ulang pembayaran PENDING dengan penyedia sama.
  v_id := public.create_payment(p_user, p_order, p_provider, p_provider_ref, p_now);
  update public.payments p set checkout_url = coalesce(p.checkout_url, p_checkout_url) where p.id = v_id;
  return query select p.id, p.checkout_url from public.payments p where p.id = v_id;
end;
$$;

-- ===== Gagal bayar yang dikonfirmasi penyedia (cancel/deny/failure → FAILED, expire → EXPIRED) =====
create or replace function public.fail_payment(p_provider text, p_provider_ref text, p_event_id text, p_status text, p_now timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare v_p public.payments%rowtype; v_rows integer;
begin
  if p_status is null or p_status not in ('FAILED', 'EXPIRED') then
    raise exception 'INVALID_STATUS';
  end if;
  -- Hanya baris pembayaran yang dikunci (order tidak disentuh), sesuai urutan kunci pembayaran lalu order.
  select p.* into v_p from public.payments p where p.provider = p_provider and p.provider_ref = p_provider_ref for update;
  if not found then
    return 'NOT_FOUND';
  end if;
  insert into public.payment_events (provider, event_id, received_at) values (p_provider, p_event_id, p_now) on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return 'DUPLICATE';
  end if;
  if v_p.status <> 'PENDING' then
    return 'NO_CHANGE';
  end if;
  update public.payments p set status = p_status where p.id = v_p.id;
  return p_status;
end;
$$;

-- ===== Status antara: hanya dicatat sebagai event =====
create or replace function public.record_payment_event(p_provider text, p_provider_ref text, p_event_id text, p_now timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare v_rows integer;
begin
  if not exists (select 1 from public.payments p where p.provider = p_provider and p.provider_ref = p_provider_ref) then
    return 'NOT_FOUND';
  end if;
  insert into public.payment_events (provider, event_id, received_at) values (p_provider, p_event_id, p_now) on conflict do nothing;
  get diagnostics v_rows = row_count;
  return case when v_rows = 0 then 'DUPLICATE' else 'RECORDED' end;
end;
$$;

-- ===== settle_payment: isi sama dengan migrasi 37, kecuali pembayaran FAILED kini dapat dilunasi =====
create or replace function public.settle_payment(p_provider text, p_provider_ref text, p_event_id text, p_amount integer, p_fee integer, p_now timestamptz, p_received timestamptz default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_p public.payments%rowtype; v_o public.orders%rowtype; v_rows integer; v_at timestamptz := coalesce(p_received, p_now); v_ok boolean; v_reason text;
  v_user uuid;
begin
  -- Pembayaran ini dan pembayaran order lewat batas milik pengguna yang sama (yang akan disapu di bawah) dikunci dalam satu
  -- pernyataan menurut id, sama dengan urutan sapuan global, sebelum order mana pun dikunci.
  select o.user_id into v_user from public.payments p join public.orders o on o.id = p.order_id
   where p.provider = p_provider and p.provider_ref = p_provider_ref;
  if found then
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
    -- Kelayakan dicek ulang (mengabaikan order ini sendiri). Induk dicabut/berubah: uang tercatat, tanpa pekerjaan.
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

revoke execute on function
  public.create_hosted_payment(uuid, uuid, text, text, text, timestamptz),
  public.fail_payment(text, text, text, text, timestamptz),
  public.record_payment_event(text, text, text, timestamptz),
  public.settle_payment(text, text, text, integer, integer, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.create_hosted_payment(uuid, uuid, text, text, text, timestamptz),
  public.fail_payment(text, text, text, text, timestamptz),
  public.record_payment_event(text, text, text, timestamptz),
  public.settle_payment(text, text, text, integer, integer, timestamptz, timestamptz)
  to service_role;
