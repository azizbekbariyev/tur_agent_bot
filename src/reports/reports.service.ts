import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import ExcelJS from 'exceljs';
import { Cash } from '../bot/models/cash';
import { PartnerPayment } from '../bot/models/partner_payment';
import { SettingsService } from '../settings/settings.service';
import { parseDate, tashkentDate } from '../common/date';
import { ExportQueryDto } from '../cash/dto/cash.dto';
import {
  getBonus,
  getBrutto,
  getDebt,
  getNetto,
  getPaidAmount,
  formatSeqNo,
  getProfit,
  hasContractNumber,
  isActiveStatus,
  toUZS,
} from '../cash/cash.utils';

type Column = { header: string; key: string; width?: number };

const T = {
  uz: {
    status: {
      draft: 'Qoralama',
      pending_approval: 'Tasdiqlash kutilmoqda',
      approved: 'Tasdiqlangan',
      closed: 'Yopilgan',
      cancelled: 'Bekor qilingan',
      sent_for_rework: 'Qayta ishlashga yuborilgan',
    } as Record<string, string>,
    payment: { CASH: 'Naqd', CARD: 'Karta', TRANSFER: "O'tkazma" } as Record<
      string,
      string
    >,
    opening: "Boshlang'ich holat",
    noContract: 'Dogovor berilmagan',
    h: {
      id: 'ID',
      contract: 'Dogovor №',
      date: 'Sana',
      status: 'Holat',
      owner: 'Xodim',
      additional: "Qo'shimcha xodim",
      client: 'Mijoz',
      phone: 'Telefon',
      destination: "Yo'nalish",
      departure: 'Uchish',
      return: 'Qaytish',
      tourists: 'Turistlar',
      bruttoAmount: 'Brutto',
      currency: 'Valyuta',
      brutto: "Brutto (so'm)",
      netto: "Netto (so'm)",
      profit: "Foyda (so'm)",
      paid: "To'langan (so'm)",
      debt: "Qarz (so'm)",
      partner: 'Hamkor',
      amount: 'Summa',
      rate: 'Kurs',
      uzs: "So'mda",
      type: 'Turi',
      comment: 'Izoh',
      createdBy: 'Kiritgan',
      employee: 'Xodim',
      cashCount: 'Kassalar',
      bonus: "Ulush (so'm)",
    },
  },
  ru: {
    status: {
      draft: 'Черновик',
      pending_approval: 'Ожидает подтверждения',
      approved: 'Подтверждена',
      closed: 'Закрыта',
      cancelled: 'Отменена',
      sent_for_rework: 'На доработке',
    } as Record<string, string>,
    payment: { CASH: 'Наличные', CARD: 'Карта', TRANSFER: 'Перевод' } as Record<
      string,
      string
    >,
    opening: 'Начальный остаток',
    noContract: 'Договор не выдан',
    h: {
      id: 'ID',
      contract: '№ договора',
      date: 'Дата',
      status: 'Статус',
      owner: 'Сотрудник',
      additional: 'Доп. сотрудник',
      client: 'Клиент',
      phone: 'Телефон',
      destination: 'Направление',
      departure: 'Вылет',
      return: 'Возвращение',
      tourists: 'Туристы',
      bruttoAmount: 'Брутто',
      currency: 'Валюта',
      brutto: 'Брутто (сум)',
      netto: 'Нетто (сум)',
      profit: 'Прибыль (сум)',
      paid: 'Оплачено (сум)',
      debt: 'Долг (сум)',
      partner: 'Партнёр',
      amount: 'Сумма',
      rate: 'Курс',
      uzs: 'В сумах',
      type: 'Тип',
      comment: 'Комментарий',
      createdBy: 'Внёс',
      employee: 'Сотрудник',
      cashCount: 'Кассы',
      bonus: 'Доля (сум)',
    },
  },
};

const fullName = (
  u?: { firstName?: string; lastName?: string | null } | null,
) => (u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() : '');

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Cash)
    private readonly cashRepository: Repository<Cash>,
    @InjectRepository(PartnerPayment)
    private readonly paymentRepository: Repository<PartnerPayment>,
    private readonly settingsService: SettingsService,
  ) {}

  private cashes(start: Date, end: Date) {
    return this.cashRepository
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.brutto', 'b')
      .leftJoinAndSelect('c.moneys', 'm')
      .leftJoinAndSelect('c.cashServices', 'cs')
      .leftJoinAndSelect('c.passengers', 'p')
      .leftJoinAndSelect('c.user', 'u')
      .leftJoinAndSelect('c.additionalUser', 'au')
      .where('c.is_deleted = false')
      .andWhere('c.created_at BETWEEN :start AND :end', { start, end })
      .orderBy('c.created_at', 'ASC')
      .getMany();
  }

  private client(cash: Cash) {
    const p = [...(cash.passengers ?? [])].sort((a, b) => a.id - b.id)[0];
    return {
      name: p ? `${p.lastName ?? ''} ${p.firstName}`.trim() : '',
      phone: p?.phoneNumber ?? '',
    };
  }

  private async rows(dto: ExportQueryDto, start: Date, end: Date) {
    const t = T[dto.lang ?? 'uz'];
    const h = t.h;
    const sharePercent = await this.settingsService.getSharePercent();

    if (dto.type === 'partner-payments') {
      const payments = await this.paymentRepository
        .createQueryBuilder('pp')
        .leftJoinAndSelect('pp.partner', 'partner')
        .leftJoinAndSelect('pp.createdBy', 'createdBy')
        .where('pp.is_deleted = false')
        // Boshlang'ich holat - haqiqiy to'lov emas, hisobotga kirmaydi
        .andWhere("pp.kind = 'PAYMENT'")
        .andWhere('pp.date BETWEEN :s AND :e', {
          s: tashkentDate(start),
          e: tashkentDate(end),
        })
        .orderBy('pp.date', 'ASC')
        .getMany();
      const columns: Column[] = [
        { header: h.date, key: 'date', width: 12 },
        { header: h.partner, key: 'partner', width: 28 },
        { header: h.amount, key: 'amount', width: 14 },
        { header: h.currency, key: 'currency', width: 8 },
        { header: h.rate, key: 'rate', width: 10 },
        { header: h.uzs, key: 'uzs', width: 16 },
        { header: h.type, key: 'type', width: 18 },
        { header: h.comment, key: 'comment', width: 30 },
        { header: h.createdBy, key: 'createdBy', width: 20 },
      ];
      return {
        columns,
        rows: payments.map((p) => ({
          date: String(p.date).slice(0, 10),
          partner: p.partner?.name,
          amount: p.amount,
          currency: p.currency,
          rate: p.currency_amount,
          uzs: toUZS(p.amount, p.currency, p.currency_amount),
          type:
            p.kind === 'OPENING'
              ? t.opening
              : (t.payment[p.type ?? ''] ?? p.type ?? ''),
          comment: p.comment ?? '',
          createdBy: fullName(p.createdBy),
        })),
      };
    }

    const cashes = await this.cashes(start, end);

    if (dto.type === 'employees') {
      const by = new Map<
        number,
        {
          name: string;
          cashCount: number;
          tourists: number;
          brutto: number;
          profit: number;
          bonus: number;
          debt: number;
        }
      >();
      const add = (u: Cash['user'] | null | undefined, cash: Cash) => {
        if (!u) return;
        const e = by.get(u.id) ?? {
          name: fullName(u),
          cashCount: 0,
          tourists: 0,
          brutto: 0,
          profit: 0,
          bonus: 0,
          debt: 0,
        };
        e.cashCount += 1;
        e.tourists += Number(cash.turist_count ?? 0);
        e.brutto += getBrutto(cash);
        e.profit += getProfit(cash);
        e.bonus += getBonus(cash, sharePercent);
        e.debt += Math.max(getDebt(cash), 0);
        by.set(u.id, e);
      };
      for (const cash of cashes.filter((c) => isActiveStatus(c.status))) {
        add(cash.user, cash);
        add(cash.additionalUser, cash);
      }
      return {
        columns: [
          { header: h.employee, key: 'name', width: 26 },
          { header: h.cashCount, key: 'cashCount', width: 10 },
          { header: h.tourists, key: 'tourists', width: 10 },
          { header: h.brutto, key: 'brutto', width: 16 },
          { header: h.profit, key: 'profit', width: 16 },
          { header: h.bonus, key: 'bonus', width: 16 },
          { header: h.debt, key: 'debt', width: 16 },
        ] as Column[],
        rows: [...by.values()]
          .sort((a, b) => b.profit - a.profit)
          .map((e) => ({ ...e, bonus: Math.round(e.bonus) })),
      };
    }

    const list =
      dto.type === 'debtors'
        ? cashes.filter((c) => isActiveStatus(c.status) && getDebt(c) > 0)
        : cashes;

    return {
      columns: [
        { header: h.id, key: 'seqNo', width: 8 },
        { header: h.contract, key: 'number', width: 18 },
        { header: h.date, key: 'date', width: 12 },
        { header: h.status, key: 'status', width: 18 },
        { header: h.owner, key: 'owner', width: 22 },
        { header: h.additional, key: 'additional', width: 22 },
        { header: h.client, key: 'client', width: 24 },
        { header: h.phone, key: 'phone', width: 16 },
        { header: h.destination, key: 'destination', width: 24 },
        { header: h.departure, key: 'departure', width: 12 },
        { header: h.return, key: 'return', width: 12 },
        { header: h.tourists, key: 'tourists', width: 10 },
        { header: h.bruttoAmount, key: 'bruttoAmount', width: 14 },
        { header: h.currency, key: 'bruttoCurrency', width: 8 },
        { header: h.brutto, key: 'brutto', width: 16 },
        { header: h.netto, key: 'netto', width: 16 },
        { header: h.profit, key: 'profit', width: 16 },
        { header: h.paid, key: 'paid', width: 16 },
        { header: h.debt, key: 'debt', width: 16 },
      ] as Column[],
      rows: list.map((c) => {
        const client = this.client(c);
        return {
          seqNo: formatSeqNo(c.seq_no),
          number: hasContractNumber(c.cash_number)
            ? c.cash_number.trim()
            : t.noContract,
          date: tashkentDate(c.created_at),
          status: t.status[c.status] ?? c.status,
          owner: fullName(c.user),
          additional: fullName(c.additionalUser),
          client: client.name,
          phone: client.phone,
          destination: c.destination,
          departure: tashkentDate(c.departure_date),
          return: tashkentDate(c.return_date),
          tourists: c.turist_count,
          bruttoAmount: Number(c.brutto?.amount ?? 0),
          bruttoCurrency: c.brutto?.currency ?? '',
          brutto: getBrutto(c),
          netto: getNetto(c),
          profit: getProfit(c),
          paid: getPaidAmount(c),
          debt: getDebt(c),
        };
      }),
    };
  }

  async export(dto: ExportQueryDto) {
    const start = parseDate(dto.startDate, 'startDate');
    const end = parseDate(dto.endDate, 'endDate');
    const format = dto.format ?? 'xlsx';
    const { columns, rows } = await this.rows(dto, start, end);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(dto.type);
    sheet.columns = columns;
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.addRows(rows);

    const filename = `${dto.type}-${tashkentDate(start)}_${tashkentDate(end)}.${format}`;
    if (format === 'csv') {
      const csv = Buffer.from(await workbook.csv.writeBuffer());
      // Excel UTF-8 ni to'g'ri ochishi uchun BOM
      return {
        buffer: Buffer.concat([Buffer.from('﻿'), csv]),
        filename,
        type: 'text/csv; charset=utf-8',
      };
    }
    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      filename,
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
}
