import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contract } from '../bot/models/contract';
import { ContractFlight } from '../bot/models/contract_flight';
import { ContractHotel } from '../bot/models/contract_hotel';
import { ContractExtra } from '../bot/models/contract_extra';
import { ContractVersion } from '../bot/models/contract_version';
import { ContractCounter } from '../bot/models/contract_counter';
import { CashServiceContractLink } from '../bot/models/cash_service_contract_link';
import { InstallmentProvider } from '../bot/models/installment_provider';
import { JwtService } from '@nestjs/jwt';
import { CashModule } from '../cash/cash.module';
import { SettingsModule } from '../settings/settings.module';
import { BotModule } from '../bot/bot.module';
import { ContractsController } from './contracts.controller';
import { PublicContractController } from './public-contract.controller';
import { PublicRateLimitGuard } from '../common/public-rate-limit.guard';
import { ContractsService } from './contracts.service';

/** Shartnoma bo'limi: jadvallar, API, rollar, tekshiruv (docs/shartnoma.md) */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Contract,
      ContractFlight,
      ContractHotel,
      ContractExtra,
      ContractVersion,
      ContractCounter,
      CashServiceContractLink,
      InstallmentProvider,
    ]),
    CashModule,
    SettingsModule,
    BotModule,
  ],
  controllers: [ContractsController, PublicContractController],
  providers: [ContractsService, JwtService, PublicRateLimitGuard],
})
export class ContractsModule implements NestModule {
  /** Ochiq sahifa javoblari (200, 404, 429 - hammasi): keshlanmaydi, indekslanmaydi, referer yuborilmaydi */
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply((_req: Request, res: Response, next: NextFunction) => {
        res.set({
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex, nofollow',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
        });
        next();
      })
      .forRoutes(PublicContractController);
  }
}
