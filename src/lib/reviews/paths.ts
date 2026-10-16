// Setelah terbit, penugasan berakhir sehingga halaman editor tidak lagi dapat dibuka oleh reviewer; arahkan ke dashboard mitra.
export const afterPublishPath = (status: string): string => `/partner?done=${encodeURIComponent(status)}`;

export const paymentReference = (paymentId: string): string => `YK-${paymentId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
