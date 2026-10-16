-- Penguatan Fase 4 setelah review: alasan ketidaklayakan yang benar, revive order tidak melanggar keunikan, catatan material non-aktionabel
-- wajib punya disposisi, dan deep yang ditahan tidak membuntukan pemilik.

create or replace function public.deep_eligibility(p_user uuid, p_parent uuid, p_now timestamptz, p_exclude_order uuid default null)
returns table (eligible boolean, reason text)
language plpgsql security definer set search_path = public as $$
declare v_r public.review_requests%rowtype;
begin
  select r.* into v_r from public.review_requests r where r.id = p_parent and r.owner_id = p_user;
  if not found then
    return query select false, 'NOT_FOUND'::text;
    return;
  end if;
  if v_r.status <> 'COMPLETED' then
    return query select false, 'PARENT_NOT_COMPLETED'::text;
    return;
  end if;
  -- Selesai tetapi tanpa Legal Note (WITHIN_SCOPE/INCONCLUSIVE): tidak ada yang perlu didalami.
  if v_r.outcome is distinct from 'WITH_NOTES' then
    return query select false, 'NO_ACTIONABLE_NOTES'::text;
    return;
  end if;
  if not exists (select 1 from public.document_verifications dv where dv.request_id = p_parent and dv.kind = 'LEGAL' and dv.status = 'ACTIVE') then
    return query select false, 'PARENT_NOT_ACTIVE'::text;
    return;
  end if;
  if not exists (select 1 from public.legal_notes n join public.review_reports rp on rp.id = n.report_id
                  where rp.request_id = p_parent and rp.status = 'FINAL' and n.status = 'PUBLISHED' and n.actionable and n.severity <> 'INFO') then
    return query select false, 'NO_ACTIONABLE_NOTES'::text;
    return;
  end if;
  if not exists (select 1 from public.document_versions v where v.id = v_r.version_id
                  and encode(sha256(convert_to(v.canonical_text, 'UTF8')), 'hex') = v_r.version_sha256) then
    return query select false, 'VERSION_MISMATCH'::text;
    return;
  end if;
  if exists (select 1 from public.deep_requests d where d.parent_request_id = p_parent and d.status in ('QUEUED', 'IN_REVIEW', 'READY_FOR_DECISION', 'COMPLETED', 'ON_HOLD'))
     or exists (select 1 from public.orders o where o.kind = 'DEEP_REVIEW' and o.ref_id = p_parent and o.status in ('PENDING_PAYMENT', 'PAID')
                 and (p_exclude_order is null or o.id <> p_exclude_order)) then
    return query select false, 'DEEP_EXISTS'::text;
    return;
  end if;
  return query select true, 'OK'::text;
end;
$$;

create or replace function public.revive_expired_order(p_order uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_e public.review_discount_entitlements%rowtype;
begin
  select o.* into v_o from public.orders o where o.id = p_order for update;
  if not found or v_o.status <> 'EXPIRED' then
    return false;
  end if;
  if v_o.kind in ('STANDARD_REVIEW', 'DEEP_REVIEW') and exists (select 1 from public.orders x where x.ref_id = v_o.ref_id and x.kind = v_o.kind
       and x.id <> v_o.id and x.status in ('PENDING_PAYMENT', 'PAID')) then
    return false;
  end if;
  select e.* into v_e from public.review_discount_entitlements e where e.order_id = p_order;
  if found and v_e.status = 'RELEASED' then
    if exists (select 1 from public.review_discount_entitlements x where x.membership_id = v_e.membership_id and x.status in ('RESERVED', 'CONSUMED')) then
      return false;
    end if;
    update public.review_discount_entitlements e set status = 'RESERVED' where e.id = v_e.id;
  end if;
  update public.orders o set status = 'PENDING_PAYMENT' where o.id = p_order;
  return true;
end;
$$;

create or replace function public.decide_deep(p_reviewer uuid, p_deep uuid, p_revision integer, p_decision text, p_reason text, p_attest boolean, p_now timestamptz)
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
                where rp.request_id = v_d.parent_request_id and n.status = 'PUBLISHED' and (n.actionable or n.severity in ('MATERIAL', 'CRITICAL'))
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

create or replace function public.revoke_verification(p_actor uuid, p_id uuid, p_reason text, p_private text, p_now timestamptz) returns void
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
  -- Ketergantungan induk: Enhanced turunan ditangguhkan dan deep yang belum selesai ditahan. Enhanced yang dicabut tidak mencabut induk.
  update public.document_verifications dv set status = 'SUSPENDED' where dv.parent_verification_id = p_id and dv.status = 'ACTIVE';
  if v.kind = 'LEGAL' and v.request_id is not null then
    -- Pekerjaan ditahan tanpa membuntukan pemilik: penugasan berakhir (kapasitas bebas), pembayaran dan order masuk rekonsiliasi.
    with held as (
      update public.deep_requests d set status = 'ON_HOLD'
       where d.parent_request_id = v.request_id and d.status in ('QUEUED', 'IN_REVIEW', 'READY_FOR_DECISION')
      returning d.id, d.order_id
    ), ended as (
      update public.deep_assignments a set status = 'ENDED', ended_at = p_now from held where a.deep_id = held.id and a.status = 'ACTIVE'
    ), ords as (
      update public.orders o set status = 'RECONCILIATION_REQUIRED' from held where o.id = held.order_id
    )
    update public.payments p set status = 'DISPUTED' from held where p.order_id = held.order_id and p.status = 'VERIFIED';
  end if;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_actor, 'verification_revoked', 'document_verification', p_id::text, jsonb_build_object('reason_code', p_reason));
end;
$$;
