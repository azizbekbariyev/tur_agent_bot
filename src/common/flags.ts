/**
 * Filial sozlamalari (.env). Qiymat berilmasa - hozirgi production xatti-harakati.
 * Test nusxalarda (test-one / test-two): BOT_ENABLED=false, SCHEDULED_JOBS_ENABLED=false.
 */

/** false - Telegram bot ishga tushmaydi va hech kimga xabar yuborilmaydi */
export const botEnabled = () => process.env.BOT_ENABLED !== 'false';

/** false - rejalashtirilgan ishlar (eslatmalar, kassalarni avtomatik yopish) bajarilmaydi */
export const scheduledJobsEnabled = () =>
  process.env.SCHEDULED_JOBS_ENABLED !== 'false';

/**
 * Eski kirish (username/email + parol shu filialning o'zida).
 * 4-bosqichda login serveri bilan yonma-yon - zaxira kirish. 5-bosqichda favqulodda kalit.
 */
export const localLoginEnabled = () =>
  process.env.LOCAL_LOGIN_ENABLED !== 'false';
