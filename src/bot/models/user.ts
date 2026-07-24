import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Cash } from './cash';
import { History } from './history';
import { Notification } from './notification';

@Entity('user')
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({
    type: 'bigint',
  })
  telegram_id!: number;

  @Column({
    nullable: true,
  })
  username?: string;

  @Column({
    nullable: true,
  })
  phone_number?: string;

  @Column()
  first_name!: string;

  @Column({
    nullable: true,
  })
  last_name?: string;

  // admin yoki userligi
  @Column({
    type: 'enum',
    enum: ['ADMIN', 'EMPLOYEE'],
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

  @OneToMany(() => History, (history) => history.user)
  history!: History[];

  @OneToMany(() => Notification, (notification) => notification.user)
  notifications!: Notification[];
}
