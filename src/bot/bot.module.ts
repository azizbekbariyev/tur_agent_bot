import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Money } from './models/money';
import { Service } from './models/service';
import { Passenger } from './models/passenger';
import { Cash } from './models/cash';
import { User } from './models/user';
import { History } from './models/history';
import { Notification } from './models/notification';
import { BotUpdate } from './bot.update';
import { JwtService } from '@nestjs/jwt';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Money,
      Service,
      Passenger,
      Cash,
      User,
      History,
      Notification,
    ]),
  ],
  controllers: [],
  providers: [BotService, BotUpdate, JwtService],
  exports: [BotService],
})
export class BotModule {}
