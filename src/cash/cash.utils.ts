import { Cash } from 'src/bot/models/cash';

export function toUZS(
  amount: number,
  currency: string | undefined,
  rate: number,
): number {
  if (currency === 'UZS') return amount;
  return amount * (rate || 0);
}

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

/** Netto - CashServices (xizmatlar) yig'indisi, so'mda. Xizmatlar har doim USD. */
export function getNetto(cash: Cash): number {
  if (!cash.cashServices?.length) return 0;
  const raw = cash.cashServices.reduce((sum, cs) => {
    const amount = Number(cs.service_amount ?? 0);
    const rate = Number(cs.currency_amount ?? 0);
    return sum + amount * rate;
  }, 0);
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
