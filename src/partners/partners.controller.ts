import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { requireAdmin, requireManager } from '../common/roles';
import { UserReq } from '../types/user.type';
import { PartnersService } from './partners.service';
import {
  CreatePartnerPaymentDto,
  PartnerPaymentHistoryQueryDto,
  PartnerPaymentsQueryDto,
  PartnerRangeDto,
  UpdatePartnerPaymentDto,
} from './partners.dto';

const RECEIPT_MAX_SIZE = 5 * 1024 * 1024;

// Ko'rish: ADMIN, SUPERADMIN, ACCOUNTANT. To'lov kiritish, tahrirlash, o'chirish: faqat ADMIN/SUPERADMIN
@Controller()
@UseGuards(JwtAuthGuard)
export class PartnersController {
  constructor(private readonly partnersService: PartnersService) {}

  @Get('partners')
  list(@Req() req: { user: UserReq }) {
    requireManager(req.user);
    return this.partnersService.list();
  }

  @Get('partners/balance')
  balance(@Req() req: { user: UserReq }, @Query() query: PartnerRangeDto) {
    requireManager(req.user);
    return this.partnersService.balance(query);
  }

  @Post('partner-payments')
  @UseInterceptors(
    FileInterceptor('receipt', { limits: { fileSize: RECEIPT_MAX_SIZE } }),
  )
  createPayment(
    @Req() req: { user: UserReq },
    @Body() body: CreatePartnerPaymentDto,
    @UploadedFile() receipt?: Express.Multer.File,
  ) {
    requireAdmin(req.user);
    return this.partnersService.createPayment(req.user, body, receipt);
  }

  @Get('partner-payments')
  listPayments(
    @Req() req: { user: UserReq },
    @Query() query: PartnerPaymentsQueryDto,
  ) {
    requireManager(req.user);
    return this.partnersService.listPayments(query);
  }

  // ":id" dan oldin turishi shart
  @Get('partner-payments/history')
  history(
    @Req() req: { user: UserReq },
    @Query() query: PartnerPaymentHistoryQueryDto,
  ) {
    requireManager(req.user);
    return this.partnersService.listHistory(query);
  }

  @Patch('partner-payments/:id')
  updatePayment(
    @Req() req: { user: UserReq },
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdatePartnerPaymentDto,
  ) {
    requireAdmin(req.user);
    return this.partnersService.updatePayment(req.user, id, body);
  }

  @Get('partner-payments/:id/receipt')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Security-Policy', "default-src 'none'")
  async receipt(
    @Req() req: { user: UserReq },
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    requireManager(req.user);
    const file = await this.partnersService.getReceipt(id);
    res.type(file.mime).send(file.data);
  }

  @Delete('partner-payments/:id')
  deletePayment(
    @Req() req: { user: UserReq },
    @Param('id', ParseIntPipe) id: number,
  ) {
    requireAdmin(req.user);
    return this.partnersService.deletePayment(req.user, id);
  }
}
