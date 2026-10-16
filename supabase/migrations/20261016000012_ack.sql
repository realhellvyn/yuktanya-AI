-- Konfirmasi baca: email diverifikasi lewat kode 6 digit. Ini BUKAN tanda tangan elektronik.
create table public.ack_challenges (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.share_links(id),
  email text not null,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  attempts integer not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null
);
create index ack_challenges_lookup_idx on public.ack_challenges (share_id, email, created_at desc);
create table public.acknowledgements (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.share_links(id),
  email text not null,
  verified_at timestamptz not null,
  unique (share_id, email)
);
alter table public.ack_challenges enable row level security;
alter table public.acknowledgements enable row level security;
revoke all on public.ack_challenges, public.acknowledgements from anon, authenticated;

-- Kode bersifat sementara: hanya sha256(challenge_id:code) yang disimpan; teks kode ada di payload outbox sampai terkirim.
create function public.request_ack(p_token_hash text, p_email text, p_code text, p_now timestamptz) returns text
language plpgsql security definer set search_path = public as $$
declare v_s public.share_links%rowtype; v_email text := lower(trim(p_email)); v_id uuid := gen_random_uuid(); v_n integer;
begin
  select s.* into v_s from public.share_links s where s.token_hash = p_token_hash;
  if not found or (v_s.revoked_at is not null and v_s.revoked_at <= p_now) or v_s.expires_at <= p_now then
    return 'NOT_FOUND';
  end if;
  select count(*) into v_n from public.ack_challenges c
   where c.share_id = v_s.id and c.email = v_email and c.created_at > p_now - interval '1 hour';
  if v_n >= 5 then
    return 'RATE_LIMITED';
  end if;
  insert into public.ack_challenges (id, share_id, email, code_hash, expires_at, created_at)
  values (v_id, v_s.id, v_email, encode(sha256(convert_to(v_id::text || ':' || p_code, 'UTF8')), 'hex'), p_now + interval '10 minutes', p_now);
  insert into public.share_events (share_id, kind, occurred_at) values (v_s.id, 'ACK_REQUESTED', p_now);
  perform public.enqueue_outbox('ack_code', jsonb_build_object('to', v_email, 'code', p_code), 'ack:' || v_id::text, p_now);
  return 'SENT';
end;
$$;

create function public.verify_ack(p_token_hash text, p_email text, p_code text, p_now timestamptz) returns text
language plpgsql security definer set search_path = public as $$
declare v_s public.share_links%rowtype; v_email text := lower(trim(p_email)); v_c public.ack_challenges%rowtype;
begin
  select s.* into v_s from public.share_links s where s.token_hash = p_token_hash;
  if not found or (v_s.revoked_at is not null and v_s.revoked_at <= p_now) or v_s.expires_at <= p_now then
    return 'NOT_FOUND';
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

create function public.list_acknowledgements(p_user uuid, p_version uuid)
returns table (share_id uuid, email text, verified_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.share_id, a.email, a.verified_at
    from public.acknowledgements a
    join public.share_links s on s.id = a.share_id
    join public.document_versions v on v.id = s.version_id
    join public.documents d on d.id = v.document_id
   where s.version_id = p_version and d.owner_id = p_user
   order by a.verified_at;
$$;

revoke execute on function public.request_ack(text, text, text, timestamptz), public.verify_ack(text, text, text, timestamptz),
  public.list_acknowledgements(uuid, uuid) from public, anon, authenticated;
grant execute on function public.request_ack(text, text, text, timestamptz), public.verify_ack(text, text, text, timestamptz),
  public.list_acknowledgements(uuid, uuid) to service_role;
