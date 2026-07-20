import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { PassengerCashMoney } from './passanger_cash_money';

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
    enum: ['cash', 'card', 'transfer'],
  })
  type!: string;

  //valyuta
  @Column({
    type: 'enum',
    enum: ['uzs', 'usd', 'eur'],
  })
  currency!: string;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at!: Date;

  @OneToMany(() => PassengerCashMoney, (pcm) => pcm.money)
  cashes!: PassengerCashMoney[];
}
