-- Percakapan pembuatan dokumen (full-AI). Hanya dibaca/ditulis server lewat kepemilikan dokumen; RLS default-deny.
create table public.document_messages (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  document_id uuid not null references public.documents(id),
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(content) between 1 and 4000),
  answered boolean not null default false,
  idempotency_key text,
  created_at timestamptz not null default now()
);
create unique index document_messages_user_key on public.document_messages (document_id, idempotency_key) where role = 'user';
create index document_messages_doc_seq on public.document_messages (document_id, seq);
alter table public.document_messages enable row level security;
revoke all on public.document_messages from anon, authenticated;
