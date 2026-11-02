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

  // 1 USD/EUR = necha so'm. Avval integer edi - BruttoRateNumeric migratsiyasi o'zgartiradi
  @Column({
    type: 'numeric',
    precision: 15,
    scale: 2,
    transformer: {
      to: (value: number) => value,
      from: (value: string | null) => (value === null ? null : Number(value)),
    },
  })
  currency_amount!: number;

  @OneToOne(() => Cash, (cash) => cash.brutto)
  cash!: Cash;
}
