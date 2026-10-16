-- Pengingat tenggat (opt-in). Email dijadwalkan lewat outbox pukul 08.00 WIB; hanya label dan tanggal yang dikirim.
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  version_id uuid not null references public.document_versions(id),
  spec_id text not null,
  label text not null,
  due_date date not null,
  offsets integer[] not null,
  created_at timestamptz not null,
  cancelled_at timestamptz
);
create index reminders_active_idx on public.reminders (owner_id, version_id, spec_id) where cancelled_at is null;
alter table public.reminders enable row level security;
revoke all on public.reminders from anon, authenticated;

create function public.cancel_reminders(p_user uuid, p_version uuid, p_spec text, p_now timestamptz) returns void
language plpgsql security definer set search_path = public as $$
declare v_old record;
begin
  for v_old in
    update public.reminders r set cancelled_at = p_now
     where r.owner_id = p_user and r.version_id = p_version and r.spec_id = p_spec and r.cancelled_at is null
    returning r.id
  loop
    update public.outbox_events o set status = 'CANCELLED', payload = '{}'::jsonb
     where o.kind = 'reminder' and o.status = 'PENDING' and o.dedupe_key like 'reminder:' || v_old.id::text || ':%';
  end loop;
end;
$$;

create function public.set_reminders(p_user uuid, p_version uuid, p_spec text, p_label text, p_due date, p_offsets integer[], p_now timestamptz)
returns table (reminder_id uuid, scheduled integer)
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_email text; v_off integer; v_send date; v_n integer := 0;
begin
  perform 1 from public.document_versions v join public.documents d on d.id = v.document_id
   where v.id = p_version and d.owner_id = p_user;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if not public.has_feature(p_user, 'vault.reminders', p_now) then
    raise exception 'FEATURE_NOT_AVAILABLE';
  end if;
  if p_offsets is null or cardinality(p_offsets) not between 1 and 5
     or (select count(distinct o) from unnest(p_offsets) o) <> cardinality(p_offsets)
     or exists (select 1 from unnest(p_offsets) o where o < 0 or o > 365) then
    raise exception 'INVALID_OFFSETS';
  end if;
  select u.email into v_email from auth.users u where u.id = p_user;
  if v_email is null then
    raise exception 'NO_EMAIL';
  end if;

  perform public.cancel_reminders(p_user, p_version, p_spec, p_now);
  insert into public.reminders (owner_id, version_id, spec_id, label, due_date, offsets, created_at)
  values (p_user, p_version, p_spec, p_label, p_due, p_offsets, p_now) returning id into v_id;

  foreach v_off in array p_offsets loop
    v_send := p_due - v_off;
    if v_send >= public.wib_day(p_now) then
      perform public.enqueue_outbox('reminder',
        jsonb_build_object('to', v_email, 'label', p_label, 'due_date', p_due::text, 'offset', v_off),
        'reminder:' || v_id::text || ':' || v_off::text,
        (v_send::timestamp + time '08:00') at time zone 'Asia/Jakarta');
      v_n := v_n + 1;
    end if;
  end loop;
  return query select v_id, v_n;
end;
$$;

revoke execute on function public.cancel_reminders(uuid, uuid, text, timestamptz),
  public.set_reminders(uuid, uuid, text, text, date, integer[], timestamptz) from public, anon, authenticated;
grant execute on function public.cancel_reminders(uuid, uuid, text, timestamptz),
  public.set_reminders(uuid, uuid, text, text, date, integer[], timestamptz) to service_role;
