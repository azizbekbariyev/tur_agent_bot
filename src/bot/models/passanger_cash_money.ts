import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Cash } from './cash';
import { Passenger } from './passenger';
import { Money } from './money';

@Entity('passenger_cash_money')
export class PassengerCashMoney {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at!: Date;

  @ManyToOne(() => Cash, (cash) => cash.passengers)
  @JoinColumn({ name: 'cash_id' })
  cash!: Cash;

  @ManyToOne(() => Passenger, (passenger) => passenger.cashes)
  @JoinColumn({ name: 'passenger_id' })
  passenger!: Passenger;

  @ManyToOne(() => Money, (Money) => Money.cashes)
  @JoinColumn({ name: 'money_id' })
  money!: Money;
}
