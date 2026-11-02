import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/bot/models/user';
import { JwtService } from '@nestjs/jwt';
import { BotModule } from '../bot/bot.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), BotModule],
  controllers: [AuthController],
  providers: [AuthService, JwtService],
})
export class AuthModule {}
