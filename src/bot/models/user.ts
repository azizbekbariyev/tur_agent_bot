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

  @Column()
  first_name!: string;

  @Column({
    nullable: true,
  })
  last_name?: string;

  @Column({
    unique: true,
  })
  email!: string;

  @Column()
  hashed_password!: string;

  @Column({
    nullable: true,
  })
  hashed_refresh_token?: string;

  // admin yoki userligi
  @Column({
    type: 'enum',
    enum: ['ADMIN', 'EMPLOYEE', 'SUPERADMIN'],
  })
  type!: string;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at!: Date;

  @Column({
    type: 'boolean',
    default: true,
  })
  status!: boolean;

  @Column({
    type: 'boolean',
    default: false,
  })
  is_deleted!: boolean;

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
