import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cash } from 'src/bot/models/cash';
import { Service } from 'src/bot/models/service';
import { CashServices } from 'src/bot/models/cash_services';
import {
  DataSource,
  In,
  LessThan,
  Not,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { Passenger } from 'src/bot/models/passenger';
import { Money } from 'src/bot/models/money';
import { History } from 'src/bot/models/history';
import { UserReq } from 'src/types/user.type';
import {
  CashesFilterDto,
  CashStatus,
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
import { Between } from 'typeorm';
import { ILike } from 'typeorm';
import { User } from 'src/bot/models/user';
import { ServiceType } from '../bot/models/service_type';
import { Brutto } from '../bot/models/brutto';
import { CashNotificationService } from './cash-notification.service';
import {
  getBrutto,
  toUZS,
  roundToNearestThousand,
  getNetto,
  getDebt,
  getProfit,
  getBonus,
} from './cash.utils';
import * as bcrypt from 'bcrypt';

type Role = 'ADMIN' | 'EMPLOYEE';

const TRANSITIONS: Record<CashStatus, Partial<Record<CashStatus, Role[]>>> = {
  draft: {
    pending_approval: ['EMPLOYEE', 'ADMIN'],
    cancelled: ['EMPLOYEE', 'ADMIN'],
  },
  pending_approval: {
    approved: ['ADMIN'],
    sent_for_rework: ['ADMIN'],
    cancelled: ['EMPLOYEE'],
  },
  approved: {
    closed: ['ADMIN'],
    cancelled: ['EMPLOYEE'],
  },
  sent_for_rework: {
    pending_approval: ['EMPLOYEE', 'ADMIN'],
    cancelled: ['EMPLOYEE', 'ADMIN'],
  },
  closed: {
    approved: ['ADMIN'], // qayta ochish
  },
  due: {},
  cancelled: {},
};

const CASH_RELATIONS = {
  cashServices: { service: { serviceType: true } },
  passengers: true,
  moneys: true,
  user: true,
  additionalUser: true,
  brutto: true,
} as const;

@Injectable()
export class CashService {
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
    private readonly dataSource: DataSource,
    @InjectRepository(ServiceType)
    private readonly serviceTypeRepository: Repository<ServiceType>,
    private readonly cashNotificationService: CashNotificationService,
  ) {}

  async getDashboard(user: UserReq, dto: DashboardFilterDto) {
    const where: any = {
      isDeleted: false,
      created_at: Between(new Date(dto.startDate), new Date(dto.endDate)),
    };

    if (user.role === 'EMPLOYEE') {
      where.user = {
        id: user.id,
      };
    }

    const cashes = await this.cashRepository.find({
      where,
      relations: CASH_RELATIONS,
    });

    const active = cashes.filter(
      (c) => c.status !== 'draft' && c.status !== 'cancelled',
    );

    const stats = cashes.reduce(
      (acc, cash) => {
        const isActive = cash.status !== 'draft' && cash.status !== 'cancelled';
        if (isActive) {
          const brutto = getBrutto(cash);
          const netto = getNetto(cash);
          const debt = getDebt(cash);

          acc.totalBrutto += brutto;
          acc.totalNetto += netto;
          acc.debtorSum += debt;
          acc.totalPaid += brutto - debt;

          if (debt > 0.01) acc.debtorCashes++;
        }

        if (
          cash.status === 'draft' ||
          cash.status === 'pending_approval' ||
          cash.status === 'sent_for_rework'
        ) {
          acc.openedCashes++;
        }

        if (cash.status === 'approved' || cash.status === 'closed') {
          acc.soldTours++;
        }

        if (cash.status === 'cancelled') {
          acc.cancelledCashes++;
        }

        if (cash.status === 'closed') {
          acc.closedCashes++;
        }

        return acc;
      },
      {
        openedCashes: 0,
        soldTours: 0,
        totalBrutto: 0,
        totalNetto: 0,
        debtorCashes: 0,
        debtorSum: 0,
        cancelledCashes: 0,
        closedCashes: 0,
        totalPaid: 0,
      },
    );
    const grossProfit = stats.totalBrutto - stats.totalNetto;
    const employeeShare = active.reduce((s, c) => s + getBonus(c), 0);
    const touristCount = active.reduce(
      (s, c) => s + Number(c.turist_count ?? 0),
      0,
    );

    return {
      ...stats,
      totalProfit: grossProfit,
      grossProfit,
      employeeShare,
      netProfit: grossProfit - employeeShare,
      touristCount,
    };
  }

  async getCashes(user: UserReq, dto: CashesFilterDto) {
    const { page, limit, startDate, endDate, userId } = dto;
    const search = dto.cashNumber?.trim();
    const isDueFilter = dto.status === 'due';

    const dateRange =
      startDate && endDate
        ? Between(new Date(startDate), new Date(endDate))
        : undefined;

    const baseWhere = {
      ...(user.role !== 'ADMIN'
        ? { user: { id: user.id } }
        : userId
          ? { user: { id: Number(userId) } }
          : {}),
      ...(dto.status &&
        dto.status !== 'ALL' &&
        !isDueFilter && {
          status: dto.status,
        }),
      ...(dateRange && { created_at: dateRange }),
    };

    const where = search
      ? [
          {
            ...baseWhere,
            cash_number: ILike(`${search}%`),
          },
          {
            ...baseWhere,
            cashServices: {
              code: ILike(`%${search}%`),
            },
          },
          {
            ...baseWhere,
            passengers: {
              firstName: ILike(`%${search}%`),
            },
          },
          {
            ...baseWhere,
            passengers: {
              lastName: ILike(`%${search}%`),
            },
          },
        ]
      : baseWhere;

    const mapCash = (cash: Cash) => ({
      id: cash.id,
      cashNumber: cash.cash_number,
      createdAt: cash.created_at,
      destination: cash.destination,
      status: cash.status,
      passengerCount: cash.turist_count,
      totalAmount: cash.netto,
      totalAmountCurrency: 'UZS',
      brutto: cash.brutto,
      debt: getDebt(cash).toFixed(2),
      firstName: cash.user.firstName,
      lastName: cash.user.lastName,
      passangerNames: cash.passengers?.[0]?.firstName,
      passangerLastNames: cash.passengers?.[0]?.lastName,
      netto: cash.netto,
    });

    if (isDueFilter) {
      const all = await this.cashRepository.find({
        where,
        relations: CASH_RELATIONS,
        order: { created_at: 'DESC' },
      });
      const filtered = all.filter((c) => getDebt(c) > 0.01);

      return {
        data: filtered.slice((page - 1) * limit, page * limit).map(mapCash),
        total: filtered.length,
      };
    }

    const [cashes, total] = await this.cashRepository.findAndCount({
      where,
      relations: CASH_RELATIONS,
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: cashes.map(mapCash),
      total,
    };
  }

  async getCashStatusCounts(
    user: UserReq,
    dto: Pick<
      CashesFilterDto,
      'cashNumber' | 'startDate' | 'endDate' | 'userId'
    >,
  ) {
    const where: any = {
      created_at: Between(new Date(dto.startDate), new Date(dto.endDate)),
      ...(user.role !== 'ADMIN'
        ? { user: { id: user.id } }
        : dto.userId
          ? { user: { id: Number(dto.userId) } }
          : {}),
      ...(dto.cashNumber?.trim() && {
        cash_number: ILike(`${dto.cashNumber.trim()}%`),
      }),
    };

    // faqat getDebt ga kerakli relationlar
    const cashes = await this.cashRepository.find({
      where,
      relations: { brutto: true, moneys: true },
    });

    const counts: Record<string, number> = { hammasi: cashes.length, due: 0 };
    for (const c of cashes) {
      counts[c.status] = (counts[c.status] ?? 0) + 1;
      if (getDebt(c) > 0.01) counts.due++;
    }
    return counts;
  }

  async createCash(user: UserReq, body: CreateCashDto) {
    if (!body.brutto) {
      throw new BadRequestException(
        'Kelishilgan narx (brutto) kiritilishi shart',
      );
    }
    if (!body.services?.length) {
      throw new BadRequestException('Kamida bitta xizmat tanlanishi shart');
    }

    const cashId = await this.dataSource.transaction(async (manager) => {
      const cashRepo = manager.getRepository(Cash);
      const moneyRepo = manager.getRepository(Money);
      const cashServicesRepo = manager.getRepository(CashServices);
      const passengerRepo = manager.getRepository(Passenger);
      const bruttoRepo = manager.getRepository(Brutto);
      const serviceRepo = manager.getRepository(Service);

      // Katalogdagi Service yozuvlari mavjudligini tekshiramiz
      const serviceIds = body.services.map((s) => s.service_id);
      const foundServices = await serviceRepo.find({
        where: { id: In(serviceIds) },
      });
      if (foundServices.length !== new Set(serviceIds).size) {
        throw new BadRequestException('Tanlangan xizmatlardan biri topilmadi');
      }

      // UZS uchun kurs har doim 1 - himoya
      const rateOf = (currency: string, rate: number) =>
        currency === 'UZS' ? 1 : rate;

      // Netto - har bir xizmat o'z valyutasidan so'mga o'tkaziladi
      const netto = roundToNearestThousand(
        body.services.reduce(
          (sum, s) =>
            sum + s.service_amount * rateOf(s.currency, s.currency_amount),
          0,
        ),
      );

      const brutto = await bruttoRepo.save({
        amount: body.brutto.amount.toFixed(2),
        currency: body.brutto.currency,
        currency_amount: rateOf(
          body.brutto.currency,
          body.brutto.currency_amount,
        ),
      });

      const cash = await cashRepo.save({
        cash_number: body.cash_number,
        destination: body.destination,
        departure_date: body.departure_date,
        return_date: body.return_date,
        comment: body.comment,
        turist_count: body.passengers?.length ?? body.turist_count,
        status: body.status,
        netto: netto.toFixed(2),
        user: { id: user.id },
        brutto: { id: brutto.id },
        ...(body.created_at ? { created_at: new Date(body.created_at) } : {}),
        ...(body.additional_user_id
          ? { additionalUser: { id: body.additional_user_id } }
          : {}),
      });

      await Promise.all(
        body.services.map((s) =>
          cashServicesRepo.save({
            code: s.code,
            service_amount: s.service_amount,
            currency: s.currency,
            currency_amount: rateOf(s.currency, s.currency_amount),
            cash: { id: cash.id },
            service: { id: s.service_id },
          }),
        ),
      );

      await Promise.all(
        body.moneys.map((m) =>
          moneyRepo.save({
            money_received: m.money_received,
            currency: m.currency,
            currency_amount: rateOf(m.currency, m.currency_amount),
            type: m.type,
            cash: { id: cash.id },
          }),
        ),
      );

      await Promise.all(
        body.passengers.map((p) =>
          passengerRepo.save({
            firstName: p.firstName,
            lastName: p.lastName,
            phoneNumber: p.phoneNumber,
            cash: { id: cash.id },
          }),
        ),
      );

      return cash.id;
    });

    // Yangi kassa to'g'ridan-to'g'ri tasdiqlashga yuborilgan bo'lsa - adminlarga xabar.
    // Transaction TASHQARISIDA - telegram sekin ishlasa ham transaction ochiq qolmaydi.
    if (body.status === CashStatus.PENDING_APPROVAL) {
      await this.cashNotificationService.notifyAdmins(
        `Yangi kassa №${body.cash_number} yaratildi va tasdiqlashga yuborildi`,
      );
    }

    return this.getCash(user, cashId);
  }

  getCash(user: UserReq, id: number) {
    return this.cashRepository.findOne({
      where: {
        ...(user.role !== 'ADMIN' && {
          user: { id: user.id },
        }),
        id,
      },
      relations: CASH_RELATIONS,
    });
  }

  async createPaymant(user: UserReq, id: number, body: CreatePaymantDto) {
    const userDb = await this.userRepository.findOne({
      where: { id: user.id },
    });
    if (!userDb) {
      throw new NotFoundException('User not found');
    }
    const cash = await this.cashRepository.findOne({
      where: { id, user: { id: user.id } },
      relations: { brutto: true, moneys: true },
    });
    if (!cash) {
      throw new NotFoundException('Cash not found');
    }

    await this.moneyRepository.save({
      type: body.type,
      money_received: body.amount,
      currency: body.currency,
      currency_amount: body.currency_amount,
      cash: { id },
    });

    await this.cashRepository.update({ id }, { status: 'draft' });

    const updatedMoneys = [
      ...cash.moneys,
      {
        currency: body.currency,
        money_received: body.amount,
        currency_amount: body.currency_amount,
      } as Money,
    ];
    const paidAmount = updatedMoneys.reduce((sum, m) => {
      const amount = Number(m.money_received ?? 0);
      const rate = Number(m.currency_amount ?? 0);
      return sum + toUZS(amount, m.currency, rate);
    }, 0);

    const bruttoAmount = Number(cash.brutto?.amount ?? 0);
    const bruttoRate = Number(cash.brutto?.currency_amount ?? 0);
    const brutto = toUZS(bruttoAmount, cash.brutto?.currency, bruttoRate);

    return {
      paidAmount: paidAmount.toFixed(2),
      debt: (brutto - paidAmount).toFixed(2),
    };
  }

  async updateCash(user: UserReq, id: number, body: UpdateCashDto) {
    const userDb = await this.userRepository.findOne({
      where: { id: user.id },
    });
    if (!userDb) {
      throw new NotFoundException('User not found');
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const cashRepo = manager.getRepository(Cash);
      const passengerRepo = manager.getRepository(Passenger);
      const cashServicesRepo = manager.getRepository(CashServices);
      const moneyRepo = manager.getRepository(Money);
      const historyRepo = manager.getRepository(History);
      const bruttoRepo = manager.getRepository(Brutto);

      const cash = await cashRepo.findOne({
        where: { id },
        relations: { brutto: true },
      });
      if (!cash) {
        throw new NotFoundException('Cash not found');
      }

      const oldStatus = cash.status as CashStatus;

      const historyEntries: Array<{
        name: string;
        old_column: string;
        new_column: string;
      }> = [];

      const pushHistory = (name: string, oldVal: unknown, newVal: unknown) => {
        const oldStr =
          // eslint-disable-next-line @typescript-eslint/no-base-to-string
          oldVal === undefined || oldVal === null ? '' : String(oldVal);
        const newStr =
          // eslint-disable-next-line @typescript-eslint/no-base-to-string
          newVal === undefined || newVal === null ? '' : String(newVal);
        if (oldStr === newStr) return;
        historyEntries.push({ name, old_column: oldStr, new_column: newStr });
      };

      const rateOf = (currency: string, rate: number) =>
        currency === 'UZS' ? 1 : rate;

      // ---- Passengers: o'chirish ----
      if (body.deletedPassengerIds?.length) {
        const toDelete = await passengerRepo.find({
          where: { id: In(body.deletedPassengerIds), cash: { id } },
        });
        for (const p of toDelete) {
          pushHistory(
            `passenger #${p.id} o'chirildi`,
            `${p.firstName} ${p.lastName} / ${p.phoneNumber}`,
            '—',
          );
        }
        await passengerRepo.delete({
          id: In(body.deletedPassengerIds),
          cash: { id },
        });
      }

      // ---- Passengers: yangilash yoki yaratish ----
      if (body.passengers?.length) {
        for (const p of body.passengers) {
          if (p.id) {
            const before = await passengerRepo.findOne({
              where: { id: p.id, cash: { id } },
            });
            if (before) {
              pushHistory(
                `passenger #${p.id} first_name`,
                before.firstName,
                p.first_name,
              );
              pushHistory(
                `passenger #${p.id} last_name`,
                before.lastName,
                p.last_name,
              );
              pushHistory(
                `passenger #${p.id} phone_number`,
                before.phoneNumber,
                p.phone_number,
              );
            }
            await passengerRepo.update(
              { id: p.id, cash: { id } },
              {
                firstName: p.first_name,
                lastName: p.last_name,
                phoneNumber: p.phone_number,
              },
            );
          } else {
            const created = passengerRepo.create({
              firstName: p.first_name,
              lastName: p.last_name,
              phoneNumber: p.phone_number,
              cash,
            });
            const saved = await passengerRepo.save(created);
            pushHistory(
              `passenger #${saved.id} qo'shildi`,
              '—',
              `${saved.firstName} ${saved.lastName} / ${saved.phoneNumber}`,
            );
          }
        }
      }

      // ---- CashServices: o'chirish ----
      // DIQQAT: deletedServiceIds bu CashServices.id (junction), Service.id EMAS -
      // katalog yozuvi o'chmaydi, faqat shu Cash'dagi bog'lanish o'chadi.
      if (body.deletedServiceIds?.length) {
        const toDelete = await cashServicesRepo.find({
          where: { id: In(body.deletedServiceIds), cash: { id } },
          relations: { service: true },
        });
        for (const cs of toDelete) {
          pushHistory(
            `xizmat #${cs.id} o'chirildi`,
            `${cs.service?.company_name ?? ''} — ${cs.service?.name ?? ''}`,
            '—',
          );
        }
        await cashServicesRepo.delete({
          id: In(body.deletedServiceIds),
          cash: { id },
        });
      }

      // ---- CashServices: yangilash yoki yaratish ----
      if (body.services?.length) {
        // Katalogda mavjudligini tekshirish (create bilan bir xil himoya)
        const serviceRepo = manager.getRepository(Service);
        const serviceIds = [...new Set(body.services.map((s) => s.service_id))];
        const foundServices = await serviceRepo.find({
          where: { id: In(serviceIds) },
        });
        if (foundServices.length !== serviceIds.length) {
          throw new BadRequestException(
            'Tanlangan xizmatlardan biri topilmadi',
          );
        }

        for (const s of body.services) {
          if (s.id) {
            // service_id ni where'ga QO'SHMAYMIZ - faqat id + cash bo'yicha topamiz
            const before = await cashServicesRepo.findOne({
              where: { id: s.id, cash: { id } },
              relations: { service: true },
            });

            if (!before) {
              throw new NotFoundException(`Xizmat #${s.id} topilmadi`);
            }

            // service_id o'zgargan bo'lsa - relationni yangilaymiz
            if (before.service?.id !== s.service_id) {
              pushHistory(
                `xizmat #${s.id} service_id`,
                before.service?.id,
                s.service_id,
              );
              before.service = { id: s.service_id } as Service;
            }

            pushHistory(
              `xizmat #${s.id} summa`,
              before.service_amount,
              s.service_amount,
            );
            pushHistory(`xizmat #${s.id} valyuta`, before.currency, s.currency);
            pushHistory(
              `xizmat #${s.id} kurs`,
              before.currency_amount,
              rateOf(s.currency, s.currency_amount),
            );
            pushHistory(`xizmat #${s.id} kod`, before.code, s.code);

            before.code = s.code ?? before.code;
            before.service_amount = s.service_amount;
            before.currency = s.currency;
            before.currency_amount = rateOf(s.currency, s.currency_amount);
            await cashServicesRepo.save(before);
          } else {
            const created = cashServicesRepo.create({
              code: s.code,
              service_amount: s.service_amount,
              currency: s.currency,
              currency_amount: rateOf(s.currency, s.currency_amount),
              cash: { id } as Cash, // to'liq entity emas, faqat id yetarli
              service: { id: s.service_id } as Service,
            });
            const saved = await cashServicesRepo.save(created);
            pushHistory(
              `xizmat #${saved.id} qo'shildi`,
              '—',
              `${saved.code ?? ''} / service_id=${s.service_id}`,
            );
          }
        }
      }

      // ---- Moneys: o'chirish ----
      if (body.deletedMoneyIds?.length) {
        const toDelete = await moneyRepo.find({
          where: { id: In(body.deletedMoneyIds), cash: { id } },
        });
        for (const m of toDelete) {
          pushHistory(
            `to'lov #${m.id} o'chirildi`,
            `${m.money_received} ${m.currency} / ${m.type}`,
            '—',
          );
        }
        await moneyRepo.delete({
          id: In(body.deletedMoneyIds),
          cash: { id },
        });
      }

      // ---- Moneys: yangilash yoki yaratish ----
      if (body.moneys?.length) {
        for (const m of body.moneys) {
          if (m.id) {
            const before = await moneyRepo.findOne({
              where: { id: m.id, cash: { id } },
            });
            if (before) {
              pushHistory(
                `to'lov #${m.id} summa`,
                before.money_received,
                m.money_received,
              );
              pushHistory(
                `to'lov #${m.id} valyuta`,
                before.currency,
                m.currency,
              );
              pushHistory(
                `to'lov #${m.id} kurs`,
                before.currency_amount,
                m.currency_amount,
              );
              pushHistory(`to'lov #${m.id} turi`, before.type, m.type);
            }
            await moneyRepo.update(
              { id: m.id, cash: { id } },
              {
                money_received: m.money_received,
                type: m.type,
                currency: m.currency,
                currency_amount: m.currency_amount,
              },
            );
          } else {
            const created = moneyRepo.create({
              money_received: m.money_received,
              type: m.type,
              currency: m.currency,
              currency_amount: m.currency_amount,
              cash,
            });
            const saved = await moneyRepo.save(created);
            pushHistory(
              `to'lov #${saved.id} qo'shildi`,
              '—',
              `${saved.money_received} ${saved.currency} / ${saved.type}`,
            );
          }
        }
      }

      // ---- Skalyar maydonlar ----
      const patch: Partial<Cash> = {};
      if (body.cash_number !== undefined) {
        pushHistory('cash_number', cash.cash_number, body.cash_number);
        patch.cash_number = body.cash_number;
      }
      if (body.created_at !== undefined) {
        pushHistory(
          'created_at (kassa sanasi)',
          cash.created_at?.toISOString(),
          body.created_at,
        );
        patch.created_at = new Date(body.created_at);
      }
      if (body.additional_user_id !== undefined) {
        pushHistory('additional_user_id', undefined, body.additional_user_id);
        (patch as any).additionalUser = { id: body.additional_user_id };
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
      if (body.status !== undefined) {
        pushHistory('status', cash.status, body.status);
        patch.status = body.status;
      }

      // ---- turist_count / netto — avtomatik hisoblanadi ----
      const [finalPassengers, finalCashServices] = await Promise.all([
        passengerRepo.find({ where: { cash: { id } } }),
        cashServicesRepo.find({ where: { cash: { id } } }),
      ]);

      const newTuristCount = finalPassengers.length;

      // Netto - xizmatlar har doim USD deb hisoblanadi
      const newNetto = roundToNearestThousand(
        finalCashServices.reduce((sum, cs) => {
          const rate = cs.currency === 'UZS' ? 1 : Number(cs.currency_amount);
          return sum + Number(cs.service_amount) * rate;
        }, 0),
      ).toFixed(2);

      pushHistory('turist_count', cash.turist_count, newTuristCount);
      pushHistory('netto', cash.netto, newNetto);

      patch.turist_count = newTuristCount;
      patch.netto = newNetto;
      patch.updated_at = new Date();

      await cashRepo.update(id, patch);

      // ---- Brutto — faqat explicit ravishda kelsa o'zgaradi ----
      if (body.brutto) {
        const newBruttoAmount = body.brutto.amount.toFixed(2);
        pushHistory(
          'brutto (kelishilgan narx)',
          cash.brutto?.amount,
          newBruttoAmount,
        );

        if (cash.brutto) {
          await bruttoRepo.update(
            { id: cash.brutto.id },
            {
              amount: newBruttoAmount,
              currency: body.brutto.currency,
              currency_amount: body.brutto.currency_amount,
            },
          );
        } else {
          const brutto = await bruttoRepo.save({
            amount: newBruttoAmount,
            currency: body.brutto.currency,
            currency_amount: body.brutto.currency_amount,
          });
          await cashRepo.update(id, { brutto: { id: brutto.id } });
        }
      }

      // ---- History yozuvlarini saqlash ----
      if (historyEntries.length) {
        const historyRows = historyEntries.map((h) =>
          historyRepo.create({
            name: h.name,
            old_column: h.old_column,
            new_column: h.new_column,
            user: userDb,
            cash: { id },
          }),
        );
        await historyRepo.save(historyRows);
      }

      const updated = await cashRepo.findOne({
        where: { id },
        relations: CASH_RELATIONS,
      });

      return { updated, oldStatus };
    });

    // Edit paytida status pending_approval'ga O'TGAN bo'lsa - adminlarga xabar.
    // oldStatus tekshiruvi muhim: pending kassani shunchaki edit qilsa qayta sms ketmaydi.
    // Transaction TASHQARISIDA yuboriladi.
    if (
      body.status === CashStatus.PENDING_APPROVAL &&
      result.oldStatus !== CashStatus.PENDING_APPROVAL
    ) {
      await this.cashNotificationService.notifyAdmins(
        `Kassa №${result.updated?.cash_number} tasdiqlashga yuborildi`,
      );
    }

    return result.updated;
  }

  //--------------------------------Admin-----------------------------------//

  async getUsers(req: UserReq) {
    const user = await this.userRepository.findOne({ where: { id: req.id } });
    if (!user) {
      return [];
    }
    return this.userRepository.find();
  }

  async updateUser(user: UserReq, id: number, body: UpdateUserDto) {
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException();
    }

    const target = await this.userRepository.findOne({ where: { id } });
    if (!target) {
      throw new NotFoundException('Foydalanuvchi topilmadi');
    }

    const patch: Partial<User> = {};

    if (body.firstName !== undefined) patch.firstName = body.firstName;
    if (body.lastName !== undefined) patch.lastName = body.lastName;
    if (body.type !== undefined) patch.type = body.type;

    if (body.status !== undefined) {
      patch.status = body.status !== UserStatus.INACTIVE;
    }

    if (body.telegramId !== undefined) {
      const telegramId = Number(body.telegramId);
      if (!Number.isSafeInteger(telegramId)) {
        throw new BadRequestException("telegram_id noto'g'ri");
      }
      patch.telegramId = telegramId;
    }

    if (body.email !== undefined && body.email !== target.email) {
      const exists = await this.userRepository.findOne({
        where: { email: body.email, id: Not(id) },
      });
      if (exists) {
        throw new BadRequestException('Bu email band');
      }
      patch.email = body.email;
    }

    if (body.password?.trim()) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      patch.hashedPassword = await bcrypt.hash(body.password, 10);
    }

    if (Object.keys(patch).length === 0) {
      return { affected: 0 };
    }

    return this.userRepository.update({ id }, patch);
  }

  deleteUser(user: UserReq, id: number) {
    if (user.role == 'ADMIN') {
      return this.userRepository.update({ id }, { isDeleted: true });
    }
  }

  getMe(user: UserReq) {
    return this.userRepository.findOne({ where: { id: user.id } });
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
    const userDb = await this.userRepository.findOne({
      where: { id: user.id },
    });

    const safeLimit = Math.min(Math.max(params.limit, 1), 100);
    const safePage = Math.max(params.page, 1);

    if (!userDb || userDb.type !== 'ADMIN') {
      return {
        items: [],
        total: 0,
        page: safePage,
        limit: safeLimit,
        totalPages: 0,
      };
    }

    const { userId, search, from, to } = params;

    const qb = this.historyRepository
      .createQueryBuilder('history')
      .leftJoinAndSelect('history.user', 'user')
      .leftJoinAndSelect('history.cash', 'cash')
      .orderBy('history.created_at', 'DESC');

    if (userId) qb.andWhere('user.id = :userId', { userId });
    if (search) {
      qb.andWhere(
        '(history.name ILIKE :search OR history.old_column ILIKE :search OR history.new_column ILIKE :search)',
        { search: `%${search}%` },
      );
    }
    if (from)
      qb.andWhere('history.created_at >= :from', { from: new Date(from) });
    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      qb.andWhere('history.created_at <= :to', { to: toDate });
    }

    qb.skip((safePage - 1) * safeLimit).take(safeLimit);

    const [items, total] = await qb.getManyAndCount();

    return {
      items: items.map((item) => ({
        ...item,
        cashNumber: item.cash?.cash_number,
      })),
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  async updateCashStatus(user: UserReq, id: number, body: UpdateCashStatusDto) {
    const cash = await this.cashRepository.findOne({
      where: { id },
      relations: { user: true },
    });
    if (!cash) {
      throw new NotFoundException('Cash not found');
    }

    if (user.role !== 'ADMIN' && cash.user.id !== user.id) {
      throw new ForbiddenException('Bu cash sizga tegishli emas');
    }

    const allowedRoles = TRANSITIONS[cash.status as CashStatus]?.[body.status];
    if (!allowedRoles || !allowedRoles.includes(user.role as Role)) {
      throw new BadRequestException(
        `${cash.status} -> ${body.status} o'tishga ruxsat yo'q`,
      );
    }

    await this.cashRepository.update({ id }, { status: body.status });
    await this.notifyStatusChange(cash, body.status, user, body.comment);
    await this.historyRepository.save({
      name: 'cash',
      old_column: cash.status,
      new_column: body.status,
      user: { id: user.id },
      cash: { id },
    });

    return { id, status: body.status };
  }

  private async notifyStatusChange(
    cash: Cash,
    next: CashStatus,
    actor: UserReq,
    comment?: string,
  ) {
    const messages: Partial<Record<CashStatus, string>> = {
      pending_approval: `Xodim kassa №${cash.cash_number}ni tasdiqlashga yubordi`,
      approved: `Kassa №${cash.cash_number} tasdiqlandi`,
      sent_for_rework: `Kassa №${cash.cash_number} qayta ishlashga yuborildi`,
      closed: `Kassa №${cash.cash_number} yopildi, tabriklaymiz!`,
      cancelled: `Kassa №${cash.cash_number} bekor qilindi`,
    };

    let sms = messages[next];
    if (!sms) return;

    if (comment?.trim()) {
      sms += `\nSabab: ${comment.trim()}`;
    }

    const adminIds = (
      await this.userRepository.find({ where: { type: 'ADMIN' } })
    ).map((a) => a.id);

    let recipients: number[];
    if (next === CashStatus.CLOSED || next === CashStatus.CANCELLED) {
      recipients = [...new Set([...adminIds, cash.user.id])];
    } else if (actor.role === 'ADMIN') {
      recipients = [cash.user.id];
    } else {
      recipients = adminIds;
    }

    for (const userId of recipients) {
      await this.cashNotificationService.notifyUser(userId, sms);
    }
  }

  async createUser(user: UserReq, body: CreateUserDto) {
    const hashedPassword = await bcrypt.hash(body.password, 10);
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException();
    }
    const telegramId = body.telegramId?.trim()
      ? Number(body.telegramId.trim())
      : undefined;

    if (telegramId !== undefined && !Number.isSafeInteger(telegramId)) {
      throw new BadRequestException("telegram_id noto'g'ri");
    }
    return this.userRepository.save({
      firstName: body.firstName,
      lastName: body.lastName,
      hashedPassword,
      email: body.email,
      type: body.type,
      status: body.status == UserStatus.INACTIVE ? false : true,
      telegramId: telegramId,
    });
  }

  //--------------------------------ServiceType / Service (katalog)-----------------------------------//

  getCompanyTypeById(user: UserReq, id: number, range: OptionalDateRangeDto) {
    const cashConditions: string[] = [];
    const cashParams: Record<string, string> = {};

    if (range.startDate) {
      cashConditions.push('cash.created_at >= :startDate');
      cashParams.startDate = range.startDate;
    }
    if (range.endDate) {
      cashConditions.push('cash.created_at <= :endDate');
      cashParams.endDate = range.endDate;
    }

    return this.serviceRepository
      .createQueryBuilder('service')
      .leftJoin('service.serviceType', 'serviceType')
      .leftJoin('service.cashServices', 'cashService')
      .leftJoin(
        'cashService.cash',
        'cash',
        cashConditions.length ? cashConditions.join(' AND ') : undefined,
        cashParams,
      )
      .where('serviceType.id = :id', { id }) // id = ServiceType id
      .andWhere('service.is_active = true')
      .select('service.id', 'id')
      .addSelect('service.name', 'name')
      .addSelect('service.company_name', 'company_name')
      .addSelect(
        `COALESCE(
        SUM(
          CASE
            WHEN "cash"."id" IS NULL THEN 0
            WHEN "cashService"."currency" = 'UZS'
              THEN "cashService"."service_amount"
            ELSE "cashService"."service_amount" * "cashService"."currency_amount"
          END
        ),
        0
      )`,
        'totalPrice',
      )
      .groupBy('service.id')
      .addGroupBy('service.name')
      .addGroupBy('service.company_name')
      .orderBy('service.company_name', 'ASC')
      .getRawMany();
  }

  getCompanyType() {
    return this.serviceTypeRepository.find({
      where: { is_active: true },
    });
  }

  selectService(user: UserReq) {
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException();
    }
    return this.serviceTypeRepository.find();
  }

  createServiceType(user: UserReq, body: CreateServiceTypeDto) {
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException();
    }
    return this.serviceTypeRepository.save({
      name: body.name,
      color: body.color,
    });
  }

  createServiceCompany(user: UserReq, body: CreateServiceCompanyDto) {
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException();
    }
    // Endi Service - sof katalog, cash bilan bog'liq emas
    return this.serviceRepository.save({
      company_name: body.company_name,
      name: body.name,
      serviceType: { id: body.service_type_id },
    });
  }

  async getChartData(user: UserReq, dto: DashboardFilterDto) {
    const where: any = {
      created_at: Between(new Date(dto.startDate), new Date(dto.endDate)),
    };

    if (user.role === 'EMPLOYEE') {
      where.user = { id: user.id };
    }

    const cashes = await this.cashRepository.find({
      where,
      relations: CASH_RELATIONS,
    });

    const byMonthMap = new Map<
      string,
      { revenue: number; profit: number; count: number }
    >();
    const byDayMap = new Map<
      string,
      { revenue: number; profit: number; count: number }
    >();

    for (const cash of cashes) {
      const d = new Date(cash.created_at);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      // Brutto va Netto - ikkalasi ham so'mga o'tkazilgan holda (getBrutto/getNetto
      // bilan bir xil mantiq)
      const revenue = getBrutto(cash);
      const profit = getProfit(cash); // Brutto - Netto

      const m = byMonthMap.get(monthKey) ?? { revenue: 0, profit: 0, count: 0 };
      m.revenue += revenue;
      m.profit += profit;
      m.count += 1;
      byMonthMap.set(monthKey, m);

      const dd = byDayMap.get(dayKey) ?? { revenue: 0, profit: 0, count: 0 };
      dd.revenue += revenue;
      dd.profit += profit;
      dd.count += 1;
      byDayMap.set(dayKey, dd);
    }

    // Oy label'lari uchun to'liq oraliqni to'ldiramiz (ma'lumot bo'lmagan
    // oylar ham 0 bilan ko'rinsin - grafik uzilib qolmasin)
    const monthLabels: { label: string; key: string }[] = [];
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    const cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
      const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`;
      const label = cur.toLocaleString('en-US', { month: 'short' });
      monthLabels.push({ label, key });
      cur.setMonth(cur.getMonth() + 1);
    }
    const byMonth = monthLabels.map((m) => {
      const v = byMonthMap.get(m.key) ?? { revenue: 0, profit: 0, count: 0 };
      return {
        label: m.label,
        revenue: Math.round(v.revenue),
        profit: Math.round(v.profit),
        count: v.count,
      };
    });

    const dayLabels: { label: string; key: string }[] = [];
    const dc = new Date(dto.startDate);
    dc.setHours(0, 0, 0, 0);
    while (dc <= end) {
      const key = `${dc.getFullYear()}-${String(dc.getMonth() + 1).padStart(2, '0')}-${String(dc.getDate()).padStart(2, '0')}`;
      const label = String(dc.getDate());
      dayLabels.push({ label, key });
      dc.setDate(dc.getDate() + 1);
    }
    const byDay = dayLabels.map((d) => {
      const v = byDayMap.get(d.key) ?? { revenue: 0, profit: 0, count: 0 };
      return {
        label: d.label,
        revenue: Math.round(v.revenue),
        profit: Math.round(v.profit),
        count: v.count,
      };
    });

    return { byMonth, byDay };
  }

  async getUserCashes(
    actor: UserReq,
    targetUserId: number,
    startDate: string,
    endDate: string,
  ) {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException();
    }

    if (!startDate || !endDate) {
      throw new BadRequestException('startDate va endDate majburiy');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException(
        `Noto'g'ri sana formati: startDate="${startDate}", endDate="${endDate}"`,
      );
    }

    const targetUser = await this.userRepository.findOne({
      where: { id: targetUserId },
    });
    if (!targetUser) {
      throw new NotFoundException('Foydalanuvchi topilmadi');
    }

    const cashes = await this.cashRepository.find({
      where: [
        {
          user: { id: targetUserId },
          created_at: Between(start, end),
        },
        {
          additionalUser: { id: targetUserId },
          created_at: Between(start, end),
        },
      ],
      relations: CASH_RELATIONS,
      order: { departure_date: 'ASC' },
    });

    const items = cashes.map((cash) => {
      const brutto = getBrutto(cash);
      const netto = getNetto(cash);
      const profit = getProfit(cash);
      const debt = getDebt(cash);
      const bonus = getBonus(cash);
      return {
        id: cash.id,
        cashNumber: cash.cash_number,
        destination: cash.destination,
        departureDate: cash.departure_date,
        status: cash.status,
        brutto,
        netto,
        profit,
        debt,
        bonus,
        bonusTaken: cash.is_bonus_taken,
      };
    });

    const totalProfit = items.reduce((sum, i) => sum + i.profit, 0);
    const totalBonus = items
      .filter((i) => !i.bonusTaken)
      .reduce((sum, i) => sum + i.bonus, 0);
    const totalBrutto = items.reduce((sum, i) => sum + i.brutto, 0);
    const totalNetto = items.reduce((sum, i) => sum + i.netto, 0);
    const totalDebt = items.reduce((sum, i) => sum + i.debt, 0);

    return {
      user: {
        id: targetUser.id,
        firstName: targetUser.firstName,
        lastName: targetUser.lastName,
      },
      items,
      totalProfit,
      totalBonus,
      totalBrutto,
      totalNetto,
      totalDebt,
    };
  }

  deleteService(actor: UserReq, id: number) {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException();
    }
    return this.serviceRepository.update({ id }, { is_active: false });
  }

  deleteServiceType(actor: UserReq, id: number) {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException();
    }
    return this.serviceTypeRepository.update({ id }, { is_active: false });
  }

  async deleteCash(actor: UserReq, id: number) {
    if (actor.role !== 'ADMIN') {
      throw new ForbiddenException();
    }

    const cash = await this.cashRepository.findOne({
      where: { id },
      relations: {
        brutto: true,
      },
    });

    if (!cash) {
      throw new NotFoundException('Cash not found');
    }

    await this.dataSource.transaction(async (manager) => {
      // 1. Bolalarini o'chiramiz (cash ga FK bilan bog'langanlar)
      await manager.delete(Money, { cash: { id } });
      await manager.delete(Passenger, { cash: { id } });
      await manager.delete(CashServices, { cash: { id } });
      await manager.delete(History, { cash: { id } });

      // 2. Cash ni o'zini o'chiramiz (brutto_id FK shu jadvalda)
      await manager.delete(Cash, { id });

      // 3. Endi brutto ni o'chirsak bo'ladi
      if (cash.brutto) {
        await manager.delete(Brutto, { id: cash.brutto.id });
      }
    });

    return { success: true };
  }

  async checkBaseCash() {
    const user = await this.userRepository.find({
      where: { type: 'ADMIN' },
    });

    const cashes = await this.cashRepository.find({
      where: {
        return_date: LessThan(new Date().toISOString()),
        status: Not('closed'),
      },
    });

    for (const cash of cashes) {
      await this.cashRepository.update(
        {
          id: cash.id,
        },
        { status: 'closed' },
      );

      if (!user) {
        return;
      } else {
        for (const u of user) {
          await this.cashNotificationService.notifyUser(
            u.id,
            `No ${cash.cash_number} kassaning qaytish sanasi o'tib ketdi. Va kassa avtomatik tarzda yopildi.`,
          );
        }
      }
    }
  }

  getCashHistory(user: UserReq, id: number) {
    return this.historyRepository.find({
      where: { cash: { id } },
      relations: ['user'],
      order: { created_at: 'DESC' },
    });
  }

  updateCashEmployeeBonus(
    user: UserReq,
    id: number,
    body: UpdateCashEmployeeBonusDto,
  ) {
    return this.cashRepository.update({ id }, { is_bonus_taken: body.taken });
  }

  getLastCashes(user: UserReq) {
    return this.cashRepository.find({
      where: {
        user: {
          id: user.role === 'ADMIN' ? user.id : user.id,
        },
      },
      order: {
        created_at: 'DESC',
      },
      take: 5,
    });
  }

  async changePassword(user: UserReq, newPassword: string) {
    const userId = user.id;
    if (!userId) {
      throw new UnauthorizedException('Foydalanuvchi topilmadi');
    }

    return bcrypt.hash(newPassword, 10).then((hashedPassword) => {
      return this.userRepository.update({ id: userId }, { hashedPassword });
    });
  }

  private readonly ADMIN_ROLES = ['ADMIN', 'SUPERADMIN'];

  private isAdmin(user: UserReq) {
    return this.ADMIN_ROLES.includes(user.role);
  }

  // Admin hammasini ko'radi, hodim faqat o'zi ochgan yoki qo'shimcha hodim bo'lgan kassalarni
  private applyScope<T extends SelectQueryBuilder<any>>(
    qb: T,
    user: UserReq,
    alias = 'c',
  ): T {
    if (!this.isAdmin(user)) {
      qb.andWhere(
        `(${alias}.user_id = :scopeUserId OR ${alias}.additional_user = :scopeUserId)`,
        { scopeUserId: user.id },
      );
    }
    return qb;
  }

  // ---- Dashboard SQL bo'laklari (hammasi so'mda) ----
  private readonly BRUTTO_UZS_SQL = `COALESCE(CASE WHEN b.currency = 'UZS' THEN b.amount ELSE b.amount * b.currency_amount END, 0)`;

  // Yalpi foyda = brutto (so'mda) - netto (netto allaqachon so'mda saqlanadi)
  private readonly PROFIT_SQL = `(${this.BRUTTO_UZS_SQL} - c.netto)`;

  // Hodim ulushi: juma (DOW = 5) bo'lsa 25%, aks holda 20%
  private readonly BONUS_SQL = `(CASE
    WHEN c.additional_user IS NOT NULL
      THEN (CASE WHEN EXTRACT(DOW FROM c.created_at) = 5 THEN 0.125 ELSE 0.1 END)
    ELSE (CASE WHEN EXTRACT(DOW FROM c.created_at) = 5 THEN 0.25 ELSE 0.2 END)
  END * ${this.PROFIT_SQL})`;

  async getDashboardCharts(user: UserReq, startDate: Date, endDate: Date) {
    const base = () =>
      this.applyScope(
        this.cashRepository
          .createQueryBuilder('c')
          .leftJoin('c.brutto', 'b')
          .where('c.is_deleted = false')
          .andWhere("c.status NOT IN ('draft','cancelled')")
          .andWhere('c.created_at BETWEEN :startDate AND :endDate', {
            startDate,
            endDate,
          }),
        user,
      );

    const dayExpr = "DATE_TRUNC('day', c.created_at)";
    const n = (v: unknown) => Number(v ?? 0);

    const [dailyRaw, destinationsRaw, employeesRaw] = await Promise.all([
      // Kunlik dinamika
      base()
        .select(`TO_CHAR(${dayExpr}, 'YYYY-MM-DD')`, 'date')
        .addSelect(`COALESCE(SUM(${this.BRUTTO_UZS_SQL}), 0)`, 'brutto')
        .addSelect(`COALESCE(SUM(${this.PROFIT_SQL}), 0)`, 'profit')
        .addSelect('COALESCE(SUM(c.turist_count), 0)', 'tourists')
        .addSelect('COUNT(c.id)', 'cashCount')
        .groupBy(dayExpr)
        .orderBy(dayExpr, 'ASC')
        .getRawMany(),

      // Top yo'nalishlar
      base()
        .select('c.destination', 'name')
        .addSelect('COALESCE(SUM(c.turist_count), 0)', 'tourists')
        .addSelect('COUNT(c.id)', 'cashCount')
        .addSelect(`COALESCE(SUM(${this.BRUTTO_UZS_SQL}), 0)`, 'brutto')
        .addSelect(`COALESCE(SUM(${this.PROFIT_SQL}), 0)`, 'profit')
        .groupBy('c.destination')
        .orderBy('SUM(c.turist_count)', 'DESC')
        .limit(7)
        .getRawMany(),

      // Hodimlar reytingi: faqat admin uchun
      this.isAdmin(user)
        ? base()
            .innerJoin('c.user', 'u')
            .select('u.id', 'id')
            .addSelect(
              "CONCAT(u.firstName, ' ', COALESCE(u.lastName, ''))",
              'name',
            )
            .addSelect('COUNT(c.id)', 'cashCount')
            .addSelect('COALESCE(SUM(c.turist_count), 0)', 'tourists')
            .addSelect(`COALESCE(SUM(${this.BRUTTO_UZS_SQL}), 0)`, 'brutto')
            .addSelect(`COALESCE(SUM(${this.PROFIT_SQL}), 0)`, 'profit')
            .addSelect(`COALESCE(SUM(${this.BONUS_SQL}), 0)`, 'bonus')
            .groupBy('u.id')
            .addGroupBy('u.firstName')
            .addGroupBy('u.lastName')
            .orderBy(`SUM(${this.PROFIT_SQL})`, 'DESC')
            .limit(7)
            .getRawMany()
        : Promise.resolve([]),
    ]);

    // ---- Kunlik qatorni bo'sh kunlar bilan to'ldirish ----
    type DailyRow = {
      date: string;
      brutto: number;
      profit: number;
      tourists: number;
      cashCount: number;
    };

    const dailyRows: DailyRow[] = dailyRaw.map((r) => ({
      date: r.date,
      brutto: n(r.brutto),
      profit: n(r.profit),
      tourists: n(r.tourists),
      cashCount: n(r.cashCount),
    }));

    const dateKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const spanDays =
      Math.ceil((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;

    let daily = dailyRows;
    if (spanDays > 0 && spanDays <= 366) {
      const byDate = new Map(dailyRows.map((r) => [r.date, r]));
      const used = new Set<string>();
      const filled: DailyRow[] = [];

      const cur = new Date(startDate);
      cur.setHours(0, 0, 0, 0);
      while (cur <= endDate) {
        const k = dateKey(cur);
        const row = byDate.get(k);
        if (row) used.add(k);
        filled.push(
          row ?? { date: k, brutto: 0, profit: 0, tourists: 0, cashCount: 0 },
        );
        cur.setDate(cur.getDate() + 1);
      }

      // Server va DB vaqt zonasi farq qilsa ham ma'lumot yo'qolmasin
      for (const r of dailyRows) if (!used.has(r.date)) filled.push(r);
      filled.sort((a, b) => a.date.localeCompare(b.date));
      daily = filled;
    }

    return {
      daily,
      destinations: destinationsRaw.map((r) => ({
        name: r.name,
        tourists: n(r.tourists),
        cashCount: n(r.cashCount),
        brutto: n(r.brutto),
        profit: n(r.profit),
      })),
      employees: employeesRaw.map((r) => ({
        id: n(r.id),
        name: String(r.name ?? '').trim(),
        tourists: n(r.tourists),
        cashCount: n(r.cashCount),
        brutto: n(r.brutto),
        profit: n(r.profit),
        bonus: n(r.bonus),
      })),
    };
  }
}
