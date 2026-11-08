/**
 * Username qoidasi: kichik harflarda saqlanadi, noyoblik harf o'lchamidan qat'i nazar
 * (bazada lower(username) bo'yicha unique index). Lotin harflari, raqamlar, "_" va ".", 3-30 belgi.
 * Kirishda qanday yozilsa ham qabul qilinadi: bosh-oxiridagi bo'shliq va boshidagi "@" olib tashlanadi.
 */
export const USERNAME_RE = /^[a-z0-9_.]{3,30}$/;

export const normalizeUsername = (raw: string) =>
  raw.trim().replace(/^@+/, '').toLowerCase();

export const isValidUsername = (value: string) => USERNAME_RE.test(value);

/** user jadvalidagi qo'lda boshqariladigan indekslar (migratsiya va yangi baza uchun bir xil) */
export const USER_INDEX_SQL = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_user_username_lower" ON "user" (lower("username"))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_user_account_id" ON "user" ("account_id")`,
];
