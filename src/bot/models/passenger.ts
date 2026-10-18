import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Cash } from './cash';

@Entity('passenger')
export class Passenger {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'first_name' })
  firstName!: string;

  @Column({
    name: 'last_name',
    nullable: true,
  })
  lastName?: string;

  @Column({
    name: 'phone_number',
    nullable: true,
  })
  phoneNumber?: string;

  @Column({
    name: 'created_at',
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @ManyToOne(() => Cash, (cash) => cash.passengers)
  cash!: Cash;
}
