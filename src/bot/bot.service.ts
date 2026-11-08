import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectBot } from 'nestjs-telegraf';
import { BOT_NAME } from 'src/app.constants';
import { Context, Telegraf } from 'telegraf';
import { User } from './models/user';
import { Repository } from 'typeorm';
import { Client } from './models/client';
import { frontendUrl } from '../common/roles';
import { botEnabled } from '../common/flags';

const BOT_INFO_TTL = 10 * 60 * 1000;

type MessageExtra = Parameters<Telegraf['telegram']['sendMessage']>[2];

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);
  private botInfo: { username: string | null; at: number } | null = null;

  constructor(
    @InjectBot(BOT_NAME) private readonly bot: Telegraf,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Client)
    private readonly clientRepository: Repository<Client>,
  ) {}

  async start(ctx: Context) {
    if (!ctx.from) return;

    const user = await this.userRepository.findOne({
      where: { telegramId: ctx.from.id, isDeleted: false },
    });

    if (user) {
      if (!user.status) {
        await ctx.reply(
          'Hisobingiz bloklangan. Rahbaringizga murojaat qiling.',
        );
        return;
      }
      // Bot faqat eslatmalar uchun: kirish tokeni yoki Mini App yo'q, saytga oddiy kirish orqali
      const url = frontendUrl();
      await ctx.reply(
        `Assalomu alaykum, ${user.firstName}! Siz botga ulangansiz: kassa eslatmalari va xabarlar shu yerga keladi.` +
          (url ? `\n\nTizimga kirish: ${url}` : ''),
      );
      return;
    }

    // Mijoz: kartasidagi Telegram username bo'yicha chat ID ni bog'laymiz
    if (await this.linkClient(ctx)) {
      await ctx.reply(
        "Rahmat! Endi sayohatingiz bo'yicha hujjat va eslatmalarni shu yerda olasiz.",
      );
      return;
    }

    await ctx.reply(
      "Siz tizimda topilmadingiz. Agentlik menejeriga Telegram username'ingizni ayting.",
    );
  }

  private async linkClient(ctx: Context): Promise<boolean> {
    const username = ctx.from?.username;
    if (!username) return false;
    const client = await this.clientRepository
      .createQueryBuilder('client')
      .where('LOWER(client.telegram) = LOWER(:username)', { username })
      .andWhere('client.is_deleted = false')
      .getOne();
    if (!client) return false;
    await this.clientRepository.update(
      { id: client.id },
      { telegramChatId: String(ctx.chat?.id ?? ctx.from.id) },
    );
    return true;
  }

  public sendMessage(
    chatId: number | string,
    message: string,
    extra?: MessageExtra,
  ) {
    this.assertEnabled();
    return this.bot.telegram.sendMessage(chatId, message, extra);
  }

  public sendDocument(
    chatId: number | string,
    source: Buffer,
    filename: string,
    caption?: string,
  ) {
    this.assertEnabled();
    return this.bot.telegram.sendDocument(
      chatId,
      { source, filename },
      caption ? { caption } : undefined,
    );
  }

  /** BOT_ENABLED=false (test nusxa): Telegram'ga hech narsa yuborilmaydi, chaqiruvchi xato oladi */
  private assertEnabled() {
    if (!botEnabled()) {
      throw new Error("Telegram bot o'chirilgan (BOT_ENABLED=false)");
    }
  }

  /** Bot ulanganmi (token to'g'ri va Telegram javob beryaptimi) */
  async getBotUsername(): Promise<string | null> {
    if (!botEnabled()) return null;
    if (this.botInfo && Date.now() - this.botInfo.at < BOT_INFO_TTL) {
      return this.botInfo.username;
    }
    try {
      const me = await this.bot.telegram.getMe();
      this.botInfo = { username: me.username ?? null, at: Date.now() };
    } catch (error) {
      this.logger.warn(`Telegram getMe xatosi: ${String(error)}`);
      this.botInfo = { username: null, at: Date.now() };
    }
    return this.botInfo.username;
  }
}
