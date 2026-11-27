/**
 * Kvitansiya namunalari uchun REAL'ga yaqin ma'lumotlar (testlar va ops/dev/shartnoma/pdf-namunalar uchun).
 * Matnlar - Sozlamalarning standart (seed) shabloni; UZ matn - NAMUNA TARJIMA (haqiqiy tarjimani admin kiritadi).
 */
import { DEFAULT_SETTINGS } from '../settings/settings.service';
import type { ReceiptInput } from './receipt-model';

/** NAMUNA TARJIMA (faqat sinov uchun): RU matnning o'zbekcha varianti */
export const UZ_SAMPLE_TEXTS = {
  warning:
    "**Valyuta kursi tebranishidan qochish uchun tur narxining 100% ini to'lang!** Turni qismlarga bo'lib (50%, 70%) to'lagan va valyuta kursi o'zgargan (oshgan yoki tushgan) taqdirda, mijoz turpaketning qoldig'ini to'lov kunidagi xizmat ta'minotchisining yangi kursi bo'yicha to'laydi.",
  terms: [
    'Bron qilishdan oldin turpaketni tekshirib, tasdiqlash kerak (uchish va qaytish sanalari, yashash sanalari, mehmonxona, nomer turi).',
    "**Turga o'zgartirish kiritilgan taqdirda** (mehmonxona, nomer turi, uchish va qaytish sanalarini o'zgartirish, turistni almashtirish va boshqalar) bron qilingandan keyin (sababidan qat'i nazar), turist xizmat ta'minotchisi narxnomasiga muvofiq jarima to'laydi. **100% jarima olinadi!**",
    "**Turni qayta bron qilish** (mehmonxona, nomer turi, uchish va qaytish sanalarini o'zgartirish va boshqalar) bron tizimining (onlayn) yangi narxi bo'yicha amalga oshiriladi. Bron qilingan tur uchun **100% jarima olinadi.**",
    "**Safardan voz kechilgan taqdirda** (turni bekor qilish yoki foydalanmaslik), turist sababidan qat'i nazar shaxsan javobgar bo'ladi va **turfirmaga 100% to'lovni qoplaydi.** Chunki barcha turlar (mehmonxona, transfer, aviachipta, sug'urta va boshqalar) «Qaytarilmaydigan tarif» bo'yicha bron qilinadi.",
    "Xizmat ta'minotchisidan turning tasdig'i olinmagan taqdirda (mehmonxona yoki samolyot 100% to'lganligi sababli), turist mehmonxonaning muqobil variantini tanlashi yoki tur sanalarini o'zgartirishi kerak.",
  ],
};

export function sampleTexts(withUz = true): ReceiptInput['texts'] {
  const c = DEFAULT_SETTINGS.contract;
  return {
    warning: { ru: c.warning.ru, uz: withUz ? UZ_SAMPLE_TEXTS.warning : '' },
    terms: { ru: c.terms.ru, uz: withUz ? UZ_SAMPLE_TEXTS.terms : [] },
  };
}

const FIRM = {
  name: 'KAKOS TOUR',
  address: 'Ташкент, ул. Амира Темура, 15',
  phone: '+998 71 200 00 00',
  telegram: '@kakos_tour',
};

/** Bir shaharli: Вьетнам — Фукуок (foydalanuvchining real kvitansiyasi) */
export function oneCitySample(): ReceiptInput {
  return {
    number: 'A000012',
    contractDate: '2026-11-24',
    saleDate: '2026-11-24',
    issuedAt: '2026-11-24T07:30:00.000Z',
    version: 1,
    firm: FIRM,
    client: { name: 'KHAMRAKULOV FURKATJON', phone: '+998 70 234 88 88' },
    tour: {
      destination: 'Вьетнам — Фукуок',
      departureDate: '2026-11-25',
      returnDate: '2026-12-03',
      tourists: 2,
    },
    flights: [
      {
        fromCity: 'Ташкент',
        toCity: 'Фукуок',
        date: '2026-11-25',
        airline: 'Qanot Sharq',
        baggageType: '20+5 kg',
        baggagePaxCount: 2,
      },
      {
        fromCity: 'Фукуок',
        toCity: 'Ташкент',
        date: '2026-12-03',
        airline: 'Qanot Sharq',
        baggageType: '20+5 kg',
        baggagePaxCount: 2,
      },
    ],
    hotels: [
      {
        city: 'Фукуок',
        name: 'La Vita Serenity Phu Quoc',
        stars: 4,
        roomType: 'Deluxe',
        placement: 'DBL',
        roomsCount: 1,
        meal: 'BB',
        checkIn: '2026-11-25',
        checkOut: '2026-12-03',
        transferType: 'group',
        transferRoute: 'full',
      },
    ],
    extras: [],
    insurance: 'included',
    visa: 'not_included',
    price: { amount: 1400, currency: 'USD', rate: 12000, totalUzs: 16_800_000 },
    payments: {
      paidUzs: 16_800_000,
      debtUzs: 0,
      currency: 'USD',
      paidInCurrency: 1400,
      debtInCurrency: 0,
    },
    texts: sampleTexts(),
  };
}

/** Ko'p shaharli 4+4+2: Ташкент → Куала-Лумпур → Сингапур → Бали → Ташкент */
export function multiCitySample(): ReceiptInput {
  return {
    number: 'A000013',
    contractDate: '2027-02-08',
    saleDate: '2027-02-08',
    issuedAt: '2027-02-08T09:10:00.000Z',
    version: 2,
    firm: FIRM,
    client: { name: 'IVANOV SERGEY', phone: '+998 90 123 45 67' },
    tour: {
      destination: 'Малайзия — Сингапур — Бали',
      departureDate: '2027-03-10',
      returnDate: '2027-03-20',
      tourists: 4,
    },
    flights: [
      {
        fromCity: 'Ташкент',
        toCity: 'Куала-Лумпур',
        date: '2027-03-10',
        airline: 'Uzbekistan Airways',
        baggageType: '20 kg',
        baggagePaxCount: 2,
      },
      {
        fromCity: 'Куала-Лумпур',
        toCity: 'Сингапур',
        date: '2027-03-12',
        airline: 'Batik Air',
        baggageType: '20 kg',
        baggagePaxCount: 2,
      },
      {
        fromCity: 'Сингапур',
        toCity: 'Бали',
        date: '2027-03-14',
        airline: 'Scoot',
        baggageType: '20 kg',
        baggagePaxCount: 2,
      },
      {
        fromCity: 'Бали',
        toCity: 'Ташкент',
        transitCity: 'Куала-Лумпур',
        date: '2027-03-20',
        airline: 'Batik Air',
        baggageType: '20 kg',
        baggagePaxCount: 2,
      },
    ],
    hotels: [
      {
        city: 'Куала-Лумпур',
        name: 'Grand KL Hotel',
        stars: 4,
        roomType: 'Deluxe',
        placement: 'DBL',
        roomsCount: 2,
        meal: 'BB',
        checkIn: '2027-03-10',
        checkOut: '2027-03-12',
        transferType: 'group',
        transferRoute: 'full',
      },
      {
        city: 'Сингапур',
        name: 'Marina Bay Stay',
        stars: 4,
        roomType: 'Standard',
        placement: 'DBL',
        roomsCount: 2,
        meal: 'RO',
        checkIn: '2027-03-12',
        checkOut: '2027-03-14',
        transferType: 'group',
        transferRoute: 'full',
      },
      {
        city: 'Бали',
        name: 'Ubud Garden Resort',
        stars: 4,
        roomType: 'Villa',
        placement: 'DBL',
        roomsCount: 2,
        meal: 'BB',
        checkIn: '2027-03-14',
        checkOut: '2027-03-17',
        transferType: 'individual',
        transferRoute: 'full',
      },
      {
        city: 'Бали',
        name: 'Nusa Dua Beach Hotel',
        stars: 5,
        roomType: 'Deluxe',
        placement: 'DBL',
        roomsCount: 2,
        meal: 'HB',
        checkIn: '2027-03-17',
        checkOut: '2027-03-20',
        transferType: 'individual',
        transferRoute: 'full',
      },
    ],
    extras: [
      {
        name: 'Экскурсия по Сингапуру',
        city: 'Сингапур',
        date: '2027-03-13',
        pax: 4,
        paymentMode: 'included',
        priceUsd: null,
      },
      {
        name: 'VIP-зал, аэропорт Ташкент',
        city: 'Ташкент',
        date: '2027-03-10',
        pax: 4,
        paymentMode: 'separate',
        priceUsd: 60,
      },
    ],
    insurance: 'included',
    visa: 'not_included',
    price: { amount: 5200, currency: 'USD', rate: 12650, totalUzs: 65_780_000 },
    payments: {
      paidUzs: 37_000_000,
      debtUzs: 28_780_000,
      currency: 'USD',
      paidInCurrency: 2924.9,
      debtInCurrency: 2275.1,
    },
    texts: sampleTexts(),
  };
}

/** 6 mehmonxona: Turkiya (2 sahifaga o'tadigan holat) */
export function sixHotelsSample(): ReceiptInput {
  const h = (
    city: string,
    name: string,
    stars: number,
    room: string,
    meal: string,
    a: string,
    b: string,
    tr = 'group',
  ) => ({
    city,
    name,
    stars,
    roomType: room,
    placement: 'DBL',
    roomsCount: 2,
    meal,
    checkIn: a,
    checkOut: b,
    transferType: tr,
    transferRoute: 'full',
  });
  return {
    number: 'A000014',
    contractDate: '2027-04-01',
    saleDate: '2027-04-01',
    issuedAt: '2027-04-01T06:00:00.000Z',
    version: 1,
    firm: FIRM,
    client: { name: 'KARIMOVA DILNOZA', phone: '+998 93 555 12 34' },
    tour: {
      destination: 'Турция',
      departureDate: '2027-04-10',
      returnDate: '2027-04-22',
      tourists: 4,
    },
    flights: [
      {
        fromCity: 'Ташкент',
        toCity: 'Стамбул',
        date: '2027-04-10',
        airline: 'Turkish Airlines',
        baggageType: '23 kg',
        baggagePaxCount: 4,
      },
      {
        fromCity: 'Стамбул',
        toCity: 'Каппадокия',
        date: '2027-04-12',
        airline: 'Pegasus',
        baggageType: '20 kg',
        baggagePaxCount: 4,
      },
      {
        fromCity: 'Каппадокия',
        toCity: 'Анталья',
        date: '2027-04-15',
        airline: 'AJet',
        baggageType: '20 kg',
        baggagePaxCount: 4,
      },
      {
        fromCity: 'Анталья',
        toCity: 'Ташкент',
        transitCity: 'Стамбул',
        date: '2027-04-22',
        airline: 'Turkish Airlines',
        baggageType: '23 kg',
        baggagePaxCount: 4,
      },
    ],
    hotels: [
      h(
        'Стамбул',
        'Sultanahmet Palace',
        4,
        'Standard',
        'BB',
        '2027-04-10',
        '2027-04-12',
      ),
      h(
        'Каппадокия',
        'Cave Suites Goreme',
        4,
        'Cave',
        'BB',
        '2027-04-12',
        '2027-04-14',
      ),
      h(
        'Памуккале',
        'Hierapolis Thermal',
        4,
        'Standard',
        'HB',
        '2027-04-14',
        '2027-04-15',
      ),
      h(
        'Анталья',
        'Lara Beach Resort',
        5,
        'Deluxe',
        'UAI',
        '2027-04-15',
        '2027-04-18',
        'individual',
      ),
      h(
        'Анталья',
        'Belek Golf Resort',
        5,
        'Deluxe',
        'UAI',
        '2027-04-18',
        '2027-04-20',
        'individual',
      ),
      h(
        'Анталья',
        'Kemer Marina Hotel',
        5,
        'Superior',
        'AI',
        '2027-04-20',
        '2027-04-22',
        'individual',
      ),
    ],
    extras: [
      {
        name: 'Круиз по Босфору',
        city: 'Стамбул',
        date: '2027-04-11',
        pax: 4,
        paymentMode: 'included',
        priceUsd: null,
      },
      {
        name: 'Полёт на воздушном шаре',
        city: 'Каппадокия',
        date: '2027-04-13',
        pax: 4,
        paymentMode: 'separate',
        priceUsd: 150,
      },
    ],
    insurance: 'included',
    visa: 'not_required',
    price: { amount: 7400, currency: 'USD', rate: 12650, totalUzs: 93_610_000 },
    payments: {
      paidUzs: 93_610_000,
      debtUzs: 0,
      currency: 'USD',
      paidInCurrency: 7400,
      debtInCurrency: 0,
    },
    texts: sampleTexts(),
  };
}

/** Sig'imni o'lchash uchun: F parvoz + H mehmonxona + E qo'shimcha xizmat (har biri bir qatorli, real shaharlar) */
export function sizedSample(f: number, h: number, e: number): ReceiptInput {
  const cities = [
    'Стамбул',
    'Анталья',
    'Каппадокия',
    'Дубай',
    'Абу-Даби',
    'Сингапур',
    'Куала-Лумпур',
    'Бали',
    'Бангкок',
    'Пхукет',
    'Хошимин',
    'Нячанг',
  ];
  const base = multiCitySample();
  const day = (n: number) => `2027-05-${String(1 + n).padStart(2, '0')}`;
  return {
    ...base,
    number: 'A000099',
    flights: Array.from({ length: f }, (_, i) => ({
      fromCity: cities[i % cities.length],
      toCity: cities[(i + 1) % cities.length],
      date: day(i),
      airline: 'Uzbekistan Airways',
      baggageType: '20 kg',
      baggagePaxCount: 4,
    })),
    hotels: Array.from({ length: h }, (_, i) => ({
      city: cities[i % cities.length],
      name: `Grand ${cities[i % cities.length]} Hotel`,
      stars: 4,
      roomType: 'Deluxe',
      placement: 'DBL',
      roomsCount: 2,
      meal: ['BB', 'HB', 'AI', 'UAI', 'RO'][i % 5],
      checkIn: day(i),
      checkOut: day(i + 1),
      transferType: i % 2 ? 'individual' : 'group',
      transferRoute: 'full',
    })),
    extras: Array.from({ length: e }, (_, i) => ({
      name: `Экскурсия ${i + 1}`,
      city: cities[i % cities.length],
      date: day(i),
      pax: 4,
      paymentMode: i % 2 ? 'separate' : 'included',
      priceUsd: i % 2 ? 60 : null,
    })),
  };
}
