import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Ctx, InjectBot } from 'nestjs-telegraf';
import { BOT_NAME } from 'src/app.constants';
import { Context, Markup, Telegraf } from 'telegraf';
import { User } from './models/user';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { Cash } from './models/cash';
import { Between } from 'typeorm';
import { Notification } from './models/notification';
import ExcelJS from 'exceljs';
import { InputFile } from 'telegraf/types';

const COMPANY_NAME = 'ООО "KAKOS TOUR 2"';

const RU_MONTHS = [
  'ЯНВАРЬ',
  'ФЕВРАЛЬ',
  'МАРТ',
  'АПРЕЛЬ',
  'МАЙ',
  'ИЮНЬ',
  'ИЮЛЬ',
  'АВГУСТ',
  'СЕНТЯБРЬ',
  'ОКТЯБРЬ',
  'НОЯБРЬ',
  'ДЕКАБРЬ',
];

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFFF00' }, // sariq
};

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

function formatDate(d: string | Date) {
  const date = new Date(d);
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function formatMoney(n: number) {
  return Math.round(n).toLocaleString('en-US');
}

// XATOLIK TUZATILDI: bu funksiya cash.service.ts'dagi bilan bir xil mantiq -
// UZS bo'lsa aylantirish shart emas, aks holda (USD/EUR) kursga ko'paytiriladi.
// Brutto va Netto'ni solishtirish/ayirish uchun IKKALASI HAM bir xil
// valyutaga (so'mga) keltirilishi shart, aks holda natija ma'nosiz bo'ladi.
function toUZS(
  amount: number,
  currency: string | undefined,
  rate: number,
): number {
  if (currency === 'UZS') return amount;
  return amount * (rate || 0);
}

@Injectable()
export class BotService {
  constructor(
    @InjectBot(BOT_NAME) private readonly bot: Telegraf,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Cash) private readonly cashRepository: Repository<Cash>,
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    private readonly jwtService: JwtService,
  ) {}

  async start(@Ctx() ctx: Context) {
    const user = await this.userRepository.findOne({
      where: { telegram_id: ctx.from!.id },
    });
    //.\n\n${process.env.APP_URL}/?token=${token}
    if (user && user.status) {
      const token = await this.generateToken(user);
      await ctx.reply(
        `Hurmatli foydalanuvchi, xizmatlardan foydalanish uchun quyidagi tugmani bosing.\n\n${process.env.APP_URL}/?token=${token}`,
        Markup.inlineKeyboard([
          Markup.button.webApp(
            '🚀 Mini Appni ochish',
            `${process.env.APP_URL}/?token=` + token,
          ),
        ]),
      );
      return;
    } else if (ctx.from!.id == Number(process.env.ADMIN)) {
      const newUser = await this.userRepository.save({
        telegram_id: ctx.from!.id,
        username: ctx.from!.username,
        first_name: ctx.from!.first_name,
        last_name: ctx.from!.last_name,
        type: 'EMPLOYEE',
      });

      const token = await this.generateToken({
        telegram_id: ctx.from!.id,
        type: 'EMPLOYEE',
        id: newUser.id,
      });
      await ctx.reply(
        `Hurmatli admin, xizmatlardan foydalanish uchun quyidagi tugmani bosing.`,
        Markup.inlineKeyboard([
          Markup.button.webApp(
            '🚀 Mini Appni ochish',
            'https://tur-agent.test-prava.uz/?token=' + token,
          ),
        ]),
      );
      return;
    }

    await this.userRepository.save({
      telegram_id: ctx.from!.id,
      username: ctx.from!.username,
      first_name: ctx.from!.first_name,
      last_name: ctx.from!.last_name,
      type: 'ADMIN',
      status: false,
    });

    await ctx.reply('Siz hali aktiv emassiz');
  }

  async generateToken(user: { telegram_id: number; type: string; id: number }) {
    const token = await this.jwtService.signAsync(
      {
        telegram_id: user.telegram_id,
        role: user.type,
        id: user.id,
      },
      {
        secret: process.env.JWT_SECRET || 'secret',
        expiresIn: 86400,
      },
    );
    return token;
  }

  async dailyCheck() {
    const today = new Date().toISOString().slice(0, 10);

    const threeDaysLater = new Date();
    threeDaysLater.setDate(threeDaysLater.getDate() + 3);
    const end = threeDaysLater.toISOString().slice(0, 10);

    const cashes = await this.cashRepository.find({
      where: {
        departure_date: Between(today, end),
      },
      relations: {
        user: true,
        brutto: true,
        moneys: true, // YANGI: qarzni to'g'ri hisoblash uchun to'lovlar kerak
      },
    });

    if (cashes.length === 0) return;

    for (const cash of cashes) {
      // XATOLIK TUZATILDI: endi Brutto va to'langan summa IKKALASI HAM
      // so'mga o'tkazilib solishtiriladi (avval brutto o'z valyutasida,
      // netto esa so'mda edi - to'g'ridan-to'g'ri ayirish noto'g'ri natija berardi).
      const bruttoAmount = Number(cash.brutto?.amount ?? 0);
      const bruttoRate = Number(cash.brutto?.currency_amount ?? 0);
      const bruttoInUZS = toUZS(
        bruttoAmount,
        cash.brutto?.currency,
        bruttoRate,
      );

      const paidInUZS = (cash.moneys ?? []).reduce((sum, m) => {
        const amount = Number(m.money_received ?? 0);
        const rate = Number(m.currency_amount ?? 0);
        return sum + toUZS(amount, m.currency, rate);
      }, 0);

      const due = bruttoInUZS - paidInUZS;

      let message = `✈️ <b>Eslatma</b>\n\n`;
      message += `📅 Parvoz sanasi: <b>${cash.departure_date}</b>\n`;
      message += `🌍 Yo'nalish: <b>${cash.destination}</b>\n`;
      message += `💼 Kassa: <b>${cash.cash_number}</b>\n\n`;

      if (due > 0.01) {
        // XATOLIK TUZATILDI: "USD" deb yozilgan edi, endi qiymat so'mda
        message += `💰 Ushbu kassa bo'yicha <b>${formatMoney(due)} so'm</b> qarzdorlik mavjud.\n`;
        message += `Iltimos, parvozdan oldin to'lovni yakunlang.`;
      } else {
        message += `✅ Ushbu kassa bo'yicha qarzdorlik mavjud emas.\n`;
        message += `Sizning parvozingizga 3 kundan kam vaqt qoldi. Oq yo'l! ✈️`;
      }

      await this.bot.telegram.sendMessage(cash.user.telegram_id, message, {
        parse_mode: 'HTML',
      });

      await this.notificationRepository.save({
        sms: message,
        type: 'cash',
        user: { id: cash.user.id },
      });
    }
  }

  public sendMessage(user_id: number, message: string) {
    return this.bot.telegram.sendMessage(user_id, message);
  }

  public async getExcel(ctx: Context) {
    const user = await this.userRepository.findOne({
      where: { telegram_id: ctx.from!.id },
    });
    if (user?.type !== 'ADMIN') {
      await ctx.reply('Siz admin emassiz 😂');
      return;
    }
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Kassalar', {
      views: [{ state: 'frozen', ySplit: 0 }],
    });

    const cashes = await this.cashRepository.find({
      relations: {
        user: true,
        passengers: true,
        cashServices: {
          service: true,
        },
        moneys: true,
        brutto: true,
      },
      order: { departure_date: 'ASC' },
    });

    const COLS = [
      { key: 'operator', width: 26 },
      { key: 'no', width: 20 },
      { key: 'manager', width: 14 },
      { key: 'direction', width: 30 },
      { key: 'dates', width: 22 },
      { key: 'package', width: 14 },
      { key: 'total', width: 14 },
      { key: 'payToOperator', width: 36 },
      { key: 'touristInfo', width: 22 },
      { key: 'note', width: 14 },
      { key: 'profit', width: 16 },
    ];
    worksheet.columns = COLS.map((c) => ({ key: c.key, width: c.width }));

    const groups = new Map<string, Cash[]>();
    for (const cash of cashes) {
      const d = new Date(cash.departure_date);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(cash);
    }

    let rowIndex = 1;
    const lastCol = COLS.length;
    const ROWS_PER_CASH = 2;

    const MERGED_COLS = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11];
    const PAY_COL = 8;

    for (const [key, groupCashes] of groups) {
      const [year, monthIdx] = key.split('-').map(Number);

      worksheet.mergeCells(rowIndex, 1, rowIndex, lastCol - 1);
      const companyCell = worksheet.getCell(rowIndex, 1);
      companyCell.value = COMPANY_NAME;
      companyCell.font = { bold: true, size: 18 };
      companyCell.alignment = { horizontal: 'center', vertical: 'middle' };
      companyCell.fill = HEADER_FILL;
      worksheet.getRow(rowIndex).height = 35;
      rowIndex++;

      worksheet.mergeCells(rowIndex, 1, rowIndex, lastCol - 1);
      const monthCell = worksheet.getCell(rowIndex, 1);
      monthCell.value = `${RU_MONTHS[monthIdx]} ${year}`;
      monthCell.font = { bold: true, size: 20 };
      monthCell.alignment = { horizontal: 'center', vertical: 'middle' };
      monthCell.fill = HEADER_FILL;
      worksheet.getRow(rowIndex).height = 35;
      rowIndex++;

      const headerRow = worksheet.getRow(rowIndex);
      const headers = [
        'туроператор',
        '№',
        'менеджер',
        'направление',
        'дата вылета и прилета',
        'турпакет',
        'итого',
        'оплата туроператору',
        'инфо туриста',
        'примечание',
        'прибыль',
      ];
      headers.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.font = { bold: true };
        cell.fill = HEADER_FILL;
        cell.alignment = {
          horizontal: 'center',
          vertical: 'middle',
          wrapText: true,
        };
        cell.border = THIN_BORDER;
      });
      headerRow.height = 35;
      rowIndex++;

      for (const cash of groupCashes) {
        const cashServices = cash.cashServices ?? [];
        const mainPassenger = (cash.passengers ?? [])[0];

        // XATOLIK TUZATILDI: `s.name` -> `s.service.name` (nom katalogdagi
        // Service'da, CashServices'da emas).
        const operatorLines = cashServices
          .map((cs) => cs.service?.name ?? cs.service?.company_name ?? '—')
          .join('\n');

        // XATOLIK TUZATILDI: `s.currency_amount` (bu kurs, masalan 12800)
        // o'rniga `s.service_amount` (haqiqiy to'lov summasi) ishlatiladi.
        // Xizmatlar har doim USD deb hisoblanadi -> so'mga o'tkazish uchun
        // service_amount * currency_amount(kurs).
        const payLines = cashServices
          .map((cs) => {
            const name = cs.service?.name ?? cs.service?.company_name ?? '—';
            const amountUZS =
              Number(cs.service_amount) * Number(cs.currency_amount);
            return `${name}: ${formatMoney(amountUZS)}`;
          })
          .join('\n');
        const payTotal = cashServices.reduce(
          (acc, cs) =>
            acc + Number(cs.service_amount) * Number(cs.currency_amount),
          0,
        );

        // XATOLIK TUZATILDI: Brutto endi so'mga o'tkazilgan holda ishlatiladi
        // (avval o'z valyutasida edi, Netto (so'm) bilan solishtirilganda
        // noto'g'ri "foyda" chiqarardi).
        const bruttoAmount = Number(cash.brutto?.amount ?? 0);
        const bruttoRate = Number(cash.brutto?.currency_amount ?? 0);
        const brutto = toUZS(bruttoAmount, cash.brutto?.currency, bruttoRate);
        const netto = Number(cash.netto);
        const profit = brutto - netto;

        const topRowIndex = rowIndex;
        const bottomRowIndex = rowIndex + 1;
        const topRow = worksheet.getRow(topRowIndex);
        const bottomRow = worksheet.getRow(bottomRowIndex);

        topRow.getCell(1).value = operatorLines || '—';
        topRow.getCell(2).value = cash.cash_number ?? '';
        topRow.getCell(3).value = cash.user
          ? `${cash.user.first_name} ${cash.user.last_name ?? ''}`.trim()
          : '';
        topRow.getCell(4).value = cash.destination;

        topRow.getCell(4).alignment = {
          horizontal: 'center',
          vertical: 'middle',
        };
        topRow.getCell(5).value =
          `${formatDate(cash.departure_date)}\n${formatDate(cash.return_date)}`;
        topRow.getCell(6).value = formatMoney(brutto);
        topRow.getCell(7).value = formatMoney(brutto);
        topRow.getCell(9).value = mainPassenger
          ? `${mainPassenger.first_name} ${mainPassenger.last_name}\n${mainPassenger.phone_number}`
          : '—';
        topRow.getCell(10).value = cash.comment ?? '';
        topRow.getCell(11).value = formatMoney(profit);

        for (const c of MERGED_COLS) {
          worksheet.mergeCells(topRowIndex, c, bottomRowIndex, c);
        }

        topRow.getCell(PAY_COL).value = payLines || '—';
        topRow.getCell(PAY_COL).font = { underline: true };

        bottomRow.getCell(PAY_COL).value = formatMoney(payTotal);
        bottomRow.getCell(PAY_COL).font = { bold: true };

        for (const r of [topRow, bottomRow]) {
          for (let c = 1; c <= lastCol; c++) {
            const cell = r.getCell(c);
            cell.alignment = {
              horizontal: 'center',
              vertical: 'middle',
              wrapText: true,
            };
            cell.border = THIN_BORDER;
          }
        }
        topRow.getCell(1).alignment = {
          horizontal: 'left',
          vertical: 'middle',
          wrapText: true,
        };
        topRow.getCell(4).alignment = {
          horizontal: 'left',
          vertical: 'middle',
          wrapText: true,
        };
        topRow.getCell(PAY_COL).alignment = {
          horizontal: 'left',
          vertical: 'middle',
          wrapText: true,
        };
        bottomRow.getCell(PAY_COL).alignment = {
          horizontal: 'center',
          vertical: 'middle',
          wrapText: true,
        };

        for (const r of [topRow, bottomRow]) {
          const profitCell = r.getCell(11);
          profitCell.font = {
            bold: true,
            color: { argb: profit >= 0 ? 'FF166534' : 'FFB91C1C' },
          };
          profitCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: profit >= 0 ? 'FFDCFCE7' : 'FFFEE2E2' },
          };
        }

        if (cash.comment && /qarz|debt/i.test(cash.comment)) {
          topRow.getCell(10).font = { bold: true, color: { argb: 'FFDC2626' } };
        }

        const topLines = Math.max(
          operatorLines.split('\n').length,
          payLines.split('\n').length,
          2,
        );
        topRow.height = Math.max(20, topLines * 14);
        bottomRow.height = 22;

        rowIndex += ROWS_PER_CASH;
      }

      rowIndex++;
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const document: InputFile = {
      source: Buffer.from(buffer),
      filename: `cashes-${new Date().toISOString().slice(0, 10)}.xlsx`,
    };

    await ctx.replyWithDocument(document);
  }
}
