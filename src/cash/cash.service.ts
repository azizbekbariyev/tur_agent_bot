import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cash } from 'src/bot/models/cash';
import { Service } from 'src/bot/models/service';
import { DataSource, In, Repository } from 'typeorm';
import { Passenger } from 'src/bot/models/passenger';
import { Money } from 'src/bot/models/money';
import { History } from 'src/bot/models/history';
import { Notification } from 'src/bot/models/notification';
import { UserReq } from 'src/types/user.type';
import {
  CashesFilterDto,
  CreateCashDto,
  CreatePaymantDto,
  CreateUserDto,
  DashboardFilterDto,
  UpdateCashDto,
  UpdateCashStatusDto,
  UpdateUserDto,
} from './dto/cash.dto';
import { Between } from 'typeorm';
import { ILike } from 'typeorm';
import { User } from 'src/bot/models/user';
import { BotService } from 'src/bot/bot.service';

type CashStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'due'
  | 'closed'
  | 'cancelled'
  | 'sent_for_rework';

type Role = 'ADMIN' | 'EMPLOYEE';

const TRANSITIONS: Record<CashStatus, Partial<Record<CashStatus, Role[]>>> = {
  draft: {
    pending_approval: ['EMPLOYEE'],
    cancelled: ['EMPLOYEE'],
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
    pending_approval: ['EMPLOYEE'],
    cancelled: ['EMPLOYEE'],
  },
  closed: {
    approved: ['ADMIN'], // qayta ochish
  },
  due: {},
  cancelled: {},
};

@Injectable()
export class CashService {
  constructor(
    @InjectRepository(Cash)
    private readonly cashRepository: Repository<Cash>,
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(Passenger)
    private readonly passengerRepository: Repository<Passenger>,
    @InjectRepository(Money)
    private readonly moneyRepository: Repository<Money>,
    @InjectRepository(History)
    private readonly historyRepository: Repository<History>,
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly botService: BotService,
  ) { }

  async getDashboard(user: UserReq, dto: DashboardFilterDto) {
    const where: any = {
      created_at: Between(new Date(dto.startDate), new Date(dto.endDate)),
    };

    if (user.role === 'EMPLOYEE') {
      where.user = {
        id: user.id,
      };
    }

    const cashes = await this.cashRepository.find({
      where,
      relations: {
        services: true,
        passengers: true,
        moneys: true,
        user: true,
      },
    });

    const totalBrutto = cashes.reduce(
      (sum, cash) => sum + Number(cash.brutto),
      0,
    );

    const totalNetto = cashes.reduce(
      (sum, cash) => sum + Number(cash.netto),
      0,
    );

    return {
      openedCashes: cashes.length,
      soldTours: cashes.filter((cash) => cash.status === 'closed').length,
      totalBrutto: totalBrutto,
      totalNetto: totalNetto,
      totalProfit: +totalBrutto - +totalNetto,
      debtorCashes: cashes.filter(
        (cash) => Number(cash.brutto) - Number(cash.netto) < 0,
      ).length,
      cancelledCashes: cashes.filter(
        (cash) => Number(cash.brutto) - Number(cash.netto) > 0,
      ).length,
      employeeBonus: 0,
    };
  }

  async getCashes(user: UserReq, dto: CashesFilterDto) {
    if (dto.status == 'due') {
      const cashes = await this.cashRepository.find({
        where: {
          user: {
            id: user.id,
          },
        },
        relations: {
          services: true,
          passengers: true,
          moneys: true,
          user: true,
        },
      });

      return cashes.map((cash) => {
        if (Number(cash.brutto) - Number(cash.netto) < 0) {
          return {
            id: cash.id,
            cashNumber: cash.cash_number,
            createdAt: cash.created_at,
            destination: cash.destination,
            status: cash.status,
            passengerCount: cash.turist_count,
            totalAmount: cash.netto,
            totalAmountCurrency: 'USD',
            firstName: cash.user.first_name,
            lastName: cash.user.last_name,
          };
        }
      });
    } else {
      const cashes = await this.cashRepository.find({
        where: {
          ...(user.role !== 'ADMIN' && {
            user: {
              id: user.id,
            },
          }),
          ...(dto.cashNumber && {
            cash_number: ILike(`${dto.cashNumber}%`),
          }),
          ...(dto.status &&
            dto.status !== 'ALL' && {
            status: dto.status,
          }),
        },
        relations: {
          services: true,
          passengers: true,
          moneys: true,
          user: true,
        },
      });

      return cashes.map((cash) => {
        return {
          id: cash.id,
          cashNumber: cash.cash_number,
          createdAt: cash.created_at,
          destination: cash.destination,
          status: cash.status,
          passengerCount: cash.turist_count,
          totalAmount: cash.netto,
          totalAmountCurrency: 'USD',
          firstName: cash.user.first_name,
          lastName: cash.user.last_name,
        };
      });
    }
  }

  async createCash(user: UserReq, body: CreateCashDto) {
    const cashId = await this.dataSource.transaction(async (manager) => {
      const cashRepo = manager.getRepository(Cash);
      const moneyRepo = manager.getRepository(Money);
      const serviceRepo = manager.getRepository(Service);
      const passengerRepo = manager.getRepository(Passenger);

      const exchangeRate = 12800;

      const brutto = body.moneys.reduce((sum, money) => {
        const amountInUsd =
          money.currency === 'UZS' ? money.amount / exchangeRate : money.amount;

        return sum + amountInUsd;
      }, 0);

      const netto = body.services
        .map((s) => s.amount)
        .reduce((sum, amount) => sum + amount, 0);

      const cash = await cashRepo.save({
        cash_number: body.cash_number,
        additional_user: body.additional_user,
        destination: body.destination,
        departure_date: body.departure_date,
        return_date: body.return_date,
        comment: body.comment,
        turist_count: body.turist_count,
        status: body.status,
        brutto: String(brutto),
        netto: String(netto),
        user: { id: user.id },
      });

      await Promise.all(
        body.services.map((service) =>
          serviceRepo.save({
            company_name: service.company_name,
            name: service.name,
            amount: String(service.amount),
            code: service.code,
            cash: { id: cash.id },
          }),
        ),
      );

      await Promise.all(
        body.moneys.map((money) =>
          moneyRepo.save({
            money_received: money.amount,
            currency: money.currency,
            type: money.payment_type,
            cash: { id: cash.id },
          }),
        ),
      );

      await Promise.all(
        body.passengers.map((passenger) =>
          passengerRepo.save({
            first_name: passenger.first_name,
            last_name: passenger.last_name,
            phone_number: passenger.phone_number,
            cash: { id: cash.id },
          }),
        ),
      );

      return cash.id; // faqat id qaytaramiz, tranzaksiya shu yerda commit bo'ladi
    });

    // tranzaksiya commit bo'lgandan KEYIN, asosiy connection bilan o'qiymiz
    return this.getCash(user, cashId);
  }

  getCash(user: UserReq, id: number) {
    return this.cashRepository.findOne({
      where: {
        ...(user.role !== 'ADMIN' && {
          user: {
            id: user.id,
          },
        }),
        id: id,
      },
      relations: {
        services: true,
        passengers: true,
        moneys: true,
        user: true,
      },
    });
  }

  async createPaymant(user: UserReq, id: number, body: CreatePaymantDto) {
    const userDb = await this.userRepository.findOne({
      where: { id: user.id },
    });
    if (!userDb) {
      throw new Error('User not found');
    }
    const cash = await this.cashRepository.findOne({
      where: { id: id, user: { id: user.id } },
    });
    if (!cash) {
      throw new Error('Cash not found');
    }
    const exchangeRate = 12800;
    const amountInUsd =
      body.currency === 'UZS' ? body.amount / exchangeRate : body.amount;
    await this.moneyRepository.save({
      type: body.type,
      money_received: body.amount,
      currency: body.currency,
      cash: {
        id: id,
      },
    });

    await this.cashRepository.update(
      {
        id: id,
      },
      {
        brutto: String(Number(cash.brutto) + amountInUsd),
        status: 'draft',
      },
    );
    return {};
  }

  async updateCash(user: UserReq, id: number, body: UpdateCashDto) {
    const userDb = await this.userRepository.findOne({
      where: { id: user.id },
    });
    if (!userDb) {
      throw new Error('User not found');
    }

    return this.dataSource.transaction(async (manager) => {
      const cashRepo = manager.getRepository(Cash);
      const passengerRepo = manager.getRepository(Passenger);
      const serviceRepo = manager.getRepository(Service);
      const moneyRepo = manager.getRepository(Money);
      const historyRepo = manager.getRepository(History);

      const cash = await cashRepo.findOne({ where: { id } });
      if (!cash) {
        throw new Error('Cash not found');
      }

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
        if (oldStr === newStr) return; // o'zgarish bo'lmasa yozmaymiz
        historyEntries.push({ name, old_column: oldStr, new_column: newStr });
      };

      // ---- Passengers: o'chirish (avval eski qiymatlarni o'qib olamiz) ----
      if (body.deletedPassengerIds?.length) {
        const toDelete = await passengerRepo.find({
          where: { id: In(body.deletedPassengerIds), cash: { id } },
        });
        for (const p of toDelete) {
          pushHistory(
            `passenger #${p.id} o'chirildi`,
            `${p.first_name} ${p.last_name} / ${p.phone_number}`,
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
                before.first_name,
                p.first_name,
              );
              pushHistory(
                `passenger #${p.id} last_name`,
                before.last_name,
                p.last_name,
              );
              pushHistory(
                `passenger #${p.id} phone_number`,
                before.phone_number,
                p.phone_number,
              );
            }
            await passengerRepo.update(
              { id: p.id, cash: { id } },
              {
                first_name: p.first_name,
                last_name: p.last_name,
                phone_number: p.phone_number,
              },
            );
          } else {
            const created = passengerRepo.create({
              first_name: p.first_name,
              last_name: p.last_name,
              phone_number: p.phone_number,
              cash,
            });
            const saved = await passengerRepo.save(created);
            pushHistory(
              `passenger #${saved.id} qo'shildi`,
              '—',
              `${saved.first_name} ${saved.last_name} / ${saved.phone_number}`,
            );
          }
        }
      }

      // ---- Services: o'chirish ----
      if (body.deletedServiceIds?.length) {
        const toDelete = await serviceRepo.find({
          where: { id: In(body.deletedServiceIds), cash: { id } },
        });
        for (const s of toDelete) {
          pushHistory(
            `service #${s.id} o'chirildi`,
            `${s.name} / ${s.amount}`,
            '—',
          );
        }
        await serviceRepo.delete({
          id: In(body.deletedServiceIds),
          cash: { id },
        });
      }

      // ---- Services: yangilash yoki yaratish ----
      if (body.services?.length) {
        for (const s of body.services) {
          if (s.id) {
            const before = await serviceRepo.findOne({
              where: { id: s.id, cash: { id } },
            });
            if (before) {
              pushHistory(`service #${s.id} name`, before.name, s.name);
              pushHistory(
                `service #${s.id} company_name`,
                before.company_name,
                s.company_name,
              );
              pushHistory(
                `service #${s.id} amount`,
                before.amount,
                s.amount.toFixed(2),
              );
              pushHistory(`service #${s.id} code`, before.code, s.code);
            }
            await serviceRepo.update(
              { id: s.id, cash: { id } },
              {
                name: s.name,
                company_name: s.company_name,
                amount: s.amount.toFixed(2),
                code: s.code,
              },
            );
          } else {
            const created = serviceRepo.create({
              name: s.name,
              company_name: s.company_name ?? '',
              amount: s.amount.toFixed(2),
              code: s.code ?? '',
              cash,
            });
            const saved = await serviceRepo.save(created);
            pushHistory(
              `service #${saved.id} qo'shildi`,
              '—',
              `${saved.company_name ? saved.company_name + ' — ' : ''}${saved.name} / ${saved.amount}`,
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
            `money #${m.id} o'chirildi`,
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
                `money #${m.id} amount`,
                before.money_received,
                m.amount,
              );
              pushHistory(
                `money #${m.id} currency`,
                before.currency,
                m.currency,
              );
              pushHistory(
                `money #${m.id} payment_type`,
                before.type,
                m.payment_type,
              );
            }
            await moneyRepo.update(
              { id: m.id, cash: { id } },
              {
                money_received: m.amount,
                type: m.payment_type,
                currency: m.currency,
              },
            );
          } else {
            const created = moneyRepo.create({
              money_received: m.amount,
              type: m.payment_type,
              currency: m.currency,
              cash,
            });
            const saved = await moneyRepo.save(created);
            pushHistory(
              `money #${saved.id} qo'shildi`,
              '—',
              `${saved.money_received} ${saved.currency} / ${saved.type}`,
            );
          }
        }
      }

      // ---- Skalyar maydonlar (kelgan bo'lsagina yangilanadi) ----
      const patch: Partial<Cash> = {};
      if (body.cash_number !== undefined) {
        pushHistory('cash_number', cash.cash_number, body.cash_number);
        patch.cash_number = body.cash_number;
      }
      if (body.additional_user !== undefined) {
        pushHistory(
          'additional_user',
          cash.additional_user,
          body.additional_user,
        );
        patch.additional_user = body.additional_user;
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

      // ---- turist_count / brutto / netto — HAR DOIM avtomatik hisoblanadi ----
      const [finalPassengers, finalServices, finalMoneys] = await Promise.all([
        passengerRepo.find({ where: { cash: { id } } }),
        serviceRepo.find({ where: { cash: { id } } }),
        moneyRepo.find({ where: { cash: { id } } }),
      ]);

      const newTuristCount = finalPassengers.length;
      const newNetto = finalServices
        .reduce((acc, s) => acc + Number(s.amount), 0)
        .toFixed(2);

      const USD_RATE = 12800;
      const newBrutto = finalMoneys
        .reduce((sum, m) => {
          const amount = Number(m.money_received);

          if (m.currency === 'UZS') {
            return sum + amount / USD_RATE;
          }

          return sum + amount; // USD bo'lsa o'zgarmaydi
        }, 0)
        .toFixed(2);

      pushHistory('turist_count', cash.turist_count, newTuristCount);
      pushHistory('brutto', cash.brutto, newBrutto);
      pushHistory('netto', cash.netto, newNetto);

      patch.turist_count = newTuristCount;
      patch.brutto = newBrutto;
      patch.netto = newNetto;
      patch.updated_at = new Date();

      await cashRepo.update(id, patch);

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

      return cashRepo.findOne({
        where: { id },
        relations: {
          user: true,
          passengers: true,
          services: true,
          moneys: true,
        },
      });
    });
  }

  //--------------------------------Admin-----------------------------------//

  getUsers(req: UserReq) {
    if (req.role == 'ADMIN') {
      return this.userRepository.find();
    }
  }

  updateUser(user: UserReq, id: number, body: UpdateUserDto) {
    if (!body.telegramId) {
      return this.userRepository.update(
        {
          id,
        },
        {
          status: body.status == 'INACTIVE' ? false : true,
        },
      );
    } else if (user.role == 'ADMIN') {
      return this.userRepository.update(
        {
          id,
        },
        {
          first_name: body.firstName,
          last_name: body.lastName,
          type: body.role,
          status: body.status == 'INACTIVE' ? false : true,
          phone_number: body.phoneNumber,
          telegram_id: Number(body.telegramId),
        },
      );
    }
  }

  deleteUser(user: UserReq, id: number) {
    if (user.role == 'ADMIN') {
      return this.userRepository.update(
        {
          id,
        },
        {
          is_deleted: true,
        },
      );
    }
  }

  getMe(user: UserReq) {
    return this.userRepository.findOne({
      where: {
        id: user.id,
      },
    });
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

    // Ruxsat yo'q bo'lsa ham frontend kutgan bir xil shakl qaytariladi (bo'sh ro'yxat bilan)
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

    // Diqqat: createQueryBuilder Repository'dan chaqirilishi kerak, DataSource'dan emas
    const qb = this.historyRepository
      .createQueryBuilder('history')
      .leftJoinAndSelect('history.user', 'user')
      .leftJoinAndSelect('history.cash', 'cash')
      .orderBy('history.created_at', 'DESC');

    if (userId) {
      qb.andWhere('user.id = :userId', { userId });
    }

    if (search) {
      qb.andWhere(
        '(history.name ILIKE :search OR history.old_column ILIKE :search OR history.new_column ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    if (from) {
      qb.andWhere('history.created_at >= :from', { from: new Date(from) });
    }

    if (to) {
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      qb.andWhere('history.created_at <= :to', { to: toDate });
    }

    qb.skip((safePage - 1) * safeLimit).take(safeLimit);

    const [items, total] = await qb.getManyAndCount();

    return {
      items,
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

    // faqat cash egasi (xodim) yoki admin o'zgartira oladi
    if (user.role !== 'ADMIN' && cash.user.id !== user.id) {
      throw new ForbiddenException('Bu cash sizga tegishli emas');
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const allowedRoles = TRANSITIONS[cash.status]?.[body.status] as Role[];
    if (!allowedRoles || !allowedRoles.includes(user.role as Role)) {
      throw new BadRequestException(
        `${cash.status} -> ${body.status} o'tishga ruxsat yo'q`,
      );
    }

    await this.cashRepository.update({ id }, { status: body.status });

    await this.notifyStatusChange(cash, body.status, user);

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
  ) {
    const messages: Partial<Record<CashStatus, string>> = {
      pending_approval: `Xodim kassa №${cash.cash_number}ni tasdiqlashga yubordi`,
      approved: `Kassa №${cash.cash_number} tasdiqlandi`,
      sent_for_rework: `Kassa №${cash.cash_number} qayta ishlashga yuborildi`,
      closed: `Kassa №${cash.cash_number} yopildi, tabriklaymiz!`,
      cancelled: `Kassa №${cash.cash_number} bekor qilindi`,
    };

    const sms = messages[next];
    if (!sms) return;

    // Admin harakat qilsa -> xodimga (cash egasiga), xodim harakat qilsa -> barcha adminlarga
    const recipients =
      actor.role === 'ADMIN'
        ? [cash.user.id]
        : (await this.userRepository.find({ where: { type: 'ADMIN' } })).map(
            (a) => a.id,
          );

    for (const userId of recipients) {
      const user = await this.userRepository.findOne({
        where: { id: userId },
      });
      await this.botService.sendMessage(user!.telegram_id, sms);
      await this.notificationRepository.save(
        this.notificationRepository.create({
          sms,
          type: 'cash',
          user: { id: userId },
        }),
      );
    }
  }

  createUser(user: UserReq, body: CreateUserDto) {
    if (user.role !== 'ADMIN') {
      throw new ForbiddenException();
    }
    return this.userRepository.save({
      first_name: body.firstName,
      last_name: body.lastName,
      type: body.role,
      status: body.isActive == 'INACTIVE' ? false : true,
      phone_number: body.phoneNumber,
      telegram_id: Number(body.telegramId),
    });
  }
}
