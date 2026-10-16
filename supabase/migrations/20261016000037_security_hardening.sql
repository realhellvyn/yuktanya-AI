-- Pengerasan keamanan (Task 13, audit C) dan bawaan tinjauan Task 12.
-- Ditulis tanpa perintah penghapusan objek atau baris: dapat diterapkan apa adanya ke staging lewat alat MCP.
-- Semua fungsi SECURITY DEFINER tetap search_path = public; hak eksekusi hanya service_role.
--
-- C5a  Tiga fungsi analitik (SECURITY INVOKER) memperoleh search_path tetap; isi sama persis dengan migrasi 33.
-- C12  Pembatas percobaan auth (masuk, daftar, atur ulang kata sandi, kirim ulang konfirmasi) per IP+email, IP, dan email.
--      Hanya hash SHA-256 kunci yang disimpan (tanpa email/IP mentah). Satu baris per (lingkup, kunci) dengan jendela tetap
--      yang ditimpa saat jendela habis, jadi tabel tidak tumbuh per percobaan. Pembersihan baris kunci lama belum dijadwalkan
--      (lihat docs/RELEASE_CHECKLIST.md).
-- T12a Kebuntuan: settle_payment mengunci pembayarannya lalu ordernya, lalu sapuan kedaluwarsa per pengguna mengunci
--      pembayaran LAIN milik pengguna itu; sapuan global mengunci pembayaran menurut id. Kini settle_payment mengunci semua
--      pembayaran yang akan disentuhnya sekaligus menurut id (sebelum order mana pun), dan sapuan mengunci order menurut id
--      setelah pembayaran. Semua jalur: pembayaran (urut id) lalu order (urut id).
-- T12b declare_firm_conflict mengakhiri penugasan aktif dan mengembalikan semua permintaan pemilik itu yang masih berjalan
--      di firma itu ke perutean admin platform (firma dikosongkan, status antrean), sehingga permintaan berbayar tidak
--      tersangkut di firma yang berkonflik. Konflik tetap tercatat (firm_conflicts) dan menolak penugasan ke reviewer firma itu.

-- ===== C5a: search_path fungsi analitik =====
create or replace function public.analytics_event_names() returns text[]
language sql immutable set search_path = public as $$
  select array[
    'signup_completed', 'ai_request_started', 'ai_request_succeeded', 'ai_request_failed', 'document_started', 'draft_completed',
    'review_requested', 'review_payment_verified', 'review_assigned', 'review_completed',
    'special_case_requested', 'special_case_quote_sent', 'special_case_quote_accepted',
    'membership_activated', 'payment_refunded', 'ai_verification_issued', 'legal_verification_issued', 'legal_enhanced_verification_issued',
    'verification_revoked', 'standard_completed', 'legal_note_published', 'deep_eligible', 'deep_offer_shown', 'deep_quote_accepted',
    'deep_payment_verified', 'deep_assigned', 'deep_completed', 'deep_approval_recorded',
    'document_uploaded', 'ai_review_completed']::text[];
$$;

create or replace function public.analytics_safe_keys() returns text[]
language sql immutable set search_path = public as $$
  select array['kind', 'category', 'outcome', 'decision', 'status', 'severity', 'actionable', 'amount_idr', 'latency_ms', 'error_code', 'task',
               'has_document', 'revision', 'version_no', 'file_kind', 'risk_level', 'source', 'reason_code', 'plan_days', 'consentVersion', 'at']::text[];
$$;

create or replace function public.analytics_safe_metadata(p jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select coalesce(jsonb_object_agg(e.k, e.v), '{}'::jsonb)
    from jsonb_each(case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end) e(k, v)
   where e.k = any (public.analytics_safe_keys())
     and (jsonb_typeof(e.v) in ('number', 'boolean') or (jsonb_typeof(e.v) = 'string' and (e.v #>> '{}') ~ '^[A-Za-z0-9_.:+-]{1,64}$'));
$$;

-- ===== C12: pembatas percobaan auth =====
create table if not exists public.auth_attempts (
  scope text not null check (scope ~ '^(login|signup|reset|resend):(ip_email|ip|email)$'),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  hits integer not null check (hits >= 0),
  primary key (scope, key_hash)
);
alter table public.auth_attempts enable row level security;
revoke all on public.auth_attempts from anon, authenticated;

-- true = percobaan diizinkan dan dihitung; false = batas jendela terlampaui (percobaan yang ditolak tidak dihitung).
create or replace function public.auth_attempt_allowed(p_scope text, p_key_hash text, p_limit integer, p_window_seconds integer, p_now timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
declare v public.auth_attempts%rowtype;
begin
  if p_scope is null or p_scope !~ '^(login|signup|reset|resend):(ip_email|ip|email)$'
     or p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$'
     or p_limit is null or p_limit < 1 or p_window_seconds is null or p_window_seconds < 1 or p_now is null then
    raise exception 'BAD_REQUEST';
  end if;
  insert into public.auth_attempts (scope, key_hash, window_start, hits) values (p_scope, p_key_hash, p_now, 0)
  on conflict (scope, key_hash) do nothing;
  select a.* into v from public.auth_attempts a where a.scope = p_scope and a.key_hash = p_key_hash for update;
  if v.window_start <= p_now - make_interval(secs => p_window_seconds) or v.window_start > p_now then
    update public.auth_attempts a set window_start = p_now, hits = 1 where a.scope = p_scope and a.key_hash = p_key_hash;
    return true;
  end if;
  if v.hits >= p_limit then
    return false;
  end if;
  update public.auth_attempts a set hits = a.hits + 1 where a.scope = p_scope and a.key_hash = p_key_hash;
  return true;
end;
$$;

-- ===== T12a: urutan kunci sapuan kedaluwarsa (pembayaran menurut id, lalu order menurut id) =====
create or replace function public.expire_orders_scoped(p_user uuid, p_now timestamptz) returns integer
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[];
begin
  perform 1 from public.payments p join public.orders o on o.id = p.order_id
   where o.status = 'PENDING_PAYMENT' and o.expires_at <= p_now and (p_user is null or o.user_id = p_user)
   order by p.id
   for update of p;
  perform 1 from public.orders o
   where o.status = 'PENDING_PAYMENT' and o.expires_at <= p_now and (p_user is null or o.user_id = p_user)
   order by o.id
   for update;
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

-- ===== T12a: settle_payment mengunci semua pembayaran yang akan disentuh lebih dulu, menurut id =====
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

-- ===== T12b: konflik firma mengakhiri penugasan dan mengembalikan permintaan ke perutean admin =====
create or replace function public.declare_firm_conflict(p_actor uuid, p_kind text, p_id uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v_firm uuid; v_owner uuid; v_status text; v_ended integer := 0; v_released integer := 0; v_n integer;
begin
  if p_kind = 'STANDARD' then
    select r.firm_id, r.owner_id, r.status into v_firm, v_owner, v_status from public.review_requests r where r.id = p_id for update;
  elsif p_kind = 'DEEP' then
    select d.firm_id, d.owner_id, d.status into v_firm, v_owner, v_status from public.deep_requests d where d.id = p_id for update;
  else
    raise exception 'INVALID_KIND';
  end if;
  if not found or v_firm is null or p_actor = v_owner
     or not exists (select 1 from public.firm_members m where m.firm_id = v_firm and m.user_id = p_actor and m.role = 'coordinator') then
    raise exception 'FORBIDDEN';
  end if;
  if (p_kind = 'STANDARD' and v_status not in ('QUEUED', 'ASSIGNED', 'IN_REVIEW'))
     or (p_kind = 'DEEP' and v_status not in ('QUEUED', 'IN_REVIEW', 'READY_FOR_DECISION', 'ON_HOLD')) then
    raise exception 'NOT_ASSIGNABLE';
  end if;
  insert into public.firm_conflicts (firm_id, owner_id, declared_by, declared_at, source_kind, source_id)
  values (v_firm, v_owner, p_actor, p_now, p_kind, p_id) on conflict (firm_id, owner_id) do nothing;
  -- Konflik berlaku untuk pasangan (firma, pemilik): semua permintaan Standar dan Deep pemilik itu yang masih berjalan di firma
  -- itu dilepas. Penugasan aktif berakhir; pekerjaan tersimpan tetap ada tetapi tidak dihitung untuk penugasan berikutnya
  -- (penanda tangan baru wajib mengonfirmasi ulang). Firma dikosongkan agar admin platform dapat merutekan ke firma lain;
  -- reviewer firma yang berkonflik tetap ditolak (CONFLICT_OF_INTEREST) saat penugasan maupun penerbitan.
  update public.review_assignments a set status = 'ENDED', ended_at = p_now
   where a.status = 'ACTIVE' and a.request_id in (select r.id from public.review_requests r
          where r.firm_id = v_firm and r.owner_id = v_owner and r.status in ('QUEUED', 'ASSIGNED', 'IN_REVIEW'));
  get diagnostics v_ended = row_count;
  update public.review_requests r set status = 'QUEUED', firm_id = null
   where r.firm_id = v_firm and r.owner_id = v_owner and r.status in ('QUEUED', 'ASSIGNED', 'IN_REVIEW');
  get diagnostics v_released = row_count;
  update public.deep_assignments a set status = 'ENDED', ended_at = p_now
   where a.status = 'ACTIVE' and a.deep_id in (select d.id from public.deep_requests d
          where d.firm_id = v_firm and d.owner_id = v_owner and d.status in ('QUEUED', 'IN_REVIEW', 'READY_FOR_DECISION', 'ON_HOLD'));
  get diagnostics v_n = row_count;
  v_ended := v_ended + v_n;
  update public.deep_requests d set firm_id = null,
         status = case when d.status in ('IN_REVIEW', 'READY_FOR_DECISION') then 'QUEUED' else d.status end
   where d.firm_id = v_firm and d.owner_id = v_owner and d.status in ('QUEUED', 'IN_REVIEW', 'READY_FOR_DECISION', 'ON_HOLD');
  get diagnostics v_n = row_count;
  v_released := v_released + v_n;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_actor, 'firm_conflict_declared', case when p_kind = 'STANDARD' then 'review_request' else 'deep_request' end, p_id::text,
          jsonb_build_object('firm_id', v_firm, 'assignment_ended', v_ended > 0, 'released', v_released));
end;
$$;

revoke execute on function
  public.analytics_event_names(), public.analytics_safe_keys(), public.analytics_safe_metadata(jsonb),
  public.auth_attempt_allowed(text, text, integer, integer, timestamptz),
  public.expire_orders_scoped(uuid, timestamptz), public.settle_payment(text, text, text, integer, integer, timestamptz, timestamptz),
  public.declare_firm_conflict(uuid, text, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.auth_attempt_allowed(text, text, integer, integer, timestamptz),
  public.expire_orders_scoped(uuid, timestamptz), public.settle_payment(text, text, text, integer, integer, timestamptz, timestamptz),
  public.declare_firm_conflict(uuid, text, uuid, timestamptz)
  to service_role;
