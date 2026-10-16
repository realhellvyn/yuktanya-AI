-- Kunci fitur Vault per plan (data, bukan kode) dan outbox transaksional untuk email.

create function public.has_feature(p_user uuid, p_feature text, p_now timestamptz default now()) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p_feature = any (e.features) from public.resolve_entitlement(p_user, p_now) e), false);
$$;

-- Hanya platform_admin; setiap perubahan dicatat di audit_events.
create function public.set_feature_plan(p_admin uuid, p_feature text, p_plan text, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.user_roles r where r.user_id = p_admin and r.role = 'platform_admin') then
    raise exception 'FORBIDDEN';
  end if;
  if p_feature not in ('vault.share', 'vault.reminders', 'vault.evidence_pack') then
    raise exception 'INVALID_FEATURE';
  end if;
  if p_plan not in ('FREE', 'MEMBER') then
    raise exception 'INVALID_PLAN';
  end if;
  if p_enabled then
    insert into public.feature_plan_map (feature_key, plan) values (p_feature, p_plan) on conflict do nothing;
  else
    delete from public.feature_plan_map f where f.feature_key = p_feature and f.plan = p_plan;
  end if;
  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_admin, 'feature_map_changed', 'feature_plan_map', p_feature || ':' || p_plan, jsonb_build_object('enabled', p_enabled));
end;
$$;

create table public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  status text not null default 'PENDING' check (status in ('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED')),
  attempts integer not null default 0,
  available_at timestamptz not null,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index outbox_due_idx on public.outbox_events (status, available_at);
alter table public.outbox_events enable row level security;
revoke all on public.outbox_events from anon, authenticated;

create function public.enqueue_outbox(p_kind text, p_payload jsonb, p_dedupe text, p_available timestamptz) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.outbox_events (kind, payload, dedupe_key, available_at) values (p_kind, p_payload, p_dedupe, p_available)
  on conflict (dedupe_key) do nothing returning id into v_id;
  if v_id is null then
    select o.id into v_id from public.outbox_events o where o.dedupe_key = p_dedupe;
  end if;
  return v_id;
end;
$$;

-- Klaim dengan lease: baris SENDING yang lease-nya habis diklaim ulang; yang sudah 5 percobaan menjadi FAILED.
create function public.claim_outbox(p_now timestamptz, p_limit integer, p_lease_seconds integer) returns setof public.outbox_events
language plpgsql security definer set search_path = public as $$
begin
  update public.outbox_events o set status = 'FAILED', last_error = coalesce(o.last_error, 'lease expired after max attempts')
   where o.status = 'SENDING' and o.lease_until <= p_now and o.attempts >= 5;
  return query
  with due as (
    select o.id from public.outbox_events o
     where (o.status = 'PENDING' and o.available_at <= p_now)
        or (o.status = 'SENDING' and o.lease_until <= p_now and o.attempts < 5)
     order by o.available_at, o.created_at
     limit p_limit for update skip locked
  )
  update public.outbox_events o
     set status = 'SENDING', attempts = o.attempts + 1, lease_until = p_now + make_interval(secs => p_lease_seconds)
    from due where o.id = due.id
  returning o.*;
end;
$$;

create function public.complete_outbox(p_id uuid) returns void
language sql security definer set search_path = public as $$
  update public.outbox_events o set status = 'SENT', payload = '{}'::jsonb, sent_at = now(), lease_until = null
   where o.id = p_id and o.status = 'SENDING';
$$;

create function public.fail_outbox(p_id uuid, p_error text, p_retry_at timestamptz) returns void
language sql security definer set search_path = public as $$
  update public.outbox_events o
     set status = case when o.attempts >= 5 then 'FAILED' else 'PENDING' end,
         available_at = p_retry_at, lease_until = null, last_error = left(p_error, 500)
   where o.id = p_id and o.status = 'SENDING';
$$;

revoke execute on function
  public.has_feature(uuid, text, timestamptz), public.set_feature_plan(uuid, text, text, boolean),
  public.enqueue_outbox(text, jsonb, text, timestamptz), public.claim_outbox(timestamptz, integer, integer),
  public.complete_outbox(uuid), public.fail_outbox(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.has_feature(uuid, text, timestamptz), public.set_feature_plan(uuid, text, text, boolean),
  public.enqueue_outbox(text, jsonb, text, timestamptz), public.claim_outbox(timestamptz, integer, integer),
  public.complete_outbox(uuid), public.fail_outbox(uuid, text, timestamptz)
  to service_role;
