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
import { User } from '../../bot/models/user';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req: Request = context.switchToHttp().getRequest();
    const { token, secretKey } = this.extractToken(req);

    // .env da kalit bo'lmasa bu "token yaroqsiz" emas, konfiguratsiya xatosi bo'lib chiqsin
    const secret = this.configService.getOrThrow<string>(secretKey);

    let payload: UserToken;
    try {
      payload = await this.jwtService.verifyAsync<UserToken>(token, { secret });
    } catch {
      throw new UnauthorizedException({
        message: 'Token yaroqsiz yoki muddati tugagan',
      });
    }

    if (!payload.id) {
      throw new UnauthorizedException({
        message: 'Token ichida foydalanuvchi aniqlanmadi',
      });
    }

    // O'chirilgan/bloklangan foydalanuvchi token muddati tugaguncha ishlab yurmasin.
    // Rol ham bazadan olinadi - admin rolni o'zgartirsa darhol kuchga kiradi.
    const user = await this.dataSource
      .getRepository(User)
      .findOne({ where: { id: payload.id } });
    if (!user || user.isDeleted || !user.status) {
      throw new UnauthorizedException({
        message: 'Foydalanuvchi topilmadi yoki bloklangan',
      });
    }

    req['user'] = {
      id: user.id,
      role: user.type,
      telegram_id: user.telegramId,
    };
    return true;
  }

  // Web: cookie (ACCESS_TOKEN_KEY). Mini app: "Authorization: Bearer <jwt>" (JWT_SECRET).
  private extractToken(req: Request): { token: string; secretKey: string } {
    const cookieToken = req.cookies?.['access_token'] as string | undefined;
    if (cookieToken)
      return { token: cookieToken, secretKey: 'ACCESS_TOKEN_KEY' };

    const [scheme, bearerToken] = (req.headers['authorization'] ?? '').split(
      ' ',
    );
    if (scheme === 'Bearer' && bearerToken)
      return { token: bearerToken, secretKey: 'JWT_SECRET' };

    throw new UnauthorizedException({ message: 'Token topilmadi' });
  }
}
