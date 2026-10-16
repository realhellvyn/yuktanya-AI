-- Persetujuan template. Template ada di kode; persetujuan terikat hash isinya, jadi perubahan isi membatalkan persetujuan.
create table public.document_templates (
  template_id text not null,
  version integer not null check (version > 0),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  approval_status text not null check (approval_status in ('DRAFT', 'APPROVED', 'RETIRED')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  primary key (template_id, version)
);
alter table public.document_templates enable row level security;
revoke all on public.document_templates from anon, authenticated;

create function public.is_template_approved(p_template_id text, p_version integer, p_hash text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.document_templates t
     where t.template_id = p_template_id and t.version = p_version
       and t.content_hash = p_hash and t.approval_status = 'APPROVED'
  );
$$;
revoke execute on function public.is_template_approved(text, integer, text) from public, anon, authenticated;
grant execute on function public.is_template_approved(text, integer, text) to service_role;
