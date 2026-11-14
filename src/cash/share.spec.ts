import { Cash } from 'src/bot/models/cash';
import {
  getBonus,
  getPersonalShare,
  getProfit,
  getTotalShare,
  participantShare,
} from './cash.utils';
import { tashkentMidnight } from '../common/date';

// Xodim ulushi (egasi qoidasi, 2026-11-14): foydaning 20%, juma kuni ochilgan kassada 25%;
// ikki xodim bo'lsa ulush ikkalasiga teng bo'linadi; firmadan jami chiqadigan ulush - bitta to'liq ulush.
// "Juma" - kassadagi "Kassa sanasi" (tur sotilgan sana; xodim formada tanlaydi, bazada created_at), Toshkent vaqti.
const OWNER = { id: 1 };
const EXTRA = { id: 2 };
const cash = (createdAt: string, extra = false) =>
  ({
    created_at: new Date(createdAt),
    brutto: { amount: 15_000_000, currency: 'UZS', currency_amount: 1 },
    netto: 10_000_000, // foyda 5 mln
    user: OWNER,
    additionalUser: extra ? EXTRA : null,
  }) as unknown as Cash;

// 2026-11-12 - payshanba, 2026-11-13 - juma (Toshkent)
const THURSDAY = '2026-11-12T10:00:00+05:00';
const FRIDAY = '2026-11-13T10:00:00+05:00';

describe('xodim ulushi', () => {
  it('foyda 5 mln', () => {
    expect(getProfit(cash(THURSDAY))).toBe(5_000_000);
  });

  it('bitta xodim: 20% -> 1 mln', () => {
    expect(getBonus(cash(THURSDAY), 20)).toBe(1_000_000);
    expect(getTotalShare(cash(THURSDAY), 20)).toBe(1_000_000);
  });

  it('bitta xodim, juma: 25% -> 1,25 mln', () => {
    expect(getBonus(cash(FRIDAY), 20)).toBe(1_250_000);
    expect(getTotalShare(cash(FRIDAY), 20)).toBe(1_250_000);
  });

  it('ikki xodim: har biriga 500 ming, firmadan jami 1 mln', () => {
    const c = cash(THURSDAY, true);
    expect(getBonus(c, 20)).toBe(500_000);
    expect(getTotalShare(c, 20)).toBe(1_000_000);
    expect(getBonus(c, 20) * 2).toBe(getTotalShare(c, 20));
  });

  it('ikki xodim, juma: har biriga 625 ming, firmadan jami 1,25 mln', () => {
    const c = cash(FRIDAY, true);
    expect(getBonus(c, 20)).toBe(625_000);
    expect(getTotalShare(c, 20)).toBe(1_250_000);
  });

  it("juma Toshkent vaqti bo'yicha: payshanba 23:30 UTC = juma 04:30 Toshkent", () => {
    expect(getBonus(cash('2026-11-12T23:30:00Z'), 20)).toBe(1_250_000);
    expect(getBonus(cash('2026-11-13T19:30:00Z'), 20)).toBe(1_000_000); // shanba 00:30 Toshkent
  });

  it("reyting: pul ulushi egasi va qo'shimcha xodimga yarimdan, yig'indisi 1", () => {
    const c = cash(THURSDAY, true);
    expect(participantShare(c, 1)).toBe(0.5);
    expect(participantShare(c, 2)).toBe(0.5);
    expect(participantShare(cash(THURSDAY), 1)).toBe(1);
    expect(participantShare(cash(THURSDAY), 2)).toBe(0);
  });

  it('juma - kassadagi "Kassa sanasi" (sotilgan sana) bo\'yicha: payshanba kuni kiritilgan, sotilgan sanasi juma -> 25%', () => {
    // Xodim kassani payshanba kuni kiritadi, lekin formada "Kassa sanasi" = 2026-11-13 (juma) tanlaydi.
    // Backend bu sanani tashkentMidnight() bilan created_at ga yozadi (parseCashDate) - ulush shundan olinadi.
    const c = cash(THURSDAY);
    c.created_at = tashkentMidnight('2026-11-13');
    expect(getBonus(c, 20)).toBe(1_250_000);
    // Teskarisi: juma kuni kiritilgan, sotilgan sanasi payshanba -> 20%
    const d = cash(FRIDAY);
    d.created_at = tashkentMidnight('2026-11-12');
    expect(getBonus(d, 20)).toBe(1_000_000);
  });

  it('shaxsiy ulush: ikki xodim - 500 ming + 500 ming, juma - 625 ming + 625 ming', () => {
    const c = cash(THURSDAY, true);
    expect(getPersonalShare(c, 1, 20) + getPersonalShare(c, 2, 20)).toBe(
      getTotalShare(c, 20),
    );
    expect(getPersonalShare(cash(FRIDAY, true), 2, 20)).toBe(625_000);
  });

  it("eski ma'lumot: qo'shimcha xodim = egasi bo'lsa, u to'liq ulushni oladi (ikki yarmi)", () => {
    const c = { ...cash(THURSDAY), additionalUser: OWNER } as unknown as Cash;
    expect(getPersonalShare(c, 1, 20)).toBe(1_000_000);
    expect(participantShare(c, 1)).toBe(1);
  });
});
