-- Catatan verifikasi (AI, Legal, Legal Enhanced) yang terikat satu versi dan hash persis. QR hanya mengarah ke pencarian publik.

create table public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
-- Penerbit dan ruang lingkup publik dimatikan sampai persetujuan privasi.
insert into public.app_settings (key, value) values ('PUBLIC_ISSUER_DISCLOSURE', 'off');

create table public.document_verifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('AI', 'LEGAL', 'LEGAL_ENHANCED')),
  version_id uuid not null references public.document_versions(id),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED', 'SUSPENDED')),
  outcome text,
  scope_summary text,
  issuer jsonb not null default '{}'::jsonb,
  policy_version text not null,
  code text not null unique check (length(code) >= 40),
  request_id uuid references public.review_requests(id),
  ai_report_id uuid references public.ai_review_reports(id),
  parent_verification_id uuid references public.document_verifications(id),
  issued_at timestamptz not null,
  check (
    (kind = 'LEGAL' and request_id is not null)
    or (kind = 'AI' and ai_report_id is not null)
    or (kind = 'LEGAL_ENHANCED' and parent_verification_id is not null and request_id is not null)
  )
);
create unique index document_verifications_one_per_request on public.document_verifications (request_id, kind) where request_id is not null;
create unique index document_verifications_one_per_ai_report on public.document_verifications (ai_report_id) where ai_report_id is not null;
create index document_verifications_version_idx on public.document_verifications (version_id, issued_at desc);

-- Hanya status yang boleh berubah; riwayat tidak pernah ditimpa atau dihapus.
create function public.guard_verification_update() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'verification records cannot be deleted';
  end if;
  if (new.id, new.kind, new.version_id, new.sha256, new.outcome, new.scope_summary, new.issuer, new.policy_version, new.code,
      new.request_id, new.ai_report_id, new.parent_verification_id, new.issued_at)
     is distinct from
     (old.id, old.kind, old.version_id, old.sha256, old.outcome, old.scope_summary, old.issuer, old.policy_version, old.code,
      old.request_id, old.ai_report_id, old.parent_verification_id, old.issued_at) then
    raise exception 'verification records are immutable except status';
  end if;
  return new;
end;
$$;
create trigger document_verifications_guard before update or delete on public.document_verifications
  for each row execute function public.guard_verification_update();

create table public.verification_revocations (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid not null references public.document_verifications(id),
  reason_code text not null check (reason_code in ('ERROR', 'MISLEADING', 'AUTHORITY_REVOKED', 'OWNER_REQUEST', 'OTHER')),
  private_reason text,
  actor_id uuid not null,
  created_at timestamptz not null
);
create trigger verification_revocations_append_only before update or delete on public.verification_revocations
  for each row execute function public.forbid_mutation();
alter table public.document_verifications enable row level security;
alter table public.verification_revocations enable row level security;
revoke all on public.document_verifications, public.verification_revocations from anon, authenticated;

create function public.new_verification_code() returns text
language sql volatile set search_path = public as $$
  select left(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 48);
$$;

-- Proyeksi publik minimal. Kode tak dikenal → satu baris NOT_FOUND. Tanpa isi dokumen, nama pihak, catatan, atau ID internal.
create function public.public_verification(p_code text)
returns table (status text, kind text, issued_at timestamptz, sha256 text, scope_summary text, outcome text)
language plpgsql stable security definer set search_path = public as $$
declare v public.document_verifications%rowtype; v_disclose boolean;
begin
  select dv.* into v from public.document_verifications dv where dv.code = p_code;
  if not found then
    return query select 'NOT_FOUND'::text, null::text, null::timestamptz, null::text, null::text, null::text;
    return;
  end if;
  select coalesce((select s.value = 'on' from public.app_settings s where s.key = 'PUBLIC_ISSUER_DISCLOSURE'), false) into v_disclose;
  return query select v.status, v.kind, v.issued_at, v.sha256, case when v_disclose then v.scope_summary end, v.outcome;
end;
$$;

create function public.revoke_verification(p_actor uuid, p_id uuid, p_reason text, p_private text, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v public.document_verifications%rowtype; v_firm uuid; v_allowed boolean;
begin
  select dv.* into v from public.document_verifications dv where dv.id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  v_allowed := public.is_platform_admin(p_actor);
  if not v_allowed and v.request_id is not null and (v.issuer ->> 'reviewer_id') = p_actor::text then
    select r.firm_id into v_firm from public.review_requests r where r.id = v.request_id;
    v_allowed := v_firm is not null and public.reviewer_has_authority(p_actor, v_firm, p_now);
  end if;
  if not v_allowed then
    raise exception 'FORBIDDEN';
  end if;
  if p_reason not in ('ERROR', 'MISLEADING', 'AUTHORITY_REVOKED', 'OWNER_REQUEST', 'OTHER') then
    raise exception 'INVALID_REASON';
  end if;
  if v.status = 'REVOKED' then
    return;
  end if;
  insert into public.verification_revocations (verification_id, reason_code, private_reason, actor_id, created_at)
  values (p_id, p_reason, left(p_private, 2000), p_actor, p_now);
  update public.document_verifications dv set status = 'REVOKED' where dv.id = p_id;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_actor, 'verification_revoked', 'document_verification', p_id::text, jsonb_build_object('reason_code', p_reason));
end;
$$;

create function public.issue_ai_verification(p_user uuid, p_ai_report uuid, p_now timestamptz)
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

create function public.verifications_for_version(p_user uuid, p_version uuid)
returns table (id uuid, kind text, status text, outcome text, code text, sha256 text, issued_at timestamptz, scope_summary text)
language sql stable security definer set search_path = public as $$
  select dv.id, dv.kind, dv.status, dv.outcome, dv.code, dv.sha256, dv.issued_at, dv.scope_summary
    from public.document_verifications dv
    join public.document_versions v on v.id = dv.version_id
    join public.documents d on d.id = v.document_id
   where dv.version_id = p_version and d.owner_id = p_user
   order by dv.issued_at desc;
$$;

revoke execute on function
  public.guard_verification_update(), public.new_verification_code(), public.public_verification(text),
  public.revoke_verification(uuid, uuid, text, text, timestamptz), public.issue_ai_verification(uuid, uuid, timestamptz),
  public.verifications_for_version(uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  public.new_verification_code(), public.public_verification(text),
  public.revoke_verification(uuid, uuid, text, text, timestamptz), public.issue_ai_verification(uuid, uuid, timestamptz),
  public.verifications_for_version(uuid, uuid)
  to service_role;
