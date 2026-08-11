import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

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

  async notifyUser(userId: number, sms: string) {
    const targetUser = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!targetUser) return;

    try {
      await this.botService.sendMessage(targetUser.telegram_id, sms);
    } catch (e) {
      // Bot yuborolmasa ham notification bazada qoladi
      console.error(`SMS yuborilmadi (user ${userId}):`, e);
    }

    await this.notificationRepository.save(
      this.notificationRepository.create({
        sms,
        type: 'cash',
        user: { id: userId },
      }),
    );
  }

  /**
   * Barcha ADMIN'larga SMS + notification yuboradi
   */
  async notifyAdmins(sms: string) {
    const admins = await this.userRepository.find({
      where: { type: 'ADMIN' },
    });

    for (const admin of admins) {
      await this.notifyUser(admin.id, sms);
    }
  }
}
