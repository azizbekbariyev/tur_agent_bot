import { Controller, Get, Header, Headers, Query } from '@nestjs/common';
import { OidcService } from '../auth/oidc.service';
import {
  InternalStatsService,
  type EmployeeStatsQuery,
  type StatsQuery,
} from './internal-stats.service';

export const STATS_TOKEN_TYP = 'stats+jwt';

/**
 * Login serveri -> filial (server-server): Superadmin paneli statistikasi.
 * Faqat login serverining xizmat kaliti bilan imzolangan token (TZ 12) - foydalanuvchi
 * cookie'si yoki filial tokeni bilan ochilmaydi. Production'da nginx bu yo'lni tashqaridan yopadi.
 */
@Controller('internal')
export class InternalStatsController {
  constructor(
    private readonly oidc: OidcService,
    private readonly stats: InternalStatsService,
  ) {}

  @Get('stats')
  @Header('Cache-Control', 'no-store')
  async getStats(
    @Headers('authorization') authorization: string | undefined,
    @Query() query: StatsQuery,
  ) {
    // Avval token, keyin so'rov parametrlari (tokensiz so'rovga hech qanday xato tafsiloti yo'q)
    await this.oidc.verifyServiceToken(authorization, STATS_TOKEN_TYP);
    return this.stats.stats(query);
  }

  /** 5.3: bitta xodimning statistikasi (xodim kartasi) - xuddi shu xizmat tokeni bilan */
  @Get('stats/employee')
  @Header('Cache-Control', 'no-store')
  async getEmployeeStats(
    @Headers('authorization') authorization: string | undefined,
    @Query() query: EmployeeStatsQuery,
  ) {
    await this.oidc.verifyServiceToken(authorization, STATS_TOKEN_TYP);
    return this.stats.employeeStats(query);
  }
}
