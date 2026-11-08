import { MigrationInterface, QueryRunner } from 'typeorm';
import { USER_INDEX_SQL } from '../common/username';

/**
 * Foydalanuvchiga username (kirish uchun) va account_id (login serveridagi akkaunt, keyinroq).
 * Ustunlar User entity'dagi bilan aynan bir xil: varchar(30) / varchar(64), bo'sh bo'lishi mumkin -
 * shunda synchronize hech narsani o'zgartirmaydi. Indekslar entity'da `synchronize: false`
 * bilan e'lon qilingan (synchronize ularni yaratmaydi ham, o'chirmaydi ham).
 * Email, id va boshqa ustunlarga tegilmaydi. Idempotent.
 */
export class UserUsername1762600000000 implements MigrationInterface {
  name = 'UserUsername1762600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = (await queryRunner.query(
      `SELECT to_regclass(current_schema() || '.user') AS t`,
    )) as { t: string | null }[];
    // Yangi baza: jadvalni synchronize yaratadi, indekslarni UserService.onModuleInit qo'shadi
    if (!table[0]?.t) return;

    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "username" character varying(30)`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "account_id" character varying(64)`,
    );
    for (const sql of USER_INDEX_SQL) await queryRunner.query(sql);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_user_account_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_user_username_lower"`);
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN IF EXISTS "account_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN IF EXISTS "username"`,
    );
  }
}
