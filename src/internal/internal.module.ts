import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Cash } from '../bot/models/cash';
import { AuthModule } from '../auth/auth.module';
import { CashModule } from '../cash/cash.module';
import { PartnersModule } from '../partners/partners.module';
import { InternalStatsController } from './internal-stats.controller';
import { InternalStatsService } from './internal-stats.service';

/** Login serveri -> filial ichki so'rovlari (5-bosqich: Superadmin paneli) */
@Module({
  imports: [
    TypeOrmModule.forFeature([Cash]),
    AuthModule,
    CashModule,
    PartnersModule,
  ],
  controllers: [InternalStatsController],
  providers: [InternalStatsService],
})
export class InternalModule {}
