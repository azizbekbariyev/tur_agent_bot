import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Login serveri orqali ochilgan sessiyaga login serveridagi sessiya id (OIDC "sid").
 * Back-channel logout shu bo'yicha sessiyani yopadi. Ustun UserSession entity'dagi bilan
 * aynan bir xil (varchar(128), bo'sh bo'lishi mumkin) - synchronize hech narsani o'zgartirmaydi.
 * Boshqa ustunlarga tegilmaydi. Idempotent.
 */
export class SessionOidcSid1762700000000 implements MigrationInterface {
  name = 'SessionOidcSid1762700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = (await queryRunner.query(
      `SELECT to_regclass(current_schema() || '.user_session') AS t`,
    )) as { t: string | null }[];
    // Yangi baza: jadvalni synchronize yaratadi
    if (!table[0]?.t) return;

    await queryRunner.query(
      `ALTER TABLE "user_session" ADD COLUMN IF NOT EXISTS "oidc_sid" character varying(128)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_session" DROP COLUMN IF EXISTS "oidc_sid"`,
    );
  }
}
