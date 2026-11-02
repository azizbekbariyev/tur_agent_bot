import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Cash } from '../bot/models/cash';
import { PartnerPayment } from '../bot/models/partner_payment';
import { SettingsModule } from '../settings/settings.module';
import { RatesService } from './rates.service';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Cash, PartnerPayment]), SettingsModule],
  controllers: [ReportsController],
  providers: [RatesService, ReportsService, JwtService],
})
export class ReportsModule {}
