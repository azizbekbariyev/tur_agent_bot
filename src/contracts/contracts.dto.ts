import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  CONTRACT_LANGS,
  CONTRACT_STATUSES,
  EXTRA_PAYMENT_MODES,
  HOTEL_MEALS,
  HOTEL_PLACEMENTS,
  INSURANCE_MODES,
  LINK_ITEM_TYPES,
  TRANSFER_ROUTES,
  TRANSFER_TYPES,
  VERSION_CHANNELS,
  VISA_MODES,
} from '../common/contract.constants';
import {
  BruttoDto,
  CreatePaymantDto,
  PassengerItemDto,
} from '../cash/dto/cash.dto';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MSG = { message: "sana 'YYYY-MM-DD' ko'rinishida bo'lishi kerak" };
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
/** Bo'sh matn -> null (ixtiyoriy maydonlar) */
const trimOrNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

/* ------------------------------ tur tarkibi qatorlari ------------------------------ */
// id bor - mavjud qator yangilanadi (kassa xizmatlari bog'lanishi saqlanadi); id yo'q - yangi qator;
// ro'yxatda yo'q qator - o'chiriladi. Tartib - ro'yxatdagi o'rni.

export class FlightRowDto {
  @IsOptional()
  @IsInt()
  id?: number;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  fromCity!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  toCity!: string;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(100)
  transitCity?: string | null;

  @IsOptional()
  @Matches(DAY_RE, DAY_MSG)
  date?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(100)
  airline?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(50)
  baggageType?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  baggagePaxCount?: number;
}

export class HotelRowDto {
  @IsOptional()
  @IsInt()
  id?: number;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  city!: string;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(200)
  name?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  stars?: number | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(100)
  roomType?: string | null;

  @IsOptional()
  @IsIn([...HOTEL_PLACEMENTS])
  placement?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(99)
  roomsCount?: number;

  @IsOptional()
  @IsIn([...HOTEL_MEALS])
  meal?: string | null;

  @IsOptional()
  @Matches(DAY_RE, DAY_MSG)
  checkIn?: string | null;

  @IsOptional()
  @Matches(DAY_RE, DAY_MSG)
  checkOut?: string | null;

  @IsOptional()
  @IsIn([...TRANSFER_TYPES])
  transferType?: string;

  @IsOptional()
  @IsIn([...TRANSFER_ROUTES])
  transferRoute?: string | null;
}

export class ExtraRowDto {
  @IsOptional()
  @IsInt()
  id?: number;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @Transform(trimOrNull)
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @IsOptional()
  @Matches(DAY_RE, DAY_MSG)
  date?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  pax?: number | null;

  @IsOptional()
  @IsIn([...EXTRA_PAYMENT_MODES])
  paymentMode?: string;

  // Faqat «Alohida to'lanadi» uchun
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  priceUsd?: number | null;
}

/** Tur tarkibi (yangi shartnoma va tahrirlash uchun bir xil) */
export class ContractBodyDto {
  @IsOptional()
  @IsIn([...CONTRACT_LANGS])
  lang?: string;

  @IsOptional()
  @IsIn([...INSURANCE_MODES])
  insurance?: string;

  @IsOptional()
  @IsIn([...VISA_MODES])
  visa?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => FlightRowDto)
  flights?: FlightRowDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => HotelRowDto)
  hotels?: HotelRowDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ExtraRowDto)
  extras?: ExtraRowDto[];
}

/* ------------------------------ yangi shartnoma + kassa ------------------------------ */

/** Kassa ma'lumoti (Yangi shartnoma, 1-2 bloklar). Holat doim Qoralama, xizmatlar - keyin kassada */
export class NewContractCashDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  destination!: string;

  @IsDateString()
  departure_date!: string;

  @IsDateString()
  return_date!: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsDateString()
  created_at?: string;

  @IsOptional()
  @IsInt()
  additional_user_id?: number | null;

  @IsInt()
  @Min(1)
  turist_count!: number;

  @ValidateNested()
  @Type(() => BruttoDto)
  brutto!: BruttoDto;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PassengerItemDto)
  passengers!: PassengerItemDto[];
}

export class CreateContractWithCashDto {
  @ValidateNested()
  @Type(() => NewContractCashDto)
  cash!: NewContractCashDto;

  @ValidateNested()
  @Type(() => ContractBodyDto)
  contract!: ContractBodyDto;

  // Turistning to'lovi (4-blok): kassaga mavjud to'lov mantiqi orqali tushadi, manba - contract_create
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CreatePaymantDto)
  payments?: CreatePaymantDto[];
}

export class CreateContractForCashDto {
  @ValidateNested()
  @Type(() => ContractBodyDto)
  contract!: ContractBodyDto;
}

/* ------------------------------ boshqa amallar ------------------------------ */

export class IssueContractDto {
  @IsIn([...VERSION_CHANNELS])
  channel!: string;

  @IsOptional()
  @IsIn([...CONTRACT_LANGS])
  lang?: string;
}

export class SendContractTelegramDto {
  @IsOptional()
  @IsIn([...CONTRACT_LANGS])
  lang?: string;
}

/** Jonli ko'rinish: forma holati (kvitansiya mazmuni). Ichki tuzilishni receipt-model o'zi tekshiradi */
export class ReceiptPreviewDto {
  @IsIn([...CONTRACT_LANGS])
  lang!: string;

  @IsObject()
  content!: Record<string, unknown>;
}

export class LinkItemDto {
  @IsIn([...LINK_ITEM_TYPES])
  type!: string;

  // flight / hotel / extra uchun qator id'si; insurance / visa uchun berilmaydi
  @IsOptional()
  @IsInt()
  id?: number;
}

export class SetServiceLinksDto {
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => LinkItemDto)
  items!: LinkItemDto[];
}

export class RoomsSeparateDto {
  @IsBoolean()
  confirmed!: boolean;
}

export class ContractListQueryDto {
  // + 'debt' - qoldig'i bor
  @IsOptional()
  @IsIn([...CONTRACT_STATUSES, 'debt', 'ALL'])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  /** Dogovor sanasi oralig'i (Toshkent kuni, YYYY-MM-DD) */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}

export class ContractExportQueryDto extends ContractListQueryDto {
  @IsOptional()
  @IsIn([...CONTRACT_LANGS])
  lang?: string;
}

/** Shablon matnlari bilan standart 4+4+2 kvitansiya bitta sahifaga sig'adimi (saqlashdan oldin) */
export class TemplateFitDto {
  @IsOptional()
  @IsObject()
  warning?: { ru?: string; uz?: string };

  @IsOptional()
  @IsObject()
  terms?: { ru?: string[]; uz?: string[] };
}

export class CreateProviderDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}

export class UpdateProviderDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/* ------------------------------ saqlamasdan tekshirish va takliflar ------------------------------ */

export class PreviewTourDto {
  @IsOptional()
  @Matches(DAY_RE, DAY_MSG)
  departureDate?: string | null;

  @IsOptional()
  @Matches(DAY_RE, DAY_MSG)
  returnDate?: string | null;

  @IsInt()
  @Min(1)
  @Max(999)
  tourists!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  passengers?: number;
}

/**
 * contractId bor - mavjud shartnoma (kassa va xizmat bog'lanishlari bilan, solishtirish ham);
 * yo'q - yangi shartnoma formasi: faqat tur ma'lumoti (tour) va ichki tekshiruv.
 */
export class CheckPreviewDto {
  @IsOptional()
  @IsInt()
  contractId?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => PreviewTourDto)
  tour?: PreviewTourDto;

  @ValidateNested()
  @Type(() => ContractBodyDto)
  contract!: ContractBodyDto;
}

export class HotelNamesQueryDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  q?: string;
}
