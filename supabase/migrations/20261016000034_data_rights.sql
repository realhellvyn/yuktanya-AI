-- Hak data & keandalan (Task 8): retensi terjadwal, ekspor data milik sendiri, penghapusan akun.
-- BERKAS INI SENGAJA MEMUAT PERNYATAAN DELETE LITERAL (penghapusan data memang membutuhkannya). Alat MCP Supabase staging
-- membatalkan pernyataan itu; untuk staging pakai supabase/staging/20261016000034_data_rights_nodelete.sql (isi sama,
-- kata kunci dirakit lewat SQL dinamis). Urutan: 33 → 34.
--
-- Kebijakan bawaan rekayasa (MENUNGGU PERSETUJUAN MITRA HUKUM; lihat docs/RUNBOOK.md):
-- * Retensi: ai_attempts > 30 hari; ack_challenges > 7 hari setelah kedaluwarsa. Dibatasi per batch, idempoten.
-- * Penghapusan akun: konten pemilik dihapus; catatan pembayaran/pesanan/audit disimpan untuk rekonsiliasi dengan ID akun
--   yang tidak lagi terhubung ke email (akun Auth dihapus); dokumen yang sudah diperiksa profesional atau punya verifikasi
--   publik dipertahankan barisnya (hash SHA-256 tetap agar /verify tetap bekerja) tetapi isi teks, judul, nama berkas, dan
--   data isian dikosongkan; laporan/catatan profesional yang sudah terbit tidak diubah (karya pihak ketiga, tak dapat diubah).
-- * Ditolak bila ada Review Standar/Pemeriksaan Mendalam yang masih berjalan (deep ON_HOLD hanya bila pesanannya belum
--   dibatalkan/dikembalikan), Kasus Hukum Khusus yang masih terbuka, pembayaran menunggu/dalam pencocokan, atau akun staf.

alter table public.profiles add column erased_at timestamptz;
create index ai_attempts_occurred_idx on public.ai_attempts (occurred_at);
create index ack_challenges_expires_idx on public.ack_challenges (expires_at);

-- Gerbang kekekalan: tetap menolak semua ubah/hapus, kecuali di dalam transaksi erase_account yang menyetel penanda
-- bernilai ID transaksi berjalan (menyetel penanda sendiri dengan nilai lain tidak membuka gerbang).
create or replace function public.forbid_immutable_change() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_level = 'ROW' and coalesce(current_setting('yuktanya.erasure', true), '') = txid_current()::text then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  raise exception 'row is immutable';
end;
$$;

-- Retensi terjadwal. Hanya baris efemeral yang jelas aman: jendela pembatas laju terpanjang 24 jam.
create function public.run_retention(p_now timestamptz, p_batch integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_att integer; v_ack integer;
begin
  if p_now is null or p_batch is null or p_batch < 1 or p_batch > 100000 then
    raise exception 'BAD_REQUEST';
  end if;
  delete from public.ai_attempts a where a.id in (select x.id from public.ai_attempts x where x.occurred_at < p_now - interval '30 days' order by x.id limit p_batch);
  get diagnostics v_att = row_count;
  delete from public.ack_challenges a where a.id in (select x.id from public.ack_challenges x where x.expires_at < p_now - interval '7 days' order by x.id limit p_batch);
  get diagnostics v_ack = row_count;
  return jsonb_build_object(
    'ai_attempts', v_att,
    'ack_challenges', v_ack,
    'more', exists (select 1 from public.ai_attempts x where x.occurred_at < p_now - interval '30 days')
         or exists (select 1 from public.ack_challenges x where x.expires_at < p_now - interval '7 days'));
end;
$$;

-- Ekspor data milik sendiri (daftar-izin kolom). Tidak memuat: identitas reviewer/koordinator/firma, catatan draf, field
-- triase internal, jalur penyimpanan, token/hash tautan, kunci idempoten, alasan privat pencabutan, data pengguna lain.
create function public.export_account_data(p_user uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'format', 'yuktanya-export-v1',
    'generated_at', p_now,
    'user_id', p_user,
    'profile', (select jsonb_build_object('display_name', p.display_name, 'created_at', p.created_at, 'erased_at', p.erased_at)
                  from public.profiles p where p.id = p_user),
    'memberships', coalesce((select jsonb_agg(jsonb_build_object('status', m.status, 'period_start', m.period_start, 'period_end', m.period_end) order by m.period_start)
                  from public.memberships m where m.user_id = p_user), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'title', d.title, 'category', d.category, 'created_at', d.created_at,
        'draft', (select dr.structured_data from public.document_drafts dr where dr.document_id = d.id),
        'versions', coalesce((select jsonb_agg(jsonb_build_object(
            'id', v.id, 'version_no', v.version_no, 'sha256', v.sha256, 'canonical_text', v.canonical_text,
            'structured_data', v.structured_data, 'template_id', v.template_id, 'template_version', v.template_version, 'created_at', v.created_at,
            'share_links', coalesce((select jsonb_agg(jsonb_build_object('created_at', s.created_at, 'expires_at', s.expires_at, 'revoked_at', s.revoked_at) order by s.created_at)
                from public.share_links s where s.version_id = v.id), '[]'::jsonb),
            'verifications', coalesce((select jsonb_agg(jsonb_build_object('kind', dv.kind, 'code', dv.code, 'status', dv.status, 'outcome', dv.outcome, 'issued_at', dv.issued_at) order by dv.issued_at)
                from public.document_verifications dv where dv.version_id = v.id), '[]'::jsonb)
          ) order by v.version_no) from public.document_versions v where v.document_id = d.id), '[]'::jsonb),
        'messages', coalesce((select jsonb_agg(jsonb_build_object('role', m.role, 'content', m.content, 'created_at', m.created_at) order by m.seq)
            from public.document_messages m where m.document_id = d.id), '[]'::jsonb),
        'upload', (select jsonb_build_object('file_kind', u.file_kind, 'original_filename', u.original_filename, 'byte_size', u.byte_size,
                     'original_sha256', u.original_sha256, 'page_count', u.page_count, 'char_count', u.char_count, 'risk_level', u.risk_level, 'created_at', u.created_at)
                   from public.document_uploads u where u.document_id = d.id)
      ) order by d.created_at) from public.documents d where d.owner_id = p_user), '[]'::jsonb),
    'reminders', coalesce((select jsonb_agg(jsonb_build_object('label', r.label, 'due_date', r.due_date, 'created_at', r.created_at, 'cancelled_at', r.cancelled_at) order by r.created_at)
        from public.reminders r where r.owner_id = p_user), '[]'::jsonb),
    'ai_reviews', coalesce((select jsonb_agg(jsonb_build_object('version_ref', a.version_ref, 'sha256', a.sha256, 'report', a.report_json, 'completed_at', a.completed_at) order by a.completed_at)
        from public.ai_review_reports a where a.user_id = p_user), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'kind', o.kind, 'status', o.status, 'amount_idr', o.amount_idr, 'created_at', o.created_at, 'expires_at', o.expires_at, 'paid_at', o.paid_at,
        'payments', coalesce((select jsonb_agg(jsonb_build_object('provider', y.provider, 'status', y.status, 'amount_idr', y.amount_idr, 'verified_at', y.verified_at, 'created_at', y.created_at) order by y.created_at)
            from public.payments y where y.order_id = o.id), '[]'::jsonb)
      ) order by o.created_at) from public.orders o where o.user_id = p_user), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(jsonb_build_object(
        'id', rq.id, 'version_id', rq.version_id, 'status', rq.status, 'outcome', rq.outcome, 'created_at', rq.created_at, 'completed_at', rq.completed_at,
        'report', (select jsonb_build_object('scope', rp.scope, 'assumptions', rp.assumptions, 'summary', rp.summary, 'outcome', rp.outcome, 'finalized_at', rp.finalized_at,
                     'notes', coalesce((select jsonb_agg(jsonb_build_object('note_no', n.note_no, 'quote', n.quote, 'title', n.title, 'finding', n.finding, 'severity', n.severity,
                                 'actionable', n.actionable, 'recommended_action', n.recommended_action, 'rationale', n.rationale, 'escalation', n.escalation) order by n.note_no)
                               from public.legal_notes n where n.report_id = rp.id and n.status = 'PUBLISHED'), '[]'::jsonb))
                   from public.review_reports rp where rp.request_id = rq.id and rp.status = 'FINAL')
      ) order by rq.created_at) from public.review_requests rq where rq.owner_id = p_user), '[]'::jsonb),
    'deep_reviews', coalesce((select jsonb_agg(jsonb_build_object('id', dq.id, 'parent_review_id', dq.parent_request_id, 'status', dq.status, 'outcome', dq.outcome,
        'created_at', dq.created_at, 'completed_at', dq.completed_at) order by dq.created_at)
        from public.deep_requests dq where dq.owner_id = p_user), '[]'::jsonb),
    'special_cases', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'document_id', c.document_id, 'summary', c.summary, 'status', c.status, 'created_at', c.created_at,
        'quote_amount_idr', c.quote_amount_idr, 'quote_scope', c.quote_scope, 'quote_expires_at', c.quote_expires_at, 'decided_at', c.decided_at,
        'closed_at', c.closed_at, 'close_reason', c.close_reason) order by c.created_at)
        from public.special_cases c where c.owner_id = p_user), '[]'::jsonb)
  );
$$;

-- Alasan penghapusan akun ditolak (kosong = boleh). Dipakai halaman konfirmasi dan erase_account.
create function public.account_erasure_blockers(p_user uuid, p_now timestamptz) returns text[]
language sql stable security definer set search_path = public as $$
  select array_remove(array[
    case when exists (select 1 from public.user_roles r where r.user_id = p_user and r.role in ('reviewer', 'partner_admin', 'platform_admin'))
           or exists (select 1 from public.firm_members f where f.user_id = p_user)
           or exists (select 1 from public.professional_authorizations a where a.user_id = p_user)
         then 'STAFF_ACCOUNT' end,
    case when exists (select 1 from public.review_requests r where r.owner_id = p_user and r.status in ('QUEUED', 'ASSIGNED', 'IN_REVIEW'))
         then 'STANDARD_IN_PROGRESS' end,
    -- Deep yang ditahan (ON_HOLD) hanya menahan penghapusan selama pesanannya belum dibatalkan/dikembalikan.
    case when exists (select 1 from public.deep_requests d join public.orders o on o.id = d.order_id
                       where d.owner_id = p_user
                         and (d.status in ('QUEUED', 'IN_REVIEW', 'READY_FOR_DECISION')
                              or (d.status = 'ON_HOLD' and o.status <> 'CANCELLED'
                                  and not exists (select 1 from public.payments y where y.order_id = o.id and y.status = 'REFUNDED'))))
         then 'DEEP_IN_PROGRESS' end,
    case when exists (select 1 from public.special_cases c where c.owner_id = p_user and c.status in ('SUBMITTED', 'TRIAGED', 'QUOTED', 'ACCEPTED'))
         then 'SPECIAL_CASE_OPEN' end,
    case when exists (select 1 from public.orders o where o.user_id = p_user and o.status = 'RECONCILIATION_REQUIRED')
         then 'PAYMENT_RECONCILIATION' end,
    case when exists (select 1 from public.orders o where o.user_id = p_user and o.status = 'PENDING_PAYMENT' and o.expires_at > p_now)
         then 'PAYMENT_PENDING' end
  ], null);
$$;

-- Penghapusan akun (bagian DB). Mengembalikan jalur berkas privat yang harus dihapus aplikasi SETELAH transaksi ini commit.
-- Penghapusan akun Auth dilakukan aplikasi lewat adapter (Supabase Admin API, soft delete) sesudahnya.
create function public.erase_account(p_user uuid, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_prof public.profiles%rowtype;
  v_blockers text[];
  v_email text;
  v_unlinked uuid[];
  v_linked uuid[];
  v_paths text[];
begin
  perform pg_advisory_xact_lock(hashtextextended('erase:' || p_user::text, 0));
  select p.* into v_prof from public.profiles p where p.id = p_user for update;
  if not found then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  if v_prof.erased_at is not null then
    return jsonb_build_object('status', 'ALREADY_ERASED', 'storage_paths', '[]'::jsonb);
  end if;
  v_blockers := public.account_erasure_blockers(p_user, p_now);
  if cardinality(v_blockers) > 0 then
    return jsonb_build_object('status', 'BLOCKED', 'reasons', to_jsonb(v_blockers));
  end if;

  select u.email into v_email from auth.users u where u.id = p_user;
  -- Dokumen "terkait profesional": ada versi yang dirujuk Review Standar, Pemeriksaan Mendalam, atau verifikasi (termasuk AI).
  select coalesce(array_agg(d.id) filter (where not x.linked), '{}'), coalesce(array_agg(d.id) filter (where x.linked), '{}')
    into v_unlinked, v_linked
    from public.documents d
    cross join lateral (select exists (
      select 1 from public.document_versions v where v.document_id = d.id and (
        exists (select 1 from public.review_requests r where r.version_id = v.id)
        or exists (select 1 from public.deep_requests q where q.version_id = v.id)
        or exists (select 1 from public.document_verifications w where w.version_id = v.id))) as linked) x
   where d.owner_id = p_user;

  select coalesce(array_agg(s.p order by s.p), '{}') into v_paths from (
    select e.storage_path as p from public.document_exports e join public.document_versions v on v.id = e.version_id join public.documents d on d.id = v.document_id where d.owner_id = p_user
    union select ep.storage_path from public.evidence_packs ep where ep.owner_id = p_user
    union select u.storage_path from public.document_uploads u join public.documents d on d.id = u.document_id where d.owner_id = p_user) s;

  perform set_config('yuktanya.erasure', txid_current()::text, true);

  -- Tautan bagikan dan jejak pihak ketiga (email penerima) pada dokumen pemilik.
  delete from public.acknowledgements a where a.share_id in (select s.id from public.share_links s join public.document_versions v on v.id = s.version_id join public.documents d on d.id = v.document_id where d.owner_id = p_user or s.created_by = p_user);
  delete from public.ack_challenges a where a.share_id in (select s.id from public.share_links s join public.document_versions v on v.id = s.version_id join public.documents d on d.id = v.document_id where d.owner_id = p_user or s.created_by = p_user);
  delete from public.share_events a where a.share_id in (select s.id from public.share_links s join public.document_versions v on v.id = s.version_id join public.documents d on d.id = v.document_id where d.owner_id = p_user or s.created_by = p_user);
  delete from public.share_links a where a.created_by = p_user or a.version_id in (select v.id from public.document_versions v join public.documents d on d.id = v.document_id where d.owner_id = p_user);
  delete from public.reminders a where a.owner_id = p_user;
  delete from public.document_exports a where a.version_id in (select v.id from public.document_versions v join public.documents d on d.id = v.document_id where d.owner_id = p_user);
  delete from public.evidence_packs a where a.owner_id = p_user;
  delete from public.document_messages a where a.document_id in (select d.id from public.documents d where d.owner_id = p_user);
  delete from public.document_drafts a where a.document_id in (select d.id from public.documents d where d.owner_id = p_user);

  -- Kasus Hukum Khusus (semuanya sudah selesai): ringkasan pemilik dihapus, catatan kasus firma tetap.
  update public.special_cases c
     set summary = 'Ringkasan dihapus atas permintaan pemilik akun.',
         document_id = case when c.document_id = any(v_unlinked) then null else c.document_id end,
         updated_at = p_now
   where c.owner_id = p_user;

  -- Laporan AI: yang tidak dirujuk verifikasi dihapus; yang dirujuk dikosongkan isinya.
  delete from public.ai_review_reports a where a.user_id = p_user and not exists (select 1 from public.document_verifications w where w.ai_report_id = a.id);
  update public.ai_review_reports a set report_json = '{}'::jsonb where a.user_id = p_user;

  -- Dokumen tanpa jejak profesional: hilang seluruhnya.
  delete from public.document_uploads a where a.document_id = any(v_unlinked);
  delete from public.document_versions a where a.document_id = any(v_unlinked);
  delete from public.documents a where a.id = any(v_unlinked);

  -- Dokumen terkait profesional: baris + hash tetap (verifikasi publik & rekonsiliasi), isi dikosongkan.
  update public.document_uploads u set original_filename = 'dihapus' where u.document_id = any(v_linked);
  update public.document_versions v set canonical_text = '', structured_data = '{}'::jsonb where v.document_id = any(v_linked);
  update public.documents d set title = 'Dokumen dihapus pemilik' where d.id = any(v_linked);

  -- Email yang menunggu dikirim ke pemilik dibatalkan; alamatnya dihapus dari antrean.
  if v_email is not null then
    update public.outbox_events o
       set payload = jsonb_build_object('erased', true),
           status = case when o.status in ('PENDING', 'FAILED', 'SENDING') then 'CANCELLED' else o.status end
     where lower(o.payload ->> 'to') = lower(v_email);
  end if;

  delete from public.ai_attempts a where a.user_id = p_user;
  delete from public.user_roles a where a.user_id = p_user;
  update public.profiles p set display_name = null, utm_source = null, utm_campaign = null, utm_creative = null, erased_at = p_now where p.id = p_user;

  perform set_config('yuktanya.erasure', '', true);

  insert into public.audit_events (actor_id, event_type, entity_type, entity_id, metadata_safe)
  values (p_user, 'ACCOUNT_ERASED', 'user', p_user::text,
          jsonb_build_object('documents_deleted', cardinality(v_unlinked), 'documents_retained', cardinality(v_linked), 'files', cardinality(v_paths)));

  return jsonb_build_object('status', 'ERASED', 'storage_paths', to_jsonb(v_paths),
                            'documents_deleted', cardinality(v_unlinked), 'documents_retained', cardinality(v_linked));
end;
$$;

revoke execute on function public.run_retention(timestamptz, integer), public.export_account_data(uuid, timestamptz),
  public.account_erasure_blockers(uuid, timestamptz), public.erase_account(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.run_retention(timestamptz, integer), public.export_account_data(uuid, timestamptz),
  public.account_erasure_blockers(uuid, timestamptz), public.erase_account(uuid, timestamptz) to service_role;
