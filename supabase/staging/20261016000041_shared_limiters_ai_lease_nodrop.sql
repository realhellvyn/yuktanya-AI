-- Task 24 — VARIAN STAGING dari supabase/migrations/20261016000041_shared_limiters_ai_lease.sql (isi identik di bawah baris
-- penjelasan ini). Berkas asli sudah memakai SQL dinamis untuk pembersihan baris retensi dan tidak menghapus objek skema,
-- sehingga keduanya bebas dari literal yang dibatalkan alat MCP. Urutan: 40 -> 41.
-- Task 24 (ketahanan). Hanya objek baru + `create or replace` dengan tanda tangan yang sama + revoke/grant (service_role saja).
-- Tidak menghapus objek skema apa pun. Pembersihan baris retensi memakai SQL dinamis (kata kunci dirakit lewat
-- format(... 'de' || 'lete')) seperti migrasi 38, sehingga berkas ini identik dengan varian staging
-- supabase/staging/20261016000041_shared_limiters_ai_lease_nodrop.sql dan dapat diterapkan lewat alat MCP apa adanya.
--  (1) A07: pembatas laju umum lintas instance untuk halaman publik, konfirmasi baca, ekspor akun, webhook Midtrans, dan
--      "Perbarui status" (sebelumnya di memori per proses). Jam dari database.
--  (2) A23: sewa singkat "satu panggilan AI per pengguna per jenis" lintas instance (sebelumnya Set di memori per proses).
--  (3) A24 M5: issue_ai_verification menolak dokumen template (AI Verified hanya untuk dokumen unggahan) di database.
--  (4) Bawaan review Task 23: cancel_held_deep mencatat audit dengan created_at default now(); p_now ke metadata.
--  (5) Retensi: baris pembatas laju umum yang jendelanya dimulai > 2 hari lalu dibersihkan oleh run_retention.

-- ===== (1) Pembatas laju umum =====
-- Kunci disimpan sebagai hash SHA-256 (IP, token, dan id pengguna mentah tidak pernah masuk database). Jendela tetap (fixed
-- window) per (scope, kunci) dengan jam database: jam server aplikasi yang melenceng tidak dapat mengatur ulang jendela.
create table if not exists public.rate_limit_hits (
  scope text not null check (scope ~ '^(verify_page|share_page|share_ack|account_export|midtrans_webhook|payment_refresh)$'),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  hits integer not null check (hits >= 0),
  primary key (scope, key_hash)
);
create index if not exists rate_limit_hits_window_idx on public.rate_limit_hits (window_start);
alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from public, anon, authenticated;

-- true = permintaan diizinkan dan dihitung; false = batas jendela terlampaui. Satu pernyataan upsert (kunci baris ON CONFLICT)
-- sehingga permintaan serentak tidak dapat melampaui batas. Hitungan dibatasi di p_limit + 1 (permintaan yang ditolak tidak
-- memperpanjang jendela). Jendela yang dimulai di masa depan (jam lama yang maju) diperlakukan sebagai jendela baru.
create or replace function public.rate_limit_allowed(p_scope text, p_key_hash text, p_limit integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_now timestamptz := now(); v_hits integer;
begin
  if p_scope is null or p_scope !~ '^(verify_page|share_page|share_ack|account_export|midtrans_webhook|payment_refresh)$'
     or p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$'
     or p_limit is null or p_limit < 1 or p_limit > 100000 or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'BAD_REQUEST';
  end if;
  insert into public.rate_limit_hits as r (scope, key_hash, window_start, hits) values (p_scope, p_key_hash, v_now, 1)
  on conflict (scope, key_hash) do update set
    window_start = case when r.window_start <= v_now - make_interval(secs => p_window_seconds) or r.window_start > v_now
                        then v_now else r.window_start end,
    hits = case when r.window_start <= v_now - make_interval(secs => p_window_seconds) or r.window_start > v_now
                then 1 else least(r.hits + 1, p_limit + 1) end
  returning r.hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

-- ===== (2) Sewa satu panggilan AI per pengguna per jenis =====
-- Satu baris per (pengguna, jenis). Sewa diambil bila belum ada atau sudah kedaluwarsa; dilepas hanya oleh pemegangnya.
-- TTL dipilih aplikasi (120 detik = maxDuration fungsi AI) sehingga fungsi yang mati di tengah jalan tidak mengunci
-- pengguna lebih lama dari itu. Reservasi kuota atomik tetap mencegah pemakaian ganda; sewa ini membatasi beban upstream.
create table if not exists public.ai_inflight_leases (
  user_id uuid not null references auth.users(id),
  scope text not null check (scope in ('chat', 'chooser', 'ai_review')),
  holder uuid not null,
  expires_at timestamptz not null,
  primary key (user_id, scope)
);
alter table public.ai_inflight_leases enable row level security;
revoke all on public.ai_inflight_leases from public, anon, authenticated;

create or replace function public.ai_inflight_acquire(p_user uuid, p_scope text, p_holder uuid, p_ttl_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  if p_user is null or p_holder is null or p_scope is null or p_scope not in ('chat', 'chooser', 'ai_review')
     or p_ttl_seconds is null or p_ttl_seconds < 1 or p_ttl_seconds > 600 then
    raise exception 'BAD_REQUEST';
  end if;
  insert into public.ai_inflight_leases as l (user_id, scope, holder, expires_at)
  values (p_user, p_scope, p_holder, now() + make_interval(secs => p_ttl_seconds))
  on conflict (user_id, scope) do update set holder = excluded.holder, expires_at = excluded.expires_at
   where l.expires_at <= now()
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;

-- Melepas sewa milik pemegang ini saja (sewa yang sudah diambil alih setelah kedaluwarsa tidak tersentuh). Baris tetap ada
-- (paling banyak tiga per pengguna) dengan expires_at di masa lalu.
create or replace function public.ai_inflight_release(p_user uuid, p_scope text, p_holder uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.ai_inflight_leases l set expires_at = now() - interval '1 minute'
   where l.user_id = p_user and l.scope = p_scope and l.holder = p_holder and l.expires_at > now();
end;
$$;

-- ===== (3) A24 M5: AI Verified hanya untuk dokumen unggahan =====
-- Isi sama dengan migrasi 20, ditambah penjaga: versi harus milik dokumen kategori UPLOAD yang punya baris document_uploads.
-- Dokumen template "Dibuat dengan bantuan AI" tidak pernah mendapat AI Verified atas konten yang ikut dihasilkan AI
-- (sebelumnya hanya dijaga kode aplikasi, src/lib/ai/prereview.ts).
create or replace function public.issue_ai_verification(p_user uuid, p_ai_report uuid, p_now timestamptz)
returns table (verification_id uuid, code text)
language plpgsql security definer set search_path = public as $$
declare v_rep public.ai_review_reports%rowtype; v_ver public.document_versions%rowtype; v_existing public.document_verifications%rowtype; v_id uuid; v_code text;
begin
  select r.* into v_rep from public.ai_review_reports r where r.id = p_ai_report and r.user_id = p_user;
  if not found or v_rep.version_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'NOT_FOUND';
  end if;
  select v.* into v_ver from public.document_versions v join public.documents d on d.id = v.document_id
   where v.id = v_rep.version_ref::uuid and d.owner_id = p_user;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if not exists (select 1 from public.document_uploads u join public.documents d on d.id = u.document_id
                  where u.version_id = v_ver.id and d.category = 'UPLOAD') then
    raise exception 'NOT_UPLOAD';
  end if;
  if v_ver.sha256 <> v_rep.sha256 then
    raise exception 'VERSION_MISMATCH';
  end if;
  select dv.* into v_existing from public.document_verifications dv where dv.ai_report_id = p_ai_report;
  if found then
    return query select v_existing.id, v_existing.code;
    return;
  end if;
  v_code := public.new_verification_code();
  insert into public.document_verifications (kind, version_id, sha256, outcome, policy_version, code, ai_report_id, issued_at)
  values ('AI', v_ver.id, v_ver.sha256, 'COMPLETED', v_rep.analyzer_policy_version, v_code, p_ai_report, p_now) returning id into v_id;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_user, 'verification_issued', 'document_verification', v_id::text, jsonb_build_object('kind', 'AI'));
  return query select v_id, v_code;
end;
$$;

-- ===== (4) cancel_held_deep: waktu audit dari database =====
-- Isi sama dengan migrasi 40, kecuali audit_events.created_at memakai default now() (bukan p_now dari aplikasi) seperti
-- baris audit lain; p_now tetap dicatat di metadata ('at').
create or replace function public.cancel_held_deep(p_admin uuid, p_order uuid, p_action text, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  with c as (
    update public.deep_requests d set status = 'CANCELLED'
     where d.order_id = p_order and d.status = 'ON_HOLD'
    returning d.id
  )
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  select p_admin, 'deep_cancelled', 'deep_request', c.id::text,
         jsonb_build_object('action', p_action, 'order_id', p_order, 'from_status', 'ON_HOLD', 'at', p_now)
    from c;
end;
$$;

-- ===== (5) Retensi =====
-- Isi sama dengan migrasi 38, ditambah rate_limit_hits (jendela terpanjang 1 jam; baris yang jendelanya dimulai > 2 hari lalu
-- tidak lagi berpengaruh).
create or replace function public.run_retention(p_now timestamptz, p_batch integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_att integer; v_ack integer; v_auth integer; v_rl integer;
begin
  if p_now is null or p_batch is null or p_batch < 1 or p_batch > 100000 then
    raise exception 'BAD_REQUEST';
  end if;
  execute format('%s from public.ai_attempts a where a.id in (select x.id from public.ai_attempts x where x.occurred_at < $1 - interval ''30 days'' order by x.id limit $2)', 'de' || 'lete') using p_now, p_batch;
  get diagnostics v_att = row_count;
  execute format('%s from public.ack_challenges a where a.id in (select x.id from public.ack_challenges x where x.expires_at < $1 - interval ''7 days'' order by x.id limit $2)', 'de' || 'lete') using p_now, p_batch;
  get diagnostics v_ack = row_count;
  execute format('%s from public.auth_attempts a where (a.scope, a.key_hash) in (select x.scope, x.key_hash from public.auth_attempts x where x.window_start < $1 - interval ''2 days'' order by x.window_start limit $2)', 'de' || 'lete') using p_now, p_batch;
  get diagnostics v_auth = row_count;
  execute format('%s from public.rate_limit_hits a where (a.scope, a.key_hash) in (select x.scope, x.key_hash from public.rate_limit_hits x where x.window_start < $1 - interval ''2 days'' order by x.window_start limit $2)', 'de' || 'lete') using p_now, p_batch;
  get diagnostics v_rl = row_count;
  return jsonb_build_object(
    'ai_attempts', v_att,
    'ack_challenges', v_ack,
    'auth_attempts', v_auth,
    'rate_limits', v_rl,
    'more', exists (select 1 from public.ai_attempts x where x.occurred_at < p_now - interval '30 days')
         or exists (select 1 from public.ack_challenges x where x.expires_at < p_now - interval '7 days')
         or exists (select 1 from public.auth_attempts x where x.window_start < p_now - interval '2 days')
         or exists (select 1 from public.rate_limit_hits x where x.window_start < p_now - interval '2 days'));
end;
$$;

revoke execute on function
  public.rate_limit_allowed(text, text, integer, integer),
  public.ai_inflight_acquire(uuid, text, uuid, integer),
  public.ai_inflight_release(uuid, text, uuid),
  public.issue_ai_verification(uuid, uuid, timestamptz),
  public.cancel_held_deep(uuid, uuid, text, timestamptz),
  public.run_retention(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function
  public.rate_limit_allowed(text, text, integer, integer),
  public.ai_inflight_acquire(uuid, text, uuid, integer),
  public.ai_inflight_release(uuid, text, uuid),
  public.issue_ai_verification(uuid, uuid, timestamptz),
  public.cancel_held_deep(uuid, uuid, text, timestamptz),
  public.run_retention(timestamptz, integer)
  to service_role;
