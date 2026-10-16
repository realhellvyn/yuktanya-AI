-- Catatan analisis AI awal. Bukan pengesahan hukum dan bukan badge: tidak ada tabel verifikasi di fase ini.

create table public.ai_review_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  logical_request_id uuid not null unique,
  version_ref text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  report_json jsonb not null check (jsonb_typeof(report_json) = 'object'),
  analyzer_policy_version text not null,
  completed_at timestamptz not null default now()
);

alter table public.ai_review_reports enable row level security;
revoke all on public.ai_review_reports from anon, authenticated;
grant select on public.ai_review_reports to authenticated;
create policy ai_review_reports_select_own on public.ai_review_reports for select to authenticated using (user_id = auth.uid());

-- Menyimpan laporan hanya bila grup AI_REVIEW (REVIEW + MESSAGE) milik user masih RESERVED, lalu memfinalisasinya
-- dalam transaksi yang sama. Panggilan ulang dengan logical_request_id yang sama mengembalikan id yang sama.
create function public.save_ai_review(
  p_user uuid, p_group uuid, p_logical uuid, p_version_ref text, p_sha256 text, p_report jsonb, p_policy text
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
   where u.group_id = p_group and u.user_id = p_user and u.status = 'RESERVED' and u.quota_type in ('REVIEW', 'MESSAGE');
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
revoke execute on function public.save_ai_review(uuid, uuid, uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.save_ai_review(uuid, uuid, uuid, text, text, jsonb, text) to service_role;
