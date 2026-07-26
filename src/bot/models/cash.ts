import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user';
import { Money } from './money';
import { Passenger } from './passenger';
import { History } from './history';
import { Brutto } from './brutto';
import { CashServices } from './cash_services';

@Entity()
export class Cash {
  @PrimaryGeneratedColumn()
  id!: number;

  // Kassani raqami
  @Column()
  cash_number!: string;

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

  //Servicelarni hamma puli
  @Column({
    type: 'numeric',
    precision: 15,
    scale: 2,
  })
  netto!: string;

  // Qo'shimcha xodim
  @ManyToOne(() => User, (user) => user.additionalCashes)
  @JoinColumn({ name: 'additional_user' })
  additionalUser!: User;

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

  @OneToMany(() => CashServices, (cashServices) => cashServices.cash)
  cashServices!: CashServices[];

  @OneToMany(() => History, (history) => history.cash)
  history!: History[];

  @OneToOne(() => Brutto, (brutto) => brutto.cash, {
    cascade: true,
  })
  @JoinColumn({ name: 'brutto_id' })
  brutto!: Brutto;
}
