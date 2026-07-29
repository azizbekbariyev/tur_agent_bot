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
} from 'class-validator';
import { Type } from 'class-transformer';

export enum CashStatus {
  DRAFT = 'draft',
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
  CLOSED = 'closed',
  CANCELLED = 'cancelled',
  SENT_FOR_REWORK = 'sent_for_rework',
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
  ADMIN = 'ADMIN',
  EMPLOYEE = 'EMPLOYEE',
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

export class CashesFilterDto {
  @IsOptional()
  @Type(() => String)
  @IsString()
  cashNumber?: string;

  @IsOptional()
  @Type(() => String)
  status?: string;
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
  first_name!: string;

  @IsString()
  last_name!: string;

  @IsOptional()
  @IsString()
  phone_number?: string;
}

export class CreateCashDto {
  @IsString()
  cash_number!: string;

  // YANGI: endi qo'shimcha xodim ham haqiqiy User (FK), erkin matn emas.
  @IsOptional()
  @IsInt()
  additional_user_id?: number;

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

export class UpdatePassengerDto {
  @IsOptional()
  @IsInt()
  id?: number;

  @IsString()
  first_name!: string;

  @IsString()
  last_name!: string;

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

  @IsOptional()
  @IsInt()
  additional_user_id?: number;

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
}

export class CreateUserDto {
  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsEnum(UserRole)
  role!: UserRole;

  @IsEnum(UserStatus)
  isActive!: UserStatus;

  @IsString()
  phoneNumber!: string;

  @IsString()
  telegramId!: string;
}

export class UpdateUserDto {
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
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  @IsOptional()
  @IsString()
  telegramId?: string;
}

// ---- ServiceType / Service (katalog) ----
export class CreateServiceTypeDto {
  @IsString()
  name!: string;
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
