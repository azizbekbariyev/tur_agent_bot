import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Cash } from './cash';
import { InstallmentProvider } from './installment_provider';
import {
  PAYMENT_SOURCES,
  PAYMENT_TYPES,
} from '../../common/contract.constants';

// Bo'lib to'lashda provayder majburiy, boshqa turlarda bo'lmaydi
@Check(
  'CHK_money_installment_provider',
  `("type" = 'INSTALLMENT') = ("provider_id" IS NOT NULL)`,
)
@Entity('money')
export class Money {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({
    type: 'numeric',
    precision: 15,
    scale: 2,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  money_received!: number;

  // Avval CASH / CARD / TRANSFER edi; migratsiya Shartnoma1764000000000 CARD va TRANSFER ni CARD_TRANSFER ga o'tkazdi
  @Column({
    type: 'enum',
    enum: [...PAYMENT_TYPES],
  })
  type!: string;

  @Column({
    type: 'enum',
    enum: ['UZS', 'USD', 'EUR'],
  })
  currency!: string;

  // Kurs: 1 USD/EUR = necha so'm (UZS uchun 1). So'mdagi summa saqlanmaydi - money_received × kurs
  @Column({
    type: 'numeric',
    precision: 15,
    scale: 2,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => parseFloat(value),
    },
  })
  currency_amount!: number;

  @ManyToOne(() => Cash, (cash) => cash.moneys)
  @JoinColumn({ name: 'cash_id' })
  cash!: Cash;

  // Faqat INSTALLMENT uchun: qaysi bank / muddatli to'lov tizimi
  @ManyToOne(() => InstallmentProvider, { nullable: true })
  @JoinColumn({
    name: 'provider_id',
    foreignKeyConstraintName: 'FK_money_provider',
  })
  provider?: InstallmentProvider | null;

  // manual - kassadagi «To'lov» oynasi; contract_create - yangi shartnoma yaratilganda
  @Column({
    type: 'enum',
    enum: [...PAYMENT_SOURCES],
    default: 'manual',
  })
  source!: string;

  @Column({
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at!: Date;
}
