import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Cash } from './cash';
import { User } from './user';
import { ContractFlight } from './contract_flight';
import { ContractHotel } from './contract_hotel';
import { ContractExtra } from './contract_extra';
import { ContractVersion } from './contract_version';
import {
  CONTRACT_LANGS,
  CONTRACT_STATUSES,
  INSURANCE_MODES,
  VISA_MODES,
} from '../../common/contract.constants';

/**
 * Shartnoma (kvitansiya). Kassaga 1:1 bog'langan: narx, to'lov, mijoz, sanalar kassadan o'qiladi,
 * bu yerda faqat tur tarkibi va hujjat holati. Jadval migratsiya Shartnoma1764000000000 da yaratiladi.
 */
@Entity('contracts')
@Index('UQ_contracts_cash_id', ['cashId'], { unique: true })
@Index('UQ_contracts_number', ['number'], { unique: true })
@Index('UQ_contracts_public_token', ['publicToken'], { unique: true })
export class Contract {
  @PrimaryGeneratedColumn({ primaryKeyConstraintName: 'PK_contracts' })
  id!: number;

  @Column({ name: 'cash_id', type: 'integer' })
  cashId!: number;

  @ManyToOne(() => Cash, { nullable: false })
  @JoinColumn({
    name: 'cash_id',
    foreignKeyConstraintName: 'FK_contracts_cash',
  })
  cash!: Cash;

  // Dogovor raqami: filial harfi + 6 xona (A000014). Hisoblagich: contract_counter
  @Column({ type: 'varchar', length: 16 })
  number!: string;

  @Column({ type: 'enum', enum: [...CONTRACT_STATUSES], default: 'draft' })
  status!: string;

  // Oxirgi berilgan versiya raqami (0 - hali berilmagan)
  @Column({ name: 'current_version', type: 'integer', default: 0 })
  currentVersion!: number;

  @Column({ type: 'enum', enum: [...CONTRACT_LANGS], default: 'ru' })
  lang!: string;

  @Column({ type: 'enum', enum: [...INSURANCE_MODES], default: 'not_included' })
  insurance!: string;

  @Column({ type: 'enum', enum: [...VISA_MODES], default: 'not_included' })
  visa!: string;

  // QR ochiq sahifa kaliti: 32 bayt tasodifiy, base64url (43 belgi)
  @Column({ name: 'public_token', type: 'varchar', length: 64 })
  publicToken!: string;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({
    name: 'created_by',
    foreignKeyConstraintName: 'FK_contracts_created_by',
  })
  createdBy!: User;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => ContractFlight, (f) => f.contract)
  flights!: ContractFlight[];

  @OneToMany(() => ContractHotel, (h) => h.contract)
  hotels!: ContractHotel[];

  @OneToMany(() => ContractExtra, (e) => e.contract)
  extras!: ContractExtra[];

  @OneToMany(() => ContractVersion, (v) => v.contract)
  versions!: ContractVersion[];
}
