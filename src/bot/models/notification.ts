import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user';

@Entity('notification')
export class Notification {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  sms!: string;

  @Column({
    type: 'enum',
    enum: ['cash', 'card', 'transfer'],
  })
  type!: string;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at!: Date;

  @ManyToOne(() => User, (user) => user.notifications)
  @JoinColumn({ name: 'user_id' })
  user!: User;
}
