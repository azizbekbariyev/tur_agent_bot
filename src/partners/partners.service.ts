import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Partner } from '../bot/models/partner';
import { PartnerPayment } from '../bot/models/partner_payment';
import {
  PartnerPaymentHistory,
  PaymentChange,
} from '../bot/models/partner_payment_history';
import { Service } from '../bot/models/service';
import { parseDate, tashkentDate } from '../common/date';
import { UserReq } from '../types/user.type';
import { rateOf, toUZS } from '../cash/cash.utils';
import {
  CreatePartnerPaymentDto,
  PartnerPaymentHistoryQueryDto,
  PartnerPaymentsQueryDto,
  PartnerRangeDto,
  UpdatePartnerPaymentDto,
} from './partners.dto';

/**
 * "Boshlang'ich holat": shu lahzagacha (Toshkent 2026-11-01 23:59:59) bo'lgan
 * kassalardagi hamkor xizmatlari to'langan hisoblanadi. Har bir hamkorga bir
 * marta tizim yozuvi (kind = OPENING) yaratiladi.
 */
export const OPENING_CUTOFF = new Date('2026-11-01T23:59:59.999+05:00');
export const OPENING_DATE = '2026-11-01';

/** company_name bo'yicha hamkorni topadi yoki yaratadi (katta-kichik harf farqsiz) */
export async function findOrCreatePartner(
  manager: EntityManager,
  rawName?: string | null,
): Promise<Partner | null> {
  const name = rawName?.trim();
  if (!name) return null;
  const repo = manager.getRepository(Partner);
  const found = await repo
    .createQueryBuilder('p')
    .where('LOWER(TRIM(p.name)) = LOWER(:name)', { name })
    .andWhere('p.is_deleted = false')
    .getOne();
  return found ?? repo.save(repo.create({ name }));
}

const SERVICE_UZS_SQL = `CASE WHEN cs.currency = 'UZS' THEN cs.service_amount ELSE cs.service_amount * cs.currency_amount END`;
const PAYMENT_UZS_SQL = `CASE WHEN pp.currency = 'UZS' THEN pp.amount ELSE pp.amount * pp.currency_amount END`;
// Hamkor balansiga kiradigan kassalar (bekor qilingan va o'chirilganlar kirmaydi)
const ACTIVE_CASH_JOIN = `c.id = cs."cashId" AND c.is_deleted = false AND c.status <> 'cancelled'`;

const round2 = (n: number) => Math.round(n * 100) / 100;

const personOf = (
  u?: { id: number; firstName: string; lastName?: string | null } | null,
) => (u ? { id: u.id, firstName: u.firstName, lastName: u.lastName } : null);

@Injectable()
export class PartnersService implements OnModuleInit {
  private readonly logger = new Logger(PartnersService.name);

  constructor(
    @InjectRepository(Partner)
    private readonly partnerRepository: Repository<Partner>,
    @InjectRepository(PartnerPayment)
    private readonly paymentRepository: Repository<PartnerPayment>,
    @InjectRepository(PartnerPaymentHistory)
    private readonly historyRepository: Repository<PartnerPaymentHistory>,
    private readonly dataSource: DataSource,
  ) {}

  /** Hamkorga bog'lanmagan eski xizmatlarni company_name bo'yicha bog'laydi */
  async onModuleInit() {
    try {
      await this.dataSource.transaction(async (manager) => {
        const services = await manager
          .getRepository(Service)
          .createQueryBuilder('s')
          .where('s.partner_id IS NULL')
          .getMany();
        for (const s of services) {
          const partner = await findOrCreatePartner(manager, s.company_name);
          if (partner) {
            await manager
              .getRepository(Service)
              .update({ id: s.id }, { partner: { id: partner.id } });
          }
        }
        if (services.length) {
          this.logger.log(`${services.length} ta xizmat hamkorlarga bog'landi`);
        }
      });
    } catch (error) {
      this.logger.error(`Hamkorlarni bog'lashda xato: ${String(error)}`);
    }

    try {
      await this.createOpeningBalances();
    } catch (error) {
      this.logger.error(`Boshlang'ich holat yaratilmadi: ${String(error)}`);
    }
  }

  /**
   * Bir martalik: har bir hamkorga "Boshlang'ich holat" yozuvi (summa = OPENING_CUTOFF
   * gacha bo'lgan xizmatlari jami, so'mda). app_setting.partner_opening_at belgisi
   * qayta ishga tushganda (va ikki jarayon bir vaqtda ishlasa ham) dublikat yaratmaydi.
   */
  async createOpeningBalances() {
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO app_setting (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
      );
      const [flag] = await manager.query<{ partner_opening_at: Date | null }[]>(
        `SELECT partner_opening_at FROM app_setting WHERE id = 1 FOR UPDATE`,
      );
      if (flag?.partner_opening_at) return;

      const totals = await manager.query<{ id: number; total: string }[]>(
        `SELECT s.partner_id AS id, SUM(${SERVICE_UZS_SQL}) AS total
         FROM service s
         JOIN cash_services cs ON cs."serviceId" = s.id
         JOIN cash c ON ${ACTIVE_CASH_JOIN}
         WHERE s.partner_id IS NOT NULL AND c.created_at <= $1
         GROUP BY s.partner_id
         HAVING SUM(${SERVICE_UZS_SQL}) > 0`,
        [OPENING_CUTOFF],
      );
      const repo = manager.getRepository(PartnerPayment);
      for (const row of totals) {
        const exists = await repo.count({
          where: { partner: { id: Number(row.id) }, kind: 'OPENING' },
        });
        if (exists) continue;
        await repo.save(
          repo.create({
            partner: { id: Number(row.id) },
            kind: 'OPENING',
            amount: round2(Number(row.total)),
            currency: 'UZS',
            currency_amount: 1,
            type: null,
            date: OPENING_DATE,
            comment: null,
          }),
        );
      }
      await manager.query(
        `UPDATE app_setting SET partner_opening_at = now() WHERE id = 1`,
      );
      this.logger.log(
        `Boshlang'ich holat: ${totals.length} ta hamkor, jami ${Math.round(
          totals.reduce((a, r) => a + Number(r.total), 0),
        )} so'm`,
      );
    });
  }

  list() {
    return this.partnerRepository.find({
      where: { isDeleted: false },
      select: { id: true, name: true },
      order: { name: 'ASC' },
    });
  }

  private range(dto: PartnerRangeDto) {
    const start = parseDate(dto.startDate, 'startDate', true);
    const end = parseDate(dto.endDate, 'endDate', true);
    return {
      start,
      end,
      // To'lov sanasi `date` turida - Toshkent kuniga o'tkazamiz
      startDay: start ? tashkentDate(start) : undefined,
      endDay: end ? tashkentDate(end) : undefined,
    };
  }

  async balance(dto: PartnerRangeDto) {
    const { start, end, startDay, endDay } = this.range(dto);

    // Davrdagi kassalardagi xizmatlar (cancelled va o'chirilgan kassalar kirmaydi)
    const servicesQb = this.partnerRepository
      .createQueryBuilder('p')
      .innerJoin('service', 's', 's.partner_id = p.id')
      .leftJoin('service_type', 'st', 'st.id = s.service_type_id')
      .innerJoin('cash_services', 'cs', 'cs."serviceId" = s.id')
      .innerJoin('cash', 'c', ACTIVE_CASH_JOIN)
      .select('p.id', 'id')
      .addSelect(`COALESCE(SUM(${SERVICE_UZS_SQL}), 0)`, 'services')
      .addSelect(
        `COALESCE(SUM(${SERVICE_UZS_SQL}) FILTER (WHERE c.created_at <= :cutoff), 0)`,
        'preCutoff',
      )
      .setParameter('cutoff', OPENING_CUTOFF)
      .addSelect('COUNT(DISTINCT c.id)', 'cashCount')
      .addSelect(
        'ARRAY_REMOVE(ARRAY_AGG(DISTINCT st.name), NULL)',
        'serviceTypes',
      )
      .where('p.is_deleted = false')
      .groupBy('p.id');
    if (start) servicesQb.andWhere('c.created_at >= :start', { start });
    if (end) servicesQb.andWhere('c.created_at <= :end', { end });

    const paidQb = this.paymentRepository
      .createQueryBuilder('pp')
      .select('pp.partner_id', 'id')
      .addSelect(`COALESCE(SUM(${PAYMENT_UZS_SQL}), 0)`, 'paid')
      .where('pp.is_deleted = false')
      .andWhere("pp.kind = 'PAYMENT'")
      .groupBy('pp.partner_id');
    if (startDay) paidQb.andWhere('pp.date >= :startDay', { startDay });
    if (endDay) paidQb.andWhere('pp.date <= :endDay', { endDay });

    const [partners, servicesRaw, paidRaw, lastRaw, openingRaw] =
      await Promise.all([
        this.partnerRepository.find({ where: { isDeleted: false } }),
        servicesQb.getRawMany<{
          id: number;
          services: string;
          preCutoff: string;
          cashCount: string;
          serviceTypes: string[];
        }>(),
        paidQb.getRawMany<{ id: number; paid: string }>(),
        // Har bir hamkorning eng oxirgi to'lovi (davrdan qat'i nazar)
        this.dataSource.query<
          {
            partner_id: number;
            amount: string;
            currency: string;
            date: string;
            type: string;
          }[]
        >(
          `SELECT DISTINCT ON (partner_id) partner_id, amount, currency, to_char(date, 'YYYY-MM-DD') AS date, type
         FROM partner_payment WHERE is_deleted = false AND kind = 'PAYMENT'
         ORDER BY partner_id, date DESC, id DESC`,
        ),
        // Boshlang'ich holat: summasi va u qoplaydigan (cutoff gacha) xizmatlar jami
        this.dataSource.query<
          {
            partner_id: number;
            amount: string;
            pre_total: string;
            date: string;
          }[]
        >(
          `SELECT o.partner_id, o.amount, to_char(o.date, 'YYYY-MM-DD') AS date,
                COALESCE((
                  SELECT SUM(${SERVICE_UZS_SQL})
                  FROM service s
                  JOIN cash_services cs ON cs."serviceId" = s.id
                  JOIN cash c ON ${ACTIVE_CASH_JOIN}
                  WHERE s.partner_id = o.partner_id AND c.created_at <= $1
                ), 0) AS pre_total
         FROM (
           SELECT partner_id, SUM(${PAYMENT_UZS_SQL}) AS amount, MIN(date) AS date
           FROM partner_payment pp
           WHERE is_deleted = false AND kind = 'OPENING'
           GROUP BY partner_id
         ) o`,
          [OPENING_CUTOFF],
        ),
      ]);

    const servicesBy = new Map(servicesRaw.map((r) => [Number(r.id), r]));
    const paidBy = new Map(paidRaw.map((r) => [Number(r.id), Number(r.paid)]));
    const lastBy = new Map(lastRaw.map((r) => [Number(r.partner_id), r]));
    const openingBy = new Map(openingRaw.map((r) => [Number(r.partner_id), r]));

    // Boshlang'ich holat davrga ulush bo'yicha kiradi: davrdagi cutoff gacha
    // xizmatlarni qoplaydi (tahrirlangan bo'lsa - mutanosib). Shunda oktyabr kabi
    // eski davrlarda hamkor qarzi 0, "barcha vaqt" uchun esa to'liq summa.
    const openingShare = (partnerId: number, preInRange: number) => {
      const o = openingBy.get(partnerId);
      if (!o) return 0;
      const amount = Number(o.amount);
      const preTotal = Number(o.pre_total);
      if (preTotal > 0) return round2((amount * preInRange) / preTotal);
      const inRange =
        (!startDay || o.date >= startDay) && (!endDay || o.date <= endDay);
      return inRange ? amount : 0;
    };

    const items = partners
      .map((p) => {
        const s = servicesBy.get(p.id);
        const services = Number(s?.services ?? 0);
        const opening = openingShare(p.id, Number(s?.preCutoff ?? 0));
        const paid = round2((paidBy.get(p.id) ?? 0) + opening);
        const last = lastBy.get(p.id);
        return {
          partnerId: p.id,
          name: p.name,
          serviceTypes: s?.serviceTypes ?? [],
          cashCount: Number(s?.cashCount ?? 0),
          services,
          paid,
          // shundan "Boshlang'ich holat" hisobidan
          openingPaid: opening,
          remaining: round2(services - paid),
          lastPayment: last
            ? {
                amount: Number(last.amount),
                currency: last.currency,
                date: last.date,
                type: last.type,
              }
            : null,
        };
      })
      .filter((i) => i.services > 0 || i.paid > 0)
      .sort((a, b) => b.remaining - a.remaining);

    const totals = items.reduce(
      (acc, i) => {
        acc.services += i.services;
        acc.paid += i.paid;
        acc.remaining += i.remaining;
        return acc;
      },
      { services: 0, paid: 0, remaining: 0 },
    );

    return { totals, items };
  }

  async createPayment(
    user: UserReq,
    dto: CreatePartnerPaymentDto,
    receipt?: Express.Multer.File,
  ) {
    const partner = await this.partnerRepository.findOne({
      where: { id: dto.partnerId, isDeleted: false },
    });
    if (!partner) throw new BadRequestException('Hamkor topilmadi');

    if (receipt && !receipt.mimetype.startsWith('image/')) {
      throw new BadRequestException('Chek rasm bo‘lishi kerak');
    }

    const saved = await this.paymentRepository.save(
      this.paymentRepository.create({
        partner: { id: partner.id },
        amount: dto.amount,
        currency: dto.currency,
        currency_amount: rateOf(dto.currency, dto.currency_amount),
        type: dto.type,
        date: dto.date,
        comment: dto.comment?.trim() || null,
        kind: 'PAYMENT',
        receipt: receipt?.buffer ?? null,
        receiptMime: receipt?.mimetype ?? null,
        createdBy: { id: user.id },
      }),
    );
    return this.getPayment(saved.id);
  }

  private mapPayment(p: PartnerPayment) {
    return {
      id: p.id,
      kind: p.kind,
      partnerId: p.partner?.id,
      partnerName: p.partner?.name,
      amount: p.amount,
      currency: p.currency,
      currency_amount: p.currency_amount,
      amountUzs: toUZS(p.amount, p.currency, p.currency_amount),
      type: p.type,
      date: String(p.date).slice(0, 10),
      comment: p.comment,
      hasReceipt: !!p.receiptMime,
      receiptUrl: p.receiptMime ? `/partner-payments/${p.id}/receipt` : null,
      createdAt: p.created_at,
      createdBy: personOf(p.createdBy),
      history: (p.history ?? [])
        .sort((a, b) => a.id - b.id)
        .map((h) => this.mapHistory(h)),
    };
  }

  private mapHistory(h: PartnerPaymentHistory) {
    return {
      id: h.id,
      paymentId: h.payment?.id,
      partnerName: h.payment?.partner?.name,
      kind: h.payment?.kind,
      action: h.action,
      oldAmount: h.oldAmount,
      newAmount: h.newAmount,
      currency: h.payment?.currency,
      changes: h.changes,
      user: personOf(h.user),
      createdAt: h.created_at,
    };
  }

  private async getPayment(id: number) {
    const p = await this.paymentRepository.findOne({
      where: { id },
      relations: { partner: true, createdBy: true, history: { user: true } },
    });
    if (!p) throw new NotFoundException('To‘lov topilmadi');
    return this.mapPayment(p);
  }

  async listPayments(dto: PartnerPaymentsQueryDto) {
    const { startDay, endDay } = this.range(dto);
    const qb = this.paymentRepository
      .createQueryBuilder('pp')
      .leftJoinAndSelect('pp.partner', 'partner')
      .leftJoinAndSelect('pp.createdBy', 'createdBy')
      .leftJoinAndSelect('pp.history', 'h')
      .leftJoinAndSelect('h.user', 'hu')
      .where('pp.is_deleted = false')
      // Boshlang'ich holat faqat balans uchun - oddiy ro'yxat va oylik summaga kirmaydi
      .andWhere('pp.kind = :kind', { kind: dto.kind ?? 'PAYMENT' })
      .orderBy('pp.date', 'DESC')
      .addOrderBy('pp.id', 'DESC');
    if (dto.partnerId) {
      qb.andWhere('pp.partner_id = :partnerId', { partnerId: dto.partnerId });
    }
    if (startDay) qb.andWhere('pp.date >= :startDay', { startDay });
    if (endDay) qb.andWhere('pp.date <= :endDay', { endDay });
    return (await qb.getMany()).map((p) => this.mapPayment(p));
  }

  async getReceipt(id: number) {
    const p = await this.paymentRepository
      .createQueryBuilder('pp')
      .addSelect('pp.receipt')
      .where('pp.id = :id AND pp.is_deleted = false', { id })
      .getOne();
    if (!p?.receipt || !p.receiptMime) throw new NotFoundException('Chek yo‘q');
    return { data: p.receipt, mime: p.receiptMime };
  }

  /** Summa (va boshqa maydonlar) tuzatiladi; har bir o'zgarish tarixga yoziladi */
  async updatePayment(user: UserReq, id: number, dto: UpdatePartnerPaymentDto) {
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PartnerPayment);
      const p = await repo.findOne({
        where: { id, isDeleted: false },
        lock: { mode: 'pessimistic_write' },
      });
      if (!p) throw new NotFoundException('To‘lov topilmadi');

      const next = {
        amount: dto.amount ?? p.amount,
        currency: dto.currency ?? p.currency,
        currency_amount:
          dto.currency_amount !== undefined || dto.currency !== undefined
            ? rateOf(
                dto.currency ?? p.currency,
                dto.currency_amount ?? p.currency_amount,
              )
            : p.currency_amount,
        type: p.kind === 'OPENING' ? null : (dto.type ?? p.type),
        date: dto.date ?? String(p.date).slice(0, 10),
        comment:
          dto.comment !== undefined ? dto.comment.trim() || null : p.comment,
      };
      const before = {
        amount: p.amount,
        currency: p.currency,
        currency_amount: p.currency_amount,
        type: p.type,
        date: String(p.date).slice(0, 10),
        comment: p.comment,
      };
      const changes: Record<string, PaymentChange> = {};
      for (const key of Object.keys(next) as (keyof typeof next)[]) {
        if (before[key] !== next[key]) {
          changes[key] = { old: before[key], new: next[key] };
        }
      }
      if (!Object.keys(changes).length) return;

      await repo.update({ id }, next);
      await manager.getRepository(PartnerPaymentHistory).save({
        payment: { id },
        action: 'UPDATE',
        oldAmount: before.amount,
        newAmount: next.amount,
        changes,
        user: { id: user.id },
      });
    });
    return this.getPayment(id);
  }

  async deletePayment(user: UserReq, id: number) {
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(PartnerPayment);
      const p = await repo.findOne({
        where: { id, isDeleted: false },
        lock: { mode: 'pessimistic_write' },
      });
      if (!p) throw new NotFoundException('To‘lov topilmadi');
      await repo.update({ id }, { isDeleted: true });
      await manager.getRepository(PartnerPaymentHistory).save({
        payment: { id },
        action: 'DELETE',
        oldAmount: p.amount,
        newAmount: null,
        changes: { amount: { old: p.amount, new: null } },
        user: { id: user.id },
      });
    });
    return { success: true };
  }

  /** Tahrir va o'chirishlar jurnali (o'chirilgan to'lovlarniki ham) */
  async listHistory(dto: PartnerPaymentHistoryQueryDto) {
    const qb = this.historyRepository
      .createQueryBuilder('h')
      .leftJoinAndSelect('h.payment', 'pp')
      .leftJoinAndSelect('pp.partner', 'partner')
      .leftJoinAndSelect('h.user', 'u')
      .orderBy('h.created_at', 'DESC')
      .addOrderBy('h.id', 'DESC')
      .take(500);
    if (dto.partnerId) {
      qb.andWhere('pp.partner_id = :partnerId', { partnerId: dto.partnerId });
    }
    if (dto.paymentId) {
      qb.andWhere('pp.id = :paymentId', { paymentId: dto.paymentId });
    }
    return (await qb.getMany()).map((h) => this.mapHistory(h));
  }
}
