import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { In, Not, Repository } from 'typeorm';
import { Markup } from 'telegraf';
import { Cash } from '../bot/models/cash';
import { User } from '../bot/models/user';
import { Notification } from '../bot/models/notification';
import { BotService } from '../bot/bot.service';
import { daysBetween, tashkentDate, tashkentTime } from '../common/date';
import { frontendUrl, roleSection } from '../common/roles';
import { INACTIVE_STATUSES, cashLabel, getDebt } from '../cash/cash.utils';
import { AppSettings, SettingsService } from './settings.service';

const UPCOMING_DAYS = 7;

const esc = (v: unknown) =>
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const money = (n: number) =>
  `${Math.round(n)
    .toLocaleString('ru-RU')
    .replace(/\u00a0/g, ' ')} so'm`;

/**
 * Qarz eslatmalari: har kuni settings.reminders.time (Toshkent) da.
 * Shart: uchishgacha qolgan kun reminders.days ichida, qarz > 0,
 * holat draft/cancelled emas, kassa o'chirilmagan.
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);
  private running = false;

  constructor(
    @InjectRepository(Cash) private readonly cashRepository: Repository<Cash>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    private readonly settingsService: SettingsService,
    private readonly botService: BotService,
  ) {}

  // Har daqiqada vaqtni tekshiradi - vaqt sozlamalardan o'zgarishi mumkin
  @Cron('0 * * * * *')
  async tick() {
    if (this.running) return;
    try {
      const settings = await this.settingsService.get();
      if (tashkentTime() !== settings.reminders.time) return;
      const today = tashkentDate(new Date());
      // Bir kunda bir marta (server qayta ishga tushsa ham)
      if (!(await this.settingsService.claimReminderRun(today))) return;

      this.running = true;
      await this.run(settings, today);
    } catch (error) {
      this.logger.error(`Qarz eslatmalarida xato: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private cashLink(role: string | undefined, id?: number) {
    const base = frontendUrl();
    if (!/^https?:\/\//.test(base)) return null;
    return `${base}/${roleSection(role)}/kassalar${id ? `/${id}` : ''}`;
  }

  private async send(
    chatId: number | string | undefined | null,
    text: string,
    link?: string | null,
  ) {
    if (!chatId) return;
    try {
      await this.botService.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        ...(link
          ? Markup.inlineKeyboard([Markup.button.url('Kassani ochish', link)])
          : {}),
      });
    } catch (error) {
      this.logger.warn(
        `Telegram xabar yuborilmadi (${chatId}): ${String(error)}`,
      );
    }
  }

  async run(settings: AppSettings, today: string) {
    const { days, toOwner, toManager, toClient } = settings.reminders;

    const cashes = await this.cashRepository.find({
      where: { isDeleted: false, status: Not(In(INACTIVE_STATUSES)) },
      relations: {
        brutto: true,
        moneys: true,
        user: true,
        passengers: { client: true },
      },
    });

    const debtors = cashes
      .map((cash) => {
        const departure = tashkentDate(cash.departure_date);
        return {
          cash,
          debt: getDebt(cash),
          departure,
          daysLeft: departure ? daysBetween(today, departure) : NaN,
        };
      })
      .filter((d) => d.debt > 0);

    const due = debtors.filter((d) => days.includes(d.daysLeft));

    for (const { cash, debt, departure, daysLeft } of due) {
      const text =
        `✈️ <b>Qarz eslatmasi</b>\n\n` +
        `💼 Kassa: <b>${esc(cashLabel(cash))}</b>\n` +
        `🌍 Yo'nalish: <b>${esc(cash.destination)}</b>\n` +
        `📅 Uchish: <b>${departure}</b> (${daysLeft} kun qoldi)\n` +
        `💰 Qarz: <b>${money(debt)}</b>`;

      if (toOwner && cash.user) {
        await this.send(
          cash.user.telegramId,
          text,
          this.cashLink(cash.user.type, cash.id),
        );
        await this.notificationRepository.save({
          sms: text.replace(/<\/?b>/g, ''),
          type: 'cash',
          user: { id: cash.user.id },
        });
      }

      if (toClient) {
        const chatId = [...(cash.passengers ?? [])]
          .sort((a, b) => a.id - b.id)
          .find((p) => p.client?.telegramChatId)?.client?.telegramChatId;
        await this.send(
          chatId,
          `Assalomu alaykum! ${esc(cash.destination)} sayohatingizga ${daysLeft} kun qoldi (${departure}).\n` +
            `To'lanmagan qoldiq: <b>${money(debt)}</b>. Iltimos, uchishdan oldin to'lovni yakunlang.\n\n` +
            esc(settings.brand.name),
        );
      }
    }

    if (toManager && debtors.length) {
      const upcoming = debtors.filter(
        (d) => d.daysLeft >= 0 && d.daysLeft <= UPCOMING_DAYS,
      ).length;
      const total = debtors.reduce((s, d) => s + d.debt, 0);
      const text =
        `📊 <b>Kunlik qarzlar xulosasi</b> (${today})\n\n` +
        `Qarzdor kassalar: <b>${debtors.length}</b>\n` +
        `Ulardan ${UPCOMING_DAYS} kun ichida uchadi: <b>${upcoming}</b>\n` +
        `Jami qarz: <b>${money(total)}</b>`;

      const managers = await this.userRepository.find({
        where: {
          type: In(['ADMIN', 'SUPERADMIN']),
          isDeleted: false,
          status: true,
        },
      });
      for (const m of managers) {
        await this.send(m.telegramId, text, this.cashLink(m.type));
      }
    }

    this.logger.log(
      `Qarz eslatmalari: ${due.length} ta kassa, ${debtors.length} ta qarzdor`,
    );
  }
}
