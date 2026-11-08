import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Cash } from './cash';
import { History } from './history';
import { Notification } from './notification';

// Unique indekslar migratsiyada qo'lda yaratiladi (lower(username) - TypeORM ifodali indeksni bilmaydi):
// UQ_user_username_lower ON (lower(username)), UQ_user_account_id ON (account_id).
// synchronize: false - synchronize ularni yaratmaydi ham, o'chirmaydi ham
@Index('UQ_user_username_lower', { synchronize: false })
@Index('UQ_user_account_id', { synchronize: false })
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

  // Kirish uchun, kichik harflarda (common/username.ts). Migratsiya: UserUsername1762600000000
  @Column({ type: 'varchar', length: 30, nullable: true })
  username!: string | null;

  // Login serveridagi akkaunt (keyingi bosqichda bog'lanadi)
  @Column({ name: 'account_id', type: 'varchar', length: 64, nullable: true })
  accountId!: string | null;

  @Column({ name: 'hashed_password', default: '', select: false })
  hashedPassword!: string;

  @Column({
    name: 'hashed_refresh_token',
    nullable: true,
    select: false,
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
    enum: ['ADMIN', 'EMPLOYEE', 'SUPERADMIN', 'ACCOUNTANT'],
  })
  type!: string;

  @Column({
    type: 'timestamptz',
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

  // Oylik foyda maqsadi (so'm). null bo'lsa settings.monthlyTarget ishlatiladi
  @Column({
    name: 'monthly_target',
    type: 'numeric',
    precision: 15,
    scale: 2,
    nullable: true,
    transformer: {
      to: (value?: number | null) => value,
      from: (value: string | null) => (value === null ? null : Number(value)),
    },
  })
  monthlyTarget!: number | null;

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
