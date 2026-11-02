import { Type } from 'class-transformer';
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

export class UpdateSettingsDto {
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
