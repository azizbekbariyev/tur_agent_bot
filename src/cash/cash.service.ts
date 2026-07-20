import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cash } from 'src/bot/models/cash';
import { Service } from 'src/bot/models/service';
import { Repository } from 'typeorm';
import { Passenger } from 'src/bot/models/passenger';
import { Money } from 'src/bot/models/money';
import { PassengerCashMoney } from 'src/bot/models/passanger_cash_money';
import { History } from 'src/bot/models/history';
import { Notification } from 'src/bot/models/notification';
import { CashService as CashServiceRepo } from 'src/bot/models/cash_service';
import { UserReq } from 'src/types/user.type';
import {
  CashesFilterDto,
  CreateCashDto,
  CreatePaymantDto,
  DashboardFilterDto,
  UpdateUserDto,
} from './dto/cash.dto';
import { Between } from 'typeorm';
import { ILike } from 'typeorm';
import { User } from 'src/bot/models/user';

@Injectable()
export class CashService {
  constructor(
    @InjectRepository(Cash)
    private readonly cashRepository: Repository<Cash>,
    @InjectRepository(CashServiceRepo)
    private readonly cashServiceRepository: Repository<CashServiceRepo>,
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(Passenger)
    private readonly passengerRepository: Repository<Passenger>,
    @InjectRepository(Money)
    private readonly moneyRepository: Repository<Money>,
    @InjectRepository(PassengerCashMoney)
    private readonly passengerCashMoneyRepository: Repository<PassengerCashMoney>,
    @InjectRepository(History)
    private readonly historyRepository: Repository<History>,
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {}

  async getDashboard(user: UserReq, dto: DashboardFilterDto) {
    console.log(dto);
    const cashes = await this.cashServiceRepository.find({
      where: {
        cash: {
          user: {
            id: user.role == 'employee' ? user.id : undefined,
          },
          created_at: Between(new Date(dto.startDate), new Date(dto.endDate)),
        },
      },
      relations: {
        cash: true,
        service: true,
      },
    });

    const totalBrutto = cashes.reduce((sum, cash) => sum + cash.cash.brutto, 0);
    const totalNetto = cashes.reduce((sum, cash) => sum + cash.cash.netto, 0);

    return {
      openedCashes: cashes.length,
      soldTours: cashes.filter((cash) => cash.cash.status === 'closed').length,
      totalBrutto: totalBrutto,
      totalNetto: totalNetto,
      totalProfit: totalBrutto - totalNetto,
      debtorCashes: cashes.filter((cash) =>
        cash.cash.passengers.map((passenger) => passenger.money.type == 'card'),
      ).length,
      cancelledCashes: cashes.filter(
        (cash) => cash.cash.brutto - cash.cash.netto > 0,
      ).length,
      employeeBonus: 0,
    };
  }

  async getCashes(user: UserReq, dto: CashesFilterDto) {
    const cashes = await this.cashRepository.find({
      where: {
        user: {
          id: user.id,
        },
        ...(dto.cashNumber && {
          cash_number: ILike(`${dto.cashNumber}%`),
        }),
        ...(dto.status && {
          status: dto.status,
        }),
      },
    });

    return cashes.map((cash) => {
      return {
        cash_number: cash.cash_number,
        created_at: cash.created_at,
        destination: cash.destination,
        status: cash.status,
        turist_count: cash.turist_count,
      };
    });
  }

  async createCash(user: UserReq, body: CreateCashDto) {
    const cash = await this.cashRepository.save({
      cash_number: body.cashNumber,
      user: {
        id: user.id,
      },
      first_name: body.firstName,
      last_name: body.lastName,
      phone_number: body.phoneNumber,
      destination: body.destination,
      departure_date: body.departureDate,
      return_date: body.returnDate,
      turist_count: body.passengers,
      brutto: body.money,
      comment: body.comment,
      payment_type: body.paymentType,
    });

    await this.cashServiceRepository.save(
      body.services.map((serviceId: number) => ({
        cash: {
          id: cash.id,
        },
        service: {
          id: serviceId,
        },
      })),
    );

    const passenger = await this.passengerRepository.save({
      first_name: body.firstName,
      last_name: body.lastName,
      phone_number: body.phoneNumber,
    });

    const money = await this.moneyRepository.save({
      type: body.paymentType,
      amount: body.money,
      currency: body.currency,
    });

    await this.passengerCashMoneyRepository.save({
      cash: {
        id: cash.id,
      },
      passenger: {
        id: passenger.id,
      },
      money: {
        id: money.id,
      },
    });
  }

  getCash(user: UserReq, id: number) {
    return this.cashRepository.findOne({
      where: {
        user: {
          id: user.id,
        },
        id: id,
      },
      relations: {
        services: {
          service: true,
        },
        passengers: {
          money: true,
          passenger: true,
        },
      },
    });
  }

  // updateCash()

  async createPaymant(user: UserReq, id: number, body: CreatePaymantDto) {
    const money = await this.moneyRepository.save({
      type: body.type,
      moneyReseived: body.moneyReseived,
      currency: body.currency,
    });

    await this.passengerCashMoneyRepository.save({
      cash: {
        id: id,
      },
      money: {
        id: money.id,
      },
    });
  }

  getServices() {
    return this.serviceRepository.find();
  }

  //--------------------------------Admin-----------------------------------//

  getUsers(req: UserReq) {
    if (req.role == 'admin') {
      return this.userRepository.find();
    }
  }

  updateUser(user: UserReq, id: number, body: UpdateUserDto) {
    if (user.role == 'admin') {
      return this.userRepository.update(
        {
          id,
        },
        {
          ...body,
          status: body.isActive,
        },
      );
    }
  }

  deleteUser(user: UserReq, id: number) {
    if (user.role == 'admin') {
      return this.userRepository.delete({
        id,
      });
    }
  }

  getMe(user: UserReq) {
    return this.userRepository.findOne({
      where: {
        id: user.id,
      },
    });
  }
}
