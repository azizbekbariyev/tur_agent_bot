import {
  sqlTashkent,
  tashkentDate,
  tashkentDateTime,
  tashkentMidnight,
  tashkentWeekday,
} from './date';

describe("Toshkent vaqti (server zonasiga bog'liq emas)", () => {
  it("kassa 695 to'lovi 15:16", () => {
    expect(tashkentDateTime(new Date('2026-10-31T10:16:58.037Z'))).toBe(
      '2026-10-31 15:16',
    );
  });

  it('kun chegarasi: UTC 19:00 = Toshkent ertasi kuni 00:00', () => {
    expect(tashkentDate('2026-11-06T19:00:00.000Z')).toBe('2026-11-07');
    expect(tashkentDate('2026-11-06T18:59:59.000Z')).toBe('2026-11-06');
  });

  it("'YYYY-MM-DD' -> Toshkent yarim tuni", () => {
    expect(tashkentMidnight('2026-11-01').toISOString()).toBe(
      '2026-10-31T19:00:00.000Z',
    );
  });

  it("juma Toshkent bo'yicha", () => {
    // 2026-10-30 juma: Toshkent 00:30 = UTC payshanba 19:30
    expect(tashkentWeekday(new Date('2026-10-29T19:30:00Z'))).toBe(5);
  });

  it('SQL: timestamptz -> Toshkent mahalliy vaqti', () => {
    expect(sqlTashkent('c.created_at')).toBe(
      "((c.created_at) AT TIME ZONE 'Asia/Tashkent')",
    );
  });
});
