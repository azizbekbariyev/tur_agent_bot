import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { UserReq } from '../types/user.type';
import { ContractsService } from './contracts.service';
import {
  CheckPreviewDto,
  ContractBodyDto,
  ContractExportQueryDto,
  ContractListQueryDto,
  CreateContractForCashDto,
  CreateContractWithCashDto,
  CreateProviderDto,
  HotelNamesQueryDto,
  IssueContractDto,
  ReceiptPreviewDto,
  RoomsSeparateDto,
  SendContractTelegramDto,
  TemplateFitDto,
  SetServiceLinksDto,
  UpdateProviderDto,
} from './contracts.dto';

type AuthReq = { user: UserReq };

// Rol bo'yicha cheklovlar ContractsService ichida (backendda majburiy)
@Controller()
@UseGuards(JwtAuthGuard)
export class ContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Get('contracts')
  list(@Req() req: AuthReq, @Query() q: ContractListQueryDto) {
    return this.contracts.list(req.user, q);
  }

  /** «Excel'ga yuklash» - joriy filtr bo'yicha */
  @Get('contracts/export')
  async exportList(
    @Req() req: AuthReq,
    @Query() q: ContractExportQueryDto,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.contracts.exportList(req.user, q);
    res
      .set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      })
      .send(buffer);
  }

  /** Sozlamalar: shablon matni bilan standart 4+4+2 kvitansiya bitta sahifaga sig'adimi (faqat admin) */
  @Post('contracts/template-fit')
  templateFit(@Req() req: AuthReq, @Body() body: TemplateFitDto) {
    return this.contracts.templateFit(req.user, body);
  }

  @Get('contracts/next-number')
  nextNumber(@Req() req: AuthReq) {
    return this.contracts.nextNumber(req.user);
  }

  /** Saqlamasdan tekshirish (bazaga yozilmaydi) */
  @Post('contracts/check-preview')
  checkPreview(@Req() req: AuthReq, @Body() body: CheckPreviewDto) {
    return this.contracts.checkPreview(req.user, body);
  }

  /** Jonli kvitansiya ko'rinishi (PDF bilan bir xil matn funksiyasi; bazaga yozilmaydi) */
  @Post('contracts/receipt-preview')
  receiptPreview(@Req() req: AuthReq, @Body() body: ReceiptPreviewDto) {
    return this.contracts.receiptPreview(req.user, body);
  }

  /** Mehmonxona nomi takliflari (shahar + yozilgan harflar, 10 tagacha) */
  @Get('contracts/hotel-names')
  hotelNames(@Req() req: AuthReq, @Query() q: HotelNamesQueryDto) {
    return this.contracts.hotelNames(req.user, q);
  }

  /** «+ Yangi shartnoma»: kassa (Qoralama) + shartnoma + to'lovlar - bitta tranzaksiya */
  @Post('contracts')
  createWithCash(@Req() req: AuthReq, @Body() body: CreateContractWithCashDto) {
    return this.contracts.createWithCash(req.user, body);
  }

  @Get('contracts/:id')
  get(@Req() req: AuthReq, @Param('id', ParseIntPipe) id: number) {
    return this.contracts.get(req.user, id);
  }

  @Patch('contracts/:id')
  update(
    @Req() req: AuthReq,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ContractBodyDto,
  ) {
    return this.contracts.update(req.user, id, body);
  }

  @Post('contracts/:id/issue')
  issue(
    @Req() req: AuthReq,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: IssueContractDto,
  ) {
    return this.contracts.issue(req.user, id, body);
  }

  /** Telegram: mijozga yuborish (versiya yoziladi) */
  @Post('contracts/:id/telegram')
  sendTelegram(
    @Req() req: AuthReq,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SendContractTelegramDto,
  ) {
    return this.contracts.sendTelegram(req.user, id, body);
  }

  @Post('contracts/:id/sign')
  sign(@Req() req: AuthReq, @Param('id', ParseIntPipe) id: number) {
    return this.contracts.sign(req.user, id);
  }

  /** :version - raqam yoki 'latest' */
  @Get('contracts/:id/versions/:version')
  version(
    @Req() req: AuthReq,
    @Param('id', ParseIntPipe) id: number,
    @Param('version') version: string,
  ) {
    return this.contracts.version(req.user, id, version);
  }

  /** Versiya PDF'i (:version - raqam yoki 'latest'); ?lang=ru|uz */
  @Get('contracts/:id/versions/:version/pdf')
  async versionPdf(
    @Req() req: AuthReq,
    @Param('id', ParseIntPipe) id: number,
    @Param('version') version: string,
    @Query('lang') lang: string | undefined,
    @Res() res: Response,
  ) {
    const { pdf, filename } = await this.contracts.versionPdf(
      req.user,
      id,
      version,
      lang,
    );
    res
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Content-Length': String(pdf.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(pdf);
  }

  @Put('contracts/:id/services/:cashServiceId/links')
  setLinks(
    @Req() req: AuthReq,
    @Param('id', ParseIntPipe) id: number,
    @Param('cashServiceId', ParseIntPipe) cashServiceId: number,
    @Body() body: SetServiceLinksDto,
  ) {
    return this.contracts.setServiceLinks(req.user, id, cashServiceId, body);
  }

  @Put('contracts/:id/hotels/:hotelId/rooms-separate')
  roomsSeparate(
    @Req() req: AuthReq,
    @Param('id', ParseIntPipe) id: number,
    @Param('hotelId', ParseIntPipe) hotelId: number,
    @Body() body: RoomsSeparateDto,
  ) {
    return this.contracts.setRoomsSeparate(req.user, id, hotelId, body);
  }

  /** Kassa sahifasi: shartnoma (bo'lmasa { contract: null }) va solishtirish */
  @Get('cash/:id/contract')
  byCash(@Req() req: AuthReq, @Param('id', ParseIntPipe) id: number) {
    return this.contracts.getByCash(req.user, id);
  }

  /** Shartnomasiz kassadan «Shartnoma tuzish» */
  @Post('cash/:id/contract')
  createForCash(
    @Req() req: AuthReq,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CreateContractForCashDto,
  ) {
    return this.contracts.createForCash(req.user, id, body);
  }

  @Get('installment-providers')
  providers(@Req() req: AuthReq) {
    return this.contracts.listProviders(req.user);
  }

  @Post('installment-providers')
  createProvider(@Req() req: AuthReq, @Body() body: CreateProviderDto) {
    return this.contracts.createProvider(req.user, body);
  }

  @Patch('installment-providers/:id')
  updateProvider(
    @Req() req: AuthReq,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateProviderDto,
  ) {
    return this.contracts.updateProvider(req.user, id, body);
  }
}
