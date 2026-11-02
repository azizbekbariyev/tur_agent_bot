import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/bot/models/user';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserToken } from 'src/types/token.type';
import * as bcrypt from 'bcrypt';
import { type Request, type Response } from 'express';
import { createHash } from 'crypto';
import { BotService } from '../bot/bot.service';
import { frontendUrl } from '../common/roles';

const ACCESS_COOKIE_MAX_AGE = 15 * 60 * 1000; // 15 daqiqa
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 kun
const RESET_TOKEN_TTL = 30 * 60; // 30 daqiqa, soniyada

/** Parol o'zgarsa tiklash havolasi yaroqsiz bo'ladi (bir martalik) */
const passwordStamp = (hash: string) =>
  createHash('sha256').update(hash).digest('hex').slice(0, 16);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly botService: BotService,
  ) {}

  private resetSecret() {
    return (
      this.configService.get<string>('RESET_TOKEN_KEY') ||
      `${this.configService.getOrThrow<string>('ACCESS_TOKEN_KEY')}:reset`
    );
  }

  /** Hashlangan parol bilan (oddiy so'rovlarda u select qilinmaydi) */
  private findWithPassword(where: { email?: string; id?: number }) {
    const qb = this.userRepository
      .createQueryBuilder('u')
      .addSelect('u.hashedPassword');
    if (where.email) qb.where('u.email = :email', { email: where.email });
    if (where.id) qb.where('u.id = :id', { id: where.id });
    return qb.getOne();
  }

  private assertActive(user: User | null): asserts user is User {
    if (!user || user.isDeleted || !user.status) {
      throw new UnauthorizedException(
        'Foydalanuvchi topilmadi yoki bloklangan',
      );
    }
  }

  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
  ) {
    const isProd = this.configService.get('NODE_ENV') === 'production';

    res.cookie('access_token', accessToken, {
      maxAge:
        Number(this.configService.get('ACCESS_TOKEN_TIME')) ||
        ACCESS_COOKIE_MAX_AGE,
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
    });

    res.cookie('refresh_token', refreshToken, {
      maxAge:
        Number(this.configService.get('REFRESH_TOKEN_TIME')) ||
        REFRESH_COOKIE_MAX_AGE,
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
    });
  }

  async validate(req: Request) {
    // 1) Web: cookie'dagi JWT
    const webToken = req.cookies?.['access_token'] as string | undefined;
    if (webToken) {
      const payload = await this.verifyToken<{ id: number }>(
        webToken,
        this.configService.getOrThrow<string>('ACCESS_TOKEN_KEY'),
      );
      return this.findSafeUser(payload.id);
    }

    // 2) Mini app: "Authorization: Bearer <jwt>" (bot /start da bergan token)
    const [scheme, botToken] = (req.headers['authorization'] ?? '').split(' ');
    if (scheme === 'Bearer' && botToken) {
      const payload = await this.verifyToken<{ id: number }>(
        botToken,
        this.configService.getOrThrow<string>('JWT_SECRET'),
      );
      return this.findSafeUser(payload.id);
    }

    throw new UnauthorizedException('Token topilmadi');
  }

  private async findSafeUser(id: number) {
    const user = await this.userRepository.findOne({ where: { id } });
    return this.toSafeUser(user);
  }

  private async verifyToken<T extends object>(
    token: string,
    secret: string,
  ): Promise<T> {
    try {
      return await this.jwtService.verifyAsync<T>(token, { secret });
    } catch {
      throw new UnauthorizedException('Token noto‘g‘ri yoki muddati tugagan');
    }
  }

  // Hashlar User entity'da select: false - bu yerga kelmaydi
  private toSafeUser(user: User | null) {
    this.assertActive(user);
    return { ...user, type: user.type, role: user.type, active: user.status };
  }

  async loginEmailPassword(
    dto: { email: string; password: string },
    res: Response,
  ) {
    const user = await this.findWithPassword({ email: dto.email });

    const validPassword =
      !!user?.hashedPassword &&
      (await bcrypt.compare(dto.password, user.hashedPassword));

    if (!user || !validPassword) {
      throw new UnauthorizedException("Email yoki password noto'g'ri");
    }
    this.assertActive(user);

    const { accessToken, refreshToken } = await this.generateTokenUser(user);
    this.setAuthCookies(res, accessToken, refreshToken);

    return {
      role: user.type,
    };
  }

  async refreshTokens(req: Request, res: Response) {
    const refreshToken = req.cookies?.['refresh_token'] as string | undefined;

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token topilmadi');
    }

    let payload: UserToken;
    try {
      payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.configService.getOrThrow('REFRESH_TOKEN_KEY'),
      });
    } catch {
      throw new UnauthorizedException(
        'Refresh token yaroqsiz yoki muddati tugagan',
      );
    }

    const user = await this.userRepository.findOne({
      where: { id: payload.id },
    });
    this.assertActive(user);

    const { accessToken, refreshToken: newRefreshToken } =
      await this.generateTokenUser(user);
    this.setAuthCookies(res, accessToken, newRefreshToken);

    return { role: user.type };
  }

  logout(res: Response) {
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
    return { success: true };
  }

  /**
   * Email xizmati yo'q - tiklash havolasi foydalanuvchining Telegram'iga yuboriladi.
   * Email mavjudligi oshkor bo'lmasligi uchun javob doim bir xil.
   */
  async forgotPassword(email: string) {
    const user = await this.findWithPassword({ email });
    const base = frontendUrl();
    if (user && !user.isDeleted && user.status && user.telegramId && base) {
      const token = await this.jwtService.signAsync(
        {
          id: user.id,
          purpose: 'reset',
          stamp: passwordStamp(user.hashedPassword ?? ''),
        },
        { secret: this.resetSecret(), expiresIn: RESET_TOKEN_TTL },
      );
      try {
        await this.botService.sendMessage(
          user.telegramId,
          `Parolni tiklash uchun havola (30 daqiqa amal qiladi):\n${base}/reset-password?token=${token}\n\nAgar siz so'ramagan bo'lsangiz, bu xabarni e'tiborsiz qoldiring.`,
        );
      } catch (error) {
        this.logger.warn(`Tiklash havolasi yuborilmadi: ${String(error)}`);
      }
    }
    return { sent: true };
  }

  async resetPassword(token: string, password: string) {
    let payload: { id: number; purpose: string; stamp: string };
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: this.resetSecret(),
      });
    } catch {
      throw new BadRequestException('Havola yaroqsiz yoki muddati tugagan');
    }
    const user = await this.findWithPassword({ id: payload.id });
    if (
      payload.purpose !== 'reset' ||
      !user ||
      user.isDeleted ||
      !user.status ||
      passwordStamp(user.hashedPassword ?? '') !== payload.stamp
    ) {
      throw new BadRequestException('Havola yaroqsiz yoki muddati tugagan');
    }
    await this.userRepository.update(
      { id: user.id },
      { hashedPassword: await bcrypt.hash(password, 10) },
    );
    return { success: true };
  }

  async generateTokenUser(user: User) {
    const payload = {
      id: user.id,
      email: user.email,
      role: user.type,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow('ACCESS_TOKEN_KEY'),
        expiresIn: this.configService.getOrThrow('ACCESS_TOKEN_TIME'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow('REFRESH_TOKEN_KEY'),
        expiresIn: this.configService.getOrThrow('REFRESH_TOKEN_TIME'),
      }),
    ]);

    return { accessToken, refreshToken };
  }
}
