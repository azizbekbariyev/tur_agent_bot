import { Column, Entity, PrimaryColumn } from 'typeorm';

// Agentlik sozlamalari - bitta qator (id = 1)
@Entity('app_setting')
export class AppSetting {
  @PrimaryColumn()
  id!: number;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  data!: Record<string, any>;

  @Column({ type: 'bytea', nullable: true, select: false })
  logo!: Buffer | null;

  @Column({ name: 'logo_mime', type: 'varchar', nullable: true })
  logoMime!: string | null;

  // Qarz eslatmalari shu kuni yuborilgan (Toshkent, 'YYYY-MM-DD') - qayta yubormaslik uchun
  @Column({ name: 'last_reminder_date', type: 'varchar', nullable: true })
  lastReminderDate!: string | null;

  // Hamkorlar "Boshlang'ich holat" yozuvlari yaratilgan vaqt (bir martalik ish)
  @Column({ name: 'partner_opening_at', type: 'timestamptz', nullable: true })
  partnerOpeningAt!: Date | null;
}
