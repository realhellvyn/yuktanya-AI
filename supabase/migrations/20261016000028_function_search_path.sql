-- Penutup peringatan advisor: fungsi pembantu/trigger murni tanpa search_path tetap. Tidak mengubah perilaku.
alter function public.forbid_immutable_change() set search_path = public;
alter function public.forbid_mutation() set search_path = public;
alter function public.guard_deep_final() set search_path = public;
alter function public.guard_final_rows() set search_path = public;
alter function public.guard_verification_update() set search_path = public;
alter function public.reservation_ttl() set search_path = public;
alter function public.usage_count(uuid, date, text, timestamptz) set search_path = public;
alter function public.wib_day(timestamptz) set search_path = public;
