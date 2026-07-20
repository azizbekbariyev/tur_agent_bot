import { Ctx, Start, Update } from 'nestjs-telegraf';
import { BotService } from './bot.service';
import { Context } from 'telegraf';

@Update()
export class BotUpdate {
  constructor(private readonly botService: BotService) {}

  @Start()
  start(@Ctx() ctx: Context) {
    return this.botService.start(ctx);
  }
}
