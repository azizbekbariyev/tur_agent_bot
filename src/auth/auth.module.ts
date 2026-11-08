import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/bot/models/user';
import { JwtService } from '@nestjs/jwt';
import { BotModule } from '../bot/bot.module';
import { UserSession } from '../bot/models/user_session';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserSession]), BotModule],
  controllers: [AuthController],
  providers: [AuthService, JwtService],
})
export class AuthModule {}
