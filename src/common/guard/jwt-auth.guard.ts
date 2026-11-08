import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { DataSource } from 'typeorm';
import { UserToken } from 'src/types/token.type';
import { UserSession } from '../../bot/models/user_session';
import { isSessionActive } from '../../auth/sessions';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req: Request = context.switchToHttp().getRequest();

    // Faqat web cookie. Telegram mini app uchun Bearer token olib tashlangan (bot faqat eslatmalar uchun).
    const token = req.cookies?.['access_token'] as string | undefined;
    if (!token) throw new UnauthorizedException({ message: 'Token topilmadi' });

    // .env da kalit bo'lmasa bu "token yaroqsiz" emas, konfiguratsiya xatosi bo'lib chiqsin
    const secret = this.configService.getOrThrow<string>('ACCESS_TOKEN_KEY');

    let payload: UserToken;
    try {
      payload = await this.jwtService.verifyAsync<UserToken>(token, { secret });
    } catch {
      throw new UnauthorizedException({
        message: 'Token yaroqsiz yoki muddati tugagan',
      });
    }

    if (!payload.id || !payload.sid) {
      throw new UnauthorizedException({
        message: 'Token ichida foydalanuvchi aniqlanmadi',
      });
    }

    // Sessiya bekor qilingan bo'lsa ("Chiqish", bloklash, parol almashtirish) token ishlamaydi.
    // O'chirilgan/bloklangan foydalanuvchi ham darhol to'xtatiladi; rol bazadan olinadi.
    const session = await this.dataSource.getRepository(UserSession).findOne({
      where: { id: payload.sid },
      relations: { user: true },
    });
    const user = session?.user;
    if (
      !isSessionActive(session) ||
      !user ||
      user.id !== payload.id ||
      user.isDeleted ||
      !user.status
    ) {
      throw new UnauthorizedException({
        message: 'Sessiya tugagan yoki foydalanuvchi bloklangan',
      });
    }

    req['user'] = {
      id: user.id,
      role: user.type,
      telegram_id: user.telegramId,
      sid: payload.sid,
    };
    return true;
  }
}
