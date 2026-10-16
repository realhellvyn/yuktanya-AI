-- Firma mitra, otorisasi profesional, permintaan review standar, dan penugasan. Kewenangan diperiksa di database.

create table public.firms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index firms_one_default on public.firms (is_default) where is_default;
create table public.firm_members (
  firm_id uuid not null references public.firms(id),
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('reviewer', 'coordinator')),
  unique (firm_id, user_id)
);
create table public.professional_authorizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  firm_id uuid not null references public.firms(id),
  scope_note text not null,
  valid_from date not null,
  valid_to date not null check (valid_to >= valid_from),
  revoked_at timestamptz,
  verified_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index professional_auth_user_idx on public.professional_authorizations (user_id, firm_id);

create table public.review_requests (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.document_versions(id),
  owner_id uuid not null references auth.users(id),
  order_id uuid not null unique references public.orders(id),
  firm_id uuid references public.firms(id),
  version_sha256 text not null check (version_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'QUEUED' check (status in ('QUEUED', 'ASSIGNED', 'IN_REVIEW', 'COMPLETED', 'DECLINED', 'CANCELLED')),
  outcome text check (outcome in ('WITH_NOTES', 'WITHIN_SCOPE', 'INCONCLUSIVE', 'DECLINED')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index review_requests_one_live on public.review_requests (version_id)
  where status in ('QUEUED', 'ASSIGNED', 'IN_REVIEW', 'COMPLETED');
create index review_requests_status_idx on public.review_requests (status, created_at);
create table public.review_assignments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.review_requests(id),
  reviewer_id uuid not null references auth.users(id),
  assigned_by uuid not null references auth.users(id),
  assigned_at timestamptz not null,
  ended_at timestamptz,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ENDED'))
);
create unique index review_assignments_one_active on public.review_assignments (request_id) where status = 'ACTIVE';
create index review_assignments_reviewer_idx on public.review_assignments (reviewer_id, status);

alter table public.firms enable row level security;
alter table public.firm_members enable row level security;
alter table public.professional_authorizations enable row level security;
alter table public.review_requests enable row level security;
alter table public.review_assignments enable row level security;
revoke all on public.firms, public.firm_members, public.professional_authorizations, public.review_requests, public.review_assignments
  from anon, authenticated;

create function public.is_platform_admin(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles r where r.user_id = p_user and r.role = 'platform_admin');
$$;

create function public.admin_register_firm(p_admin uuid, p_name text, p_default boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_platform_admin(p_admin) then
    raise exception 'FORBIDDEN';
  end if;
  if p_default then
    update public.firms f set is_default = false where f.is_default;
  end if;
  insert into public.firms (name, is_default) values (left(trim(p_name), 120), p_default) returning id into v_id;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_admin, 'firm_registered', 'firm', v_id::text, jsonb_build_object('is_default', p_default));
  return v_id;
end;
$$;

create function public.admin_add_member(p_admin uuid, p_firm uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin(p_admin) then
    raise exception 'FORBIDDEN';
  end if;
  insert into public.firm_members (firm_id, user_id, role) values (p_firm, p_user, p_role)
  on conflict (firm_id, user_id) do update set role = excluded.role;
  -- Peran sesi untuk guard rute; kewenangan sebenarnya tetap diperiksa lewat otorisasi di database.
  insert into public.user_roles (user_id, role, granted_by)
  values (p_user, case when p_role = 'coordinator' then 'partner_admin' else 'reviewer' end, p_admin)
  on conflict do nothing;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_admin, 'firm_member_added', 'firm', p_firm::text, jsonb_build_object('user_id', p_user, 'role', p_role));
end;
$$;

create function public.admin_authorize(p_admin uuid, p_user uuid, p_firm uuid, p_scope text, p_from date, p_to date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_platform_admin(p_admin) then
    raise exception 'FORBIDDEN';
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

create function public.admin_revoke_authorization(p_admin uuid, p_auth uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin(p_admin) then
    raise exception 'FORBIDDEN';
  end if;
  update public.professional_authorizations a set revoked_at = coalesce(a.revoked_at, p_now) where a.id = p_auth;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_admin, 'authorization_revoked', 'professional_authorization', p_auth::text, '{}'::jsonb);
end;
$$;

-- Reviewer: anggota firma dengan peran reviewer dan otorisasi aktif pada hari WIB ini.
create function public.reviewer_has_authority(p_reviewer uuid, p_firm uuid, p_now timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.firm_members m
      join public.professional_authorizations a on a.user_id = m.user_id and a.firm_id = m.firm_id
     where m.user_id = p_reviewer and m.firm_id = p_firm and m.role = 'reviewer'
       and a.revoked_at is null
       and (p_now at time zone 'Asia/Jakarta')::date between a.valid_from and a.valid_to);
$$;

create function public.create_review_request(p_order uuid, p_now timestamptz) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_v public.document_versions%rowtype; v_id uuid; v_firm uuid;
begin
  select o.* into v_o from public.orders o where o.id = p_order;
  if not found or v_o.kind <> 'STANDARD_REVIEW' or v_o.status <> 'PAID' then
    raise exception 'ORDER_NOT_PAID';
  end if;
  select r.id into v_id from public.review_requests r where r.order_id = p_order;
  if found then
    return v_id;
  end if;
  select v.* into v_v from public.document_versions v where v.id = v_o.ref_id;
  select f.id into v_firm from public.firms f where f.is_default;
  -- Tanpa firma bawaan permintaan tetap masuk antrean (firma null) dan dirutekan admin; pembayaran tidak boleh gagal karenanya.
  insert into public.review_requests (version_id, owner_id, order_id, firm_id, version_sha256)
  values (v_v.id, v_o.user_id, p_order, v_firm, v_v.sha256) returning id into v_id;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (v_o.user_id, 'review_requested', 'review_request', v_id::text, '{}'::jsonb);
  return v_id;
end;
$$;

-- Penugasan inti. Aktor: koordinator firma permintaan itu atau platform_admin (hanya merutekan).
create function public.assign_review_internal(p_actor uuid, p_request uuid, p_reviewer uuid, p_now timestamptz) returns void
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
  if p_reviewer = v_r.owner_id then
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
  select count(*) into v_active from public.review_assignments a where a.reviewer_id = p_reviewer and a.status = 'ACTIVE';
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

create function public.assign_review(p_actor uuid, p_request uuid, p_reviewer uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select r.status from public.review_requests r where r.id = p_request) <> 'QUEUED' then
    raise exception 'NOT_ASSIGNABLE';
  end if;
  perform public.assign_review_internal(p_actor, p_request, p_reviewer, p_now);
end;
$$;

create function public.reassign_review(p_actor uuid, p_request uuid, p_reviewer uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select r.status from public.review_requests r where r.id = p_request) not in ('ASSIGNED', 'IN_REVIEW') then
    raise exception 'NOT_ASSIGNABLE';
  end if;
  perform public.assign_review_internal(p_actor, p_request, p_reviewer, p_now);
end;
$$;

create function public.reviewer_queue(p_reviewer uuid)
returns table (request_id uuid, status text, created_at timestamptz, assigned_at timestamptz, category text)
language sql stable security definer set search_path = public as $$
  select r.id, r.status, r.created_at, a.assigned_at, d.category
    from public.review_assignments a
    join public.review_requests r on r.id = a.request_id
    join public.document_versions v on v.id = r.version_id
    join public.documents d on d.id = v.document_id
   where a.reviewer_id = p_reviewer and a.status = 'ACTIVE' and r.status in ('ASSIGNED', 'IN_REVIEW')
   order by a.assigned_at;
$$;

create function public.coordinator_unassigned(p_actor uuid)
returns table (request_id uuid, created_at timestamptz, category text)
language sql stable security definer set search_path = public as $$
  select r.id, r.created_at, d.category
    from public.review_requests r
    join public.document_versions v on v.id = r.version_id
    join public.documents d on d.id = v.document_id
   where r.status = 'QUEUED'
     and (public.is_platform_admin(p_actor)
          or (r.firm_id is not null and exists (select 1 from public.firm_members m where m.firm_id = r.firm_id and m.user_id = p_actor and m.role = 'coordinator')))
   order by r.created_at;
$$;

revoke execute on function
  public.is_platform_admin(uuid), public.admin_register_firm(uuid, text, boolean), public.admin_add_member(uuid, uuid, uuid, text),
  public.admin_authorize(uuid, uuid, uuid, text, date, date), public.admin_revoke_authorization(uuid, uuid, timestamptz),
  public.reviewer_has_authority(uuid, uuid, timestamptz), public.create_review_request(uuid, timestamptz),
  public.assign_review_internal(uuid, uuid, uuid, timestamptz), public.assign_review(uuid, uuid, uuid, timestamptz),
  public.reassign_review(uuid, uuid, uuid, timestamptz), public.reviewer_queue(uuid), public.coordinator_unassigned(uuid)
  from public, anon, authenticated;
grant execute on function
  public.is_platform_admin(uuid), public.admin_register_firm(uuid, text, boolean), public.admin_add_member(uuid, uuid, uuid, text),
  public.admin_authorize(uuid, uuid, uuid, text, date, date), public.admin_revoke_authorization(uuid, uuid, timestamptz),
  public.reviewer_has_authority(uuid, uuid, timestamptz), public.create_review_request(uuid, timestamptz),
  public.assign_review_internal(uuid, uuid, uuid, timestamptz), public.assign_review(uuid, uuid, uuid, timestamptz),
  public.reassign_review(uuid, uuid, uuid, timestamptz), public.reviewer_queue(uuid), public.coordinator_unassigned(uuid)
  to service_role;
