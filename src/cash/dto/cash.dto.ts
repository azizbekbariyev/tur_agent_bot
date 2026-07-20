import { IsBoolean, IsDateString, IsOptional, IsString } from 'class-validator';
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

export class CreateCashDto {
  @Type(() => String)
  @IsString()
  cashNumber: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  phoneNumber: string;

  services: number[];
  destination: string;
  departureDate: string;
  returnDate: string;
  passengers: number;
  money: number;
  comment: string;
  paymentType: string;
  currency: string;
}

export class CreatePaymantDto {
  @IsString()
  moneyReseived: string;

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
  type!: string;

  @IsBoolean()
  isActive!: boolean;
}
