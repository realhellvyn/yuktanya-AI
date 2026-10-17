// Satu sumber menu admin: sidebar/menu HP dan daftar modul di halaman ringkasan.
export const ADMIN_NAV = [
  { href: "/admin", label: "Ringkasan" },
  { href: "/admin/payments", label: "Pembayaran" },
  { href: "/admin/routing", label: "Penugasan pemeriksaan" },
  { href: "/admin/partners", label: "Mitra hukum" },
  { href: "/admin/cases", label: "Special Legal Case" },
  { href: "/admin/verifications", label: "Pencabutan verifikasi" },
  { href: "/admin/rubric", label: "Persetujuan rubrik Enhanced" },
  { href: "/admin/features", label: "Fitur per paket" },
  { href: "/admin/analytics", label: "Analitik dan tren" },
  { href: "/admin/ai-usage", label: "Pemakaian AI" },
  { href: "/admin/reviews", label: "Kinerja pemeriksaan" },
  { href: "/admin/revenue", label: "Pendapatan" },
  { href: "/admin/users", label: "Pengguna" },
  { href: "/admin/incidents", label: "Insiden" },
] as const;
