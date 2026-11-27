import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CashServices } from './cash_services';
import { Contract } from './contract';
import { ContractFlight } from './contract_flight';
import { ContractHotel } from './contract_hotel';
import { ContractExtra } from './contract_extra';
import { LINK_ITEM_TYPES } from '../../common/contract.constants';

/**
 * Kassa xizmati (cash_services qatori) shartnomaning qaysi qatoriga tegishli.
 * - flight: bir xizmat bir nechta parvozga bog'lanishi mumkin (bir nechta yozuv);
 * - hotel: mehmonxona xizmati ham, transfer xizmati ham (shu shahardagi mehmonxona qatoriga);
 * - extra: qo'shimcha xizmat qatori; insurance / visa: qatorsiz, faqat shartnomaga.
 * Har bir havola o'z qatoriga haqiqiy FK bilan (ON DELETE CASCADE): xizmat yoki qator o'chirilsa,
 * bog'lanish ham o'chadi - "yetim" bog'lanish qolmaydi.
 * Bir xil havola ikki marta yozilmasligi: ifodali unique indeks UQ_cscl_item migratsiyada
 * (TypeORM ifodali indeksni bilmaydi - synchronize: false).
 */
@Entity('cash_service_contract_links')
@Index('UQ_cscl_item', { synchronize: false })
@Index('IDX_cscl_cash_service_id', ['cashServiceId'])
@Index('IDX_cscl_contract_id', ['contractId'])
@Check(
  'CHK_cscl_item',
  `("item_type" = 'flight' AND "flight_id" IS NOT NULL AND "hotel_id" IS NULL AND "extra_id" IS NULL)
  OR ("item_type" = 'hotel' AND "hotel_id" IS NOT NULL AND "flight_id" IS NULL AND "extra_id" IS NULL)
  OR ("item_type" = 'extra' AND "extra_id" IS NOT NULL AND "flight_id" IS NULL AND "hotel_id" IS NULL)
  OR ("item_type" IN ('insurance', 'visa') AND "flight_id" IS NULL AND "hotel_id" IS NULL AND "extra_id" IS NULL)`,
)
export class CashServiceContractLink {
  @PrimaryGeneratedColumn({
    primaryKeyConstraintName: 'PK_cash_service_contract_links',
  })
  id!: number;

  @Column({ name: 'cash_service_id', type: 'integer' })
  cashServiceId!: number;

  @ManyToOne(() => CashServices, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'cash_service_id',
    foreignKeyConstraintName: 'FK_cscl_cash_service',
  })
  cashService!: CashServices;

  @Column({ name: 'contract_id', type: 'integer' })
  contractId!: number;

  @ManyToOne(() => Contract, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'contract_id',
    foreignKeyConstraintName: 'FK_cscl_contract',
  })
  contract!: Contract;

  @Column({ name: 'item_type', type: 'enum', enum: [...LINK_ITEM_TYPES] })
  itemType!: string;

  @Column({ name: 'flight_id', type: 'integer', nullable: true })
  flightId!: number | null;

  @ManyToOne(() => ContractFlight, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'flight_id', foreignKeyConstraintName: 'FK_cscl_flight' })
  flight!: ContractFlight | null;

  @Column({ name: 'hotel_id', type: 'integer', nullable: true })
  hotelId!: number | null;

  @ManyToOne(() => ContractHotel, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'hotel_id', foreignKeyConstraintName: 'FK_cscl_hotel' })
  hotel!: ContractHotel | null;

  @Column({ name: 'extra_id', type: 'integer', nullable: true })
  extraId!: number | null;

  @ManyToOne(() => ContractExtra, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'extra_id', foreignKeyConstraintName: 'FK_cscl_extra' })
  extra!: ContractExtra | null;
}
