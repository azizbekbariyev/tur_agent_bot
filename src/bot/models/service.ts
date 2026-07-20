import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { CashService } from './cash_service';

@Entity('service')
export class Service {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column()
  amount!: number;

  @Column()
  code!: string;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at!: Date;

  @OneToMany(() => CashService, (cashService) => cashService.service)
  cashes!: CashService[];
}
