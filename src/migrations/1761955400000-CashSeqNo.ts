import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Kassaga ichki tartib raqami (ID 00001, 00002 ...). cash_number - mijozga
 * beriladigan dogovor raqami bo'lib qoladi ("0"/bo'sh - hali berilmagan).
 *
 * Eski kassalar created_at (teng bo'lsa id) bo'yicha raqamlanadi; yangilari
 * `cash_seq_no_seq` sequence'idan avtomatik oladi. Primary key'ga tegilmaydi.
 * Idempotent: ustun, sequence va index bor bo'lsa qayta yaratilmaydi,
 * bo'sh qolgan raqamlar to'ldiriladi, sequence doim max qiymatga to'g'rilanadi.
 */
export class CashSeqNo1761955400000 implements MigrationInterface {
  name = 'CashSeqNo1761955400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = (await queryRunner.query(
      `SELECT to_regclass(current_schema() || '.cash') AS t`,
    )) as { t: string | null }[];
    if (!table[0]?.t) return; // yangi baza: synchronize o'zi yaratadi

    await queryRunner.query(
      `ALTER TABLE "cash" ADD COLUMN IF NOT EXISTS "seq_no" integer`,
    );
    await queryRunner.query(`CREATE SEQUENCE IF NOT EXISTS "cash_seq_no_seq"`);
    await queryRunner.query(
      `ALTER SEQUENCE "cash_seq_no_seq" OWNED BY "cash"."seq_no"`,
    );

    // Raqami yo'q kassalar: mavjud eng katta raqamdan keyin, created_at, id tartibida
    await queryRunner.query(
      `UPDATE "cash" c SET "seq_no" = n.seq
       FROM (
         SELECT id,
                (SELECT COALESCE(MAX("seq_no"), 0) FROM "cash")
                  + ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS seq
         FROM "cash" WHERE "seq_no" IS NULL
       ) n
       WHERE c.id = n.id`,
    );
    await queryRunner.query(
      `SELECT setval('cash_seq_no_seq', GREATEST((SELECT COALESCE(MAX("seq_no"), 0) FROM "cash"), 1),
                     (SELECT COUNT(*) > 0 FROM "cash"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "cash" ALTER COLUMN "seq_no" SET DEFAULT nextval('cash_seq_no_seq'::regclass)`,
    );
    await queryRunner.query(
      `ALTER TABLE "cash" ALTER COLUMN "seq_no" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_cash_seq_no" ON "cash" ("seq_no")`,
    );
  }

  async down(): Promise<void> {
    // Orqaga qaytarilmaydi: raqamlar mijoz/xodimlarga ko'rsatilgan bo'ladi
  }
}
