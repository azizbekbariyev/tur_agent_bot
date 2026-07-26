import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Service } from './service';
import { Cash } from './cash';

@Entity()
export class CashServices {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({
    nullable: true,
  })
  code!: string;

  @Column({
    type: 'numeric',
    precision: 15,
    scale: 2,
  })
  service_amount!: number;

  @Column({
    type: 'numeric',
    precision: 15,
    scale: 2,
  })
  currency_amount!: number;

  @ManyToOne(() => Cash, (cash) => cash.cashServices)
  cash!: Cash;

  @ManyToOne(() => Service, (service) => service.cashServices)
  service!: Service;
}
