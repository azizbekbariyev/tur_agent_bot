import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Vaqt ustunlari `timestamp` (zonasiz) edi: qiymat server qaysi zonada bo'lsa
 * o'sha zonada yozilgan va o'qilgan. Production server zonasi 2026-10-27/28 da
 * Asia/Tashkent (UTC+5) dan UTC+1 ga o'zgargan, shuning uchun bazada ikki xil
 * zonadagi yozuvlar bor va vaqtlar serverga qarab 4 soat siljib ko'rinadi.
 *
 * Bu migratsiya ustunlarni `timestamptz` ga o'tkazadi (aniq lahza saqlanadi),
 * har bir qiymatni u yozilgan zona bo'yicha talqin qiladi:
 *  - 2026-10-28 00:00 dan oldingi qiymatlar - Asia/Tashkent
 *    (o'sha paytdagi cron yozuvlari: Toshkent 06:00 cron'i bazada 06:00 bo'lib turibdi);
 *  - keyingilari - bazaning hozirgi zonasi (current_setting('TimeZone')),
 *    ya'ni `now()` va server yozgan zona (Toshkent 06:00 cron'i 02:00 bo'lib turibdi).
 * cash.created_at - foydalanuvchi tanlagan "kassa sanasi" (Toshkent yarim tuni):
 *  Toshkent zonasida yozilganlari aynan 00:00:00, keyingilari 20:00:00 bo'lib saqlangan.
 *
 * Idempotent: faqat hali `timestamp without time zone` bo'lgan ustunlarga tegadi.
 */
export class TimestampsWithTimeZone1761955300000 implements MigrationInterface {
  name = 'TimestampsWithTimeZone1761955300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND data_type = 'timestamp without time zone'
       ORDER BY table_name, column_name`,
    )) as { table_name: string; column_name: string }[];
    if (!rows.length) return;

    const [{ tz }] = (await queryRunner.query(
      `SELECT current_setting('TimeZone') AS tz`,
    )) as { tz: string }[];
    const serverTz = String(tz).replace(/'/g, "''");
    const cutover = `TIMESTAMP '2026-10-28 00:00:00'`;

    for (const { table_name: table, column_name: column } of rows) {
      const col = `"${column}"`;
      const writeTime = `CASE WHEN ${col} < ${cutover}
          THEN ${col} AT TIME ZONE 'Asia/Tashkent'
          ELSE ${col} AT TIME ZONE '${serverTz}' END`;
      const chosenDate = `CASE WHEN ${col} < ${cutover} AND ${col}::time = TIME '00:00:00'
          THEN ${col} AT TIME ZONE 'Asia/Tashkent'
          ELSE ${col} AT TIME ZONE '${serverTz}' END`;
      const using =
        table === 'cash' && column === 'created_at' ? chosenDate : writeTime;
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN ${col} TYPE timestamptz USING (${using})`,
      );
    }
  }

  async down(): Promise<void> {
    // Orqaga qaytarilmaydi: zonasiz ustunda qaysi zona ekanligi yana yo'qoladi
  }
}
