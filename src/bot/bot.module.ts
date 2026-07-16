import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Money } from './models/money';
import { Service } from './models/service';
import { Passenger } from './models/passenger';
import { Cash } from './models/cash';
import { User } from './models/user';
import { CashService } from './models/cash_service';
import { PassengerCashMoney } from './models/passanger_cash_money';
import { History } from './models/history';
import { Notification } from './models/notification';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Money,
      Service,
      Passenger,
      Cash,
      User,
      CashService,
      PassengerCashMoney,
      History,
      Notification,
    ]),
  ],
  controllers: [],
  providers: [BotService],
})
export class BotModule {}
