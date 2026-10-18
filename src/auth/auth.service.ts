import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/bot/models/user';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserToken } from 'src/types/token.type';
import * as bcrypt from 'bcrypt';
import { type Request, type Response } from 'express';

const ACCESS_COOKIE_MAX_AGE = 15 * 60 * 1000; // 15 daqiqa
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 kun

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

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

  private toSafeUser(user: User | null) {
    if (!user || user.isDeleted || !user.status) {
      throw new UnauthorizedException(
        'Foydalanuvchi topilmadi yoki bloklangan',
      );
    }
    const {
      hashedPassword: _hashedPassword,
      hashedRefreshToken: _hashedRefreshToken,
      ...safe
    } = user;

    return { ...safe, role: user.type, active: user.status };
  }

  async loginEmailPassword(
    dto: { email: string; password: string },
    res: Response,
  ) {
    const user = await this.userRepository.findOne({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException("Email yoki password noto'g'ri");
    }

    const validPassword = await bcrypt.compare(
      dto.password,
      user.hashedPassword,
    );

    if (!validPassword) {
      throw new UnauthorizedException("Email yoki password noto'g'ri 1");
    }

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

    if (!user) {
      throw new UnauthorizedException('Foydalanuvchi topilmadi');
    }

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
