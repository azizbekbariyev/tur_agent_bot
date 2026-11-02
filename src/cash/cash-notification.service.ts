import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { User } from 'src/bot/models/user';
import { Notification } from 'src/bot/models/notification';

@Injectable()
export class CashNotificationService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,

    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
  ) {}

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

  /** Barcha rahbarlarga notification yozadi */
  async notifyAdmins(sms: string) {
    for (const id of await this.adminIds()) {
      await this.notifyUser(id, sms);
    }
  }
}
