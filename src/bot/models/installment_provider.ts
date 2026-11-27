import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Bo'lib to'lash provayderlari (banklar, muddatli to'lov tizimlari) - admin Sozlamalarda qo'shadi.
 * O'chirilmaydi, faqat is_active = false: eski to'lovlar provayder nomini yo'qotmasin.
 */
@Entity('installment_providers')
@Index('UQ_installment_providers_name', ['name'], { unique: true })
export class InstallmentProvider {
  @PrimaryGeneratedColumn({
    primaryKeyConstraintName: 'PK_installment_providers',
  })
  id!: number;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
