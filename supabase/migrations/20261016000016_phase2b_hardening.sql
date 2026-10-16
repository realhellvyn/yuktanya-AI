-- Penguatan Phase 2b: klaim outbox bertoken, batas tebakan dan permintaan kode, batas tautan,
-- serialisasi set pengingat dan paket bukti, serta pembatas percobaan AI.

-- ===== Outbox: klaim bertoken =====
alter table public.outbox_events add column claim_token uuid;

drop function public.claim_outbox(timestamptz, integer, integer);
drop function public.complete_outbox(uuid);
drop function public.fail_outbox(uuid, text, timestamptz);

-- Setiap klaim memberi token baru per baris; pekerja basi (token lama) tidak dapat menyelesaikan baris yang sudah diklaim ulang.
create function public.claim_outbox(p_now timestamptz, p_limit integer, p_lease_seconds integer) returns setof public.outbox_events
language plpgsql security definer set search_path = public as $$
begin
  update public.outbox_events o
     set status = 'FAILED', payload = '{}'::jsonb, lease_until = null, last_error = coalesce(o.last_error, 'lease expired after max attempts')
   where o.status = 'SENDING' and o.lease_until <= p_now and o.attempts >= 5;
  return query
  with due as (
    select o.id from public.outbox_events o
     where (o.status = 'PENDING' and o.available_at <= p_now)
        or (o.status = 'SENDING' and o.lease_until <= p_now and o.attempts < 5)
     order by o.available_at, o.created_at
     limit p_limit for update skip locked
  )
  update public.outbox_events o
     set status = 'SENDING', attempts = o.attempts + 1, lease_until = p_now + make_interval(secs => p_lease_seconds),
         claim_token = gen_random_uuid()
    from due where o.id = due.id
  returning o.*;
end;
$$;

create function public.complete_outbox(p_id uuid, p_token uuid) returns void
language sql security definer set search_path = public as $$
  update public.outbox_events o set status = 'SENT', payload = '{}'::jsonb, sent_at = now(), lease_until = null
   where o.id = p_id and o.status = 'SENDING' and o.claim_token = p_token;
$$;

create function public.fail_outbox(p_id uuid, p_token uuid, p_error text, p_retry_at timestamptz) returns void
language sql security definer set search_path = public as $$
  update public.outbox_events o
     set status = case when o.attempts >= 5 then 'FAILED' else 'PENDING' end,
         payload = case when o.attempts >= 5 then '{}'::jsonb else o.payload end,
         available_at = p_retry_at, lease_until = null, last_error = left(p_error, 500)
   where o.id = p_id and o.status = 'SENDING' and o.claim_token = p_token;
$$;

create function public.cancel_outbox(p_id uuid, p_token uuid) returns void
language sql security definer set search_path = public as $$
  update public.outbox_events o set status = 'CANCELLED', payload = '{}'::jsonb, lease_until = null
   where o.id = p_id and o.status = 'SENDING' and o.claim_token = p_token;
$$;

revoke execute on function
  public.claim_outbox(timestamptz, integer, integer), public.complete_outbox(uuid, uuid),
  public.fail_outbox(uuid, uuid, text, timestamptz), public.cancel_outbox(uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  public.claim_outbox(timestamptz, integer, integer), public.complete_outbox(uuid, uuid),
  public.fail_outbox(uuid, uuid, text, timestamptz), public.cancel_outbox(uuid, uuid)
  to service_role;

-- ===== Berbagi: batas tautan aktif, pencabutan seketika =====
create or replace function public.create_share(p_user uuid, p_version uuid, p_token_hash text, p_expires timestamptz, p_now timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform 1 from public.document_versions v join public.documents d on d.id = v.document_id
   where v.id = p_version and d.owner_id = p_user;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if not public.has_feature(p_user, 'vault.share', p_now) then
    raise exception 'FEATURE_NOT_AVAILABLE';
  end if;
  if p_expires < p_now + interval '1 hour' or p_expires > p_now + interval '30 days' then
    raise exception 'INVALID_EXPIRY';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('share:' || p_version::text, 0));
  if (select count(*) from public.share_links s
       where s.version_id = p_version and s.revoked_at is null and s.expires_at > p_now) >= 20 then
    raise exception 'TOO_MANY_SHARES';
  end if;
  insert into public.share_links (version_id, created_by, token_hash, expires_at) values (p_version, p_user, p_token_hash, p_expires)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.resolve_share(p_token_hash text, p_now timestamptz)
returns table (status text, share_id uuid, version_no integer, sha256 text, title text, canonical_text text, has_newer boolean)
language plpgsql security definer set search_path = public as $$
declare v_s public.share_links%rowtype; v_v public.document_versions%rowtype; v_title text;
begin
  select s.* into v_s from public.share_links s where s.token_hash = p_token_hash;
  if not found then
    return query select 'NOT_FOUND'::text, null::uuid, null::integer, null::text, null::text, null::text, null::boolean;
    return;
  end if;
  if v_s.revoked_at is not null then
    return query select 'REVOKED'::text, null::uuid, null::integer, null::text, null::text, null::text, null::boolean;
    return;
  end if;
  if v_s.expires_at <= p_now then
    return query select 'EXPIRED'::text, null::uuid, null::integer, null::text, null::text, null::text, null::boolean;
    return;
  end if;
  select v.* into v_v from public.document_versions v where v.id = v_s.version_id;
  select d.title into v_title from public.documents d where d.id = v_v.document_id;
  insert into public.share_events (share_id, kind, occurred_at) values (v_s.id, 'OPENED', p_now);
  return query select 'OK'::text, v_s.id, v_v.version_no, v_v.sha256, v_title, v_v.canonical_text,
    exists (select 1 from public.document_versions n where n.document_id = v_v.document_id and n.version_no > v_v.version_no);
end;
$$;

-- ===== Konfirmasi baca: batas permintaan dan tebakan lintas kode/tautan, serialisasi per email =====
create or replace function public.request_ack(p_token_hash text, p_email text, p_code text, p_now timestamptz) returns text
language plpgsql security definer set search_path = public as $$
declare v_s public.share_links%rowtype; v_email text := lower(trim(p_email)); v_id uuid := gen_random_uuid(); v_n integer;
begin
  select s.* into v_s from public.share_links s where s.token_hash = p_token_hash;
  if not found or v_s.revoked_at is not null or v_s.expires_at <= p_now then
    return 'NOT_FOUND';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ack:' || v_email, 0));
  select count(*) into v_n from public.ack_challenges c
   where c.share_id = v_s.id and c.email = v_email and c.created_at > p_now - interval '1 hour';
  if v_n >= 5 then
    return 'RATE_LIMITED';
  end if;
  select count(*) into v_n from public.ack_challenges c
   where c.email = v_email and c.created_at > p_now - interval '1 hour';
  if v_n >= 10 then
    return 'RATE_LIMITED';
  end if;
  insert into public.ack_challenges (id, share_id, email, code_hash, expires_at, created_at)
  values (v_id, v_s.id, v_email, encode(sha256(convert_to(v_id::text || ':' || p_code, 'UTF8')), 'hex'), p_now + interval '10 minutes', p_now);
  insert into public.share_events (share_id, kind, occurred_at) values (v_s.id, 'ACK_REQUESTED', p_now);
  perform public.enqueue_outbox('ack_code', jsonb_build_object('to', v_email, 'code', p_code, 'expires_at', to_jsonb(p_now + interval '10 minutes')), 'ack:' || v_id::text, p_now);
  return 'SENT';
end;
$$;

create or replace function public.verify_ack(p_token_hash text, p_email text, p_code text, p_now timestamptz) returns text
language plpgsql security definer set search_path = public as $$
declare v_s public.share_links%rowtype; v_email text := lower(trim(p_email)); v_c public.ack_challenges%rowtype; v_n bigint;
begin
  select s.* into v_s from public.share_links s where s.token_hash = p_token_hash;
  if not found or v_s.revoked_at is not null or v_s.expires_at <= p_now then
    return 'NOT_FOUND';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ack:' || v_email, 0));
  select coalesce(sum(c.attempts), 0) into v_n from public.ack_challenges c
   where c.share_id = v_s.id and c.email = v_email and c.created_at > p_now - interval '24 hours';
  if v_n >= 10 then
    return 'LOCKED';
  end if;
  select coalesce(sum(c.attempts), 0) into v_n from public.ack_challenges c
   where c.email = v_email and c.created_at > p_now - interval '24 hours';
  if v_n >= 20 then
    return 'LOCKED';
  end if;
  select c.* into v_c from public.ack_challenges c
   where c.share_id = v_s.id and c.email = v_email and c.consumed_at is null
   order by c.created_at desc limit 1 for update;
  if not found then
    return 'INVALID';
  end if;
  if v_c.attempts >= 5 then
    return 'LOCKED';
  end if;
  if v_c.expires_at <= p_now then
    return 'EXPIRED';
  end if;
  if v_c.code_hash = encode(sha256(convert_to(v_c.id::text || ':' || p_code, 'UTF8')), 'hex') then
    update public.ack_challenges c set consumed_at = p_now where c.id = v_c.id;
    insert into public.acknowledgements (share_id, email, verified_at) values (v_s.id, v_email, p_now) on conflict (share_id, email) do nothing;
    insert into public.share_events (share_id, kind, occurred_at) values (v_s.id, 'ACK_VERIFIED', p_now);
    return 'VERIFIED';
  end if;
  update public.ack_challenges c set attempts = c.attempts + 1 where c.id = v_c.id;
  return 'INVALID';
end;
$$;

-- ===== Pengingat: set serentak diserialkan per (pemilik, versi, spec) =====
create or replace function public.set_reminders(p_user uuid, p_version uuid, p_spec text, p_label text, p_due date, p_offsets integer[], p_now timestamptz)
returns table (reminder_id uuid, scheduled integer)
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_email text; v_off integer; v_send date; v_n integer := 0;
begin
  perform 1 from public.document_versions v join public.documents d on d.id = v.document_id
   where v.id = p_version and d.owner_id = p_user;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if not public.has_feature(p_user, 'vault.reminders', p_now) then
    raise exception 'FEATURE_NOT_AVAILABLE';
  end if;
  if p_offsets is null or cardinality(p_offsets) not between 1 and 5
     or (select count(distinct o) from unnest(p_offsets) o) <> cardinality(p_offsets)
     or exists (select 1 from unnest(p_offsets) o where o < 0 or o > 365) then
    raise exception 'INVALID_OFFSETS';
  end if;
  select u.email into v_email from auth.users u where u.id = p_user;
  if v_email is null then
    raise exception 'NO_EMAIL';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rem:' || p_user::text || ':' || p_version::text || ':' || p_spec, 0));
  perform public.cancel_reminders(p_user, p_version, p_spec, p_now);
  insert into public.reminders (owner_id, version_id, spec_id, label, due_date, offsets, created_at)
  values (p_user, p_version, p_spec, p_label, p_due, p_offsets, p_now) returning id into v_id;

  foreach v_off in array p_offsets loop
    v_send := p_due - v_off;
    if v_send >= public.wib_day(p_now) then
      perform public.enqueue_outbox('reminder',
        jsonb_build_object('to', v_email, 'label', p_label, 'due_date', p_due::text, 'offset', v_off),
        'reminder:' || v_id::text || ':' || v_off::text,
        (v_send::timestamp + time '08:00') at time zone 'Asia/Jakarta');
      v_n := v_n + 1;
    end if;
  end loop;
  return query select v_id, v_n;
end;
$$;

-- ===== Paket bukti: pendaftaran diserialkan per pemilik agar jeda 60 detik berlaku untuk permintaan serentak =====
create or replace function public.register_evidence_pack(p_user uuid, p_document uuid, p_sha text, p_size integer, p_path text, p_now timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('evid:' || p_user::text, 0));
  perform public.evidence_precheck(p_user, p_document, p_now);
  if p_path not like p_user::text || '/' || p_document::text || '/evidence/%' or p_path like '%..%' then
    raise exception 'INVALID_PATH';
  end if;
  insert into public.evidence_packs (document_id, owner_id, sha256, byte_size, storage_path, created_at)
  values (p_document, p_user, p_sha, p_size, p_path, p_now) returning id into v_id;
  return v_id;
end;
$$;

-- ===== Pembatas percobaan AI (percobaan gagal tetap dihitung) =====
create table public.ai_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  scope text not null check (scope in ('chat', 'assist')),
  occurred_at timestamptz not null
);
create index ai_attempts_lookup_idx on public.ai_attempts (user_id, scope, occurred_at);
alter table public.ai_attempts enable row level security;
revoke all on public.ai_attempts from anon, authenticated;

create function public.ai_attempt_allowed(p_user uuid, p_scope text, p_limit integer, p_window_seconds integer, p_now timestamptz) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('aiatt:' || p_user::text || ':' || p_scope, 0));
  delete from public.ai_attempts a where a.user_id = p_user and a.occurred_at < p_now - interval '1 day';
  select count(*) into v_n from public.ai_attempts a
   where a.user_id = p_user and a.scope = p_scope and a.occurred_at > p_now - make_interval(secs => p_window_seconds);
  if v_n >= p_limit then
    return false;
  end if;
  insert into public.ai_attempts (user_id, scope, occurred_at) values (p_user, p_scope, p_now);
  return true;
end;
$$;

revoke execute on function public.ai_attempt_allowed(uuid, text, integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_attempt_allowed(uuid, text, integer, integer, timestamptz) to service_role;
