import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { Cash } from '../bot/models/cash';
import { CashService } from '../cash/cash.service';
import { PartnersService } from '../partners/partners.service';
import {
  ACTIVE_STATUS_SQL,
  BRUTTO_UZS_SQL,
  PROFIT_SQL,
} from '../cash/cash.utils';
import { previousPeriod } from '../common/date';
import { UserReq } from '../types/user.type';

/**
 * Superadmin paneli uchun filial statistikasi (login serveri so'raydi, 5.1).
 *
 * Asosiy qoida: raqamlar filial dashboardi bilan AYNAN BIR XIL bo'lishi kerak - shuning uchun
 * getDashboard / getDashboardCharts (CashService) "hammasini ko'radigan" rol bilan chaqiriladi.
 * Javobda mijozlarning ismi, telefoni, pasporti YO'Q (faqat raqamlar, yo'nalish va xodim nomi).
 */

// Hamma kassani ko'radigan ichki "foydalanuvchi" (applyScope cheklamaydi). Hech qayerga yozilmaydi.
const SYSTEM_VIEWER: UserReq = { id: 0, role: 'SUPERADMIN', telegram_id: 0 };

// "Hozirgi holat" ko'rsatkichlari uchun butun davr
const ALL_TIME = {
  startDate: '2000-01-01T00:00:00.000Z',
  endDate: '2100-01-01T00:00:00.000Z',
};

const MAX_RANGE_DAYS = 366;
const LOW_PROFIT_LIMIT = 50;

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round = (n: number) => Math.round(n);

type LowProfitRow = {
  id: string;
  seqNo: string;
  destination: string | null;
  createdAt: Date;
  userId: string | null;
  accountId: string | null;
  employee: string | null;
  brutto: string;
  profit: string;
};

export type StatsQuery = {
  start?: string;
  end?: string;
  lowProfitPct?: string;
};

@Injectable()
export class InternalStatsService {
  constructor(
    private readonly cashService: CashService,
    private readonly partnersService: PartnersService,
    private readonly configService: ConfigService,
    @InjectRepository(Cash)
    private readonly cashRepository: Repository<Cash>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  private parse(q: StatsQuery) {
    const start = new Date(String(q.start ?? ''));
    const end = new Date(String(q.end ?? ''));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('start va end (ISO) kerak');
    }
    if (end < start) throw new BadRequestException("end start'dan oldin");
    if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * 86_400_000) {
      throw new BadRequestException(`Davr ${MAX_RANGE_DAYS} kundan oshmasin`);
    }
    const pct = q.lowProfitPct === undefined ? 3 : Number(q.lowProfitPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      throw new BadRequestException("lowProfitPct 0..100 bo'lsin");
    }
    return { start, end, lowProfitPct: pct };
  }

  /** Filial dashboardidagi ko'rsatkichlar (o'sha funksiya) */
  private async totals(start: Date, end: Date) {
    const d = await this.cashService.getDashboard(SYSTEM_VIEWER, {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });
    const brutto = num(d.totalBrutto);
    const profit = num(d.grossProfit);
    return {
      brutto: round(brutto),
      netto: round(num(d.totalNetto)),
      profit: round(profit),
      profitPct: brutto > 0 ? Math.round((profit / brutto) * 1000) / 10 : 0,
      employeeShare: round(num(d.employeeShare)),
      netProfit: round(num(d.netProfit)),
      soldTours: num(d.soldTours),
      touristCount: num(d.touristCount),
      openedCashes: num(d.openedCashes),
      cancelledCashes: num(d.cancelledCashes),
    };
  }

  /**
   * Kassa qoldiqlari (Q6): mijozdan tushgan - hamkorlarga to'langan, to'lov turi x valyuta,
   * hozirgi holat. Tushum: o'chirilmagan va bekor qilinmagan kassalardagi to'lovlar
   * (hamkor balansidagi qoida bilan bir xil). Chiqim: hamkorga haqiqiy to'lovlar (PAYMENT;
   * "boshlang'ich holat" kirmaydi). So'mdagi qiymat har yozuvning o'z kursi bilan (TZ 11).
   */
  private async cashBalances() {
    const rows = await this.dataSource.query<
      {
        type: string;
        currency: string;
        inAmt: string;
        outAmt: string;
        inUzs: string;
        outUzs: string;
      }[]
    >(
      `SELECT COALESCE(type, 'UNKNOWN') AS type, currency,
              SUM(in_amt) AS "inAmt", SUM(out_amt) AS "outAmt",
              SUM(in_uzs) AS "inUzs", SUM(out_uzs) AS "outUzs"
       FROM (
         SELECT m.type::text AS type, m.currency::text AS currency, m.money_received AS in_amt, 0 AS out_amt,
                CASE WHEN m.currency = 'UZS' THEN m.money_received ELSE m.money_received * m.currency_amount END AS in_uzs,
                0 AS out_uzs
         FROM money m
         JOIN cash c ON c.id = m.cash_id AND c.is_deleted = false AND c.status <> 'cancelled'
         UNION ALL
         SELECT pp.type::text, pp.currency::text, 0, pp.amount, 0,
                CASE WHEN pp.currency = 'UZS' THEN pp.amount ELSE pp.amount * pp.currency_amount END
         FROM partner_payment pp
         WHERE pp.is_deleted = false AND pp.kind = 'PAYMENT'
       ) t
       GROUP BY 1, 2
       ORDER BY 1, 2`,
    );
    return rows.map((r) => ({
      type: r.type, // CASH | CARD | TRANSFER | UNKNOWN
      currency: r.currency, // UZS | USD | EUR
      in: Math.round(num(r.inAmt) * 100) / 100,
      out: Math.round(num(r.outAmt) * 100) / 100,
      balance: Math.round((num(r.inAmt) - num(r.outAmt)) * 100) / 100,
      balanceUzs: round(num(r.inUzs) - num(r.outUzs)),
    }));
  }

  /** Foyda foizi chegaradan past kassalar (davr ichida) - mijoz ma'lumotisiz */
  private async lowProfit(start: Date, end: Date, pct: number) {
    const rows = await this.cashRepository
      .createQueryBuilder('c')
      .leftJoin('c.brutto', 'b')
      .leftJoin('c.user', 'u')
      .select('c.id', 'id')
      .addSelect('c.seq_no', 'seqNo')
      .addSelect('c.destination', 'destination')
      .addSelect('c.created_at', 'createdAt')
      .addSelect('u.id', 'userId')
      .addSelect('u.account_id', 'accountId')
      .addSelect(
        "CONCAT(u.first_name, ' ', COALESCE(u.last_name, ''))",
        'employee',
      )
      .addSelect(BRUTTO_UZS_SQL, 'brutto')
      .addSelect(PROFIT_SQL, 'profit')
      .where('c.is_deleted = false')
      .andWhere(ACTIVE_STATUS_SQL)
      .andWhere('c.created_at BETWEEN :start AND :end', { start, end })
      .andWhere(`${BRUTTO_UZS_SQL} > 0`)
      .andWhere(`${PROFIT_SQL} < :ratio * ${BRUTTO_UZS_SQL}`, {
        ratio: pct / 100,
      })
      .orderBy(`${PROFIT_SQL} / NULLIF(${BRUTTO_UZS_SQL}, 0)`, 'ASC')
      .limit(LOW_PROFIT_LIMIT)
      .getRawMany<LowProfitRow>();
    return rows.map((r) => {
      const brutto = num(r.brutto);
      const profit = num(r.profit);
      return {
        id: num(r.id),
        seqNo: num(r.seqNo),
        destination: r.destination ?? '',
        createdAt: r.createdAt,
        userId: r.userId === null ? null : num(r.userId),
        accountId: r.accountId ?? null,
        employee: (r.employee ?? '').trim(),
        brutto: round(brutto),
        profit: round(profit),
        profitPct: brutto > 0 ? Math.round((profit / brutto) * 1000) / 10 : 0,
      };
    });
  }

  /**
   * "Hozir tizimda": faol (bekor qilinmagan, muddati o'tmagan) sessiyasi yaqinda ishlatilgan xodimlar.
   * last_used_at token yangilanganda yoziladi - oyna = kirish tokeni muddati + 5 daqiqa.
   */
  private async online() {
    const tokenMs = Number(this.configService.get('ACCESS_TOKEN_TIME'));
    const windowMs =
      (Number.isFinite(tokenMs) && tokenMs > 0 ? tokenMs : 15 * 60_000) +
      5 * 60_000;
    const since = new Date(Date.now() - windowMs);
    const rows = await this.dataSource.query<
      {
        userId: number;
        accountId: string | null;
        firstName: string;
        lastName: string | null;
        role: string;
        lastUsedAt: Date;
      }[]
    >(
      `SELECT u.id AS "userId", u.account_id AS "accountId", u.first_name AS "firstName",
              u.last_name AS "lastName", u.type::text AS role, MAX(s.last_used_at) AS "lastUsedAt"
       FROM user_session s JOIN "user" u ON u.id = s.user_id
       WHERE s.revoked_at IS NULL AND s.expires_at > now() AND s.last_used_at >= $1
         AND u.is_deleted = false AND u.status = true
       GROUP BY u.id
       ORDER BY MAX(s.last_used_at) DESC`,
      [since],
    );
    return {
      windowMinutes: Math.round(windowMs / 60_000),
      users: rows.map((r) => ({
        userId: num(r.userId),
        accountId: r.accountId,
        name: [r.firstName, r.lastName].filter(Boolean).join(' '),
        role: r.role,
        lastUsedAt: r.lastUsedAt,
      })),
    };
  }

  /** Jami faol xodimlar (o'chirilmagan, bloklanmagan) - "Hozir tizimda / jami" uchun */
  private async staff() {
    const rows = await this.dataSource.query<{ accountId: string | null }[]>(
      `SELECT account_id AS "accountId" FROM "user" WHERE is_deleted = false AND status = true`,
    );
    return {
      total: rows.length,
      accountIds: rows.map((r) => r.accountId).filter((x): x is string => !!x),
      unlinked: rows.filter((r) => !r.accountId).length,
    };
  }

  async stats(q: StatsQuery) {
    const { start, end, lowProfitPct } = this.parse(q);
    const { prevStart, prevEnd } = previousPeriod(start, end);
    const dto = { startDate: start.toISOString(), endDate: end.toISOString() };

    const [
      current,
      previous,
      charts,
      allTime,
      partner,
      cashBalances,
      lowProfit,
      online,
      staff,
    ] = await Promise.all([
      this.totals(start, end),
      this.totals(prevStart, prevEnd),
      this.cashService.getDashboardCharts(SYSTEM_VIEWER, dto, {
        limit: null,
        withAccountId: true,
      }),
      this.cashService.getDashboard(SYSTEM_VIEWER, ALL_TIME),
      this.partnersService.balance({}),
      this.cashBalances(),
      this.lowProfit(start, end, lowProfitPct),
      this.online(),
      this.staff(),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      period: { start: dto.startDate, end: dto.endDate },
      prevPeriod: {
        start: prevStart.toISOString(),
        end: prevEnd.toISOString(),
      },
      current,
      previous,
      // Hozirgi holat (davrga bog'liq emas, Q7)
      clientDebt: {
        sum: round(num(allTime.debtorSum)),
        cashes: num(allTime.debtorCashes),
      },
      // Hamkorlarga qarz: faqat musbat qoldiqlar yig'indisi (ayirma qilinmaydi).
      // Ortiqcha to'langanlar alohida: "Avans (ortiqcha to'langan)".
      partnerDebt: round(
        partner.items.reduce((a, i) => a + Math.max(num(i.remaining), 0), 0),
      ),
      partnerAdvance: round(
        partner.items.reduce((a, i) => a + Math.max(-num(i.remaining), 0), 0),
      ),
      cashBalances,
      daily: charts.daily,
      destinations: charts.destinations,
      employees: charts.employees,
      lowProfit: { thresholdPct: lowProfitPct, items: lowProfit },
      online,
      staff,
    };
  }
}
