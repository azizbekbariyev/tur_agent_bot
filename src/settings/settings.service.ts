import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppSetting } from '../bot/models/app_setting';
import { DEFAULT_SHARE_PERCENT } from '../cash/cash.utils';
import { UpdateSettingsDto } from './settings.dto';

export interface AppSettings {
  brand: {
    name: string;
    logoUrl: string | null;
    accent: string;
    currency: 'UZS' | 'USD' | 'EUR';
    language: 'uz' | 'ru';
    address: string;
    phone: string;
    telegram: string;
  };
  reminders: {
    days: number[];
    toOwner: boolean;
    toManager: boolean;
    toClient: boolean;
    time: string;
  };
  monthlyTarget: number;
  employeeSharePercent: number;
  /** Shartnoma (kvitansiya) shabloni - faqat admin o'zgartiradi. Matn o'zgarsa faqat yangi
   *  versiyalarga ta'sir qiladi: berilgan versiyalar snapshot'ida o'z matni saqlanadi. */
  contract: ContractTemplate;
}

export interface ContractTemplate {
  /** Kvitansiyaning sukutdagi tili */
  receiptLang: 'ru' | 'uz';
  /** Ogohlantirish ramkasidagi matn */
  warning: { ru: string; uz: string };
  /** Shartlar (tartibli). UZ bo'sh bo'lsa - kvitansiyada «UZ» o'chiq */
  terms: { ru: string[]; uz: string[] };
  /** Shartnoma formasidagi tanlov tugmalari */
  lists: { airlines: string[]; baggage: string[]; roomTypes: string[] };
}

export const DEFAULT_SETTINGS: AppSettings = {
  brand: {
    name: 'KAKOS TOUR',
    logoUrl: null,
    accent: '#3CC8D8',
    currency: 'USD',
    language: 'uz',
    address: '',
    phone: '',
    telegram: '',
  },
  reminders: {
    days: [7, 3, 1],
    toOwner: true,
    toManager: true,
    toClient: false,
    time: '10:00',
  },
  monthlyTarget: 20_000_000,
  employeeSharePercent: DEFAULT_SHARE_PERCENT,
  contract: {
    receiptLang: 'ru',
    // Firmaning haqiqiy matni (Excel kvitansiyasi = dizayn 2-ekran). **…** — qalin joy. Admin Sozlamalarda o'zgartiradi.
    // O'zbekcha matnni admin o'zi kiritadi (RU matnning tarjimasi).
    warning: {
      ru: '**Оплатите 100% стоимость тура во избежание колебания курса валют!** В случае оплаты тура по частям (50%, 70%) и в случае изменения курса валюты (повышение или понижение), клиент оплачивает остаток турпакета по новому курсу поставщика услуг на день оплаты.',
      uz: '',
    },
    terms: {
      ru: [
        'Перед бронированием проверить и подтвердить турпакет (даты вылета и прилета, даты проживания, отель, тип номера в отеле).',
        '**В случае внесения изменений в тур** (изменение отеля, типа номера, даты вылета и прилета, замена туриста и другие) после его бронирования (независимо от вызвавших его причин), турист оплачивает штрафы согласно прейскуранту поставщика услуг. **Взимается 100% штраф!**',
        '**Перебронирование тура** (изменение отеля, типа номера, даты вылета и прилета и другие) делается по новой цене системы бронирования (онлайн). **Взимается 100% штраф** за забронированный тур.',
        '**В случае отказа от поездки** (аннулирования или неиспользования тура), турист несет персональную ответственность независимо от вызвавших его причин и **возмещает турфирме 100% оплату.** Это связано с тем, что все туры (отель, трансфер, авиабилеты, страхование и другие) бронируются по «Невозвратному тарифу».',
        'В случае неполучения подтверждения тура (из-за 100% заполняемости отеля или самолета) от поставщика услуг, турист должен выбрать альтернативный вариант отеля или изменить даты тура.',
      ],
      uz: [],
    },
    lists: {
      airlines: ['Uzbekistan Airways', 'Qanot Sharq'],
      baggage: ['20+5 kg', '23 kg', '10 kg'],
      roomTypes: ['Standard', 'Deluxe', 'Suite'],
    },
  },
};

function mergeContract(saved?: Partial<ContractTemplate>): ContractTemplate {
  const d = DEFAULT_SETTINGS.contract;
  const c = saved ?? {};
  return {
    receiptLang: c.receiptLang ?? d.receiptLang,
    warning: { ...d.warning, ...(c.warning ?? {}) },
    terms: { ...d.terms, ...(c.terms ?? {}) },
    lists: { ...d.lists, ...(c.lists ?? {}) },
  };
}

const SETTINGS_ID = 1;

/** «**» juft bo'lishi kerak (qalin joy ochilib-yopiladi) */
const unbalanced = (s: string) => (s.match(/\*\*/g) ?? []).length % 2 === 1;

/**
 * Shartnoma shabloni matnlari: shart bo'sh bo'lmasin, ** juft yopilsin. Xato bo'lsa - saqlanmaydi, aniq xabar.
 * (Kvitansiya bitta sahifaga sig'ishi alohida tekshiriladi va saqlashni BLOKLAMAYDI - POST /contracts/template-fit)
 */
export function validateContractTexts(c?: {
  warning?: { ru?: string; uz?: string };
  terms?: { ru?: string[]; uz?: string[] };
}) {
  if (!c) return;
  for (const lang of ['ru', 'uz'] as const) {
    const L = lang.toUpperCase();
    const w = c.warning?.[lang];
    if (w && unbalanced(w)) {
      throw new BadRequestException(
        `Ogohlantirish (${L}): ** juft yopilmagan — qalin joy «**matn**» ko'rinishida bo'lishi kerak`,
      );
    }
    (c.terms?.[lang] ?? []).forEach((t, i) => {
      if (!t || !t.replace(/\*/g, '').trim()) {
        throw new BadRequestException(
          `Shartlar (${L}) ${i + 1}-band: matn bo'sh`,
        );
      }
      if (unbalanced(t)) {
        throw new BadRequestException(
          `Shartlar (${L}) ${i + 1}-band: ** juft yopilmagan — qalin joy «**matn**» ko'rinishida bo'lishi kerak`,
        );
      }
    });
  }
}

/** DTO'dagi yuborilmagan (undefined) maydonlar mavjud qiymatlarni o'chirmasin */
function defined<T extends object>(obj?: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj ?? {}).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(AppSetting)
    private readonly repo: Repository<AppSetting>,
  ) {}

  private async row(): Promise<AppSetting> {
    const found = await this.repo.findOne({ where: { id: SETTINGS_ID } });
    if (found) return found;
    return this.repo.save({ id: SETTINGS_ID, data: {} });
  }

  private merge(data: Record<string, any>): AppSettings {
    const d = (data ?? {}) as Partial<AppSettings>;
    return {
      brand: { ...DEFAULT_SETTINGS.brand, ...(d.brand ?? {}) },
      reminders: { ...DEFAULT_SETTINGS.reminders, ...(d.reminders ?? {}) },
      monthlyTarget: Number(d.monthlyTarget ?? DEFAULT_SETTINGS.monthlyTarget),
      employeeSharePercent: Number(
        d.employeeSharePercent ?? DEFAULT_SETTINGS.employeeSharePercent,
      ),
      contract: mergeContract(d.contract),
    };
  }

  async get(): Promise<AppSettings> {
    return this.merge((await this.row()).data);
  }

  async getSharePercent(): Promise<number> {
    return (await this.get()).employeeSharePercent;
  }

  async update(dto: UpdateSettingsDto): Promise<AppSettings> {
    validateContractTexts(dto.contract);
    const current = this.merge((await this.row()).data);
    const next: AppSettings = {
      brand: {
        ...current.brand,
        ...(defined(dto.brand) as Partial<AppSettings['brand']>),
      },
      reminders: { ...current.reminders, ...defined(dto.reminders) },
      monthlyTarget: dto.monthlyTarget ?? current.monthlyTarget,
      employeeSharePercent:
        dto.employeeSharePercent ?? current.employeeSharePercent,
      contract: dto.contract
        ? mergeContract({
            ...current.contract,
            ...defined(dto.contract),
            warning: {
              ...current.contract.warning,
              ...defined(dto.contract.warning),
            },
            terms: {
              ...current.contract.terms,
              ...defined(dto.contract.terms),
            },
            lists: {
              ...current.contract.lists,
              ...defined(dto.contract.lists),
            },
          })
        : current.contract,
    };
    if (dto.reminders?.days) {
      next.reminders.days = [...new Set(dto.reminders.days)].sort(
        (a, b) => b - a,
      );
    }
    const removeLogo = dto.brand?.logoUrl === null;
    if (removeLogo) next.brand.logoUrl = null;
    await this.repo.save({
      id: SETTINGS_ID,
      data: { ...next },
      ...(removeLogo ? { logo: null, logoMime: null } : {}),
    });
    return next;
  }

  async saveLogo(buffer: Buffer, mime: string, logoUrl: string) {
    const row = await this.row();
    const data = this.merge(row.data);
    data.brand.logoUrl = logoUrl;
    await this.repo.save({
      id: SETTINGS_ID,
      logo: buffer,
      logoMime: mime,
      data: { ...data },
    });
    return { logoUrl };
  }

  async getLogo(): Promise<{ logo: Buffer; mime: string } | null> {
    const row = await this.repo
      .createQueryBuilder('s')
      .addSelect('s.logo')
      .where('s.id = :id', { id: SETTINGS_ID })
      .getOne();
    if (!row?.logo || !row.logoMime) return null;
    return { logo: row.logo, mime: row.logoMime };
  }

  /** Bugun eslatma yuborilmagan bo'lsa belgilab, true qaytaradi (bir kunda bir marta) */
  async claimReminderRun(today: string): Promise<boolean> {
    await this.row();
    const result = await this.repo
      .createQueryBuilder()
      .update(AppSetting)
      .set({ lastReminderDate: today })
      .where('id = :id', { id: SETTINGS_ID })
      .andWhere(
        '(last_reminder_date IS NULL OR last_reminder_date <> :today)',
        { today },
      )
      .execute();
    return (result.affected ?? 0) > 0;
  }
}
