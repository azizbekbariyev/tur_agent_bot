import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Contract } from './contract';
import { User } from './user';
import { VERSION_CHANNELS } from '../../common/contract.constants';

/**
 * Mijozga berilgan kvitansiya nusxasi (v1, v2 ...). snapshot - kvitansiyaga chiqqan hamma narsa
 * (shartlar matni, summalar) shu paytdagidek. Yozilgandan keyin O'ZGARMAYDI va O'CHMAYDI:
 * bazada trigger UPDATE/DELETE/TRUNCATE ni taqiqlaydi (migratsiya Shartnoma1764000000000).
 */
@Entity('contract_versions')
@Index('UQ_contract_versions_contract_version', ['contractId', 'version'], {
  unique: true,
})
@Index('UQ_contract_versions_public_token', ['publicToken'], { unique: true })
export class ContractVersion {
  @PrimaryGeneratedColumn({ primaryKeyConstraintName: 'PK_contract_versions' })
  id!: number;

  @Column({ name: 'contract_id', type: 'integer' })
  contractId!: number;

  // CASCADE yo'q: versiyasi bor shartnomani o'chirib bo'lmaydi
  @ManyToOne(() => Contract, (c) => c.versions, { nullable: false })
  @JoinColumn({
    name: 'contract_id',
    foreignKeyConstraintName: 'FK_contract_versions_contract',
  })
  contract!: Contract;

  @Column({ type: 'integer' })
  version!: number;

  @Column({ type: 'jsonb' })
  snapshot!: Record<string, any>;

  @CreateDateColumn({ name: 'issued_at', type: 'timestamptz' })
  issuedAt!: Date;

  @ManyToOne(() => User, { nullable: false })
  @JoinColumn({
    name: 'issued_by',
    foreignKeyConstraintName: 'FK_contract_versions_issued_by',
  })
  issuedBy!: User;

  @Column({ type: 'enum', enum: [...VERSION_CHANNELS] })
  channel!: string;

  /**
   * QR ochiq sahifa tokeni (8-bosqich): 32 bayt tasodifiy, base64url. Versiya bilan birga yoziladi va o'zgarmaydi -
   * eski qog'ozdagi QR aniq o'sha versiyani ko'rsatadi. Migratsiya ContractVersionToken1764100000000.
   */
  @Column({ name: 'public_token', type: 'varchar', length: 64 })
  publicToken!: string;
}
