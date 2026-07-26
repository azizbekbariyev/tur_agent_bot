import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ServiceType } from './service_type';
import { CashServices } from './cash_services';

@Entity('service')
export class Service {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  company_name!: string;

  @Column()
  name!: string;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at!: Date;

  @OneToMany(() => CashServices, (cashServices) => cashServices.service)
  cashServices!: CashServices[];

  @ManyToOne(() => ServiceType, (serviceType) => serviceType.services)
  @JoinColumn({ name: 'service_type_id' })
  serviceType!: ServiceType;
}
