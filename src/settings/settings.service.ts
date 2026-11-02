import { Injectable } from '@nestjs/common';
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
};

const SETTINGS_ID = 1;

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
    };
  }

  async get(): Promise<AppSettings> {
    return this.merge((await this.row()).data);
  }

  async getSharePercent(): Promise<number> {
    return (await this.get()).employeeSharePercent;
  }

  async update(dto: UpdateSettingsDto): Promise<AppSettings> {
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
