import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Partner } from './partner';
import { User } from './user';
import { PartnerPaymentHistory } from './partner_payment_history';

/** PAYMENT - oddiy to'lov; OPENING - tizim yozuvi "Boshlang'ich holat" */
export const PARTNER_PAYMENT_KINDS = ['PAYMENT', 'OPENING'] as const;
export type PartnerPaymentKind = (typeof PARTNER_PAYMENT_KINDS)[number];

const numeric = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

// Agentlikdan hamkorga qilingan to'lov
@Entity('partner_payment')
export class PartnerPayment {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Partner, (partner) => partner.payments)
  @JoinColumn({ name: 'partner_id' })
  partner!: Partner;

  @Column({ type: 'numeric', precision: 15, scale: 2, transformer: numeric })
  amount!: number;

  @Column({ type: 'enum', enum: ['UZS', 'USD', 'EUR'] })
  currency!: string;

  // 1 USD/EUR = necha so'm (UZS uchun 1)
  @Column({ type: 'numeric', precision: 15, scale: 2, transformer: numeric })
  currency_amount!: number;

  @Column({ type: 'varchar', length: 16, default: 'PAYMENT' })
  kind!: PartnerPaymentKind;

  // Boshlang'ich holat yozuvida to'lov turi yo'q
  @Column({ type: 'enum', enum: ['CASH', 'CARD', 'TRANSFER'], nullable: true })
  type!: string | null;

  // To'lov sanasi, 'YYYY-MM-DD'
  @Column({ type: 'date' })
  date!: string;

  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  // Chek rasmi
  @Column({ type: 'bytea', nullable: true, select: false })
  receipt!: Buffer | null;

  @Column({ name: 'receipt_mime', type: 'varchar', nullable: true })
  receiptMime!: string | null;

  @Column({ name: 'is_deleted', default: false })
  isDeleted!: boolean;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at!: Date;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  createdBy!: User | null;

  @OneToMany(() => PartnerPaymentHistory, (h) => h.payment)
  history!: PartnerPaymentHistory[];
}
