import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { EntityManager } from 'typeorm';

/** Shartnoma raqami: filial harfi + 6 xona (A000014) */
export const CONTRACT_NUMBER_RE = /^[A-Za-z]\d{6}$/;

/**
 * Filial harfi - server sozlamasi CONTRACT_PREFIX (kakos-one = A, kakos-two = B).
 * Admin o'zgartira olmaydi; kelajakda login serveridan keladi (docs/5-superadmin-reja.md, 11).
 */
export function contractPrefix(): string {
  const p = (process.env.CONTRACT_PREFIX ?? '').trim().toUpperCase();
  if (!/^[A-Z]$/.test(p)) {
    throw new InternalServerErrorException(
      'Filial harfi (CONTRACT_PREFIX) server sozlamasida berilmagan',
    );
  }
  return p;
}

export const formatContractNumber = (prefix: string, n: number) =>
  `${prefix}${String(n).padStart(6, '0')}`;

/**
 * Keyingi raqamni OLADI - faqat shartnoma yaratish tranzaksiyasi ICHIDA chaqiriladi.
 * Hisoblagich qatori tranzaksiya oxirigacha qulflanadi: ikkinchi xodim kutadi va keyingi raqamni oladi;
 * tranzaksiya bekor bo'lsa raqam ham qaytadi (bo'shliq qolmaydi).
 */
export async function allocateContractNumber(
  manager: EntityManager,
): Promise<string> {
  const prefix = contractPrefix(); // sozlanmagan bo'lsa - qulfdan OLDIN xato
  // Qator yo'q bo'lsa (bo'sh baza) - yaratiladi
  await manager.query(
    `INSERT INTO "contract_counter" ("id", "last_value") VALUES (1, 0) ON CONFLICT ("id") DO NOTHING`,
  );
  const rows = await manager.query<{ last_value: number }[]>(
    `SELECT "last_value" FROM "contract_counter" WHERE "id" = 1 FOR UPDATE`,
  );
  const next = Number(rows[0].last_value) + 1;
  if (next > 999_999) {
    throw new BadRequestException('Dogovor raqamlari tugadi (999999)');
  }
  await manager.query(
    `UPDATE "contract_counter" SET "last_value" = $1 WHERE "id" = 1`,
    [next],
  );
  return formatContractNumber(prefix, next);
}

/** Keyingi raqam (faqat ko'rsatish uchun, band qilinmaydi) */
export async function peekContractNumber(manager: EntityManager) {
  const prefix = contractPrefix();
  const rows = await manager.query<{ last_value: number }[]>(
    `SELECT "last_value" FROM "contract_counter" WHERE "id" = 1`,
  );
  const last = Number(rows[0]?.last_value ?? 0);
  return { prefix, next: formatContractNumber(prefix, last + 1) };
}
