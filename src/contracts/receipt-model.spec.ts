import {
  buildReceiptModel,
  formatPhone,
  maskClientName,
  maskPhone,
  parseRuns,
} from './receipt-model';
import {
  multiCitySample,
  oneCitySample,
  sixHotelsSample,
} from './receipt-samples';
import { DEFAULT_SETTINGS } from '../settings/settings.service';

const plain = (runs: { t: string }[]) => runs.map((r) => r.t).join('');

describe('Kvitansiya matni (bitta manba: PDF va jonli ko‘rinish)', () => {
  it('RU va UZ yorliqlar, bo‘lim sarlavhalari BOSH harfda', () => {
    const ru = buildReceiptModel(multiCitySample(), 'ru');
    const uz = buildReceiptModel(multiCitySample(), 'uz');
    expect(ru.title).toBe('КВИТАНЦИЯ ОБ ОПЛАТЕ ТУРИСТИЧЕСКИХ УСЛУГ');
    expect(uz.title).toBe("TURISTIK XIZMATLAR UCHUN TO'LOV KVITANSIYASI");
    expect(ru.numberLabel).toBe('Договор №');
    expect(uz.numberLabel).toBe('Dogovor №');
    expect(ru.sections.map((s) => `${s.no}. ${s.title}`)).toEqual([
      '1. АВИАПЕРЕЛЁТЫ',
      '2. ПРОЖИВАНИЕ',
      '3. ДОПОЛНИТЕЛЬНЫЕ УСЛУГИ',
    ]);
    expect(uz.sections.map((s) => s.title)).toEqual([
      'AVIAPARVOZLAR',
      'YASHASH',
      "QO'SHIMCHA XIZMATLAR",
    ]);
  });

  it('4 katakli tur ramkasi: Тур в · Даты · Туристов · Дата выдачи', () => {
    const m = buildReceiptModel(oneCitySample(), 'ru');
    expect(m.tourCells).toEqual([
      { k: 'Тур в', v: 'Вьетнам — Фукуок' },
      { k: 'Даты', v: '25.11 — 03.12.2026' },
      { k: 'Туристов', v: '2 человека' },
      { k: 'Дата выдачи', v: '24.11.2026' },
    ]);
    // yil o'tsa - ikkala sana to'liq
    const x = oneCitySample();
    x.tour = {
      ...x.tour,
      departureDate: '2026-12-28',
      returnDate: '2027-01-05',
    };
    expect(buildReceiptModel(x, 'ru').tourCells[1].v).toBe(
      '28.12.2026 — 05.01.2027',
    );
  });

  it('Toshkent kuni: 23:30 UTC = ertasi kuni', () => {
    const x = oneCitySample();
    x.issuedAt = '2026-11-24T20:30:00.000Z'; // Toshkentda 25.11 01:30
    expect(buildReceiptModel(x, 'ru').tourCells[3].v).toBe('25.11.2026');
  });

  it('qo‘shimcha xizmat yo‘q — «ДОПОЛНИТЕЛЬНЫЕ УСЛУГИ» bo‘limi umuman chiqmaydi', () => {
    const m = buildReceiptModel(oneCitySample(), 'ru');
    expect(m.sections.map((s) => s.title)).toEqual([
      'АВИАПЕРЕЛЁТЫ',
      'ПРОЖИВАНИЕ',
    ]);
  });

  it('«alohida to‘lanadi» — narxi qatorda; jamiga qo‘shilmaydi', () => {
    const m = buildReceiptModel(multiCitySample(), 'ru');
    const rows = m.sections[2].table.rows;
    expect(rows[0][4]).toBe('включено в стоимость');
    expect(rows[1][4]).toBe('оплачивается отдельно, 60\u00a0$');
    expect(m.totals[0]).toEqual({ k: 'Стоимость, USD', v: '5\u00a0200,00' });
    expect(
      buildReceiptModel(multiCitySample(), 'uz').sections[2].table.rows[1][4],
    ).toBe("alohida to'lanadi, 60\u00a0$");
  });

  it('aviaparvoz: bagaj, tranzit, «кг»', () => {
    const m = buildReceiptModel(multiCitySample(), 'ru');
    const rows = m.sections[0].table.rows;
    expect(rows[0]).toEqual([
      '1',
      'Ташкент — Куала-Лумпур',
      '10.03',
      'Uzbekistan Airways',
      '2 чел. 20 кг, 2 без багажа',
    ]);
    expect(rows[3][1]).toBe('Бали — Ташкент (транзит Куала-Лумпур)');
    const one = buildReceiptModel(oneCitySample(), 'ru').sections[0].table.rows;
    expect(one[0][4]).toBe('20+5 кг');
    // UZ da «kg» o'zgarmaydi
    expect(
      buildReceiptModel(oneCitySample(), 'uz').sections[0].table.rows[0][4],
    ).toBe('20+5 kg');
    const x = oneCitySample();
    (x.flights![0] as Record<string, unknown>).baggagePaxCount = 0;
    expect(buildReceiptModel(x, 'ru').sections[0].table.rows[0][4]).toBe(
      'без багажа',
    );
  });

  it('mehmonxona: «Отель / номер», ovqat kodi, sanalar, kechalar', () => {
    const m = buildReceiptModel(multiCitySample(), 'ru');
    expect(m.sections[1].table.head).toEqual([
      '№',
      'Город',
      'Отель / номер',
      'Пит.',
      'Даты',
      'Ночи',
    ]);
    expect(m.sections[1].table.rows[0]).toEqual([
      '1',
      'Куала-Лумпур',
      'Grand KL Hotel 4* — 2x Deluxe DBL',
      'BB',
      '10.03 — 12.03',
      '2',
    ]);
    expect(m.sections[1].table.rows[3][2]).toBe(
      'Nusa Dua Beach Hotel 5* — 2x Deluxe DBL',
    );
    const one = buildReceiptModel(oneCitySample(), 'ru').sections[1].table
      .rows[0];
    expect(one[2]).toBe('La Vita Serenity Phu Quoc 4* — Deluxe DBL');
  });

  it('transfer: bir shaharli, guruhlangan, hammasi bir xil', () => {
    const one = buildReceiptModel(oneCitySample(), 'ru').info;
    expect(one[0]).toEqual({
      k: 'Трансфер',
      v: 'групповой: аэропорт — отель — аэропорт',
    });
    expect(one[1]).toEqual({ k: 'Страхование', v: 'включено' });
    expect(one[2]).toEqual({ k: 'Виза', v: 'не включена' });
    const multi = buildReceiptModel(multiCitySample(), 'ru').info[0].v;
    expect(multi).toBe(
      'групповой\u00a0— Куала-Лумпур, Сингапур; индивидуальный\u00a0— Бали',
    );
    const x = multiCitySample();
    for (const h of x.hotels as Record<string, unknown>[])
      h.transferType = 'group';
    expect(buildReceiptModel(x, 'ru').info[0].v).toBe(
      'групповой, во всех городах',
    );
    for (const h of x.hotels as Record<string, unknown>[])
      h.transferType = 'none';
    expect(buildReceiptModel(x, 'ru').info[0].v).toBe('не включен');
    const y = multiCitySample();
    (y.hotels![1] as Record<string, unknown>).transferRoute = 'arrival';
    expect(buildReceiptModel(y, 'ru').info[0].v).toContain(
      'Сингапур (только встреча)',
    );
    // bir shaharda 2 mehmonxona - shahar bir marta
    expect(multi.match(/Бали/g)).toHaveLength(1);
  });

  it('summa bloki: 5 katak, gorizontal; oxirgisi kulrang', () => {
    const m = buildReceiptModel(multiCitySample(), 'ru');
    expect(m.totals.map((t) => [t.k, t.v])).toEqual([
      ['Стоимость, USD', '5\u00a0200,00'],
      ['Курс на 08.02', '12\u00a0650'],
      ['Итого, UZS', '65\u00a0780\u00a0000'],
      ['Оплачено, UZS', '37\u00a0000\u00a0000'],
      ['Остаток, USD', '2\u00a0275,10'],
    ]);
    expect(m.totals.map((t) => !!t.shaded)).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
    const one = buildReceiptModel(oneCitySample(), 'ru').totals;
    expect(one.map((t) => t.v)).toEqual([
      '1\u00a0400,00',
      '12\u00a0000',
      '16\u00a0800\u00a0000',
      '16\u00a0800\u00a0000',
      '0,00',
    ]);
    expect(one[1].k).toBe('Курс на 24.11');
  });

  it('narx so‘mda bo‘lsa — 3 katak', () => {
    const input = oneCitySample();
    input.price = {
      amount: 12_000_000,
      currency: 'UZS',
      rate: 1,
      totalUzs: 12_000_000,
    };
    input.payments = {
      paidUzs: 5_000_000,
      debtUzs: 7_000_000,
      currency: 'UZS',
      paidInCurrency: 5_000_000,
      debtInCurrency: 7_000_000,
    };
    const m = buildReceiptModel(input, 'uz');
    expect(m.totals.map((t) => t.k)).toEqual([
      'Narxi, UZS',
      "To'langan, UZS",
      'Qoldiq, UZS',
    ]);
    expect(m.totals[2].v).toBe('7\u00a0000\u00a0000');
  });

  it('imzolar: turfirma + mijoz (ism, telefon) + QR', () => {
    const m = buildReceiptModel(oneCitySample(), 'ru');
    expect(m.signatures.firm).toMatchObject({
      label: 'ТУРФИРМА',
      name: 'KAKOS TOUR',
    });
    expect(m.signatures.firm.manager).toMatch(/^Менеджер: _+$/);
    expect(m.signatures.firm.sign).toMatch(/^Подпись _+ М\.П\.$/);
    expect(m.signatures.client).toMatchObject({
      label: 'КЛИЕНТ',
      name: 'KHAMRAKULOV FURKATJON',
      phone: '+998 70 234 88 88',
    });
    expect(m.signatures.qr.title).toBe('QR');
    expect(m.version).toBe(1);
  });

  describe('Standart shablon (Sozlamalar seed) — firmaning haqiqiy matni', () => {
    const c = DEFAULT_SETTINGS.contract;
    it('ogohlantirish va 5 ta shart, qalin joylar saqlanadi', () => {
      const m = buildReceiptModel(oneCitySample(), 'ru');
      expect(plain(m.warning!)).toBe(
        'Оплатите 100% стоимость тура во избежание колебания курса валют! В случае оплаты тура по частям (50%, 70%) и в случае изменения курса валюты (повышение или понижение), клиент оплачивает остаток турпакета по новому курсу поставщика услуг на день оплаты.',
      );
      expect(m.warning![0]).toEqual({
        t: 'Оплатите 100% стоимость тура во избежание колебания курса валют!',
        b: true,
      });
      expect(m.termsTitle).toBe(
        'Подписывая данный документ, Вы соглашаетесь со следующими условиями:',
      );
      expect(m.terms).toHaveLength(5);
      const bold = m.terms.map((r) => r.filter((x) => x.b).map((x) => x.t));
      expect(bold[1]).toEqual([
        'В случае внесения изменений в тур',
        'Взимается 100% штраф!',
      ]);
      expect(bold[2]).toEqual([
        'Перебронирование тура',
        'Взимается 100% штраф',
      ]);
      expect(bold[3]).toEqual([
        'В случае отказа от поездки',
        'возмещает турфирме 100% оплату.',
      ]);
      expect(bold[0]).toEqual([]);
      expect(bold[4]).toEqual([]);
      expect(plain(m.terms[3])).toContain('«Невозвратному тарифу»');
      expect(plain(m.terms[4])).toContain('100% заполняемости');
    });
    it('seed da «**» belgilari bor, UZ matn bo‘sh (admin kiritadi)', () => {
      expect(c.warning.ru.startsWith('**Оплатите 100% стоимость тура')).toBe(
        true,
      );
      expect(c.terms.ru).toHaveLength(5);
      expect(c.terms.uz).toEqual([]);
      expect(c.warning.uz).toBe('');
    });
  });

  it('UZ shartlar kiritilmagan — terms bo‘sh (PDF UZ rad etiladi)', () => {
    const input = oneCitySample();
    input.texts = {
      warning: { ru: 'x', uz: '' },
      terms: { ru: ['a'], uz: [] },
    };
    const m = buildReceiptModel(input, 'uz');
    expect(m.terms).toEqual([]);
    expect(m.warning).toBeNull();
  });

  it('6 mehmonxona — 6 qator', () => {
    expect(
      buildReceiptModel(sixHotelsSample(), 'ru').sections[1].table.rows,
    ).toHaveLength(6);
  });

  it('telefon: imzo blokida formatlangan, bazadagi qiymat o‘zgarmaydi', () => {
    const x = oneCitySample();
    x.client = { name: 'KHAMRAKULOV FURKATJON', phone: '+998702348888' };
    expect(buildReceiptModel(x, 'ru').signatures.client.phone).toBe(
      '+998 70 234 88 88',
    );
    expect(x.client.phone).toBe('+998702348888');
    expect(formatPhone('998702348888')).toBe('+998 70 234 88 88');
    expect(formatPhone('702348888')).toBe('+998 70 234 88 88');
    expect(formatPhone('+7 916 123-45-67')).toBe('+7 916 123-45-67');
    expect(formatPhone('')).toBe('');
  });

  it('ochiq sahifa: yashirilgan telefon va ism', () => {
    expect(maskPhone('+998702348888')).toBe('+998 70 *** ** 88');
    expect(maskPhone('+79161234567')).toBe('*********67');
    expect(maskPhone(null)).toBeNull();
    expect(maskClientName('KHAMRAKULOV FURKATJON')).toBe('KHAMRAKULOV F.');
    expect(maskClientName('ALI')).toBe('ALI');
    expect(maskClientName('  ')).toBeNull();
  });

  it('«Курс на …» — kassa sanasi (versiya sanasi emas); bo‘lmasa faqat «Курс»', () => {
    const x = multiCitySample();
    x.issuedAt = '2027-03-20T08:00:00.000Z'; // v2 bir oydan keyin
    expect(buildReceiptModel(x, 'ru').totals[1].k).toBe('Курс на 08.02');
    x.saleDate = null;
    expect(buildReceiptModel(x, 'ru').totals[1].k).toBe('Курс');
    expect(buildReceiptModel(x, 'uz').totals[1].k).toBe('Kurs');
  });

  it('transfer: tur nomi va «—» orasida NBSP (qator boshiga «—» tushmaydi)', () => {
    const v = buildReceiptModel(multiCitySample(), 'ru').info[0].v;
    expect(v).not.toMatch(/ — /.source ? /(групповой|индивидуальный) —/ : /x/);
    expect(v).toContain('индивидуальный\u00a0— Бали');
  });

  it('parseRuns: **qalin**', () => {
    expect(parseRuns('a **b** c')).toEqual([
      { t: 'a ' },
      { t: 'b', b: true },
      { t: ' c' },
    ]);
    expect(parseRuns('**faqat qalin**')).toEqual([
      { t: 'faqat qalin', b: true },
    ]);
    expect(parseRuns('oddiy')).toEqual([{ t: 'oddiy' }]);
  });

  it('buzuq kirish — xato bermaydi', () => {
    const bad = {
      flights: 'x',
      hotels: [null, 5, { city: 7 }],
      extras: {},
      price: 'a',
      tour: { tourists: 'ko‘p' },
    } as unknown as Parameters<typeof buildReceiptModel>[0];
    expect(() => buildReceiptModel(bad, 'ru')).not.toThrow();
    expect(() => buildReceiptModel({}, 'uz')).not.toThrow();
  });
});
