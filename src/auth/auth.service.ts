import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/bot/models/user';
import { LessThan, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserToken } from 'src/types/token.type';
import * as bcrypt from 'bcrypt';
import { type Request, type Response } from 'express';
import { createHash, randomUUID } from 'crypto';
import { BotService } from '../bot/bot.service';
import { frontendUrl } from '../common/roles';
import { UserSession } from '../bot/models/user_session';
import { hashToken, isSessionActive, revokeUserSessions } from './sessions';
import { normalizeUsername } from '../common/username';
import { localLoginEnabled } from '../common/flags';

const ACCESS_COOKIE_MAX_AGE = 15 * 60 * 1000; // 15 daqiqa
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 kun
const RESET_TOKEN_TTL = 30 * 60; // 30 daqiqa, soniyada
// Bir nechta tab bir vaqtda refresh qilsa, oldingi refresh token shuncha vaqt qabul qilinadi
const REFRESH_GRACE_MS = 60 * 1000;
// Muddati shundan oldin tugagan sessiyalar bazadan tozalanadi
const SESSION_CLEANUP_MS = 30 * 24 * 60 * 60 * 1000;

/** Parol o'zgarsa tiklash havolasi yaroqsiz bo'ladi (bir martalik) */
const passwordStamp = (hash: string) =>
  createHash('sha256').update(hash).digest('hex').slice(0, 16);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserSession)
    private readonly sessionRepository: Repository<UserSession>,
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
  private findWithPassword(where: {
    email?: string;
    username?: string;
    id?: number;
  }) {
    const qb = this.userRepository
      .createQueryBuilder('u')
      .addSelect('u.hashedPassword');
    if (where.email) qb.where('u.email = :email', { email: where.email });
    if (where.username) {
      qb.where('lower(u.username) = :username', { username: where.username });
    }
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

  private cookieOptions() {
    const isProd = this.configService.get('NODE_ENV') === 'production';
    return { httpOnly: true, secure: isProd, sameSite: 'strict' as const };
  }

  private setAuthCookies(
    res: Response,
    accessToken: string,
    refreshToken: string,
  ) {
    res.cookie('access_token', accessToken, {
      ...this.cookieOptions(),
      maxAge:
        Number(this.configService.get('ACCESS_TOKEN_TIME')) ||
        ACCESS_COOKIE_MAX_AGE,
    });

    res.cookie('refresh_token', refreshToken, {
      ...this.cookieOptions(),
      maxAge:
        Number(this.configService.get('REFRESH_TOKEN_TIME')) ||
        REFRESH_COOKIE_MAX_AGE,
    });
  }

  private clearAuthCookies(res: Response) {
    res.clearCookie('access_token', this.cookieOptions());
    res.clearCookie('refresh_token', this.cookieOptions());
  }

  async validate(req: Request) {
    const token = req.cookies?.['access_token'] as string | undefined;
    if (!token) throw new UnauthorizedException('Token topilmadi');

    const payload = await this.verifyToken<UserToken>(
      token,
      this.configService.getOrThrow<string>('ACCESS_TOKEN_KEY'),
    );
    const session = payload.sid
      ? await this.sessionRepository.findOne({
          where: { id: payload.sid },
          relations: { user: true },
        })
      : null;
    if (!isSessionActive(session) || session!.user?.id !== payload.id) {
      throw new UnauthorizedException('Sessiya tugagan');
    }
    return this.toSafeUser(session!.user);
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

  /** "@" bilan boshlanmasa va ichida "@" bo'lsa - email, aks holda username (harf o'lchami muhim emas) */
  private findByLogin(raw: string) {
    const value = raw.trim();
    if (!value) return null;
    if (!value.startsWith('@') && value.includes('@')) {
      return this.findWithPassword({ email: value });
    }
    return this.findWithPassword({ username: normalizeUsername(value) });
  }

  async loginEmailPassword(
    dto: { login?: string; email?: string; password: string },
    req: Request,
    res: Response,
  ) {
    // LOCAL_LOGIN_ENABLED=false - faqat login serveri orqali (5-bosqich)
    if (!localLoginEnabled()) {
      throw new ForbiddenException(
        'Bu usul o\'chirilgan. "Travance orqali kirish" tugmasidan foydalaning',
      );
    }
    const user = await this.findByLogin(dto.login ?? dto.email ?? '');

    const validPassword =
      !!user?.hashedPassword &&
      (await bcrypt.compare(dto.password, user.hashedPassword));

    if (!user || !validPassword) {
      throw new UnauthorizedException("Login yoki parol noto'g'ri");
    }
    this.assertActive(user);

    await this.openSession(user, req, res);
    return {
      role: user.type,
    };
  }

  /**
   * Yangi sessiya: user_session qatori + cookie'lar. Eski kirish va login serveri orqali
   * kirish uchun bir xil (oidcSid - login serveridagi sessiya id, back-channel logout uchun).
   */
  async openSession(
    user: User,
    req: Request,
    res: Response,
    oidcSid: string | null = null,
  ) {
    this.assertActive(user);

    // Eski, muddati ancha oldin tugagan sessiyalar to'planib qolmasin
    await this.sessionRepository.delete({
      expiresAt: LessThan(new Date(Date.now() - SESSION_CLEANUP_MS)),
    });

    const sid = randomUUID();
    const { accessToken, refreshToken, refreshExpiresAt } =
      await this.generateTokenUser(user, sid);
    await this.sessionRepository.insert({
      id: sid,
      user: { id: user.id },
      refreshHash: hashToken(refreshToken),
      expiresAt: refreshExpiresAt,
      userAgent: (req.headers['user-agent'] ?? '').slice(0, 300) || null,
      ip: (req.ip ?? '').slice(0, 64) || null,
      oidcSid,
    });
    this.setAuthCookies(res, accessToken, refreshToken);
    return sid;
  }

  /**
   * Refresh token har safar almashtiriladi (rotation). Eski token qayta ishlatilsa
   * (o'g'irlangan bo'lishi mumkin) - sessiya bekor qilinadi. Faqat bir nechta tab
   * bir vaqtda yangilagan holat uchun oldingi token REFRESH_GRACE_MS davomida qabul qilinadi.
   */
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

    const session = payload.sid
      ? await this.sessionRepository.findOne({
          where: { id: payload.sid },
          relations: { user: true },
        })
      : null;
    if (!isSessionActive(session) || session!.user?.id !== payload.id) {
      throw new UnauthorizedException('Sessiya tugagan, qayta kiring');
    }
    const s = session!;

    const hash = hashToken(refreshToken);
    const inGrace =
      hash === s.prevRefreshHash &&
      !!s.rotatedAt &&
      Date.now() - s.rotatedAt.getTime() < REFRESH_GRACE_MS;
    if (hash !== s.refreshHash && !inGrace) {
      await this.sessionRepository.update(
        { id: s.id },
        { revokedAt: new Date() },
      );
      this.logger.warn(
        `Eski refresh token qayta ishlatildi - sessiya bekor qilindi (user ${s.user.id})`,
      );
      throw new UnauthorizedException('Sessiya tugagan, qayta kiring');
    }

    const user = s.user;
    this.assertActive(user);

    const {
      accessToken,
      refreshToken: newRefreshToken,
      refreshExpiresAt,
    } = await this.generateTokenUser(user, s.id);
    await this.sessionRepository.update(
      { id: s.id },
      {
        refreshHash: hashToken(newRefreshToken),
        prevRefreshHash: s.refreshHash,
        rotatedAt: new Date(),
        lastUsedAt: new Date(),
        expiresAt: refreshExpiresAt,
      },
    );
    this.setAuthCookies(res, accessToken, newRefreshToken);

    return { role: user.type };
  }

  /** Joriy sessiyani bekor qiladi va cookie'larni o'chiradi */
  async logout(req: Request, res: Response) {
    const sid = await this.sessionIdFromCookies(req);
    let viaLoginServer = false;
    if (sid) {
      const session = await this.sessionRepository.findOne({
        where: { id: sid },
      });
      viaLoginServer = !!session?.oidcSid;
      await this.sessionRepository.update(
        { id: sid },
        { revokedAt: new Date() },
      );
    }
    this.clearAuthCookies(res);
    // Login serveri orqali kirgan bo'lsa, frontend u yerdan ham chiqaradi (umumiy kompyuterlar uchun)
    return { success: true, ssoLogout: viaLoginServer };
  }

  /** Refresh yoki access cookie'dagi sessiya id (imzo tekshiriladi, muddati tugagan bo'lsa ham) */
  private async sessionIdFromCookies(req: Request) {
    const cookies = req.cookies as Record<string, string | undefined>;
    const pairs: [string | undefined, string][] = [
      [cookies?.['refresh_token'], 'REFRESH_TOKEN_KEY'],
      [cookies?.['access_token'], 'ACCESS_TOKEN_KEY'],
    ];
    for (const [token, key] of pairs) {
      if (!token) continue;
      try {
        const payload = await this.jwtService.verifyAsync<UserToken>(token, {
          secret: this.configService.getOrThrow<string>(key),
          ignoreExpiration: true,
        });
        if (payload.sid) return payload.sid;
      } catch {
        // imzosi noto'g'ri - e'tiborsiz
      }
    }
    return null;
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
    // Parol tiklangach eski kirishlar ishlamasin
    await revokeUserSessions(this.sessionRepository, user.id);
    return { success: true };
  }

  async generateTokenUser(user: User, sid: string) {
    const payload = { id: user.id, role: user.type, sid };

    // jti: bir soniya ichida yangilansa ham token har safar boshqacha bo'lsin (iat soniyalarda),
    // aks holda rotation ishlamaydi - yangi token eskisi bilan bir xil chiqadi
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow('ACCESS_TOKEN_KEY'),
        expiresIn: this.configService.getOrThrow('ACCESS_TOKEN_TIME'),
        jwtid: randomUUID(),
      }),
      this.jwtService.signAsync(payload, {
        jwtid: randomUUID(),
        secret: this.configService.getOrThrow('REFRESH_TOKEN_KEY'),
        expiresIn: this.configService.getOrThrow('REFRESH_TOKEN_TIME'),
      }),
    ]);

    // Sessiya muddati = refresh tokenning muddati
    const { exp } = this.jwtService.decode<{ exp: number }>(refreshToken);
    return {
      accessToken,
      refreshToken,
      refreshExpiresAt: new Date(exp * 1000),
    };
  }
}
