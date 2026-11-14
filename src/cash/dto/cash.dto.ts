import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
  IsArray,
  IsInt,
  IsPositive,
  IsBoolean,
  IsEmail,
  IsIn,
  Matches,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export enum CashStatus {
  DRAFT = 'draft',
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
  CLOSED = 'closed',
  CANCELLED = 'cancelled',
  SENT_FOR_REWORK = 'sent_for_rework',
  DUE = 'due',
}

export enum Currency {
  USD = 'USD',
  UZS = 'UZS',
  EUR = 'EUR',
}

export enum PaymentType {
  CASH = 'CASH',
  CARD = 'CARD',
  TRANSFER = 'TRANSFER',
}

export enum UserRole {
  SUPERADMIN = 'SUPERADMIN',
  ADMIN = 'ADMIN',
  EMPLOYEE = 'EMPLOYEE',
  ACCOUNTANT = 'ACCOUNTANT',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export class DashboardFilterDto {
  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}

/** 6.3 Liderlar reytingi: davr + filial (firma ichida: "all" yoki filial identifikatori) */
export class LeaderboardQueryDto extends DashboardFilterDto {
  @IsOptional()
  @Matches(/^(all|[a-z0-9][a-z0-9-]{0,39})$/)
  branch?: string;
}

export class OptionalDateRangeDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export const CASH_SORT_FIELDS = [
  'created_at',
  'cash_number',
  'seq_no',
  'departure_date',
] as const;
export const CASHES_MAX_LIMIT = 500;

/** /cashes va /cashes/status-counts uchun umumiy filtrlar */
export class CashFilterDto {
  // Kassa raqami boshidan moslik (ILIKE 'x%')
  @IsOptional()
  @IsString()
  cashNumber?: string;

  // Kassa raqami, yo'nalish, yo'lovchi ismi/familiyasi, xizmat kodi (ILIKE '%x%')
  @IsOptional()
  @IsString()
  search?: string;

  // Egasi YOKI qo'shimcha xodim. 'me' - joriy foydalanuvchi
  @IsOptional()
  @IsString()
  userId?: string;

  // own - joriy foydalanuvchi egasi bo'lgan kassalar; shared - qo'shimcha xodimi bor kassalar
  @IsOptional()
  @IsIn(['own', 'shared'])
  participation?: 'own' | 'shared';

  // created_at bo'yicha, ikkala chegara ham kiradi
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class CashListQueryDto extends CashFilterDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CASHES_MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @IsIn(CASH_SORT_FIELDS)
  sort?: (typeof CASH_SORT_FIELDS)[number];

  @IsOptional()
  @IsIn(['asc', 'desc', 'ASC', 'DESC'])
  order?: string;
}

export class CheckNumberQueryDto {
  @IsString()
  cashNumber!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  excludeId?: number;
}

// ---- Brutto: mijoz to'lashi kerak bo'lgan jami summa ----
// currency USD/EUR bo'lsa -> currency_amount (kurs) bilan so'mga o'tkaziladi
// currency UZS bo'lsa -> currency_amount e'tiborga olinmaydi (yoki 1 deb qoldiriladi)
export class BruttoDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsEnum(Currency)
  currency!: Currency;

  // 1 USD/EUR = necha so'm (shu yozuv uchun ALOHIDA kurs)
  @IsNumber()
  currency_amount!: number;
}

// ---- Xizmat (CashServices): Cash bilan Service (katalog) o'rtasidagi bog'lanish ----
// DIQQAT: hozirgi CashServices entity'da `currency` ustuni yo'q - xizmatlar
// har doim USD deb hisoblanadi (service_amount * currency_amount = so'm).
export class CashServiceItemDto {
  // Katalogdagi Service yozuvi (SelectService orqali tanlangan company_name+name)
  @IsInt()
  service_id!: number;

  @IsOptional()
  @IsString()
  code?: string;

  @IsNumber()
  @IsPositive()
  service_amount!: number;

  @IsEnum(Currency)
  currency!: Currency;

  // 1 USD = necha so'm (shu xizmat yozuvi uchun ALOHIDA kurs)
  @IsNumber()
  currency_amount!: number;
}

// ---- Money: mijozdan haqiqatda olingan har bir to'lov ----
export class MoneyItemDto {
  @IsNumber()
  @IsPositive()
  money_received!: number;

  @IsEnum(PaymentType)
  type!: PaymentType;

  @IsEnum(Currency)
  currency!: Currency;

  // 1 USD/EUR = necha so'm (shu to'lov yozuvi uchun ALOHIDA kurs)
  @IsNumber()
  currency_amount!: number;
}

export class PassengerItemDto {
  @IsString()
  firstName!: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;
}

export class CreateCashDto {
  // Dogovor raqami; "0" yoki bo'sh - dogovor hali berilmagan
  @IsOptional()
  @IsString()
  cash_number?: string;

  // YANGI: endi qo'shimcha xodim ham haqiqiy User (FK), erkin matn emas.
  @IsOptional()
  @IsInt()
  additional_user_id?: number | null;

  @IsString()
  destination!: string;

  @IsDateString()
  departure_date!: string;

  @IsDateString()
  return_date!: string;

  @IsString()
  comment!: string;

  @IsOptional()
  @IsDateString()
  created_at?: string;

  @IsInt()
  turist_count!: number;

  @IsEnum([CashStatus.DRAFT, CashStatus.PENDING_APPROVAL])
  status!: CashStatus.DRAFT | CashStatus.PENDING_APPROVAL;

  @ValidateNested()
  @Type(() => BruttoDto)
  brutto!: BruttoDto;

  // Netto BU YERDA YO'Q - backend cashServices'dan o'zi hisoblab, Cash.netto'ga yozadi.

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CashServiceItemDto)
  services!: CashServiceItemDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PassengerItemDto)
  passengers!: PassengerItemDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MoneyItemDto)
  moneys!: MoneyItemDto[];
}

export class CreatePaymantDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsEnum(Currency)
  currency!: Currency;

  @IsEnum(PaymentType)
  type!: PaymentType;

  // YANGI: to'lov qo'shishda ham shu to'lovga xos kurs kerak
  @IsNumber()
  currency_amount!: number;
}

// Frontend firstName/lastName/phoneNumber yuboradi; eski snake_case nomlar ham qabul qilinadi
export class UpdatePassengerDto {
  @IsOptional()
  @IsInt()
  id?: number;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  first_name?: string;

  @IsOptional()
  @IsString()
  last_name?: string;

  @IsOptional()
  @IsString()
  phone_number?: string;
}

// Update paytida CashServices yozuvi
export class UpdateCashServiceDto {
  @IsOptional()
  @IsInt()
  id?: number;

  @IsInt()
  service_id!: number;

  @IsOptional()
  @IsString()
  code?: string;

  @IsNumber()
  @IsPositive()
  service_amount!: number;

  @IsEnum(Currency)
  currency!: Currency;

  @IsNumber()
  currency_amount!: number;
}

export class UpdateMoneyDto {
  @IsOptional()
  @IsInt()
  id?: number;

  @IsNumber()
  @IsPositive()
  money_received!: number;

  @IsEnum(Currency)
  currency!: Currency;

  @IsEnum(PaymentType)
  type!: PaymentType;

  @IsNumber()
  currency_amount!: number;
}

export class UpdateBruttoDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsEnum(Currency)
  currency!: Currency;

  @IsNumber()
  currency_amount!: number;
}

export class UpdateCashDto {
  @IsOptional()
  @IsString()
  cash_number?: string;

  // null - qo'shimcha xodimni olib tashlash
  @IsOptional()
  @IsInt()
  additional_user_id?: number | null;

  @IsOptional()
  @IsString()
  destination?: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsDateString()
  created_at?: string;

  @IsOptional()
  @IsDateString()
  departure_date?: string;

  @IsOptional()
  @IsDateString()
  return_date?: string;

  @IsOptional()
  @IsEnum(CashStatus)
  status?: CashStatus;

  @IsOptional()
  @IsInt()
  turist_count?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateBruttoDto)
  brutto?: UpdateBruttoDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdatePassengerDto)
  passengers?: UpdatePassengerDto[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  deletedPassengerIds?: number[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateCashServiceDto)
  services?: UpdateCashServiceDto[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  deletedServiceIds?: number[]; // CashServices.id lar (Service.id emas!)

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateMoneyDto)
  moneys?: UpdateMoneyDto[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  deletedMoneyIds?: number[];
}

export class UpdateCashStatusDto {
  @IsEnum(CashStatus)
  status!: CashStatus;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class UpdateCashEmployeeBonusDto {
  @IsBoolean()
  taken!: boolean;
}

const toTelegramId = ({ value }: { value: unknown }) =>
  value === '' || value === null || value === undefined
    ? undefined
    : Number(value);

export class CreateUserDto {
  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsEmail()
  email!: string;

  // Kirish uchun; kichik harflarga o'tkaziladi va tekshiriladi (common/username.ts)
  @IsOptional()
  @IsString()
  username?: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsEnum(UserRole)
  type!: UserRole;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @Transform(toTelegramId)
  @IsInt()
  telegramId?: number;

  // Oylik foyda maqsadi (so'm), null - sozlamalardagi standart qiymat
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyTarget?: number | null;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  // Bo'sh qator - username olib tashlanadi
  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @IsEnum(UserRole)
  type?: UserRole;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  // Frontend "1120254388" (string) yuboradi, shuning uchun songa o'giramiz
  @IsOptional()
  @Transform(toTelegramId)
  @IsInt()
  telegramId?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyTarget?: number | null;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

export class VoucherSendDto {
  @IsOptional()
  @IsIn(['uz', 'ru'])
  lang?: 'uz' | 'ru';

  @IsOptional()
  @IsBoolean()
  showPassengers?: boolean;

  @IsOptional()
  @IsBoolean()
  showPayments?: boolean;

  @IsOptional()
  @IsBoolean()
  showServices?: boolean;
}

export const EXPORT_TYPES = [
  'cashes',
  'employees',
  'debtors',
  'partner-payments',
] as const;

export class ExportQueryDto {
  @IsIn(EXPORT_TYPES)
  type!: (typeof EXPORT_TYPES)[number];

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsOptional()
  @IsIn(['xlsx', 'csv'])
  format?: 'xlsx' | 'csv';

  // Sarlavhalar va holat/to'lov turi nomlari tili
  @IsOptional()
  @IsIn(['uz', 'ru'])
  lang?: 'uz' | 'ru';
}

// ---- ServiceType / Service (katalog) ----
export class CreateServiceTypeDto {
  @IsString()
  name!: string;

  @IsString()
  color!: string;
}

export class CreateServiceCompanyDto {
  @IsString()
  company_name!: string;

  @IsString()
  name!: string;

  @IsInt()
  service_type_id!: number;
}

export class UserCashesFilterDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
