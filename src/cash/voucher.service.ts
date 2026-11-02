import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import PDFDocument from 'pdfkit';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { Cash } from '../bot/models/cash';
import { BotService } from '../bot/bot.service';
import { SettingsService, AppSettings } from '../settings/settings.service';
import { canViewAll, requireCashWriter } from '../common/roles';
import { tashkentDate } from '../common/date';
import { serviceTypeLabel } from '../common/service-types';
import { UserReq } from '../types/user.type';
import { VoucherSendDto } from './dto/cash.dto';
import {
  formatSeqNo,
  getBrutto,
  getDebt,
  getPaidAmount,
  hasContractNumber,
} from './cash.utils';

const LABELS = {
  uz: {
    title: 'Sayohat vaucheri',
    cash: 'Kassa',
    date: 'Sana',
    destination: "Yo'nalish",
    departure: 'Uchish',
    return: 'Qaytish',
    tourists: 'Turistlar soni',
    passengers: "Yo'lovchilar",
    services: 'Xizmatlar',
    payments: "To'lovlar",
    total: 'Umumiy narx',
    paid: "To'langan",
    debt: 'Qoldiq',
    paymentTypes: { CASH: 'Naqd', CARD: 'Karta', TRANSFER: "O'tkazma" },
    caption: 'Sayohatingiz hujjati',
    sum: "so'm",
    noContract: 'Dogovor berilmagan',
    months: [
      'yanvar',
      'fevral',
      'mart',
      'aprel',
      'may',
      'iyun',
      'iyul',
      'avgust',
      'sentyabr',
      'oktyabr',
      'noyabr',
      'dekabr',
    ],
  },
  ru: {
    title: 'Ваучер на поездку',
    cash: 'Касса',
    date: 'Дата',
    destination: 'Направление',
    departure: 'Вылет',
    return: 'Возвращение',
    tourists: 'Количество туристов',
    passengers: 'Пассажиры',
    services: 'Услуги',
    payments: 'Оплаты',
    total: 'Общая стоимость',
    paid: 'Оплачено',
    debt: 'Остаток',
    paymentTypes: { CASH: 'Наличные', CARD: 'Карта', TRANSFER: 'Перевод' },
    caption: 'Документ вашей поездки',
    sum: 'сум',
    noContract: 'Договор не выдан',
    months: [
      'января',
      'февраля',
      'марта',
      'апреля',
      'мая',
      'июня',
      'июля',
      'августа',
      'сентября',
      'октября',
      'ноября',
      'декабря',
    ],
  },
} as const;

/** Kirill va lotin harflari uchun TTF shrift (standart PDF shriftlarida kirill yo'q) */
function fontPath(bold = false): string | null {
  const file = bold ? 'DejaVuSans-Bold.ttf' : 'DejaVuSans.ttf';
  const candidates: string[] = [];
  if (process.env.VOUCHER_FONT_DIR) {
    candidates.push(join(process.env.VOUCHER_FONT_DIR, file));
  }
  try {
    candidates.push(
      join(
        dirname(require.resolve('dejavu-fonts-ttf/package.json')),
        'ttf',
        file,
      ),
    );
  } catch {
    // paket topilmadi - quyidagi yo'llar sinab ko'riladi
  }
  candidates.push(
    join(process.cwd(), 'node_modules/dejavu-fonts-ttf/ttf', file),
    `/usr/share/fonts/truetype/dejavu/${file}`,
  );
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** '2026-11-07' -> "7 noyabr 2026" / "7 ноября 2026" (Toshkent kuni) */
const longDate = (value: Date | string, lang: 'uz' | 'ru') => {
  const day = tashkentDate(value);
  if (!day) return '';
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${LABELS[lang].months[m - 1]} ${y}`;
};

/** Mijoz hujjatidagi kassa: dogovor raqami yoki "Dogovor berilmagan (ID 00042)" */
const contractLabel = (cash: Cash, lang: 'uz' | 'ru') =>
  hasContractNumber(cash.cash_number)
    ? `№${cash.cash_number.trim()}`
    : `${LABELS[lang].noContract} (ID ${formatSeqNo(cash.seq_no)})`;

const money = (n: number, currency = "so'm") =>
  `${Math.round(n)
    .toLocaleString('ru-RU')
    .replace(/\u00a0/g, ' ')} ${currency}`;

@Injectable()
export class VoucherService {
  private readonly logger = new Logger(VoucherService.name);

  constructor(
    @InjectRepository(Cash)
    private readonly cashRepository: Repository<Cash>,
    private readonly settingsService: SettingsService,
    private readonly botService: BotService,
  ) {}

  async send(user: UserReq, id: number, dto: VoucherSendDto) {
    requireCashWriter(user);
    const cash = await this.cashRepository.findOne({
      where: { id, isDeleted: false },
      relations: {
        user: true,
        additionalUser: true,
        brutto: true,
        moneys: true,
        passengers: { client: true },
        cashServices: { service: { serviceType: true } },
      },
    });
    const participant =
      cash?.user?.id === user.id || cash?.additionalUser?.id === user.id;
    if (!cash || (!canViewAll(user.role) && !participant)) {
      throw new NotFoundException('Kassa topilmadi');
    }

    // Mijozning chat ID si: avval asosiy (birinchi) yo'lovchi, keyin qolganlari
    const passengers = [...(cash.passengers ?? [])].sort((a, b) => a.id - b.id);
    const chatId = passengers.find((p) => p.client?.telegramChatId)?.client
      ?.telegramChatId;
    if (!chatId) {
      throw new BadRequestException(
        "Mijozning Telegram'i ulanmagan: mijoz kartasida Telegram username bo'lishi va mijoz botga /start bosgan bo'lishi kerak",
      );
    }

    const settings = await this.settingsService.get();
    const lang = dto.lang ?? settings.brand.language ?? 'uz';
    const pdf = await this.build(cash, settings, lang, {
      passengers: dto.showPassengers ?? true,
      payments: dto.showPayments ?? true,
      services: dto.showServices ?? false,
    });

    try {
      await this.botService.sendDocument(
        chatId,
        pdf,
        `voucher-${hasContractNumber(cash.cash_number) ? cash.cash_number.trim() : formatSeqNo(cash.seq_no)}.pdf`,
        `${LABELS[lang].caption} — ${contractLabel(cash, lang)}`,
      );
    } catch (error) {
      this.logger.warn(`Voucher yuborilmadi (kassa #${id}): ${String(error)}`);
      throw new BadRequestException(
        "Telegram orqali yuborib bo'lmadi: mijoz botni bloklagan bo'lishi mumkin",
      );
    }
    return { sent: true };
  }

  /** DIQQAT: netto, foyda, hamkor nomi, narxlari va kodlari hujjatga KIRMAYDI */
  private build(
    cash: Cash,
    settings: AppSettings,
    lang: 'uz' | 'ru',
    show: { passengers: boolean; payments: boolean; services: boolean },
  ): Promise<Buffer> {
    const t = LABELS[lang];
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const regular = fontPath();
    const bold = fontPath(true);
    if (regular) doc.registerFont('regular', regular);
    if (bold) doc.registerFont('bold', bold);
    const font = (b = false) =>
      doc.font(
        b
          ? bold
            ? 'bold'
            : 'Helvetica-Bold'
          : regular
            ? 'regular'
            : 'Helvetica',
      );

    const accent = settings.brand.accent || '#3CC8D8';

    // ---- Sarlavha ----
    font(true).fontSize(20).fillColor(accent).text(settings.brand.name);
    font().fontSize(12).fillColor('#555').text(t.title);
    doc.moveDown(0.8);

    const row = (label: string, value: string) => {
      font(true)
        .fontSize(10)
        .fillColor('#333')
        .text(`${label}: `, { continued: true });
      font()
        .fillColor('#000')
        .text(value || '—');
    };

    row(t.cash, contractLabel(cash, lang));
    row(t.date, longDate(cash.created_at, lang));
    row(t.destination, cash.destination);
    row(t.departure, longDate(cash.departure_date, lang));
    row(t.return, longDate(cash.return_date, lang));
    row(t.tourists, String(cash.turist_count ?? ''));

    const section = (title: string) => {
      doc.moveDown(0.8);
      font(true).fontSize(12).fillColor(accent).text(title);
      doc.moveDown(0.2);
      font().fontSize(10).fillColor('#000');
    };

    if (show.passengers && cash.passengers?.length) {
      section(t.passengers);
      [...cash.passengers]
        .sort((a, b) => a.id - b.id)
        .forEach((p, i) => {
          doc.text(
            `${i + 1}. ${p.lastName ?? ''} ${p.firstName}`
              .replace(/\s+/g, ' ')
              .trim(),
          );
        });
    }

    if (show.services && cash.cashServices?.length) {
      // Faqat xizmat turi va nomi - hamkor, narx va kod ko'rsatilmaydi
      section(t.services);
      cash.cashServices.forEach((cs, i) => {
        const type = serviceTypeLabel(
          cs.service?.serviceType?.name ?? cs.service?.name,
          lang,
        );
        doc.text(`${i + 1}. ${type}`);
      });
    }

    if (show.payments && cash.moneys?.length) {
      section(t.payments);
      [...cash.moneys]
        .sort((a, b) => a.id - b.id)
        .forEach((m, i) => {
          const type =
            t.paymentTypes[m.type as keyof typeof t.paymentTypes] ?? m.type;
          doc.text(
            `${i + 1}. ${longDate(m.created_at, lang)} — ${money(Number(m.money_received), m.currency === 'UZS' ? t.sum : m.currency)} (${type})`,
          );
        });
    }

    // ---- Jami ----
    section(' ');
    const bruttoCurrency = cash.brutto?.currency ?? 'UZS';
    const total =
      bruttoCurrency === 'UZS'
        ? money(getBrutto(cash), t.sum)
        : `${money(Number(cash.brutto?.amount ?? 0), bruttoCurrency)} (${money(getBrutto(cash), t.sum)})`;
    row(t.total, total);
    row(t.paid, money(getPaidAmount(cash), t.sum));
    row(t.debt, money(Math.max(getDebt(cash), 0), t.sum));

    // ---- Pastki qism ----
    const footer = [
      settings.brand.address,
      settings.brand.phone,
      settings.brand.telegram,
    ].filter(Boolean);
    if (footer.length) {
      doc.moveDown(2);
      font()
        .fontSize(9)
        .fillColor('#777')
        .text(footer.join('  •  '), { align: 'center' });
    }

    doc.end();
    return done;
  }
}
