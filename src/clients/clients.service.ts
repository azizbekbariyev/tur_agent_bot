import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Client } from '../bot/models/client';
import { Passenger } from '../bot/models/passenger';
import { Cash } from '../bot/models/cash';
import { escapeLike, normalizeTelegram } from '../common/text';
import { tashkentDate } from '../common/date';
import { getBrutto, getDebt, isActiveStatus } from '../cash/cash.utils';
import { linkPassengersToClients } from './client-link';
import { ClientsQueryDto, UpdateClientDto } from './clients.dto';

/** Doimiy mijoz: kamida shuncha safar */
const REGULAR_TRIPS = 2;

@Injectable()
export class ClientsService implements OnModuleInit {
  private readonly logger = new Logger(ClientsService.name);

  constructor(
    @InjectRepository(Client)
    private readonly clientRepository: Repository<Client>,
    @InjectRepository(Passenger)
    private readonly passengerRepository: Repository<Passenger>,
    private readonly dataSource: DataSource,
  ) {}

  /** Eski yo'lovchilarni (telefoni bor, mijozga bog'lanmagan) bir marta bog'laydi */
  async onModuleInit() {
    try {
      const passengers = await this.passengerRepository
        .createQueryBuilder('p')
        .where('p.client_id IS NULL')
        .andWhere("COALESCE(p.phone_number, '') <> ''")
        .getMany();
      if (!passengers.length) return;
      const linked = await this.dataSource.transaction((manager) =>
        linkPassengersToClients(manager, passengers),
      );
      if (linked)
        this.logger.log(`${linked} ta yo'lovchi mijozlarga bog'landi`);
    } catch (error) {
      this.logger.error(`Mijozlarni bog'lashda xato: ${String(error)}`);
    }
  }

  /** Mijozlarning kassalari (cancelled va o'chirilganlar kirmaydi) */
  private async tripsByClient(clientIds: number[]) {
    const map = new Map<number, Cash[]>();
    if (!clientIds.length) return map;

    const passengers = await this.passengerRepository.find({
      where: { client: { id: In(clientIds) } },
      relations: {
        client: true,
        cash: { brutto: true, moneys: true, user: true },
      },
    });

    for (const p of passengers) {
      const cash = p.cash;
      if (!cash || cash.isDeleted || cash.status === 'cancelled') continue;
      const list = map.get(p.client!.id) ?? [];
      if (!list.some((c) => c.id === cash.id)) list.push(cash);
      map.set(p.client!.id, list);
    }
    return map;
  }

  private stats(cashes: Cash[]) {
    // Qarz faqat faol (draft emas) kassalar bo'yicha
    const totalBrutto = cashes.reduce((s, c) => s + getBrutto(c), 0);
    const debt = cashes
      .filter((c) => isActiveStatus(c.status))
      .reduce((s, c) => s + Math.max(getDebt(c), 0), 0);
    return {
      totalBrutto,
      trips: cashes.length,
      avgCheck: cashes.length ? Math.round(totalBrutto / cashes.length) : 0,
      debt,
    };
  }

  async list(query: ClientsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.clientRepository
      .createQueryBuilder('client')
      .where('client.is_deleted = false');

    const search = query.search?.trim();
    if (search) {
      const s = `%${escapeLike(search)}%`;
      const digits = search.replace(/\D/g, '');
      qb.andWhere(
        `(client.first_name ILIKE :s OR client.last_name ILIKE :s
          OR CONCAT(client.first_name, ' ', client.last_name) ILIKE :s
          OR CONCAT(client.last_name, ' ', client.first_name) ILIKE :s
          ${digits ? 'OR client.phone LIKE :digits' : ''})`,
        { s, digits: `%${digits}%` },
      );
    }

    const [clients, total] = await qb
      .orderBy('client.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const trips = await this.tripsByClient(clients.map((c) => c.id));

    return {
      data: clients.map((c) => {
        const s = this.stats(trips.get(c.id) ?? []);
        return {
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          phone: c.phone,
          tripsCount: s.trips,
          totalBrutto: s.totalBrutto,
          debt: s.debt,
          isRegular: s.trips >= REGULAR_TRIPS,
        };
      }),
      total,
    };
  }

  async getOne(id: number) {
    const client = await this.clientRepository.findOne({
      where: { id, isDeleted: false },
    });
    if (!client) throw new NotFoundException('Mijoz topilmadi');

    const cashes = (await this.tripsByClient([id])).get(id) ?? [];
    const s = this.stats(cashes);

    return {
      id: client.id,
      firstName: client.firstName,
      lastName: client.lastName,
      phone: client.phone,
      telegram: client.telegram ? `@${client.telegram}` : null,
      telegramChatId: client.telegramChatId,
      tags: client.tags ?? [],
      note: client.note,
      isRegular: s.trips >= REGULAR_TRIPS,
      stats: s,
      trips: cashes
        .sort((a, b) => b.departure_date.localeCompare(a.departure_date))
        .map((c) => ({
          cashId: c.id,
          seqNo: c.seq_no,
          cashNumber: c.cash_number,
          destination: c.destination,
          departureDate: tashkentDate(c.departure_date),
          turistCount: c.turist_count,
          employee: c.user
            ? `${c.user.lastName ?? ''} ${c.user.firstName}`.trim()
            : null,
          brutto: getBrutto(c),
          status: c.status,
        })),
    };
  }

  async update(id: number, dto: UpdateClientDto) {
    const client = await this.clientRepository.findOne({
      where: { id, isDeleted: false },
    });
    if (!client) throw new NotFoundException('Mijoz topilmadi');

    const patch: Partial<Client> = {};
    if (dto.tags !== undefined) {
      patch.tags = [...new Set(dto.tags.map((t) => t.trim()).filter(Boolean))];
    }
    if (dto.note !== undefined) patch.note = dto.note;
    if (dto.telegram !== undefined) {
      const telegram = normalizeTelegram(dto.telegram);
      if (telegram !== client.telegram) {
        patch.telegram = telegram;
        // Boshqa akkaunt - chat ID qayta bog'lanishi kerak (mijoz botga /start bosadi)
        patch.telegramChatId = null;
      }
    }
    if (Object.keys(patch).length) {
      await this.clientRepository.update({ id }, patch);
    }
    return this.getOne(id);
  }
}
