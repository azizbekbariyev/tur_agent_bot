import { BadRequestException } from '@nestjs/common';

export const BUSINESS_TZ = 'Asia/Tashkent';

/**
 * Vaqt ustunlari `timestamptz` (aniq lahza). SQL'da Toshkent mahalliy vaqtiga
 * o'tkazish server/baza zonasiga bog'liq emas.
 */
export const sqlTashkent = (column: string) =>
  `((${column}) AT TIME ZONE '${BUSINESS_TZ}')`;

const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Sana -> Toshkent bo'yicha 'YYYY-MM-DD' */
export function tashkentDate(value: Date | string | number): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return dayFmt.format(d);
}

/** Toshkent bo'yicha hafta kuni (0 = yakshanba, 5 = juma) */
export function tashkentWeekday(value: Date | string | number): number {
  const d = new Date(`${tashkentDate(value)}T00:00:00Z`);
  return d.getUTCDay();
}

/** Toshkent bo'yicha 'YYYY-MM-DD HH:MM' */
export function tashkentDateTime(value: Date | string | number): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${tashkentDate(d)} ${tashkentTime(d)}`;
}

/** 'YYYY-MM-DD' -> shu kunning Toshkent yarim tuni */
export function tashkentMidnight(day: string): Date {
  return new Date(`${day}T00:00:00+05:00`);
}

/** Toshkent bo'yicha hozirgi soat:daqiqa, 'HH:MM' */
export function tashkentTime(now = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
}

/** Ikki 'YYYY-MM-DD' orasidagi kunlar farqi (b - a) */
export function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  );
}

/** Query'dagi sanani tekshiradi; noto'g'ri bo'lsa 400 */
export function parseDate(value: string, name: string): Date;
export function parseDate(
  value: string | undefined,
  name: string,
  optional: true,
): Date | undefined;
export function parseDate(
  value: string | undefined,
  name: string,
  optional = false,
): Date | undefined {
  if (value === undefined || value === null || value === '') {
    if (optional) return undefined;
    throw new BadRequestException(`${name} majburiy`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`${name} noto'g'ri sana: "${value}"`);
  }
  return d;
}

/** Xuddi shu uzunlikdagi oldingi davr */
export function previousPeriod(start: Date, end: Date) {
  const length = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - length);
  return { prevStart, prevEnd };
}
