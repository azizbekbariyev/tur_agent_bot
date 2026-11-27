/**
 * Kvitansiya PDF (A4, kirill) - ReceiptModel'dan pdfkit bilan. Chop etish, PDF yuklash va Telegram uchun BITTA fayl.
 * Ko'rinish dizayn bo'yicha: «2 · Chop etiladigan kvitansiya (A4)» va «6 · Ko'p shaharli tur — A4 kvitansiya».
 * Faqat qora-oq-kulrang.
 *
 * DOIM BITTA SAHIFA (kvitansiya - dogovorning 1-sahifasi, dogovorning o'zi unga qo'shib tikiladi).
 * Sig'dirish tartibi (SIG'ISH_QADAMLARI): 1) bo'shliqlar kamayadi; 2) jadval shrifti 8,5 -> 7,5 pt;
 * 3) shartlar shrifti 8,5 -> 7,5 pt; 4) ogohlantirish va summa bloki 8,5 -> 8 pt. Bu chegaradan kichik qilinmaydi.
 * Baribir sig'masa - ReceiptTooLongError (PDF yaratilmaydi).
 */
import PDFDocument from 'pdfkit';
import { fontPath } from '../common/pdf-fonts';
import { isDrawableLogo, sniffMime } from './receipt-logo';
import type { ReceiptModel, ReceiptTable, Run } from './receipt-model';

export interface ReceiptPdfOptions {
  /** PNG / JPEG logotip (SVG pdfkit'da yo'q - bu holda faqat firma nomi) */
  logo?: Buffer | null;
  /** QR (8-bosqich): hozircha bo'sh joy */
  qr?: Buffer | null;
  /** Versiya berilgan vaqt: PDF sanasi shu bo'ladi, shuning uchun bir versiya har gal aynan bir xil fayl beradi */
  issuedAt?: string | null;
  /** Sinov va hisobot uchun: qaysi sig'dirish qadami ishlatildi */
  onLayout?: (info: FitInfo) => void;
  /** Sinov uchun: siqilmagan oqimlar (matnni ajratib tekshirish) */
  compress?: boolean;
}

export interface FitInfo {
  step: number;
  tableFont: number;
  termsFont: number;
  warningFont: number;
  fits: boolean;
}

export const TOO_LONG_MESSAGE =
  "Kvitansiya bitta sahifaga sig'madi. Qatorlarni qisqartiring (masalan, tranzit parvozlarni bitta qatorga yozing yoki qo'shimcha xizmatlarni birlashtiring).";

export class ReceiptTooLongError extends Error {
  constructor() {
    super(TOO_LONG_MESSAGE);
    this.name = 'ReceiptTooLongError';
  }
}

interface Cfg {
  tf: number; // jadval (va transfer/sug'urta/viza ramkasi) shrifti, pt
  kf: number; // shartlar shrifti
  wf: number; // ogohlantirish ramkasi va summa bloki
  bf: number; // qolgan kichik yozuvlar (tur ramkasi, imzo, shapka)
  tight: boolean; // bo'shliqlar kamaytirilgan
}

/** Sig'dirish qadamlari: avval bo'shliqlar, keyin jadval, keyin shartlar, oxirida ogohlantirish/summa (eng kami 8 pt) */
export const FIT_STEPS: Cfg[] = [
  { tf: 8.5, kf: 8.5, wf: 8.5, bf: 8.5, tight: false },
  { tf: 8.5, kf: 8.5, wf: 8.5, bf: 8.5, tight: true },
  { tf: 8, kf: 8.5, wf: 8.5, bf: 8.5, tight: true },
  { tf: 7.5, kf: 8.5, wf: 8.5, bf: 8.5, tight: true },
  { tf: 7.5, kf: 8, wf: 8.5, bf: 8.5, tight: true },
  { tf: 7.5, kf: 7.5, wf: 8.5, bf: 8.5, tight: true },
  { tf: 7.5, kf: 7.5, wf: 8, bf: 8, tight: true },
];

const PX = 0.75;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MX = 36; // 48 px
const MT = 24;
const FOOT_Y = PAGE_H - 24;
const BOTTOM = PAGE_H - 32;
const W = PAGE_W - MX * 2;

const INK = '#111111';
const GRAY = '#555555';
const BODY = '#222222';
const LINE = '#CCCCCC';
const SHADE = '#F2F2F2';

/** Ligaturalar o'chiq: PDF'dan matn nusxalanganda «fi», «fl» buzilmaydi */
const NO_LIGA = { liga: false, clig: false, dlig: false, hlig: false };
const TXT = { features: NO_LIGA } as unknown as PDFKit.Mixins.TextOptions;

type FontKind = 'r' | 'b' | 'i' | 'bi';
interface Word {
  text: string;
  font: FontKind;
  space: boolean;
}
type Lines = { words: Word[]; width: number }[];

async function renderOnce(
  m: ReceiptModel,
  opts: ReceiptPdfOptions,
  cfg: Cfg,
): Promise<{ pdf: Buffer; fits: boolean }> {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 0, bottom: 0, left: 0, right: 0 }, // joylashuvni o'zimiz boshqaramiz
    compress: opts.compress ?? true,
    info: {
      Title: `${m.numberLabel} ${m.number}`,
      Author: m.firm.name || 'KAKOS',
      CreationDate: opts.issuedAt ? new Date(opts.issuedAt) : new Date(),
      ModDate: opts.issuedAt ? new Date(opts.issuedAt) : new Date(),
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const files: Record<FontKind, string | null> = {
    // tor (Condensed) shrift: dizayndagi Inter kabi ixcham, kirill harflari bilan; topilmasa - oddiy DejaVu
    r: fontPath(false, false, true) ?? fontPath(false, false),
    b: fontPath(true, false, true) ?? fontPath(true, false),
    i: fontPath(false, true, true) ?? fontPath(false, true),
    bi: fontPath(true, true, true) ?? fontPath(true, true),
  };
  const std: Record<FontKind, string> = {
    r: 'Helvetica',
    b: 'Helvetica-Bold',
    i: 'Helvetica-Oblique',
    bi: 'Helvetica-BoldOblique',
  };
  (Object.keys(files) as FontKind[]).forEach((k) => {
    const f = files[k];
    if (f) doc.registerFont(k, f);
  });
  const useFont = (k: FontKind, size: number) =>
    doc.font(files[k] ? k : std[k]).fontSize(size);
  const widthOf = (text: string) => doc.widthOfString(text, TXT);

  // bo'shliqlar (tight - 2-qadamdan boshlab)
  const t = cfg.tight;
  const GAP = t ? 3.5 : 5;
  const CELL_PX = t ? 4.5 : 5.5;
  const CELL_PY = t ? 1.2 : 1.9; // dizaynda 3,75 pt
  const LK = t ? 1.14 : 1.22; // jadval qator koeffitsiyenti
  const TK = t ? 1.16 : 1.24; // shartlar
  const BOX_PY = t ? 2.6 : 4;
  const BOX_PX = t ? 6 : 8;

  let y = MT;

  /* ------------------------------ matn o'lchash va chizish ------------------------------ */
  const spaceW = (k: FontKind, size: number) => {
    useFont(k, size);
    return widthOf(' ');
  };

  /** Run'lar -> so'zlar -> qatorlar (so'z kengligi shu so'zning o'z shriftida o'lchanadi) */
  function wrap(
    runs: Run[],
    width: number,
    size: number,
    italic = false,
    charSpace = 0,
  ): Lines {
    const words: Word[] = [];
    let pending = false;
    for (const run of runs) {
      const font: FontKind = run.b ? (italic ? 'bi' : 'b') : italic ? 'i' : 'r';
      // faqat oddiy bo'shliqda bo'linadi (NBSP so'z ichida qoladi)
      for (const part of run.t.split(/( +)/)) {
        if (part === '') continue;
        if (/^ +$/.test(part)) pending = true;
        else {
          words.push({ text: part, font, space: pending && words.length > 0 });
          pending = false;
        }
      }
    }
    const lines: Lines = [];
    let cur: Word[] = [];
    let curW = 0;
    for (const w of words) {
      useFont(w.font, size);
      const ww = widthOf(w.text) + charSpace * Math.max(w.text.length - 1, 0);
      const sw = w.space ? spaceW(w.font, size) : 0;
      if (cur.length && curW + sw + ww > width) {
        lines.push({ words: cur, width: curW });
        cur = [{ ...w, space: false }];
        curW = ww;
      } else {
        cur.push(w);
        curW += sw + ww;
      }
    }
    if (cur.length) lines.push({ words: cur, width: curW });
    if (!lines.length) lines.push({ words: [], width: 0 });
    return lines;
  }

  /** Oddiy matn (\n bilan qatorlarga bo'lingan) */
  const wrapPlain = (
    s: string,
    width: number,
    size: number,
    bold = false,
    charSpace = 0,
  ): Lines =>
    s
      .split('\n')
      .flatMap((p) => wrap([{ t: p, b: bold }], width, size, false, charSpace));

  const lh = (size: number, k = LK) => size * k;
  const linesH = (lines: Lines, lineH: number) => lines.length * lineH;

  function drawLines(
    lines: Lines,
    x: number,
    top: number,
    width: number,
    size: number,
    lineH: number,
    color: string,
    align: 'left' | 'center' | 'right' = 'left',
    charSpace = 0,
  ) {
    let ly = top;
    for (const line of lines) {
      let cx =
        align === 'center'
          ? x + (width - line.width) / 2
          : align === 'right'
            ? x + width - line.width
            : x;
      for (const w of line.words) {
        if (w.space) cx += spaceW(w.font, size);
        useFont(w.font, size).fillColor(color);
        doc.text(w.text, cx, ly, {
          ...TXT,
          lineBreak: false,
          characterSpacing: charSpace,
        });
        cx += widthOf(w.text) + charSpace * w.text.length;
      }
      ly += lineH;
    }
    return ly;
  }

  const vline = (x: number, top: number, h: number, color: string) =>
    doc
      .moveTo(x, top)
      .lineTo(x, top + h)
      .lineWidth(0.75)
      .strokeColor(color)
      .stroke();

  /* ------------------------------ shapka ------------------------------ */
  const logo = isDrawableLogo(
    opts.logo ?? null,
    opts.logo ? sniffMime(opts.logo) : undefined,
  )
    ? opts.logo
    : null;
  {
    const top = y;
    let tx = MX;
    const logoSize = 28;
    if (logo) {
      try {
        doc.image(logo, MX, top, { fit: [logoSize, logoSize] });
        tx = MX + logoSize + 8;
      } catch {
        // buzuq rasm - faqat nom
      }
    }
    const leftW = W * 0.62 - (tx - MX);
    let ly = drawLines(
      wrapPlain(m.firm.name, leftW, 13.5, true, 0.5),
      tx,
      top,
      leftW,
      13.5,
      lh(13.5, 1.15),
      INK,
      'left',
      0.5,
    );
    const contact = [m.firm.address, m.firm.phone, m.firm.telegram]
      .filter(Boolean)
      .join(' · ');
    if (contact) {
      ly = drawLines(
        wrapPlain(contact, leftW, cfg.bf),
        tx,
        ly + 1,
        leftW,
        cfg.bf,
        lh(cfg.bf),
        GRAY,
      );
    }
    const rw = W * 0.38;
    const rx = MX + W - rw;
    let ry = drawLines(
      wrapPlain(m.numberLabel, rw, cfg.bf),
      rx,
      top,
      rw,
      cfg.bf,
      lh(cfg.bf),
      GRAY,
      'right',
    );
    ry = drawLines(
      wrapPlain(m.number, rw, 12.5, true),
      rx,
      ry + 1,
      rw,
      12.5,
      lh(12.5, 1.15),
      INK,
      'right',
    );
    y = Math.max(ly, ry, logo ? top + logoSize : top) + GAP;
    doc
      .moveTo(MX, y)
      .lineTo(MX + W, y)
      .lineWidth(1.5)
      .strokeColor(INK)
      .stroke();
    y += GAP;
  }

  /* ------------------------------ sarlavha ------------------------------ */
  y = drawLines(
    wrapPlain(m.title, W, 12.5, true, 0.25),
    MX,
    y,
    W,
    12.5,
    lh(12.5, 1.15),
    INK,
    'center',
    0.25,
  );
  y += GAP;

  /* ------------------------------ 4 katakli tur ramkasi ------------------------------ */
  {
    const weights = [1.7, 1.3, 0.85, 0.95];
    const wsum = weights.reduce((a, b) => a + b, 0);
    const padX = BOX_PX;
    const padY = BOX_PY;
    const cws = m.tourCells.map((_, i) => ((weights[i] ?? 1) / wsum) * W);
    const vSize = cfg.bf + 1;
    const cells = m.tourCells.map((c, i) => ({
      k: wrapPlain(c.k, cws[i] - padX * 2, cfg.bf),
      v: wrapPlain(c.v, cws[i] - padX * 2, vSize, true),
    }));
    const h =
      Math.max(
        ...cells.map(
          (c) => linesH(c.k, lh(cfg.bf)) + 1.5 + linesH(c.v, lh(vSize)),
        ),
      ) +
      padY * 2;
    doc.lineWidth(0.75).strokeColor(LINE).roundedRect(MX, y, W, h, 4).stroke();
    let cx = MX;
    cells.forEach((c, i) => {
      if (i > 0) vline(cx, y, h, LINE);
      const cy = drawLines(
        c.k,
        cx + padX,
        y + padY,
        cws[i] - padX * 2,
        cfg.bf,
        lh(cfg.bf),
        GRAY,
      );
      drawLines(
        c.v,
        cx + padX,
        cy + 1.5,
        cws[i] - padX * 2,
        vSize,
        lh(vSize),
        INK,
      );
      cx += cws[i];
    });
    y += h + GAP;
  }

  /* ------------------------------ jadvallar ------------------------------ */
  /** Ustun kengligi: dizayndagi px, lekin eng uzun so'z sig'adigan darajadan kam emas; 0 - qolgan joy */
  const colWidths = (table: ReceiptTable) => {
    const need = table.widths.map((_, i) => {
      let max = 0;
      for (const row of [table.head, ...table.rows]) {
        for (const word of (row[i] ?? '').split(/[ \n]+/)) {
          useFont(row === table.head ? 'b' : 'r', cfg.tf);
          max = Math.max(max, widthOf(word));
        }
      }
      return max + CELL_PX * 2 + 1;
    });
    const fixed = table.widths.map((p, i) =>
      p > 0 ? Math.max(p * PX, need[i]) : 0,
    );
    const rest = W - fixed.reduce((a, b) => a + b, 0);
    return fixed.map((f, i) => (f > 0 ? f : Math.max(rest, need[i])));
  };
  const rowLayout = (cells: string[], widths: number[], bold: boolean) => {
    const lines = cells.map((c, i) =>
      wrapPlain(c, widths[i] - CELL_PX * 2, cfg.tf, bold),
    );
    const h =
      Math.max(...lines.map((l) => linesH(l, lh(cfg.tf)))) + CELL_PY * 2;
    return { lines, h };
  };
  const drawRow = (
    layout: { lines: Lines[]; h: number },
    widths: number[],
    head: boolean,
  ) => {
    let x = MX;
    layout.lines.forEach((l, i) => {
      doc
        .lineWidth(0.75)
        .rect(x, y, widths[i], layout.h)
        .fillAndStroke(head ? SHADE : '#FFFFFF', LINE);
      drawLines(
        l,
        x + CELL_PX,
        y + CELL_PY,
        widths[i] - CELL_PX * 2,
        cfg.tf,
        lh(cfg.tf),
        INK,
      );
      x += widths[i];
    });
    y += layout.h;
  };

  for (const s of m.sections) {
    y = drawLines(
      wrapPlain(`${s.no}. ${s.title}`, W, cfg.tf, true, 0.45),
      MX,
      y,
      W,
      cfg.tf,
      lh(cfg.tf),
      INK,
      'left',
      0.45,
    );
    y += 2;
    const widths = colWidths(s.table);
    drawRow(rowLayout(s.table.head, widths, true), widths, true);
    for (const r of s.table.rows)
      drawRow(rowLayout(r, widths, false), widths, false);
    if (s.note) {
      y = drawLines(
        wrapPlain(s.note, W, cfg.tf),
        MX,
        y + 2,
        W,
        cfg.tf,
        lh(cfg.tf),
        GRAY,
      );
    }
    y += GAP;
  }

  /* ------------------------------ transfer / sug'urta / viza: bitta qatorli ramka ------------------------------ */
  {
    const weights =
      m.info.length === 3 ? [3.2, 1.35, 1.1] : m.info.map(() => 1);
    const sum = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / sum) * W);
    const padX = BOX_PX;
    const padY = BOX_PY;
    const cells = m.info.map((c, i) =>
      wrap(
        [{ t: `${c.k}:`, b: true }, { t: ` ${c.v}` }],
        widths[i] - padX * 2,
        cfg.tf,
      ),
    );
    const h = Math.max(...cells.map((l) => linesH(l, lh(cfg.tf)))) + padY * 2;
    doc.lineWidth(0.75).strokeColor(LINE).roundedRect(MX, y, W, h, 4).stroke();
    let x = MX;
    cells.forEach((l, i) => {
      if (i > 0) vline(x, y, h, LINE);
      drawLines(
        l,
        x + padX,
        y + padY,
        widths[i] - padX * 2,
        cfg.tf,
        lh(cfg.tf),
        INK,
      );
      x += widths[i];
    });
    y += h + GAP;
  }

  /* ------------------------------ summa: gorizontal ramka (5 katak) ------------------------------ */
  {
    const n = m.totals.length;
    const cw = W / n;
    const padX = BOX_PX;
    const padY = BOX_PY;
    const vSize = cfg.wf + 1;
    const cells = m.totals.map((c) => ({
      k: wrapPlain(c.k, cw - padX * 2, cfg.wf),
      v: wrapPlain(c.v, cw - padX * 2, vSize, true),
      shaded: !!c.shaded,
    }));
    const h =
      Math.max(
        ...cells.map(
          (c) => linesH(c.k, lh(cfg.wf)) + 1.5 + linesH(c.v, lh(vSize)),
        ),
      ) +
      padY * 2;
    cells.forEach((c, i) => {
      if (c.shaded)
        doc
          .rect(MX + i * cw, y, cw, h)
          .fillColor(SHADE)
          .fill();
    });
    doc.lineWidth(0.75).strokeColor(INK).roundedRect(MX, y, W, h, 4).stroke();
    cells.forEach((c, i) => {
      const x = MX + i * cw;
      if (i > 0) vline(x, y, h, LINE);
      const cy = drawLines(
        c.k,
        x + padX,
        y + padY,
        cw - padX * 2,
        cfg.wf,
        lh(cfg.wf),
        GRAY,
      );
      drawLines(c.v, x + padX, cy + 1.5, cw - padX * 2, vSize, lh(vSize), INK);
    });
    y += h + GAP;
  }

  /* ------------------------------ ogohlantirish ramkasi ------------------------------ */
  if (m.warning) {
    const padX = BOX_PX + 2;
    const padY = BOX_PY;
    const lines = wrap(m.warning, W - padX * 2, cfg.wf, true);
    const lineH = lh(cfg.wf, t ? 1.25 : 1.35);
    const h = linesH(lines, lineH) + padY * 2;
    doc.lineWidth(1.1).strokeColor(INK).roundedRect(MX, y, W, h, 4).stroke();
    drawLines(
      lines,
      MX + padX,
      y + padY,
      W - padX * 2,
      cfg.wf,
      lineH,
      INK,
      'center',
    );
    y += h + GAP;
  }

  /* ------------------------------ shartlar ------------------------------ */
  if (m.terms.length) {
    y = drawLines(
      wrap([{ t: m.termsTitle, b: true }], W, cfg.kf + 0.5),
      MX,
      y,
      W,
      cfg.kf + 0.5,
      lh(cfg.kf + 0.5),
      INK,
    );
    y += 2;
    const numW = 11;
    const termLh = lh(cfg.kf, TK);
    for (let i = 0; i < m.terms.length; i++) {
      const l = wrap(m.terms[i], W - numW, cfg.kf);
      useFont('r', cfg.kf).fillColor(BODY);
      doc.text(`${i + 1}.`, MX, y, { ...TXT, lineBreak: false });
      y = drawLines(l, MX + numW, y, W - numW, cfg.kf, termLh, BODY) + 1;
    }
    y += GAP - 1;
  }

  /* ------------------------------ imzolar: ТУРФИРМА · КЛИЕНТ · QR (shartlardan keyin oddiy oraliq) ------------------------------ */
  {
    const QR_W = 112 * PX * 0.85;
    const gap = 8;
    const boxW = (W - QR_W - gap * 2) / 2;
    const pad = BOX_PX - 1;
    const sigGap = t ? 1.5 : 2.5;
    const sizeOf = (i: number) => (i === 1 ? cfg.bf + 1 : cfg.bf);
    const sg = m.signatures;
    const mk = (texts: string[]) =>
      texts.map((s, i) =>
        wrapPlain(s || ' ', boxW - pad * 2, sizeOf(i), i === 1),
      );
    const firmLines = mk([
      sg.firm.label,
      sg.firm.name,
      sg.firm.manager,
      sg.firm.sign,
    ]);
    const clientLines = mk([
      sg.client.label,
      sg.client.name,
      sg.client.phone,
      sg.client.sign,
    ]);
    const boxH = (ls: Lines[]) =>
      ls.reduce((a, l, i) => a + linesH(l, lh(sizeOf(i))) + sigGap, 0) -
      sigGap +
      pad * 2;
    // QR katagi: kamida ~2,5 sm (chop etilganda telefon o'qiydi); QR bor-yo'qligidan qat'i nazar bir xil
    const QR_SIZE = 62; // pt ≈ 2,2 sm (oq hoshiya bilan)
    const sigH = Math.max(boxH(firmLines), boxH(clientLines), QR_SIZE + 10);
    const drawBox = (x: number, ls: Lines[]) => {
      doc
        .lineWidth(0.75)
        .strokeColor(LINE)
        .roundedRect(x, y, boxW, sigH, 4)
        .stroke();
      let by = y + pad;
      ls.forEach((l, i) => {
        by =
          drawLines(
            l,
            x + pad,
            by,
            boxW - pad * 2,
            sizeOf(i),
            lh(sizeOf(i)),
            i === 1 || i === 2 ? INK : GRAY,
          ) + sigGap;
      });
    };
    drawBox(MX, firmLines);
    drawBox(MX + boxW + gap, clientLines);
    const qx = MX + W - QR_W;
    if (opts.qr) {
      try {
        doc
          .lineWidth(0.75)
          .strokeColor(LINE)
          .roundedRect(qx, y, QR_W, sigH, 4)
          .stroke();
        const s = Math.min(QR_SIZE, QR_W - 6, sigH - 6);
        doc.image(opts.qr, qx + (QR_W - s) / 2, y + (sigH - s) / 2, {
          width: s,
          height: s,
        });
      } catch {
        // QR chizilmadi - bo'sh joy qoladi
      }
    } else {
      doc
        .lineWidth(0.75)
        .strokeColor('#999999')
        .dash(2, { space: 2 })
        .roundedRect(qx, y, QR_W, sigH, 4)
        .stroke()
        .undash();
      const cap = wrapPlain(sg.qr.caption, QR_W - 10, cfg.bf - 0.5);
      const total = lh(cfg.bf + 1) + 2 + linesH(cap, lh(cfg.bf - 0.5));
      const top = y + (sigH - total) / 2;
      drawLines(
        wrapPlain(sg.qr.title, QR_W, cfg.bf + 1, true),
        qx,
        top,
        QR_W,
        cfg.bf + 1,
        lh(cfg.bf + 1),
        GRAY,
        'center',
      );
      drawLines(
        cap,
        qx + 5,
        top + lh(cfg.bf + 1) + 2,
        QR_W - 10,
        cfg.bf - 0.5,
        lh(cfg.bf - 0.5),
        GRAY,
        'center',
      );
    }
    y += sigH;
  }

  const fits = y <= BOTTOM;

  /* ------------------------------ pastki qator: «Договор № … · v1 · 1» (1 = dogovorning 1-sahifasi) ------------------------------ */
  useFont('r', 8).fillColor(GRAY);
  doc.text(
    [`${m.numberLabel} ${m.number}`, m.version ? `v${m.version}` : '', '1']
      .filter(Boolean)
      .join(' · '),
    MX,
    FOOT_Y,
    { ...TXT, width: W, align: 'center', lineBreak: false },
  );

  doc.end();
  return { pdf: await done, fits };
}

/**
 * Kvitansiya PDF: bitta sahifaga sig'maguncha qadamlar bo'yicha siqiladi (FIT_STEPS).
 * Eng kichik o'lchamda ham sig'masa - ReceiptTooLongError.
 */
export async function renderReceiptPdf(
  m: ReceiptModel,
  opts: ReceiptPdfOptions = {},
): Promise<Buffer> {
  for (let step = 0; step < FIT_STEPS.length; step++) {
    const cfg = FIT_STEPS[step];
    const { pdf, fits } = await renderOnce(m, opts, cfg);
    if (fits) {
      opts.onLayout?.({
        step,
        tableFont: cfg.tf,
        termsFont: cfg.kf,
        warningFont: cfg.wf,
        fits: true,
      });
      return pdf;
    }
  }
  const last = FIT_STEPS[FIT_STEPS.length - 1];
  opts.onLayout?.({
    step: FIT_STEPS.length - 1,
    tableFont: last.tf,
    termsFont: last.kf,
    warningFont: last.wf,
    fits: false,
  });
  throw new ReceiptTooLongError();
}

/** Sig'adimi? (jonli ko'rinish va versiya yozishdan oldin tekshirish) */
export async function receiptFits(
  m: ReceiptModel,
  opts: ReceiptPdfOptions = {},
): Promise<boolean> {
  try {
    await renderReceiptPdf(m, opts);
    return true;
  } catch (e) {
    if (e instanceof ReceiptTooLongError) return false;
    throw e;
  }
}
