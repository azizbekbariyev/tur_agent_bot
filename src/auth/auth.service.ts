import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/bot/models/user';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserToken } from 'src/types/token.type';
import * as bcrypt from 'bcrypt';
import { type Request, type Response } from 'express';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}
  async validate(req: Request) {
    const token = req.cookies['access_token'] as string;
    console.log(token);
    try {
      const payload: UserToken = await this.jwtService.verifyAsync(token, {
        secret: this.configService.getOrThrow('JWT_SECRET'),
      });
      console.log(payload);
      const user = await this.userRepository.findOne({
        where: {
          id: payload.id,
        },
      });
      if (!user) {
        return { isValid: false };
      }
      return {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        email: user.email,
        role: user.type,
        status: user.status ? 'ACTIVE' : 'INACTIVE',
        createdAt: user.created_at,
        active: user.status,
      };
    } catch {
      throw new UnauthorizedException('Token noto‘g‘ri yoki muddati tugagan');
    }
  }

  async loginEmailPassword(
    dto: { email: string; password: string },
    res: Response,
  ) {
    const user = await this.userRepository.findOne({
      where: {
        email: dto.email,
      },
    });

    if (!user) {
      throw new UnauthorizedException("Email yoki password noto'g'ri");
    }

    const validPassword = await bcrypt.compare(
      dto.password,
      user.hashed_password,
    );

    if (!validPassword) {
      throw new UnauthorizedException("Email yoki password noto'g'ri");
    }

    const { accessToken, refreshToken } = await this.generateTokenUser(user);

    res.cookie('refresh_token', refreshToken, {
      maxAge: Number(process.env.COOKIE_TIME),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });

    res.cookie('access_token', accessToken, {
      maxAge: Number(process.env.COOKIE_TIME),
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
    });

    return {
      role: user.type,
    };
  }

  async generateTokenUser(user: User) {
    const payload = {
      id: user.id,
      email: user.email,
      hashed_password: user.hashed_password,
      role: user.type,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: process.env.ACCESS_TOKEN_KEY,
        expiresIn: process.env
          .ACCESS_TOKEN_TIME as `${number}${'s' | 'm' | 'h' | 'd'}`,
      }),
      this.jwtService.signAsync(payload, {
        secret: process.env.REFRESH_TOKEN_KEY,
        expiresIn: process.env
          .REFRESH_TOKEN_TIME as `${number}${'s' | 'm' | 'h' | 'd'}`,
      }),
    ]);

    return { accessToken, refreshToken };
  }
}
