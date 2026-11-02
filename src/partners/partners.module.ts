import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Partner } from '../bot/models/partner';
import { PartnerPayment } from '../bot/models/partner_payment';
import { PartnerPaymentHistory } from '../bot/models/partner_payment_history';
import { Service } from '../bot/models/service';
import { PartnersService } from './partners.service';
import { PartnersController } from './partners.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Partner,
      PartnerPayment,
      PartnerPaymentHistory,
      Service,
    ]),
  ],
  controllers: [PartnersController],
  providers: [PartnersService, JwtService],
  exports: [PartnersService],
})
export class PartnersModule {}
