-- Menyalin versi menjadi dokumen baru berisi draf. Tidak mewarisi versi, ekspor, atau badge.
-- Kuota dokumen dikonsumsi saat salinan dibekukan pertama kali (freeze_version).
create function public.clone_document(p_user uuid, p_source_version uuid, p_key text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_src record;
  v_id uuid;
begin
  select d.category, d.template_id, d.template_version, d.title, v.structured_data into v_src
    from public.document_versions v join public.documents d on d.id = v.document_id
   where v.id = p_source_version and d.owner_id = p_user;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  v_id := public.create_document(p_user, v_src.category, v_src.template_id, v_src.template_version, v_src.title || ' (salinan)', p_key);
  -- Draf hanya diisi saat belum pernah disunting, sehingga panggilan ulang dengan kunci sama tidak menimpa pekerjaan.
  update public.document_drafts dr set structured_data = v_src.structured_data, revision = dr.revision + 1, updated_at = now()
   where dr.document_id = v_id and dr.revision = 0;
  return v_id;
end;
$$;
revoke execute on function public.clone_document(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.clone_document(uuid, uuid, text) to service_role;
