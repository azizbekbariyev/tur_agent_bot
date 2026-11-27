import {
  CheckFlight,
  CheckHotel,
  CheckInput,
  CheckService,
  checkContract,
} from './contract-check';
import { ServiceTypeKey } from '../common/service-types';

/* ------------------------------ yasovchilar ------------------------------ */

let seq = 100;
const flight = (
  fromCity: string,
  toCity: string,
  baggagePaxCount = 2,
): CheckFlight => ({
  id: ++seq,
  position: seq,
  fromCity,
  toCity,
  baggagePaxCount,
});
const hotel = (
  city: string,
  checkIn: string,
  checkOut: string,
  extra: Partial<CheckHotel> = {},
): CheckHotel => ({
  id: ++seq,
  position: seq,
  city,
  name: null,
  roomsCount: 1,
  checkIn,
  checkOut,
  transferType: 'group',
  transferRoute: 'full',
  roomsSeparateConfirmed: false,
  ...extra,
});
const svc = (
  typeKey: ServiceTypeKey | null,
  links: CheckService['links'] = [],
  label = `${typeKey} #${seq + 1}`,
): CheckService => ({ id: ++seq, typeKey, label, links });
const toFlight = (...ids: number[]) =>
  ids.map((id) => ({ itemType: 'flight', flightId: id }));
const toHotel = (id: number) => [{ itemType: 'hotel', hotelId: id }];

const codes = (r: ReturnType<typeof checkContract>, level?: string) =>
  [...r.internal, ...(r.compare ?? [])]
    .filter((x) => !level || x.level === level)
    .map((x) => x.code);
const find = (r: ReturnType<typeof checkContract>, code: string) =>
  [...r.internal, ...(r.compare ?? [])].find((x) => x.code === code);

/* ------------------------------ bir shaharli tur ------------------------------ */

function oneCity(tourists = 2, bag = 2) {
  const f1 = flight('Toshkent', 'Fukuok', bag);
  const f2 = flight('Fukuok', 'Toshkent', bag);
  const h1 = hotel('Fukuok', '2026-11-25', '2026-12-03', {
    name: 'La Vita Serenity',
  });
  const input: CheckInput = {
    tour: { departureDate: '2026-11-25', returnDate: '2026-12-03', tourists },
    flights: [f1, f2],
    hotels: [h1],
    extras: [],
    insurance: 'included',
    visa: 'not_included',
    services: [
      svc('avia', toFlight(f1.id, f2.id)), // borish-qaytish bitta bilet
      svc('hotel', toHotel(h1.id)),
      svc('transfer', toHotel(h1.id)),
      svc('transfer', toHotel(h1.id)),
      svc('insurance'),
    ],
  };
  return { input, f1, f2, h1 };
}

describe('Shartnoma tekshiruvi: bir shaharli tur (2 parvoz, 1 mehmonxona)', () => {
  it('hammasi joyida - ogohlantirish yo‘q', () => {
    const r = checkContract(oneCity().input);
    expect(r.warnings).toBe(0);
    expect(codes(r, 'ok')).toEqual(
      expect.arrayContaining([
        'flight_chain_ok',
        'hotel_nights_ok',
        'avia_ok',
        'hotel_ok',
        'transfer_ok',
        'insurance_ok',
      ]),
    );
    expect(find(r, 'flight_chain_ok')!.uz).toBe(
      'Parvozlar: Toshkent → Fukuok → Toshkent',
    );
  });

  it('bir nechta parvozga bog‘langan xizmat har biriga hisoblanadi', () => {
    const r = checkContract(oneCity().input);
    expect(r.compare!.filter((x) => x.code === 'avia_ok')).toHaveLength(2);
  });

  it('bagaj aralash (2 turistdan 1 tasi bagajli) - har yo‘nalishga 2 xizmat kutiladi', () => {
    const r = checkContract(oneCity(2, 1).input);
    const w = r.compare!.filter((x) => x.code === 'avia_missing');
    expect(w).toHaveLength(2);
    expect(w[0]).toMatchObject({ expected: 2, actual: 1 });
    expect(w[0].uz).toContain('2 ta tarif kerak');
  });

  it('bagaj bir xil (hammasi bagajsiz) - 1 xizmat yetarli', () => {
    const r = checkContract(oneCity(2, 0).input);
    expect(codes(r)).not.toContain('avia_missing');
  });

  it('bagajli turistlar turistlar sonidan ko‘p - ichki ogohlantirish', () => {
    const r = checkContract(oneCity(2, 3).input);
    expect(codes(r)).toContain('baggage_over_tourists');
  });

  it('kassada mehmonxona xizmati yo‘q', () => {
    const { input } = oneCity();
    input.services = input.services!.filter((s) => s.typeKey !== 'hotel');
    const w = find(checkContract(input), 'hotel_missing')!;
    expect(w.uz).toBe(
      "Mehmonxona 1 · Fukuok (La Vita Serenity): kassada xizmat yo'q",
    );
  });

  it('sug‘urta kiritilgan, kassada yo‘q; viza kerak emas, lekin kassada bor', () => {
    const { input } = oneCity();
    input.visa = 'not_required';
    input.services = [
      ...input.services!.filter((s) => s.typeKey !== 'insurance'),
      svc('visa'),
    ];
    const r = checkContract(input);
    expect(codes(r, 'warn')).toEqual(
      expect.arrayContaining(['insurance_missing', 'visa_not_in_contract']),
    );
  });

  it('hech qatorga bog‘lanmagan aviabilet - alohida ogohlantirish', () => {
    const { input } = oneCity();
    input.services!.push(svc('avia', [], 'TRIP COM — Aviabilet (JQRONC)'));
    const w = find(checkContract(input), 'avia_unlinked')!;
    expect(w.uz).toBe(
      "TRIP COM — Aviabilet (JQRONC): shartnomadagi hech qaysi qatorga bog'lanmagan",
    );
  });

  it('kassa xizmatlari berilmasa - faqat ichki tekshiruv', () => {
    const { input } = oneCity();
    delete input.services;
    expect(checkContract(input).compare).toBeNull();
  });
});

describe('Parvozlar zanjiri', () => {
  it('uzilgan zanjir va boshlangan shaharga qaytmaslik', () => {
    const f1 = flight('Toshkent', 'Dubay');
    const f2 = flight('Abu-Dabi', 'Istanbul');
    const r = checkContract({
      tour: { tourists: 2 },
      flights: [f1, f2],
      hotels: [],
      extras: [],
      insurance: 'not_included',
      visa: 'not_required',
    });
    expect(codes(r, 'warn')).toEqual([
      'flight_chain_break',
      'flight_not_closed',
    ]);
  });

  it('shahar nomidagi katta-kichik harf va bo‘shliqlar farq qilmaydi', () => {
    const r = checkContract({
      tour: { tourists: 1 },
      flights: [flight('Toshkent', 'Bali ', 1), flight('bali', 'TOSHKENT', 1)],
      hotels: [],
      extras: [],
      insurance: 'not_included',
      visa: 'not_required',
    });
    expect(r.warnings).toBe(0);
  });
});

describe('Mehmonxona kechalari', () => {
  const base = (hotels: CheckHotel[]): CheckInput => ({
    tour: {
      departureDate: '2026-03-10',
      returnDate: '2026-03-20',
      tourists: 2,
    },
    flights: [],
    hotels,
    extras: [],
    insurance: 'not_included',
    visa: 'not_required',
  });

  it('1 kecha kam - kulrang izoh «tungi reys bo‘lsa normal»', () => {
    const r = checkContract(base([hotel('Dubay', '2026-03-11', '2026-03-20')]));
    const x = find(r, 'hotel_nights_night_flight')!;
    expect(x.level).toBe('info');
    expect(x.uz).toContain("tungi reys bo'lsa, normal");
    expect(r.warnings).toBe(0);
  });

  it('2 kecha kam - sariq ogohlantirish', () => {
    const r = checkContract(base([hotel('Dubay', '2026-03-12', '2026-03-20')]));
    expect(find(r, 'hotel_nights_mismatch')!.level).toBe('warn');
  });

  it('mehmonxonalar orasida bo‘sh kecha va ustma-ust tushish', () => {
    const gap = checkContract(
      base([
        hotel('A', '2026-03-10', '2026-03-14'),
        hotel('B', '2026-03-15', '2026-03-20'),
      ]),
    );
    expect(codes(gap)).toContain('hotel_gap');
    const overlap = checkContract(
      base([
        hotel('A', '2026-03-10', '2026-03-15'),
        hotel('B', '2026-03-14', '2026-03-20'),
      ]),
    );
    expect(codes(overlap)).toContain('hotel_overlap');
  });

  it('sanasi kiritilmagan mehmonxona', () => {
    const r = checkContract(base([hotel('A', '', '2026-03-20')]));
    expect(codes(r)).toContain('hotel_dates_missing');
  });
});

/* ------------------------------ ko'p shaharli tur ------------------------------ */
// 4 parvoz, 4 mehmonxona, Balida 2 ta mehmonxona (Ubud + Nusa Dua), 4 turist: 2 bagajli + 2 bagajsiz

function multiCity() {
  const fl = [
    flight('Toshkent', 'Kuala Lumpur'),
    flight('Kuala Lumpur', 'Singapur'),
    flight('Singapur', 'Bali'),
    flight('Bali', 'Toshkent'),
  ];
  const kl = hotel('Kuala Lumpur', '2027-03-10', '2027-03-13', {
    roomsCount: 2,
    placement: undefined,
  } as Partial<CheckHotel>);
  const sg = hotel('Singapur', '2027-03-13', '2027-03-15');
  const ubud = hotel('Bali', '2027-03-15', '2027-03-18', { name: 'Ubud' });
  const nusa = hotel('Bali', '2027-03-18', '2027-03-20', { name: 'Nusa Dua' });
  const services: CheckService[] = [
    // har yo'nalishga 2 tadan (bagajli tarif + bagajsiz tarif)
    ...fl.flatMap((f) => [
      svc('avia', toFlight(f.id)),
      svc('avia', toFlight(f.id)),
    ]),
    svc('hotel', toHotel(kl.id)),
    svc('hotel', toHotel(kl.id)), // KL: 2 ta nomer - 2 ta xizmat
    svc('hotel', toHotel(sg.id)),
    svc('hotel', toHotel(ubud.id)),
    // Nusa Dua - xizmat yo'q
    svc('transfer', toHotel(kl.id)),
    svc('transfer', toHotel(kl.id)),
    svc('transfer', toHotel(sg.id)),
    svc('transfer', toHotel(sg.id)),
    svc('transfer', toHotel(ubud.id)), // aeroport -> Ubud
    svc('transfer', toHotel(ubud.id)), // Ubud -> Nusa Dua
    svc('transfer', toHotel(nusa.id)), // Nusa Dua -> aeroport
    svc('insurance'),
  ];
  const input: CheckInput = {
    tour: {
      departureDate: '2027-03-10',
      returnDate: '2027-03-20',
      tourists: 4,
    },
    flights: fl,
    hotels: [kl, sg, ubud, nusa],
    extras: [],
    insurance: 'included',
    visa: 'not_required',
    services,
  };
  return { input, kl, sg, ubud, nusa, fl };
}

describe('Ko‘p shaharli tur (4 parvoz, 4 mehmonxona, bitta shaharda 2 mehmonxona)', () => {
  it('zanjir, kechalar, aviabilet (aralash bagaj) va transferlar joyida', () => {
    const r = checkContract(multiCity().input);
    expect(codes(r, 'ok')).toEqual(
      expect.arrayContaining(['flight_chain_ok', 'hotel_nights_ok']),
    );
    expect(r.compare!.filter((x) => x.code === 'avia_ok')).toHaveLength(4);
    expect(find(r, 'flight_chain_ok')!.uz).toBe(
      'Parvozlar: Toshkent → … → Toshkent',
    );
    // Bali: 2 mehmonxona -> ko'pi bilan 3 transfer, kassada 3 ta
    const bali = r.compare!.find(
      (x) => x.section === 'transfer' && x.ref?.city === 'Bali',
    )!;
    expect(bali).toMatchObject({ level: 'ok', expected: 3, actual: 3 });
  });

  it('Nusa Dua uchun xizmat yo‘q - aniq matn', () => {
    const r = checkContract(multiCity().input);
    const w = r.compare!.find(
      (x) => x.code === 'hotel_missing' && x.ref?.position === 3,
    )!;
    expect(w.uz).toBe("Mehmonxona 4 · Bali (Nusa Dua): kassada xizmat yo'q");
  });

  it('nomerlar: 2 nomer, 2 xizmat - «alohida-alohidami?» savoli', () => {
    const r = checkContract(multiCity().input);
    const q = find(r, 'hotel_rooms_separate_question')!;
    expect(q).toMatchObject({ level: 'ask', expected: 1, actual: 2 });
    expect(q.uz).toContain('alohida-alohida');
  });

  it('nomerlar alohida tasdiqlangan - savol yo‘qoladi', () => {
    const m = multiCity();
    m.kl.roomsSeparateConfirmed = true;
    const r = checkContract(m.input);
    expect(codes(r)).not.toContain('hotel_rooms_separate_question');
    expect(
      r.compare!.find((x) => x.code === 'hotel_ok' && x.ref?.id === m.kl.id),
    ).toMatchObject({ expected: 2, actual: 2 });
  });

  it('nomerlar umumiy (1 nomer), lekin 2 xizmat - ortiqcha', () => {
    const m = multiCity();
    m.kl.roomsCount = 1;
    const r = checkContract(m.input);
    expect(
      r.compare!.find((x) => x.code === 'hotel_extra' && x.ref?.id === m.kl.id),
    ).toMatchObject({ expected: 1, actual: 2 });
  });

  it('transfer ko‘p qo‘shilgan - «ko‘p qo‘shdingiz»', () => {
    const m = multiCity();
    m.input.services!.push(svc('transfer', toHotel(m.nusa.id)));
    const w = find(checkContract(m.input), 'transfer_too_many')!;
    expect(w).toMatchObject({ expected: 3, actual: 4 });
  });

  it('transfer kam (lekin 0 emas) - ogohlantirmaydi', () => {
    const m = multiCity();
    m.input.services = m.input.services!.filter(
      (s) => !(s.typeKey === 'transfer' && s.links[0]?.hotelId === m.ubud.id),
    );
    const r = checkContract(m.input);
    expect(codes(r)).not.toContain('transfer_too_many');
    expect(codes(r)).not.toContain('transfer_missing');
  });

  it('shaharda transfer kerak, lekin 0 ta - «transfer yo‘q»', () => {
    const m = multiCity();
    m.input.services = m.input.services!.filter(
      (s) => !(s.typeKey === 'transfer' && s.links[0]?.hotelId === m.sg.id),
    );
    const w = find(checkContract(m.input), 'transfer_missing')!;
    expect(w.uz).toBe("Transfer · Singapur: kassada transfer yo'q");
  });

  it('faqat kutib olish - kutilgan 1 ta kam', () => {
    const m = multiCity();
    m.sg.transferRoute = 'arrival';
    const r = checkContract(m.input);
    expect(
      r.compare!.find(
        (x) => x.section === 'transfer' && x.ref?.city === 'Singapur',
      ),
    ).toMatchObject({
      level: 'warn',
      code: 'transfer_too_many',
      expected: 1,
      actual: 2,
    });
  });

  it('«Тур пакет» xizmati bog‘langan har qatorga hisoblanadi', () => {
    const m = multiCity();
    // Nusa Dua: mehmonxona + transfer tur paketda
    m.input.services!.push(svc('tour', toHotel(m.nusa.id)));
    m.input.services = m.input.services!.filter(
      (s) => !(s.typeKey === 'transfer' && s.links[0]?.hotelId === m.nusa.id),
    );
    const r = checkContract(m.input);
    expect(
      r.compare!.find((x) => x.ref?.id === m.nusa.id && x.section === 'hotels'),
    ).toMatchObject({ level: 'ok' });
  });
});

describe('«Тур пакет» faqat bog‘langan qatori uchun sanaladi (10-qism)', () => {
  // Dubay: shartnomada transfer yo'q; tur paket 2 parvoz + mehmonxonaga bog'langan
  function dubai() {
    const f1 = flight('Toshkent', 'Dubay');
    const f2 = flight('Dubay', 'Toshkent');
    const h1 = hotel('Dubay', '2026-12-01', '2026-12-08', {
      transferType: 'none',
      transferRoute: null,
    });
    const tour = svc('tour', [...toFlight(f1.id, f2.id), ...toHotel(h1.id)]);
    const input: CheckInput = {
      tour: {
        departureDate: '2026-12-01',
        returnDate: '2026-12-08',
        tourists: 2,
      },
      flights: [f1, f2],
      hotels: [h1],
      extras: [],
      insurance: 'not_included',
      visa: 'not_required',
      services: [tour],
    };
    return { input, h1 };
  }

  it('Dubay: transfer yo‘q, tur paket mehmonxonaga bog‘langan — transfer ogohlantirishi yo‘q', () => {
    const r = checkContract(dubai().input);
    expect(r.compare!.filter((x) => x.section === 'transfer')).toHaveLength(0);
    expect(r.warnings).toBe(0);
    expect(r.compare!.filter((x) => x.code === 'avia_ok')).toHaveLength(2);
    expect(codes(r, 'ok')).toContain('hotel_ok');
  });

  it('Dubay: haqiqiy «Трансфер» qo‘shilsa — «shartnomada transfer yo‘q, kassada 1 ta»', () => {
    const d = dubai();
    d.input.services!.push(svc('transfer', toHotel(d.h1.id)));
    const w = find(checkContract(d.input), 'transfer_not_in_contract')!;
    expect(w).toMatchObject({ actual: 1 });
    expect(w.uz).toBe(
      "Transfer · Dubay: shartnomada transfer yo'q, kassada 1 ta",
    );
  });

  it('transfer kerak: tur paket «ko‘p qo‘shdingiz»ga qo‘shilmaydi', () => {
    const { input } = oneCity();
    // 1 mehmonxona -> ko'pi bilan 2 transfer; kassada 2 transfer + mehmonxonaga bog'langan tur paket
    input.services!.push(svc('tour', toHotel(input.hotels[0].id)));
    const r = checkContract(input);
    expect(codes(r)).not.toContain('transfer_too_many');
    expect(r.compare!.find((x) => x.section === 'transfer')).toMatchObject({
      level: 'ok',
      actual: 2,
    });
  });

  it('transfer kerak, faqat tur paket bog‘langan — «tur paket ichida», ogohlantirish yo‘q', () => {
    const { input } = oneCity();
    input.services = input.services!.filter((s) => s.typeKey !== 'transfer');
    input.services.push(svc('tour', toHotel(input.hotels[0].id)));
    const r = checkContract(input);
    expect(find(r, 'transfer_in_tour')).toMatchObject({
      level: 'ok',
      uz: 'Transfer · Fukuok: tur paket ichida',
    });
    expect(codes(r)).not.toContain('transfer_missing');
  });

  it('tur paket boshqa shahar mehmonxonasiga yoki faqat parvozga bog‘langan — transferni qoplamaydi', () => {
    const { input, f1, f2 } = oneCity();
    input.services = input.services!.filter((s) => s.typeKey !== 'transfer');
    const other = hotel('Hanoy', '2026-12-03', '2026-12-05');
    input.hotels.push(other);
    input.services.push(svc('tour', toFlight(f1.id, f2.id))); // faqat parvoz
    input.services.push(svc('tour', toHotel(other.id))); // boshqa shahar
    const r = checkContract(input);
    expect(
      r.compare!.find(
        (x) => x.section === 'transfer' && x.ref?.city === 'Fukuok',
      ),
    ).toMatchObject({ level: 'warn', code: 'transfer_missing' });
    expect(
      r.compare!.find(
        (x) => x.section === 'transfer' && x.ref?.city === 'Hanoy',
      ),
    ).toMatchObject({
      code: 'transfer_in_tour',
      uz: 'Transfer · Hanoy: tur paket ichida',
    });
  });

  it('sug‘urta, viza va qo‘shimcha xizmat: mehmonxonaga bog‘langan tur paket ularga sanalmaydi', () => {
    const d = dubai();
    const exc = {
      id: ++seq,
      position: 0,
      name: 'Safari',
      paymentMode: 'included',
    };
    d.input.extras = [exc];
    d.input.insurance = 'included';
    d.input.visa = 'included';
    const r = checkContract(d.input);
    expect(find(r, 'insurance_missing')).toBeDefined();
    expect(find(r, 'visa_missing')).toBeDefined();
    expect(find(r, 'extra_missing')).toMatchObject({ actual: 0 });
    // tur paket qo'shimcha xizmatga ham aniq bog'lansa - o'sha qator uchun sanaladi
    d.input.services![0].links.push({ itemType: 'extra', extraId: exc.id });
    expect(codes(checkContract(d.input))).toContain('extra_ok');
  });
});

describe('Qo‘shimcha xizmatlar', () => {
  it('yo‘q bo‘lsa - hech narsa chiqmaydi; «narxga kiritilgan» - 1 xizmat; «alohida» - tekshirilmaydi', () => {
    const { input } = oneCity();
    expect(
      checkContract(input).compare!.filter((x) => x.section === 'extras'),
    ).toHaveLength(0);

    const exc = {
      id: ++seq,
      position: 0,
      name: 'Ekskursiya',
      paymentMode: 'included',
    };
    const vip = {
      id: ++seq,
      position: 1,
      name: 'VIP-zal',
      paymentMode: 'separate',
    };
    input.extras = [exc, vip];
    const missing = checkContract(input);
    expect(find(missing, 'extra_missing')!.uz).toBe(
      "Qo'shimcha 1 · Ekskursiya: kassada xizmat yo'q",
    );
    expect(missing.compare!.some((x) => x.ref?.id === vip.id)).toBe(false);

    input.services!.push(
      svc('excursion', [{ itemType: 'extra', extraId: exc.id }]),
    );
    expect(codes(checkContract(input))).toContain('extra_ok');
  });
});

describe('Yo‘lovchilar ma‘lumoti (8-qism)', () => {
  const base = (passengers?: number): CheckInput => ({
    tour: { tourists: 2, passengers },
    flights: [],
    hotels: [],
    extras: [],
    insurance: 'not_included',
    visa: 'not_required',
  });
  it('2 turistdan 1 tasi kiritilgan — kulrang izoh (ogohlantirishlar soniga kirmaydi)', () => {
    const r = checkContract(base(1));
    const x = r.internal.find((i) => i.code === 'passengers_incomplete')!;
    expect(x).toMatchObject({ level: 'info', expected: 2, actual: 1 });
    expect(x.uz).toBe("2 turistdan 1 tasining ma'lumoti kiritilgan");
    expect(r.warnings).toBe(0);
  });
  it('hammasi kiritilgan yoki son berilmagan — izoh yo‘q', () => {
    expect(checkContract(base(2)).internal).toHaveLength(0);
    expect(checkContract(base()).internal).toHaveLength(0);
  });
});
