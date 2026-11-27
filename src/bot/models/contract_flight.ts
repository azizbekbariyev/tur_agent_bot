import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Contract } from './contract';

/** Shartnomadagi parvoz qatori. Tartib - position (0, 1, 2 ...) */
@Entity('contract_flights')
@Index('IDX_contract_flights_contract_id', ['contractId'])
@Check('CHK_contract_flights_baggage_pax', '"baggage_pax_count" >= 0')
export class ContractFlight {
  @PrimaryGeneratedColumn({ primaryKeyConstraintName: 'PK_contract_flights' })
  id!: number;

  @Column({ name: 'contract_id', type: 'integer' })
  contractId!: number;

  @ManyToOne(() => Contract, (c) => c.flights, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'contract_id',
    foreignKeyConstraintName: 'FK_contract_flights_contract',
  })
  contract!: Contract;

  @Column({ type: 'smallint' })
  position!: number;

  @Column({ name: 'from_city', type: 'varchar', length: 100 })
  fromCity!: string;

  @Column({ name: 'to_city', type: 'varchar', length: 100 })
  toCity!: string;

  @Column({
    name: 'transit_city',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  transitCity!: string | null;

  // 'YYYY-MM-DD'. Qoralamada bo'sh bo'lishi mumkin
  @Column({ type: 'date', nullable: true })
  date!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  airline!: string | null;

  // Bagaj turi matni: "20+5 kg", "23 kg" ...
  @Column({ name: 'baggage_type', type: 'varchar', length: 50, nullable: true })
  baggageType!: string | null;

  // Bagajli turistlar soni (0 ... turistlar soni; yuqori chegara - tekshiruv funksiyasida)
  @Column({ name: 'baggage_pax_count', type: 'smallint', default: 0 })
  baggagePaxCount!: number;
}
