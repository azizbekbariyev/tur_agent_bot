import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Service } from './service';
import { PartnerPayment } from './partner_payment';

// Hamkor (tur operator, aviakompaniya va h.k.)
@Entity('partner')
export class Partner {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column({ name: 'is_deleted', default: false })
  isDeleted!: boolean;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  created_at!: Date;

  @OneToMany(() => Service, (service) => service.partner)
  services!: Service[];

  @OneToMany(() => PartnerPayment, (payment) => payment.partner)
  payments!: PartnerPayment[];
}
