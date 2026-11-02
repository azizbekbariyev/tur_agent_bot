import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Passenger } from './passenger';

// Mijoz kartasi. Yo'lovchilar telefon raqami (+998XXXXXXXXX) bo'yicha bog'lanadi
@Entity('client')
export class Client {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'first_name' })
  firstName!: string;

  @Column({ name: 'last_name', type: 'varchar', nullable: true })
  lastName!: string | null;

  @Column({ unique: true })
  phone!: string;

  // Telegram username, '@' siz
  @Column({ type: 'varchar', nullable: true })
  telegram!: string | null;

  // Mijoz botga /start bosganda to'ladi
  @Column({ name: 'telegram_chat_id', type: 'bigint', nullable: true })
  telegramChatId!: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  tags!: string[];

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ name: 'is_deleted', default: false })
  isDeleted!: boolean;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at!: Date;

  @OneToMany(() => Passenger, (passenger) => passenger.client)
  passengers!: Passenger[];
}
