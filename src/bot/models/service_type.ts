import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Service } from './service';

@Entity('service_type')
export class ServiceType {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column({ nullable: true })
  color?: string;

  @Column({ default: true })
  is_active!: boolean;

  @OneToMany(() => Service, (service) => service.serviceType)
  services!: Service[];
}
