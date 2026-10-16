-- Metrik admin dari tabel sumber kebenaran. Hanya platform_admin. Tanpa isi dokumen, nama pihak, atau prompt.
-- Pendapatan = pembayaran VERIFIED; tidak ada data berarti null (bukan nol karangan).

create function public.admin_find_user(p_admin uuid, p_email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_platform_admin(p_admin) then
    raise exception 'FORBIDDEN';
  end if;
  select u.id into v_id from auth.users u where lower(u.email) = lower(trim(p_email));
  return v_id;
end;
$$;

create function public.admin_list_partners(p_admin uuid)
returns table (firm_id uuid, firm_name text, is_default boolean, user_id uuid, role text, authorization_id uuid, valid_from date, valid_to date, revoked_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin(p_admin) then
    raise exception 'FORBIDDEN';
  end if;
  return query
    select f.id, f.name, f.is_default, m.user_id, m.role, a.id, a.valid_from, a.valid_to, a.revoked_at
      from public.firms f
      left join public.firm_members m on m.firm_id = f.id
      left join public.professional_authorizations a on a.user_id = m.user_id and a.firm_id = m.firm_id
     order by f.created_at, f.id, m.role, m.user_id, a.created_at;
end;
$$;

create function public.admin_overview(p_admin uuid, p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_ai_any boolean; v_ai_req bigint; v_ai_ok bigint; v_ai_fail bigint; v_p50 numeric; v_p95 numeric;
  v_rev jsonb; v_collected bigint; v_refunds bigint; v_fees bigint; v_pay_n bigint; v_refund_n bigint;
  v_sla50 numeric; v_sla95 numeric; v_completed bigint;
  v_registered bigint; v_new bigint; v_activated bigint;
  v_cohort uuid[];
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
  select count(*), coalesce(sum(p.amount_idr), 0), coalesce(sum(p.fee_idr), 0) into v_pay_n, v_collected, v_fees
    from public.payments p where p.status = 'VERIFIED' and p.verified_at >= p_from and p.verified_at < p_to;
  select coalesce(jsonb_object_agg(k.kind, k.total), '{}'::jsonb) into v_rev
    from (select o.kind, sum(p.amount_idr) as total from public.payments p join public.orders o on o.id = p.order_id
           where p.status = 'VERIFIED' and p.verified_at >= p_from and p.verified_at < p_to group by o.kind) k;
  select count(*), coalesce(sum(o.amount_idr), 0) into v_refund_n, v_refunds
    from public.audit_events a join public.orders o on o.id::text = a.entity_id
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
        'lt_24h', (select count(*) from public.review_requests r where r.status in ('QUEUED', 'ASSIGNED', 'IN_REVIEW') and r.created_at > p_to - interval '24 hours'),
        'd1_3', (select count(*) from public.review_requests r where r.status in ('QUEUED', 'ASSIGNED', 'IN_REVIEW') and r.created_at <= p_to - interval '24 hours' and r.created_at > p_to - interval '3 days'),
        'gt_3d', (select count(*) from public.review_requests r where r.status in ('QUEUED', 'ASSIGNED', 'IN_REVIEW') and r.created_at <= p_to - interval '3 days')),
      'completed', v_completed, 'sla_median_hours', round(v_sla50, 2), 'sla_p95_hours', round(v_sla95, 2)),
    'revenue', case when v_pay_n = 0 and v_refund_n = 0 then null else jsonb_build_object(
                 'collected_by_kind', v_rev, 'collected', v_collected, 'refunds', v_refunds, 'net', v_collected - v_refunds, 'fees', v_fees,
                 'paying_users', (select count(distinct o.user_id) from public.payments p join public.orders o on o.id = p.order_id
                                   where p.status = 'VERIFIED' and p.verified_at >= p_from and p.verified_at < p_to),
                 'memberships_active', (select count(distinct m.user_id) from public.memberships m where m.status = 'ACTIVE' and m.period_start <= p_to and p_to < m.period_end)) end,
    'incidents', jsonb_build_object(
      'reconciliation', (select count(*) from public.orders o where o.status = 'RECONCILIATION_REQUIRED'),
      'failed_outbox', (select count(*) from public.outbox_events x where x.status = 'FAILED'),
      'ai_failures', case when v_ai_any then v_ai_fail end));
end;
$$;

revoke execute on function public.admin_find_user(uuid, text), public.admin_list_partners(uuid), public.admin_overview(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_find_user(uuid, text), public.admin_list_partners(uuid), public.admin_overview(uuid, timestamptz, timestamptz)
  to service_role;
