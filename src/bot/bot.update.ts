import { Ctx, Start, Update } from 'nestjs-telegraf';
import { BotService } from './bot.service';
import { Context } from 'telegraf';
import { Cron } from '@nestjs/schedule';

@Update()
export class BotUpdate {
  constructor(private readonly botService: BotService) {}

  @Start()
  start(@Ctx() ctx: Context) {
    return this.botService.start(ctx);
  }

  @Cron('0 0 8 * * *')
  dailyCheck() {
    return this.botService.dailyCheck();
  }
}
