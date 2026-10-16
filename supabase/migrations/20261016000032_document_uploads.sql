-- Dokumen unggahan pengguna (PDF/DOCX/TXT) untuk analisis awal AI (Task 6, flag AI_PREREVIEW_ENABLED).
-- Setiap unggahan menjadi dokumen kategori UPLOAD dengan TEPAT SATU versi beku: canonical_text = teks hasil pembacaan
-- (RenderedDoc kanonik) dan sha256 versi = SHA-256 byte UTF-8 canonical_text (sama seperti versi template, sehingga semua
-- pemeriksaan integritas yang ada tetap berlaku). Byte berkas asli disimpan privat di blob store; SHA-256 byte persis
-- berkas asli dicatat di document_uploads (tak berubah). Kuota "dokumen baru" dikonsumsi dalam transaksi yang sama.
-- Catatan staging: satu-satunya DROP adalah constraint CHECK kategori yang diganti dengan versi yang lebih luas
-- (tanpa kehilangan data); tidak ada DELETE.

alter table public.documents drop constraint documents_category_check;
alter table public.documents add constraint documents_category_check check (category in ('PKS', 'UTANG_PIUTANG', 'NDA', 'UPLOAD'));

create table public.document_uploads (
  version_id uuid primary key references public.document_versions(id),
  document_id uuid not null unique references public.documents(id),
  file_kind text not null check (file_kind in ('PDF', 'DOCX', 'TXT')),
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  byte_size integer not null check (byte_size > 0 and byte_size <= 5242880),
  original_sha256 text not null check (original_sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text not null unique,
  page_count integer check (page_count is null or page_count > 0),
  char_count integer not null check (char_count > 0),
  risk_level text not null check (risk_level in ('NORMAL', 'HIGH')),
  risk_reasons text[] not null default '{}',
  created_at timestamptz not null default now()
);
create trigger document_uploads_immutable before update or delete on public.document_uploads
  for each row execute function public.forbid_immutable_change();
create trigger document_uploads_no_truncate before truncate on public.document_uploads
  for each statement execute function public.forbid_immutable_change();

alter table public.document_uploads enable row level security;
revoke all on public.document_uploads from anon, authenticated;
grant select on public.document_uploads to authenticated;
create policy uploads_select_own on public.document_uploads for select to authenticated
  using (exists (select 1 from public.documents d where d.id = document_id and d.owner_id = auth.uid()));

-- Dokumen UPLOAD hanya boleh dibuat oleh create_upload; versi kedua, salinan (clone), atau draf baru ditolak.
create function public.guard_upload_rows() returns trigger language plpgsql set search_path = public as $$
declare v_cat text;
begin
  if tg_table_name = 'documents' then
    v_cat := new.category;
  else
    select d.category into v_cat from public.documents d where d.id = new.document_id;
  end if;
  if v_cat = 'UPLOAD' and coalesce(current_setting('yuktanya.upload_insert', true), '') <> 'on' then
    raise exception 'UPLOAD_IMMUTABLE';
  end if;
  return new;
end;
$$;
create trigger documents_upload_guard before insert on public.documents
  for each row execute function public.guard_upload_rows();
create trigger versions_upload_guard before insert on public.document_versions
  for each row execute function public.guard_upload_rows();

-- Dokumen unggahan berisiko tinggi tidak dapat dipesan untuk Review Standar: arahnya Kasus Hukum Khusus.
create function public.guard_high_risk_standard_order() returns trigger language plpgsql set search_path = public as $$
begin
  if new.kind = 'STANDARD_REVIEW' and exists (
       select 1 from public.document_uploads u where u.version_id = new.ref_id and u.risk_level = 'HIGH') then
    raise exception 'SPECIAL_CASE_REQUIRED';
  end if;
  return new;
end;
$$;
create trigger orders_high_risk_upload_guard before insert on public.orders
  for each row execute function public.guard_high_risk_standard_order();

create function public.create_upload(
  p_user uuid, p_key text, p_title text, p_canonical text, p_kind text, p_filename text, p_size integer,
  p_original_sha text, p_path text, p_pages integer, p_chars integer, p_risk text, p_reasons text[], p_now timestamptz
) returns table (status text, document_id uuid, version_id uuid, sha256 text, reset_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_doc uuid;
  v_ver uuid;
  v_hash text;
  v_q record;
begin
  if p_key is null or p_key !~ '^[\x21-\x7e]{8,128}$' then
    raise exception 'INVALID_KEY';
  end if;
  if p_path not like p_user::text || '/uploads/%' or p_path like '%..%' then
    raise exception 'INVALID_PATH';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('doc-create:' || p_user::text, 0));

  select d.id into v_doc from public.documents d where d.owner_id = p_user and d.idempotency_key = p_key;
  if found then
    select v.id, v.sha256 into v_ver, v_hash from public.document_versions v join public.document_uploads u on u.version_id = v.id
     where v.document_id = v_doc;
    if not found then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return query select 'DUPLICATE'::text, v_doc, v_ver, v_hash, null::timestamptz;
    return;
  end if;

  select * into v_q from public.reserve_usage(p_user, 'DOCUMENT', 'upload:' || p_key, p_now);
  if v_q.status = 'QUOTA_DOCUMENT' then
    return query select 'QUOTA_DOCUMENT'::text, null::uuid, null::uuid, null::text, v_q.reset_at;
    return;
  end if;

  perform set_config('yuktanya.upload_insert', 'on', true);
  insert into public.documents (owner_id, category, template_id, template_version, title, idempotency_key)
  values (p_user, 'UPLOAD', 'upload', 1, p_title, p_key) returning id into v_doc;
  insert into public.document_drafts (document_id) values (v_doc);
  v_hash := encode(sha256(convert_to(p_canonical, 'UTF8')), 'hex');
  insert into public.document_versions (document_id, version_no, canonical_text, sha256, structured_data, template_id, template_version, idempotency_key)
  values (v_doc, 1, p_canonical, v_hash, '{}'::jsonb, 'upload', 1, p_key) returning id into v_ver;
  perform set_config('yuktanya.upload_insert', 'off', true);
  insert into public.document_uploads (version_id, document_id, file_kind, original_filename, byte_size, original_sha256, storage_path,
                                       page_count, char_count, risk_level, risk_reasons)
  values (v_ver, v_doc, p_kind, p_filename, p_size, p_original_sha, p_path, p_pages, p_chars, p_risk, coalesce(p_reasons, '{}'));
  perform public.finalize_usage(v_q.group_id, p_now);
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_user, 'document.uploaded', 'document', v_doc::text, jsonb_build_object('kind', p_kind, 'bytes', p_size, 'risk', p_risk));
  return query select 'CREATED'::text, v_doc, v_ver, v_hash, null::timestamptz;
end;
$$;

revoke execute on function public.create_upload(uuid, text, text, text, text, text, integer, text, text, integer, integer, text, text[], timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_upload(uuid, text, text, text, text, text, integer, text, text, integer, integer, text, text[], timestamptz)
  to service_role;
revoke execute on function public.guard_upload_rows(), public.guard_high_risk_standard_order() from public, anon, authenticated;
