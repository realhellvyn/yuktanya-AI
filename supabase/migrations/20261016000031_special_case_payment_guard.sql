-- Menutup celah: order STANDARD_REVIEW yang dibuat SEBELUM kasus khusus dibuka tidak boleh mulai dibayar selama kasus
-- terbuka (SUBMITTED/TRIAGED/QUOTED/ACCEPTED). Pembayaran yang SUDAH dibuat (uang mungkin sudah dikirim) tetap dapat
-- diselesaikan lewat settlement; keputusan ini disengaja. Tanda tangan fungsi sama; hak eksekusi tetap (service_role).
-- Tanpa DROP/DELETE: dapat diterapkan apa adanya ke staging.

create or replace function public.create_payment(p_user uuid, p_order uuid, p_provider text, p_provider_ref text, p_now timestamptz) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_id uuid;
begin
  select o.* into v_o from public.orders o where o.id = p_order and o.user_id = p_user for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if v_o.status <> 'PENDING_PAYMENT' or v_o.expires_at <= p_now or v_o.amount_idr <= 0 then
    raise exception 'ORDER_NOT_PAYABLE';
  end if;
  if v_o.kind = 'STANDARD_REVIEW' and exists (
       select 1 from public.document_versions v join public.special_cases c on c.document_id = v.document_id
        where v.id = v_o.ref_id and c.status in ('SUBMITTED', 'TRIAGED', 'QUOTED', 'ACCEPTED')) then
    raise exception 'SPECIAL_CASE_OPEN';
  end if;
  insert into public.payments (order_id, provider, provider_ref, status, amount_idr)
  values (p_order, p_provider, p_provider_ref, 'PENDING', v_o.amount_idr) returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.create_payment(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_payment(uuid, uuid, text, text, timestamptz) to service_role;
