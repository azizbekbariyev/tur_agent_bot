/**
 * Shartnoma tekshiruvi - YAGONA funksiya (backend). Frontend faqat natijani ko'rsatadi.
 * Bazaga bog'liq emas (sof hisob) - testlar: contract-check.spec.ts.
 *
 * 1) Ichki tekshiruv (shartnomaning o'zi): parvozlar zanjiri, bagajli turistlar soni,
 *    mehmonxona kechalari va ular orasidagi bo'sh / ustma-ust kechalar.
 * 2) Kassa bilan solishtirish (faqat shartnomasi bor kassada): har qatorga kutilgan va
 *    bog'langan kassa xizmatlari soni (docs/shartnoma.md, 2- va 4-qism qoidalari).
 * Ogohlantirish ishni to'xtatmaydi; «Tasdiqlash» da yana so'raladi (contract-hooks.ts).
 */
import { ServiceTypeKey } from '../common/service-types';

export type IssueLevel = 'ok' | 'info' | 'warn' | 'ask';
export type IssueSection =
  | 'tour'
  | 'flights'
  | 'hotels'
  | 'transfer'
  | 'insurance'
  | 'visa'
  | 'extras'
  | 'services';

export interface CheckIssue {
  level: IssueLevel;
  code: string;
  section: IssueSection;
  /** Qaysi qator: parvoz / mehmonxona / qo'shimcha xizmat / kassa xizmati / shahar */
  ref?: {
    type: 'flight' | 'hotel' | 'extra' | 'cash_service' | 'city';
    id?: number;
    position?: number;
    city?: string;
  };
  expected?: number;
  actual?: number;
  uz: string;
  ru: string;
}

export interface CheckFlight {
  id: number;
  position: number;
  fromCity: string;
  toCity: string;
  baggagePaxCount: number;
}

export interface CheckHotel {
  id: number;
  position: number;
  city: string;
  name?: string | null;
  roomsCount: number;
  checkIn?: string | null;
  checkOut?: string | null;
  transferType: string; // group | individual | none
  transferRoute?: string | null; // full | arrival | departure
  roomsSeparateConfirmed: boolean;
}

export interface CheckExtra {
  id: number;
  position: number;
  name: string;
  city?: string | null;
  paymentMode: string; // included | separate
}

export interface CheckLink {
  itemType: string; // flight | hotel | extra | insurance | visa
  flightId?: number | null;
  hotelId?: number | null;
  extraId?: number | null;
}

export interface CheckService {
  id: number;
  typeKey: ServiceTypeKey | null;
  label: string; // "TRIP COM — Aviabilet (JQRONC)"
  links: CheckLink[];
}

export interface CheckInput {
  tour: {
    departureDate?: string | null; // 'YYYY-MM-DD'
    returnDate?: string | null;
    tourists: number;
    /** Kiritilgan yo'lovchilar soni (berilmasa tekshirilmaydi) */
    passengers?: number;
  };
  flights: CheckFlight[];
  hotels: CheckHotel[];
  extras: CheckExtra[];
  insurance: string; // included | not_included
  visa: string; // included | not_included | not_required
  /** Kassa xizmatlari; berilmasa solishtirish qilinmaydi */
  services?: CheckService[];
}

export interface CheckResult {
  internal: CheckIssue[];
  compare: CheckIssue[] | null;
  /** «Tasdiqlash» da so'raladigan ogohlantirishlar soni (warn + ask) */
  warnings: number;
}

/* ------------------------------ yordamchilar ------------------------------ */

const norm = (s?: string | null) =>
  (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

const DAY = 86_400_000;
/** 'YYYY-MM-DD' (yoki ISO) -> UTC kun raqami; noto'g'ri bo'lsa null */
function dayNo(d?: string | null): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '');
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY;
}

export function nightsBetween(from?: string | null, to?: string | null) {
  const a = dayNo(from);
  const b = dayNo(to);
  return a === null || b === null ? null : b - a;
}

const fmtDay = (n: number) => {
  const d = new Date(n * DAY);
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const flightLabel = (f: CheckFlight, i: number) => ({
  uz: `Parvoz ${i + 1} · ${f.fromCity} → ${f.toCity}`,
  ru: `Перелёт ${i + 1} · ${f.fromCity} → ${f.toCity}`,
});

const hotelLabel = (h: CheckHotel, i: number) => {
  const where = h.name?.trim() ? `${h.city} (${h.name.trim()})` : h.city;
  return {
    uz: `Mehmonxona ${i + 1} · ${where}`,
    ru: `Отель ${i + 1} · ${where}`,
  };
};

const extraLabel = (e: CheckExtra, i: number) => ({
  uz: `Qo'shimcha ${i + 1} · ${e.name}`,
  ru: `Доп. услуга ${i + 1} · ${e.name}`,
});

/** «kassada xizmat yo'q» / «kutilgan 2 ta, kassada 1 ta» */
function countText(expected: number, actual: number) {
  if (actual === 0) {
    return { uz: "kassada xizmat yo'q", ru: 'в кассе нет услуги' };
  }
  return {
    uz: `kutilgan ${expected} ta, kassada ${actual} ta`,
    ru: `ожидается ${expected}, в кассе ${actual}`,
  };
}

const byPos = <T extends { position: number }>(a: T, b: T) =>
  a.position - b.position;

/* ------------------------------ 1. ichki tekshiruv ------------------------------ */

function checkInternal(input: CheckInput): CheckIssue[] {
  const out: CheckIssue[] = [];
  const flights = [...input.flights].sort(byPos);
  const hotels = [...input.hotels].sort(byPos);
  const T = input.tour.tourists;

  // ---- Parvozlar zanjiri: har keyingisi oldingisi tushgan shahardan, oxirgisi boshlangan shaharga ----
  if (flights.length) {
    let chainOk = true;
    for (let i = 1; i < flights.length; i++) {
      const prev = flights[i - 1];
      const cur = flights[i];
      if (norm(cur.fromCity) !== norm(prev.toCity)) {
        chainOk = false;
        out.push({
          level: 'warn',
          code: 'flight_chain_break',
          section: 'flights',
          ref: { type: 'flight', id: cur.id, position: i },
          uz: `${flightLabel(cur, i).uz}: oldingi parvoz ${prev.toCity} ga tushadi, bu parvoz ${cur.fromCity} dan boshlanadi`,
          ru: `${flightLabel(cur, i).ru}: предыдущий перелёт прибывает в ${prev.toCity}, этот вылетает из ${cur.fromCity}`,
        });
      }
    }
    const first = flights[0];
    const last = flights[flights.length - 1];
    if (norm(last.toCity) !== norm(first.fromCity)) {
      chainOk = false;
      out.push({
        level: 'warn',
        code: 'flight_not_closed',
        section: 'flights',
        ref: { type: 'flight', id: last.id, position: flights.length - 1 },
        uz: `Parvozlar ${first.fromCity} ga qaytmaydi (oxirgi parvoz ${last.toCity} ga tushadi)`,
        ru: `Перелёты не возвращаются в ${first.fromCity} (последний прибывает в ${last.toCity})`,
      });
    }
    if (chainOk) {
      const route = [first.fromCity, ...flights.map((f) => f.toCity)];
      const short =
        route.length > 4
          ? `${route[0]} → … → ${route[route.length - 1]}`
          : route.join(' → ');
      out.push({
        level: 'ok',
        code: 'flight_chain_ok',
        section: 'flights',
        uz: `Parvozlar: ${short}`,
        ru: `Перелёты: ${short}`,
      });
    }
  }

  // ---- Yo'lovchilar ma'lumoti to'liqmi (8-qism): kulrang izoh, bloklamaydi; «Tasdiqlash»da so'raladi ----
  const P = input.tour.passengers;
  if (P !== undefined && P < T) {
    out.push({
      level: 'info',
      code: 'passengers_incomplete',
      section: 'tour',
      expected: T,
      actual: P,
      uz: `${T} turistdan ${P} tasining ma'lumoti kiritilgan`,
      ru: `Данные внесены для ${P} из ${T} туристов`,
    });
  }

  // ---- Bagajli turistlar soni ≤ turistlar soni ----
  flights.forEach((f, i) => {
    if (f.baggagePaxCount > T) {
      out.push({
        level: 'warn',
        code: 'baggage_over_tourists',
        section: 'flights',
        ref: { type: 'flight', id: f.id, position: i },
        expected: T,
        actual: f.baggagePaxCount,
        uz: `${flightLabel(f, i).uz}: bagajli ${f.baggagePaxCount} kishi, turistlar ${T} kishi`,
        ru: `${flightLabel(f, i).ru}: с багажом ${f.baggagePaxCount} чел., туристов ${T}`,
      });
    }
  });

  // ---- Mehmonxona kechalari ----
  if (hotels.length) {
    const missing = hotels.filter(
      (h) => dayNo(h.checkIn) === null || dayNo(h.checkOut) === null,
    );
    missing.forEach((h) => {
      const i = hotels.indexOf(h);
      out.push({
        level: 'warn',
        code: 'hotel_dates_missing',
        section: 'hotels',
        ref: { type: 'hotel', id: h.id, position: i },
        uz: `${hotelLabel(h, i).uz}: kirish/chiqish sanasi kiritilmagan`,
        ru: `${hotelLabel(h, i).ru}: не указаны даты заезда/выезда`,
      });
    });

    const dated = hotels
      .filter((h) => !missing.includes(h))
      .map((h) => ({
        h,
        i: hotels.indexOf(h),
        a: dayNo(h.checkIn)!,
        b: dayNo(h.checkOut)!,
      }))
      .sort((x, y) => x.a - y.a || x.i - y.i);

    // Bo'sh kecha yoki ustma-ust tushish (sana bo'yicha ketma-ket)
    for (let k = 1; k < dated.length; k++) {
      const prev = dated[k - 1];
      const cur = dated[k];
      if (cur.a > prev.b) {
        out.push({
          level: 'warn',
          code: 'hotel_gap',
          section: 'hotels',
          ref: { type: 'hotel', id: cur.h.id, position: cur.i },
          actual: cur.a - prev.b,
          uz: `${fmtDay(prev.b)} – ${fmtDay(cur.a)}: ${cur.a - prev.b} kecha mehmonxonasiz (${hotelLabel(prev.h, prev.i).uz} va ${hotelLabel(cur.h, cur.i).uz} orasida)`,
          ru: `${fmtDay(prev.b)} – ${fmtDay(cur.a)}: ${cur.a - prev.b} ноч. без отеля (между «${hotelLabel(prev.h, prev.i).ru}» и «${hotelLabel(cur.h, cur.i).ru}»)`,
        });
      } else if (cur.a < prev.b) {
        out.push({
          level: 'warn',
          code: 'hotel_overlap',
          section: 'hotels',
          ref: { type: 'hotel', id: cur.h.id, position: cur.i },
          actual: prev.b - cur.a,
          uz: `${hotelLabel(prev.h, prev.i).uz} va ${hotelLabel(cur.h, cur.i).uz}: ${prev.b - cur.a} kecha ustma-ust tushadi`,
          ru: `«${hotelLabel(prev.h, prev.i).ru}» и «${hotelLabel(cur.h, cur.i).ru}»: пересечение ${prev.b - cur.a} ноч.`,
        });
      }
    }

    // Kechalar yig'indisi = tur kechalari (qaytish - uchish). 1 kam - tungi reys bo'lishi mumkin
    const tourNights = nightsBetween(
      input.tour.departureDate,
      input.tour.returnDate,
    );
    if (!missing.length && tourNights !== null) {
      const sum = dated.reduce((s, x) => s + (x.b - x.a), 0);
      if (sum === tourNights) {
        out.push({
          level: 'ok',
          code: 'hotel_nights_ok',
          section: 'hotels',
          expected: tourNights,
          actual: sum,
          uz: `Mehmonxonalar: ${sum} kecha = tur ${tourNights} kecha`,
          ru: `Отели: ${sum} ноч. = тур ${tourNights} ноч.`,
        });
      } else if (sum === tourNights - 1) {
        out.push({
          level: 'info',
          code: 'hotel_nights_night_flight',
          section: 'hotels',
          expected: tourNights,
          actual: sum,
          uz: `Mehmonxonalar: ${sum} kecha, tur ${tourNights} kecha — tungi reys bo'lsa, normal`,
          ru: `Отели: ${sum} ноч., тур ${tourNights} ноч. — при ночном рейсе это нормально`,
        });
      } else {
        out.push({
          level: 'warn',
          code: 'hotel_nights_mismatch',
          section: 'hotels',
          expected: tourNights,
          actual: sum,
          uz: `Mehmonxonalar: ${sum} kecha, lekin tur ${tourNights} kecha (kassadagi uchish–qaytish sanalari)`,
          ru: `Отели: ${sum} ноч., а тур ${tourNights} ноч. (даты вылета–возврата в кассе)`,
        });
      }
    }
  }

  return out;
}

/* ------------------------------ 2. kassa bilan solishtirish ------------------------------ */

function checkCompare(
  input: CheckInput,
  services: CheckService[],
): CheckIssue[] {
  const out: CheckIssue[] = [];
  const flights = [...input.flights].sort(byPos);
  const hotels = [...input.hotels].sort(byPos);
  const extras = [...input.extras].sort(byPos);
  const T = input.tour.tourists;

  const linkedTo = (
    kind: 'flight' | 'hotel' | 'extra',
    id: number,
    types: (ServiceTypeKey | null)[],
  ) =>
    services.filter(
      (s) =>
        types.includes(s.typeKey) &&
        s.links.some(
          (l) =>
            l.itemType === kind &&
            (kind === 'flight'
              ? l.flightId === id
              : kind === 'hotel'
                ? l.hotelId === id
                : l.extraId === id),
        ),
    ).length;

  // ---- Aviabilet: har yo'nalish 1 ta; bagajli va bagajsiz aralash bo'lsa - 2 ta ----
  // «Тур» / «Тур пакет» xizmati bog'langan har qatorga hisoblanadi
  flights.forEach((f, i) => {
    const mixed = f.baggagePaxCount > 0 && f.baggagePaxCount < T;
    const expected = mixed ? 2 : 1;
    const actual = linkedTo('flight', f.id, ['avia', 'tour']);
    const label = flightLabel(f, i);
    if (actual === expected) {
      out.push({
        level: 'ok',
        code: 'avia_ok',
        section: 'flights',
        ref: { type: 'flight', id: f.id, position: i },
        expected,
        actual,
        uz: `${label.uz}: ${actual} ta xizmat${mixed ? ' (bagajli + bagajsiz)' : ''}`,
        ru: `${label.ru}: ${actual} усл.${mixed ? ' (с багажом + без багажа)' : ''}`,
      });
    } else {
      const c = countText(expected, actual);
      const why = mixed
        ? {
            uz: ` — ${f.baggagePaxCount} kishi bagajli, ${T - f.baggagePaxCount} kishi bagajsiz: 2 ta tarif kerak`,
            ru: ` — ${f.baggagePaxCount} чел. с багажом, ${T - f.baggagePaxCount} без: нужно 2 тарифа`,
          }
        : { uz: '', ru: '' };
      out.push({
        level: 'warn',
        code: actual > expected ? 'avia_extra' : 'avia_missing',
        section: 'flights',
        ref: { type: 'flight', id: f.id, position: i },
        expected,
        actual,
        uz: `${label.uz}: ${c.uz}${why.uz}`,
        ru: `${label.ru}: ${c.ru}${why.ru}`,
      });
    }
  });

  // ---- Mehmonxona: 1 ta; «har nomer alohida» tasdiqlangan bo'lsa - nomerlar soni ----
  hotels.forEach((h, i) => {
    const expected = h.roomsSeparateConfirmed ? h.roomsCount : 1;
    const actual = linkedTo('hotel', h.id, ['hotel', 'tour']);
    const label = hotelLabel(h, i);
    const ref = { type: 'hotel' as const, id: h.id, position: i };
    if (actual === expected) {
      out.push({
        level: 'ok',
        code: 'hotel_ok',
        section: 'hotels',
        ref,
        expected,
        actual,
        uz: `${label.uz}: ${actual} ta xizmat`,
        ru: `${label.ru}: ${actual} усл.`,
      });
    } else if (actual > 1 && h.roomsCount > 1 && !h.roomsSeparateConfirmed) {
      out.push({
        level: 'ask',
        code: 'hotel_rooms_separate_question',
        section: 'hotels',
        ref,
        expected,
        actual,
        uz: `${label.uz}: shartnomada ${h.roomsCount} ta nomer, kassada ${actual} ta xizmat. Nomerlar alohida-alohida kiritilganmi yoki bittasi ortiqcha?`,
        ru: `${label.ru}: в договоре ${h.roomsCount} номера, в кассе ${actual} усл. Номера внесены отдельно или одна услуга лишняя?`,
      });
    } else {
      const c = countText(expected, actual);
      out.push({
        level: 'warn',
        code: actual > expected ? 'hotel_extra' : 'hotel_missing',
        section: 'hotels',
        ref,
        expected,
        actual,
        uz: `${label.uz}: ${c.uz}`,
        ru: `${label.ru}: ${c.ru}`,
      });
    }
  });

  // ---- Transfer: shahar bo'yicha ----
  // kutilgan eng ko'p = shu shahardagi mehmonxonalar + 1 (faqat kutib olish / faqat kuzatish - 1 kam);
  // kerak bo'lib 0 ta - «transfer yo'q»; ko'p - «ko'p qo'shdingiz»; kam (0 emas) - ogohlantirmaydi
  const cities = new Map<string, { name: string; hotels: CheckHotel[] }>();
  for (const h of hotels) {
    const key = norm(h.city);
    if (!cities.has(key)) cities.set(key, { name: h.city.trim(), hotels: [] });
    cities.get(key)!.hotels.push(h);
  }
  for (const { name, hotels: hs } of cities.values()) {
    const needed = hs.some((h) => h.transferType !== 'none');
    const oneWay = hs.some(
      (h) =>
        h.transferType !== 'none' &&
        (h.transferRoute === 'arrival' || h.transferRoute === 'departure'),
    );
    const expectedMax = Math.max(1, hs.length + 1 - (oneWay ? 1 : 0));
    const ids = new Set(hs.map((h) => h.id));
    // «ortiqcha» va «ko'p qo'shdingiz» uchun faqat haqiqiy «Трансфер» xizmatlari sanaladi.
    // «Тур пакет» faqat o'zi bog'langan qator uchun hisoblanadi (alohida transfer qatori yo'q):
    // shahar mehmonxonasiga bog'langan tur paket transferni qoplashi mumkin («kassada transfer yo'q»
    // chiqmaydi), lekin transfer soniga qo'shilmaydi.
    const linkedHere = (k: ServiceTypeKey) =>
      services.filter(
        (s) =>
          s.typeKey === k &&
          s.links.some(
            (l) =>
              l.itemType === 'hotel' && l.hotelId != null && ids.has(l.hotelId),
          ),
      ).length;
    const actual = linkedHere('transfer');
    const coveredByTour = linkedHere('tour') > 0;
    const ref = { type: 'city' as const, city: name };
    if (!needed) {
      if (actual > 0) {
        out.push({
          level: 'warn',
          code: 'transfer_not_in_contract',
          section: 'transfer',
          ref,
          expected: 0,
          actual,
          uz: `Transfer · ${name}: shartnomada transfer yo'q, kassada ${actual} ta`,
          ru: `Трансфер · ${name}: в договоре трансфера нет, в кассе ${actual}`,
        });
      }
      continue;
    }
    if (actual === 0 && coveredByTour) {
      out.push({
        level: 'ok',
        code: 'transfer_in_tour',
        section: 'transfer',
        ref,
        expected: expectedMax,
        actual,
        uz: `Transfer · ${name}: tur paket ichida`,
        ru: `Трансфер · ${name}: в составе тур-пакета`,
      });
    } else if (actual === 0) {
      out.push({
        level: 'warn',
        code: 'transfer_missing',
        section: 'transfer',
        ref,
        expected: expectedMax,
        actual,
        uz: `Transfer · ${name}: kassada transfer yo'q`,
        ru: `Трансфер · ${name}: в кассе нет трансфера`,
      });
    } else if (actual > expectedMax) {
      out.push({
        level: 'warn',
        code: 'transfer_too_many',
        section: 'transfer',
        ref,
        expected: expectedMax,
        actual,
        uz: `Transfer · ${name}: kassada ${actual} ta, ko'pi bilan ${expectedMax} ta bo'lishi kerak — ko'p qo'shilmadimi?`,
        ru: `Трансфер · ${name}: в кассе ${actual}, ожидается не более ${expectedMax} — не лишние?`,
      });
    } else {
      out.push({
        level: 'ok',
        code: 'transfer_ok',
        section: 'transfer',
        ref,
        expected: expectedMax,
        actual,
        uz: `Transfer · ${name}: ${actual} ta`,
        ru: `Трансфер · ${name}: ${actual}`,
      });
    }
  }

  // ---- Sug'urta va viza: «kiritilgan» - kamida 1 ta; kiritilmagan, lekin bor - ogohlantirish ----
  const countType = (k: ServiceTypeKey) =>
    services.filter((s) => s.typeKey === k).length;
  const included = (
    section: 'insurance' | 'visa',
    mode: string,
    actual: number,
  ) => {
    const name =
      section === 'insurance'
        ? { uz: "Sug'urta", ru: 'Страхование' }
        : { uz: 'Viza', ru: 'Виза' };
    if (mode === 'included') {
      out.push(
        actual > 0
          ? {
              level: 'ok',
              code: `${section}_ok`,
              section,
              expected: 1,
              actual,
              uz: `${name.uz}: shartnomada bor, kassada bor`,
              ru: `${name.ru}: в договоре есть, в кассе есть`,
            }
          : {
              level: 'warn',
              code: `${section}_missing`,
              section,
              expected: 1,
              actual,
              uz: `${name.uz}: shartnomada kiritilgan, kassada xizmat yo'q`,
              ru: `${name.ru}: в договоре включено, в кассе нет услуги`,
            },
      );
    } else if (actual > 0) {
      out.push({
        level: 'warn',
        code: `${section}_not_in_contract`,
        section,
        expected: 0,
        actual,
        uz: `${name.uz}: shartnomada kiritilmagan, kassada ${actual} ta xizmat bor`,
        ru: `${name.ru}: в договоре не включено, в кассе ${actual} усл.`,
      });
    }
  };
  included('insurance', input.insurance, countType('insurance'));
  included('visa', input.visa, countType('visa'));

  // ---- Qo'shimcha: «narxga kiritilgan» - 1 ta bog'langan xizmat; «alohida to'lanadi» - tekshirilmaydi ----
  extras.forEach((e, i) => {
    if (e.paymentMode !== 'included') return;
    const actual = services.filter((s) =>
      s.links.some((l) => l.itemType === 'extra' && l.extraId === e.id),
    ).length;
    const label = extraLabel(e, i);
    const ref = { type: 'extra' as const, id: e.id, position: i };
    if (actual === 1) {
      out.push({
        level: 'ok',
        code: 'extra_ok',
        section: 'extras',
        ref,
        expected: 1,
        actual,
        uz: `${label.uz}: bor`,
        ru: `${label.ru}: есть`,
      });
    } else {
      const c = countText(1, actual);
      out.push({
        level: 'warn',
        code: actual > 1 ? 'extra_extra' : 'extra_missing',
        section: 'extras',
        ref,
        expected: 1,
        actual,
        uz: `${label.uz}: ${c.uz}`,
        ru: `${label.ru}: ${c.ru}`,
      });
    }
  });

  // ---- Hech qatorga bog'lanmagan xizmatlar (sug'urta/viza turi bo'yicha sanaladi - ular bundan mustasno) ----
  const MUST_LINK: (ServiceTypeKey | null)[] = [
    'avia',
    'hotel',
    'transfer',
    'tour',
    'excursion',
    'other',
  ];
  for (const s of services) {
    if (!MUST_LINK.includes(s.typeKey)) continue;
    const relevant = s.links.filter((l) =>
      ['flight', 'hotel', 'extra'].includes(l.itemType),
    );
    if (relevant.length) continue;
    out.push({
      level: 'warn',
      code: s.typeKey === 'avia' ? 'avia_unlinked' : 'service_unlinked',
      section: 'services',
      ref: { type: 'cash_service', id: s.id },
      uz: `${s.label}: shartnomadagi hech qaysi qatorga bog'lanmagan`,
      ru: `${s.label}: не привязана ни к одной строке договора`,
    });
  }

  return out;
}

/* ------------------------------ umumiy ------------------------------ */

export function checkContract(input: CheckInput): CheckResult {
  const internal = checkInternal(input);
  const compare = input.services ? checkCompare(input, input.services) : null;
  const warnings = [...internal, ...(compare ?? [])].filter(
    (x) => x.level === 'warn' || x.level === 'ask',
  ).length;
  return { internal, compare, warnings };
}
