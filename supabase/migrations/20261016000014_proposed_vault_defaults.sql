-- USULAN, bukan keputusan pemilik: fitur Vault berbadan hanya untuk MEMBER (opsi A). Platform admin dapat mengubahnya
-- lewat set_feature_plan (diaudit). Dipisahkan agar mudah dicabut atau diganti.
insert into public.feature_plan_map (feature_key, plan) values
  ('vault.share', 'MEMBER'), ('vault.reminders', 'MEMBER'), ('vault.evidence_pack', 'MEMBER')
on conflict do nothing;
