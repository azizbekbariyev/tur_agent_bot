import { createHash } from 'crypto';
import { type Repository } from 'typeorm';
import { UserSession } from '../bot/models/user_session';

export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** Sessiya hozir amal qiladimi (bekor qilinmagan, muddati o'tmagan) */
export const isSessionActive = (s: UserSession | null, now = new Date()) =>
  !!s && !s.revokedAt && s.expiresAt > now;

/**
 * Foydalanuvchining barcha faol sessiyalarini bekor qiladi (exceptId - joriy sessiya qoladi).
 * Bloklash, o'chirish, parolni almashtirish/tiklashda chaqiriladi.
 */
export async function revokeUserSessions(
  repo: Repository<UserSession>,
  userId: number,
  exceptId?: string,
) {
  const qb = repo
    .createQueryBuilder()
    .update()
    .set({ revokedAt: new Date() })
    .where('user_id = :userId AND revoked_at IS NULL', { userId });
  if (exceptId) qb.andWhere('id <> :exceptId', { exceptId });
  await qb.execute();
}
