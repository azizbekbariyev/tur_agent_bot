import { Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Service } from './service';
import { Cash } from './cash';

@Entity('cash_service')
export class CashService {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Cash, (cash) => cash.services)
  @JoinColumn({ name: 'cash_id' })
  cash!: Cash;

  @ManyToOne(() => Service, (service) => service.cashes)
  @JoinColumn({ name: 'service_id' })
  service!: Service;
}
