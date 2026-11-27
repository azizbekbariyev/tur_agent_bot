import { checkContract, CheckInput } from './contract-check';
import { applyDraft } from './contract-preview';
import { cashDay } from './contract-data';
import { ContractBodyDto } from './contracts.dto';
import { dateToISOForTest } from './test-helpers';

const base = (): CheckInput => ({
  tour: { departureDate: '2026-11-25', returnDate: '2026-12-03', tourists: 2 },
  flights: [
    {
      id: 1,
      position: 0,
      fromCity: 'Toshkent',
      toCity: 'Fukuok',
      baggagePaxCount: 2,
    },
    {
      id: 2,
      position: 1,
      fromCity: 'Fukuok',
      toCity: 'Toshkent',
      baggagePaxCount: 2,
    },
  ],
  hotels: [
    {
      id: 10,
      position: 0,
      city: 'Fukuok',
      name: 'La Vita',
      roomsCount: 1,
      checkIn: '2026-11-25',
      checkOut: '2026-12-03',
      transferType: 'group',
      transferRoute: 'full',
      roomsSeparateConfirmed: true,
    },
  ],
  extras: [],
  insurance: 'included',
  visa: 'not_included',
  services: [
    {
      id: 100,
      typeKey: 'avia',
      label: 'A',
      links: [
        { itemType: 'flight', flightId: 1 },
        { itemType: 'flight', flightId: 2 },
      ],
    },
    {
      id: 101,
      typeKey: 'hotel',
      label: 'H',
      links: [{ itemType: 'hotel', hotelId: 10 }],
    },
    { id: 102, typeKey: 'insurance', label: 'I', links: [] },
  ],
});

describe('Saqlamasdan tekshirish: forma holati mavjud ma‘lumotga qo‘llanadi', () => {
  it('o‘zgarishsiz forma — saqlangan holat bilan bir xil natija', () => {
    const b = base();
    const draft: ContractBodyDto = {
      flights: b.flights.map((f) => ({
        id: f.id,
        fromCity: f.fromCity,
        toCity: f.toCity,
        baggagePaxCount: f.baggagePaxCount,
      })),
      hotels: b.hotels.map((h) => ({
        id: h.id,
        city: h.city,
        name: h.name,
        roomsCount: h.roomsCount,
        checkIn: h.checkIn,
        checkOut: h.checkOut,
        transferType: h.transferType,
        transferRoute: h.transferRoute,
      })),
      extras: [],
    };
    expect(checkContract(applyDraft(base(), draft))).toEqual(
      checkContract(base()),
    );
  });

  it('bagaj aralash qilinsa — aviabilet ogohlantirishi (saqlamasdan)', () => {
    const draft: ContractBodyDto = {
      flights: [
        { id: 1, fromCity: 'Toshkent', toCity: 'Fukuok', baggagePaxCount: 1 },
        { id: 2, fromCity: 'Fukuok', toCity: 'Toshkent', baggagePaxCount: 1 },
      ],
    };
    const r = checkContract(applyDraft(base(), draft));
    expect(r.compare!.filter((x) => x.code === 'avia_missing')).toHaveLength(2);
  });

  it('boshlang‘ich (asl) kirish ob‘ekti o‘zgarmaydi', () => {
    const b = base();
    const copy = JSON.stringify(b);
    applyDraft(b, {
      flights: [],
      hotels: [],
      extras: [],
      insurance: 'not_included',
    });
    expect(JSON.stringify(b)).toBe(copy);
  });

  it('yangi qator vaqtincha manfiy id oladi; olib tashlangan qatorning bog‘lanishi tushadi', () => {
    const draft: ContractBodyDto = {
      flights: [
        { id: 1, fromCity: 'Toshkent', toCity: 'Fukuok', baggagePaxCount: 2 },
        { fromCity: 'Fukuok', toCity: 'Bali', baggagePaxCount: 2 },
      ],
    };
    const out = applyDraft(base(), draft);
    expect(out.flights.map((f) => f.id)).toEqual([1, -1]);
    // 2-parvoz (id 2) olib tashlandi: aviabilet xizmatining unga bog'lanishi ham yo'q
    expect(out.services!.find((s) => s.id === 100)!.links).toEqual([
      { itemType: 'flight', flightId: 1 },
    ]);
  });

  it('«har nomer alohida» tanlovi saqlangan qatorda qoladi', () => {
    const draft: ContractBodyDto = {
      hotels: [
        {
          id: 10,
          city: 'Fukuok',
          roomsCount: 2,
          checkIn: '2026-11-25',
          checkOut: '2026-12-03',
          transferType: 'none',
        },
      ],
    };
    expect(applyDraft(base(), draft).hotels[0].roomsSeparateConfirmed).toBe(
      true,
    );
  });

  it('yangi shartnoma formasi (kassa xizmatlarisiz) — faqat ichki tekshiruv', () => {
    const empty: CheckInput = {
      tour: {
        departureDate: '2027-03-10',
        returnDate: '2027-03-20',
        tourists: 4,
      },
      flights: [],
      hotels: [],
      extras: [],
      insurance: 'not_included',
      visa: 'not_included',
    };
    const r = checkContract(
      applyDraft(empty, {
        flights: [
          { fromCity: 'Toshkent', toCity: 'Bali', baggagePaxCount: 0 },
          { fromCity: 'Dubay', toCity: 'Toshkent', baggagePaxCount: 0 },
        ],
      }),
    );
    expect(r.compare).toBeNull();
    expect(r.internal.map((x) => x.code)).toContain('flight_chain_break');
  });
});

describe('Kassa sanasi (Toshkent yarim tuni ISO) — kun siljimaydi', () => {
  it('frontend yuboradigan ISO -> to‘g‘ri kun', () => {
    expect(cashDay(dateToISOForTest('2026-11-25'))).toBe('2026-11-25');
    expect(cashDay(dateToISOForTest('2027-01-01'))).toBe('2027-01-01');
  });
  it('oddiy YYYY-MM-DD o‘zgarmaydi; bo‘sh -> null', () => {
    expect(cashDay('2026-12-03')).toBe('2026-12-03');
    expect(cashDay('')).toBeNull();
    expect(cashDay(null)).toBeNull();
  });
});
