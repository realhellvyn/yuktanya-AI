-- Integritas review (audit B: B-01, B-02, Minor B) dan bawaan Task 11 untuk penagihan.
-- Ditulis tanpa perintah penghapusan objek atau baris: dapat diterapkan apa adanya ke staging lewat alat MCP.
-- Hak eksekusi fungsi tetap hanya service_role; search_path tetap public.
--
-- B-01  Setiap baris kerja reviewer menyimpan penulisnya (reviewer + penugasan aktif saat ditulis): draf laporan standar dan
--       deep, Legal Note, checklist M1-M7, dan tindak lanjut catatan. Setelah penugasan ulang, baris milik penugasan lain
--       tidak dihitung: penanda tangan harus menyimpan ulang (mengonfirmasi) sendiri sebelum menerbitkan atau memutuskan.
--       Karena penugasan lama berakhir saat dipindahkan, baris reviewer yang otorisasinya dicabut tidak pernah terbawa.
-- B-02  Konflik kepentingan: (1) reviewer tidak boleh pemilik dokumen (dicek saat penugasan dan saat terbit);
--       (2) konflik tingkat firma dengan pemilik dokumen dicatat koordinator (firm_conflicts) dan menolak penugasan serta
--       penerbitan; (3) reviewer wajib menyatakan "tidak ada konflik kepentingan" saat menerbitkan/memutuskan, dan
--       pernyataan itu disimpan bersama keputusan. Kelayakan Deep ditolak bila dokumen punya kasus khusus terbuka.
--       Fungsi terbit/putus memperoleh parameter baru; tanda tangan lama dibiarkan ada tetapi selalu menolak.
-- Minor Flag ENHANCED_ISSUANCE dikirim server sebagai parameter dan ditegakkan di decide_deep; verifikasi yang sudah
--       dicabut tidak dapat diaktifkan lagi (trigger); audit untuk pengisian checklist/tindak lanjut/Legal Note dan
--       penolakan kelayakan Deep (tanpa isi catatan, penalaran, atau bukti).
-- Task 11 (a) sapuan kedaluwarsa mengunci pembayaran lebih dulu, sama dengan urutan settle_payment (pembayaran lalu order);
--       (b) pembayaran DISPUTED pada order yang sudah dibatalkan dapat dicatat pengembaliannya; (c) ACTIVATE menyapu order
--       kedaluwarsa pengguna itu lebih dulu sehingga entitlement order lewat batas tidak menghasilkan DISCOUNT_TAKEN palsu.

-- ===== Kolom penulis dan pernyataan =====
alter table public.review_reports
  add column if not exists drafted_by uuid references auth.users(id),
  add column if not exists drafted_assignment_id uuid references public.review_assignments(id),
  add column if not exists no_conflict_attested_at timestamptz;
alter table public.legal_notes
  add column if not exists author_id uuid references auth.users(id),
  add column if not exists assignment_id uuid references public.review_assignments(id),
  add column if not exists authored_at timestamptz;
alter table public.deep_reports
  add column if not exists drafted_by uuid references auth.users(id),
  add column if not exists drafted_assignment_id uuid references public.deep_assignments(id),
  add column if not exists no_conflict_attested_at timestamptz;
alter table public.deep_checklist
  add column if not exists assessed_by uuid references auth.users(id),
  add column if not exists assignment_id uuid references public.deep_assignments(id);
alter table public.deep_dispositions
  add column if not exists assessed_by uuid references auth.users(id),
  add column if not exists assignment_id uuid references public.deep_assignments(id),
  add column if not exists assessed_at timestamptz;

-- ===== Konflik tingkat firma (append-only; pencabutan konflik memerlukan kebijakan mitra) =====
create table if not exists public.firm_conflicts (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id),
  owner_id uuid not null references auth.users(id),
  declared_by uuid not null references auth.users(id),
  declared_at timestamptz not null,
  source_kind text not null check (source_kind in ('STANDARD', 'DEEP')),
  source_id uuid not null,
  unique (firm_id, owner_id)
);
alter table public.firm_conflicts enable row level security;
revoke all on public.firm_conflicts from anon, authenticated;
create trigger firm_conflicts_append_only before update or delete on public.firm_conflicts
  for each row execute function public.forbid_mutation();

-- OWNER: reviewer adalah pemilik dokumen. FIRM: firma reviewer mencatat konflik dengan pemilik dokumen. null: tidak ada.
create or replace function public.review_conflict(p_reviewer uuid, p_version uuid, p_owner uuid, p_firm uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_reviewer = p_owner
      or exists (select 1 from public.document_versions v join public.documents d on d.id = v.document_id
                  where v.id = p_version and d.owner_id = p_reviewer) then 'OWNER'
    when p_firm is not null and exists (select 1 from public.firm_conflicts c where c.firm_id = p_firm and c.owner_id = p_owner) then 'FIRM'
  end;
$$;

create or replace function public.declare_firm_conflict(p_actor uuid, p_kind text, p_id uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v_firm uuid; v_owner uuid; v_status text;
begin
  if p_kind = 'STANDARD' then
    select r.firm_id, r.owner_id, r.status into v_firm, v_owner, v_status from public.review_requests r where r.id = p_id for update;
  elsif p_kind = 'DEEP' then
    select d.firm_id, d.owner_id, d.status into v_firm, v_owner, v_status from public.deep_requests d where d.id = p_id for update;
  else
    raise exception 'INVALID_KIND';
  end if;
  if not found or v_firm is null or p_actor = v_owner
     or not exists (select 1 from public.firm_members m where m.firm_id = v_firm and m.user_id = p_actor and m.role = 'coordinator') then
    raise exception 'FORBIDDEN';
  end if;
  if (p_kind = 'STANDARD' and v_status not in ('QUEUED', 'ASSIGNED', 'IN_REVIEW'))
     or (p_kind = 'DEEP' and v_status not in ('QUEUED', 'IN_REVIEW', 'READY_FOR_DECISION', 'ON_HOLD')) then
    raise exception 'NOT_ASSIGNABLE';
  end if;
  insert into public.firm_conflicts (firm_id, owner_id, declared_by, declared_at, source_kind, source_id)
  values (v_firm, v_owner, p_actor, p_now, p_kind, p_id) on conflict (firm_id, owner_id) do nothing;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_actor, 'firm_conflict_declared', case when p_kind = 'STANDARD' then 'review_request' else 'deep_request' end, p_id::text,
          jsonb_build_object('firm_id', v_firm));
end;
$$;

-- Penolakan kelayakan Deep yang terjadi di dalam transaksi yang dibatalkan (order, aktivasi rekonsiliasi) dicatat server
-- sesudahnya lewat fungsi ini. Hanya kode alasan dan tahap; tanpa isi dokumen atau catatan.
create or replace function public.record_deep_eligibility_rejection(p_user uuid, p_parent uuid, p_reason text, p_stage text, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_reason is null or p_reason !~ '^[A-Z_]{1,40}$' or p_stage not in ('ORDER', 'RECONCILIATION', 'SETTLEMENT') then
    raise exception 'INVALID_REQUEST';
  end if;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_user, 'deep_eligibility_rejected', 'review_request', p_parent::text, jsonb_build_object('reason', p_reason, 'stage', p_stage));
end;
$$;

-- ===== Kelayakan Deep: kasus khusus terbuka pada dokumen induk memblokir =====
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
  -- B-02: dokumen yang sedang ditangani sebagai Kasus Hukum Khusus tidak ditawari Pemeriksaan Mendalam.
  if exists (select 1 from public.document_versions v join public.special_cases c on c.document_id = v.document_id
              where v.id = v_r.version_id and c.status in ('SUBMITTED', 'TRIAGED', 'QUOTED', 'ACCEPTED')) then
    return query select false, 'SPECIAL_CASE_OPEN'::text;
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

-- ===== Penugasan: pemilik dokumen dan konflik firma ditolak =====
create or replace function public.assign_review_internal(p_actor uuid, p_request uuid, p_reviewer uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v_r public.review_requests%rowtype; v_firm uuid; v_active integer;
begin
  select r.* into v_r from public.review_requests r where r.id = p_request for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if not (public.is_platform_admin(p_actor)
          or (v_r.firm_id is not null and exists (select 1 from public.firm_members m
               where m.firm_id = v_r.firm_id and m.user_id = p_actor and m.role = 'coordinator'))) then
    raise exception 'FORBIDDEN';
  end if;
  if v_r.status not in ('QUEUED', 'ASSIGNED', 'IN_REVIEW') then
    raise exception 'NOT_ASSIGNABLE';
  end if;
  if public.review_conflict(p_reviewer, v_r.version_id, v_r.owner_id, null) = 'OWNER' then
    raise exception 'REVIEWER_NOT_AUTHORIZED';
  end if;
  v_firm := v_r.firm_id;
  if v_firm is null then
    select m.firm_id into v_firm from public.firm_members m
     where m.user_id = p_reviewer and public.reviewer_has_authority(p_reviewer, m.firm_id, p_now) limit 1;
  end if;
  if v_firm is null or not public.reviewer_has_authority(p_reviewer, v_firm, p_now) then
    raise exception 'REVIEWER_NOT_AUTHORIZED';
  end if;
  if public.review_conflict(p_reviewer, v_r.version_id, v_r.owner_id, v_firm) = 'FIRM' then
    raise exception 'CONFLICT_OF_INTEREST';
  end if;
  select (select count(*) from public.review_assignments a where a.reviewer_id = p_reviewer and a.status = 'ACTIVE')
       + (select count(*) from public.deep_assignments a where a.reviewer_id = p_reviewer and a.status = 'ACTIVE') into v_active;
  if v_active >= 10 then
    raise exception 'REVIEWER_AT_CAPACITY';
  end if;
  update public.review_assignments a set status = 'ENDED', ended_at = p_now where a.request_id = p_request and a.status = 'ACTIVE';
  insert into public.review_assignments (request_id, reviewer_id, assigned_by, assigned_at) values (p_request, p_reviewer, p_actor, p_now);
  update public.review_requests r set status = 'ASSIGNED', firm_id = v_firm where r.id = p_request;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_actor, 'review_assigned', 'review_request', p_request::text, jsonb_build_object('reviewer_id', p_reviewer));
end;
$$;

create or replace function public.assign_deep_internal(p_actor uuid, p_deep uuid, p_reviewer uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v_d public.deep_requests%rowtype; v_firm uuid; v_active integer;
begin
  select d.* into v_d from public.deep_requests d where d.id = p_deep for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if not (public.is_platform_admin(p_actor)
          or (v_d.firm_id is not null and exists (select 1 from public.firm_members m
               where m.firm_id = v_d.firm_id and m.user_id = p_actor and m.role = 'coordinator'))) then
    raise exception 'FORBIDDEN';
  end if;
  if v_d.status not in ('QUEUED', 'IN_REVIEW', 'READY_FOR_DECISION') then
    raise exception 'NOT_ASSIGNABLE';
  end if;
  if public.review_conflict(p_reviewer, v_d.version_id, v_d.owner_id, null) = 'OWNER' then
    raise exception 'REVIEWER_NOT_AUTHORIZED';
  end if;
  v_firm := v_d.firm_id;
  if v_firm is null then
    select m.firm_id into v_firm from public.firm_members m
     where m.user_id = p_reviewer and public.reviewer_has_authority(p_reviewer, m.firm_id, p_now) limit 1;
  end if;
  if v_firm is null or not public.reviewer_has_authority(p_reviewer, v_firm, p_now) then
    raise exception 'REVIEWER_NOT_AUTHORIZED';
  end if;
  if public.review_conflict(p_reviewer, v_d.version_id, v_d.owner_id, v_firm) = 'FIRM' then
    raise exception 'CONFLICT_OF_INTEREST';
  end if;
  select (select count(*) from public.review_assignments a where a.reviewer_id = p_reviewer and a.status = 'ACTIVE')
       + (select count(*) from public.deep_assignments a where a.reviewer_id = p_reviewer and a.status = 'ACTIVE') into v_active;
  if v_active >= 10 then
    raise exception 'REVIEWER_AT_CAPACITY';
  end if;
  update public.deep_assignments a set status = 'ENDED', ended_at = p_now where a.deep_id = p_deep and a.status = 'ACTIVE';
  insert into public.deep_assignments (deep_id, reviewer_id, assigned_by, assigned_at) values (p_deep, p_reviewer, p_actor, p_now);
  update public.deep_requests d set firm_id = v_firm where d.id = p_deep;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_actor, 'deep_assigned', 'deep_request', p_deep::text, jsonb_build_object('reviewer_id', p_reviewer));
end;
$$;

-- ===== Draf dan Legal Note standar: penulis dan penugasan dicatat =====
create or replace function public.save_report_draft(p_reviewer uuid, p_request uuid, p_revision integer, p_scope text, p_assumptions text, p_summary text, p_now timestamptz)
returns integer language plpgsql security definer set search_path = public as $$
declare v_rep public.review_reports%rowtype; v_asg uuid;
begin
  v_rep := public.load_draft(p_reviewer, p_request, p_revision, p_now);
  select a.id into v_asg from public.review_assignments a where a.request_id = p_request and a.reviewer_id = p_reviewer and a.status = 'ACTIVE';
  update public.review_reports rp
     set scope = left(coalesce(p_scope, ''), 4000), assumptions = left(coalesce(p_assumptions, ''), 4000),
         summary = left(coalesce(p_summary, ''), 8000), revision = rp.revision + 1, author_id = p_reviewer,
         drafted_by = p_reviewer, drafted_assignment_id = v_asg
   where rp.id = v_rep.id;
  return v_rep.revision + 1;
end;
$$;

create or replace function public.upsert_note(p_reviewer uuid, p_request uuid, p_revision integer, p_note jsonb, p_now timestamptz)
returns table (revision integer, note_no integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_rep public.review_reports%rowtype; v_no integer; v_asg uuid;
begin
  v_rep := public.load_draft(p_reviewer, p_request, p_revision, p_now);
  select a.id into v_asg from public.review_assignments a where a.request_id = p_request and a.reviewer_id = p_reviewer and a.status = 'ACTIVE';
  v_no := (p_note ->> 'note_no')::integer;
  if v_no is null then
    select coalesce(max(n.note_no), 0) + 1 into v_no from public.legal_notes n where n.report_id = v_rep.id;
  end if;
  insert into public.legal_notes (report_id, note_no, block_id, quote, title, finding, severity, actionable, recommended_action, rationale, escalation,
                                  author_id, assignment_id, authored_at)
  values (v_rep.id, v_no, p_note ->> 'block_id', left(p_note ->> 'quote', 1000), p_note ->> 'title', p_note ->> 'finding',
          p_note ->> 'severity', coalesce((p_note ->> 'actionable')::boolean, false),
          nullif(trim(p_note ->> 'recommended_action'), ''), nullif(trim(p_note ->> 'rationale'), ''), nullif(trim(p_note ->> 'escalation'), ''),
          p_reviewer, v_asg, p_now)
  on conflict (report_id, note_no) do update
     set block_id = excluded.block_id, quote = excluded.quote, title = excluded.title, finding = excluded.finding, severity = excluded.severity,
         actionable = excluded.actionable, recommended_action = excluded.recommended_action, rationale = excluded.rationale, escalation = excluded.escalation,
         author_id = excluded.author_id, assignment_id = excluded.assignment_id, authored_at = excluded.authored_at;
  update public.review_reports rp set revision = rp.revision + 1, author_id = p_reviewer where rp.id = v_rep.id;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_reviewer, 'legal_note_saved', 'review_request', p_request::text,
          jsonb_build_object('note_no', v_no, 'severity', p_note ->> 'severity', 'actionable', coalesce((p_note ->> 'actionable')::boolean, false)));
  return query select v_rep.revision + 1, v_no;
end;
$$;

-- ===== Penerbitan standar (tanda tangan baru dengan pernyataan tanpa konflik) =====
create or replace function public.publish_standard(p_reviewer uuid, p_request uuid, p_revision integer, p_outcome text, p_no_notes_declared boolean, p_attest boolean, p_no_conflict boolean, p_now timestamptz)
returns table (status text, verification_id uuid, code text)
language plpgsql security definer set search_path = public as $$
declare
  v_r public.review_requests%rowtype; v_rep public.review_reports%rowtype; v_ver public.document_versions%rowtype;
  v_notes integer; v_auth record; v_vid uuid; v_code text; v_email text; v_existing public.document_verifications%rowtype;
  v_asg uuid; v_conf text;
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
  if not coalesce(p_no_conflict, false) then
    raise exception 'CONFLICT_ATTESTATION_REQUIRED';
  end if;
  v_conf := public.review_conflict(p_reviewer, v_r.version_id, v_r.owner_id, v_r.firm_id);
  if v_conf = 'OWNER' then
    raise exception 'REVIEWER_NOT_AUTHORIZED';
  elsif v_conf = 'FIRM' then
    raise exception 'CONFLICT_OF_INTEREST';
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

  -- B-01: hanya isi yang disimpan penanda tangan ini dalam penugasan aktifnya yang boleh terbit atas namanya.
  select a.id into v_asg from public.review_assignments a where a.request_id = p_request and a.reviewer_id = p_reviewer and a.status = 'ACTIVE';
  if v_rep.drafted_assignment_id is distinct from v_asg then
    raise exception 'VALIDATION_FAILED: REPORT_NOT_CONFIRMED';
  end if;
  if exists (select 1 from public.legal_notes n where n.report_id = v_rep.id and n.assignment_id is distinct from v_asg) then
    raise exception 'VALIDATION_FAILED: NOTE_NOT_CONFIRMED';
  end if;

  if p_outcome in ('WITH_NOTES', 'WITHIN_SCOPE') then
    select v.* into v_ver from public.document_versions v where v.id = v_r.version_id;
    select a.* into v_auth from public.professional_authorizations a
     where a.user_id = p_reviewer and a.firm_id = v_r.firm_id and a.revoked_at is null
       and (p_now at time zone 'Asia/Jakarta')::date between a.valid_from and a.valid_to
     order by a.created_at desc limit 1;
    v_code := public.new_verification_code();
    insert into public.document_verifications (kind, version_id, sha256, outcome, scope_summary, issuer, policy_version, code, request_id, issued_at)
    values ('LEGAL', v_ver.id, v_ver.sha256, p_outcome, left(v_rep.scope, 500),
            jsonb_build_object('firm_id', v_r.firm_id, 'reviewer_id', p_reviewer, 'authorization_id', v_auth.id, 'scope_note', v_auth.scope_note,
                               'valid_from', v_auth.valid_from, 'valid_to', v_auth.valid_to, 'attested', true, 'attested_at', p_now,
                               'no_conflict_attested', true),
            'v8', v_code, p_request, p_now)
    returning id into v_vid;
  end if;

  update public.review_reports rp
     set status = 'FINAL', outcome = p_outcome, finalized_at = p_now, author_id = p_reviewer, no_conflict_attested_at = p_now
   where rp.id = v_rep.id;
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
  values (p_reviewer, 'review_completed', 'review_request', p_request::text,
          jsonb_build_object('outcome', p_outcome, 'verification_id', v_vid, 'no_conflict_attested', true));
  select u.email into v_email from auth.users u where u.id = v_r.owner_id;
  if v_email is not null then
    perform public.enqueue_outbox('review_completed', jsonb_build_object('to', v_email), 'review_completed:' || p_request::text, p_now);
  end if;
  return query select p_outcome, v_vid, v_code;
end;
$$;

-- Tanda tangan lama (tanpa pernyataan konflik) tidak lagi dapat menerbitkan apa pun.
create or replace function public.publish_standard(p_reviewer uuid, p_request uuid, p_revision integer, p_outcome text, p_no_notes_declared boolean, p_attest boolean, p_now timestamptz)
returns table (status text, verification_id uuid, code text)
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'CONFLICT_ATTESTATION_REQUIRED';
end;
$$;

-- ===== Deep: draf, tindak lanjut, checklist dengan penulis + audit =====
create or replace function public.save_deep_draft(p_reviewer uuid, p_deep uuid, p_revision integer, p_extra_work text, p_summary text, p_now timestamptz) returns integer
language plpgsql security definer set search_path = public as $$
declare v_rep public.deep_reports%rowtype; v_asg uuid;
begin
  v_rep := public.load_deep_draft(p_reviewer, p_deep, p_revision, p_now);
  select a.id into v_asg from public.deep_assignments a where a.deep_id = p_deep and a.reviewer_id = p_reviewer and a.status = 'ACTIVE';
  update public.deep_reports rp
     set extra_work = left(coalesce(p_extra_work, ''), 8000), summary = left(coalesce(p_summary, ''), 8000), revision = rp.revision + 1, author_id = p_reviewer,
         drafted_by = p_reviewer, drafted_assignment_id = v_asg
   where rp.id = v_rep.id;
  return v_rep.revision + 1;
end;
$$;

create or replace function public.set_disposition(p_reviewer uuid, p_deep uuid, p_revision integer, p_note_no integer, p_disposition text, p_evidence text, p_now timestamptz) returns integer
language plpgsql security definer set search_path = public as $$
declare v_rep public.deep_reports%rowtype; v_parent uuid; v_asg uuid;
begin
  v_rep := public.load_deep_draft(p_reviewer, p_deep, p_revision, p_now);
  select d.parent_request_id into v_parent from public.deep_requests d where d.id = p_deep;
  if not exists (select 1 from public.legal_notes n join public.review_reports rp on rp.id = n.report_id
                  where rp.request_id = v_parent and n.note_no = p_note_no and n.status = 'PUBLISHED') then
    raise exception 'NOT_FOUND';
  end if;
  select a.id into v_asg from public.deep_assignments a where a.deep_id = p_deep and a.reviewer_id = p_reviewer and a.status = 'ACTIVE';
  insert into public.deep_dispositions (report_id, parent_note_no, disposition, evidence, assessed_by, assignment_id, assessed_at)
  values (v_rep.id, p_note_no, p_disposition, left(coalesce(p_evidence, ''), 4000), p_reviewer, v_asg, p_now)
  on conflict (report_id, parent_note_no) do update
     set disposition = excluded.disposition, evidence = excluded.evidence,
         assessed_by = excluded.assessed_by, assignment_id = excluded.assignment_id, assessed_at = excluded.assessed_at;
  update public.deep_reports rp set revision = rp.revision + 1, author_id = p_reviewer where rp.id = v_rep.id;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_reviewer, 'deep_disposition_set', 'deep_request', p_deep::text, jsonb_build_object('note_no', p_note_no, 'disposition', p_disposition));
  return v_rep.revision + 1;
end;
$$;

create or replace function public.set_checklist(p_reviewer uuid, p_deep uuid, p_revision integer, p_item text, p_result text, p_reasoning text, p_evidence text, p_now timestamptz) returns integer
language plpgsql security definer set search_path = public as $$
declare v_rep public.deep_reports%rowtype; v_asg uuid;
begin
  v_rep := public.load_deep_draft(p_reviewer, p_deep, p_revision, p_now);
  if p_result = 'N_A' and p_item in ('M4', 'M6', 'M7') then
    raise exception 'MANDATORY_ITEM';
  end if;
  select a.id into v_asg from public.deep_assignments a where a.deep_id = p_deep and a.reviewer_id = p_reviewer and a.status = 'ACTIVE';
  insert into public.deep_checklist (report_id, item, result, reasoning, evidence_ref, policy_version, assessed_at, assessed_by, assignment_id)
  values (v_rep.id, p_item, p_result, left(coalesce(p_reasoning, ''), 4000), left(coalesce(p_evidence, ''), 4000), 'v8-proposed', p_now, p_reviewer, v_asg)
  on conflict (report_id, item) do update
     set result = excluded.result, reasoning = excluded.reasoning, evidence_ref = excluded.evidence_ref, assessed_at = excluded.assessed_at,
         assessed_by = excluded.assessed_by, assignment_id = excluded.assignment_id;
  update public.deep_reports rp set revision = rp.revision + 1, author_id = p_reviewer where rp.id = v_rep.id;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_reviewer, 'deep_checklist_set', 'deep_request', p_deep::text, jsonb_build_object('item', p_item, 'result', p_result));
  return v_rep.revision + 1;
end;
$$;

-- ===== Keputusan deep (tanda tangan baru: pernyataan tanpa konflik + flag Enhanced dari server) =====
create or replace function public.decide_deep(p_reviewer uuid, p_deep uuid, p_revision integer, p_decision text, p_reason text, p_attest boolean, p_no_conflict boolean, p_enhanced_enabled boolean, p_now timestamptz)
returns table (outcome text, verification_id uuid, code text)
language plpgsql security definer set search_path = public as $$
declare
  v_d public.deep_requests%rowtype; v_rep public.deep_reports%rowtype; v_parent public.document_verifications%rowtype;
  v_pr uuid; v_outcome text; v_vid uuid; v_code text; v_auth record; v_email text; v_existing public.document_verifications%rowtype;
  v_asg uuid; v_conf text;
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
  if not coalesce(p_no_conflict, false) then
    raise exception 'CONFLICT_ATTESTATION_REQUIRED';
  end if;
  if p_decision not in ('APPROVE', 'DENY', 'INCONCLUSIVE', 'REFER_SPECIAL') then
    raise exception 'INVALID_DECISION';
  end if;
  -- Flag ENHANCED_ISSUANCE dikirim server; mati berarti APPROVE ditolak di sini juga, bukan hanya di aplikasi.
  if p_decision = 'APPROVE' and not coalesce(p_enhanced_enabled, false) then
    raise exception 'ENHANCED_DISABLED';
  end if;
  v_conf := public.review_conflict(p_reviewer, v_d.version_id, v_d.owner_id, v_d.firm_id);
  if v_conf = 'OWNER' then
    raise exception 'REVIEWER_NOT_AUTHORIZED';
  elsif v_conf = 'FIRM' then
    raise exception 'CONFLICT_OF_INTEREST';
  end if;
  perform public.assert_deep_hash(v_d);
  if v_rep.revision <> p_revision then
    raise exception 'STALE_REVISION';
  end if;
  if p_decision <> 'APPROVE' and (p_reason is null or length(trim(p_reason)) < 5) then
    raise exception 'REASON_REQUIRED';
  end if;

  -- B-01: pekerjaan tambahan dan tindak lanjut yang tampil ke pemilik harus disimpan pemutus ini dalam penugasan aktifnya.
  select a.id into v_asg from public.deep_assignments a where a.deep_id = p_deep and a.reviewer_id = p_reviewer and a.status = 'ACTIVE';
  if (length(trim(v_rep.extra_work)) > 0 or length(trim(v_rep.summary)) > 0) and v_rep.drafted_assignment_id is distinct from v_asg then
    raise exception 'GUARD_FAILED: REPORT_NOT_CONFIRMED';
  end if;
  if exists (select 1 from public.deep_dispositions x where x.report_id = v_rep.id and x.assignment_id is distinct from v_asg) then
    raise exception 'GUARD_FAILED: DISPOSITION_NOT_CONFIRMED';
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
    if exists (select 1 from public.deep_checklist c where c.report_id = v_rep.id and c.assignment_id is distinct from v_asg) then
      raise exception 'GUARD_FAILED: CHECKLIST_NOT_CONFIRMED';
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
                               'no_conflict_attested', true, 'deep_id', p_deep, 'rubric_version', 'v8-proposed'),
            'v8', v_code, v_d.parent_request_id, v_parent.id, p_now)
    returning id into v_vid;
  end if;

  v_outcome := case p_decision when 'APPROVE' then 'ENHANCED_APPROVED' when 'DENY' then 'COMPLETED_WITH_NOTES'
                               when 'INCONCLUSIVE' then 'INCONCLUSIVE' else 'REFERRED_SPECIAL_CASE' end;
  update public.deep_reports rp
     set status = 'FINAL', decision = p_decision, decision_reason = left(p_reason, 2000), finalized_at = p_now, author_id = p_reviewer,
         no_conflict_attested_at = p_now
   where rp.id = v_rep.id;
  update public.deep_requests d set status = 'COMPLETED', outcome = v_outcome, completed_at = p_now where d.id = p_deep;
  update public.deep_assignments a set status = 'ENDED', ended_at = p_now where a.deep_id = p_deep and a.status = 'ACTIVE';
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_reviewer, 'deep_decided', 'deep_request', p_deep::text,
          jsonb_build_object('decision', p_decision, 'outcome', v_outcome, 'verification_id', v_vid, 'no_conflict_attested', true));
  select u.email into v_email from auth.users u where u.id = v_d.owner_id;
  if v_email is not null then
    perform public.enqueue_outbox('review_completed', jsonb_build_object('to', v_email), 'deep_completed:' || p_deep::text, p_now);
  end if;
  return query select v_outcome, v_vid, v_code;
end;
$$;

-- Tanda tangan lama (tanpa pernyataan konflik dan flag) tidak lagi dapat memutuskan apa pun.
create or replace function public.decide_deep(p_reviewer uuid, p_deep uuid, p_revision integer, p_decision text, p_reason text, p_attest boolean, p_now timestamptz)
returns table (outcome text, verification_id uuid, code text)
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'CONFLICT_ATTESTATION_REQUIRED';
end;
$$;

-- ===== Verifikasi yang dicabut bersifat final =====
create or replace function public.guard_verification_update() returns trigger language plpgsql set search_path = public as $$
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
  if old.status = 'REVOKED' and new.status is distinct from 'REVOKED' then
    raise exception 'revoked verification cannot be reactivated';
  end if;
  return new;
end;
$$;

-- ===== Task 11 (a): sapuan mengunci pembayaran lebih dulu (urutan sama dengan settle_payment) =====
create or replace function public.expire_orders_scoped(p_user uuid, p_now timestamptz) returns integer
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[];
begin
  perform 1 from public.payments p join public.orders o on o.id = p.order_id
   where o.status = 'PENDING_PAYMENT' and o.expires_at <= p_now and (p_user is null or o.user_id = p_user)
   order by p.id
   for update of p;
  with x as (
    update public.orders o set status = 'EXPIRED'
     where o.status = 'PENDING_PAYMENT' and o.expires_at <= p_now and (p_user is null or o.user_id = p_user)
    returning o.id
  )
  select coalesce(array_agg(x.id), '{}') into v_ids from x;
  if cardinality(v_ids) = 0 then
    return 0;
  end if;
  update public.review_discount_entitlements e set status = 'RELEASED' where e.order_id = any (v_ids) and e.status = 'RESERVED';
  update public.payments p set status = 'EXPIRED' where p.order_id = any (v_ids) and p.status = 'PENDING';
  return cardinality(v_ids);
end;
$$;

-- ===== Settlement: penolakan kelayakan Deep tercatat di audit (transaksi ini tetap commit) =====
create or replace function public.settle_payment(p_provider text, p_provider_ref text, p_event_id text, p_amount integer, p_fee integer, p_now timestamptz, p_received timestamptz default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_p public.payments%rowtype; v_o public.orders%rowtype; v_rows integer; v_at timestamptz := coalesce(p_received, p_now); v_ok boolean; v_reason text;
begin
  select p.* into v_p from public.payments p where p.provider = p_provider and p.provider_ref = p_provider_ref for update;
  if not found then
    return 'NOT_FOUND';
  end if;
  insert into public.payment_events (provider, event_id, received_at) values (p_provider, p_event_id, p_now) on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 or v_p.status = 'VERIFIED' then
    return 'DUPLICATE';
  end if;
  if v_p.status not in ('PENDING', 'EXPIRED') then
    return 'RECONCILIATION_REQUIRED';
  end if;
  update public.payments p set received_amount_idr = p_amount, received_at = v_at where p.id = v_p.id;
  select o.* into v_o from public.orders o where o.id = v_p.order_id for update;

  if v_o.status = 'PENDING_PAYMENT' and v_o.expires_at <= v_at then
    perform public.expire_orders_scoped(v_o.user_id, v_at);
    select o.* into v_o from public.orders o where o.id = v_p.order_id;
  end if;
  if v_o.status = 'EXPIRED' and v_at <= v_o.expires_at and public.revive_expired_order(v_o.id) then
    select o.* into v_o from public.orders o where o.id = v_p.order_id;
  end if;
  if v_o.status <> 'PENDING_PAYMENT' then
    -- Terlambat atau order sudah dibayar lewat pembayaran lain: uang masuk tanpa aktivasi. Order tidak dikembalikan ke status
    -- yang dilindungi indeks keunikan sehingga pencatatan ini tidak dapat gagal.
    update public.payments p set status = 'DISPUTED', fee_idr = greatest(p_fee, 0) where p.id = v_p.id;
    if v_o.status in ('EXPIRED', 'CANCELLED') then
      update public.orders o set status = 'RECONCILIATION_REQUIRED' where o.id = v_o.id;
    end if;
    return 'RECONCILIATION_REQUIRED';
  end if;
  if p_amount <> v_o.amount_idr then
    update public.payments p set status = 'DISPUTED', fee_idr = greatest(p_fee, 0) where p.id = v_p.id;
    update public.orders o set status = 'RECONCILIATION_REQUIRED' where o.id = v_o.id;
    update public.review_discount_entitlements e set status = 'RELEASED' where e.order_id = v_o.id and e.status = 'RESERVED';
    return 'AMOUNT_MISMATCH';
  end if;
  if v_o.kind = 'DEEP_REVIEW' then
    -- Kelayakan dicek ulang (mengabaikan order ini sendiri). Induk dicabut/berubah: uang tercatat, tanpa pekerjaan.
    select e.eligible, e.reason into v_ok, v_reason from public.deep_eligibility(v_o.user_id, v_o.ref_id, p_now, v_o.id) e;
    if not coalesce(v_ok, false) then
      update public.payments p set status = 'DISPUTED', fee_idr = greatest(p_fee, 0) where p.id = v_p.id;
      update public.orders o set status = 'RECONCILIATION_REQUIRED' where o.id = v_o.id;
      insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
      values (v_o.user_id, 'deep_eligibility_rejected', 'review_request', v_o.ref_id::text,
              jsonb_build_object('reason', coalesce(v_reason, 'UNKNOWN'), 'stage', 'SETTLEMENT', 'order_id', v_o.id));
      return 'RECONCILIATION_REQUIRED';
    end if;
  end if;
  update public.payments p set status = 'VERIFIED', verified_at = p_now, fee_idr = greatest(p_fee, 0) where p.id = v_p.id;
  update public.orders o set status = 'PAID', paid_at = p_now where o.id = v_o.id;
  perform public.fulfill_order(v_o.id, p_now);
  return 'SETTLED';
end;
$$;

-- ===== Task 11 (b)(c): rekonsiliasi admin =====
create or replace function public.admin_resolve_reconciliation(p_admin uuid, p_order uuid, p_action text, p_note text, p_now timestamptz) returns text
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_p public.payments%rowtype; v_ok boolean; v_user uuid; v_e public.review_discount_entitlements%rowtype;
begin
  if not public.is_platform_admin(p_admin) then
    raise exception 'FORBIDDEN';
  end if;
  if p_note is null or length(trim(p_note)) < 5 then
    raise exception 'NOTE_REQUIRED';
  end if;
  if p_action not in ('ACTIVATE', 'REFUND_RECORDED', 'CLOSE') then
    raise exception 'INVALID_ACTION';
  end if;
  select o.user_id into v_user from public.orders o where o.id = p_order;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  -- Kunci yang sama dengan create_order: pemesanan ulang diskon tidak dapat berpapasan dengan order baru pengguna ini.
  perform pg_advisory_xact_lock(hashtextextended('order:' || v_user::text, 0));
  -- (c) Order lewat batas yang belum disapu tidak boleh tetap memegang diskon periode.
  perform public.expire_orders_scoped(v_user, p_now);
  select o.* into v_o from public.orders o where o.id = p_order for update;

  if v_o.status in ('PAID', 'CANCELLED') then
    -- Pembayaran yang masuk setelah order lunas atau sudah dibatalkan: hanya pengembalian dana yang dapat dicatat;
    -- status order tidak berubah.
    select p.* into v_p from public.payments p where p.order_id = p_order and p.status = 'DISPUTED' order by p.created_at desc limit 1 for update;
    if not found or p_action <> 'REFUND_RECORDED' then
      raise exception 'NOT_RECONCILIATION';
    end if;
    update public.payments p set status = 'REFUNDED' where p.id = v_p.id;
    insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
    values (p_admin, 'reconciliation_resolved', 'order', p_order::text,
            jsonb_build_object('action', p_action, 'note', left(p_note, 300), 'payment_id', v_p.id, 'extra_payment', true, 'order_status', v_o.status));
    return 'REFUND_RECORDED';
  end if;
  if v_o.status <> 'RECONCILIATION_REQUIRED' then
    raise exception 'NOT_RECONCILIATION';
  end if;
  select p.* into v_p from public.payments p where p.order_id = p_order and p.status = 'DISPUTED' order by p.created_at desc limit 1 for update;

  if p_action = 'ACTIVATE' then
    if not found or v_p.received_amount_idr is distinct from v_o.amount_idr then
      raise exception 'AMOUNT_MISMATCH';
    end if;
    if v_o.kind = 'STANDARD_REVIEW' and exists (select 1 from public.orders x where x.ref_id = v_o.ref_id and x.kind = v_o.kind
         and x.id <> v_o.id and x.status in ('PENDING_PAYMENT', 'PAID')) then
      raise exception 'CONFLICT';
    end if;
    if v_o.kind = 'DEEP_REVIEW' then
      select e.eligible into v_ok from public.deep_eligibility(v_o.user_id, v_o.ref_id, p_now, v_o.id) e;
      if not coalesce(v_ok, false) then
        raise exception 'NOT_ELIGIBLE';
      end if;
    end if;
    if v_o.kind = 'STANDARD_REVIEW' and v_o.price_snapshot ->> 'variant' = 'MEMBER_FIRST' then
      -- Harga Rp30.000 hanya sah dengan entitlement periode itu. Entitlement yang dilepas saat kedaluwarsa dipesan ulang;
      -- bila diskon periode sudah dipakai order lain, aktivasi ditolak dan uang tetap di rekonsiliasi untuk dikembalikan.
      select e.* into v_e from public.review_discount_entitlements e where e.order_id = p_order for update;
      if not found then
        raise exception 'DISCOUNT_TAKEN';
      end if;
      if v_e.status = 'RELEASED' then
        if exists (select 1 from public.review_discount_entitlements x where x.membership_id = v_e.membership_id
                    and x.id <> v_e.id and x.status in ('RESERVED', 'CONSUMED')) then
          raise exception 'DISCOUNT_TAKEN';
        end if;
        update public.review_discount_entitlements e set status = 'RESERVED' where e.id = v_e.id;
      end if;
    end if;
    update public.payments p set status = 'VERIFIED', verified_at = p_now where p.id = v_p.id;
    update public.orders o set status = 'PAID', paid_at = p_now where o.id = p_order;
    perform public.fulfill_order(p_order, p_now);
  elsif p_action = 'REFUND_RECORDED' then
    if found then
      update public.payments p set status = 'REFUNDED' where p.id = v_p.id;
    end if;
    update public.orders o set status = 'CANCELLED' where o.id = p_order;
    update public.review_discount_entitlements e set status = 'RELEASED' where e.order_id = p_order and e.status = 'RESERVED';
  else
    update public.orders o set status = 'CANCELLED' where o.id = p_order;
    update public.review_discount_entitlements e set status = 'RELEASED' where e.order_id = p_order and e.status = 'RESERVED';
  end if;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_admin, 'reconciliation_resolved', 'order', p_order::text, jsonb_build_object('action', p_action, 'note', left(p_note, 300)));
  return case p_action when 'ACTIVATE' then 'ACTIVATED' else p_action end || case p_action when 'CLOSE' then 'D' else '' end;
end;
$$;

revoke execute on function
  public.review_conflict(uuid, uuid, uuid, uuid), public.declare_firm_conflict(uuid, text, uuid, timestamptz),
  public.record_deep_eligibility_rejection(uuid, uuid, text, text, timestamptz),
  public.deep_eligibility(uuid, uuid, timestamptz, uuid),
  public.assign_review_internal(uuid, uuid, uuid, timestamptz), public.assign_deep_internal(uuid, uuid, uuid, timestamptz),
  public.save_report_draft(uuid, uuid, integer, text, text, text, timestamptz), public.upsert_note(uuid, uuid, integer, jsonb, timestamptz),
  public.publish_standard(uuid, uuid, integer, text, boolean, boolean, boolean, timestamptz),
  public.publish_standard(uuid, uuid, integer, text, boolean, boolean, timestamptz),
  public.save_deep_draft(uuid, uuid, integer, text, text, timestamptz), public.set_disposition(uuid, uuid, integer, integer, text, text, timestamptz),
  public.set_checklist(uuid, uuid, integer, text, text, text, text, timestamptz),
  public.decide_deep(uuid, uuid, integer, text, text, boolean, boolean, boolean, timestamptz),
  public.decide_deep(uuid, uuid, integer, text, text, boolean, timestamptz),
  public.guard_verification_update(),
  public.expire_orders_scoped(uuid, timestamptz), public.settle_payment(text, text, text, integer, integer, timestamptz, timestamptz),
  public.admin_resolve_reconciliation(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.review_conflict(uuid, uuid, uuid, uuid), public.declare_firm_conflict(uuid, text, uuid, timestamptz),
  public.record_deep_eligibility_rejection(uuid, uuid, text, text, timestamptz),
  public.deep_eligibility(uuid, uuid, timestamptz, uuid),
  public.assign_review_internal(uuid, uuid, uuid, timestamptz), public.assign_deep_internal(uuid, uuid, uuid, timestamptz),
  public.save_report_draft(uuid, uuid, integer, text, text, text, timestamptz), public.upsert_note(uuid, uuid, integer, jsonb, timestamptz),
  public.publish_standard(uuid, uuid, integer, text, boolean, boolean, boolean, timestamptz),
  public.publish_standard(uuid, uuid, integer, text, boolean, boolean, timestamptz),
  public.save_deep_draft(uuid, uuid, integer, text, text, timestamptz), public.set_disposition(uuid, uuid, integer, integer, text, text, timestamptz),
  public.set_checklist(uuid, uuid, integer, text, text, text, text, timestamptz),
  public.decide_deep(uuid, uuid, integer, text, text, boolean, boolean, boolean, timestamptz),
  public.decide_deep(uuid, uuid, integer, text, text, boolean, timestamptz),
  public.expire_orders_scoped(uuid, timestamptz), public.settle_payment(text, text, text, integer, integer, timestamptz, timestamptz),
  public.admin_resolve_reconciliation(uuid, uuid, text, text, timestamptz)
  to service_role;
