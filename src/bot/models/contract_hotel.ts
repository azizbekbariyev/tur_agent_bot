import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Contract } from './contract';
import {
  HOTEL_MEALS,
  HOTEL_PLACEMENTS,
  TRANSFER_ROUTES,
  TRANSFER_TYPES,
} from '../../common/contract.constants';

/** Shartnomadagi mehmonxona qatori (transfer ham shu qatorda - har mehmonxonaga alohida) */
@Entity('contract_hotels')
@Index('IDX_contract_hotels_contract_id', ['contractId'])
@Check('CHK_contract_hotels_rooms_count', '"rooms_count" >= 1')
@Check(
  'CHK_contract_hotels_stars',
  '"stars" IS NULL OR "stars" BETWEEN 1 AND 5',
)
@Check(
  'CHK_contract_hotels_dates',
  '"check_in" IS NULL OR "check_out" IS NULL OR "check_out" > "check_in"',
)
export class ContractHotel {
  @PrimaryGeneratedColumn({ primaryKeyConstraintName: 'PK_contract_hotels' })
  id!: number;

  @Column({ name: 'contract_id', type: 'integer' })
  contractId!: number;

  @ManyToOne(() => Contract, (c) => c.hotels, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'contract_id',
    foreignKeyConstraintName: 'FK_contract_hotels_contract',
  })
  contract!: Contract;

  @Column({ type: 'smallint' })
  position!: number;

  @Column({ type: 'varchar', length: 100 })
  city!: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  name!: string | null;

  @Column({ type: 'smallint', nullable: true })
  stars!: number | null;

  // Xona turi: Standard, Deluxe, Suite ... (tanlov ro'yxati - Sozlamalarda)
  @Column({ name: 'room_type', type: 'varchar', length: 100, nullable: true })
  roomType!: string | null;

  @Column({ type: 'enum', enum: [...HOTEL_PLACEMENTS], nullable: true })
  placement!: string | null;

  @Column({ name: 'rooms_count', type: 'smallint', default: 1 })
  roomsCount!: number;

  @Column({ type: 'enum', enum: [...HOTEL_MEALS], nullable: true })
  meal!: string | null;

  @Column({ name: 'check_in', type: 'date', nullable: true })
  checkIn!: string | null;

  @Column({ name: 'check_out', type: 'date', nullable: true })
  checkOut!: string | null;

  @Column({
    name: 'transfer_type',
    type: 'enum',
    enum: [...TRANSFER_TYPES],
    default: 'none',
  })
  transferType!: string;

  // transfer_type = none bo'lsa ishlatilmaydi
  @Column({
    name: 'transfer_route',
    type: 'enum',
    enum: [...TRANSFER_ROUTES],
    nullable: true,
  })
  transferRoute!: string | null;

  // «Ha, har nomer alohida» bosilgan: kutilgan xizmatlar soni = rooms_count
  @Column({ name: 'rooms_separate_confirmed', type: 'boolean', default: false })
  roomsSeparateConfirmed!: boolean;
}
