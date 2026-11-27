import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { PublicRateLimitGuard } from '../common/public-rate-limit.guard';
import { ContractsService } from './contracts.service';

/**
 * QR ochiq sahifa (8-bosqich): LOGINSIZ, faqat o'qish. /api/public/contract/:token
 * - token - versiyaning o'z tokeni (32 bayt tasodifiy); noto'g'ri format ham, topilmasa ham - bir xil 404;
 * - javobda faqat ruxsat etilgan maydonlar (ContractsService.publicView);
 * - IP bo'yicha cheklov (PublicRateLimitGuard) -> 429;
 * - sarlavhalar (no-store, noindex, no-referrer) - ContractsModule middleware'i (404/429 javoblarida ham).
 * JwtAuthGuard YO'Q - ataylab. /api/internal/ bilan aloqasi yo'q.
 */
@Controller('public')
@UseGuards(PublicRateLimitGuard)
export class PublicContractController {
  constructor(private readonly contracts: ContractsService) {}

  @Get('contract/:token')
  view(@Param('token') token: string) {
    return this.contracts.publicView(token);
  }
}
