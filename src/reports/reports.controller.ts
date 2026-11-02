import {
  Controller,
  Get,
  Query,
  Req,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { requireManager } from '../common/roles';
import { UserReq } from '../types/user.type';
import { ExportQueryDto } from '../cash/dto/cash.dto';
import { RatesService } from './rates.service';
import { ReportsService } from './reports.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(
    private readonly ratesService: RatesService,
    private readonly reportsService: ReportsService,
  ) {}

  @Get('rates/cbu')
  getCbuRates() {
    return this.ratesService.getCbuRates();
  }

  // Ruxsat: ADMIN, SUPERADMIN, ACCOUNTANT
  @Get('reports/export')
  async export(@Req() req: { user: UserReq }, @Query() query: ExportQueryDto) {
    requireManager(req.user);
    const file = await this.reportsService.export(query);
    return new StreamableFile(file.buffer, {
      type: file.type,
      disposition: `attachment; filename="${file.filename}"`,
    });
  }
}
