import { buildReceiptModel, ReceiptInput } from './receipt-model';
import {
  FitInfo,
  ReceiptTooLongError,
  TOO_LONG_MESSAGE,
  receiptFits,
  renderReceiptPdf,
} from './receipt-pdf';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { deflateSync } from 'zlib';
import { isDrawableLogo } from './receipt-logo';
import {
  multiCitySample,
  oneCitySample,
  sixHotelsSample,
  sizedSample,
} from './receipt-samples';

/**
 * Siqilmagan PDF'dan matn: har shriftning ToUnicode jadvali (glif -> belgi) bo'yicha TJ massivlari o'qiladi.
 * Qidiruv/nusxalash shunday ishlaydi, shuning uchun ligatura (bir glif = «fi») bu yerda ko'rinadi.
 * Faqat indexOf va chiziqli regexlar (ichma-ich kvantifikatorsiz) - katta PDF'da ham tez.
 */
export function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  // obyektlar: "N 0 obj" ... "endobj"
  const objs = new Map<string, string>();
  let pos = 0;
  for (;;) {
    const end = raw.indexOf('endobj', pos);
    if (end < 0) break;
    const chunk = raw.slice(pos, end);
    const head = /(\d+) 0 obj/.exec(chunk.slice(0, 40));
    if (head) objs.set(head[1], chunk);
    pos = end + 6;
  }
  const streamOf = (body: string) => {
    const a = body.indexOf('stream');
    const b = body.lastIndexOf('endstream');
    return a >= 0 && b > a ? body.slice(a + 6, b) : '';
  };
  const hexToStr = (h: string) =>
    (h.match(/.{4}/g) ?? [])
      .map((x) => String.fromCharCode(parseInt(x, 16)))
      .join('');
  const cmap = (text: string) => {
    const map = new Map<string, string>();
    for (const line of text.split('\n')) {
      const ch = /^<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*$/.exec(line.trim());
      if (ch) map.set(ch[1].toLowerCase().padStart(4, '0'), hexToStr(ch[2]));
      const rg =
        /^<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*$/.exec(
          line.trim(),
        );
      if (rg) {
        const [x, y, z] = [
          parseInt(rg[1], 16),
          parseInt(rg[2], 16),
          parseInt(rg[3], 16),
        ];
        for (let g = x; g <= y; g++)
          map.set(
            g.toString(16).padStart(4, '0'),
            String.fromCharCode(z + g - x),
          );
      }
      // massivli bfrange: <a> <b> [<..> <..>]
      const arr = /^<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]*)\]$/.exec(
        line.trim(),
      );
      if (arr) {
        const start = parseInt(arr[1], 16);
        (arr[3].match(/<[0-9a-fA-F]+>/g) ?? []).forEach((v, i) =>
          map.set(
            (start + i).toString(16).padStart(4, '0'),
            hexToStr(v.slice(1, -1)),
          ),
        );
      }
    }
    return map;
  };
  // shrift nomi (/F1) -> ToUnicode jadvali
  const fontMap = new Map<string, Map<string, string>>();
  for (const body of objs.values()) {
    for (const ref of body.match(/\/F\d+ \d+ 0 R/g) ?? []) {
      const [, name, id] = /\/(F\d+) (\d+) 0 R/.exec(ref)!;
      const tu = /\/ToUnicode (\d+) 0 R/.exec(objs.get(id) ?? '');
      if (tu && !fontMap.has(name))
        fontMap.set(name, cmap(streamOf(objs.get(tu[1]) ?? '')));
    }
  }
  const out: string[] = [];
  for (const body of objs.values()) {
    const st = streamOf(body);
    if (!st.includes(' Tf')) continue;
    let cur: Map<string, string> | undefined;
    for (const line of st.split('\n')) {
      const tf = /\/(F\d+) [\d.]+ Tf/.exec(line);
      if (tf) cur = fontMap.get(tf[1]);
      const tj =
        /\[([^\]]*)\]\s*TJ/.exec(line) ?? /<([0-9a-fA-F]+)>\s*Tj/.exec(line);
      if (!tj) continue;
      let txt = '';
      for (const h of tj[1].match(/<[0-9a-fA-F]+>/g) ?? [`<${tj[1]}>`]) {
        for (const g of h.slice(1, -1).match(/.{4}/g) ?? [])
          txt += cur?.get(g.toLowerCase()) ?? '?';
      }
      out.push(txt);
    }
  }
  return out.join('\n');
}

const pages = (pdf: Buffer) =>
  (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;

/** Kichik sog'lom PNG (RGBA yoki RGB). corrupt=true - zlib oqimi buzilgan */
export function makePng(
  size = 2,
  corrupt = false,
  rgb = [200, 200, 200],
): Buffer {
  const crcT: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcT[n] = c >>> 0;
  }
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(td));
    return Buffer.concat([head, td, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA - pdfkit asinxron ochadigan holat
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let r = 0; r < size; r++) {
    for (let p = 0; p < size; p++) {
      const o = r * (1 + size * 4) + 1 + p * 4;
      // yumaloq «logotip»: markazda to'q doira
      const d = Math.hypot(p - size / 2, r - size / 2);
      const inside = d < size * 0.42;
      raw.set(inside ? [30, 30, 30, 255] : [...rgb, 0], o);
    }
  }
  let idat = deflateSync(raw);
  if (corrupt) idat = Buffer.concat([idat.subarray(0, 6), Buffer.from('xx')]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Sig'adigan eng katta mehmonxona soni (ikkilik qidiruv: 1..40) */
async function maxHotels(f: number, e: number) {
  let lo = 0;
  let hi = 40;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (await receiptFits(buildReceiptModel(sizedSample(f, mid, e), 'ru')))
      lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

describe('Kvitansiya PDF: DOIM BITTA SAHIFA (dizayn 2 va 6)', () => {
  const out = process.env.PDF_SAMPLES_DIR;
  const report: string[] = [];
  const save = (name: string, pdf: Buffer) => {
    if (!out) return;
    if (!existsSync(out)) mkdirSync(out, { recursive: true });
    writeFileSync(join(out, name), pdf);
  };
  const logo = makePng(64);

  const cases: [string, () => ReceiptInput, 'ru' | 'uz', boolean][] = [
    ['v3-1-bir-shahar-ru', oneCitySample, 'ru', false],
    ['v3-2-kop-shahar-4+4+2-ru', multiCitySample, 'ru', false],
    ['v3-2-kop-shahar-4+4+2-uz', multiCitySample, 'uz', false],
    [
      'v3-3-olti-mehmonxona-4-parvoz-2-qoshimcha-ru',
      sixHotelsSample,
      'ru',
      false,
    ],
    ['v3-6-logotip-bilan-kop-shahar-ru', multiCitySample, 'ru', true],
  ];

  it.each(cases)('%s — bitta sahifa', async (name, sample, lang, withLogo) => {
    let info: FitInfo | undefined;
    const pdf = await renderReceiptPdf(buildReceiptModel(sample(), lang), {
      logo: withLogo ? logo : null,
      issuedAt: '2026-11-24T07:30:00.000Z',
      onLayout: (i) => (info = i),
    });
    save(`${name}.pdf`, pdf);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pages(pdf)).toBe(1);
    report.push(
      `${name}: qadam ${info!.step + 1}, jadval ${info!.tableFont} pt, shartlar ${info!.termsFont} pt, ogohlantirish/summa ${info!.warningFont} pt`,
    );
  });

  it('sig‘im: qaysi chegaragacha sig‘adi (hisobot uchun)', async () => {
    const lines: string[] = [];
    const fitsAt = async (f: number, h: number, e: number) => {
      let info: FitInfo | undefined;
      const ok = await receiptFits(
        buildReceiptModel(sizedSample(f, h, e), 'ru'),
        {
          onLayout: (i) => (info = i),
        },
      );
      return { ok, info: info! };
    };
    for (const [f, e] of [
      [4, 2],
      [6, 3],
      [8, 4],
    ] as const) {
      const h = await maxHotels(f, e);
      const last = await fitsAt(f, h, e);
      lines.push(
        `${f} parvoz + ${e} qo'shimcha: ko'pi bilan ${h} mehmonxona (shu holatda: jadval ${last.info.tableFont} pt, shartlar ${last.info.termsFont} pt, ogohlantirish/summa ${last.info.warningFont} pt)`,
      );
    }
    for (const l of lines) report.push(l);
    expect(lines).toHaveLength(3);
    // 4 parvoz + 6 mehmonxona + 2 qo'shimcha albatta sig'adi
    expect((await fitsAt(4, 6, 2)).ok).toBe(true);
  });

  it('chegara namunasi (sig‘adigan eng katta holat) va sig‘maydigan holat', async () => {
    const h = await maxHotels(6, 3);
    const edge = sizedSample(6, h, 3);
    let info: FitInfo | undefined;
    const pdf = await renderReceiptPdf(buildReceiptModel(edge, 'ru'), {
      onLayout: (i) => (info = i),
    });
    save(`v3-4-chegara-${h}-mehmonxona-6-parvoz-3-qoshimcha-ru.pdf`, pdf);
    expect(pages(pdf)).toBe(1);
    report.push(
      `chegara: 6 parvoz + ${h} mehmonxona + 3 qo'shimcha: jadval ${info!.tableFont} pt, shartlar ${info!.termsFont} pt, ogohlantirish/summa ${info!.warningFont} pt`,
    );
    // bir mehmonxona ortiq - sig'maydi: PDF yaratilmaydi, xabar
    const tooBig = buildReceiptModel(sizedSample(6, h + 1, 3), 'ru');
    await expect(renderReceiptPdf(tooBig)).rejects.toThrow(ReceiptTooLongError);
    await expect(renderReceiptPdf(tooBig)).rejects.toThrow(
      "Kvitansiya bitta sahifaga sig'madi. Qatorlarni qisqartiring (masalan, tranzit parvozlarni bitta qatorga yozing yoki qo'shimcha xizmatlarni birlashtiring).",
    );
    if (out) {
      writeFileSync(
        join(out, `v3-5-sigmaydi-${h + 1}-mehmonxona-xabar.txt`),
        `${TOO_LONG_MESSAGE}\n\n(6 parvoz + ${h + 1} mehmonxona + 3 qo'shimcha: eng kichik o'lchamda ham sig'maydi — PDF yaratilmaydi, xodimga shu xabar chiqadi)\n`,
      );
    }
  });

  it('pastki qator: «Договор № … · v1 · 1»; «1/1», «продолжение» yo‘q', async () => {
    const m = buildReceiptModel(oneCitySample(), 'ru');
    const pdf = await renderReceiptPdf(m, {
      compress: false,
      issuedAt: '2026-11-24T07:30:00.000Z',
    });
    const text = pdfText(pdf);
    expect(text).toContain('Договор № A000012 · v1 · 1');
    expect(text).not.toContain('1/1');
    expect(text.toLowerCase()).not.toContain('продолжение');
    const uz = pdfText(
      await renderReceiptPdf(buildReceiptModel(oneCitySample(), 'uz'), {
        compress: false,
      }),
    );
    expect(uz).toContain('Dogovor № A000012 · v1 · 1');
  });

  it('ligatura yo‘q: «turfirma», «muvofiq», «fi» nusxalanganda buzilmaydi', async () => {
    const pdf = await renderReceiptPdf(
      buildReceiptModel(multiCitySample(), 'uz'),
      { compress: false },
    );
    const text = pdfText(pdf);
    expect(text).toContain('turfirma');
    expect(text).toContain('muvofiq');
    expect(text).not.toContain('turfrma');
    expect(text).not.toContain('muvofq');
    // ToUnicode jadvalida bir glifga ikki belgi (ligatura) yo'q
    const cmaps =
      pdf.toString('latin1').match(/beginbfchar[\s\S]*?endbfchar/g) ?? [];
    const multi =
      cmaps.join('\n').match(/<[0-9a-fA-F]{4}>\s*<[0-9a-fA-F]{8,}>/g) ?? [];
    expect(multi).toEqual([]);
  });

  it('summa va valyuta orasida NBSP: «150 $» bo‘linmaydi', async () => {
    const m = buildReceiptModel(sixHotelsSample(), 'ru');
    expect(m.sections[2].table.rows[1][4]).toBe(
      'оплачивается отдельно, 150\u00a0$',
    );
    const pdf = await renderReceiptPdf(m, { compress: false });
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('bir versiya — har gal aynan bir xil fayl', async () => {
    const m = buildReceiptModel(multiCitySample(), 'uz');
    const o = { issuedAt: '2026-11-25T10:00:00.000Z' };
    const [a, b] = [await renderReceiptPdf(m, o), await renderReceiptPdf(m, o)];
    expect(a.equals(b)).toBe(true);
  });

  afterAll(() => {
    if (out)
      writeFileSync(join(out, 'v3-hisobot.txt'), report.join('\n') + '\n');
  });
});

describe('Logotip xavfsizligi', () => {
  it("sog'lom PNG — chiziladi", async () => {
    const png = makePng(16);
    expect(isDrawableLogo(png, 'image/png')).toBe(true);
    const pdf = await renderReceiptPdf(
      buildReceiptModel(oneCitySample(), 'ru'),
      { logo: png },
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
  it("buzuq PNG, SVG, bo'sh va katta fayl — rad etiladi (server yiqilmasligi uchun)", async () => {
    expect(isDrawableLogo(makePng(16, true), 'image/png')).toBe(false);
    expect(isDrawableLogo(Buffer.from('<svg/>'), 'image/svg+xml')).toBe(false);
    expect(isDrawableLogo(Buffer.alloc(0), 'image/png')).toBe(false);
    expect(isDrawableLogo(Buffer.from('nechta bayt'), 'image/jpeg')).toBe(
      false,
    );
    expect(isDrawableLogo(Buffer.alloc(2 * 1024 * 1024), 'image/png')).toBe(
      false,
    );
    // buzuq logotip renderer'ga to'g'ridan-to'g'ri berilsa ham jarayon yiqilmaydi
    const pdf = await renderReceiptPdf(
      buildReceiptModel(oneCitySample(), 'ru'),
      {
        logo: makePng(16, true),
      },
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
