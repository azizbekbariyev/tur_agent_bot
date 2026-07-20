import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Ctx, InjectBot } from 'nestjs-telegraf';
import { BOT_NAME } from 'src/app.constants';
import { Context, Telegraf } from 'telegraf';
import { User } from './models/user';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class BotService {
  constructor(
    @InjectBot(BOT_NAME) private readonly bot: Telegraf,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  async start(@Ctx() ctx: Context) {
    const user = await this.userRepository.findOne({
      where: { telegram_id: ctx.from!.id },
    });

    if (user) {
      const token = await this.generateToken(user);
      if (user.type === 'EMPLOYEE') {
        await ctx.reply(`Employee + ${token}`);
      } else {
        await ctx.reply(`Admin + ${token}`);
      }
      return;
    }
    console.log(ctx.from);
    const newUser = await this.userRepository.save({
      telegram_id: ctx.from!.id,
      username: ctx.from!.username,
      first_name: ctx.from!.first_name,
      last_name: ctx.from!.last_name,
      type: 'employee',
    });

    const token = await this.generateToken({
      telegram_id: ctx.from!.id,
      type: 'employee',
      id: newUser.id,
    });
    await ctx.reply(`Employee + ${token}`);
  }

  async generateToken(user: { telegram_id: number; type: string; id: number }) {
    const token = await this.jwtService.signAsync(
      {
        telegram_id: user.telegram_id,
        role: user.type,
        id: user.id,
      },
      {
        secret: process.env.JWT_SECRET || 'secret',
        expiresIn: 86400,
      },
    );
    return token;
  }
}
