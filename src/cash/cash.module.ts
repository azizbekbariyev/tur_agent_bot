import { Module } from '@nestjs/common';
import { CashService } from './cash.service';
import { CashController } from './cash.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cash } from 'src/bot/models/cash';
import { Service } from 'src/bot/models/service';
import { Passenger } from 'src/bot/models/passenger';
import { Money } from 'src/bot/models/money';
import { History } from 'src/bot/models/history';
import { Notification } from 'src/bot/models/notification';
import { JwtService } from '@nestjs/jwt';
import { User } from 'src/bot/models/user';
import { BotModule } from 'src/bot/bot.module';
import { CashServices } from '../bot/models/cash_services';
import { ServiceType } from '../bot/models/service_type';
import { Brutto } from '../bot/models/brutto';
import { CashNotificationService } from './cash-notification.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Cash,
      Service,
      Passenger,
      Money,
      History,
      Notification,
      User,
      ServiceType,
      Brutto,
      CashServices,
    ]),
    BotModule,
  ],
  controllers: [CashController],
  providers: [CashService, JwtService, CashNotificationService],
})
export class CashModule {}
