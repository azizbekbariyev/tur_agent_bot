import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('user')
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  telegram_id!: number;

  @Column()
  username!: string;

  @Column()
  phone_number!: string;

  @Column()
  full_name!: string;

  @Column()
  first_name!: string;

  @Column()
  last_name!: string;

  @Column()
  type!: string;

  @Column({
    type: 'timestamp',
    default: () => 'CURRENT_TIMESTAMP',
  })
  created_at!: Date;
}
