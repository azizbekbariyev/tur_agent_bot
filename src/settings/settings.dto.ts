import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class BrandSettingsDto {
  // Faqat null - logotipni olib tashlash (yuklash POST /settings/logo orqali)
  @IsOptional()
  @IsIn([null])
  logoUrl?: null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'accent HEX rang bo‘lishi kerak' })
  accent?: string;

  @IsOptional()
  @IsIn(['UZS', 'USD', 'EUR'])
  currency?: string;

  @IsOptional()
  @IsIn(['uz', 'ru'])
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  telegram?: string;
}

export class ReminderSettingsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(60, { each: true })
  days?: number[];

  @IsOptional()
  @IsBoolean()
  toOwner?: boolean;

  @IsOptional()
  @IsBoolean()
  toManager?: boolean;

  @IsOptional()
  @IsBoolean()
  toClient?: boolean;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'time HH:MM bo‘lishi kerak',
  })
  time?: string;
}

// ---- Shartnoma shabloni (faqat admin) ----
const trimList = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? (value as unknown[])
        .map((v) => (typeof v === 'string' ? v.trim() : v))
        .filter((v) => v !== '')
    : value;

export class LangTextDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  ru?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  uz?: string;
}

/** Shartlar: faqat trim (bo'sh band tashlanmaydi - SettingsService «bo'sh band» deb xabar beradi) */
const trimOnly = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? (value as unknown[]).map((v) => (typeof v === 'string' ? v.trim() : v))
    : value;

export class LangListDto {
  @IsOptional()
  @Transform(trimOnly)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(1500, { each: true })
  ru?: string[];

  @IsOptional()
  @Transform(trimOnly)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(1500, { each: true })
  uz?: string[];
}

export class ContractListsDto {
  @IsOptional()
  @Transform(trimList)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  airlines?: string[];

  @IsOptional()
  @Transform(trimList)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  baggage?: string[];

  @IsOptional()
  @Transform(trimList)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  roomTypes?: string[];
}

export class ContractTemplateDto {
  @IsOptional()
  @IsIn(['ru', 'uz'])
  receiptLang?: 'ru' | 'uz';

  @IsOptional()
  @ValidateNested()
  @Type(() => LangTextDto)
  warning?: LangTextDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LangListDto)
  terms?: LangListDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ContractListsDto)
  lists?: ContractListsDto;
}

export class UpdateSettingsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => ContractTemplateDto)
  contract?: ContractTemplateDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BrandSettingsDto)
  brand?: BrandSettingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReminderSettingsDto)
  reminders?: ReminderSettingsDto;

  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyTarget?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  employeeSharePercent?: number;
}
