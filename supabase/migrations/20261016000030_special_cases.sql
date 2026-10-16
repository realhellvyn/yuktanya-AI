-- Kasus Hukum Khusus (Special Legal Case): pengajuan pemilik dengan persetujuan, triase + penawaran khusus oleh koordinator
-- firma, keputusan eksplisit pemilik. Status: SUBMITTED → TRIAGED → QUOTED → ACCEPTED | DECLINED → CLOSED.
-- Menerima penawaran TIDAK membuat order/pembayaran dan BUKAN persetujuan profesional atas dokumen.
-- Admin platform hanya melihat (tanpa ringkasan kasus) dan merutekan ke firma; triase/penawaran adalah keputusan firma.
-- Ditulis tanpa DROP/DELETE agar dapat diterapkan apa adanya ke staging.

create table public.special_cases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  document_id uuid references public.documents(id),
  firm_id uuid references public.firms(id),
  summary text not null check (char_length(summary) between 20 and 2000),
  status text not null default 'SUBMITTED' check (status in ('SUBMITTED', 'TRIAGED', 'QUOTED', 'ACCEPTED', 'DECLINED', 'CLOSED')),
  consent_at timestamptz not null,
  idempotency_key text not null,
  triaged_by uuid references auth.users(id),
  triaged_at timestamptz,
  quote_amount_idr integer check (quote_amount_idr > 0),
  quote_scope text,
  quote_expires_at timestamptz,
  quote_revision integer not null default 0,
  quoted_by uuid references auth.users(id),
  quoted_at timestamptz,
  decided_at timestamptz,
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  close_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, idempotency_key),
  check (status not in ('QUOTED', 'ACCEPTED') or (quote_amount_idr is not null and quote_scope is not null and quote_expires_at is not null))
);
-- Satu kasus terbuka per dokumen.
create unique index special_cases_one_open_per_doc on public.special_cases (document_id)
  where document_id is not null and status in ('SUBMITTED', 'TRIAGED', 'QUOTED', 'ACCEPTED');
create index special_cases_owner_idx on public.special_cases (owner_id, created_at desc);
create index special_cases_firm_idx on public.special_cases (firm_id, status);

alter table public.special_cases enable row level security;
revoke all on public.special_cases from anon, authenticated;

-- Koordinator firma kasus (bukan pemilik kasus itu sendiri).
create function public.is_case_coordinator(p_actor uuid, p_case public.special_cases) returns boolean
language sql stable security definer set search_path = public as $$
  select p_case.firm_id is not null and p_actor <> p_case.owner_id
     and exists (select 1 from public.firm_members m where m.firm_id = p_case.firm_id and m.user_id = p_actor and m.role = 'coordinator');
$$;

create function public.special_case_event(p_actor uuid, p_name text, p_case uuid, p_dedupe text, p_meta jsonb, p_now timestamptz) returns void
language sql security definer set search_path = public as $$
  insert into public.product_events (actor_user_id, event_name, entity_type, entity_id, dedupe_key, occurred_at, metadata_safe)
  values (p_actor, p_name, 'special_case', p_case::text, p_dedupe, p_now, p_meta)
  on conflict (dedupe_key) do nothing;
$$;

create function public.submit_special_case(p_owner uuid, p_document uuid, p_summary text, p_consent boolean, p_key text, p_now timestamptz) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_summary text := trim(coalesce(p_summary, '')); v_firm uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('special_case:' || p_owner::text, 0));
  select c.id into v_id from public.special_cases c where c.owner_id = p_owner and c.idempotency_key = p_key;
  if found then
    return v_id;
  end if;
  if p_document is not null and not exists (select 1 from public.documents d where d.id = p_document and d.owner_id = p_owner) then
    raise exception 'NOT_FOUND';
  end if;
  if p_consent is distinct from true then
    raise exception 'CONSENT_REQUIRED';
  end if;
  if char_length(v_summary) < 20 or char_length(v_summary) > 2000 then
    raise exception 'SUMMARY_INVALID';
  end if;
  if p_document is not null and exists (select 1 from public.special_cases c where c.document_id = p_document
       and c.status in ('SUBMITTED', 'TRIAGED', 'QUOTED', 'ACCEPTED')) then
    raise exception 'CASE_EXISTS';
  end if;
  -- Tanpa firma bawaan kasus tetap tersimpan dan dirutekan admin.
  select f.id into v_firm from public.firms f where f.is_default;
  insert into public.special_cases (owner_id, document_id, firm_id, summary, consent_at, idempotency_key, created_at, updated_at)
  values (p_owner, p_document, v_firm, v_summary, p_now, p_key, p_now, p_now) returning id into v_id;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_owner, 'special_case_submitted', 'special_case', v_id::text, jsonb_build_object('has_document', p_document is not null));
  perform public.special_case_event(p_owner, 'special_case_requested', v_id, 'special_case_requested:' || v_id::text,
    jsonb_build_object('has_document', p_document is not null), p_now);
  return v_id;
end;
$$;

create function public.special_case_for_owner(p_owner uuid, p_case uuid)
returns table (id uuid, document_id uuid, document_title text, status text, summary text, consent_at timestamptz, created_at timestamptz,
               triaged_at timestamptz, quote_amount_idr integer, quote_scope text, quote_expires_at timestamptz, quote_revision integer, quoted_at timestamptz,
               decided_at timestamptz, closed_at timestamptz, close_reason text)
language sql stable security definer set search_path = public as $$
  select c.id, c.document_id, d.title, c.status, c.summary, c.consent_at, c.created_at, c.triaged_at,
         c.quote_amount_idr, c.quote_scope, c.quote_expires_at, c.quote_revision, c.quoted_at, c.decided_at, c.closed_at, c.close_reason
    from public.special_cases c left join public.documents d on d.id = c.document_id
   where c.id = p_case and c.owner_id = p_owner;
$$;

create function public.owner_special_cases(p_owner uuid)
returns table (id uuid, document_id uuid, document_title text, status text, created_at timestamptz, quote_expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.document_id, d.title, c.status, c.created_at, c.quote_expires_at
    from public.special_cases c left join public.documents d on d.id = c.document_id
   where c.owner_id = p_owner
   order by c.created_at desc;
$$;

create function public.special_case_open_for_document(p_owner uuid, p_document uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select c.id from public.special_cases c
   where c.owner_id = p_owner and c.document_id = p_document and c.status in ('SUBMITTED', 'TRIAGED', 'QUOTED', 'ACCEPTED')
   limit 1;
$$;

-- Daftar mitra: kasus firma tempat aktor menjadi koordinator. Hanya kategori dokumen, bukan isi dokumen.
create function public.partner_special_cases(p_actor uuid)
returns table (id uuid, status text, created_at timestamptz, category text, firm_name text, quote_expires_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.status, c.created_at, d.category, f.name, c.quote_expires_at
    from public.special_cases c
    join public.firms f on f.id = c.firm_id
    left join public.documents d on d.id = c.document_id
   where public.is_case_coordinator(p_actor, c)
   order by case c.status when 'SUBMITTED' then 0 when 'TRIAGED' then 1 when 'QUOTED' then 2 when 'ACCEPTED' then 3 else 4 end, c.created_at;
$$;

create function public.special_case_for_partner(p_actor uuid, p_case uuid)
returns table (id uuid, status text, created_at timestamptz, category text, firm_name text, summary text, consent_at timestamptz, triaged_at timestamptz,
               quote_amount_idr integer, quote_scope text, quote_expires_at timestamptz, quote_revision integer, quoted_at timestamptz,
               decided_at timestamptz, closed_at timestamptz, close_reason text)
language sql stable security definer set search_path = public as $$
  select c.id, c.status, c.created_at, d.category, f.name, c.summary, c.consent_at, c.triaged_at,
         c.quote_amount_idr, c.quote_scope, c.quote_expires_at, c.quote_revision, c.quoted_at, c.decided_at, c.closed_at, c.close_reason
    from public.special_cases c
    join public.firms f on f.id = c.firm_id
    left join public.documents d on d.id = c.document_id
   where c.id = p_case and public.is_case_coordinator(p_actor, c);
$$;

-- Admin: metadata operasional saja (tanpa ringkasan kasus).
create function public.admin_special_cases(p_admin uuid)
returns table (id uuid, status text, created_at timestamptz, firm_id uuid, firm_name text, quote_amount_idr integer, quote_expires_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin(p_admin) then
    raise exception 'FORBIDDEN';
  end if;
  return query select c.id, c.status, c.created_at, c.firm_id, f.name, c.quote_amount_idr, c.quote_expires_at
    from public.special_cases c left join public.firms f on f.id = c.firm_id
   order by c.created_at desc limit 200;
end;
$$;

create function public.admin_route_special_case(p_admin uuid, p_case uuid, p_firm uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v_c public.special_cases%rowtype;
begin
  if not public.is_platform_admin(p_admin) then
    raise exception 'FORBIDDEN';
  end if;
  select c.* into v_c from public.special_cases c where c.id = p_case for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if not exists (select 1 from public.firms f where f.id = p_firm) then
    raise exception 'INVALID_FIRM';
  end if;
  if v_c.status not in ('SUBMITTED', 'TRIAGED') then
    raise exception 'INVALID_STATE';
  end if;
  -- Firma baru wajib melakukan triase (termasuk cek konflik) sendiri.
  update public.special_cases c set firm_id = p_firm, status = 'SUBMITTED', triaged_by = null, triaged_at = null, updated_at = p_now where c.id = p_case;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_admin, 'special_case_routed', 'special_case', p_case::text, jsonb_build_object('firm_id', p_firm));
end;
$$;

-- Triase oleh koordinator firma kasus; cek konflik kepentingan wajib dinyatakan.
create function public.triage_special_case(p_actor uuid, p_case uuid, p_conflict_cleared boolean, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v_c public.special_cases%rowtype;
begin
  select c.* into v_c from public.special_cases c where c.id = p_case for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if not public.is_case_coordinator(p_actor, v_c) then
    raise exception 'FORBIDDEN';
  end if;
  if v_c.status <> 'SUBMITTED' then
    raise exception 'INVALID_STATE';
  end if;
  if p_conflict_cleared is distinct from true then
    raise exception 'CONFLICT_CHECK_REQUIRED';
  end if;
  update public.special_cases c set status = 'TRIAGED', triaged_by = p_actor, triaged_at = p_now, updated_at = p_now where c.id = p_case;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_actor, 'special_case_triaged', 'special_case', p_case::text, jsonb_build_object('conflict_cleared', true));
end;
$$;

-- Penawaran khusus (nominal, ruang lingkup, masa berlaku). Penawaran ulang hanya selama belum diputuskan pemilik.
create function public.quote_special_case(p_actor uuid, p_case uuid, p_amount integer, p_scope text, p_expires timestamptz, p_now timestamptz) returns integer
language plpgsql security definer set search_path = public as $$
declare v_c public.special_cases%rowtype; v_scope text := trim(coalesce(p_scope, '')); v_rev integer;
begin
  select c.* into v_c from public.special_cases c where c.id = p_case for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if not public.is_case_coordinator(p_actor, v_c) then
    raise exception 'FORBIDDEN';
  end if;
  if v_c.status not in ('TRIAGED', 'QUOTED') then
    raise exception 'INVALID_STATE';
  end if;
  if p_amount is null or p_amount < 1000 or p_amount > 1000000000 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if char_length(v_scope) < 10 or char_length(v_scope) > 2000 then
    raise exception 'INVALID_SCOPE';
  end if;
  if p_expires is null or p_expires <= p_now or p_expires > p_now + interval '90 days' then
    raise exception 'INVALID_EXPIRY';
  end if;
  v_rev := v_c.quote_revision + 1;
  update public.special_cases c
     set status = 'QUOTED', quote_amount_idr = p_amount, quote_scope = v_scope, quote_expires_at = p_expires, quote_revision = v_rev,
         quoted_by = p_actor, quoted_at = p_now, updated_at = p_now
   where c.id = p_case;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_actor, 'special_case_quoted', 'special_case', p_case::text, jsonb_build_object('revision', v_rev, 'amount_idr', p_amount));
  perform public.special_case_event(p_actor, 'special_case_quote_sent', p_case, 'special_case_quote_sent:' || p_case::text || ':' || v_rev,
    jsonb_build_object('revision', v_rev, 'amount_idr', p_amount), p_now);
  return v_rev;
end;
$$;

-- Pemilik menerima penawaran yang ia lihat (revisi sama) sebelum kedaluwarsa. Tidak ada order, pembayaran, atau verifikasi yang dibuat.
create function public.accept_special_case_quote(p_owner uuid, p_case uuid, p_revision integer, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v_c public.special_cases%rowtype;
begin
  select c.* into v_c from public.special_cases c where c.id = p_case for update;
  if not found or v_c.owner_id <> p_owner then
    raise exception 'NOT_FOUND';
  end if;
  if v_c.status <> 'QUOTED' then
    raise exception 'INVALID_STATE';
  end if;
  if p_revision is distinct from v_c.quote_revision then
    raise exception 'STALE_QUOTE';
  end if;
  if p_now >= v_c.quote_expires_at then
    raise exception 'QUOTE_EXPIRED';
  end if;
  update public.special_cases c set status = 'ACCEPTED', decided_at = p_now, updated_at = p_now where c.id = p_case;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_owner, 'special_case_quote_accepted', 'special_case', p_case::text, jsonb_build_object('revision', v_c.quote_revision));
  perform public.special_case_event(p_owner, 'special_case_quote_accepted', p_case, 'special_case_quote_accepted:' || p_case::text,
    jsonb_build_object('revision', v_c.quote_revision, 'amount_idr', v_c.quote_amount_idr), p_now);
end;
$$;

create function public.decline_special_case_quote(p_owner uuid, p_case uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v_c public.special_cases%rowtype;
begin
  select c.* into v_c from public.special_cases c where c.id = p_case for update;
  if not found or v_c.owner_id <> p_owner then
    raise exception 'NOT_FOUND';
  end if;
  if v_c.status <> 'QUOTED' then
    raise exception 'INVALID_STATE';
  end if;
  update public.special_cases c set status = 'DECLINED', decided_at = p_now, updated_at = p_now where c.id = p_case;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_owner, 'special_case_quote_declined', 'special_case', p_case::text, jsonb_build_object('revision', v_c.quote_revision));
end;
$$;

-- Penutupan: koordinator firma kasus dari status apa pun yang belum CLOSED; pemilik hanya menarik sebelum menerima penawaran.
create function public.close_special_case(p_actor uuid, p_case uuid, p_reason text, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v_c public.special_cases%rowtype; v_owner boolean;
begin
  select c.* into v_c from public.special_cases c where c.id = p_case for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  v_owner := v_c.owner_id = p_actor;
  if not v_owner and not public.is_case_coordinator(p_actor, v_c) then
    raise exception 'FORBIDDEN';
  end if;
  if v_c.status = 'CLOSED' or (v_owner and v_c.status = 'ACCEPTED') then
    raise exception 'INVALID_STATE';
  end if;
  update public.special_cases c
     set status = 'CLOSED', closed_by = p_actor, closed_at = p_now, close_reason = nullif(left(trim(coalesce(p_reason, '')), 500), ''), updated_at = p_now
   where c.id = p_case;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_actor, 'special_case_closed', 'special_case', p_case::text, jsonb_build_object('by_owner', v_owner, 'from_status', v_c.status));
end;
$$;

-- Dokumen dengan kasus khusus terbuka tidak dapat membeli Review Standar (berlaku untuk semua jalur INSERT order).
create function public.guard_special_case_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'STANDARD_REVIEW' and exists (
       select 1 from public.document_versions v join public.special_cases c on c.document_id = v.document_id
        where v.id = new.ref_id and c.status in ('SUBMITTED', 'TRIAGED', 'QUOTED', 'ACCEPTED')) then
    raise exception 'SPECIAL_CASE_OPEN';
  end if;
  return new;
end;
$$;
create trigger orders_guard_special_case before insert on public.orders
  for each row execute function public.guard_special_case_order();

-- Pratinjau harga Review Standar juga menolak, agar tombol beli tidak ditampilkan.
create or replace function public.preview_price(p_user uuid, p_kind text, p_ref uuid, p_now timestamptz)
returns table (amount_idr integer, variant text, uses_credit boolean)
language plpgsql security definer set search_path = public as $$
declare q record;
begin
  if p_kind = 'STANDARD_REVIEW' then
    perform 1 from public.document_versions v join public.documents d on d.id = v.document_id
     where v.id = p_ref and d.owner_id = p_user;
    if not found then
      raise exception 'NOT_FOUND';
    end if;
    if exists (select 1 from public.document_versions v join public.special_cases c on c.document_id = v.document_id
                where v.id = p_ref and c.status in ('SUBMITTED', 'TRIAGED', 'QUOTED', 'ACCEPTED')) then
      raise exception 'SPECIAL_CASE_OPEN';
    end if;
  end if;
  select * into q from public.quote_price(p_user, p_kind, p_now);
  return query select q.amount_idr, q.variant, q.credit_id is not null;
end;
$$;

revoke execute on function
  public.is_case_coordinator(uuid, public.special_cases), public.special_case_event(uuid, text, uuid, text, jsonb, timestamptz),
  public.submit_special_case(uuid, uuid, text, boolean, text, timestamptz), public.special_case_for_owner(uuid, uuid),
  public.owner_special_cases(uuid), public.special_case_open_for_document(uuid, uuid), public.partner_special_cases(uuid),
  public.special_case_for_partner(uuid, uuid), public.admin_special_cases(uuid), public.admin_route_special_case(uuid, uuid, uuid, timestamptz),
  public.triage_special_case(uuid, uuid, boolean, timestamptz), public.quote_special_case(uuid, uuid, integer, text, timestamptz, timestamptz),
  public.accept_special_case_quote(uuid, uuid, integer, timestamptz), public.decline_special_case_quote(uuid, uuid, timestamptz),
  public.close_special_case(uuid, uuid, text, timestamptz), public.guard_special_case_order(),
  public.preview_price(uuid, text, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.is_case_coordinator(uuid, public.special_cases), public.special_case_event(uuid, text, uuid, text, jsonb, timestamptz),
  public.submit_special_case(uuid, uuid, text, boolean, text, timestamptz), public.special_case_for_owner(uuid, uuid),
  public.owner_special_cases(uuid), public.special_case_open_for_document(uuid, uuid), public.partner_special_cases(uuid),
  public.special_case_for_partner(uuid, uuid), public.admin_special_cases(uuid), public.admin_route_special_case(uuid, uuid, uuid, timestamptz),
  public.triage_special_case(uuid, uuid, boolean, timestamptz), public.quote_special_case(uuid, uuid, integer, text, timestamptz, timestamptz),
  public.accept_special_case_quote(uuid, uuid, integer, timestamptz), public.decline_special_case_quote(uuid, uuid, timestamptz),
  public.close_special_case(uuid, uuid, text, timestamptz),
  public.preview_price(uuid, text, uuid, timestamptz)
  to service_role;
