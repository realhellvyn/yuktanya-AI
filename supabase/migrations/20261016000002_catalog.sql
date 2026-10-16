-- Katalog produk dan hak. Hak ditentukan server; klien tidak punya akses tulis maupun baca.

create table public.products (
  key text primary key,
  kind text not null check (kind in ('PLAN', 'MEMBERSHIP', 'BUNDLE')),
  created_at timestamptz not null default now()
);

create table public.product_grants (
  product_key text not null references public.products(key),
  grant_key text not null,
  int_value integer not null check (int_value >= 0),
  primary key (product_key, grant_key)
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  created_at timestamptz not null default now(),
  check (period_end > period_start)
);
create index memberships_user_idx on public.memberships (user_id, status);

-- Pemetaan kunci fitur Vault ke plan. Sengaja kosong: default Free vs Member belum diputuskan pemilik.
create table public.feature_plan_map (
  feature_key text not null,
  plan text not null check (plan in ('FREE', 'MEMBER')),
  primary key (feature_key, plan)
);

alter table public.products enable row level security;
alter table public.product_grants enable row level security;
alter table public.memberships enable row level security;
alter table public.feature_plan_map enable row level security;
revoke all on public.products, public.product_grants, public.memberships, public.feature_plan_map from anon, authenticated;

-- Nilai terkunci v8 (Free 20/1/2, Member 60/5/10). Diuji sama dengan src/lib/pricing/catalog.ts.
insert into public.products (key, kind) values ('PLAN_FREE', 'PLAN'), ('PLAN_MEMBER', 'PLAN');
insert into public.product_grants (product_key, grant_key, int_value) values
  ('PLAN_FREE', 'messages', 20), ('PLAN_FREE', 'documents', 1), ('PLAN_FREE', 'ai_reviews', 2),
  ('PLAN_MEMBER', 'messages', 60), ('PLAN_MEMBER', 'documents', 5), ('PLAN_MEMBER', 'ai_reviews', 10);

create function public.resolve_entitlement(p_user uuid, p_now timestamptz)
returns table (plan text, messages integer, documents integer, ai_reviews integer, features text[])
language sql stable security definer set search_path = public as $$
  with resolved as (
    select case when exists (
      select 1 from public.memberships m
       where m.user_id = p_user and m.status = 'ACTIVE'
         and m.period_start <= p_now and p_now < m.period_end
    ) then 'MEMBER' else 'FREE' end as plan
  )
  select r.plan,
         (select g.int_value from public.product_grants g where g.product_key = 'PLAN_' || r.plan and g.grant_key = 'messages'),
         (select g.int_value from public.product_grants g where g.product_key = 'PLAN_' || r.plan and g.grant_key = 'documents'),
         (select g.int_value from public.product_grants g where g.product_key = 'PLAN_' || r.plan and g.grant_key = 'ai_reviews'),
         coalesce((select array_agg(f.feature_key order by f.feature_key) from public.feature_plan_map f where f.plan = r.plan), '{}')
    from resolved r;
$$;
revoke execute on function public.resolve_entitlement(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.resolve_entitlement(uuid, timestamptz) to service_role;
