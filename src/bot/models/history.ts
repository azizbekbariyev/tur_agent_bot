import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user';
import { Cash } from './cash';

@Entity('history')
export class History {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column()
  new_column!: string;

  @Column()
  old_column!: string;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at!: Date;

  @ManyToOne(() => User, (user) => user.history)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @ManyToOne(() => Cash, (cash) => cash.history, { nullable: true })
  @JoinColumn({ name: 'cash_id' })
  cash?: Cash;
}
