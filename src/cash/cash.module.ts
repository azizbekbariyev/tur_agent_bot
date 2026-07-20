import { Module } from '@nestjs/common';
import { CashService } from './cash.service';
import { CashController } from './cash.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cash } from 'src/bot/models/cash';
import { Service } from 'src/bot/models/service';
import { CashService as CashServiceRepo } from 'src/bot/models/cash_service';
import { Passenger } from 'src/bot/models/passenger';
import { Money } from 'src/bot/models/money';
import { PassengerCashMoney } from 'src/bot/models/passanger_cash_money';
import { History } from 'src/bot/models/history';
import { Notification } from 'src/bot/models/notification';
import { JwtService } from '@nestjs/jwt';
import { User } from 'src/bot/models/user';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Cash,
      Service,
      CashServiceRepo,
      Passenger,
      Money,
      PassengerCashMoney,
      History,
      Notification,
      User,
    ]),
  ],
  controllers: [CashController],
  providers: [CashService, JwtService],
})
export class CashModule {}
