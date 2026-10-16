-- Skema inti: profil, peran, audit append-only, event produk. RLS default-deny.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  utm_source text,
  utm_campaign text,
  utm_creative text,
  created_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'reviewer', 'partner_admin', 'platform_admin')),
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  event_type text not null,
  entity_type text,
  entity_id text,
  metadata_safe jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.product_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  event_name text not null,
  entity_type text,
  entity_id text,
  dedupe_key text not null unique,
  occurred_at timestamptz not null default now(),
  metadata_safe jsonb not null default '{}'::jsonb
);

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_events enable row level security;
alter table public.product_events enable row level security;

-- Tutup semua akses klien, lalu buka seperlunya.
revoke all on public.profiles, public.user_roles, public.audit_events, public.product_events
  from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Pengguna boleh membaca peran miliknya (untuk guard rute); tidak ada tulis dari klien.
grant select on public.user_roles to authenticated;
create policy user_roles_select_own on public.user_roles for select to authenticated using (user_id = auth.uid());

-- audit_events: append-only, termasuk untuk peran yang melewati RLS.
create function public.forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'audit_events is append-only';
end;
$$;
create trigger audit_events_no_update_delete before update or delete on public.audit_events
  for each row execute function public.forbid_mutation();
create trigger audit_events_no_truncate before truncate on public.audit_events
  for each statement execute function public.forbid_mutation();

-- Peran awal selalu 'user'; tidak pernah dibaca dari metadata yang dapat diedit user.
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id);
  insert into public.user_roles (user_id, role) values (new.id, 'user');
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Atribusi sumber iklan: sentuhan pertama saja, hanya dipanggil server.
create function public.set_attribution(p_user uuid, p_source text, p_campaign text, p_creative text)
returns void language sql security definer set search_path = public as $$
  update public.profiles
     set utm_source = coalesce(utm_source, p_source),
         utm_campaign = coalesce(utm_campaign, p_campaign),
         utm_creative = coalesce(utm_creative, p_creative)
   where id = p_user;
$$;
revoke execute on function public.set_attribution(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.set_attribution(uuid, text, text, text) to service_role;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.forbid_mutation() from public, anon, authenticated;
