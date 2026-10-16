// Satu sumber menu admin: sidebar/menu HP dan daftar modul di halaman ringkasan.
export const ADMIN_NAV = [
  { href: "/admin", label: "Ringkasan" },
  { href: "/admin/payments", label: "Pembayaran" },
  { href: "/admin/routing", label: "Perutean review" },
  { href: "/admin/partners", label: "Mitra hukum" },
  { href: "/admin/cases", label: "Kasus khusus" },
  { href: "/admin/verifications", label: "Pencabutan verifikasi" },
  { href: "/admin/rubric", label: "Persetujuan rubrik Enhanced" },
  { href: "/admin/features", label: "Kunci fitur per plan" },
  { href: "/admin/analytics", label: "Funnel" },
  { href: "/admin/ai-usage", label: "Pemakaian AI" },
  { href: "/admin/reviews", label: "Operasi review" },
  { href: "/admin/revenue", label: "Pendapatan" },
  { href: "/admin/users", label: "Pengguna" },
  { href: "/admin/incidents", label: "Insiden" },
] as const;
