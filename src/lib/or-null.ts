// Pencarian pendukung halaman yang boleh gagal tanpa menjatuhkan seluruh halaman: galat → null, dicatat hanya nama
// kejadian dan nama galat (pesan galat dapat memuat data pribadi/SQL, jadi tidak pernah dicatat).
export async function orNull<T>(p: Promise<T>, event: string, log: (line: string) => void = console.error): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    log(JSON.stringify({ event, error: e instanceof Error ? e.name : "unknown" }));
    return null;
  }
}
