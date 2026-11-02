import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Cash } from './cash';
import { Client } from './client';

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
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @ManyToOne(() => Cash, (cash) => cash.passengers)
  cash!: Cash;

  // Telefon raqami bo'yicha bog'langan mijoz kartasi
  @ManyToOne(() => Client, (client) => client.passengers, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'client_id' })
  client?: Client | null;
}
