import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { AppSetting } from '../bot/models/app_setting';
import { Cash } from '../bot/models/cash';
import { User } from '../bot/models/user';
import { Notification } from '../bot/models/notification';
import { BotModule } from '../bot/bot.module';
import { SettingsService } from './settings.service';
import { SettingsController } from './settings.controller';
import { RemindersService } from './reminders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AppSetting, Cash, User, Notification]),
    BotModule,
  ],
  controllers: [SettingsController],
  providers: [SettingsService, RemindersService, JwtService],
  exports: [SettingsService],
})
export class SettingsModule {}
