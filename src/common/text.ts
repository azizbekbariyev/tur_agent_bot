/** ILIKE uchun foydalanuvchi matnidagi %, _ va \ belgilarini ekranlaydi */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

/**
 * Telefon raqamini +998XXXXXXXXX ko'rinishiga keltiradi.
 * Aniqlab bo'lmasa (masalan, xorijiy raqam) - faqat raqamlar bilan "+..." qaytadi,
 * bo'sh bo'lsa null.
 */
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 9) return `+998${digits}`;
  if (digits.length === 12 && digits.startsWith('998')) return `+${digits}`;
  if (digits.length < 7) return null;
  return `+${digits}`;
}

/** Telegram username: '@' va havolani olib tashlaydi */
export function normalizeTelegram(raw?: string | null): string | null {
  if (!raw) return null;
  const v = raw
    .trim()
    .replace(/^https?:\/\/t\.me\//i, '')
    .replace(/^@/, '');
  return v ? v : null;
}
