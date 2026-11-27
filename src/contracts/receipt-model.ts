/**
 * Kvitansiya MATNI - bitta manba (RU/UZ yorliqlar, ovqat / transfer / bagaj yozuvlari, jadvallar, summa bloki).
 * Tuzilma dizayn bo'yicha: «2 · Chop etiladigan kvitansiya (A4)» va «6 · Ko'p shaharli tur — A4 kvitansiya».
 * Shu funksiya natijasidan ikkalasi chiziladi:
 *  - serverdagi PDF (chop etish, PDF yuklash, Telegram) - receipt-pdf.ts;
 *  - shartnoma sahifasidagi jonli ko'rinish (frontend, POST /contracts/receipt-preview).
 * Hech narsaga bog'liq emas (baza, nest yo'q): faqat kirish -> model. Demo rejim uchun frontend nusxasi
 * (tur_agent_bot_front_web/src/demo/receiptModel.ts) shu faylning o'zi.
 */

export type ReceiptLang = 'ru' | 'uz';

/** Matn bo'lagi: b=true - qalin (Sozlamalarda **shunday** belgilanadi) */
export interface Run {
  t: string;
  b?: boolean;
}

/** Versiya snapshot'i (buildSnapshot) yoki jonli ko'rinish uchun yig'ilgan kirish. Hammasi ixtiyoriy - model o'zi tuzatadi */
export interface ReceiptInput {
  number?: string;
  contractDate?: string | null; // 'YYYY-MM-DD'
  /** Berilgan vaqt (ISO): «Дата выдачи» (Toshkent kuni) */
  issuedAt?: string | null;
  /** Kassa sanasi (tur sotilgan kun, 'YYYY-MM-DD'): «Курс на …» shu sana. Bo'lmasa - faqat «Курс» */
  saleDate?: string | null;
  version?: number | null;
  firm?: {
    name?: string;
    address?: string | null;
    phone?: string | null;
    telegram?: string | null;
    logoUrl?: string | null;
  };
  client?: { name?: string | null; phone?: string | null };
  tour?: {
    destination?: string;
    departureDate?: string | null;
    returnDate?: string | null;
    tourists?: number;
  };
  flights?: object[];
  hotels?: object[];
  extras?: object[];
  insurance?: string;
  visa?: string;
  price?: {
    amount?: number;
    currency?: string;
    rate?: number;
    totalUzs?: number;
  };
  payments?: {
    paidUzs?: number;
    debtUzs?: number;
    currency?: string;
    paidInCurrency?: number;
    debtInCurrency?: number;
  };
  texts?: {
    warning?: { ru?: string; uz?: string };
    terms?: { ru?: string[]; uz?: string[] };
  };
}

export interface ReceiptTable {
  head: string[];
  rows: string[][];
  /** ustun kengliklari, dizayndagi px (794 px = A4); 0 - qolgan joyni oladi */
  widths: number[];
}

export interface ReceiptModel {
  lang: ReceiptLang;
  firm: {
    name: string;
    address: string;
    phone: string;
    telegram: string;
    logoUrl: string | null;
  };
  numberLabel: string;
  number: string;
  version: number | null;
  /** «продолжение» - 2-sahifa tepasidagi qisqa shapka */
  continued: string;
  title: string;
  /** 4 katakli ramka: Тур в · Даты · Туристов · Дата выдачи */
  tourCells: { k: string; v: string }[];
  /** Jadvalli bo'limlar (1. АВИАПЕРЕЛЁТЫ, 2. ПРОЖИВАНИЕ, 3. ДОПОЛНИТЕЛЬНЫЕ УСЛУГИ - bo'lmasa chiqmaydi) */
  sections: {
    no: number;
    title: string;
    table: ReceiptTable;
    /** jadval ostidagi kichik izoh (masalan, ovqat kodlari) */
    note?: string;
  }[];
  /** Transfer / sug'urta / viza: bitta qatorli ramka, 3 katak (2 : 1 : 1) */
  info: { k: string; v: string }[];
  /** Summa: gorizontal ramka (oxirgi katak kulrang) */
  totals: { k: string; v: string; shaded?: boolean }[];
  warning: Run[] | null;
  termsTitle: string;
  terms: Run[][];
  signatures: {
    firm: { label: string; name: string; manager: string; sign: string };
    client: { label: string; name: string; phone: string; sign: string };
    qr: { title: string; caption: string };
  };
}

/* ------------------------------ matnlar ------------------------------ */

const T = {
  ru: {
    numberLabel: 'Договор №',
    continued: 'продолжение',
    title: 'КВИТАНЦИЯ ОБ ОПЛАТЕ ТУРИСТИЧЕСКИХ УСЛУГ',
    tourIn: 'Тур в',
    dates: 'Даты',
    tourists: 'Туристов',
    issued: 'Дата выдачи',
    avia: 'АВИАПЕРЕЛЁТЫ',
    stay: 'ПРОЖИВАНИЕ',
    extras: 'ДОПОЛНИТЕЛЬНЫЕ УСЛУГИ',
    transfer: 'Трансфер',
    insurance: 'Страхование',
    visa: 'Виза',
    people: (n: number) =>
      `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'человек' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'человека' : 'человек'}`,
    kg: (s: string) => s.replace(/\bkg\b/gi, 'кг'),
    noBag: 'без багажа',
    mixBag: (a: number, type: string, b: number) =>
      `${a} чел. ${type}, ${b} без багажа`.replace('  ', ' '),
    via: (c: string) => `транзит ${c}`,
    group: 'групповой',
    individual: 'индивидуальный',
    allCities: 'во всех городах',
    notIncluded: 'не включен',
    route: {
      full: 'аэропорт — отель — аэропорт',
      arrival: 'только встреча',
      departure: 'только проводы',
    } as Record<string, string>,
    yesIns: 'включено',
    noIns: 'не включено',
    yesVisa: 'включена',
    noVisa: 'не включена',
    notRequired: 'не требуется',
    included: 'включено в стоимость',
    separate: 'оплачивается отдельно',
    flightsHead: ['№', 'Маршрут', 'Дата', 'Авиакомпания', 'Багаж'],
    meals: {
      RO: 'без питания',
      BB: 'завтрак',
      HB: 'завтрак и ужин',
      FB: 'трёхразовое питание',
      AI: 'всё включено',
      UAI: 'ультра всё включено',
    } as Record<string, string>,
    hotelsHead: ['№', 'Город', 'Отель / номер', 'Пит.', 'Даты', 'Ночи'],
    extrasHead: ['№', 'Услуга', 'Город', 'Дата', 'Оплата'],
    cost: 'Стоимость',
    rateOn: (d: string) => `Курс на ${d}`,
    rate: 'Курс',
    total: 'Итого',
    paid: 'Оплачено',
    rest: 'Остаток',
    termsTitle:
      'Подписывая данный документ, Вы соглашаетесь со следующими условиями:',
    firmLabel: 'ТУРФИРМА',
    clientLabel: 'КЛИЕНТ',
    manager: 'Менеджер',
    sign: 'Подпись',
    stamp: 'М.П.',
    qr: 'Проверка подлинности',
    dash: '—',
  },
  uz: {
    numberLabel: 'Dogovor №',
    continued: 'davomi',
    title: "TURISTIK XIZMATLAR UCHUN TO'LOV KVITANSIYASI",
    tourIn: 'Tur',
    dates: 'Sanalar',
    tourists: 'Turistlar',
    issued: 'Berilgan sana',
    avia: 'AVIAPARVOZLAR',
    stay: 'YASHASH',
    extras: "QO'SHIMCHA XIZMATLAR",
    transfer: 'Transfer',
    insurance: "Sug'urta",
    visa: 'Viza',
    people: (n: number) => `${n} kishi`,
    kg: (s: string) => s,
    noBag: 'bagajsiz',
    mixBag: (a: number, type: string, b: number) =>
      `${a} kishi ${type}, ${b} kishi bagajsiz`.replace('  ', ' '),
    via: (c: string) => `tranzit ${c}`,
    group: 'guruh',
    individual: 'individual',
    allCities: 'barcha shaharlarda',
    notIncluded: 'kiritilmagan',
    route: {
      full: 'aeroport — mehmonxona — aeroport',
      arrival: 'faqat kutib olish',
      departure: 'faqat kuzatish',
    } as Record<string, string>,
    yesIns: 'kiritilgan',
    noIns: 'kiritilmagan',
    yesVisa: 'kiritilgan',
    noVisa: 'kiritilmagan',
    notRequired: 'kerak emas',
    included: 'narxga kiritilgan',
    separate: "alohida to'lanadi",
    flightsHead: ['№', "Yo'nalish", 'Sana', 'Aviakompaniya', 'Bagaj'],
    meals: {
      RO: 'ovqatsiz',
      BB: 'nonushta',
      HB: 'nonushta va kechki ovqat',
      FB: 'uch mahal ovqat',
      AI: 'hammasi kiritilgan',
      UAI: 'ultra hammasi kiritilgan',
    } as Record<string, string>,
    hotelsHead: [
      '№',
      'Shahar',
      'Mehmonxona / nomer',
      'Ovqat',
      'Sanalar',
      'Kecha',
    ],
    extrasHead: ['№', 'Xizmat', 'Shahar', 'Sana', "To'lov"],
    cost: 'Narxi',
    rateOn: (d: string) => `${d} dagi kurs`,
    rate: 'Kurs',
    total: 'Jami',
    paid: "To'langan",
    rest: 'Qoldiq',
    termsTitle:
      'Ushbu hujjatni imzolab, Siz quyidagi shartlarga rozilik bildirasiz:',
    firmLabel: 'TURFIRMA',
    clientLabel: 'MIJOZ',
    manager: 'Menejer',
    sign: 'Imzo',
    stamp: "M.O'.",
    qr: 'Haqiqiylikni tekshirish',
    dash: '—',
  },
};

/* ------------------------------ yordamchilar ------------------------------ */

const str = (x: unknown): string =>
  typeof x === 'string' ? x.trim() : typeof x === 'number' ? String(x) : '';
const numv = (x: unknown): number => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};
const list = (x: unknown): Array<Record<string, unknown>> =>
  Array.isArray(x)
    ? x.filter(
        (i): i is Record<string, unknown> => !!i && typeof i === 'object',
      )
    : [];

const isoDay = (d?: unknown): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(d));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};
/** 'YYYY-MM-DD' -> 'DD.MM' */
const dm = (d?: unknown) => {
  const v = isoDay(d);
  return v ? `${v.slice(8, 10)}.${v.slice(5, 7)}` : '';
};
/** 'YYYY-MM-DD' -> 'DD.MM.YYYY' */
const dmy = (d?: unknown) => {
  const v = isoDay(d);
  return v ? `${v.slice(8, 10)}.${v.slice(5, 7)}.${v.slice(0, 4)}` : '';
};
const dayNo = (d: unknown) => {
  const v = isoDay(d);
  return v
    ? Date.UTC(+v.slice(0, 4), +v.slice(5, 7) - 1, +v.slice(8, 10)) / 86_400_000
    : null;
};
const nightsOf = (a: unknown, b: unknown) => {
  const x = dayNo(a);
  const y = dayNo(b);
  return x === null || y === null ? null : y - x;
};
/** ISO vaqt -> Toshkent kuni 'YYYY-MM-DD' (UTC+5, yozgi vaqt yo'q) */
const tashkentDay = (iso: unknown): string | null => {
  const s = str(iso);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ms = Date.parse(s);
  return Number.isNaN(ms)
    ? null
    : new Date(ms + 5 * 3_600_000).toISOString().slice(0, 10);
};

/** Minglar va raqam-valyuta orasi - bo'linmaydigan bo'shliq (NBSP): summa qatorga bo'linib ketmasin */
const NBSP = '\u00a0';
const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
/** Pul: har doim 2 xonali kasr (dizayndagidek: 1 400,00) */
const dec2 = (n: number) => {
  const r = Math.round(n * 100) / 100;
  const [i, f] = Math.abs(r).toFixed(2).split('.');
  return `${r < 0 ? '-' : ''}${group(+i)},${f}`;
};
const int = (n: number) => group(Math.round(n));

/**
 * Telefon ko'rinishi: «+998702348888» -> «+998 70 234 88 88» (bazadagi qiymat o'zgarmaydi).
 * O'zbekiston raqami bo'lmasa - o'zgarishsiz.
 */
export function formatPhone(raw?: string | null): string {
  const s = (raw ?? '').trim();
  let d = s.replace(/\D/g, '');
  if (d.length === 9) d = `998${d}`;
  if (d.length === 12 && d.startsWith('998')) {
    return `+998 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8, 10)} ${d.slice(10, 12)}`;
  }
  return s;
}

/** Ochiq sahifa uchun yashirilgan telefon: «+998 70 *** ** 88» (O'zbekiston raqami bo'lmasa - faqat oxirgi 2 raqam) */
export function maskPhone(raw?: string | null): string | null {
  const f = formatPhone(raw);
  if (!f) return null;
  const m = /^\+998 (\d{2}) \d{3} \d{2} (\d{2})$/.exec(f);
  if (m) return `+998 ${m[1]} *** ** ${m[2]}`;
  const d = f.replace(/\D/g, '');
  return d.length > 2 ? `${'*'.repeat(d.length - 2)}${d.slice(-2)}` : null;
}

/** Ochiq sahifa uchun mijoz: «KHAMRAKULOV FURKATJON» -> «KHAMRAKULOV F.» */
export function maskClientName(name?: string | null): string | null {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  return parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
}

/** «**qalin** oddiy» -> bo'laklar. Juftlanmagan ** qolgan qismni qalin qiladi */
export function parseRuns(s: string): Run[] {
  const out: Run[] = [];
  let bold = false;
  for (const part of s.split('**')) {
    if (part) out.push(bold ? { t: part, b: true } : { t: part });
    bold = !bold;
  }
  return out;
}

/* ------------------------------ model ------------------------------ */

export function buildReceiptModel(
  input: ReceiptInput,
  lang: ReceiptLang,
): ReceiptModel {
  const t = T[lang];
  const tourists = Math.max(0, Math.round(numv(input.tour?.tourists)));
  const flights = list(input.flights).filter(
    (f) => str(f.fromCity) || str(f.toCity),
  );
  const hotels = list(input.hotels).filter((h) => str(h.city));
  const extras = list(input.extras).filter((e) => str(e.name));
  const dep = isoDay(input.tour?.departureDate);
  const ret = isoDay(input.tour?.returnDate);
  const issueDay =
    tashkentDay(input.issuedAt) ?? isoDay(input.contractDate) ?? null;

  /** Sana: tur yilida bo'lsa 'DD.MM', boshqa yilda - 'DD.MM.YYYY' */
  const dayText = (d: unknown) => {
    const v = isoDay(d);
    if (!v) return '';
    return dep && v.slice(0, 4) !== dep.slice(0, 4) ? dmy(v) : dm(v);
  };

  /* ---- 1. Aviaperelyoty ---- */
  const bagText = (f: Record<string, unknown>) => {
    const type = t.kg(str(f.baggageType));
    const pax = numv(f.baggagePaxCount);
    if (pax <= 0) return t.noBag;
    if (pax >= tourists) return type || t.dash;
    return t.mixBag(pax, type, tourists - pax);
  };
  const flightsTable: ReceiptTable | null = flights.length
    ? {
        head: t.flightsHead,
        widths: [22, 0, 60, 150, 175],
        rows: flights.map((f, i) => {
          const transit = str(f.transitCity);
          return [
            String(i + 1),
            `${str(f.fromCity)} — ${str(f.toCity)}${transit ? ` (${t.via(transit)})` : ''}`,
            dayText(f.date) || t.dash,
            str(f.airline) || t.dash,
            bagText(f),
          ];
        }),
      }
    : null;

  /* ---- 2. Projivaniye ---- */
  const hotelsTable: ReceiptTable | null = hotels.length
    ? {
        head: t.hotelsHead,
        widths: [22, 100, 0, 52, 112, 52],
        rows: hotels.map((h, i) => {
          const n = nightsOf(h.checkIn, h.checkOut);
          const stars = numv(h.stars) ? `${numv(h.stars)}*` : '';
          const rooms = numv(h.roomsCount);
          const room = [
            rooms > 1 ? `${rooms}x` : '',
            str(h.roomType),
            str(h.placement),
          ]
            .filter(Boolean)
            .join(' ');
          const name = [str(h.name), stars].filter(Boolean).join(' ');
          return [
            String(i + 1),
            str(h.city),
            [name, room].filter(Boolean).join(' — ') || t.dash,
            str(h.meal) || t.dash,
            isoDay(h.checkIn) || isoDay(h.checkOut)
              ? `${dm(h.checkIn)} — ${dm(h.checkOut)}`
              : t.dash,
            n !== null ? String(n) : t.dash,
          ];
        }),
      }
    : null;

  /* ---- 3. Dop. uslugi (faqat bo'lsa) ---- */
  const extrasTable: ReceiptTable | null = extras.length
    ? {
        head: t.extrasHead,
        widths: [22, 0, 96, 60, 185],
        rows: extras.map((e, i) => {
          const price = e.priceUsd == null ? null : numv(e.priceUsd);
          const pax = numv(e.pax);
          const name =
            pax > 0 && pax !== tourists
              ? `${str(e.name)} (${t.people(pax)})`
              : str(e.name);
          return [
            String(i + 1),
            name,
            str(e.city) || t.dash,
            dayText(e.date) || t.dash,
            str(e.paymentMode) === 'separate'
              ? `${t.separate}${price != null ? `, ${int(price)}${NBSP}$` : ''}`
              : t.included,
          ];
        }),
      }
    : null;

  // ovqat izohi: faqat shu kvitansiyada ishlatilgan kodlar («BB — завтрак · HB — …»)
  const usedMeals = ['RO', 'BB', 'HB', 'FB', 'AI', 'UAI'].filter((c) =>
    hotels.some((h) => str(h.meal).toUpperCase() === c),
  );
  const mealNote = usedMeals.length
    ? usedMeals.map((c) => `${c} — ${t.meals[c]}`).join(' · ')
    : undefined;

  const sections: ReceiptModel['sections'] = [];
  const add = (title: string, table: ReceiptTable | null, note?: string) => {
    if (table) sections.push({ no: sections.length + 1, title, table, note });
  };
  add(t.avia, flightsTable);
  add(t.stay, hotelsTable, mealNote);
  add(t.extras, extrasTable);

  /* ---- transfer: bir xil turdagi shaharlar guruhlanadi ---- */
  const withTransfer = hotels.filter((h) => str(h.transferType) !== 'none');
  const transferText = (() => {
    if (!withTransfer.length) return t.notIncluded;
    const typeName = (h: Record<string, unknown>) =>
      str(h.transferType) === 'group' ? t.group : t.individual;
    const cities = new Set(hotels.map((h) => str(h.city).toLowerCase()));
    // bir shaharli tur: «групповой: аэропорт — отель — аэропорт»
    if (cities.size === 1) {
      const h = withTransfer[0];
      return `${typeName(h)}: ${t.route[str(h.transferRoute)] ?? t.route.full}`;
    }
    // shahar bo'yicha (bir shaharda 2 mehmonxona bo'lsa - bir marta)
    const byType = new Map<string, string[]>();
    const seen = new Set<string>();
    for (const h of withTransfer) {
      const city = str(h.city);
      const key = `${typeName(h)}|${city.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const route = str(h.transferRoute);
      const label =
        route === 'arrival' || route === 'departure'
          ? `${city} (${t.route[route]})`
          : city;
      byType.set(typeName(h), [...(byType.get(typeName(h)) ?? []), label]);
    }
    const covered = new Set(withTransfer.map((h) => str(h.city).toLowerCase()));
    if (byType.size === 1 && covered.size === cities.size) {
      const [name, labels] = [...byType.entries()][0];
      const plain = labels.every((l) => !l.includes('('));
      return plain
        ? `${name}, ${t.allCities}`
        : `${name}${NBSP}— ${labels.join(', ')}`;
    }
    return [...byType.entries()]
      .map(([name, labels]) => `${name}${NBSP}— ${labels.join(', ')}`)
      .join('; ');
  })();
  const yn = (m: string, yes: string, no: string) =>
    m === 'included' ? yes : m === 'not_required' ? t.notRequired : no;
  const info = [
    { k: t.transfer, v: transferText },
    { k: t.insurance, v: yn(str(input.insurance), t.yesIns, t.noIns) },
    { k: t.visa, v: yn(str(input.visa), t.yesVisa, t.noVisa) },
  ];

  /* ---- summa bloki (5 katak; narx so'mda bo'lsa - 3 katak) ---- */
  const cur = str(input.price?.currency) || 'UZS';
  const amount = numv(input.price?.amount);
  const rate = numv(input.price?.rate);
  const totalUzs = numv(input.price?.totalUzs);
  const pay = input.payments ?? {};
  const totals: ReceiptModel['totals'] = [];
  if (cur === 'UZS') {
    totals.push({ k: `${t.cost}, UZS`, v: int(amount) });
    totals.push({ k: `${t.paid}, UZS`, v: int(numv(pay.paidUzs)) });
    totals.push({
      k: `${t.rest}, UZS`,
      v: int(Math.max(numv(pay.debtUzs), 0)),
      shaded: true,
    });
  } else {
    totals.push({ k: `${t.cost}, ${cur}`, v: amount ? dec2(amount) : t.dash });
    totals.push({
      k: isoDay(input.saleDate) ? t.rateOn(dm(input.saleDate)) : t.rate,
      v: rate ? int(rate) : t.dash,
    });
    totals.push({
      k: `${t.total}, UZS`,
      v: totalUzs ? int(totalUzs) : t.dash,
    });
    totals.push({ k: `${t.paid}, UZS`, v: int(numv(pay.paidUzs)) });
    totals.push({
      k: `${t.rest}, ${cur}`,
      v: dec2(Math.max(numv(pay.debtInCurrency), 0)),
      shaded: true,
    });
  }

  /* ---- matnlar, shapka ---- */
  const warning = str(input.texts?.warning?.[lang]);
  const terms = (input.texts?.terms?.[lang] ?? [])
    .map((x) => str(x))
    .filter(Boolean);
  const range =
    dep && ret
      ? dep.slice(0, 4) === ret.slice(0, 4)
        ? `${dm(dep)} — ${dmy(ret)}`
        : `${dmy(dep)} — ${dmy(ret)}`
      : dmy(dep) || dmy(ret) || t.dash;

  return {
    lang,
    firm: {
      name: str(input.firm?.name),
      address: str(input.firm?.address),
      phone: str(input.firm?.phone),
      telegram: str(input.firm?.telegram),
      logoUrl: str(input.firm?.logoUrl) || null,
    },
    numberLabel: t.numberLabel,
    number: str(input.number),
    version:
      input.version != null && numv(input.version) > 0
        ? numv(input.version)
        : null,
    continued: t.continued,
    title: t.title,
    tourCells: [
      { k: t.tourIn, v: str(input.tour?.destination) || t.dash },
      { k: t.dates, v: range },
      { k: t.tourists, v: tourists ? t.people(tourists) : t.dash },
      { k: t.issued, v: dmy(issueDay) || t.dash },
    ],
    sections,
    info,
    totals,
    warning: warning ? parseRuns(warning) : null,
    termsTitle: t.termsTitle,
    terms: terms.map(parseRuns),
    signatures: {
      firm: {
        label: t.firmLabel,
        name: str(input.firm?.name),
        manager: `${t.manager}: ______________________`,
        sign: `${t.sign} ____________ ${t.stamp}`,
      },
      client: {
        label: t.clientLabel,
        name: str(input.client?.name),
        phone: formatPhone(str(input.client?.phone)),
        sign: `${t.sign} ______________________`,
      },
      qr: { title: 'QR', caption: t.qr },
    },
  };
}
