-- Laporan review standar, Legal Note, dan penyelesaian atomik. Hanya reviewer yang ditugaskan dan berwenang yang dapat menerbitkan.

create table public.review_reports (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.review_requests(id),
  revision integer not null default 0,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'FINAL')),
  scope text not null default '',
  assumptions text not null default '',
  summary text not null default '',
  outcome text check (outcome in ('WITH_NOTES', 'WITHIN_SCOPE', 'INCONCLUSIVE', 'DECLINED')),
  author_id uuid not null references auth.users(id),
  finalized_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.legal_notes (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.review_reports(id),
  note_no integer not null,
  block_id text,
  quote text,
  title text not null check (length(trim(title)) between 1 and 200),
  finding text not null check (length(trim(finding)) between 1 and 4000),
  severity text not null check (severity in ('INFO', 'MINOR', 'MATERIAL', 'CRITICAL')),
  actionable boolean not null default false,
  recommended_action text,
  rationale text,
  escalation text,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PUBLISHED')),
  unique (report_id, note_no)
);
alter table public.review_reports enable row level security;
alter table public.legal_notes enable row level security;
revoke all on public.review_reports, public.legal_notes from anon, authenticated;

-- Laporan FINAL dan catatan PUBLISHED tidak dapat diubah atau dihapus.
create function public.guard_final_rows() returns trigger language plpgsql as $$
begin
  if tg_table_name = 'review_reports' and old.status = 'FINAL' then
    raise exception 'final report is immutable';
  end if;
  if tg_table_name = 'legal_notes' and old.status = 'PUBLISHED' then
    raise exception 'published note is immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create trigger review_reports_guard before update or delete on public.review_reports for each row execute function public.guard_final_rows();
create trigger legal_notes_guard before update or delete on public.legal_notes for each row execute function public.guard_final_rows();

-- Penugasan aktif + otoritas + bukan pemilik. Selain penugasan aktif (reviewer lain, koordinator, admin, pemilik) → FORBIDDEN.
create function public.assert_active_reviewer(p_reviewer uuid, p_request uuid, p_now timestamptz) returns public.review_requests
language plpgsql security definer set search_path = public as $$
declare v_r public.review_requests%rowtype;
begin
  select r.* into v_r from public.review_requests r where r.id = p_request for update;
  if not found or not exists (select 1 from public.review_assignments a where a.request_id = p_request and a.reviewer_id = p_reviewer and a.status = 'ACTIVE') then
    raise exception 'FORBIDDEN';
  end if;
  if v_r.owner_id = p_reviewer or v_r.firm_id is null or not public.reviewer_has_authority(p_reviewer, v_r.firm_id, p_now) then
    raise exception 'REVIEWER_NOT_AUTHORIZED';
  end if;
  return v_r;
end;
$$;

create function public.assert_version_hash(p_request public.review_requests) returns text
language plpgsql security definer set search_path = public as $$
declare v_text text;
begin
  select v.canonical_text into v_text from public.document_versions v
   where v.id = p_request.version_id and encode(sha256(convert_to(v.canonical_text, 'UTF8')), 'hex') = p_request.version_sha256;
  if not found then
    raise exception 'VERSION_MISMATCH';
  end if;
  return v_text;
end;
$$;

create function public.start_review(p_reviewer uuid, p_request uuid, p_now timestamptz)
returns table (version_text text, title text, category text, revision integer)
language plpgsql security definer set search_path = public as $$
declare v_r public.review_requests%rowtype; v_text text; v_rep public.review_reports%rowtype;
begin
  v_r := public.assert_active_reviewer(p_reviewer, p_request, p_now);
  if v_r.status not in ('ASSIGNED', 'IN_REVIEW') then
    raise exception 'NOT_ASSIGNABLE';
  end if;
  v_text := public.assert_version_hash(v_r);
  update public.review_requests r set status = 'IN_REVIEW' where r.id = p_request;
  insert into public.review_reports (request_id, author_id) values (p_request, p_reviewer) on conflict (request_id) do nothing;
  update public.review_reports rp set author_id = p_reviewer where rp.request_id = p_request and rp.status = 'DRAFT' and rp.author_id <> p_reviewer;
  select rp.* into v_rep from public.review_reports rp where rp.request_id = p_request;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_reviewer, 'review_file_access', 'review_request', p_request::text, '{}'::jsonb);
  return query select v_text, d.title, d.category, v_rep.revision
    from public.document_versions v join public.documents d on d.id = v.document_id where v.id = v_r.version_id;
end;
$$;

create function public.load_draft(p_reviewer uuid, p_request uuid, p_revision integer, p_now timestamptz) returns public.review_reports
language plpgsql security definer set search_path = public as $$
declare v_rep public.review_reports%rowtype;
begin
  perform public.assert_active_reviewer(p_reviewer, p_request, p_now);
  select rp.* into v_rep from public.review_reports rp where rp.request_id = p_request for update;
  if not found or v_rep.status <> 'DRAFT' then
    raise exception 'FORBIDDEN';
  end if;
  if v_rep.revision <> p_revision then
    raise exception 'STALE_REVISION';
  end if;
  return v_rep;
end;
$$;

create function public.save_report_draft(p_reviewer uuid, p_request uuid, p_revision integer, p_scope text, p_assumptions text, p_summary text, p_now timestamptz)
returns integer language plpgsql security definer set search_path = public as $$
declare v_rep public.review_reports%rowtype;
begin
  v_rep := public.load_draft(p_reviewer, p_request, p_revision, p_now);
  update public.review_reports rp
     set scope = left(coalesce(p_scope, ''), 4000), assumptions = left(coalesce(p_assumptions, ''), 4000),
         summary = left(coalesce(p_summary, ''), 8000), revision = rp.revision + 1, author_id = p_reviewer
   where rp.id = v_rep.id;
  return v_rep.revision + 1;
end;
$$;

create function public.upsert_note(p_reviewer uuid, p_request uuid, p_revision integer, p_note jsonb, p_now timestamptz)
returns table (revision integer, note_no integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_rep public.review_reports%rowtype; v_no integer;
begin
  v_rep := public.load_draft(p_reviewer, p_request, p_revision, p_now);
  v_no := (p_note ->> 'note_no')::integer;
  if v_no is null then
    select coalesce(max(n.note_no), 0) + 1 into v_no from public.legal_notes n where n.report_id = v_rep.id;
  end if;
  insert into public.legal_notes (report_id, note_no, block_id, quote, title, finding, severity, actionable, recommended_action, rationale, escalation)
  values (v_rep.id, v_no, p_note ->> 'block_id', left(p_note ->> 'quote', 1000), p_note ->> 'title', p_note ->> 'finding',
          p_note ->> 'severity', coalesce((p_note ->> 'actionable')::boolean, false),
          nullif(trim(p_note ->> 'recommended_action'), ''), nullif(trim(p_note ->> 'rationale'), ''), nullif(trim(p_note ->> 'escalation'), ''))
  on conflict (report_id, note_no) do update
     set block_id = excluded.block_id, quote = excluded.quote, title = excluded.title, finding = excluded.finding, severity = excluded.severity,
         actionable = excluded.actionable, recommended_action = excluded.recommended_action, rationale = excluded.rationale, escalation = excluded.escalation;
  update public.review_reports rp set revision = rp.revision + 1, author_id = p_reviewer where rp.id = v_rep.id;
  return query select v_rep.revision + 1, v_no;
end;
$$;

create function public.delete_note(p_reviewer uuid, p_request uuid, p_revision integer, p_note_no integer, p_now timestamptz)
returns integer language plpgsql security definer set search_path = public as $$
declare v_rep public.review_reports%rowtype;
begin
  v_rep := public.load_draft(p_reviewer, p_request, p_revision, p_now);
  delete from public.legal_notes n where n.report_id = v_rep.id and n.note_no = p_note_no;
  update public.review_reports rp set revision = rp.revision + 1 where rp.id = v_rep.id;
  return v_rep.revision + 1;
end;
$$;

-- Penyelesaian atomik: validasi → laporan FINAL → catatan PUBLISHED → verifikasi → permintaan selesai → audit → outbox.
create function public.publish_standard(p_reviewer uuid, p_request uuid, p_revision integer, p_outcome text, p_no_notes_declared boolean, p_attest boolean, p_now timestamptz)
returns table (status text, verification_id uuid, code text)
language plpgsql security definer set search_path = public as $$
declare
  v_r public.review_requests%rowtype; v_rep public.review_reports%rowtype; v_ver public.document_versions%rowtype;
  v_notes integer; v_vid uuid; v_code text; v_email text; v_existing public.document_verifications%rowtype;
begin
  select r.* into v_r from public.review_requests r where r.id = p_request for update;
  select rp.* into v_rep from public.review_reports rp where rp.request_id = p_request for update;
  if found and v_rep.status = 'FINAL' then
    -- Panggilan ulang oleh penerbit yang sama dengan revisi yang sama mengembalikan hasil yang sama (idempoten).
    if v_rep.author_id <> p_reviewer then
      raise exception 'FORBIDDEN';
    end if;
    if v_rep.revision <> p_revision then
      raise exception 'STALE_REVISION';
    end if;
    select dv.* into v_existing from public.document_verifications dv where dv.request_id = p_request and dv.kind = 'LEGAL';
    return query select v_rep.outcome, v_existing.id, v_existing.code;
    return;
  end if;
  v_r := public.assert_active_reviewer(p_reviewer, p_request, p_now);
  if not found or v_r.status <> 'IN_REVIEW' then
    raise exception 'FORBIDDEN';
  end if;
  if not coalesce(p_attest, false) then
    raise exception 'ATTESTATION_REQUIRED';
  end if;
  if p_outcome not in ('WITH_NOTES', 'WITHIN_SCOPE', 'INCONCLUSIVE', 'DECLINED') then
    raise exception 'VALIDATION_FAILED: INVALID_OUTCOME';
  end if;
  perform public.assert_version_hash(v_r);
  if v_rep.revision <> p_revision then
    raise exception 'STALE_REVISION';
  end if;
  if length(trim(v_rep.scope)) = 0 then
    raise exception 'VALIDATION_FAILED: SCOPE_REQUIRED';
  end if;
  select count(*) into v_notes from public.legal_notes n where n.report_id = v_rep.id;

  if p_outcome = 'WITH_NOTES' then
    if v_notes < 1 then
      raise exception 'VALIDATION_FAILED: NOTES_REQUIRED';
    end if;
    if exists (select 1 from public.legal_notes n where n.report_id = v_rep.id and n.actionable and n.recommended_action is null) then
      raise exception 'VALIDATION_FAILED: NOTE_ACTION_REQUIRED';
    end if;
    if exists (select 1 from public.legal_notes n where n.report_id = v_rep.id and n.severity in ('MATERIAL', 'CRITICAL')
                and (n.recommended_action is null or n.rationale is null or n.escalation is null)) then
      raise exception 'VALIDATION_FAILED: NOTE_RATIONALE_REQUIRED';
    end if;
  elsif p_outcome = 'WITHIN_SCOPE' then
    if v_notes > 0 then
      raise exception 'VALIDATION_FAILED: NOTES_PRESENT';
    end if;
    if not coalesce(p_no_notes_declared, false) then
      raise exception 'VALIDATION_FAILED: NO_NOTES_DECLARATION_REQUIRED';
    end if;
  elsif length(trim(v_rep.summary)) = 0 then
    raise exception 'VALIDATION_FAILED: SUMMARY_REQUIRED';
  end if;

  if p_outcome in ('WITH_NOTES', 'WITHIN_SCOPE') then
    select v.* into v_ver from public.document_versions v where v.id = v_r.version_id;
    v_code := public.new_verification_code();
    insert into public.document_verifications (kind, version_id, sha256, outcome, scope_summary, issuer, policy_version, code, request_id, issued_at)
    values ('LEGAL', v_ver.id, v_ver.sha256, p_outcome, left(v_rep.scope, 500),
            jsonb_build_object('firm_id', v_r.firm_id, 'reviewer_id', p_reviewer),
            'v8', v_code, p_request, p_now)
    returning id into v_vid;
  end if;

  update public.review_reports rp set status = 'FINAL', outcome = p_outcome, finalized_at = p_now, author_id = p_reviewer where rp.id = v_rep.id;
  update public.legal_notes n set status = 'PUBLISHED' where n.report_id = v_rep.id;
  update public.review_requests r
     set status = case when p_outcome = 'DECLINED' then 'DECLINED' else 'COMPLETED' end, outcome = p_outcome, completed_at = p_now
   where r.id = p_request;
  update public.review_assignments a set status = 'ENDED', ended_at = p_now where a.request_id = p_request and a.status = 'ACTIVE';
  if p_outcome = 'DECLINED' then
    -- Pemeriksaan ditolak: pemilik tidak membayar dua kali. Order dibatalkan dan diganti satu kredit review (kebijakan refund masih UNKNOWN).
    update public.orders o set status = 'CANCELLED' where o.id = v_r.order_id;
    insert into public.review_credits (user_id, order_id, expires_at, status)
    values (v_r.owner_id, v_r.order_id, p_now + interval '90 days', 'AVAILABLE');
  end if;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_reviewer, 'review_completed', 'review_request', p_request::text, jsonb_build_object('outcome', p_outcome, 'verification_id', v_vid));
  select u.email into v_email from auth.users u where u.id = v_r.owner_id;
  if v_email is not null then
    perform public.enqueue_outbox('review_completed', jsonb_build_object('to', v_email), 'review_completed:' || p_request::text, p_now);
  end if;
  return query select p_outcome, v_vid, v_code;
end;
$$;

-- Pemilik hanya melihat laporan FINAL dan catatan PUBLISHED.
create function public.get_review_for_owner(p_user uuid, p_request uuid)
returns table (request_id uuid, version_id uuid, status text, outcome text, created_at timestamptz, completed_at timestamptz,
               scope text, assumptions text, summary text, notes jsonb, verification_id uuid, verification_code text, verification_status text)
language sql stable security definer set search_path = public as $$
  select r.id, r.version_id, r.status, r.outcome, r.created_at, r.completed_at,
         case when rp.status = 'FINAL' then rp.scope end, case when rp.status = 'FINAL' then rp.assumptions end,
         case when rp.status = 'FINAL' then rp.summary end,
         coalesce((select jsonb_agg(jsonb_build_object('note_no', n.note_no, 'block_id', n.block_id, 'quote', n.quote, 'title', n.title,
                    'finding', n.finding, 'severity', n.severity, 'actionable', n.actionable, 'recommended_action', n.recommended_action,
                    'rationale', n.rationale, 'escalation', n.escalation) order by n.note_no)
                     from public.legal_notes n where n.report_id = rp.id and n.status = 'PUBLISHED'), '[]'::jsonb),
         dv.id, dv.code, dv.status
    from public.review_requests r
    left join public.review_reports rp on rp.request_id = r.id
    left join public.document_verifications dv on dv.request_id = r.id and dv.kind = 'LEGAL'
   where r.id = p_request and r.owner_id = p_user;
$$;

revoke execute on function
  public.guard_final_rows(), public.assert_active_reviewer(uuid, uuid, timestamptz), public.assert_version_hash(public.review_requests),
  public.start_review(uuid, uuid, timestamptz), public.load_draft(uuid, uuid, integer, timestamptz),
  public.save_report_draft(uuid, uuid, integer, text, text, text, timestamptz), public.upsert_note(uuid, uuid, integer, jsonb, timestamptz),
  public.delete_note(uuid, uuid, integer, integer, timestamptz),
  public.publish_standard(uuid, uuid, integer, text, boolean, boolean, timestamptz), public.get_review_for_owner(uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  public.assert_active_reviewer(uuid, uuid, timestamptz), public.assert_version_hash(public.review_requests),
  public.start_review(uuid, uuid, timestamptz), public.load_draft(uuid, uuid, integer, timestamptz),
  public.save_report_draft(uuid, uuid, integer, text, text, text, timestamptz), public.upsert_note(uuid, uuid, integer, jsonb, timestamptz),
  public.delete_note(uuid, uuid, integer, integer, timestamptz),
  public.publish_standard(uuid, uuid, integer, text, boolean, boolean, timestamptz), public.get_review_for_owner(uuid, uuid)
  to service_role;
