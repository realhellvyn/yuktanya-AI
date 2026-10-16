-- Dokumen, draf kerja, versi tak berubah ber-hash, dan ekspor. Tulis hanya lewat fungsi server.

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  category text not null check (category in ('PKS', 'UTANG_PIUTANG', 'NDA')),
  template_id text not null,
  template_version integer not null,
  title text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, idempotency_key)
);

create table public.document_drafts (
  document_id uuid primary key references public.documents(id),
  structured_data jsonb not null default '{}'::jsonb,
  revision integer not null default 0,
  updated_at timestamptz not null default now()
);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id),
  version_no integer not null check (version_no > 0),
  canonical_text text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  structured_data jsonb not null,
  template_id text not null,
  template_version integer not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (document_id, version_no),
  unique (document_id, idempotency_key)
);

create table public.document_exports (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.document_versions(id),
  format text not null check (format in ('DOCX', 'PDF')),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size integer not null check (byte_size > 0),
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

create function public.forbid_immutable_change() returns trigger language plpgsql as $$
begin
  raise exception 'row is immutable';
end;
$$;
create trigger document_versions_immutable before update or delete on public.document_versions
  for each row execute function public.forbid_immutable_change();
create trigger document_versions_no_truncate before truncate on public.document_versions
  for each statement execute function public.forbid_immutable_change();
create trigger document_exports_immutable before update or delete on public.document_exports
  for each row execute function public.forbid_immutable_change();

alter table public.documents enable row level security;
alter table public.document_drafts enable row level security;
alter table public.document_versions enable row level security;
alter table public.document_exports enable row level security;
revoke all on public.documents, public.document_drafts, public.document_versions, public.document_exports from anon, authenticated;
grant select on public.documents, public.document_drafts, public.document_versions, public.document_exports to authenticated;

create policy documents_select_own on public.documents for select to authenticated using (owner_id = auth.uid());
create policy drafts_select_own on public.document_drafts for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id and d.owner_id = auth.uid()));
create policy versions_select_own on public.document_versions for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id and d.owner_id = auth.uid()));
create policy exports_select_own on public.document_exports for select to authenticated
  using (exists (select 1 from public.document_versions v join public.documents d on d.id = v.document_id
                  where v.id = version_id and d.owner_id = auth.uid()));

-- Batas 20 draf aktif (dokumen tanpa versi) per pengguna: default rekayasa, bukan keputusan pemilik.
create function public.create_document(p_user uuid, p_category text, p_template_id text, p_template_version integer, p_title text, p_key text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_open integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('doc-create:' || p_user::text, 0));
  select d.id into v_id from public.documents d where d.owner_id = p_user and d.idempotency_key = p_key;
  if found then
    return v_id;
  end if;
  select count(*) into v_open from public.documents d
   where d.owner_id = p_user and not exists (select 1 from public.document_versions v where v.document_id = d.id);
  if v_open >= 20 then
    raise exception 'TOO_MANY_DRAFTS';
  end if;
  insert into public.documents (owner_id, category, template_id, template_version, title, idempotency_key)
  values (p_user, p_category, p_template_id, p_template_version, p_title, p_key) returning id into v_id;
  insert into public.document_drafts (document_id) values (v_id);
  return v_id;
end;
$$;

create function public.save_draft(p_user uuid, p_document uuid, p_data jsonb, p_revision integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_rev integer;
begin
  update public.document_drafts dr
     set structured_data = p_data, revision = dr.revision + 1, updated_at = now()
    from public.documents d
   where dr.document_id = p_document and d.id = dr.document_id and d.owner_id = p_user and dr.revision = p_revision
  returning dr.revision into v_rev;
  if found then
    return v_rev;
  end if;
  if exists (select 1 from public.documents d where d.id = p_document and d.owner_id = p_user) then
    raise exception 'STALE_REVISION';
  end if;
  raise exception 'NOT_FOUND';
end;
$$;

-- Membekukan satu versi. Hash dihitung DB atas byte UTF-8 canonical_text. Kuota dokumen baru dikonsumsi pada
-- versi pertama, dalam transaksi yang sama dengan penyimpanan versi.
create function public.freeze_version(p_user uuid, p_document uuid, p_canonical text, p_data jsonb, p_key text, p_now timestamptz)
returns table (status text, version_id uuid, version_no integer, sha256 text, reset_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_doc public.documents%rowtype;
  v_existing public.document_versions%rowtype;
  v_no integer;
  v_hash text;
  v_vid uuid;
  v_q record;
begin
  select d.* into v_doc from public.documents d where d.id = p_document and d.owner_id = p_user for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;

  select v.* into v_existing from public.document_versions v where v.document_id = p_document and v.idempotency_key = p_key;
  if found then
    return query select 'DUPLICATE'::text, v_existing.id, v_existing.version_no, v_existing.sha256, null::timestamptz;
    return;
  end if;

  select coalesce(max(v.version_no), 0) + 1 into v_no from public.document_versions v where v.document_id = p_document;
  if v_no = 1 then
    select * into v_q from public.reserve_usage(p_user, 'DOCUMENT', 'doc:' || p_document::text, p_now);
    if v_q.status = 'QUOTA_DOCUMENT' then
      return query select 'QUOTA_DOCUMENT'::text, null::uuid, null::integer, null::text, v_q.reset_at;
      return;
    end if;
  end if;

  v_hash := encode(sha256(convert_to(p_canonical, 'UTF8')), 'hex');
  insert into public.document_versions (document_id, version_no, canonical_text, sha256, structured_data, template_id, template_version, idempotency_key)
  values (p_document, v_no, p_canonical, v_hash, p_data, v_doc.template_id, v_doc.template_version, p_key)
  returning id into v_vid;

  if v_no = 1 then
    perform public.finalize_usage(v_q.group_id, p_now);
  end if;
  return query select 'CREATED'::text, v_vid, v_no, v_hash, null::timestamptz;
end;
$$;

create function public.register_export(p_user uuid, p_version uuid, p_format text, p_sha text, p_size integer, p_path text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_doc uuid; v_id uuid;
begin
  select d.id into v_doc from public.document_versions v join public.documents d on d.id = v.document_id
   where v.id = p_version and d.owner_id = p_user;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if p_path not like p_user::text || '/' || v_doc::text || '/%' or p_path like '%..%' then
    raise exception 'INVALID_PATH';
  end if;
  insert into public.document_exports (version_id, format, sha256, byte_size, storage_path)
  values (p_version, p_format, p_sha, p_size, p_path) returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function
  public.create_document(uuid, text, text, integer, text, text),
  public.save_draft(uuid, uuid, jsonb, integer),
  public.freeze_version(uuid, uuid, text, jsonb, text, timestamptz),
  public.register_export(uuid, uuid, text, text, integer, text)
  from public, anon, authenticated;
grant execute on function
  public.create_document(uuid, text, text, integer, text, text),
  public.save_draft(uuid, uuid, jsonb, integer),
  public.freeze_version(uuid, uuid, text, jsonb, text, timestamptz),
  public.register_export(uuid, uuid, text, text, integer, text)
  to service_role;
