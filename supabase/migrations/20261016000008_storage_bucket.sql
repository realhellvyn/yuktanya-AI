-- Bucket privat untuk ekspor dokumen. No-op bila skema storage tidak ada (Postgres tes lokal).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict (id) do nothing;
  end if;
end $$;
