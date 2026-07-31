import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Cash } from './cash';

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

  @Column({
    type: 'enum',
    enum: ['CASH', 'CARD', 'TRANSFER'],
  })
  type!: string;

  @Column({
    type: 'enum',
    enum: ['UZS', 'USD', 'EUR'],
  })
  currency!: string;

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

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at!: Date;
}
