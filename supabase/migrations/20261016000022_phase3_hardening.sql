-- Penguatan Fase 3 setelah review: settlement yang tidak pernah gagal setelah uang masuk, transfer manual dinilai dari waktu dana
-- diterima, rekonsiliasi oleh admin, admin tidak dapat memberi dirinya kewenangan profesional, daftar pekerjaan tertahan, periode
-- membership tanpa penyusutan, dan catatan otoritas pada verifikasi hukum.

-- ===== Pagar keras satu order live per versi hanya untuk order yang masih dapat dipenuhi =====
drop index public.orders_one_active_review;
create unique index orders_one_active_review on public.orders (ref_id)
  where kind = 'STANDARD_REVIEW' and status in ('PENDING_PAYMENT', 'PAID');

alter table public.payments add column received_amount_idr integer;

create or replace function public.create_order(p_user uuid, p_kind text, p_ref uuid, p_key text, p_now timestamptz)
returns table (order_id uuid, status text, amount_idr integer, duplicate boolean)
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; q record; v_id uuid; v_status text;
begin
  perform pg_advisory_xact_lock(hashtextextended('order:' || p_user::text, 0));
  select o.* into v_o from public.orders o where o.user_id = p_user and o.idempotency_key = p_key;
  if found then
    return query select v_o.id, v_o.status, v_o.amount_idr, true;
    return;
  end if;
  perform public.expire_orders_scoped(p_user, p_now);

  if p_kind = 'STANDARD_REVIEW' then
    perform 1 from public.document_versions v join public.documents d on d.id = v.document_id
     where v.id = p_ref and d.owner_id = p_user;
    if not found then
      raise exception 'NOT_FOUND';
    end if;
    if exists (select 1 from public.orders o where o.ref_id = p_ref and o.kind = 'STANDARD_REVIEW'
                and o.status in ('PENDING_PAYMENT', 'PAID')) then
      raise exception 'ALREADY_REVIEWED';
    end if;
  else
    p_ref := null;
  end if;

  select * into q from public.quote_price(p_user, p_kind, p_now);
  v_status := case when q.amount_idr = 0 then 'PAID' else 'PENDING_PAYMENT' end;
  insert into public.orders (user_id, kind, ref_id, status, amount_idr, price_snapshot, idempotency_key, expires_at, paid_at)
  values (p_user, p_kind, p_ref, v_status, q.amount_idr,
          jsonb_build_object('variant', q.variant, 'amount_idr', q.amount_idr, 'credits', q.credits, 'credit_days', q.credit_days),
          p_key, p_now + interval '24 hours', case when q.amount_idr = 0 then p_now end)
  returning id into v_id;

  if q.variant = 'MEMBER_FIRST' then
    insert into public.review_discount_entitlements (membership_id, order_id, status) values (q.membership_id, v_id, 'RESERVED');
  end if;
  if q.credit_id is not null then
    update public.review_credits c set status = 'CONSUMED', reserved_by_order = v_id where c.id = q.credit_id and c.status = 'AVAILABLE';
    perform public.fulfill_order(v_id, p_now);
  end if;
  return query select v_id, v_status, q.amount_idr, false;
end;
$$;

-- ===== Pemenuhan: setiap periode dihitung dari awal agar tanggal 31 tidak menyusut =====
create or replace function public.fulfill_order(p_order uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_first timestamptz; v_i integer; v_n integer; v_days integer;
begin
  select o.* into v_o from public.orders o where o.id = p_order for update;
  if not found or v_o.status <> 'PAID' then
    raise exception 'ORDER_NOT_PAID';
  end if;
  if v_o.fulfilled_at is not null then
    return;
  end if;
  if v_o.kind in ('MEMBERSHIP_MONTHLY', 'MEMBERSHIP_ANNUAL') then
    select greatest(p_now, coalesce(max(m.period_end), p_now)) into v_first from public.memberships m
     where m.user_id = v_o.user_id and m.status = 'ACTIVE' and m.period_end > p_now;
    v_n := case when v_o.kind = 'MEMBERSHIP_ANNUAL' then 12 else 1 end;
    for v_i in 1..v_n loop
      insert into public.memberships (user_id, status, period_start, period_end)
      values (v_o.user_id, 'ACTIVE', v_first + make_interval(months => v_i - 1), v_first + make_interval(months => v_i));
    end loop;
  elsif v_o.kind = 'BUNDLE' then
    v_n := (v_o.price_snapshot ->> 'credits')::integer;
    v_days := (v_o.price_snapshot ->> 'credit_days')::integer;
    for v_i in 1..v_n loop
      insert into public.review_credits (user_id, order_id, expires_at, status)
      values (v_o.user_id, v_o.id, p_now + make_interval(days => v_days), 'AVAILABLE');
    end loop;
  elsif v_o.kind = 'STANDARD_REVIEW' then
    perform public.create_review_request(v_o.id, p_now);
    update public.review_discount_entitlements e set status = 'CONSUMED' where e.order_id = v_o.id and e.status = 'RESERVED';
  end if;
  update public.orders o set fulfilled_at = p_now where o.id = v_o.id;
end;
$$;

-- ===== Settlement: tidak pernah melempar setelah uang masuk; kedaluwarsa dinilai pada waktu dana diterima =====
drop function public.settle_payment(text, text, text, integer, integer, timestamptz);
drop function public.confirm_manual_payment(uuid, uuid, text, integer, timestamptz);

-- Menghidupkan kembali order yang kedaluwarsa karena sapuan padahal dana diterima tepat waktu. Gagal (false) bila ada konflik.
create function public.revive_expired_order(p_order uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_e public.review_discount_entitlements%rowtype;
begin
  select o.* into v_o from public.orders o where o.id = p_order for update;
  if not found or v_o.status <> 'EXPIRED' then
    return false;
  end if;
  if v_o.kind = 'STANDARD_REVIEW' and exists (select 1 from public.orders x where x.ref_id = v_o.ref_id and x.kind = v_o.kind
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

create function public.settle_payment(p_provider text, p_provider_ref text, p_event_id text, p_amount integer, p_fee integer, p_now timestamptz, p_received timestamptz default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_p public.payments%rowtype; v_o public.orders%rowtype; v_rows integer; v_at timestamptz := coalesce(p_received, p_now);
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
  update public.payments p set received_amount_idr = p_amount where p.id = v_p.id;
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
  update public.payments p set status = 'VERIFIED', verified_at = p_now, fee_idr = greatest(p_fee, 0) where p.id = v_p.id;
  update public.orders o set status = 'PAID', paid_at = p_now where o.id = v_o.id;
  perform public.fulfill_order(v_o.id, p_now);
  return 'SETTLED';
end;
$$;

create function public.confirm_manual_payment(p_admin uuid, p_payment uuid, p_bank_ref text, p_amount integer, p_now timestamptz, p_received timestamptz default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_p public.payments%rowtype; v_r text;
begin
  if not public.is_platform_admin(p_admin) then
    raise exception 'FORBIDDEN';
  end if;
  select p.* into v_p from public.payments p where p.id = p_payment and p.provider = 'manual';
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if p_received is not null and p_received > p_now then
    raise exception 'INVALID_RECEIVED_AT';
  end if;
  v_r := public.settle_payment('manual', v_p.provider_ref, 'manual:' || p_payment::text, p_amount, 0, p_now, p_received);
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_admin, 'manual_payment_confirmed', 'payment', p_payment::text,
          jsonb_build_object('result', v_r, 'amount_idr', p_amount, 'bank_ref', left(p_bank_ref, 64), 'received_at', coalesce(p_received, p_now)));
  return v_r;
end;
$$;

-- ===== Rekonsiliasi oleh admin (diaudit; pengembalian dana dilakukan di luar sistem) =====
create function public.admin_resolve_reconciliation(p_admin uuid, p_order uuid, p_action text, p_note text, p_now timestamptz) returns text
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_p public.payments%rowtype;
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
  select o.* into v_o from public.orders o where o.id = p_order for update;
  if not found then
    raise exception 'NOT_FOUND';
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

-- ===== Kewenangan profesional: admin tidak dapat memberi dirinya kewenangan =====
alter table public.professional_authorizations add constraint professional_auth_not_self check (verified_by <> user_id);

create or replace function public.admin_add_member(p_admin uuid, p_firm uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin(p_admin) then
    raise exception 'FORBIDDEN';
  end if;
  if p_user = p_admin then
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
  if p_user = p_admin then
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

-- Pemegang peran platform_admin tidak pernah memiliki kewenangan profesional, apa pun data anggota/otorisasinya.
create or replace function public.reviewer_has_authority(p_reviewer uuid, p_firm uuid, p_now timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select not public.is_platform_admin(p_reviewer) and exists (
    select 1 from public.firm_members m
      join public.professional_authorizations a on a.user_id = m.user_id and a.firm_id = m.firm_id
     where m.user_id = p_reviewer and m.firm_id = p_firm and m.role = 'reviewer'
       and a.revoked_at is null
       and (p_now at time zone 'Asia/Jakarta')::date between a.valid_from and a.valid_to);
$$;

-- ===== Pekerjaan tertahan: permintaan yang sudah ditugaskan, dengan status otoritas reviewer saat ini =====
create function public.coordinator_inflight(p_actor uuid, p_now timestamptz)
returns table (request_id uuid, status text, created_at timestamptz, category text, reviewer_id uuid, reviewer_authorized boolean)
language sql stable security definer set search_path = public as $$
  select r.id, r.status, r.created_at, d.category, a.reviewer_id,
         r.firm_id is not null and public.reviewer_has_authority(a.reviewer_id, r.firm_id, p_now)
    from public.review_requests r
    join public.review_assignments a on a.request_id = r.id and a.status = 'ACTIVE'
    join public.document_versions v on v.id = r.version_id
    join public.documents d on d.id = v.document_id
   where r.status in ('ASSIGNED', 'IN_REVIEW')
     and (public.is_platform_admin(p_actor)
          or (r.firm_id is not null and exists (select 1 from public.firm_members m where m.firm_id = r.firm_id and m.user_id = p_actor and m.role = 'coordinator')))
   order by r.created_at;
$$;

create or replace function public.publish_standard(p_reviewer uuid, p_request uuid, p_revision integer, p_outcome text, p_no_notes_declared boolean, p_attest boolean, p_now timestamptz)
returns table (status text, verification_id uuid, code text)
language plpgsql security definer set search_path = public as $$
declare
  v_r public.review_requests%rowtype; v_rep public.review_reports%rowtype; v_ver public.document_versions%rowtype;
  v_notes integer; v_auth record; v_vid uuid; v_code text; v_email text; v_existing public.document_verifications%rowtype;
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
    select a.* into v_auth from public.professional_authorizations a
     where a.user_id = p_reviewer and a.firm_id = v_r.firm_id and a.revoked_at is null
       and (p_now at time zone 'Asia/Jakarta')::date between a.valid_from and a.valid_to
     order by a.created_at desc limit 1;
    v_code := public.new_verification_code();
    insert into public.document_verifications (kind, version_id, sha256, outcome, scope_summary, issuer, policy_version, code, request_id, issued_at)
    values ('LEGAL', v_ver.id, v_ver.sha256, p_outcome, left(v_rep.scope, 500),
            jsonb_build_object('firm_id', v_r.firm_id, 'reviewer_id', p_reviewer, 'authorization_id', v_auth.id, 'scope_note', v_auth.scope_note,
                               'valid_from', v_auth.valid_from, 'valid_to', v_auth.valid_to, 'attested', true, 'attested_at', p_now),
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

revoke execute on function
  public.revive_expired_order(uuid), public.settle_payment(text, text, text, integer, integer, timestamptz, timestamptz),
  public.confirm_manual_payment(uuid, uuid, text, integer, timestamptz, timestamptz),
  public.admin_resolve_reconciliation(uuid, uuid, text, text, timestamptz), public.coordinator_inflight(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.revive_expired_order(uuid), public.settle_payment(text, text, text, integer, integer, timestamptz, timestamptz),
  public.confirm_manual_payment(uuid, uuid, text, integer, timestamptz, timestamptz),
  public.admin_resolve_reconciliation(uuid, uuid, text, text, timestamptz), public.coordinator_inflight(uuid, timestamptz)
  to service_role;
