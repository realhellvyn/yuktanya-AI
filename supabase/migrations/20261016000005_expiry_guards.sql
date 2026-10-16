-- Finalisasi tidak boleh menghidupkan reservasi yang sudah kedaluwarsa (kapasitasnya mungkin sudah dipakai orang lain).

drop function public.finalize_usage(uuid);
create function public.finalize_usage(p_group uuid, p_now timestamptz default now()) returns void
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  update public.ai_usage_reservations r set status = 'FINALIZED'
   where r.group_id = p_group and r.status = 'RESERVED' and r.expires_at > p_now;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    return;
  end if;
  if exists (select 1 from public.ai_usage_reservations r where r.group_id = p_group and r.status = 'FINALIZED') then
    return;
  end if;
  if exists (select 1 from public.ai_usage_reservations r where r.group_id = p_group and r.status = 'RESERVED') then
    raise exception 'RESERVATION_EXPIRED';
  end if;
  raise exception 'RESERVATION_NOT_ACTIVE';
end;
$$;

drop function public.save_ai_review(uuid, uuid, uuid, text, text, jsonb, text);
create function public.save_ai_review(
  p_user uuid, p_group uuid, p_logical uuid, p_version_ref text, p_sha256 text, p_report jsonb, p_policy text,
  p_now timestamptz default now()
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_active integer;
begin
  select r.id into v_id from public.ai_review_reports r where r.logical_request_id = p_logical and r.user_id = p_user;
  if found then
    return v_id;
  end if;

  select count(*) into v_active from public.ai_usage_reservations u
   where u.group_id = p_group and u.user_id = p_user and u.status = 'RESERVED'
     and u.expires_at > p_now and u.quota_type in ('REVIEW', 'MESSAGE');
  if v_active <> 2 then
    raise exception 'RESERVATION_NOT_ACTIVE';
  end if;

  insert into public.ai_review_reports (user_id, logical_request_id, version_ref, sha256, report_json, analyzer_policy_version)
  values (p_user, p_logical, p_version_ref, p_sha256, p_report, p_policy)
  returning id into v_id;

  update public.ai_usage_reservations u set status = 'FINALIZED' where u.group_id = p_group and u.status = 'RESERVED';
  return v_id;
end;
$$;

revoke execute on function public.finalize_usage(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.finalize_usage(uuid, timestamptz) to service_role;
revoke execute on function public.save_ai_review(uuid, uuid, uuid, text, text, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.save_ai_review(uuid, uuid, uuid, text, text, jsonb, text, timestamptz) to service_role;
