import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { User } from './user';

/**
 * Kirish sessiyasi: har bir kirish (brauzer) uchun bitta yozuv.
 * "Chiqish", bloklash, o'chirish va parol almashtirish sessiyani bekor qiladi -
 * shundan keyin uning tokenlari ishlamaydi (guard har so'rovda tekshiradi).
 * Refresh tokenning o'zi saqlanmaydi, faqat sha256 hashi.
 */
@Entity('user_session')
export class UserSession {
  // crypto.randomUUID() - bazada uuid kengaytmasi kerak emas
  @PrimaryColumn('uuid')
  id!: string;

  @Index()
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'refresh_hash', type: 'varchar', length: 64 })
  refreshHash!: string;

  // Bir nechta tab bir vaqtda yangilasa: oldingi token qisqa muddat qabul qilinadi
  @Column({
    name: 'prev_refresh_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  prevRefreshHash!: string | null;

  @Column({ name: 'rotated_at', type: 'timestamptz', nullable: true })
  rotatedAt!: Date | null;

  @Column({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  createdAt!: Date;

  @Column({
    name: 'last_used_at',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  lastUsedAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'user_agent', type: 'varchar', length: 300, nullable: true })
  userAgent!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip!: string | null;
}
