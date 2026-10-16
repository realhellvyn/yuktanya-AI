-- Analitik admin v8 (Task 7): katalog event produk + penulis tunggal best-effort + hook DB pada transisi tepercaya,
-- dan fungsi agregat admin_analytics (tren harian WIB, filter jenis dokumen & keanggotaan, panel kualitas, peringatan).
-- Event untuk tren/audit saja; semua angka admin_analytics dihitung dari tabel sumber (kecuali galat AI yang hanya ada sebagai event).
-- Kegagalan menulis event TIDAK PERNAH menggagalkan transaksi bisnis (subtransaksi + exception handler).
-- Metadata hanya kunci daftar-izin dengan nilai skalar pendek; tidak ada isi dokumen, nama, teks catatan, prompt, atau alasan privat.
-- Ditulis tanpa DROP/DELETE agar dapat diterapkan apa adanya ke staging.

-- Nama yang boleh ditulis. Harus sama dengan RECORDED_EVENT_NAMES di src/lib/analytics/catalogue.ts (diuji).
create function public.analytics_event_names() returns text[]
language sql immutable as $$
  select array[
    'signup_completed', 'ai_request_started', 'ai_request_succeeded', 'ai_request_failed', 'document_started', 'draft_completed',
    'review_requested', 'review_payment_verified', 'review_assigned', 'review_completed',
    'special_case_requested', 'special_case_quote_sent', 'special_case_quote_accepted',
    'membership_activated', 'payment_refunded', 'ai_verification_issued', 'legal_verification_issued', 'legal_enhanced_verification_issued',
    'verification_revoked', 'standard_completed', 'legal_note_published', 'deep_eligible', 'deep_offer_shown', 'deep_quote_accepted',
    'deep_payment_verified', 'deep_assigned', 'deep_completed', 'deep_approval_recorded',
    'document_uploaded', 'ai_review_completed']::text[];
$$;

-- Daftar-izin kunci metadata. Harus sama dengan SAFE_METADATA_KEYS (diuji).
create function public.analytics_safe_keys() returns text[]
language sql immutable as $$
  select array['kind', 'category', 'outcome', 'decision', 'status', 'severity', 'actionable', 'amount_idr', 'latency_ms', 'error_code', 'task',
               'has_document', 'revision', 'version_no', 'file_kind', 'risk_level', 'source', 'reason_code', 'plan_days', 'consentVersion', 'at']::text[];
$$;

create function public.analytics_safe_metadata(p jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(e.k, e.v), '{}'::jsonb)
    from jsonb_each(case when jsonb_typeof(p) = 'object' then p else '{}'::jsonb end) e(k, v)
   where e.k = any (public.analytics_safe_keys())
     and (jsonb_typeof(e.v) in ('number', 'boolean') or (jsonb_typeof(e.v) = 'string' and (e.v #>> '{}') ~ '^[A-Za-z0-9_.:+-]{1,64}$'));
$$;

-- Penulis tunggal. Mengembalikan true bila baris baru tertulis; false bila nama tak dikenal, duplikat, atau galat.
create function public.record_product_event(p_actor uuid, p_name text, p_entity_type text, p_entity_id text, p_dedupe text, p_occurred timestamptz, p_meta jsonb)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if p_name is null or p_dedupe is null or not (p_name = any (public.analytics_event_names())) then
    return false;
  end if;
  insert into public.product_events (actor_user_id, event_name, entity_type, entity_id, dedupe_key, occurred_at, metadata_safe)
  values (p_actor, p_name, p_entity_type, p_entity_id, left(p_dedupe, 300), coalesce(p_occurred, now()), public.analytics_safe_metadata(p_meta))
  on conflict (dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n > 0;
exception when others then
  -- Hanya nama event dan kode galat; tanpa payload.
  raise warning 'product_event_skipped name=% sqlstate=%', p_name, sqlstate;
  return false;
end;
$$;

-- Event Task 5 (kasus khusus) kini lewat penulis yang sama: best-effort dan tersaring.
create or replace function public.special_case_event(p_actor uuid, p_name text, p_case uuid, p_dedupe text, p_meta jsonb, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.record_product_event(p_actor, p_name, 'special_case', p_case::text, p_dedupe, p_now, p_meta);
end;
$$;

-- Satu fungsi trigger untuk semua tabel sumber. Seluruh badan dibungkus exception handler: hook tidak pernah menggagalkan transaksi.
create function public.analytics_capture() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cat text; v_kind text; v_owner uuid; v_ok boolean; v_name text; v_reason text; v_fin timestamptz;
  ins boolean := tg_op = 'INSERT';
begin
  begin
    case tg_table_name
    when 'profiles' then
      perform public.record_product_event(new.id, 'signup_completed', 'user', new.id::text, 'signup:' || new.id, new.created_at, '{}');
    when 'documents' then
      perform public.record_product_event(new.owner_id, 'document_started', 'document', new.id::text, 'document_started:' || new.id, new.created_at,
        jsonb_build_object('category', new.category));
    when 'document_versions' then
      select d.category, d.owner_id into v_cat, v_owner from public.documents d where d.id = new.document_id;
      perform public.record_product_event(v_owner, 'draft_completed', 'document_version', new.id::text, 'draft_completed:' || new.id, new.created_at,
        jsonb_build_object('category', v_cat, 'version_no', new.version_no));
    when 'document_uploads' then
      select d.owner_id into v_owner from public.documents d where d.id = new.document_id;
      perform public.record_product_event(v_owner, 'document_uploaded', 'document_upload', new.version_id::text, 'document_uploaded:' || new.version_id, new.created_at,
        jsonb_build_object('file_kind', new.file_kind, 'risk_level', new.risk_level));
    when 'ai_review_reports' then
      perform public.record_product_event(new.user_id, 'ai_review_completed', 'ai_review_report', new.id::text, 'ai_review_completed:' || new.id, new.completed_at, '{}');
    when 'orders' then
      if new.kind = 'STANDARD_REVIEW' then
        select d.category into v_cat from public.document_versions v join public.documents d on d.id = v.document_id where v.id = new.ref_id;
        perform public.record_product_event(new.user_id, 'review_requested', 'order', new.id::text, 'review_requested:' || new.id, new.created_at,
          jsonb_build_object('amount_idr', new.amount_idr, 'category', v_cat));
      elsif new.kind = 'DEEP_REVIEW' then
        perform public.record_product_event(new.user_id, 'deep_quote_accepted', 'order', new.id::text, 'deep_quote_accepted:' || new.id, new.created_at,
          jsonb_build_object('amount_idr', new.amount_idr));
      end if;
    when 'payments' then
      select o.kind, o.user_id into v_kind, v_owner from public.orders o where o.id = new.order_id;
      if new.status = 'VERIFIED' and new.verified_at is not null and v_kind in ('STANDARD_REVIEW', 'DEEP_REVIEW') then
        v_name := case v_kind when 'STANDARD_REVIEW' then 'review_payment_verified' else 'deep_payment_verified' end;
        perform public.record_product_event(v_owner, v_name, 'payment', new.id::text, v_name || ':' || new.id, new.verified_at,
          jsonb_build_object('kind', v_kind, 'amount_idr', new.amount_idr));
      elsif new.status = 'REFUNDED' and (ins or old.status is distinct from 'REFUNDED') then
        perform public.record_product_event(v_owner, 'payment_refunded', 'payment', new.id::text, 'payment_refunded:' || new.id, now(),
          jsonb_build_object('kind', v_kind, 'amount_idr', new.amount_idr));
      end if;
    when 'memberships' then
      if new.status = 'ACTIVE' and (ins or old.status is distinct from 'ACTIVE' or old.period_start is distinct from new.period_start) then
        perform public.record_product_event(new.user_id, 'membership_activated', 'membership', new.id::text,
          'membership_activated:' || new.id || ':' || extract(epoch from new.period_start)::bigint, case when ins then new.created_at else now() end,
          jsonb_build_object('plan_days', round(extract(epoch from (new.period_end - new.period_start)) / 86400)));
      end if;
    when 'review_assignments' then
      perform public.record_product_event(new.assigned_by, 'review_assigned', 'review_assignment', new.id::text, 'review_assigned:' || new.id, new.assigned_at, '{}');
    when 'review_requests' then
      if new.status = 'COMPLETED' and old.status is distinct from 'COMPLETED' then
        perform public.record_product_event(new.owner_id, 'review_completed', 'review_request', new.id::text, 'review_completed:' || new.id,
          coalesce(new.completed_at, now()), jsonb_build_object('outcome', new.outcome));
        perform public.record_product_event(new.owner_id, 'standard_completed', 'review_request', new.id::text, 'standard_completed:' || new.id,
          coalesce(new.completed_at, now()), jsonb_build_object('outcome', new.outcome));
        if new.outcome = 'WITH_NOTES' then
          select e.eligible into v_ok from public.deep_eligibility(new.owner_id, new.id, coalesce(new.completed_at, now())) e;
          if coalesce(v_ok, false) then
            perform public.record_product_event(new.owner_id, 'deep_eligible', 'review_request', new.id::text, 'deep_eligible:' || new.id,
              coalesce(new.completed_at, now()), '{}');
          end if;
        end if;
      end if;
    when 'legal_notes' then
      if new.status = 'PUBLISHED' and (ins or old.status is distinct from 'PUBLISHED') then
        select rp.finalized_at into v_fin from public.review_reports rp where rp.id = new.report_id;
        perform public.record_product_event(null, 'legal_note_published', 'legal_note', new.id::text, 'legal_note_published:' || new.id, coalesce(v_fin, now()),
          jsonb_build_object('severity', new.severity, 'actionable', new.actionable));
      end if;
    when 'deep_assignments' then
      perform public.record_product_event(new.assigned_by, 'deep_assigned', 'deep_assignment', new.id::text, 'deep_assigned:' || new.id, new.assigned_at, '{}');
    when 'deep_requests' then
      if new.status = 'COMPLETED' and old.status is distinct from 'COMPLETED' then
        perform public.record_product_event(new.owner_id, 'deep_completed', 'deep_request', new.id::text, 'deep_completed:' || new.id,
          coalesce(new.completed_at, now()), jsonb_build_object('outcome', new.outcome));
      end if;
    when 'deep_reports' then
      if new.status = 'FINAL' and old.status is distinct from 'FINAL' then
        perform public.record_product_event(new.author_id, 'deep_approval_recorded', 'deep_report', new.id::text, 'deep_approval_recorded:' || new.id,
          coalesce(new.finalized_at, now()), jsonb_build_object('decision', new.decision));
      end if;
    when 'document_verifications' then
      v_name := case new.kind when 'AI' then 'ai_verification_issued' when 'LEGAL' then 'legal_verification_issued' else 'legal_enhanced_verification_issued' end;
      perform public.record_product_event(null, v_name, 'verification', new.id::text, v_name || ':' || new.id, new.issued_at,
        jsonb_build_object('kind', new.kind, 'outcome', new.outcome));
    when 'verification_revocations' then
      select dv.kind into v_kind from public.document_verifications dv where dv.id = new.verification_id;
      v_reason := new.reason_code;
      perform public.record_product_event(new.actor_id, 'verification_revoked', 'verification', new.verification_id::text,
        'verification_revoked:' || new.verification_id, new.created_at, jsonb_build_object('kind', v_kind, 'reason_code', v_reason));
    else
      null;
    end case;
  exception when others then
    raise warning 'analytics_capture_skipped table=% sqlstate=%', tg_table_name, sqlstate;
  end;
  return null;
end;
$$;

create trigger analytics_capture after insert on public.profiles for each row execute function public.analytics_capture();
create trigger analytics_capture after insert on public.documents for each row execute function public.analytics_capture();
create trigger analytics_capture after insert on public.document_versions for each row execute function public.analytics_capture();
create trigger analytics_capture after insert on public.document_uploads for each row execute function public.analytics_capture();
create trigger analytics_capture after insert on public.ai_review_reports for each row execute function public.analytics_capture();
create trigger analytics_capture after insert on public.orders for each row execute function public.analytics_capture();
create trigger analytics_capture after insert or update on public.payments for each row execute function public.analytics_capture();
create trigger analytics_capture after insert or update on public.memberships for each row execute function public.analytics_capture();
create trigger analytics_capture after insert on public.review_assignments for each row execute function public.analytics_capture();
create trigger analytics_capture after update on public.review_requests for each row execute function public.analytics_capture();
create trigger analytics_capture after insert or update on public.legal_notes for each row execute function public.analytics_capture();
create trigger analytics_capture after insert on public.deep_assignments for each row execute function public.analytics_capture();
create trigger analytics_capture after update on public.deep_requests for each row execute function public.analytics_capture();
create trigger analytics_capture after update on public.deep_reports for each row execute function public.analytics_capture();
create trigger analytics_capture after insert on public.document_verifications for each row execute function public.analytics_capture();
create trigger analytics_capture after insert on public.verification_revocations for each row execute function public.analytics_capture();

-- Segmen keanggotaan pada saat kejadian (bukan saat ini): Member = periode ACTIVE/EXPIRED yang mencakup waktu itu.
create function public.analytics_segment(p_user uuid, p_at timestamptz, p_membership text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_membership is null then true
              else (exists (select 1 from public.memberships m where m.user_id = p_user and m.status in ('ACTIVE', 'EXPIRED')
                             and m.period_start <= p_at and p_at < m.period_end)) = (p_membership = 'MEMBER') end;
$$;

create function public.admin_analytics(p_admin uuid, p_from timestamptz, p_to timestamptz, p_category text, p_membership text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_days date[]; v_series jsonb; v_totals jsonb; v_quality jsonb; v_alerts jsonb; v_ai_any boolean;
  v_cat boolean := p_category is not null; v_hours integer; v_rate numeric; v_now timestamptz := now(); k text;
begin
  if not public.is_platform_admin(p_admin) then
    raise exception 'FORBIDDEN';
  end if;
  if (p_category is not null and p_category not in ('NDA', 'PKS', 'UTANG_PIUTANG', 'UPLOAD'))
     or (p_membership is not null and p_membership not in ('MEMBER', 'FREE')) then
    raise exception 'INVALID_FILTER';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '367 days' then
    raise exception 'INVALID_RANGE';
  end if;

  select array_agg(d::date order by d) into v_days
    from generate_series((p_from at time zone 'Asia/Jakarta')::date, ((p_to - interval '1 microsecond') at time zone 'Asia/Jakarta')::date, interval '1 day') d;
  select exists (select 1 from public.product_events e where e.event_name in ('ai_request_succeeded', 'ai_request_failed')) into v_ai_any;

  with facts(metric, ts, val) as (
    select 'new_users', pr.created_at, 1::numeric from public.profiles pr
     where not v_cat and pr.created_at >= p_from and pr.created_at < p_to and public.analytics_segment(pr.id, pr.created_at, p_membership)
    union all
    select 'docs_started', d.created_at, 1 from public.documents d
     where d.created_at >= p_from and d.created_at < p_to and (not v_cat or d.category = p_category) and public.analytics_segment(d.owner_id, d.created_at, p_membership)
    union all
    select 'drafts_completed', v.created_at, 1 from public.document_versions v join public.documents d on d.id = v.document_id
     where v.created_at >= p_from and v.created_at < p_to and (not v_cat or d.category = p_category) and public.analytics_segment(d.owner_id, v.created_at, p_membership)
    union all
    select 'ai_messages', r.created_at, 1 from public.ai_usage_reservations r
     where not v_cat and r.quota_type = 'MESSAGE' and r.status = 'FINALIZED' and r.created_at >= p_from and r.created_at < p_to
       and public.analytics_segment(r.user_id, r.created_at, p_membership)
    union all
    select 'ai_failed', e.occurred_at, 1 from public.product_events e
     where not v_cat and e.event_name = 'ai_request_failed' and e.occurred_at >= p_from and e.occurred_at < p_to
       and public.analytics_segment(e.actor_user_id, e.occurred_at, p_membership)
    union all
    select 'reviews_requested', o.created_at, 1 from public.orders o
      join public.document_versions v on v.id = o.ref_id join public.documents d on d.id = v.document_id
     where o.kind = 'STANDARD_REVIEW' and o.created_at >= p_from and o.created_at < p_to and (not v_cat or d.category = p_category)
       and public.analytics_segment(o.user_id, o.created_at, p_membership)
    union all
    select 'reviews_paid', p.verified_at, 1 from public.payments p join public.orders o on o.id = p.order_id
      join public.document_versions v on v.id = o.ref_id join public.documents d on d.id = v.document_id
     where o.kind = 'STANDARD_REVIEW' and p.verified_at is not null and p.status in ('VERIFIED', 'DISPUTED', 'REFUNDED')
       and p.verified_at >= p_from and p.verified_at < p_to and (not v_cat or d.category = p_category)
       and public.analytics_segment(o.user_id, p.verified_at, p_membership)
    union all
    select 'reviews_completed', r.completed_at, 1 from public.review_requests r
      join public.document_versions v on v.id = r.version_id join public.documents d on d.id = v.document_id
     where r.status = 'COMPLETED' and r.completed_at >= p_from and r.completed_at < p_to and (not v_cat or d.category = p_category)
       and public.analytics_segment(r.owner_id, r.completed_at, p_membership)
    union all
    -- Uang terkumpul = pembayaran yang pernah terverifikasi (sama dengan admin_overview). Filter jenis: hanya order review dokumen itu.
    select 'revenue', p.verified_at, p.amount_idr::numeric from public.payments p join public.orders o on o.id = p.order_id
      left join public.review_requests pr on o.kind = 'DEEP_REVIEW' and pr.id = o.ref_id
      left join public.document_versions v on v.id = case when o.kind = 'STANDARD_REVIEW' then o.ref_id when o.kind = 'DEEP_REVIEW' then pr.version_id end
      left join public.documents d on d.id = v.document_id
     where p.verified_at is not null and p.status in ('VERIFIED', 'DISPUTED', 'REFUNDED') and p.verified_at >= p_from and p.verified_at < p_to
       and (not v_cat or d.category = p_category) and public.analytics_segment(o.user_id, p.verified_at, p_membership)
  ),
  keys(metric) as (values ('new_users'), ('docs_started'), ('drafts_completed'), ('ai_messages'), ('ai_failed'),
                          ('reviews_requested'), ('reviews_paid'), ('reviews_completed'), ('revenue')),
  agg as (select f.metric, (f.ts at time zone 'Asia/Jakarta')::date as day, sum(f.val) as v from facts f group by 1, 2)
  select jsonb_object_agg(g.metric, g.vals) into v_series
    from (select k2.metric, jsonb_agg(coalesce(a.v, 0) order by dd.day) as vals
            from keys k2 cross join unnest(v_days) dd(day)
            left join agg a on a.metric = k2.metric and a.day = dd.day
           group by k2.metric) g;

  -- Tidak berlaku / tidak ada data: null, bukan nol karangan.
  if v_cat then
    v_series := v_series || jsonb_build_object('new_users', null, 'ai_messages', null, 'ai_failed', null);
  elsif not v_ai_any then
    v_series := v_series || jsonb_build_object('ai_failed', null);
  end if;
  v_totals := '{}'::jsonb;
  for k in select jsonb_object_keys(v_series) loop
    v_totals := v_totals || jsonb_build_object(k, case when jsonb_typeof(v_series -> k) = 'array'
      then (select coalesce(sum(x::numeric), 0) from jsonb_array_elements_text(v_series -> k) x) end);
  end loop;

  v_quality := jsonb_build_object(
    'reviews_by_outcome', (select coalesce(jsonb_object_agg(x.outcome, x.n), '{}'::jsonb) from (
        select coalesce(r.outcome, 'UNKNOWN') as outcome, count(*) as n from public.review_requests r
          join public.document_versions v on v.id = r.version_id join public.documents d on d.id = v.document_id
         where r.status = 'COMPLETED' and r.completed_at >= p_from and r.completed_at < p_to and (not v_cat or d.category = p_category)
           and public.analytics_segment(r.owner_id, r.completed_at, p_membership)
         group by 1) x),
    'legal_notes_published', (select count(*) from public.legal_notes n join public.review_reports rp on rp.id = n.report_id
          join public.review_requests r on r.id = rp.request_id join public.document_versions v on v.id = r.version_id join public.documents d on d.id = v.document_id
         where n.status = 'PUBLISHED' and rp.finalized_at >= p_from and rp.finalized_at < p_to and (not v_cat or d.category = p_category)
           and public.analytics_segment(r.owner_id, rp.finalized_at, p_membership)),
    'verifications_issued', (select coalesce(jsonb_object_agg(x.kind, x.n), '{}'::jsonb) from (
        select dv.kind, count(*) as n from public.document_verifications dv
          join public.document_versions v on v.id = dv.version_id join public.documents d on d.id = v.document_id
         where dv.issued_at >= p_from and dv.issued_at < p_to and (not v_cat or d.category = p_category)
           and public.analytics_segment(d.owner_id, dv.issued_at, p_membership)
         group by dv.kind) x),
    'verifications_revoked', (select count(*) from public.verification_revocations vr join public.document_verifications dv on dv.id = vr.verification_id
          join public.document_versions v on v.id = dv.version_id join public.documents d on d.id = v.document_id
         where vr.created_at >= p_from and vr.created_at < p_to and (not v_cat or d.category = p_category)
           and public.analytics_segment(d.owner_id, vr.created_at, p_membership)),
    'deep_by_outcome', (select coalesce(jsonb_object_agg(x.outcome, x.n), '{}'::jsonb) from (
        select coalesce(dr.outcome, 'UNKNOWN') as outcome, count(*) as n from public.deep_requests dr
          join public.document_versions v on v.id = dr.version_id join public.documents d on d.id = v.document_id
         where dr.status = 'COMPLETED' and dr.completed_at >= p_from and dr.completed_at < p_to and (not v_cat or d.category = p_category)
           and public.analytics_segment(dr.owner_id, dr.completed_at, p_membership)
         group by 1) x),
    'ai_malformed', case when v_ai_any and not v_cat then (select count(*) from public.product_events e
         where e.event_name = 'ai_request_failed' and e.metadata_safe ->> 'error_code' = 'MALFORMED_OUTPUT'
           and e.occurred_at >= p_from and e.occurred_at < p_to and public.analytics_segment(e.actor_user_id, e.occurred_at, p_membership)) end,
    -- Belum ada tabel keluhan: jujur null.
    'complaints', null);

  -- Peringatan berdasarkan keadaan sekarang. Ambang sementara (SLA belum disepakati mitra) dapat diubah lewat app_settings.
  select coalesce((select s.value::integer from public.app_settings s where s.key = 'ADMIN_REVIEW_OVERDUE_HOURS' and s.value ~ '^[0-9]{1,4}$'), 72) into v_hours;
  select coalesce((select s.value::numeric from public.app_settings s where s.key = 'ADMIN_AI_ERROR_RATE_ALERT' and s.value ~ '^0?\.[0-9]{1,4}$'), 0.2) into v_rate;
  v_alerts := jsonb_build_object(
    'overdue_hours', v_hours,
    'overdue_reviews', (select count(*) from public.review_requests r where r.status in ('QUEUED', 'ASSIGNED', 'IN_REVIEW') and r.created_at < v_now - make_interval(hours => v_hours)),
    'overdue_deep', (select count(*) from public.deep_requests d where d.status in ('QUEUED', 'IN_REVIEW', 'READY_FOR_DECISION') and d.created_at < v_now - make_interval(hours => v_hours)),
    'unassigned', (select count(*) from public.review_requests r where r.status = 'QUEUED'),
    'paid_not_queued', (select count(*) from public.orders o where o.status = 'PAID'
          and ((o.kind = 'STANDARD_REVIEW' and not exists (select 1 from public.review_requests r where r.order_id = o.id))
            or (o.kind = 'DEEP_REVIEW' and not exists (select 1 from public.deep_requests d where d.order_id = o.id)))),
    'reconciliation', (select count(*) from public.orders o where o.status = 'RECONCILIATION_REQUIRED'),
    'ai_24h', case when v_ai_any then (select jsonb_build_object('requests', count(*), 'failed', count(*) filter (where e.event_name = 'ai_request_failed'),
          'rate', case when count(*) > 0 then round((count(*) filter (where e.event_name = 'ai_request_failed'))::numeric / count(*), 4) end)
        from public.product_events e where e.event_name in ('ai_request_succeeded', 'ai_request_failed') and e.occurred_at > v_now - interval '24 hours' and e.occurred_at <= v_now) end,
    'ai_rate_threshold', v_rate,
    'ai_min_requests', 5);

  return jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'filters', jsonb_build_object('category', p_category, 'membership', p_membership),
    'days', to_jsonb(v_days),
    'series', v_series,
    'totals', v_totals,
    'quality', v_quality,
    'alerts', v_alerts);
end;
$$;

revoke execute on function public.analytics_event_names(), public.analytics_safe_keys(), public.analytics_safe_metadata(jsonb),
  public.record_product_event(uuid, text, text, text, text, timestamptz, jsonb), public.analytics_capture(),
  public.analytics_segment(uuid, timestamptz, text), public.admin_analytics(uuid, timestamptz, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.record_product_event(uuid, text, text, text, text, timestamptz, jsonb),
  public.admin_analytics(uuid, timestamptz, timestamptz, text, text), public.analytics_event_names(), public.analytics_safe_keys(),
  public.analytics_safe_metadata(jsonb)
  to service_role;
