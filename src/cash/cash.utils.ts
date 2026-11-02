import { Cash } from 'src/bot/models/cash';
import { tashkentWeekday } from '../common/date';

export const DEFAULT_SHARE_PERCENT = 20;

/** Pul hisobiga kiradigan holatlar: draft va cancelled kirmaydi */
export const INACTIVE_STATUSES = ['draft', 'cancelled'];
export const isActiveStatus = (status: string) =>
  !INACTIVE_STATUSES.includes(status);

/** Qarz shu summadan (so'm) katta bo'lsa kassa qarzdor hisoblanadi (minglikka yaxlitlangandan keyin > 0) */
export const DEBT_THRESHOLD = 500;

export function toUZS(
  amount: number,
  currency: string | undefined,
  rate: number,
): number {
  if (currency === 'UZS') return amount;
  return amount * (rate || 0);
}

/** UZS uchun kurs har doim 1 */
export const rateOf = (currency: string, rate: number) =>
  currency === 'UZS' ? 1 : rate;

export function roundToNearestThousand(amount: number): number {
  const remainder = amount % 1000;
  const base = amount - remainder;
  return remainder >= 500 ? base + 1000 : base;
}

/** Brutto - mijoz bilan kelishilgan umumiy narx, so'mga o'tkazilgan holda */
export function getBrutto(cash: Cash): number {
  if (!cash.brutto) return 0;
  const amount = Number(cash.brutto.amount ?? 0);
  const rate = Number(cash.brutto.currency_amount ?? 0);
  return toUZS(amount, cash.brutto.currency, rate);
}

/**
 * Netto - xizmatlar yig'indisi, so'mda. cashServices yuklangan bo'lsa ulardan
 * hisoblanadi, aks holda saqlangan cash.netto olinadi.
 */
export function getNetto(cash: Cash): number {
  if (!cash.cashServices) return Number(cash.netto ?? 0);
  const raw = cash.cashServices.reduce(
    (sum, cs) =>
      sum +
      toUZS(
        Number(cs.service_amount ?? 0),
        cs.currency,
        Number(cs.currency_amount ?? 0),
      ),
    0,
  );
  return roundToNearestThousand(raw);
}

/** Mijozdan haqiqatda olingan pul, so'mga o'tkazilgan holda */
export function getPaidAmount(cash: Cash): number {
  if (!cash.moneys?.length) return 0;
  return cash.moneys.reduce((sum, m) => {
    const amount = Number(m.money_received ?? 0);
    const rate = Number(m.currency_amount ?? 0);
    return sum + toUZS(amount, m.currency, rate);
  }, 0);
}

/** Qarz = Brutto - to'langan summa (ikkalasi ham so'mda) */
export function getDebt(cash: Cash): number {
  return roundToNearestThousand(getBrutto(cash) - getPaidAmount(cash));
}

/** Foyda = Brutto - Netto (ikkalasi ham so'mda) */
export function getProfit(cash: Cash): number {
  return roundToNearestThousand(getBrutto(cash) - getNetto(cash));
}

/**
 * Xodim ulushi foizi (0..1). Asosiy foiz sozlamalardan (standart 20%),
 * juma kuni (Toshkent) yaratilgan kassada x1.25, qo'shimcha xodim bo'lsa
 * ulush ikkiga bo'linadi (egasi va qo'shimcha xodim teng oladi).
 */
export function getBonusRate(
  cash: Cash,
  basePercent = DEFAULT_SHARE_PERCENT,
): number {
  const friday = tashkentWeekday(cash.created_at) === 5;
  const rate = (basePercent / 100) * (friday ? 1.25 : 1);
  return cash.additionalUser ? rate / 2 : rate;
}

export function getBonus(
  cash: Cash,
  basePercent = DEFAULT_SHARE_PERCENT,
): number {
  return getProfit(cash) * getBonusRate(cash, basePercent);
}

/* ---------------- SQL bo'laklari (alias: c = cash, b = brutto) ---------------- */

export const BRUTTO_UZS_SQL = `COALESCE(CASE WHEN b.currency = 'UZS' THEN b.amount ELSE b.amount * b.currency_amount END, 0)`;

export const PAID_UZS_SQL = `COALESCE((SELECT SUM(CASE WHEN m.currency = 'UZS' THEN m.money_received ELSE m.money_received * m.currency_amount END) FROM money m WHERE m.cash_id = c.id), 0)`;

export const DEBT_SQL = `(${BRUTTO_UZS_SQL} - ${PAID_UZS_SQL})`;

/** Yalpi foyda: brutto (so'mda) - netto (so'mda saqlanadi) */
export const PROFIT_SQL = `(${BRUTTO_UZS_SQL} - c.netto)`;

export const ACTIVE_STATUS_SQL = `c.status NOT IN ('draft', 'cancelled')`;

/** Dogovor raqami berilganmi: "0", "00" yoki bo'sh - hali berilmagan */
export const hasContractNumber = (value?: string | null) =>
  !!value && !/^0*$/.test(value.trim());

/** Ichki ID ko'rinishi: 42 -> "00042" */
export const formatSeqNo = (seq?: number | null) =>
  seq ? String(seq).padStart(5, '0') : '';

/** Xabarlar uchun: "№695" yoki dogovor berilmagan bo'lsa "ID 00042" */
export const cashLabel = (cash: {
  cash_number?: string | null;
  seq_no?: number | null;
}) =>
  hasContractNumber(cash.cash_number)
    ? `№${(cash.cash_number ?? '').trim()}`
    : `ID ${formatSeqNo(cash.seq_no)}`;
