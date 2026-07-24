import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
  IsArray,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';

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

export class ServiceItemDto {
  @IsString() company_name: string;
  @IsString() name: string;
  @IsNumber() amount: number;
  @IsString() code: string;
}

export class PassengerMoneyDto {
  @IsNumber() amount: number;
  @IsString() currency: string;
  @IsString() payment_type: string;
}

export class PassengerItemDto {
  @IsString() first_name: string;
  @IsString() last_name: string;
  @IsString() phone_number: string;
}

export class CreateCashDto {
  @IsString() cash_number: string;
  @IsString() additional_user: string;
  @IsString() destination: string;
  @IsDateString() departure_date: string;
  @IsDateString() return_date: string;
  @IsString() comment: string;
  @IsNumber() turist_count: number;
  @IsEnum(['draft', 'pending_approval']) status: string;
  @ValidateNested({ each: true })
  @Type(() => ServiceItemDto)
  services: ServiceItemDto[];
  @ValidateNested({ each: true })
  @Type(() => PassengerItemDto)
  passengers: PassengerItemDto[];
  @ValidateNested()
  @Type(() => PassengerMoneyDto)
  moneys: PassengerMoneyDto[];
}

export class CreatePaymantDto {
  @IsString()
  amount: number;

  @IsString()
  comment: string;

  @IsString()
  currency: string;

  @IsString()
  type: string;
}

export class UpdateUserDto {
  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsString()
  phoneNumber!: string;

  @IsString()
  role!: string;

  @IsBoolean()
  isActive!: string;

  @IsString()
  telegramId!: string;
}

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
}

export enum PaymentType {
  CASH = 'CASH',
  CARD = 'CARD',
  TRANSFER = 'TRANSFER',
}

export class UpdatePassengerDto {
  // id bo'lsa — mavjud passengerni yangilaydi, bo'lmasa — yangisini yaratadi.
  @IsOptional()
  @IsInt()
  id?: number;

  @IsString()
  first_name!: string;

  @IsString()
  last_name!: string;

  @IsString()
  phone_number!: string;
}

export class UpdateServiceDto {
  // id bo'lsa — mavjud serviceni yangilaydi, bo'lmasa — yangisini yaratadi.
  @IsOptional()
  @IsInt()
  id?: number;

  @IsString()
  name!: string;

  @IsNumber()
  amount!: number;

  @IsOptional()
  @IsString()
  code?: string;
}

export class UpdateMoneyDto {
  // id bo'lsa — aynan shu to'lov yozuvini yangilaydi.
  // id kelmasa — backend cash bo'yicha OXIRGI to'lov yozuvini topib yangilaydi,
  // agar umuman to'lov yozuvi bo'lmasa — yangisini yaratadi.
  @IsOptional()
  @IsInt()
  id?: number;

  @IsNumber()
  amount!: number;

  @IsEnum(Currency)
  currency!: Currency;

  @IsEnum(PaymentType)
  payment_type!: PaymentType;
}

export class UpdateCashDto {
  @IsOptional()
  @IsString()
  cash_number?: string;

  @IsOptional()
  @IsString()
  additional_user?: string;

  @IsOptional()
  @IsString()
  destination?: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsString()
  departure_date?: string;

  @IsOptional()
  @IsString()
  return_date?: string;

  @IsOptional()
  @IsEnum(CashStatus)
  status?: CashStatus;

  @IsOptional()
  @IsInt()
  turist_count?: number;

  // Faqat o'zgargan yoki yangi qo'shilgan passengerlar keladi (hammasi emas).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdatePassengerDto)
  passengers?: UpdatePassengerDto[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  deletedPassengerIds?: number[];

  // Faqat o'zgargan yoki yangi qo'shilgan servicelar keladi (hammasi emas).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateServiceDto)
  services?: UpdateServiceDto[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  deletedServiceIds?: number[];

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
  @IsString()
  status!: CashStatus;
}

export class CreateUserDto {
  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsString()
  role!: string;

  @IsString()
  isActive!: string;

  @IsString()
  phoneNumber!: string;

  @IsString()
  telegramId!: string;
}
