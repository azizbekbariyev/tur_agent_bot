import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Cash } from './cash';

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

  @ManyToOne(() => Cash, (cash) => cash.passengers)
  cash!: Cash;
}
