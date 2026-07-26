import { Column, Entity, OneToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Cash } from './cash';

@Entity()
export class Brutto {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({
    type: 'numeric',
    precision: 15,
    scale: 2,
  })
  amount!: string;

  @Column()
  currency!: string;

  @Column()
  currency_amount!: number;

  @OneToOne(() => Cash, (cash) => cash.brutto)
  cash!: Cash;
}
