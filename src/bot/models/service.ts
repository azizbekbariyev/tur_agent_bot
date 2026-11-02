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
import { Partner } from './partner';

@Entity('service')
export class Service {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  company_name!: string;

  @Column()
  name!: string;

  @Column({
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at!: Date;

  @Column({ default: true })
  is_active!: boolean;

  @OneToMany(() => CashServices, (cashServices) => cashServices.service)
  cashServices!: CashServices[];

  // company_name matni o'rniga alohida hamkor yozuvi (eski ma'lumotlar ishga tushganda bog'lanadi)
  @ManyToOne(() => Partner, (partner) => partner.services, { nullable: true })
  @JoinColumn({ name: 'partner_id' })
  partner?: Partner | null;

  @ManyToOne(() => ServiceType, (serviceType) => serviceType.services)
  @JoinColumn({ name: 'service_type_id' })
  serviceType!: ServiceType;
}
