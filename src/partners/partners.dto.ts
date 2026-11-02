import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Currency, PaymentType } from '../cash/dto/cash.dto';
import {
  PARTNER_PAYMENT_KINDS,
  type PartnerPaymentKind,
} from '../bot/models/partner_payment';

export class PartnerRangeDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class PartnerPaymentsQueryDto extends PartnerRangeDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  partnerId?: number;

  // PAYMENT (standart) - oddiy to'lovlar; OPENING - "Boshlang'ich holat" yozuvlari
  @IsOptional()
  @IsIn(PARTNER_PAYMENT_KINDS)
  kind?: PartnerPaymentKind;
}

// multipart/form-data - barcha maydonlar matn bo'lib keladi
export class CreatePartnerPaymentDto {
  @Type(() => Number)
  @IsInt()
  partnerId!: number;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsEnum(Currency)
  currency!: Currency;

  @Type(() => Number)
  @IsNumber()
  currency_amount!: number;

  @IsEnum(PaymentType)
  type!: PaymentType;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date YYYY-MM-DD bo‘lishi kerak' })
  date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

// JSON - to'lovni tuzatish (summa xato yozilgan bo'lsa va h.k.)
export class UpdatePartnerPaymentDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  currency_amount?: number;

  @IsOptional()
  @IsEnum(PaymentType)
  type?: PaymentType;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date YYYY-MM-DD bo‘lishi kerak' })
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class PartnerPaymentHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  partnerId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  paymentId?: number;
}
