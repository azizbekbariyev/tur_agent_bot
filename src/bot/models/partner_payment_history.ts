import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PartnerPayment } from './partner_payment';
import { User } from './user';

const numeric = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};

export type ChangeValue = string | number | null;
export interface PaymentChange {
  old: ChangeValue;
  new: ChangeValue;
}

// Hamkor to'lovini tahrirlash/o'chirish tarixi: kim, qachon, eski -> yangi
@Entity('partner_payment_history')
export class PartnerPaymentHistory {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => PartnerPayment, (p) => p.history, { nullable: false })
  @JoinColumn({ name: 'payment_id' })
  payment!: PartnerPayment;

  // UPDATE | DELETE
  @Column({ type: 'varchar', length: 16 })
  action!: string;

  @Column({
    name: 'old_amount',
    type: 'numeric',
    precision: 15,
    scale: 2,
    nullable: true,
    transformer: numeric,
  })
  oldAmount!: number | null;

  @Column({
    name: 'new_amount',
    type: 'numeric',
    precision: 15,
    scale: 2,
    nullable: true,
    transformer: numeric,
  })
  newAmount!: number | null;

  // O'zgargan maydonlar: { field: { old, new } }
  @Column({ type: 'jsonb', default: () => "'{}'" })
  changes!: Record<string, PaymentChange>;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user!: User | null;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at!: Date;
}
