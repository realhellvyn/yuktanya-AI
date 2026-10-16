-- Ledger kuota harian (WIB): reservasi atomik, idempotensi, pelepasan saat gagal.

create function public.wib_day(ts timestamptz) returns date
language sql stable as $$ select (ts at time zone 'Asia/Jakarta')::date $$;

-- Default rekayasa (bukan keputusan pemilik): reservasi yatim kedaluwarsa setelah 300 detik.
create function public.reservation_ttl() returns interval
language sql immutable as $$ select interval '300 seconds' $$;

create table public.ai_usage_reservations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  quota_type text not null check (quota_type in ('MESSAGE', 'DOCUMENT', 'REVIEW')),
  idempotency_key text not null,
  status text not null default 'RESERVED' check (status in ('RESERVED', 'FINALIZED', 'RELEASED')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (user_id, local_date, quota_type, idempotency_key)
);
create index ai_usage_reservations_group_idx on public.ai_usage_reservations (group_id);
create index ai_usage_reservations_count_idx on public.ai_usage_reservations (user_id, local_date, quota_type, status);

alter table public.ai_usage_reservations enable row level security;
revoke all on public.ai_usage_reservations from anon, authenticated;

create function public.usage_count(p_user uuid, p_date date, p_type text, p_now timestamptz) returns integer
language sql stable as $$
  select count(*)::integer from public.ai_usage_reservations r
   where r.user_id = p_user and r.local_date = p_date and r.quota_type = p_type
     and (r.status = 'FINALIZED' or (r.status = 'RESERVED' and r.expires_at > p_now))
$$;

create function public.reserve_usage(p_user uuid, p_kind text, p_key text, p_now timestamptz)
returns table (status text, group_id uuid, reset_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_date date := public.wib_day(p_now);
  v_reset timestamptz := ((public.wib_day(p_now) + 1)::timestamp at time zone 'Asia/Jakarta');
  v_primary text := case p_kind when 'AI_REVIEW' then 'REVIEW' else p_kind end;
  v_ent record;
  v_existing uuid;
  v_group uuid := gen_random_uuid();
  v_expires timestamptz := p_now + public.reservation_ttl();
  v_types text[];
  v_t text;
  v_rows integer;
begin
  if p_kind not in ('MESSAGE', 'DOCUMENT', 'AI_REVIEW') then
    raise exception 'INVALID_KIND';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || v_date::text, 0));
  select * into v_ent from public.resolve_entitlement(p_user, p_now);

  select r.group_id into v_existing from public.ai_usage_reservations r
   where r.user_id = p_user and r.local_date = v_date and r.quota_type = v_primary and r.idempotency_key = p_key
     and (r.status = 'FINALIZED' or (r.status = 'RESERVED' and r.expires_at > p_now));
  if found then
    return query select 'DUPLICATE'::text, v_existing, v_reset;
    return;
  end if;

  if p_kind = 'AI_REVIEW' and public.usage_count(p_user, v_date, 'REVIEW', p_now) >= v_ent.ai_reviews then
    return query select 'QUOTA_AI_REVIEW'::text, null::uuid, v_reset;
    return;
  end if;
  if p_kind in ('MESSAGE', 'AI_REVIEW') and public.usage_count(p_user, v_date, 'MESSAGE', p_now) >= v_ent.messages then
    return query select 'QUOTA_MESSAGE'::text, null::uuid, v_reset;
    return;
  end if;
  if p_kind = 'DOCUMENT' and public.usage_count(p_user, v_date, 'DOCUMENT', p_now) >= v_ent.documents then
    return query select 'QUOTA_DOCUMENT'::text, null::uuid, v_reset;
    return;
  end if;

  v_types := case p_kind when 'AI_REVIEW' then array['REVIEW', 'MESSAGE'] else array[p_kind] end;
  foreach v_t in array v_types loop
    -- Kunci yang sudah dilepas atau kedaluwarsa dihidupkan kembali; kunci hidup milik grup lain adalah konflik.
    insert into public.ai_usage_reservations as u (group_id, user_id, local_date, quota_type, idempotency_key, status, expires_at)
    values (v_group, p_user, v_date, v_t, p_key, 'RESERVED', v_expires)
    on conflict (user_id, local_date, quota_type, idempotency_key) do update
      set group_id = excluded.group_id, status = 'RESERVED', expires_at = excluded.expires_at, created_at = now()
      where u.status = 'RELEASED' or (u.status = 'RESERVED' and u.expires_at <= p_now);
    get diagnostics v_rows = row_count;
    if v_rows <> 1 then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
  end loop;

  return query select 'RESERVED'::text, v_group, v_reset;
end;
$$;

create function public.finalize_usage(p_group uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  update public.ai_usage_reservations r set status = 'FINALIZED' where r.group_id = p_group and r.status = 'RESERVED';
  get diagnostics v_n = row_count;
  if v_n = 0 and not exists (select 1 from public.ai_usage_reservations r where r.group_id = p_group and r.status = 'FINALIZED') then
    raise exception 'RESERVATION_NOT_ACTIVE';
  end if;
end;
$$;

create function public.release_usage(p_group uuid) returns void
language sql security definer set search_path = public as $$
  update public.ai_usage_reservations r set status = 'RELEASED' where r.group_id = p_group and r.status = 'RESERVED';
$$;

revoke execute on function public.usage_count(uuid, date, text, timestamptz),
  public.reserve_usage(uuid, text, text, timestamptz),
  public.finalize_usage(uuid), public.release_usage(uuid) from public, anon, authenticated;
grant execute on function public.usage_count(uuid, date, text, timestamptz),
  public.reserve_usage(uuid, text, text, timestamptz),
  public.finalize_usage(uuid), public.release_usage(uuid) to service_role;
