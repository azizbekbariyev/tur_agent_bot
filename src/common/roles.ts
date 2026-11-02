import { ForbiddenException } from '@nestjs/common';
import { UserReq } from '../types/user.type';

export const ROLES = ['SUPERADMIN', 'ADMIN', 'EMPLOYEE', 'ACCOUNTANT'] as const;
export type AppRole = (typeof ROLES)[number];

/** ADMIN va SUPERADMIN - to'liq huquqli rahbarlar */
export const isAdmin = (role?: string) =>
  role === 'ADMIN' || role === 'SUPERADMIN';

/** Barcha kassalarni ko'ra oladiganlar (ACCOUNTANT - faqat o'qish) */
export const canViewAll = (role?: string) =>
  isAdmin(role) || role === 'ACCOUNTANT';

/** Kassa yaratish/tahrirlash/to'lov qo'shish huquqi bor rollar */
export const canWriteCash = (role?: string) =>
  isAdmin(role) || role === 'EMPLOYEE';

export function requireAdmin(user: UserReq) {
  if (!isAdmin(user.role)) throw new ForbiddenException('Ruxsat yo‘q');
}

/** Rahbarlar va buxgalter (hisobotlar, hamkorlar, mijozlar) */
export function requireManager(user: UserReq) {
  if (!canViewAll(user.role)) throw new ForbiddenException('Ruxsat yo‘q');
}

export function requireCashWriter(user: UserReq) {
  if (!canWriteCash(user.role)) throw new ForbiddenException('Ruxsat yo‘q');
}

/** Frontend marshrutidagi rol bo'limi: /{section}/kassalar/{id} */
export function roleSection(role?: string) {
  switch (role) {
    case 'SUPERADMIN':
      return 'super-admin';
    case 'ADMIN':
      return 'admin';
    case 'ACCOUNTANT':
      return 'accountant';
    default:
      return 'employee';
  }
}

export function frontendUrl() {
  return (
    process.env.FRONTEND_URL ||
    process.env.VITE_BACKEND_URL ||
    ''
  ).replace(/\/+$/, '');
}
