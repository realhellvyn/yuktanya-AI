// Dua kode berbeda untuk dokumen unggahan, dengan label yang tidak tertukar (docs/DECISIONS_AND_PRECEDENCE.md).
export function UploadHashes({ versionSha256, originalSha256 }: { versionSha256: string; originalSha256: string }) {
  return (
    <div className="space-y-1 text-sm text-muted">
      <p className="break-all">Kode teks yang diperiksa (dipakai di QR dan halaman verifikasi): {versionSha256}</p>
      <p className="break-all">Kode berkas asli yang Anda unggah: {originalSha256}</p>
      <p>Kedua kode ini memang berbeda. Kode pertama dihitung dari teks hasil pembacaan berkas, kode kedua dari berkas aslinya.</p>
    </div>
  );
}
