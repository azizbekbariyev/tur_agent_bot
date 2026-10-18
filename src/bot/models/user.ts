import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Cash } from './cash';
import { History } from './history';
import { Notification } from './notification';

@Entity('user')
export class User {
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
    unique: true,
    nullable: true,
  })
  email?: string;

  @Column({ name: 'hashed_password', default: '' })
  hashedPassword!: string;

  @Column({
    name: 'hashed_refresh_token',
    nullable: true,
  })
  hashedRefreshToken?: string;

  @Column({
    name: 'telegram_id',
    nullable: true,
    type: 'bigint',
  })
  telegramId?: number;

  // admin yoki userligi
  @Column({
    type: 'enum',
    enum: ['ADMIN', 'EMPLOYEE', 'SUPERADMIN'],
  })
  type!: string;

  @Column({
    type: 'timestamp',
    name: 'created_at',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @Column({
    type: 'boolean',
    default: true,
  })
  status!: boolean;

  @Column({
    type: 'boolean',
    default: false,
    name: 'is_deleted',
  })
  isDeleted!: boolean;

  @OneToMany(() => Cash, (cash) => cash.user)
  cashes!: Cash[];

  @OneToMany(() => Cash, (cash) => cash.additionalUser)
  additionalCashes!: Cash[];

  @OneToMany(() => History, (history) => history.user)
  history!: History[];

  @OneToMany(() => Notification, (notification) => notification.user)
  notifications!: Notification[];

  @ManyToOne(() => User, (user) => user.children, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'parent_id' })
  parent?: User;

  @OneToMany(() => User, (user) => user.parent)
  children!: User[];
}
