-- Paket bukti: snapshot ber-manifest dari riwayat dokumen milik pemilik. Bukan jaminan nilai pembuktian di pengadilan.
create table public.evidence_packs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id),
  owner_id uuid not null references auth.users(id),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer not null check (byte_size > 0),
  storage_path text not null unique,
  created_at timestamptz not null
);
alter table public.evidence_packs enable row level security;
revoke all on public.evidence_packs from anon, authenticated;

-- Pemeriksaan awal (pemilik, fitur, jeda 60 detik) sebelum paket dibangun dan ditulis ke penyimpanan.
create function public.evidence_precheck(p_user uuid, p_document uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.documents d where d.id = p_document and d.owner_id = p_user;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if not public.has_feature(p_user, 'vault.evidence_pack', p_now) then
    raise exception 'FEATURE_NOT_AVAILABLE';
  end if;
  if exists (select 1 from public.evidence_packs e where e.owner_id = p_user and e.created_at > p_now - interval '60 seconds') then
    raise exception 'RATE_LIMITED';
  end if;
end;
$$;

create function public.register_evidence_pack(p_user uuid, p_document uuid, p_sha text, p_size integer, p_path text, p_now timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.evidence_precheck(p_user, p_document, p_now);
  if p_path not like p_user::text || '/' || p_document::text || '/evidence/%' or p_path like '%..%' then
    raise exception 'INVALID_PATH';
  end if;
  insert into public.evidence_packs (document_id, owner_id, sha256, byte_size, storage_path, created_at)
  values (p_document, p_user, p_sha, p_size, p_path, p_now) returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.evidence_precheck(uuid, uuid, timestamptz),
  public.register_evidence_pack(uuid, uuid, text, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function public.evidence_precheck(uuid, uuid, timestamptz),
  public.register_evidence_pack(uuid, uuid, text, integer, text, timestamptz) to service_role;
