import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Cash } from './cash';

@Entity('service')
export class Service {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  company_name!: string;

  @Column()
  name!: string;

  @Column({
    type: 'numeric',
    precision: 15,
    scale: 2,
  })
  amount!: string;

  @Column()
  code!: string;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at!: Date;

  @ManyToOne(() => Cash, (cash) => cash.services)
  @JoinColumn({ name: 'cash_id' })
  cash!: Cash;
}
