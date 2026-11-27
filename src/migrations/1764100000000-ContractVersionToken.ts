import { randomBytes } from 'crypto';
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 8-bosqich (QR ochiq sahifa): har kvitansiya versiyasining o'z ochiq tokeni.
 * - contract_versions.public_token: 32 bayt tasodifiy (base64url, 43 belgi), noyob, NOT NULL.
 * - Mavjud versiyalarga ham token beriladi. Versiyalar trigger bilan o'zgarmas (UPDATE taqiqlangan),
 *   shuning uchun faqat shu to'ldirish vaqtida foydalanuvchi triggerlari o'chirib turiladi (bitta tranzaksiyada).
 *   Snapshot va boshqa ustunlar o'zgarmaydi.
 * - Jadval yo'q bo'lsa (shartnoma bo'limi hali yo'q baza) - hech narsa qilmaydi.
 */
export class ContractVersionToken1764100000000 implements MigrationInterface {
  name = 'ContractVersionToken1764100000000';

  public async up(q: QueryRunner): Promise<void> {
    const t = (await q.query(
      `SELECT to_regclass('public.contract_versions') AS t`,
    )) as { t: string | null }[];
    if (!t[0]?.t) return;

    await q.query(
      `ALTER TABLE "contract_versions" ADD COLUMN IF NOT EXISTS "public_token" character varying(64)`,
    );

    const rows = (await q.query(
      `SELECT "id" FROM "contract_versions" WHERE "public_token" IS NULL ORDER BY "id"`,
    )) as { id: number }[];
    if (rows.length) {
      await q.query(`ALTER TABLE "contract_versions" DISABLE TRIGGER USER`);
      for (const r of rows) {
        await q.query(
          `UPDATE "contract_versions" SET "public_token" = $1 WHERE "id" = $2`,
          [randomBytes(32).toString('base64url'), r.id],
        );
      }
      await q.query(`ALTER TABLE "contract_versions" ENABLE TRIGGER USER`);
    }

    await q.query(
      `ALTER TABLE "contract_versions" ALTER COLUMN "public_token" SET NOT NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_contract_versions_public_token" ON "contract_versions" ("public_token")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    const t = (await q.query(
      `SELECT to_regclass('public.contract_versions') AS t`,
    )) as { t: string | null }[];
    if (!t[0]?.t) return;
    await q.query(`DROP INDEX IF EXISTS "UQ_contract_versions_public_token"`);
    await q.query(
      `ALTER TABLE "contract_versions" DROP COLUMN IF EXISTS "public_token"`,
    );
  }
}
