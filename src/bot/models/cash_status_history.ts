import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Cash } from './cash';
import { User } from './user';

// Kassa holatining har bir o'zgarishi (kassa sahifasidagi "Holat tarixi")
@Entity('cash_status_history')
export class CashStatusHistory {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  status!: string;

  // sent_for_rework / cancelled da sabab
  @Column({ type: 'text', nullable: true })
  comment!: string | null;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at!: Date;

  @ManyToOne(() => Cash, (cash) => cash.statusHistory, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cash_id' })
  cash!: Cash;

  // null - tizim (masalan, avtomatik yopish)
  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'changed_by' })
  changedByUser!: User | null;
}
