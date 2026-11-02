import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { User } from 'src/bot/models/user';
import { Notification } from 'src/bot/models/notification';
import { BotService } from 'src/bot/bot.service';

@Injectable()
export class CashNotificationService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,

    private readonly botService: BotService,
  ) {}

  private readonly logger = new Logger(CashNotificationService.name);

  async notifyUser(userId: number, sms: string) {
    const targetUser = await this.userRepository.findOne({
      where: { id: userId, isDeleted: false },
    });

    if (!targetUser) return;
    await this.notificationRepository.save(
      this.notificationRepository.create({
        sms,
        type: 'cash',
        user: { id: userId },
      }),
    );
  }

  /** Faol rahbarlar (ADMIN va SUPERADMIN) */
  async adminIds(): Promise<number[]> {
    const admins = await this.userRepository.find({
      where: { type: In(['ADMIN', 'SUPERADMIN']), isDeleted: false },
      select: { id: true },
    });
    return admins.map((a) => a.id);
  }

  /** Barcha rahbarlarga notification yozadi; `telegram` - Telegram ID si bor rahbarlarga xabar ham */
  async notifyAdmins(sms: string, opts: { telegram?: boolean } = {}) {
    for (const id of await this.adminIds()) {
      await this.notifyUser(id, sms);
    }
    if (!opts.telegram) return;
    const admins = await this.userRepository.find({
      where: {
        type: In(['ADMIN', 'SUPERADMIN']),
        isDeleted: false,
        status: true,
      },
      select: { id: true, telegramId: true },
    });
    for (const a of admins) {
      if (!a.telegramId) continue;
      try {
        await this.botService.sendMessage(String(a.telegramId), sms);
      } catch (error) {
        // Telegram ishlamasa ham asosiy amal (tahrir/to'lov) bekor bo'lmaydi
        this.logger.warn(`Telegram xabari ketmadi (${a.id}): ${String(error)}`);
      }
    }
  }
}
