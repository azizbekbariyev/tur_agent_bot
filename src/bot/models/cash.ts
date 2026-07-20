import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user';
import { PassengerCashMoney } from './passanger_cash_money';
import { CashService } from './cash_service';

@Entity()
export class Cash {
  @PrimaryGeneratedColumn()
  id!: number;

  // Kassani raqami
  @Column()
  cash_number!: string;

  // Qo'shimcha xodim
  @Column()
  additional_user!: string;

  // Turistlar soni
  @Column()
  turist_count!: number;

  // Uchish vaqti
  @Column()
  departure_date!: string;

  // Qaytish vaqti
  @Column()
  return_date!: string;

  @Column()
  created_at!: Date;

  @Column()
  updated_at!: Date;

  // Kassani izohi
  @Column()
  comment!: string;

  // Kassani status: Qoralama, tasdiqlash kutilmoqda, tasdiqlangan, qarzdor, yopilgan, bekor qilingan, qayta ishlashga yuborilgan
  @Column({
    type: 'enum',
    enum: [
      'draft',
      'pending_approval',
      'approved',
      'due',
      'closed',
      'cancelled',
      'sent_for_rework',
    ],
  })
  status!: string;

  // Qaysi yo'nalishda uchishi
  @Column()
  destination!: string;

  @Column()
  brutto!: number;

  @Column()
  netto!: number;

  @ManyToOne(() => User, (user) => user.cashes)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @OneToMany(() => PassengerCashMoney, (pcm) => pcm.cash)
  passengers!: PassengerCashMoney[];

  @OneToMany(() => CashService, (cs) => cs.cash)
  services!: CashService[];
}
