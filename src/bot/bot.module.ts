import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './models/user';
import { Client } from './models/client';
import { BotUpdate } from './bot.update';

@Module({
  imports: [TypeOrmModule.forFeature([User, Client])],
  controllers: [],
  providers: [BotService, BotUpdate],
  exports: [BotService],
})
export class BotModule {}
