import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/bot/models/user';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserToken } from 'src/types/token.type';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}
  async validate(authorization: string) {
    const token = authorization?.replace('Bearer ', '');
    try {
      const payload: UserToken = await this.jwtService.verifyAsync(token, {
        secret: this.configService.getOrThrow('JWT_SECRET'),
      });
      const user = await this.userRepository.findOne({
        where: {
          telegram_id: payload.telegram_id,
        },
      });
      if (!user) {
        return { isValid: false };
      }
      return {
        id: user.id,
        firstName: user.first_name,
        lastName: user.last_name,
        telegramId: user.telegram_id,
        username: user.username ? user.username : 'null',
        role: user.type,
        status: user.status ? 'ACTIVE' : 'INACTIVE',
        createdAt: user.created_at,
        active: user.status,
      };
    } catch {
      throw new UnauthorizedException('Token noto‘g‘ri yoki muddati tugagan');
    }
  }
}
