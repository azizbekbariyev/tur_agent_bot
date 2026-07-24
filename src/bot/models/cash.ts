import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user';
import { Money } from './money';
import { Passenger } from './passenger';
import { Service } from './service';
import { History } from './history';

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

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at!: Date;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
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
      'closed',
      'cancelled',
      'sent_for_rework',
    ],
  })
  status!: string;

  // Qaysi yo'nalishda uchishi
  @Column()
  destination!: string;

  @Column({
    type: 'numeric',
    precision: 15,
    scale: 2,
  })
  brutto!: string;

  @Column({
    type: 'numeric',
    precision: 15,
    scale: 2,
  })
  netto!: string;

  @ManyToOne(() => User, (user) => user.cashes)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @OneToMany(() => Money, (money) => money.cash, {
    cascade: true,
  })
  moneys!: Money[];

  @OneToMany(() => Passenger, (passenger) => passenger.cash, {
    cascade: true,
  })
  passengers!: Passenger[];

  @OneToMany(() => Service, (service) => service.cash)
  services!: Service[];

  @OneToMany(() => History, (history) => history.cash)
  history!: History[];
}
