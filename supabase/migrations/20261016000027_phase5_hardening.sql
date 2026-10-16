-- Penguatan Fase 5 setelah review: angka pendapatan jujur, usia antrean dari sekarang, member aktif tak bergantung pembayaran,
-- urutan kunci keputusan/pencabutan, status publik Enhanced mengikuti induk, dan admin tidak dapat menjadikan admin lain reviewer.

create or replace function public.admin_overview(p_admin uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_ai_any boolean; v_ai_req bigint; v_ai_ok bigint; v_ai_fail bigint; v_p50 numeric; v_p95 numeric;
  v_rev jsonb; v_collected bigint; v_refunds bigint; v_fees bigint; v_pay_n bigint; v_refund_n bigint;
  v_sla50 numeric; v_sla95 numeric; v_completed bigint;
  v_registered bigint; v_new bigint; v_activated bigint;
  v_cohort uuid[]; v_held bigint; v_now timestamptz := least(p_to, now());
begin
  if not public.is_platform_admin(p_admin) then
    raise exception 'FORBIDDEN';
  end if;

  -- AI: dari product_events (latensi ms; tanpa prompt). Tanpa satu pun event AI → null.
  select exists (select 1 from public.product_events e where e.event_name in ('ai_request_succeeded', 'ai_request_failed')) into v_ai_any;
  select count(*) filter (where e.event_name = 'ai_request_succeeded'), count(*) filter (where e.event_name = 'ai_request_failed'),
         percentile_cont(0.5) within group (order by (e.metadata_safe ->> 'latency_ms')::numeric) filter (where e.event_name = 'ai_request_succeeded' and e.metadata_safe ? 'latency_ms'),
         percentile_cont(0.95) within group (order by (e.metadata_safe ->> 'latency_ms')::numeric) filter (where e.event_name = 'ai_request_succeeded' and e.metadata_safe ? 'latency_ms')
    into v_ai_ok, v_ai_fail, v_p50, v_p95
    from public.product_events e
   where e.event_name in ('ai_request_succeeded', 'ai_request_failed') and e.occurred_at >= p_from and e.occurred_at < p_to;
  v_ai_req := v_ai_ok + v_ai_fail;

  -- Pendapatan dikumpulkan: pembayaran VERIFIED dalam rentang, per jenis order.
  -- Uang yang pernah terverifikasi tetap dihitung walau kemudian ditahan (DISPUTED) atau dikembalikan (REFUNDED); verified_at menjadi dasar.
  select count(*), coalesce(sum(p.amount_idr), 0), coalesce(sum(p.fee_idr), 0) into v_pay_n, v_collected, v_fees
    from public.payments p where p.verified_at is not null and p.status in ('VERIFIED', 'DISPUTED', 'REFUNDED') and p.verified_at >= p_from and p.verified_at < p_to;
  select coalesce(jsonb_object_agg(k.kind, k.total), '{}'::jsonb) into v_rev
    from (select o.kind, sum(p.amount_idr) as total from public.payments p join public.orders o on o.id = p.order_id
           where p.verified_at is not null and p.status in ('VERIFIED', 'DISPUTED', 'REFUNDED') and p.verified_at >= p_from and p.verified_at < p_to group by o.kind) k;
  select coalesce(sum(p.amount_idr), 0) into v_held from public.payments p
   where p.status = 'DISPUTED' and p.verified_at is not null and p.verified_at >= p_from and p.verified_at < p_to;
  -- Pengembalian hanya untuk uang yang pernah dihitung sebagai terkumpul; transfer yang tak pernah terverifikasi bukan pengurang.
  select count(*), coalesce(sum(coalesce(pay.received_amount_idr, pay.amount_idr)), 0) into v_refund_n, v_refunds
    from public.audit_events a
    join public.payments pay on pay.order_id::text = a.entity_id and pay.status = 'REFUNDED' and pay.verified_at is not null
   where a.event_type = 'reconciliation_resolved' and a.metadata_safe ->> 'action' = 'REFUND_RECORDED' and a.created_at >= p_from and a.created_at < p_to;

  select count(*) into v_registered from public.profiles;
  select count(*) into v_new from public.profiles pr where pr.created_at >= p_from and pr.created_at < p_to;
  select count(distinct d.owner_id) into v_activated from public.document_versions v join public.documents d on d.id = v.document_id
   where v.created_at >= p_from and v.created_at < p_to;

  select coalesce(array_agg(pr.id), '{}') into v_cohort from public.profiles pr where pr.created_at >= p_from and pr.created_at < p_to;

  select count(*), percentile_cont(0.5) within group (order by extract(epoch from (r.completed_at - pay.verified_at)) / 3600),
         percentile_cont(0.95) within group (order by extract(epoch from (r.completed_at - pay.verified_at)) / 3600)
    into v_completed, v_sla50, v_sla95
    from public.review_requests r
    left join public.payments pay on pay.order_id = r.order_id and pay.status = 'VERIFIED'
   where r.status = 'COMPLETED' and r.completed_at >= p_from and r.completed_at < p_to and pay.verified_at is not null;

  return jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'users', jsonb_build_object('registered', v_registered, 'new', v_new, 'activated', v_activated),
    'ai', case when not v_ai_any then null else jsonb_build_object(
            'requests', v_ai_req, 'succeeded', v_ai_ok, 'failed', v_ai_fail,
            'success_rate', case when v_ai_req > 0 then round(v_ai_ok::numeric / v_ai_req, 4) end, 'p50_ms', v_p50, 'p95_ms', v_p95) end,
    'documents', jsonb_build_object(
      'started', (select count(*) from public.documents d where d.created_at >= p_from and d.created_at < p_to),
      'versions', (select count(*) from public.document_versions v where v.created_at >= p_from and v.created_at < p_to)),
    'funnel', jsonb_build_object(
      'registered', cardinality(v_cohort),
      'ai_used', (select count(distinct e.actor_user_id) from public.product_events e where e.actor_user_id = any (v_cohort) and e.event_name = 'ai_request_succeeded'),
      'doc_started', (select count(distinct d.owner_id) from public.documents d where d.owner_id = any (v_cohort)),
      'version_created', (select count(distinct d.owner_id) from public.document_versions v join public.documents d on d.id = v.document_id where d.owner_id = any (v_cohort)),
      'review_requested', (select count(distinct o.user_id) from public.orders o where o.user_id = any (v_cohort) and o.kind = 'STANDARD_REVIEW'),
      'review_paid', (select count(distinct r.owner_id) from public.review_requests r where r.owner_id = any (v_cohort)),
      'review_completed', (select count(distinct r.owner_id) from public.review_requests r where r.owner_id = any (v_cohort) and r.status = 'COMPLETED')),
    'reviews', jsonb_build_object(
      'unassigned', (select count(*) from public.review_requests r where r.status = 'QUEUED'),
      'backlog_by_age', jsonb_build_object(
        'lt_24h', (select count(*) from public.review_requests r where r.status in ('QUEUED', 'ASSIGNED', 'IN_REVIEW') and r.created_at > v_now - interval '24 hours'),
        'd1_3', (select count(*) from public.review_requests r where r.status in ('QUEUED', 'ASSIGNED', 'IN_REVIEW') and r.created_at <= v_now - interval '24 hours' and r.created_at > v_now - interval '3 days'),
        'gt_3d', (select count(*) from public.review_requests r where r.status in ('QUEUED', 'ASSIGNED', 'IN_REVIEW') and r.created_at <= v_now - interval '3 days')),
      'completed', v_completed, 'sla_median_hours', round(v_sla50, 2), 'sla_p95_hours', round(v_sla95, 2)),
    'revenue', case when v_pay_n = 0 and v_refund_n = 0 then null else jsonb_build_object(
                 'collected_by_kind', v_rev, 'collected', v_collected, 'held', v_held, 'refunds', v_refunds, 'net', v_collected - v_refunds, 'fees', v_fees,
                 'paying_users', (select count(distinct o.user_id) from public.payments p join public.orders o on o.id = p.order_id
                                   where p.status = 'VERIFIED' and p.verified_at >= p_from and p.verified_at < p_to)) end,
    'members', jsonb_build_object('active', (select count(distinct m.user_id) from public.memberships m where m.status = 'ACTIVE' and m.period_start <= v_now and v_now < m.period_end)),
    'incidents', jsonb_build_object(
      'reconciliation', (select count(*) from public.orders o where o.status = 'RECONCILIATION_REQUIRED'),
      'failed_outbox', (select count(*) from public.outbox_events x where x.status = 'FAILED'),
      'ai_failures', case when v_ai_any then v_ai_fail end));
end;
$$;

create or replace function public.decide_deep(p_reviewer uuid, p_deep uuid, p_revision integer, p_decision text, p_reason text, p_attest boolean, p_now timestamptz)
returns table (outcome text, verification_id uuid, code text)
language plpgsql security definer set search_path = public as $$
declare
  v_d public.deep_requests%rowtype; v_rep public.deep_reports%rowtype; v_parent public.document_verifications%rowtype;
  v_pr uuid; v_outcome text; v_vid uuid; v_code text; v_auth record; v_email text; v_existing public.document_verifications%rowtype;
begin
  -- Urutan kunci sama dengan revoke_verification (induk dulu, lalu deep) agar tidak saling tunggu.
  select d.parent_request_id into v_pr from public.deep_requests d where d.id = p_deep;
  perform 1 from public.document_verifications dv where dv.request_id = v_pr and dv.kind = 'LEGAL' for share;
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

create or replace function public.public_verification(p_code text)
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
  -- Enhanced turunan tidak pernah tampil aktif bila verifikasi induknya tidak aktif.
  return query select case when v.status = 'ACTIVE' and v.parent_verification_id is not null
                              and exists (select 1 from public.document_verifications pp where pp.id = v.parent_verification_id and pp.status <> 'ACTIVE')
                          then 'SUSPENDED' else v.status end, v.kind, v.issued_at, v.sha256, case when v_disclose then v.scope_summary end, v.outcome;
end;
$$;

create or replace function public.admin_add_member(p_admin uuid, p_firm uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin(p_admin) then
    raise exception 'FORBIDDEN';
  end if;
  if p_user = p_admin or public.is_platform_admin(p_user) then
    raise exception 'SELF_GRANT';
  end if;
  insert into public.firm_members (firm_id, user_id, role) values (p_firm, p_user, p_role)
  on conflict (firm_id, user_id) do update set role = excluded.role;
  insert into public.user_roles (user_id, role, granted_by)
  values (p_user, case when p_role = 'coordinator' then 'partner_admin' else 'reviewer' end, p_admin)
  on conflict do nothing;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_admin, 'firm_member_added', 'firm', p_firm::text, jsonb_build_object('user_id', p_user, 'role', p_role));
end;
$$;

create or replace function public.admin_authorize(p_admin uuid, p_user uuid, p_firm uuid, p_scope text, p_from date, p_to date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_platform_admin(p_admin) then
    raise exception 'FORBIDDEN';
  end if;
  if p_user = p_admin or public.is_platform_admin(p_user) then
    raise exception 'SELF_GRANT';
  end if;
  if not exists (select 1 from public.firm_members m where m.firm_id = p_firm and m.user_id = p_user) then
    raise exception 'NOT_A_MEMBER';
  end if;
  insert into public.professional_authorizations (user_id, firm_id, scope_note, valid_from, valid_to, verified_by)
  values (p_user, p_firm, left(p_scope, 500), p_from, p_to, p_admin) returning id into v_id;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_admin, 'authorization_granted', 'professional_authorization', v_id::text, jsonb_build_object('user_id', p_user, 'firm_id', p_firm));
  return v_id;
end;
$$;
