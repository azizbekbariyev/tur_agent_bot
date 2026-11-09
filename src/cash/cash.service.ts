import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import {
  DataSource,
  EntityManager,
  In,
  Not,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { scheduledJobsEnabled } from '../common/flags';
import * as bcrypt from 'bcrypt';
import { Cash } from 'src/bot/models/cash';
import { Service } from 'src/bot/models/service';
import { CashServices } from 'src/bot/models/cash_services';
import { Passenger } from 'src/bot/models/passenger';
import { Money } from 'src/bot/models/money';
import { History } from 'src/bot/models/history';
import { User } from 'src/bot/models/user';
import { UserReq } from 'src/types/user.type';
import { ServiceType } from '../bot/models/service_type';
import { Brutto } from '../bot/models/brutto';
import { CashStatusHistory } from '../bot/models/cash_status_history';
import { UserSession } from '../bot/models/user_session';
import { revokeUserSessions } from '../auth/sessions';
import { isValidUsername, normalizeUsername } from '../common/username';
import { CashNotificationService } from './cash-notification.service';
import { SettingsService } from '../settings/settings.service';
import { linkPassengersToClients } from '../clients/client-link';
import { findOrCreatePartner } from '../partners/partners.service';
import {
  canManageRole,
  canViewAll,
  isAdmin,
  requireAdmin,
  requireCashWriter,
  requireManager,
} from '../common/roles';
import {
  parseDate,
  previousPeriod,
  sqlTashkent,
  tashkentDate,
  daysBetween,
  tashkentMidnight,
} from '../common/date';
import { escapeLike } from '../common/text';
import { LoginServerClient } from '../auth/login-server.client';
import {
  CashFilterDto,
  CashListQueryDto,
  CashStatus,
  ChangePasswordDto,
  CheckNumberQueryDto,
  CreateCashDto,
  CreatePaymantDto,
  CreateServiceCompanyDto,
  CreateServiceTypeDto,
  CreateUserDto,
  DashboardFilterDto,
  OptionalDateRangeDto,
  UpdateCashDto,
  UpdateCashEmployeeBonusDto,
  UpdateCashStatusDto,
  UpdateUserDto,
  UserStatus,
} from './dto/cash.dto';
import {
  ACTIVE_STATUS_SQL,
  BRUTTO_UZS_SQL,
  DEBT_SQL,
  DEBT_THRESHOLD,
  PROFIT_SQL,
  getBonus,
  getBrutto,
  getDebt,
  getNetto,
  getPaidAmount,
  getProfit,
  isActiveStatus,
  rateOf,
  cashLabel,
  formatSeqNo,
  hasContractNumber,
  roundToNearestThousand,
  toUZS,
} from './cash.utils';

type TransitionRole = 'ADMIN' | 'EMPLOYEE';

// Frontend (src/hooks/cashTransitions.ts) bilan bir xil bo'lishi shart
const TRANSITIONS: Record<
  CashStatus,
  Partial<Record<CashStatus, TransitionRole[]>>
> = {
  // Bekor qilish - faqat rahbar (xodimda bu tugma umuman yo'q, backend 403)
  draft: {
    pending_approval: ['EMPLOYEE', 'ADMIN'],
    cancelled: ['ADMIN'],
  },
  pending_approval: {
    approved: ['ADMIN'],
    sent_for_rework: ['ADMIN'],
    cancelled: ['ADMIN'],
  },
  approved: {
    closed: ['ADMIN'],
    cancelled: ['ADMIN'],
  },
  sent_for_rework: {
    pending_approval: ['EMPLOYEE', 'ADMIN'],
    cancelled: ['ADMIN'],
  },
  closed: {
    approved: ['ADMIN'], // qayta ochish
  },
  due: {},
  cancelled: {},
};

/** SUPERADMIN o'tishlarda ADMIN kabi; ACCOUNTANT holat o'zgartirmaydi */
function canTransition(from: string, to: string, role: string) {
  const r: TransitionRole | null = isAdmin(role)
    ? 'ADMIN'
    : role === 'EMPLOYEE'
      ? 'EMPLOYEE'
      : null;
  if (!r) return false;
  return !!TRANSITIONS[from as CashStatus]?.[to as CashStatus]?.includes(r);
}

/**
 * Xodim tasdiqlangan/yopilgan kassani tahrirlasa yoki unga to'lov qo'shsa,
 * kassa "Kutilmoqda" ga qaytadi - rahbar qayta tekshirib tasdiqlaydi.
 */
const REVIEW_AGAIN_STATUSES: string[] = ['approved', 'closed'];
const needsReviewAgain = (user: UserReq, status: string) =>
  user.role === 'EMPLOYEE' && REVIEW_AGAIN_STATUSES.includes(status);

/**
 * O'tish umuman mavjud, lekin bu rol uchun emas (masalan, xodim bekor qilmoqchi) - 403;
 * bunday o'tish yo'q - 400.
 */
function assertTransition(from: string, to: string, role: string) {
  if (canTransition(from, to, role)) return;
  if (TRANSITIONS[from as CashStatus]?.[to as CashStatus]) {
    throw new ForbiddenException('Ruxsat yo‘q');
  }
  throw new BadRequestException(`${from} -> ${to} o'tishga ruxsat yo'q`);
}

/** status-counts javobidagi kalitlar ('due' - holat emas, qarzdorlik filtri) */
const COUNT_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'due',
  'closed',
  'cancelled',
  'sent_for_rework',
];

const CASH_RELATIONS = {
  cashServices: { service: { serviceType: true } },
  passengers: true,
  moneys: true,
  user: true,
  additionalUser: true,
  brutto: true,
} as const;

const publicUser = (u?: User | null) =>
  u ? { id: u.id, firstName: u.firstName, lastName: u.lastName ?? null } : null;

const withRole = (u: User) => ({ ...u, role: u.type });

const num = (v: unknown) => Number(v ?? 0);

/** 'YYYY-MM-DD' + n kun */
const addDay = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Kassa sanasi: 'YYYY-MM-DD' kelsa - Toshkent yarim tuni, aks holda ISO lahza */
const parseCashDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
    ? tashkentMidnight(value.trim())
    : new Date(value);

/** Kassa sanasi bugundan (Toshkent) keyin bo'lmasin - aks holda panel ro'yxatlari va hisobotlarda ko'rinmay qoladi */
function assertNotFutureCashDate(date: Date) {
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('Kassa sanasi noto‘g‘ri');
  }
  if (tashkentDate(date) > tashkentDate(new Date())) {
    throw new BadRequestException(
      'Kassa sanasi bugundan keyin bo‘lishi mumkin emas',
    );
  }
}

const byId = <T extends { id: number }>(a: T, b: T) => a.id - b.id;

const passengerText = (p: {
  firstName?: string | null;
  lastName?: string | null;
  phoneNumber?: string | null;
}) =>
  [`${p.firstName ?? ''} ${p.lastName ?? ''}`.trim(), p.phoneNumber]
    .filter(Boolean)
    .join(', ');

const moneyText = (m: {
  money_received: number | string;
  currency: string;
  currency_amount: number | string;
  type: string;
}) =>
  `${num(m.money_received)} ${m.currency}${m.currency !== 'UZS' ? ` × ${num(m.currency_amount)}` : ''} / ${m.type}`;

@Injectable()
export class CashService {
  private readonly logger = new Logger(CashService.name);

  constructor(
    @InjectRepository(Cash)
    private readonly cashRepository: Repository<Cash>,
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(Money)
    private readonly moneyRepository: Repository<Money>,
    @InjectRepository(History)
    private readonly historyRepository: Repository<History>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(CashStatusHistory)
    private readonly statusHistoryRepository: Repository<CashStatusHistory>,
    @InjectRepository(UserSession)
    private readonly sessionRepository: Repository<UserSession>,
    private readonly dataSource: DataSource,
    @InjectRepository(ServiceType)
    private readonly serviceTypeRepository: Repository<ServiceType>,
    private readonly cashNotificationService: CashNotificationService,
    private readonly settingsService: SettingsService,
    private readonly loginServer: LoginServerClient,
  ) {}

  /* ================================ yordamchilar ================================ */

  private isParticipant(cash: Cash, userId: number) {
    return cash.user?.id === userId || cash.additionalUser?.id === userId;
  }

  /** Rahbar va buxgalter hammasini ko'radi, xodim - egasi yoki qo'shimcha xodim bo'lganlarini */
  private applyScope<T extends SelectQueryBuilder<any>>(
    qb: T,
    user: UserReq,
    alias = 'c',
  ): T {
    if (!canViewAll(user.role)) {
      qb.andWhere(
        `(${alias}.user_id = :scopeUserId OR ${alias}.additional_user = :scopeUserId)`,
        { scopeUserId: user.id },
      );
    }
    return qb;
  }

  /** Foydalanuvchi ko'ra oladigan kassa; aks holda 404 */
  private async findVisibleCash(
    user: UserReq,
    id: number,
    relations: Record<string, any> = { user: true, additionalUser: true },
  ) {
    const cash = await this.cashRepository.findOne({
      where: { id, isDeleted: false },
      relations: { user: true, additionalUser: true, ...relations },
    });
    if (
      !cash ||
      (!canViewAll(user.role) && !this.isParticipant(cash, user.id))
    ) {
      throw new NotFoundException('Kassa topilmadi');
    }
    return cash;
  }

  private resolveUserId(user: UserReq, raw?: string) {
    if (!raw) return undefined;
    if (raw === 'me') return user.id;
    const id = Number(raw);
    if (!Number.isInteger(id)) {
      throw new BadRequestException(`userId noto'g'ri: "${raw}"`);
    }
    return id;
  }

  /** /cashes, /cashes/status-counts va eksport uchun bitta filtr quruvchisi */
  private filteredQuery(user: UserReq, f: CashFilterDto, status?: string) {
    const qb = this.cashRepository
      .createQueryBuilder('c')
      .leftJoin('c.brutto', 'b')
      .where('c.is_deleted = false');
    this.applyScope(qb, user);

    const userId = this.resolveUserId(user, f.userId);
    if (userId) {
      qb.andWhere(
        '(c.user_id = :filterUserId OR c.additional_user = :filterUserId)',
        { filterUserId: userId },
      );
    }

    if (f.participation === 'own') {
      qb.andWhere('c.user_id = :ownerId', { ownerId: user.id });
    } else if (f.participation === 'shared') {
      qb.andWhere('c.additional_user IS NOT NULL');
    }

    const start = parseDate(f.startDate, 'startDate', true);
    const end = parseDate(f.endDate, 'endDate', true);
    if (start) qb.andWhere('c.created_at >= :startDate', { startDate: start });
    if (end) qb.andWhere('c.created_at <= :endDate', { endDate: end });

    const cashNumber = f.cashNumber?.trim();
    if (cashNumber) {
      qb.andWhere('c.cash_number ILIKE :cashNumber', {
        cashNumber: `${escapeLike(cashNumber)}%`,
      });
    }

    const search = f.search?.trim();
    if (search) {
      // Ichki ID: "00042", "42", "ID 00042" yoki "#42" - seq_no bo'yicha aniq moslik
      const idMatch = /^(?:id\s*)?#?\s*(\d{1,9})$/i.exec(search);
      const seqNo = idMatch ? Number(idMatch[1]) : null;
      qb.andWhere(
        `(${seqNo !== null ? 'c.seq_no = :seqNo OR ' : ''}c.cash_number ILIKE :search OR c.destination ILIKE :search
          OR EXISTS (SELECT 1 FROM passenger p WHERE p."cashId" = c.id AND (
            p.first_name ILIKE :search OR p.last_name ILIKE :search
            OR CONCAT(p.first_name, ' ', p.last_name) ILIKE :search
            OR CONCAT(p.last_name, ' ', p.first_name) ILIKE :search))
          OR EXISTS (SELECT 1 FROM cash_services cs WHERE cs."cashId" = c.id AND cs.code ILIKE :search))`,
        { search: `%${escapeLike(search)}%`, seqNo },
      );
    }

    if (status && status !== 'ALL') {
      if (!COUNT_STATUSES.includes(status)) {
        throw new BadRequestException(`status noto'g'ri: "${status}"`);
      }
      if (status === 'due') {
        qb.andWhere(
          `${ACTIVE_STATUS_SQL} AND ${DEBT_SQL} >= ${DEBT_THRESHOLD}`,
        );
      } else {
        qb.andWhere('c.status = :status', { status });
      }
    }
    return qb;
  }

  /** Pul hisobiga kiradigan (draft/cancelled emas, o'chirilmagan) kassalar, to'liq yuklangan */
  private activeCashesQuery(user: UserReq | null, start: Date, end: Date) {
    const qb = this.cashRepository
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.brutto', 'b')
      .leftJoinAndSelect('c.moneys', 'm')
      .leftJoinAndSelect('c.cashServices', 'cs')
      .leftJoinAndSelect('c.additionalUser', 'au')
      .where('c.is_deleted = false')
      .andWhere(ACTIVE_STATUS_SQL)
      .andWhere('c.created_at BETWEEN :start AND :end', { start, end });
    if (user) this.applyScope(qb, user);
    return qb;
  }

  private async assertCashNumberFree(
    cashNumber: string,
    excludeId?: number,
    manager?: EntityManager,
  ) {
    if (await this.cashNumberExists(cashNumber, excludeId, manager)) {
      throw new ConflictException('Bu dogovor raqamli kassa allaqachon bor');
    }
  }

  /** "0"/bo'sh dogovor raqami (dogovor hali berilmagan) - takrorlanishi mumkin */
  private async cashNumberExists(
    cashNumber: string,
    excludeId?: number,
    manager?: EntityManager,
  ) {
    if (!hasContractNumber(cashNumber)) return false;
    const repo = manager ? manager.getRepository(Cash) : this.cashRepository;
    const qb = repo
      .createQueryBuilder('c')
      .where('c.is_deleted = false')
      .andWhere('LOWER(TRIM(c.cash_number)) = LOWER(:cashNumber)', {
        cashNumber: cashNumber.trim(),
      });
    if (excludeId) qb.andWhere('c.id <> :excludeId', { excludeId });
    return (await qb.getCount()) > 0;
  }

  private async assertActiveUser(id: number) {
    const u = await this.userRepository.findOne({
      where: { id, isDeleted: false, status: true },
    });
    if (!u) throw new BadRequestException('Qo‘shimcha xodim topilmadi');
    return u;
  }

  private async getStatusHistory(cashId: number) {
    const [rows, legacy] = await Promise.all([
      this.statusHistoryRepository.find({
        where: { cash: { id: cashId } },
        relations: { changedByUser: true },
        order: { created_at: 'ASC', id: 'ASC' },
      }),
      // Eski kassalar: holat o'zgarishlari umumiy history jadvalida qolgan
      this.historyRepository.find({
        where: { cash: { id: cashId }, name: In(['cash', 'status']) },
        relations: { user: true },
        order: { created_at: 'ASC', id: 'ASC' },
      }),
    ]);

    // Yangi jadval to'ldirila boshlagandan keyingi o'zgarishlar ikkala joyga
    // yoziladi - eski manbadan faqat undan oldingilarini olamiz
    const firstNew = rows[0]?.created_at.getTime() ?? Infinity;
    const before = legacy
      .filter(
        (h) =>
          COUNT_STATUSES.includes(h.new_column) &&
          h.created_at.getTime() < firstNew,
      )
      .map((h) => ({
        id: -h.id,
        status: h.new_column,
        comment: null as string | null,
        created_at: h.created_at,
        changedByUser: publicUser(h.user),
      }));

    return [
      ...before,
      ...rows.map((r) => ({
        id: r.id,
        status: r.status,
        comment: r.comment,
        created_at: r.created_at,
        changedByUser: publicUser(r.changedByUser),
      })),
    ];
  }

  private mapListItem(cash: Cash) {
    const passengers = [...(cash.passengers ?? [])].sort(byId);
    const bruttoUzs = getBrutto(cash);
    const netto = num(cash.netto);
    const paid = getPaidAmount(cash);
    return {
      id: cash.id,
      seqNo: cash.seq_no,
      cashNumber: cash.cash_number,
      createdAt: cash.created_at,
      departureDate: cash.departure_date,
      returnDate: cash.return_date,
      destination: cash.destination,
      status: cash.status,
      userId: cash.user?.id ?? null,
      firstName: cash.user?.firstName,
      lastName: cash.user?.lastName,
      additionalUser: publicUser(cash.additionalUser),
      passangerNames: passengers[0]?.firstName,
      passangerLastNames: passengers[0]?.lastName,
      passengerCount: cash.turist_count,
      brutto: cash.brutto,
      bruttoUzs,
      netto,
      profit: roundToNearestThousand(bruttoUzs - netto),
      paid,
      debt: getDebt(cash),
      // Eski maydon: netto (so'mda)
      totalAmount: netto,
      totalAmountCurrency: 'UZS',
      isBonusTaken: cash.is_bonus_taken,
    };
  }

  /* ================================= dashboard ================================= */

  async getDashboard(user: UserReq, dto: DashboardFilterDto) {
    const start = parseDate(dto.startDate, 'startDate');
    const end = parseDate(dto.endDate, 'endDate');
    const sharePercent = await this.settingsService.getSharePercent();

    // Sanoq uchun barcha holatlar, pul hisobiga faqat faollari kiradi
    const countsQb = this.cashRepository
      .createQueryBuilder('c')
      .select('c.status', 'status')
      .addSelect('COUNT(c.id)', 'count')
      .where('c.is_deleted = false')
      .andWhere('c.created_at BETWEEN :start AND :end', { start, end })
      .groupBy('c.status');
    this.applyScope(countsQb, user);

    const [countRows, active] = await Promise.all([
      countsQb.getRawMany<{ status: string; count: string }>(),
      this.activeCashesQuery(user, start, end).getMany(),
    ]);
    const count = (s: string) =>
      num(countRows.find((r) => r.status === s)?.count);

    let totalBrutto = 0;
    let totalNetto = 0;
    let debtorSum = 0;
    let debtorCashes = 0;
    let totalPaid = 0;
    let employeeShare = 0;
    let touristCount = 0;

    for (const cash of active) {
      const brutto = getBrutto(cash);
      const debt = getDebt(cash);
      totalBrutto += brutto;
      totalNetto += getNetto(cash);
      totalPaid += getPaidAmount(cash);
      employeeShare += getBonus(cash, sharePercent);
      touristCount += num(cash.turist_count);
      if (debt > 0) {
        debtorSum += debt;
        debtorCashes++;
      }
    }
    const grossProfit = totalBrutto - totalNetto;

    return {
      openedCashes:
        count('draft') + count('pending_approval') + count('sent_for_rework'),
      soldTours: count('approved') + count('closed'),
      cancelledCashes: count('cancelled'),
      closedCashes: count('closed'),
      totalBrutto,
      totalNetto,
      totalPaid,
      debtorCashes,
      debtorSum,
      totalProfit: grossProfit,
      grossProfit,
      employeeShare,
      netProfit: grossProfit - employeeShare,
      touristCount,
    };
  }

  async getChartData(user: UserReq, dto: DashboardFilterDto) {
    const start = parseDate(dto.startDate, 'startDate');
    const end = parseDate(dto.endDate, 'endDate');
    const cashes = await this.activeCashesQuery(user, start, end).getMany();

    type Bucket = { revenue: number; profit: number; count: number };
    const byMonthMap = new Map<string, Bucket>();
    const byDayMap = new Map<string, Bucket>();
    const add = (map: Map<string, Bucket>, key: string, cash: Cash) => {
      const b = map.get(key) ?? { revenue: 0, profit: 0, count: 0 };
      b.revenue += getBrutto(cash);
      b.profit += getProfit(cash);
      b.count += 1;
      map.set(key, b);
    };

    for (const cash of cashes) {
      const day = tashkentDate(cash.created_at);
      add(byDayMap, day, cash);
      add(byMonthMap, day.slice(0, 7), cash);
    }

    const round = (key: string, map: Map<string, Bucket>) => {
      const v = map.get(key) ?? { revenue: 0, profit: 0, count: 0 };
      return {
        revenue: Math.round(v.revenue),
        profit: Math.round(v.profit),
        count: v.count,
      };
    };

    const days = this.dayRange(tashkentDate(start), tashkentDate(end));
    const months = [...new Set(days.map((d) => d.slice(0, 7)))];
    return {
      byMonth: months.map((key) => ({
        label: new Date(`${key}-01T00:00:00Z`).toLocaleString('en-US', {
          month: 'short',
          timeZone: 'UTC',
        }),
        ...round(key, byMonthMap),
      })),
      byDay: days.map((key) => ({
        label: String(Number(key.slice(8, 10))),
        ...round(key, byDayMap),
      })),
    };
  }

  /** 'YYYY-MM-DD' kunlar ro'yxati (ikkala chegara ham kiradi, ko'pi bilan 366 kun) */
  private dayRange(from: string, to: string) {
    const days: string[] = [];
    const cur = new Date(`${from}T00:00:00Z`);
    const last = new Date(`${to}T00:00:00Z`);
    while (cur <= last && days.length <= 366) {
      days.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return days;
  }

  /** Xodim ulushi SQL'da: asosiy foiz, juma (Toshkent) x1.25, qo'shimcha xodim bo'lsa yarmi */
  private bonusSql(sharePercent: number) {
    const pct = Number(sharePercent) / 100;
    return `(${pct} * (CASE WHEN EXTRACT(DOW FROM ${sqlTashkent('c.created_at')}) = 5 THEN 1.25 ELSE 1 END)
      * (CASE WHEN c.additional_user IS NOT NULL THEN 0.5 ELSE 1 END) * ${PROFIT_SQL})`;
  }

  async getDashboardCharts(user: UserReq, dto: DashboardFilterDto) {
    const startDate = parseDate(dto.startDate, 'startDate');
    const endDate = parseDate(dto.endDate, 'endDate');
    const sharePercent = await this.settingsService.getSharePercent();
    const bonusSql = this.bonusSql(sharePercent);

    const base = () =>
      this.applyScope(
        this.cashRepository
          .createQueryBuilder('c')
          .leftJoin('c.brutto', 'b')
          .where('c.is_deleted = false')
          .andWhere(ACTIVE_STATUS_SQL)
          .andWhere('c.created_at BETWEEN :startDate AND :endDate', {
            startDate,
            endDate,
          }),
        user,
      );

    // Kun Toshkent vaqti bo'yicha
    const dayExpr = `DATE_TRUNC('day', ${sqlTashkent('c.created_at')})`;

    const [dailyRaw, destinationsRaw, employeesRaw] = await Promise.all([
      base()
        .select(`TO_CHAR(${dayExpr}, 'YYYY-MM-DD')`, 'date')
        .addSelect(`COALESCE(SUM(${BRUTTO_UZS_SQL}), 0)`, 'brutto')
        .addSelect(`COALESCE(SUM(${PROFIT_SQL}), 0)`, 'profit')
        .addSelect('COALESCE(SUM(c.turist_count), 0)', 'tourists')
        .addSelect('COUNT(c.id)', 'cashCount')
        .groupBy(dayExpr)
        .orderBy(dayExpr, 'ASC')
        .getRawMany<Record<string, string>>(),

      base()
        .select('c.destination', 'name')
        .addSelect('COALESCE(SUM(c.turist_count), 0)', 'tourists')
        .addSelect('COUNT(c.id)', 'cashCount')
        .addSelect(`COALESCE(SUM(${BRUTTO_UZS_SQL}), 0)`, 'brutto')
        .addSelect(`COALESCE(SUM(${PROFIT_SQL}), 0)`, 'profit')
        .groupBy('c.destination')
        .orderBy('SUM(c.turist_count)', 'DESC')
        .limit(7)
        .getRawMany<Record<string, string>>(),

      // Xodimlar reytingi (kassa egasi bo'yicha) - faqat rahbar va buxgalter uchun
      canViewAll(user.role)
        ? base()
            .innerJoin('c.user', 'u')
            .select('u.id', 'id')
            .addSelect(
              "CONCAT(u.firstName, ' ', COALESCE(u.lastName, ''))",
              'name',
            )
            .addSelect('COUNT(c.id)', 'cashCount')
            .addSelect('COALESCE(SUM(c.turist_count), 0)', 'tourists')
            .addSelect(`COALESCE(SUM(${BRUTTO_UZS_SQL}), 0)`, 'brutto')
            .addSelect(`COALESCE(SUM(${PROFIT_SQL}), 0)`, 'profit')
            .addSelect(`COALESCE(SUM(${bonusSql}), 0)`, 'bonus')
            .groupBy('u.id')
            .addGroupBy('u.firstName')
            .addGroupBy('u.lastName')
            .orderBy(`SUM(${PROFIT_SQL})`, 'DESC')
            .limit(7)
            .getRawMany<Record<string, string>>()
        : Promise.resolve([] as Record<string, string>[]),
    ]);

    const byDate = new Map(
      dailyRaw.map((r) => [
        r.date,
        {
          date: r.date,
          brutto: num(r.brutto),
          profit: num(r.profit),
          tourists: num(r.tourists),
          cashCount: num(r.cashCount),
        },
      ]),
    );
    const days = this.dayRange(tashkentDate(startDate), tashkentDate(endDate));
    const daily = days.map(
      (date) =>
        byDate.get(date) ?? {
          date,
          brutto: 0,
          profit: 0,
          tourists: 0,
          cashCount: 0,
        },
    );
    // Oraliqdan tashqarida qolgan (bo'lmasligi kerak) kunlar ham yo'qolmasin
    for (const [date, row] of byDate) if (!days.includes(date)) daily.push(row);
    daily.sort((a, b) => a.date.localeCompare(b.date));

    return {
      daily,
      destinations: destinationsRaw.map((r) => ({
        name: r.name,
        tourists: num(r.tourists),
        cashCount: num(r.cashCount),
        brutto: num(r.brutto),
        profit: num(r.profit),
      })),
      employees: employeesRaw.map((r) => ({
        id: num(r.id),
        name: String(r.name ?? '').trim(),
        tourists: num(r.tourists),
        cashCount: num(r.cashCount),
        brutto: num(r.brutto),
        profit: num(r.profit),
        bonus: num(r.bonus),
      })),
    };
  }

  /** Xodim paneli: faqat o'z ko'rsatkichlari va reytingdagi o'rni */
  async getMeStats(user: UserReq, dto: DashboardFilterDto) {
    const start = parseDate(dto.startDate, 'startDate');
    const end = parseDate(dto.endDate, 'endDate');
    const { prevStart, prevEnd } = previousPeriod(start, end);
    const settings = await this.settingsService.get();
    const sharePercent = settings.employeeSharePercent;

    const own = (s: Date, e: Date) =>
      this.cashRepository
        .createQueryBuilder('c')
        .leftJoinAndSelect('c.brutto', 'b')
        .leftJoinAndSelect('c.moneys', 'm')
        .leftJoinAndSelect('c.cashServices', 'cs')
        .leftJoinAndSelect('c.additionalUser', 'au')
        .where('c.is_deleted = false')
        .andWhere(ACTIVE_STATUS_SQL)
        .andWhere('(c.user_id = :uid OR c.additional_user = :uid)', {
          uid: user.id,
        })
        .andWhere('c.created_at BETWEEN :s AND :e', { s, e });

    const profitSubquery = (column: string) => `
      SELECT ${column} AS uid, ${PROFIT_SQL} AS profit
      FROM cash c LEFT JOIN brutto b ON b.id = c.brutto_id
      WHERE c.is_deleted = false AND ${ACTIVE_STATUS_SQL}
        AND c.created_at BETWEEN $1 AND $2 AND ${column} IS NOT NULL`;

    const [current, previous, me, employees, profits, debtCashes] =
      await Promise.all([
        own(start, end).getMany(),
        own(prevStart, prevEnd).getMany(),
        this.userRepository.findOne({ where: { id: user.id } }),
        this.userRepository.find({
          where: { type: 'EMPLOYEE', isDeleted: false, status: true },
          select: { id: true },
        }),
        this.dataSource.query<{ uid: number; profit: string }[]>(
          `SELECT uid, SUM(profit) AS profit FROM (
            ${profitSubquery('c.user_id')} UNION ALL ${profitSubquery('c.additional_user')}
          ) t GROUP BY uid`,
          [start, end],
        ),
        this.cashRepository
          .createQueryBuilder('c')
          .leftJoinAndSelect('c.brutto', 'b')
          .leftJoinAndSelect('c.moneys', 'm')
          .leftJoinAndSelect('c.passengers', 'p')
          .leftJoinAndSelect('c.statusHistory', 'sh')
          .leftJoinAndSelect('sh.changedByUser', 'shu')
          .where('c.is_deleted = false')
          .andWhere(ACTIVE_STATUS_SQL)
          .andWhere('(c.user_id = :uid OR c.additional_user = :uid)', {
            uid: user.id,
          })
          .getMany(),
      ]);
    const prevCashCount = previous.length;

    // Reyting: faol xodimlar (va o'zi) yalpi foyda bo'yicha
    const profitBy = new Map(
      profits.map((r) => [Number(r.uid), num(r.profit)]),
    );
    const ids = new Set([...employees.map((e) => e.id), user.id]);
    const myProfit = profitBy.get(user.id) ?? 0;
    const higher = [...ids].filter(
      (id) => id !== user.id && (profitBy.get(id) ?? 0) > myProfit,
    ).length;
    // Xodimning o'zi yoki hamma 0 foyda qilgan bo'lsa - o'rin yo'q ("—")
    const anyProfit = [...ids].some((id) => (profitBy.get(id) ?? 0) > 0);
    const rank = myProfit > 0 && anyProfit ? higher + 1 : null;

    const weekly = [0, 0, 0, 0, 0];
    for (const cash of current) {
      const day = Number(tashkentDate(cash.created_at).slice(8, 10));
      weekly[Math.min(4, Math.floor((day - 1) / 7))] += getProfit(cash);
    }

    // Davr bo'yicha foyda: 14 kungacha - kunlik, undan uzun - 7 kunlik bo'laklar
    const firstDay = tashkentDate(start);
    const lastDay = tashkentDate(end);
    const totalDays = daysBetween(firstDay, lastDay) + 1;
    const step = totalDays <= 14 ? 1 : 7;
    const trend: { from: string; to: string; profit: number }[] = [];
    for (let i = 0; i < totalDays; i += step) {
      const from = addDay(firstDay, i);
      const to = addDay(firstDay, Math.min(i + step, totalDays) - 1);
      trend.push({ from, to, profit: 0 });
    }
    for (const cash of current) {
      const idx = Math.floor(
        daysBetween(firstDay, tashkentDate(cash.created_at)) / step,
      );
      if (trend[idx]) trend[idx].profit += getProfit(cash);
    }

    const sum = (list: Cash[], fn: (c: Cash) => number) =>
      list.reduce((acc, c) => acc + fn(c), 0);
    const today = tashkentDate(new Date());
    const in7 = addDay(today, 7);
    const lastStatus = (cash: Cash, status: string) =>
      [...(cash.statusHistory ?? [])]
        .filter((h) => h.status === status)
        .sort(
          (a, b) =>
            b.created_at.getTime() - a.created_at.getTime() || b.id - a.id,
        )[0];
    const brief = (cash: Cash) => {
      const p = [...(cash.passengers ?? [])].sort(byId)[0];
      return {
        cashId: cash.id,
        seqNo: cash.seq_no,
        cashNumber: cash.cash_number,
        client: p ? `${p.lastName ?? ''} ${p.firstName}`.trim() : null,
        destination: cash.destination,
        departureDate: tashkentDate(cash.departure_date),
        debt: Math.max(getDebt(cash), 0),
      };
    };
    const note = (cash: Cash, status: string) => {
      const h = lastStatus(cash, status);
      return {
        comment: h?.comment ?? null,
        by: h?.changedByUser
          ? `${h.changedByUser.firstName} ${h.changedByUser.lastName ?? ''}`.trim()
          : null,
        at: h?.created_at ?? null,
      };
    };
    const byDeparture = (a: Cash, b: Cash) =>
      a.departure_date.localeCompare(b.departure_date);

    return {
      cashCount: current.length,
      prevCashCount,
      brutto: sum(current, getBrutto),
      profit: sum(current, getProfit),
      bonus: Math.round(sum(current, (c) => getBonus(c, sharePercent))),
      // Oldingi xuddi shunday davr - solishtirish uchun
      prev: {
        brutto: sum(previous, getBrutto),
        profit: sum(previous, getProfit),
        bonus: Math.round(sum(previous, (c) => getBonus(c, sharePercent))),
      },
      trend: trend.map((t) => ({ ...t, profit: Math.round(t.profit) })),
      // 7 kun ichida uchadigan kassalar (qarzi bilan)
      upcoming: debtCashes
        .filter((c) => {
          const d = tashkentDate(c.departure_date);
          return d >= today && d <= in7;
        })
        .sort(byDeparture)
        .map(brief),
      // Rahbar qayta ishlashga qaytargan kassalar (izohi bilan)
      rework: debtCashes
        .filter((c) => c.status === 'sent_for_rework')
        .sort(byDeparture)
        .map((c) => ({ ...brief(c), ...note(c, 'sent_for_rework') })),
      // Tekshiruvdagi (Kutilmoqda) kassalar
      pending: debtCashes
        .filter((c) => c.status === 'pending_approval')
        .sort(byDeparture)
        .map((c) => ({ ...brief(c), ...note(c, 'pending_approval') })),
      bonusPercent: sharePercent,
      rank,
      rankTotal: ids.size,
      monthlyTarget: me?.monthlyTarget ?? settings.monthlyTarget,
      weekly: weekly.map(Math.round),
      debts: debtCashes
        .map((c) => ({ cash: c, debt: getDebt(c) }))
        .filter((d) => d.debt > 0)
        .sort((a, b) =>
          a.cash.departure_date.localeCompare(b.cash.departure_date),
        )
        .map(({ cash, debt }) => {
          const p = [...(cash.passengers ?? [])].sort(byId)[0];
          return {
            cashId: cash.id,
            seqNo: cash.seq_no,
            cashNumber: cash.cash_number,
            client: p ? `${p.lastName ?? ''} ${p.firstName}`.trim() : null,
            destination: cash.destination,
            departureDate: tashkentDate(cash.departure_date),
            debt,
          };
        }),
    };
  }

  /* ================================== kassalar ================================== */

  async getCashes(user: UserReq, query: CashListQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const order = (query.order ?? 'desc').toUpperCase() as 'ASC' | 'DESC';
    const sort = query.sort ?? 'created_at';

    const qb = this.filteredQuery(user, query, query.status);
    const total = await qb.getCount();

    const idQb = qb.clone().select('c.id', 'id');
    // Qidiruv ichki ID ga aniq mos kelsa - o'sha kassa birinchi turadi
    const seqSearch = /^(?:id\s*)?#?\s*(\d{1,9})$/i.exec(
      query.search?.trim() ?? '',
    );
    if (seqSearch) {
      idQb
        .addSelect(
          'CASE WHEN c.seq_no = :seqFirst THEN 0 ELSE 1 END',
          'seq_first',
        )
        .setParameter('seqFirst', Number(seqSearch[1]))
        .orderBy('seq_first', 'ASC');
    }
    // Raqamlar matn sifatida saqlanadi: avval uzunlik, keyin qiymat ("99" < "100")
    const sortBy: string[] =
      sort === 'cash_number'
        ? ['LENGTH(c.cash_number)', 'c.cash_number']
        : [`c.${sort}`];
    for (const key of sortBy) idQb.addOrderBy(key, order);
    idQb
      .addOrderBy('c.id', order)
      .offset((page - 1) * limit)
      .limit(limit);

    const ids = (await idQb.getRawMany<{ id: number }>()).map((r) =>
      Number(r.id),
    );
    const cashes = ids.length
      ? await this.cashRepository.find({
          where: { id: In(ids) },
          relations: {
            brutto: true,
            moneys: true,
            passengers: true,
            user: true,
            additionalUser: true,
          },
        })
      : [];
    const byKey = new Map(cashes.map((c) => [c.id, c]));

    return {
      data: ids
        .map((id) => byKey.get(id))
        .filter((c): c is Cash => !!c)
        .map((c) => this.mapListItem(c)),
      total,
      page,
      limit,
    };
  }

  async getCashStatusCounts(user: UserReq, query: CashFilterDto) {
    const qb = this.filteredQuery(user, query);
    const [rows, due] = await Promise.all([
      qb
        .clone()
        .select('c.status', 'status')
        .addSelect('COUNT(DISTINCT c.id)', 'count')
        .groupBy('c.status')
        .getRawMany<{ status: string; count: string }>(),
      qb
        .clone()
        .andWhere(`${ACTIVE_STATUS_SQL} AND ${DEBT_SQL} >= ${DEBT_THRESHOLD}`)
        .getCount(),
    ]);

    const counts: Record<string, number> = {};
    for (const s of COUNT_STATUSES) counts[s] = 0;
    for (const r of rows) counts[r.status] = num(r.count);
    counts.due = due;

    const all = rows.reduce((s, r) => s + num(r.count), 0);
    // `hammasi` - eski frontend kaliti
    return { ALL: all, hammasi: all, ...counts };
  }

  /** Raqam bandligini barcha kassalar bo'yicha tekshiradi (rolga bog'liq emas) */
  async checkCashNumber(query: CheckNumberQueryDto) {
    const exists = await this.cashNumberExists(
      query.cashNumber,
      query.excludeId,
    );

    // lastNumber - faqat raqamdan iborat kassa raqamlari ichida eng kattasi;
    // bunday raqam bo'lmasa - eng oxirgi yaratilgan kassa raqami
    const [numeric] = await this.dataSource.query<{ cash_number: string }[]>(
      `SELECT cash_number FROM cash
       WHERE is_deleted = false AND TRIM(cash_number) ~ '^[0-9]+$'
       ORDER BY TRIM(cash_number)::numeric DESC LIMIT 1`,
    );
    let lastNumber: string | null = numeric?.cash_number?.trim() || null;
    if (!lastNumber) {
      const latest = await this.cashRepository.findOne({
        where: { isDeleted: false },
        order: { created_at: 'DESC', id: 'DESC' },
      });
      lastNumber = latest?.cash_number ?? null;
    }
    return { exists, lastNumber };
  }

  async createCash(user: UserReq, body: CreateCashDto) {
    requireCashWriter(user);
    if (!body.brutto) {
      throw new BadRequestException(
        'Kelishilgan narx (brutto) kiritilishi shart',
      );
    }
    if (!body.services?.length) {
      throw new BadRequestException('Kamida bitta xizmat tanlanishi shart');
    }
    // Dogovor raqami: bo'sh bo'lsa "0" (dogovor hali berilmagan)
    const cashNumber = body.cash_number?.trim() || '0';
    await this.assertCashNumberFree(cashNumber);

    const createdAt = body.created_at
      ? parseCashDate(body.created_at)
      : undefined;
    if (createdAt) assertNotFutureCashDate(createdAt);

    if (body.additional_user_id) {
      if (body.additional_user_id === user.id) {
        throw new BadRequestException(
          "Qo'shimcha xodim kassa egasining o'zi bo'lishi mumkin emas",
        );
      }
      await this.assertActiveUser(body.additional_user_id);
    }

    const created = await this.dataSource.transaction(async (manager) => {
      const serviceIds = [...new Set(body.services.map((s) => s.service_id))];
      const foundServices = await manager
        .getRepository(Service)
        .find({ where: { id: In(serviceIds) } });
      if (foundServices.length !== serviceIds.length) {
        throw new BadRequestException('Tanlangan xizmatlardan biri topilmadi');
      }

      const netto = roundToNearestThousand(
        body.services.reduce(
          (sum, s) =>
            sum +
            toUZS(
              s.service_amount,
              s.currency,
              rateOf(s.currency, s.currency_amount),
            ),
          0,
        ),
      );

      const brutto = await manager.getRepository(Brutto).save({
        amount: body.brutto.amount.toFixed(2),
        currency: body.brutto.currency,
        currency_amount: rateOf(
          body.brutto.currency,
          body.brutto.currency_amount,
        ),
      });

      const cash = await manager.getRepository(Cash).save({
        cash_number: cashNumber,
        destination: body.destination,
        departure_date: body.departure_date,
        return_date: body.return_date,
        comment: body.comment,
        turist_count: body.passengers?.length || body.turist_count,
        status: body.status,
        netto: netto.toFixed(2),
        user: { id: user.id },
        brutto: { id: brutto.id },
        ...(createdAt ? { created_at: createdAt } : {}),
        ...(body.additional_user_id
          ? { additionalUser: { id: body.additional_user_id } }
          : {}),
      });

      await manager.getRepository(CashServices).save(
        body.services.map((s) => ({
          code: s.code,
          service_amount: s.service_amount,
          currency: s.currency,
          currency_amount: rateOf(s.currency, s.currency_amount),
          cash: { id: cash.id },
          service: { id: s.service_id },
        })),
      );

      if (body.moneys?.length) {
        await manager.getRepository(Money).save(
          body.moneys.map((m) => ({
            money_received: m.money_received,
            currency: m.currency,
            currency_amount: rateOf(m.currency, m.currency_amount),
            type: m.type,
            cash: { id: cash.id },
          })),
        );
      }

      if (body.passengers?.length) {
        const passengers = await manager.getRepository(Passenger).save(
          body.passengers.map((p) => ({
            firstName: p.firstName.trim(),
            lastName: p.lastName?.trim(),
            phoneNumber: p.phoneNumber?.trim() || undefined,
            cash: { id: cash.id },
          })),
        );
        await linkPassengersToClients(manager, passengers);
      }

      await manager.getRepository(CashStatusHistory).save({
        status: body.status,
        cash: { id: cash.id },
        changedByUser: { id: user.id },
      });

      return cash;
    });

    // Transaction TASHQARISIDA - xabar sekin ketsa ham transaction ochiq qolmaydi
    if (body.status === CashStatus.PENDING_APPROVAL) {
      await this.cashNotificationService.notifyAdmins(
        `Yangi kassa ${cashLabel(created)} yaratildi va tasdiqlashga yuborildi`,
      );
    }

    return this.getCash(user, created.id);
  }

  async getCash(user: UserReq, id: number) {
    const cash = await this.findVisibleCash(user, id, CASH_RELATIONS);
    cash.passengers?.sort(byId);
    cash.moneys?.sort(byId);
    cash.cashServices?.sort(byId);
    return {
      ...cash,
      statusHistory: await this.getStatusHistory(id),
    };
  }

  async createPaymant(user: UserReq, id: number, body: CreatePaymantDto) {
    requireCashWriter(user);
    const cash = await this.findVisibleCash(user, id, { brutto: true });
    if (cash.status === 'cancelled') {
      throw new BadRequestException(
        "Bekor qilingan kassaga to'lov qo'shilmaydi",
      );
    }
    const reviewAgain = needsReviewAgain(user, cash.status);

    await this.dataSource.transaction(async (manager) => {
      const money = await manager.getRepository(Money).save({
        type: body.type,
        money_received: body.amount,
        currency: body.currency,
        currency_amount: rateOf(body.currency, body.currency_amount),
        cash: { id },
      });
      await manager.getRepository(History).save({
        name: 'money',
        old_column: '',
        new_column: `${moneyText(money)}${body.comment?.trim() ? ` — ${body.comment.trim()}` : ''}`,
        user: { id: user.id },
        cash: { id },
      });
      if (reviewAgain) {
        await this.sendBackToReview(
          manager,
          cash,
          user,
          "Xodim to'lov qo'shdi",
        );
      }
    });
    if (reviewAgain) await this.notifyReviewAgain(cash);

    cash.moneys = await this.moneyRepository.find({ where: { cash: { id } } });
    return {
      paidAmount: getPaidAmount(cash),
      debt: getDebt(cash),
    };
  }

  async updateCash(user: UserReq, id: number, body: UpdateCashDto) {
    requireCashWriter(user);

    const result = await this.dataSource.transaction(async (manager) => {
      const cashRepo = manager.getRepository(Cash);
      const passengerRepo = manager.getRepository(Passenger);
      const cashServicesRepo = manager.getRepository(CashServices);
      const moneyRepo = manager.getRepository(Money);
      const bruttoRepo = manager.getRepository(Brutto);

      const cash = await cashRepo.findOne({
        where: { id, isDeleted: false },
        relations: { brutto: true, user: true, additionalUser: true },
      });
      if (
        !cash ||
        (!isAdmin(user.role) && !this.isParticipant(cash, user.id))
      ) {
        throw new NotFoundException('Kassa topilmadi');
      }
      if (cash.status === 'cancelled') {
        throw new BadRequestException(
          'Bekor qilingan kassani tahrirlab bo‘lmaydi',
        );
      }
      const oldStatus = cash.status;
      // Xodim tasdiqlangan/yopilgan kassani tahrirlasa - holatni o'zi tanlamaydi
      const reviewAgain = needsReviewAgain(user, cash.status);
      if (reviewAgain) body.status = undefined;

      // Holat faqat ruxsat etilgan o'tish bo'yicha o'zgaradi (frontend bilan bir xil qoida)
      const statusChanged =
        body.status !== undefined && String(body.status) !== cash.status;
      if (statusChanged) assertTransition(cash.status, body.status!, user.role);

      const cashNumber =
        body.cash_number === undefined
          ? undefined
          : body.cash_number.trim() || '0';
      // Raqam o'zgarmagan bo'lsa umuman tekshirilmaydi
      if (
        cashNumber !== undefined &&
        cashNumber !== (cash.cash_number ?? '').trim()
      ) {
        await this.assertCashNumberFree(cashNumber, id, manager);
      }

      let additionalUser: User | null | undefined;
      if (body.additional_user_id === null) additionalUser = null;
      else if (body.additional_user_id !== undefined) {
        if (body.additional_user_id === cash.user?.id) {
          throw new BadRequestException(
            "Qo'shimcha xodim kassa egasining o'zi bo'lishi mumkin emas",
          );
        }
        additionalUser = await this.assertActiveUser(body.additional_user_id);
      }

      const history: {
        name: string;
        old_column: string;
        new_column: string;
      }[] = [];
      const pushHistory = (name: string, oldVal: unknown, newVal: unknown) => {
        const str = (v: unknown) =>
          // eslint-disable-next-line @typescript-eslint/no-base-to-string
          v === undefined || v === null ? '' : String(v);
        const o = str(oldVal);
        const n = str(newVal);
        if (o !== n) history.push({ name, old_column: o, new_column: n });
      };

      // ---- Yo'lovchilar ----
      if (body.deletedPassengerIds?.length) {
        const toDelete = await passengerRepo.find({
          where: { id: In(body.deletedPassengerIds), cash: { id } },
        });
        for (const p of toDelete)
          pushHistory('passenger', passengerText(p), '');
        if (toDelete.length) {
          await passengerRepo.delete({ id: In(toDelete.map((p) => p.id)) });
        }
      }

      const touchedPassengers: Passenger[] = [];
      for (const p of body.passengers ?? []) {
        const firstName = (p.firstName ?? p.first_name)?.trim();
        const lastName = (p.lastName ?? p.last_name)?.trim();
        const phoneNumber = (p.phoneNumber ?? p.phone_number)?.trim();

        if (p.id) {
          const before = await passengerRepo.findOne({
            where: { id: p.id, cash: { id } },
            relations: { client: true },
          });
          if (!before) {
            throw new NotFoundException(`Yo'lovchi #${p.id} topilmadi`);
          }
          const oldText = passengerText(before);
          if (firstName !== undefined) before.firstName = firstName;
          if (lastName !== undefined) before.lastName = lastName;
          if (phoneNumber !== undefined)
            before.phoneNumber = phoneNumber || undefined;
          await passengerRepo.save(before);
          pushHistory('passenger', oldText, passengerText(before));
          touchedPassengers.push(before);
        } else {
          if (!firstName) {
            throw new BadRequestException("Yo'lovchi ismi majburiy");
          }
          const saved = await passengerRepo.save(
            passengerRepo.create({
              firstName,
              lastName,
              phoneNumber: phoneNumber || undefined,
              cash: { id },
            }),
          );
          pushHistory('passenger', '', passengerText(saved));
          touchedPassengers.push(saved);
        }
      }
      if (touchedPassengers.length) {
        await linkPassengersToClients(manager, touchedPassengers);
      }

      // ---- Xizmatlar (deletedServiceIds - CashServices.id, katalogdagi Service.id emas) ----
      const serviceIds = [
        ...new Set((body.services ?? []).map((s) => s.service_id)),
      ];
      const catalog = serviceIds.length
        ? await manager
            .getRepository(Service)
            .find({ where: { id: In(serviceIds) } })
        : [];
      if (catalog.length !== serviceIds.length) {
        throw new BadRequestException('Tanlangan xizmatlardan biri topilmadi');
      }
      const serviceName = (s?: Service | null) =>
        s ? [s.company_name, s.name].filter(Boolean).join(' — ') : '';
      const serviceText = (cs: CashServices, s?: Service | null) =>
        `${serviceName(s)}: ${num(cs.service_amount)} ${cs.currency}${cs.currency !== 'UZS' ? ` × ${num(cs.currency_amount)}` : ''}${cs.code ? ` (${cs.code})` : ''}`;

      if (body.deletedServiceIds?.length) {
        const toDelete = await cashServicesRepo.find({
          where: { id: In(body.deletedServiceIds), cash: { id } },
          relations: { service: true },
        });
        for (const cs of toDelete) {
          pushHistory('service', serviceText(cs, cs.service), '');
        }
        if (toDelete.length) {
          await cashServicesRepo.delete({ id: In(toDelete.map((s) => s.id)) });
        }
      }

      for (const s of body.services ?? []) {
        const target = catalog.find((c) => c.id === s.service_id)!;
        if (s.id) {
          const before = await cashServicesRepo.findOne({
            where: { id: s.id, cash: { id } },
            relations: { service: true },
          });
          if (!before) throw new NotFoundException(`Xizmat #${s.id} topilmadi`);
          const oldText = serviceText(before, before.service);
          before.service = target;
          before.code = s.code ?? before.code;
          before.service_amount = s.service_amount;
          before.currency = s.currency;
          before.currency_amount = rateOf(s.currency, s.currency_amount);
          await cashServicesRepo.save(before);
          pushHistory('service', oldText, serviceText(before, target));
        } else {
          const saved = await cashServicesRepo.save(
            cashServicesRepo.create({
              code: s.code,
              service_amount: s.service_amount,
              currency: s.currency,
              currency_amount: rateOf(s.currency, s.currency_amount),
              cash: { id } as Cash,
              service: target,
            }),
          );
          pushHistory('service', '', serviceText(saved, target));
        }
      }

      // ---- To'lovlar ----
      if (body.deletedMoneyIds?.length) {
        const toDelete = await moneyRepo.find({
          where: { id: In(body.deletedMoneyIds), cash: { id } },
        });
        for (const m of toDelete) pushHistory('money', moneyText(m), '');
        if (toDelete.length) {
          await moneyRepo.delete({ id: In(toDelete.map((m) => m.id)) });
        }
      }

      for (const m of body.moneys ?? []) {
        const values = {
          money_received: m.money_received,
          type: m.type,
          currency: m.currency,
          currency_amount: rateOf(m.currency, m.currency_amount),
        };
        if (m.id) {
          const before = await moneyRepo.findOne({
            where: { id: m.id, cash: { id } },
          });
          if (!before) throw new NotFoundException(`To'lov #${m.id} topilmadi`);
          await moneyRepo.update({ id: m.id }, values);
          pushHistory('money', moneyText(before), moneyText(values));
        } else {
          await moneyRepo.save(moneyRepo.create({ ...values, cash: { id } }));
          pushHistory('money', '', moneyText(values));
        }
      }

      // ---- Oddiy maydonlar ----
      const patch: Partial<Cash> = {};
      if (cashNumber !== undefined) {
        pushHistory('cash_number', cash.cash_number, cashNumber);
        patch.cash_number = cashNumber;
      }
      if (body.created_at !== undefined) {
        const createdAt = parseCashDate(body.created_at);
        // Sana o'zgartirilgandagina tekshiriladi: eski (xato) sanali kassaning boshqa maydonlarini tahrirlash to'xtamasin
        if (
          !cash.created_at ||
          tashkentDate(createdAt) !== tashkentDate(cash.created_at)
        ) {
          assertNotFutureCashDate(createdAt);
        }
        pushHistory(
          'created_at',
          cash.created_at?.toISOString(),
          createdAt.toISOString(),
        );
        patch.created_at = createdAt;
      }
      if (additionalUser !== undefined) {
        const name = (u?: User | null) =>
          u ? `${u.firstName} ${u.lastName ?? ''}`.trim() : '';
        pushHistory(
          'additional_user',
          name(cash.additionalUser),
          name(additionalUser),
        );
        patch.additionalUser = additionalUser as User;
      }
      if (body.destination !== undefined) {
        pushHistory('destination', cash.destination, body.destination);
        patch.destination = body.destination;
      }
      if (body.comment !== undefined) {
        pushHistory('comment', cash.comment, body.comment);
        patch.comment = body.comment;
      }
      if (body.departure_date !== undefined) {
        pushHistory('departure_date', cash.departure_date, body.departure_date);
        patch.departure_date = body.departure_date;
      }
      if (body.return_date !== undefined) {
        pushHistory('return_date', cash.return_date, body.return_date);
        patch.return_date = body.return_date;
      }
      if (statusChanged) {
        pushHistory('status', cash.status, body.status);
        patch.status = body.status;
      }

      // ---- turist_count va netto avtomatik hisoblanadi ----
      // Transaction ichida so'rovlar ketma-ket (bitta ulanish)
      const finalPassengers = await passengerRepo.count({
        where: { cash: { id } },
      });
      const finalServices = await cashServicesRepo.find({
        where: { cash: { id } },
      });
      const touristCount =
        finalPassengers || (body.turist_count ?? cash.turist_count);
      const netto = roundToNearestThousand(
        finalServices.reduce(
          (sum, cs) =>
            sum +
            toUZS(num(cs.service_amount), cs.currency, num(cs.currency_amount)),
          0,
        ),
      ).toFixed(2);
      pushHistory('turist_count', cash.turist_count, touristCount);
      pushHistory('netto', num(cash.netto), num(netto));
      patch.turist_count = touristCount;
      patch.netto = netto;
      patch.updated_at = new Date();

      await cashRepo.save({ id, ...patch });

      // ---- Brutto ----
      if (body.brutto) {
        const values = {
          amount: body.brutto.amount.toFixed(2),
          currency: body.brutto.currency,
          currency_amount: rateOf(
            body.brutto.currency,
            body.brutto.currency_amount,
          ),
        };
        const text = (b?: Partial<Brutto> | null) =>
          b
            ? `${num(b.amount)} ${b.currency}${b.currency !== 'UZS' ? ` × ${num(b.currency_amount)}` : ''}`
            : '';
        pushHistory('brutto', text(cash.brutto), text(values));
        if (cash.brutto) {
          await bruttoRepo.update({ id: cash.brutto.id }, values);
        } else {
          const brutto = await bruttoRepo.save(values);
          await cashRepo.update(id, { brutto: { id: brutto.id } });
        }
      }

      if (history.length) {
        await manager.getRepository(History).save(
          history.map((h) => ({
            ...h,
            user: { id: user.id },
            cash: { id },
          })),
        );
      }

      if (statusChanged) {
        await manager.getRepository(CashStatusHistory).save({
          status: body.status!,
          cash: { id },
          changedByUser: { id: user.id },
        });
      }

      // Haqiqatan nimadir o'zgargan bo'lsa - qayta tekshiruvga
      const sentBack = reviewAgain && history.length > 0;
      if (sentBack) {
        await this.sendBackToReview(manager, cash, user, 'Xodim tahrirladi');
      }

      return { cash, oldStatus, statusChanged, sentBack };
    });

    if (result.statusChanged) {
      await this.notifyStatusChange(result.cash, body.status!, user, undefined);
    }
    if (result.sentBack) await this.notifyReviewAgain(result.cash);

    return this.getCash(user, id);
  }

  async updateCashStatus(user: UserReq, id: number, body: UpdateCashStatusDto) {
    const cash = await this.findVisibleCash(user, id);
    if (!isAdmin(user.role) && !this.isParticipant(cash, user.id)) {
      throw new ForbiddenException('Bu kassa sizga tegishli emas');
    }
    assertTransition(cash.status, body.status, user.role);

    const comment = body.comment?.trim() || null;
    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(Cash)
        .update({ id }, { status: body.status, updated_at: new Date() });
      await manager.getRepository(History).save({
        name: 'status',
        old_column: cash.status,
        new_column: body.status,
        user: { id: user.id },
        cash: { id },
      });
      await manager.getRepository(CashStatusHistory).save({
        status: body.status,
        comment,
        cash: { id },
        changedByUser: { id: user.id },
      });
    });

    await this.notifyStatusChange(
      cash,
      body.status,
      user,
      comment ?? undefined,
    );
    return this.getCash(user, id);
  }

  private async notifyStatusChange(
    cash: Cash,
    next: CashStatus,
    actor: UserReq,
    comment?: string,
  ) {
    const messages: Partial<Record<CashStatus, string>> = {
      pending_approval: `Xodim kassa ${cashLabel(cash)}ni tasdiqlashga yubordi`,
      approved: `Kassa ${cashLabel(cash)} tasdiqlandi`,
      sent_for_rework: `Kassa ${cashLabel(cash)} qayta ishlashga yuborildi`,
      closed: `Kassa ${cashLabel(cash)} yopildi, tabriklaymiz!`,
      cancelled: `Kassa ${cashLabel(cash)} bekor qilindi`,
    };

    let sms = messages[next];
    if (!sms) return;
    if (comment?.trim()) sms += `\nSabab: ${comment.trim()}`;

    const adminIds = await this.cashNotificationService.adminIds();
    const ownerId = cash.user?.id;

    let recipients: number[];
    if (next === CashStatus.CLOSED || next === CashStatus.CANCELLED) {
      recipients = [...adminIds, ...(ownerId ? [ownerId] : [])];
    } else if (isAdmin(actor.role)) {
      recipients = ownerId ? [ownerId] : [];
    } else {
      recipients = adminIds;
    }

    for (const userId of new Set(recipients)) {
      if (userId === actor.id) continue;
      await this.cashNotificationService.notifyUser(userId, sms);
    }
  }

  /** Kassani "Kutilmoqda" ga qaytaradi va sababini holat tarixiga yozadi (transaction ichida) */
  private async sendBackToReview(
    manager: EntityManager,
    cash: Cash,
    user: UserReq,
    reason: string,
  ) {
    await manager
      .getRepository(Cash)
      .update(
        { id: cash.id },
        { status: CashStatus.PENDING_APPROVAL, updated_at: new Date() },
      );
    await manager.getRepository(History).save({
      name: 'status',
      old_column: cash.status,
      new_column: CashStatus.PENDING_APPROVAL,
      user: { id: user.id },
      cash: { id: cash.id },
    });
    await manager.getRepository(CashStatusHistory).save({
      status: CashStatus.PENDING_APPROVAL,
      comment: reason,
      cash: { id: cash.id },
      changedByUser: { id: user.id },
    });
  }

  /** Rahbarlarga: "Kassa ID 000XX qayta tekshiruvga yuborildi" (bildirishnoma + Telegram) */
  private async notifyReviewAgain(cash: Cash) {
    const sms = `Kassa ID ${formatSeqNo(cash.seq_no)} qayta tekshiruvga yuborildi`;
    await this.cashNotificationService.notifyAdmins(sms, { telegram: true });
  }

  /** Faqat rahbar o'chiradi (soft delete); xodim o'chira olmaydi */
  async deleteCash(user: UserReq, id: number) {
    const cash = await this.findVisibleCash(user, id);
    if (!isAdmin(user.role)) {
      throw new ForbiddenException('Kassani faqat rahbar o‘chira oladi');
    }

    await this.cashRepository.update(
      { id },
      { isDeleted: true, updated_at: new Date() },
    );
    await this.historyRepository.save({
      name: 'cash',
      old_column: cash.cash_number,
      new_column: "o'chirildi",
      user: { id: user.id },
      cash: { id },
    });
    return { success: true };
  }

  async getCashHistory(user: UserReq, id: number) {
    await this.findVisibleCash(user, id);
    const rows = await this.historyRepository.find({
      where: { cash: { id } },
      relations: { user: true },
      order: { created_at: 'DESC', id: 'DESC' },
    });
    return rows.map((h) => ({
      id: h.id,
      name: h.name,
      old_column: h.old_column,
      new_column: h.new_column,
      created_at: h.created_at,
      user: publicUser(h.user),
    }));
  }

  async updateCashEmployeeBonus(
    user: UserReq,
    id: number,
    body: UpdateCashEmployeeBonusDto,
  ) {
    requireAdmin(user);
    await this.findVisibleCash(user, id);
    await this.cashRepository.update({ id }, { is_bonus_taken: body.taken });
    return { id, taken: body.taken };
  }

  async getLastCashes(user: UserReq) {
    const qb = this.cashRepository
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.brutto', 'b')
      .leftJoinAndSelect('c.moneys', 'm')
      .leftJoinAndSelect('c.passengers', 'p')
      .leftJoinAndSelect('c.user', 'u')
      .leftJoinAndSelect('c.additionalUser', 'au')
      .where('c.is_deleted = false')
      .orderBy('c.created_at', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .take(5);
    this.applyScope(qb, user);
    const cashes = await qb.getMany();
    return cashes.map((cash) => {
      const item = this.mapListItem(cash);
      return {
        ...item,
        seq_no: cash.seq_no,
        cash_number: cash.cash_number,
        created_at: cash.created_at,
        bruttoAmount: item.bruttoUzs,
      };
    });
  }

  /** Qaytish sanasi o'tgan tasdiqlangan kassalarni avtomatik yopadi */
  @Cron('0 6 * * *', { timeZone: 'Asia/Tashkent' })
  async checkBaseCash() {
    if (!scheduledJobsEnabled()) return; // test nusxa
    const today = tashkentDate(new Date());
    const candidates = await this.cashRepository.find({
      where: { status: 'approved', isDeleted: false },
    });
    const expired = candidates.filter((c) => {
      const returnDay = tashkentDate(c.return_date);
      return returnDay && returnDay < today;
    });

    for (const cash of expired) {
      try {
        await this.dataSource.transaction(async (manager) => {
          await manager
            .getRepository(Cash)
            .update(
              { id: cash.id },
              { status: 'closed', updated_at: new Date() },
            );
          await manager.getRepository(CashStatusHistory).save({
            status: 'closed',
            comment: "Qaytish sanasi o'tdi - avtomatik yopildi",
            cash: { id: cash.id },
            changedByUser: null,
          });
        });
        await this.cashNotificationService.notifyAdmins(
          `${cashLabel(cash)} kassaning qaytish sanasi o'tib ketdi va kassa avtomatik tarzda yopildi.`,
        );
      } catch (error) {
        this.logger.error(
          `Kassa #${cash.id} ni avtomatik yopishda xato: ${String(error)}`,
        );
      }
    }
  }

  /* =============================== foydalanuvchilar =============================== */

  async getUsers(user: UserReq) {
    requireManager(user);
    const users = await this.userRepository.find({
      where: { isDeleted: false },
      order: { id: 'ASC' },
    });
    return users.map(withRole);
  }

  /** Tanlash ro'yxatlari uchun: faol va o'chirilmagan foydalanuvchilar (barcha rollar) */
  async getUserOptions() {
    const users = await this.userRepository.find({
      where: { isDeleted: false, status: true },
      select: { id: true, firstName: true, lastName: true, type: true },
      order: { firstName: 'ASC' },
    });
    return users.map((u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName ?? null,
      role: u.type,
    }));
  }

  async getMe(user: UserReq) {
    const me = await this.userRepository.findOne({ where: { id: user.id } });
    if (!me) throw new NotFoundException('Foydalanuvchi topilmadi');
    return withRole(me);
  }

  /** Rol qoidasi: ADMIN faqat xodimlarni, SUPERADMIN admin/buxgalter/xodimlarni boshqaradi */
  private assertCanManage(actor: UserReq, targetRole?: string) {
    if (!canManageRole(actor.role, targetRole)) {
      throw new ForbiddenException(
        actor.role === 'ADMIN'
          ? 'Admin faqat xodimlarni qo‘sha va boshqara oladi'
          : 'Ruxsat yo‘q',
      );
    }
  }

  private async assertEmailFree(email: string, excludeId?: number) {
    const exists = await this.userRepository.findOne({
      where: { email, ...(excludeId ? { id: Not(excludeId) } : {}) },
    });
    if (exists) throw new ConflictException('Bu email band');
  }

  /** Username: kichik harfga o'tkaziladi, qoida va noyoblik tekshiriladi. "" - olib tashlash (null) */
  private async prepareUsername(raw: string, excludeId?: number) {
    const username = normalizeUsername(raw);
    if (!username) return null;
    if (!isValidUsername(username)) {
      throw new BadRequestException(
        'Username: lotin harflari, raqamlar, _ va . (3-30 belgi)',
      );
    }
    const qb = this.userRepository
      .createQueryBuilder('u')
      .where('lower(u.username) = :username', { username });
    if (excludeId) qb.andWhere('u.id <> :excludeId', { excludeId });
    // O'chirilgan foydalanuvchining username'i ham band (bazadagi unique index ham shunday)
    if (await qb.getExists()) throw new ConflictException('Bu username band');
    return username;
  }

  /**
   * Login serveri ulangan filialda (K3) xodimlarni boshqarish login serveri orqali o'tadi.
   * Amalni bajaruvchi admin login serverida shu filialga bog'langan bo'lishi kerak.
   */
  private async actorAccountId(actor: UserReq) {
    const me = await this.userRepository.findOne({ where: { id: actor.id } });
    if (!me?.accountId) {
      throw new ForbiddenException(
        'Hisobingiz login serveriga bog‘lanmagan — xodimlarni boshqara olmaysiz',
      );
    }
    return me.accountId;
  }

  /** Bog'langan xodim va filial login serveriga ulangan - o'zgarish login serveri orqali */
  private viaLoginServer(target: User) {
    return !!target.accountId && this.loginServer.enabled();
  }

  async createUser(actor: UserReq, body: CreateUserDto) {
    requireAdmin(actor);
    this.assertCanManage(actor, body.type);
    await this.assertEmailFree(body.email);
    const username = body.username
      ? await this.prepareUsername(body.username)
      : null;
    const fields = {
      firstName: body.firstName,
      lastName: body.lastName,
      hashedPassword: await bcrypt.hash(body.password, 10),
      email: body.email,
      username,
      type: body.type,
      status: body.status !== UserStatus.INACTIVE,
      telegramId: body.telegramId,
      monthlyTarget: body.monthlyTarget ?? null,
    };

    if (!this.loginServer.enabled()) {
      const saved = await this.userRepository.save(fields);
      return this.getMe({ ...actor, id: saved.id });
    }

    // Login serveri orqali: avval filialda (tranzaksiya ichida), keyin login serverida akkaunt.
    // Login serveri rad etsa yoki ishlamasa - filialda ham hech narsa yaratilmaydi.
    if (!username) {
      throw new BadRequestException(
        'Username kerak: xodim login serveri orqali kiradi',
      );
    }
    const actorAccountId = await this.actorAccountId(actor);
    const savedId = await this.dataSource.transaction(async (m) => {
      const repo = m.getRepository(User);
      const saved = await repo.save(fields);
      const { accountId } = await this.loginServer.createAccount({
        username,
        fullName: [body.firstName, body.lastName].filter(Boolean).join(' '),
        role: body.type,
        status: fields.status ? 'active' : 'disabled',
        bcryptHash: fields.hashedPassword,
        localUserId: saved.id,
        actorAccountId,
      });
      await repo.update({ id: saved.id }, { accountId });
      return saved.id;
    });
    return this.getMe({ ...actor, id: savedId });
  }

  async updateUser(actor: UserReq, id: number, body: UpdateUserDto) {
    const target = await this.userRepository.findOne({
      where: { id, isDeleted: false },
    });
    if (!target) throw new NotFoundException('Foydalanuvchi topilmadi');

    const self = id === actor.id;
    if (self) {
      // O'z profili (har qanday rol): faqat ism, email, Telegram. Rol, holat va maqsadni
      // yuqoridagi rol o'zgartiradi; parol - "Parolni o'zgartirish" orqali (joriy parol bilan).
      if (
        body.type !== undefined ||
        body.status !== undefined ||
        body.password !== undefined ||
        body.monthlyTarget !== undefined ||
        body.username !== undefined
      ) {
        throw new ForbiddenException(
          'O‘zingizning rolingiz, holatingiz, maqsadingiz, username yoki parolingizni bu yerda o‘zgartira olmaysiz',
        );
      }
    } else {
      requireAdmin(actor);
      this.assertCanManage(actor, target.type);
      if (body.type !== undefined) this.assertCanManage(actor, body.type);
    }

    const patch: Partial<User> = {};
    if (body.firstName !== undefined) patch.firstName = body.firstName;
    if (body.lastName !== undefined) patch.lastName = body.lastName;
    if (body.type !== undefined) patch.type = body.type;
    if (body.status !== undefined) {
      patch.status = body.status !== UserStatus.INACTIVE;
    }
    if (body.telegramId !== undefined) patch.telegramId = body.telegramId;
    if (body.monthlyTarget !== undefined) {
      patch.monthlyTarget = body.monthlyTarget;
    }
    if (body.email !== undefined && body.email !== target.email) {
      await this.assertEmailFree(body.email, id);
      patch.email = body.email;
    }
    if (body.username !== undefined) {
      const username = await this.prepareUsername(body.username, id);
      if (username !== target.username) patch.username = username;
    }
    const newPassword = body.password?.trim() ? body.password : null;
    if (newPassword) {
      patch.hashedPassword = await bcrypt.hash(newPassword, 10);
    }

    // Login serveriga bog'langan xodim (K3): rol, holat, username va parol login serveri orqali.
    // Ism, email, Telegram, maqsad - faqat filialda.
    const remote: {
      role?: string;
      status?: 'active' | 'disabled';
      username?: string;
    } = {};
    const linked = !self && this.viaLoginServer(target);
    if (linked) {
      if (patch.type !== undefined && patch.type !== target.type) {
        remote.role = patch.type;
      }
      if (patch.status !== undefined && patch.status !== target.status) {
        remote.status = patch.status ? 'active' : 'disabled';
      }
      if (patch.username !== undefined) {
        if (!patch.username) {
          throw new BadRequestException(
            'Login serveriga bog‘langan xodimning username’ini olib tashlab bo‘lmaydi',
          );
        }
        remote.username = patch.username;
      }
    }

    if (Object.keys(patch).length) {
      if (linked && (Object.keys(remote).length || patch.hashedPassword)) {
        const actorAccountId = await this.actorAccountId(actor);
        const accountId = target.accountId!;
        // Login serveri rad etsa yoki ishlamasa - filialdagi o'zgarish ham bekor bo'ladi
        await this.dataSource.transaction(async (m) => {
          await m.getRepository(User).update({ id }, patch);
          if (Object.keys(remote).length) {
            await this.loginServer.updateAccount(accountId, {
              actorAccountId,
              ...remote,
            });
          }
          if (patch.hashedPassword) {
            await this.loginServer.resetPassword(
              accountId,
              patch.hashedPassword,
              actorAccountId,
            );
          }
        });
      } else {
        await this.userRepository.update({ id }, patch);
      }
    }
    // Bloklansa yoki paroli tiklansa - uning barcha kirishlari darhol tugaydi
    if (patch.status === false || patch.hashedPassword) {
      await revokeUserSessions(this.sessionRepository, id);
    }
    return this.getMe({ ...actor, id });
  }

  async deleteUser(actor: UserReq, id: number) {
    requireAdmin(actor);
    if (id === actor.id) {
      throw new BadRequestException("O'zingizni o'chira olmaysiz");
    }
    const target = await this.userRepository.findOne({
      where: { id, isDeleted: false },
    });
    if (!target) throw new NotFoundException('Foydalanuvchi topilmadi');
    this.assertCanManage(actor, target.type);
    if (this.viaLoginServer(target)) {
      // Login serverida faqat shu filialdagi a'zolik olib tashlanadi: boshqa filiallarda kirish
      // ishlashda davom etadi; oxirgi a'zolik bo'lsa akkaunt nofaol bo'ladi
      const actorAccountId = await this.actorAccountId(actor);
      await this.dataSource.transaction(async (m) => {
        await m.getRepository(User).update({ id }, { isDeleted: true });
        await this.loginServer.removeMembership(
          target.accountId!,
          actorAccountId,
        );
      });
    } else {
      await this.userRepository.update({ id }, { isDeleted: true });
    }
    await revokeUserSessions(this.sessionRepository, id);
    return { success: true };
  }

  /** O'z parolini almashtirish: joriy parol tekshiriladi, boshqa qurilmalardagi kirishlar tugaydi */
  async changePassword(user: UserReq, body: ChangePasswordDto) {
    const me = await this.userRepository
      .createQueryBuilder('u')
      .addSelect('u.hashedPassword')
      .where('u.id = :id', { id: user.id })
      .getOne();
    // Login serveriga bog'langan xodim (K2): yagona parol faqat login serverida o'zgaradi
    if (me?.accountId && this.loginServer.enabled()) {
      throw new BadRequestException(
        'Parol login serverida o‘zgartiriladi: Profil → “Parolni o‘zgartirish”',
      );
    }
    const valid =
      !!me?.hashedPassword &&
      (await bcrypt.compare(body.currentPassword, me.hashedPassword));
    // 401 emas: frontend 401 da sessiyani yangilashga urinadi
    if (!valid) throw new BadRequestException('Joriy parol noto‘g‘ri');
    if (body.currentPassword === body.password) {
      throw new BadRequestException(
        'Yangi parol joriy paroldan farq qilishi kerak',
      );
    }

    await this.userRepository.update(
      { id: user.id },
      { hashedPassword: await bcrypt.hash(body.password, 10) },
    );
    await revokeUserSessions(this.sessionRepository, user.id, user.sid);
    return { success: true };
  }

  async getUserCashes(
    actor: UserReq,
    targetUserId: number,
    startDate: string,
    endDate: string,
  ) {
    requireManager(actor);
    const start = parseDate(startDate, 'startDate');
    const end = parseDate(endDate, 'endDate');
    const sharePercent = await this.settingsService.getSharePercent();

    const targetUser = await this.userRepository.findOne({
      where: { id: targetUserId },
    });
    if (!targetUser) throw new NotFoundException('Foydalanuvchi topilmadi');

    const cashes = await this.cashRepository
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.brutto', 'b')
      .leftJoinAndSelect('c.moneys', 'm')
      .leftJoinAndSelect('c.cashServices', 'cs')
      .leftJoinAndSelect('c.additionalUser', 'au')
      .where('c.is_deleted = false')
      .andWhere('(c.user_id = :uid OR c.additional_user = :uid)', {
        uid: targetUserId,
      })
      .andWhere('c.created_at BETWEEN :start AND :end', { start, end })
      .orderBy('c.departure_date', 'ASC')
      .getMany();

    // Barcha holatlar ro'yxatda ko'rinadi, jami summalarga faqat faollari kiradi
    const items = cashes.map((cash) => {
      const active = isActiveStatus(cash.status);
      return {
        id: cash.id,
        seqNo: cash.seq_no,
        cashNumber: cash.cash_number,
        destination: cash.destination,
        departureDate: cash.departure_date,
        status: cash.status,
        brutto: getBrutto(cash),
        netto: getNetto(cash),
        profit: getProfit(cash),
        debt: getDebt(cash),
        bonus: active ? getBonus(cash, sharePercent) : 0,
        bonusTaken: cash.is_bonus_taken,
        active,
      };
    });
    const activeItems = items.filter((i) => i.active);
    const sum = (key: 'profit' | 'brutto' | 'netto' | 'debt') =>
      activeItems.reduce((s, i) => s + i[key], 0);

    return {
      user: {
        id: targetUser.id,
        firstName: targetUser.firstName,
        lastName: targetUser.lastName,
        monthlyTarget: targetUser.monthlyTarget,
      },
      items,
      totalProfit: sum('profit'),
      totalBonus: activeItems
        .filter((i) => !i.bonusTaken)
        .reduce((s, i) => s + i.bonus, 0),
      totalBrutto: sum('brutto'),
      totalNetto: sum('netto'),
      totalDebt: sum('debt'),
    };
  }

  async findAll(
    params: {
      page: number;
      limit: number;
      userId?: number;
      search?: string;
      from?: string;
      to?: string;
    },
    user: UserReq,
  ) {
    requireAdmin(user);
    const safeLimit = Math.min(Math.max(params.limit || 20, 1), 100);
    const safePage = Math.max(params.page || 1, 1);
    const { userId, search, from, to } = params;

    const qb = this.historyRepository
      .createQueryBuilder('history')
      .leftJoinAndSelect('history.user', 'user')
      .leftJoinAndSelect('history.cash', 'cash')
      .orderBy('history.created_at', 'DESC')
      .addOrderBy('history.id', 'DESC');

    if (userId) qb.andWhere('user.id = :userId', { userId });
    if (search) {
      qb.andWhere(
        '(history.name ILIKE :search OR history.old_column ILIKE :search OR history.new_column ILIKE :search)',
        { search: `%${escapeLike(search)}%` },
      );
    }
    if (from) {
      qb.andWhere('history.created_at >= :from', {
        from: parseDate(from, 'from'),
      });
    }
    if (to) {
      const toDate = parseDate(to, 'to');
      toDate.setHours(23, 59, 59, 999);
      qb.andWhere('history.created_at <= :to', { to: toDate });
    }

    const [items, total] = await qb
      .skip((safePage - 1) * safeLimit)
      .take(safeLimit)
      .getManyAndCount();

    return {
      items: items.map(({ cash, user: u, ...item }) => ({
        ...item,
        user: publicUser(u),
        seqNo: cash?.seq_no ?? null,
        cashNumber: cash?.cash_number ?? null,
      })),
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  /* ========================== xizmat turlari / katalog ========================== */

  async getCompanyTypeById(
    user: UserReq,
    id: number,
    range: OptionalDateRangeDto,
  ) {
    // Summaga cancelled va o'chirilgan kassalar kirmaydi; xodimga faqat o'z kassalari
    const conditions = [
      `cash.is_deleted = false`,
      `cash.status <> 'cancelled'`,
    ];
    const params: Record<string, unknown> = {};
    const start = parseDate(range.startDate, 'startDate', true);
    const end = parseDate(range.endDate, 'endDate', true);
    if (start) {
      conditions.push('cash.created_at >= :startDate');
      params.startDate = start;
    }
    if (end) {
      conditions.push('cash.created_at <= :endDate');
      params.endDate = end;
    }
    if (!canViewAll(user.role)) {
      conditions.push(
        '(cash.user_id = :scopeUserId OR cash.additional_user = :scopeUserId)',
      );
      params.scopeUserId = user.id;
    }

    const rows = await this.serviceRepository
      .createQueryBuilder('service')
      .leftJoin('service.serviceType', 'serviceType')
      .leftJoin('service.partner', 'partner')
      .leftJoin('service.cashServices', 'cashService')
      .leftJoin('cashService.cash', 'cash', conditions.join(' AND '), params)
      .where('serviceType.id = :id', { id })
      .andWhere('service.is_active = true')
      .select('service.id', 'id')
      .addSelect('service.name', 'name')
      .addSelect('service.company_name', 'company_name')
      .addSelect('partner.id', 'partnerId')
      .addSelect(
        `COALESCE(SUM(CASE
            WHEN "cash"."id" IS NULL THEN 0
            WHEN "cashService"."currency" = 'UZS' THEN "cashService"."service_amount"
            ELSE "cashService"."service_amount" * "cashService"."currency_amount"
          END), 0)`,
        'totalPrice',
      )
      .groupBy('service.id')
      .addGroupBy('service.name')
      .addGroupBy('service.company_name')
      .addGroupBy('partner.id')
      .orderBy('service.company_name', 'ASC')
      .getRawMany<Record<string, string>>();

    return rows.map((r) => ({
      id: num(r.id),
      name: r.name,
      company_name: r.company_name,
      partnerId: r.partnerId ? num(r.partnerId) : null,
      totalPrice: num(r.totalPrice),
    }));
  }

  getCompanyType() {
    return this.serviceTypeRepository.find({
      where: { is_active: true },
      order: { id: 'ASC' },
    });
  }

  selectService(user: UserReq) {
    requireAdmin(user);
    return this.serviceTypeRepository.find();
  }

  createServiceType(user: UserReq, body: CreateServiceTypeDto) {
    requireAdmin(user);
    return this.serviceTypeRepository.save({
      name: body.name,
      color: body.color,
    });
  }

  createServiceCompany(user: UserReq, body: CreateServiceCompanyDto) {
    requireAdmin(user);
    return this.dataSource.transaction(async (manager) => {
      const partner = await findOrCreatePartner(manager, body.company_name);
      return manager.getRepository(Service).save({
        company_name: body.company_name,
        name: body.name,
        serviceType: { id: body.service_type_id },
        partner: partner ? { id: partner.id } : null,
      });
    });
  }

  deleteService(user: UserReq, id: number) {
    requireAdmin(user);
    return this.serviceRepository.update({ id }, { is_active: false });
  }

  deleteServiceType(user: UserReq, id: number) {
    requireAdmin(user);
    return this.serviceTypeRepository.update({ id }, { is_active: false });
  }
}
