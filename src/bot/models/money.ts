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

  //qabul qilingan pul
  @Column()
  money_received!: number;

  //turi naqt, karta yoki o'tkazma orqali
  @Column({
    type: 'enum',
    enum: ['CASH', 'CARD', 'TRANSFER'],
  })
  type!: string;

  //valyuta
  @Column({
    type: 'enum',
    enum: ['UZS', 'USD', 'EUR'],
  })
  currency!: string;

  @ManyToOne(() => Cash, (cash) => cash.moneys)
  @JoinColumn({ name: 'cash_id' })
  cash!: Cash;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at!: Date;
}
