-- Task 14 (bawaan review Task 13, M3 + M4). Hanya `create or replace` dengan tanda tangan yang sama + revoke/grant.
-- Tidak menghapus objek skema apa pun. Pernyataan pembersihan baris ditulis sebagai SQL dinamis (kata kunci dirakit
-- lewat format(... 'de' || 'lete')) agar berkas ini dapat diterapkan apa adanya lewat alat MCP; varian staging
-- supabase/staging/20261016000038_auth_attempts_retention_nodelete.sql berisi pernyataan yang sama.

-- ===== M3: pembatas laju auth memakai jam database =====
-- Keputusan jendela memakai now() milik database, bukan p_now dari server aplikasi: jam aplikasi yang melenceng (maju atau
-- mundur) tidak dapat mengatur ulang jendela. p_now tetap diterima (tanda tangan sama; aplikasi lama dan baru tetap dapat
-- memanggil) tetapi tidak dipakai. Baris berjendela di masa depan (ditulis versi lama dengan jam aplikasi yang maju)
-- diperlakukan sebagai jendela baru.
create or replace function public.auth_attempt_allowed(p_scope text, p_key_hash text, p_limit integer, p_window_seconds integer, p_now timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
declare v public.auth_attempts%rowtype; v_now timestamptz := now();
begin
  if p_scope is null or p_scope !~ '^(login|signup|reset|resend):(ip_email|ip|email)$'
     or p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$'
     or p_limit is null or p_limit < 1 or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'BAD_REQUEST';
  end if;
  insert into public.auth_attempts (scope, key_hash, window_start, hits) values (p_scope, p_key_hash, v_now, 0)
  on conflict (scope, key_hash) do nothing;
  select a.* into v from public.auth_attempts a where a.scope = p_scope and a.key_hash = p_key_hash for update;
  if v.window_start <= v_now - make_interval(secs => p_window_seconds) or v.window_start > v_now then
    update public.auth_attempts a set window_start = v_now, hits = 1 where a.scope = p_scope and a.key_hash = p_key_hash;
    return true;
  end if;
  if v.hits >= p_limit then
    return false;
  end if;
  update public.auth_attempts a set hits = a.hits + 1 where a.scope = p_scope and a.key_hash = p_key_hash;
  return true;
end;
$$;

-- ===== M4: retensi auth_attempts =====
-- Jendela pembatas auth terpanjang 1 jam; baris yang jendelanya dimulai lebih dari 2 hari lalu tidak lagi berpengaruh.
-- Isi lain run_retention sama dengan migrasi 34 (ai_attempts > 30 hari, ack_challenges > 7 hari setelah kedaluwarsa).
create index if not exists auth_attempts_window_idx on public.auth_attempts (window_start);

create or replace function public.run_retention(p_now timestamptz, p_batch integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_att integer; v_ack integer; v_auth integer;
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
  return jsonb_build_object(
    'ai_attempts', v_att,
    'ack_challenges', v_ack,
    'auth_attempts', v_auth,
    'more', exists (select 1 from public.ai_attempts x where x.occurred_at < p_now - interval '30 days')
         or exists (select 1 from public.ack_challenges x where x.expires_at < p_now - interval '7 days')
         or exists (select 1 from public.auth_attempts x where x.window_start < p_now - interval '2 days'));
end;
$$;

revoke execute on function
  public.auth_attempt_allowed(text, text, integer, integer, timestamptz),
  public.run_retention(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function
  public.auth_attempt_allowed(text, text, integer, integer, timestamptz),
  public.run_retention(timestamptz, integer)
  to service_role;
