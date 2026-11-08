import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { OidcController } from './oidc.controller';
import { OidcService } from './oidc.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/bot/models/user';
import { JwtService } from '@nestjs/jwt';
import { BotModule } from '../bot/bot.module';
import { UserSession } from '../bot/models/user_session';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserSession]), BotModule],
  controllers: [AuthController, OidcController],
  providers: [AuthService, OidcService, JwtService],
})
export class AuthModule {}
