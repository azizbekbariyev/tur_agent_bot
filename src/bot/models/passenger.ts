import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { PassengerCashMoney } from './passanger_cash_money';

@Entity('passenger')
export class Passenger {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  first_name!: string;

  @Column()
  last_name!: string;

  @Column()
  phone_number!: string;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at!: Date;

  @OneToMany(() => PassengerCashMoney, (pcm) => pcm.passenger)
  cashes!: PassengerCashMoney[];
}
