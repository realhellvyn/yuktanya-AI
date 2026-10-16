-- Laporan deep, checklist material M1–M7, disposisi catatan induk, dan keputusan akhir. Enhanced hanya lewat decide_deep.

create table public.rubric_approvals (
  policy_version text primary key,
  signoff_ref text not null check (length(trim(signoff_ref)) >= 3),
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null
);
alter table public.rubric_approvals enable row level security;
revoke all on public.rubric_approvals from anon, authenticated;

create table public.deep_reports (
  id uuid primary key default gen_random_uuid(),
  deep_id uuid not null unique references public.deep_requests(id),
  revision integer not null default 0,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'FINAL')),
  extra_work text not null default '',
  summary text not null default '',
  decision text check (decision in ('APPROVE', 'DENY', 'INCONCLUSIVE', 'REFER_SPECIAL')),
  decision_reason text,
  author_id uuid not null references auth.users(id),
  finalized_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.deep_dispositions (
  report_id uuid not null references public.deep_reports(id),
  parent_note_no integer not null,
  disposition text not null check (disposition in ('RESOLVED', 'ACCEPTED_RISK', 'UNRESOLVED', 'OUT_OF_SCOPE')),
  evidence text not null default '',
  primary key (report_id, parent_note_no)
);
create table public.deep_checklist (
  report_id uuid not null references public.deep_reports(id),
  item text not null check (item in ('M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7')),
  result text not null check (result in ('PASS', 'FAIL', 'UNKNOWN', 'N_A')),
  reasoning text not null default '',
  evidence_ref text not null default '',
  policy_version text not null,
  assessed_at timestamptz not null,
  primary key (report_id, item)
);
alter table public.deep_reports enable row level security;
alter table public.deep_dispositions enable row level security;
alter table public.deep_checklist enable row level security;
revoke all on public.deep_reports, public.deep_dispositions, public.deep_checklist from anon, authenticated;

create function public.guard_deep_final() returns trigger language plpgsql as $$
declare v_status text;
begin
  if tg_table_name = 'deep_reports' then
    if old.status = 'FINAL' then
      raise exception 'final deep report is immutable';
    end if;
  else
    select rp.status into v_status from public.deep_reports rp where rp.id = coalesce(old.report_id, new.report_id);
    if v_status = 'FINAL' then
      raise exception 'final deep report is immutable';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create trigger deep_reports_guard before update or delete on public.deep_reports for each row execute function public.guard_deep_final();
create trigger deep_dispositions_guard before update or delete on public.deep_dispositions for each row execute function public.guard_deep_final();
create trigger deep_checklist_guard before update or delete on public.deep_checklist for each row execute function public.guard_deep_final();

create function public.admin_approve_rubric(p_admin uuid, p_version text, p_signoff_ref text, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin(p_admin) then
    raise exception 'FORBIDDEN';
  end if;
  if p_signoff_ref is null or length(trim(p_signoff_ref)) < 3 then
    raise exception 'SIGNOFF_REQUIRED';
  end if;
  insert into public.rubric_approvals (policy_version, signoff_ref, approved_by, approved_at)
  values (p_version, left(trim(p_signoff_ref), 200), p_admin, p_now) on conflict (policy_version) do nothing;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_admin, 'rubric_approved', 'rubric', p_version, '{}'::jsonb);
end;
$$;

-- Penugasan aktif + otoritas + bukan pemilik. Selain penugasan aktif → FORBIDDEN.
create function public.assert_active_deep_reviewer(p_reviewer uuid, p_deep uuid, p_now timestamptz) returns public.deep_requests
language plpgsql security definer set search_path = public as $$
declare v_d public.deep_requests%rowtype;
begin
  select d.* into v_d from public.deep_requests d where d.id = p_deep for update;
  if not found or not exists (select 1 from public.deep_assignments a where a.deep_id = p_deep and a.reviewer_id = p_reviewer and a.status = 'ACTIVE') then
    raise exception 'FORBIDDEN';
  end if;
  if v_d.owner_id = p_reviewer or v_d.firm_id is null or not public.reviewer_has_authority(p_reviewer, v_d.firm_id, p_now) then
    raise exception 'REVIEWER_NOT_AUTHORIZED';
  end if;
  return v_d;
end;
$$;

create function public.assert_deep_hash(p_deep public.deep_requests) returns text
language plpgsql security definer set search_path = public as $$
declare v_text text;
begin
  select v.canonical_text into v_text from public.document_versions v
   where v.id = p_deep.version_id and encode(sha256(convert_to(v.canonical_text, 'UTF8')), 'hex') = p_deep.version_sha256;
  if not found then
    raise exception 'VERSION_MISMATCH';
  end if;
  return v_text;
end;
$$;

create function public.start_deep(p_reviewer uuid, p_deep uuid, p_now timestamptz)
returns table (version_text text, title text, category text, revision integer, parent_notes jsonb)
language plpgsql security definer set search_path = public as $$
declare v_d public.deep_requests%rowtype; v_text text; v_rep public.deep_reports%rowtype;
begin
  v_d := public.assert_active_deep_reviewer(p_reviewer, p_deep, p_now);
  if v_d.status not in ('QUEUED', 'IN_REVIEW') then
    raise exception 'NOT_ASSIGNABLE';
  end if;
  v_text := public.assert_deep_hash(v_d);
  update public.deep_requests d set status = 'IN_REVIEW' where d.id = p_deep;
  insert into public.deep_reports (deep_id, author_id) values (p_deep, p_reviewer) on conflict (deep_id) do nothing;
  update public.deep_reports rp set author_id = p_reviewer where rp.deep_id = p_deep and rp.status = 'DRAFT' and rp.author_id <> p_reviewer;
  select rp.* into v_rep from public.deep_reports rp where rp.deep_id = p_deep;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_reviewer, 'deep_file_access', 'deep_request', p_deep::text, '{}'::jsonb);
  return query select v_text, doc.title, doc.category, v_rep.revision,
    coalesce((select jsonb_agg(jsonb_build_object('note_no', n.note_no, 'title', n.title, 'finding', n.finding, 'severity', n.severity,
                'actionable', n.actionable, 'recommended_action', n.recommended_action) order by n.note_no)
                from public.legal_notes n join public.review_reports rp on rp.id = n.report_id
               where rp.request_id = v_d.parent_request_id and n.status = 'PUBLISHED'), '[]'::jsonb)
    from public.document_versions v join public.documents doc on doc.id = v.document_id where v.id = v_d.version_id;
end;
$$;

create function public.load_deep_draft(p_reviewer uuid, p_deep uuid, p_revision integer, p_now timestamptz) returns public.deep_reports
language plpgsql security definer set search_path = public as $$
declare v_d public.deep_requests%rowtype; v_rep public.deep_reports%rowtype;
begin
  v_d := public.assert_active_deep_reviewer(p_reviewer, p_deep, p_now);
  select rp.* into v_rep from public.deep_reports rp where rp.deep_id = p_deep for update;
  if not found or v_rep.status <> 'DRAFT' or v_d.status <> 'IN_REVIEW' then
    raise exception 'FORBIDDEN';
  end if;
  if v_rep.revision <> p_revision then
    raise exception 'STALE_REVISION';
  end if;
  return v_rep;
end;
$$;

create function public.save_deep_draft(p_reviewer uuid, p_deep uuid, p_revision integer, p_extra_work text, p_summary text, p_now timestamptz) returns integer
language plpgsql security definer set search_path = public as $$
declare v_rep public.deep_reports%rowtype;
begin
  v_rep := public.load_deep_draft(p_reviewer, p_deep, p_revision, p_now);
  update public.deep_reports rp
     set extra_work = left(coalesce(p_extra_work, ''), 8000), summary = left(coalesce(p_summary, ''), 8000), revision = rp.revision + 1, author_id = p_reviewer
   where rp.id = v_rep.id;
  return v_rep.revision + 1;
end;
$$;

create function public.set_disposition(p_reviewer uuid, p_deep uuid, p_revision integer, p_note_no integer, p_disposition text, p_evidence text, p_now timestamptz) returns integer
language plpgsql security definer set search_path = public as $$
declare v_rep public.deep_reports%rowtype; v_parent uuid;
begin
  v_rep := public.load_deep_draft(p_reviewer, p_deep, p_revision, p_now);
  select d.parent_request_id into v_parent from public.deep_requests d where d.id = p_deep;
  if not exists (select 1 from public.legal_notes n join public.review_reports rp on rp.id = n.report_id
                  where rp.request_id = v_parent and n.note_no = p_note_no and n.status = 'PUBLISHED') then
    raise exception 'NOT_FOUND';
  end if;
  insert into public.deep_dispositions (report_id, parent_note_no, disposition, evidence)
  values (v_rep.id, p_note_no, p_disposition, left(coalesce(p_evidence, ''), 4000))
  on conflict (report_id, parent_note_no) do update set disposition = excluded.disposition, evidence = excluded.evidence;
  update public.deep_reports rp set revision = rp.revision + 1, author_id = p_reviewer where rp.id = v_rep.id;
  return v_rep.revision + 1;
end;
$$;

create function public.set_checklist(p_reviewer uuid, p_deep uuid, p_revision integer, p_item text, p_result text, p_reasoning text, p_evidence text, p_now timestamptz) returns integer
language plpgsql security definer set search_path = public as $$
declare v_rep public.deep_reports%rowtype;
begin
  v_rep := public.load_deep_draft(p_reviewer, p_deep, p_revision, p_now);
  if p_result = 'N_A' and p_item in ('M4', 'M6', 'M7') then
    raise exception 'MANDATORY_ITEM';
  end if;
  insert into public.deep_checklist (report_id, item, result, reasoning, evidence_ref, policy_version, assessed_at)
  values (v_rep.id, p_item, p_result, left(coalesce(p_reasoning, ''), 4000), left(coalesce(p_evidence, ''), 4000), 'v8-proposed', p_now)
  on conflict (report_id, item) do update
     set result = excluded.result, reasoning = excluded.reasoning, evidence_ref = excluded.evidence_ref, assessed_at = excluded.assessed_at;
  update public.deep_reports rp set revision = rp.revision + 1, author_id = p_reviewer where rp.id = v_rep.id;
  return v_rep.revision + 1;
end;
$$;

create function public.decide_deep(p_reviewer uuid, p_deep uuid, p_revision integer, p_decision text, p_reason text, p_attest boolean, p_now timestamptz)
returns table (outcome text, verification_id uuid, code text)
language plpgsql security definer set search_path = public as $$
declare
  v_d public.deep_requests%rowtype; v_rep public.deep_reports%rowtype; v_parent public.document_verifications%rowtype;
  v_outcome text; v_vid uuid; v_code text; v_auth record; v_email text; v_existing public.document_verifications%rowtype;
begin
  select d.* into v_d from public.deep_requests d where d.id = p_deep for update;
  select rp.* into v_rep from public.deep_reports rp where rp.deep_id = p_deep for update;
  if found and v_rep.status = 'FINAL' then
    -- Panggilan ulang oleh pemutus yang sama dengan revisi yang sama mengembalikan hasil yang sama.
    if v_rep.author_id <> p_reviewer then
      raise exception 'FORBIDDEN';
    end if;
    if v_rep.revision <> p_revision then
      raise exception 'STALE_REVISION';
    end if;
    select dv.* into v_existing from public.document_verifications dv
     where dv.kind = 'LEGAL_ENHANCED' and dv.parent_verification_id in (select x.id from public.document_verifications x where x.request_id = v_d.parent_request_id and x.kind = 'LEGAL');
    return query select v_d.outcome, v_existing.id, v_existing.code;
    return;
  end if;
  v_d := public.assert_active_deep_reviewer(p_reviewer, p_deep, p_now);
  if v_d.status = 'ON_HOLD' then
    raise exception 'GUARD_FAILED: REVOKED_PARENT';
  end if;
  if v_rep.id is null or v_d.status <> 'IN_REVIEW' then
    raise exception 'FORBIDDEN';
  end if;
  if not coalesce(p_attest, false) then
    raise exception 'ATTESTATION_REQUIRED';
  end if;
  if p_decision not in ('APPROVE', 'DENY', 'INCONCLUSIVE', 'REFER_SPECIAL') then
    raise exception 'INVALID_DECISION';
  end if;
  perform public.assert_deep_hash(v_d);
  if v_rep.revision <> p_revision then
    raise exception 'STALE_REVISION';
  end if;
  if p_decision <> 'APPROVE' and (p_reason is null or length(trim(p_reason)) < 5) then
    raise exception 'REASON_REQUIRED';
  end if;

  if p_decision = 'APPROVE' then
    select dv.* into v_parent from public.document_verifications dv where dv.request_id = v_d.parent_request_id and dv.kind = 'LEGAL';
    if not found or v_parent.status <> 'ACTIVE' then
      raise exception 'GUARD_FAILED: REVOKED_PARENT';
    end if;
    if not exists (select 1 from public.payments p where p.order_id = v_d.order_id and p.status = 'VERIFIED')
       or not exists (select 1 from public.orders o where o.id = v_d.order_id and o.status = 'PAID') then
      raise exception 'GUARD_FAILED: PAYMENT_NOT_VERIFIED';
    end if;
    if length(trim(v_rep.extra_work)) = 0 then
      raise exception 'GUARD_FAILED: NO_EXTRA_WORK';
    end if;
    if not exists (select 1 from public.rubric_approvals ra where ra.policy_version = 'v8-proposed') then
      raise exception 'GUARD_FAILED: UNAPPROVED_RUBRIC';
    end if;
    if (select count(*) from public.deep_checklist c where c.report_id = v_rep.id) <> 7 then
      raise exception 'GUARD_FAILED: CHECKLIST_INCOMPLETE';
    end if;
    if exists (select 1 from public.deep_checklist c where c.report_id = v_rep.id and c.result = 'FAIL') then
      raise exception 'GUARD_FAILED: MATERIAL_FAIL';
    end if;
    if exists (select 1 from public.deep_checklist c where c.report_id = v_rep.id and c.result = 'UNKNOWN') then
      raise exception 'GUARD_FAILED: MATERIAL_UNKNOWN';
    end if;
    if exists (select 1 from public.deep_checklist c where c.report_id = v_rep.id
                and ((c.result = 'PASS' and length(trim(c.evidence_ref)) = 0) or (c.result = 'N_A' and length(trim(c.reasoning)) = 0))) then
      raise exception 'GUARD_FAILED: MISSING_EVIDENCE';
    end if;
    if exists (select 1 from public.legal_notes n join public.review_reports rp on rp.id = n.report_id
                where rp.request_id = v_d.parent_request_id and n.status = 'PUBLISHED' and n.actionable
                  and not exists (select 1 from public.deep_dispositions x where x.report_id = v_rep.id and x.parent_note_no = n.note_no)) then
      raise exception 'GUARD_FAILED: DISPOSITION_MISSING';
    end if;
    if exists (select 1 from public.legal_notes n join public.review_reports rp on rp.id = n.report_id
                join public.deep_dispositions x on x.report_id = v_rep.id and x.parent_note_no = n.note_no
                where rp.request_id = v_d.parent_request_id and n.status = 'PUBLISHED' and n.severity in ('MATERIAL', 'CRITICAL')
                  and x.disposition <> 'RESOLVED') then
      raise exception 'GUARD_FAILED: UNRESOLVED_MATERIAL_NOTE';
    end if;
    if exists (select 1 from public.deep_dispositions x where x.report_id = v_rep.id and x.disposition in ('RESOLVED', 'ACCEPTED_RISK') and length(trim(x.evidence)) = 0) then
      raise exception 'GUARD_FAILED: MISSING_EVIDENCE';
    end if;

    select a.* into v_auth from public.professional_authorizations a
     where a.user_id = p_reviewer and a.firm_id = v_d.firm_id and a.revoked_at is null
       and (p_now at time zone 'Asia/Jakarta')::date between a.valid_from and a.valid_to
     order by a.created_at desc limit 1;
    v_code := public.new_verification_code();
    insert into public.document_verifications (kind, version_id, sha256, outcome, scope_summary, issuer, policy_version, code, request_id, parent_verification_id, issued_at)
    values ('LEGAL_ENHANCED', v_d.version_id, v_d.version_sha256, 'ENHANCED_APPROVED', left(coalesce(v_parent.scope_summary, '') || ' (pemeriksaan tambahan)', 500),
            jsonb_build_object('firm_id', v_d.firm_id, 'reviewer_id', p_reviewer, 'authorization_id', v_auth.id, 'scope_note', v_auth.scope_note,
                               'valid_from', v_auth.valid_from, 'valid_to', v_auth.valid_to, 'attested', true, 'attested_at', p_now,
                               'deep_id', p_deep, 'rubric_version', 'v8-proposed'),
            'v8', v_code, v_d.parent_request_id, v_parent.id, p_now)
    returning id into v_vid;
  end if;

  v_outcome := case p_decision when 'APPROVE' then 'ENHANCED_APPROVED' when 'DENY' then 'COMPLETED_WITH_NOTES'
                               when 'INCONCLUSIVE' then 'INCONCLUSIVE' else 'REFERRED_SPECIAL_CASE' end;
  update public.deep_reports rp
     set status = 'FINAL', decision = p_decision, decision_reason = left(p_reason, 2000), finalized_at = p_now, author_id = p_reviewer
   where rp.id = v_rep.id;
  update public.deep_requests d set status = 'COMPLETED', outcome = v_outcome, completed_at = p_now where d.id = p_deep;
  update public.deep_assignments a set status = 'ENDED', ended_at = p_now where a.deep_id = p_deep and a.status = 'ACTIVE';
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_reviewer, 'deep_decided', 'deep_request', p_deep::text, jsonb_build_object('decision', p_decision, 'outcome', v_outcome, 'verification_id', v_vid));
  select u.email into v_email from auth.users u where u.id = v_d.owner_id;
  if v_email is not null then
    perform public.enqueue_outbox('review_completed', jsonb_build_object('to', v_email), 'deep_completed:' || p_deep::text, p_now);
  end if;
  return query select v_outcome, v_vid, v_code;
end;
$$;

-- Pemilik hanya melihat laporan FINAL; draf checklist dan catatan kerja tidak pernah terlihat.
create function public.get_deep_for_owner(p_user uuid, p_deep uuid)
returns table (deep_id uuid, parent_request_id uuid, version_id uuid, status text, outcome text, created_at timestamptz, completed_at timestamptz,
               extra_work text, summary text, decision text, decision_reason text, dispositions jsonb, verification_code text, verification_status text)
language sql stable security definer set search_path = public as $$
  select d.id, d.parent_request_id, d.version_id, d.status, d.outcome, d.created_at, d.completed_at,
         case when rp.status = 'FINAL' then rp.extra_work end, case when rp.status = 'FINAL' then rp.summary end,
         case when rp.status = 'FINAL' then rp.decision end, case when rp.status = 'FINAL' then rp.decision_reason end,
         case when rp.status = 'FINAL' then coalesce((select jsonb_agg(jsonb_build_object('note_no', x.parent_note_no, 'disposition', x.disposition, 'evidence', x.evidence) order by x.parent_note_no)
                                                         from public.deep_dispositions x where x.report_id = rp.id), '[]'::jsonb) else '[]'::jsonb end,
         dv.code, dv.status
    from public.deep_requests d
    left join public.deep_reports rp on rp.deep_id = d.id
    left join public.document_verifications dv on dv.kind = 'LEGAL_ENHANCED' and dv.request_id = d.parent_request_id and rp.status = 'FINAL'
   where d.id = p_deep and d.owner_id = p_user;
$$;

revoke execute on function
  public.guard_deep_final(), public.admin_approve_rubric(uuid, text, text, timestamptz), public.assert_active_deep_reviewer(uuid, uuid, timestamptz),
  public.assert_deep_hash(public.deep_requests), public.start_deep(uuid, uuid, timestamptz), public.load_deep_draft(uuid, uuid, integer, timestamptz),
  public.save_deep_draft(uuid, uuid, integer, text, text, timestamptz), public.set_disposition(uuid, uuid, integer, integer, text, text, timestamptz),
  public.set_checklist(uuid, uuid, integer, text, text, text, text, timestamptz),
  public.decide_deep(uuid, uuid, integer, text, text, boolean, timestamptz), public.get_deep_for_owner(uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  public.admin_approve_rubric(uuid, text, text, timestamptz), public.assert_active_deep_reviewer(uuid, uuid, timestamptz),
  public.assert_deep_hash(public.deep_requests), public.start_deep(uuid, uuid, timestamptz), public.load_deep_draft(uuid, uuid, integer, timestamptz),
  public.save_deep_draft(uuid, uuid, integer, text, text, timestamptz), public.set_disposition(uuid, uuid, integer, integer, text, text, timestamptz),
  public.set_checklist(uuid, uuid, integer, text, text, text, text, timestamptz),
  public.decide_deep(uuid, uuid, integer, text, text, boolean, timestamptz), public.get_deep_for_owner(uuid, uuid)
  to service_role;
