import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * brutto.currency_amount integer edi - kasr kurs (masalan 12087.83) saqlanmasdi.
 * synchronize ustun turini o'zgartirganda ustunni o'chirib qayta yaratadi (ma'lumot
 * yo'qoladi), shuning uchun turini shu migratsiya synchronize'dan OLDIN o'zgartiradi.
 */
export class BruttoRateNumeric1761955200000 implements MigrationInterface {
  name = 'BruttoRateNumeric1761955200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'brutto' AND column_name = 'currency_amount'`,
    )) as { data_type: string }[];
    if (rows[0]?.data_type === 'integer') {
      await queryRunner.query(
        `ALTER TABLE "brutto" ALTER COLUMN "currency_amount" TYPE numeric(15,2) USING "currency_amount"::numeric`,
      );
    }
  }

  async down(): Promise<void> {
    // Orqaga qaytarilmaydi: kasr kurslar yo'qolib qoladi
  }
}
