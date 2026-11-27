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
import { EXTRA_PAYMENT_MODES } from '../../common/contract.constants';

/** Qo'shimcha xizmat (ekskursiya, VIP-zal, Fast Track, SIM-karta ...) */
@Entity('contract_extras')
@Index('IDX_contract_extras_contract_id', ['contractId'])
@Check('CHK_contract_extras_pax', '"pax" IS NULL OR "pax" >= 1')
// Narx faqat «Alohida to'lanadi» uchun; manfiy bo'lmaydi
@Check(
  'CHK_contract_extras_price',
  `("payment_mode" = 'separate' OR "price_usd" IS NULL) AND ("price_usd" IS NULL OR "price_usd" >= 0)`,
)
export class ContractExtra {
  @PrimaryGeneratedColumn({ primaryKeyConstraintName: 'PK_contract_extras' })
  id!: number;

  @Column({ name: 'contract_id', type: 'integer' })
  contractId!: number;

  @ManyToOne(() => Contract, (c) => c.extras, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'contract_id',
    foreignKeyConstraintName: 'FK_contract_extras_contract',
  })
  contract!: Contract;

  @Column({ type: 'smallint' })
  position!: number;

  @Column({ type: 'varchar', length: 200 })
  name!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city!: string | null;

  @Column({ type: 'date', nullable: true })
  date!: string | null;

  @Column({ type: 'smallint', nullable: true })
  pax!: number | null;

  @Column({
    name: 'payment_mode',
    type: 'enum',
    enum: [...EXTRA_PAYMENT_MODES],
    default: 'included',
  })
  paymentMode!: string;

  @Column({
    name: 'price_usd',
    type: 'numeric',
    precision: 15,
    scale: 2,
    nullable: true,
  })
  priceUsd!: string | null;
}
