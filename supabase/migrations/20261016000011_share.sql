-- Link berbagi terikat satu versi tak berubah. Token tidak pernah disimpan, hanya hash SHA-256-nya.
create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.document_versions(id),
  created_by uuid not null references auth.users(id),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.share_events (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.share_links(id),
  kind text not null check (kind in ('OPENED', 'ACK_REQUESTED', 'ACK_VERIFIED')),
  occurred_at timestamptz not null default now()
);
create index share_events_share_idx on public.share_events (share_id, kind);
alter table public.share_links enable row level security;
alter table public.share_events enable row level security;
revoke all on public.share_links, public.share_events from anon, authenticated;

create function public.create_share(p_user uuid, p_version uuid, p_token_hash text, p_expires timestamptz, p_now timestamptz)
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
  insert into public.share_links (version_id, created_by, token_hash, expires_at) values (p_version, p_user, p_token_hash, p_expires)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.revoke_share(p_user uuid, p_share uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.share_links s set revoked_at = coalesce(s.revoked_at, p_now)
   where s.id = p_share and exists (
     select 1 from public.document_versions v join public.documents d on d.id = v.document_id
      where v.id = s.version_id and d.owner_id = p_user);
  if not found then
    raise exception 'NOT_FOUND';
  end if;
end;
$$;

create function public.list_shares(p_user uuid, p_version uuid)
returns table (id uuid, expires_at timestamptz, revoked_at timestamptz, created_at timestamptz, opened_count bigint)
language sql stable security definer set search_path = public as $$
  select s.id, s.expires_at, s.revoked_at, s.created_at,
         (select count(*) from public.share_events e where e.share_id = s.id and e.kind = 'OPENED')
    from public.share_links s
    join public.document_versions v on v.id = s.version_id
    join public.documents d on d.id = v.document_id
   where s.version_id = p_version and d.owner_id = p_user
   order by s.created_at desc;
$$;

-- Satu baris selalu dikembalikan. Isi hanya bila status OK; selain itu semua kolom lain null.
create function public.resolve_share(p_token_hash text, p_now timestamptz)
returns table (status text, share_id uuid, version_no integer, sha256 text, title text, canonical_text text, has_newer boolean)
language plpgsql security definer set search_path = public as $$
declare v_s public.share_links%rowtype; v_v public.document_versions%rowtype; v_title text;
begin
  select s.* into v_s from public.share_links s where s.token_hash = p_token_hash;
  if not found then
    return query select 'NOT_FOUND'::text, null::uuid, null::integer, null::text, null::text, null::text, null::boolean;
    return;
  end if;
  if v_s.revoked_at is not null and v_s.revoked_at <= p_now then
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

revoke execute on function
  public.create_share(uuid, uuid, text, timestamptz, timestamptz), public.revoke_share(uuid, uuid, timestamptz),
  public.list_shares(uuid, uuid), public.resolve_share(text, timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.create_share(uuid, uuid, text, timestamptz, timestamptz), public.revoke_share(uuid, uuid, timestamptz),
  public.list_shares(uuid, uuid), public.resolve_share(text, timestamptz)
  to service_role;
