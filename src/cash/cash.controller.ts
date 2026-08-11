import {
  Controller,
  Get,
  UseGuards,
  Req,
  Request,
  Body,
  Post,
  Param,
  Patch,
  Delete,
  Query,
} from '@nestjs/common';
import { CashService } from './cash.service';
import { JwtAuthGuard } from 'src/common/guard/jwt-auth.guard';
import {
  CreateCashDto,
  CreatePaymantDto,
  CreateServiceCompanyDto,
  CreateServiceTypeDto,
  CreateUserDto,
  DashboardFilterDto,
  UpdateCashDto,
  UpdateCashStatusDto,
  UpdateUserDto,
} from './dto/cash.dto';
import { Cron } from '@nestjs/schedule';

// XATOLIK TUZATILDI: @UseGuards(JwtAuthGuard) endi controller darajasida -
// avval har bir method'ga alohida yozilardi va ikkitasida (`deleteUser`,
// `getMe`) unutilib qolgan edi (guardsiz, ya'ni himoyasiz endpoint).
@Controller()
@UseGuards(JwtAuthGuard)
export class CashController {
  constructor(private readonly cashService: CashService) {}

  @Cron('0 6 * * *', {
    timeZone: 'Asia/Tashkent',
  })
  async checkBaseCash() {
    await this.cashService.checkBaseCash();
  }

  //-------------------------------Employee-------------------------------//
  @Get('dashboard')
  getDashboard(@Req() req: Request, @Query() query: DashboardFilterDto) {
    return this.cashService.getDashboard(req.user, query);
  }

  @Get('/cashes')
  getCashes(
    @Req() req: Request,
    @Query('status') status: string,
    @Query('cashNumber') cashNumber: string,
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('userId') userId?: string,
  ) {
    return this.cashService.getCashes(req.user, {
      status,
      cashNumber,
      page: Number(page),
      limit: Number(limit),
      userId,
      startDate,
      endDate,
    });
  }

  @Post('cash')
  createCash(@Req() req: Request, @Body() body: CreateCashDto) {
    return this.cashService.createCash(req.user, body);
  }

  @Patch('cash/employee/:id')
  updateCash(
    @Req() req: Request,
    @Param('id') id: number,
    @Body() body: UpdateCashDto,
  ) {
    return this.cashService.updateCash(req.user, id, body);
  }

  @Post('cash/employee/payment/:id')
  createPaymant(
    @Req() req: Request,
    @Param('id') id: number,
    @Body() body: CreatePaymantDto,
  ) {
    return this.cashService.createPaymant(req.user, id, body);
  }

  @Patch('cash/select-service')
  selectService(@Req() req: Request) {
    return this.cashService.selectService(req.user);
  }

  //-----------------------------Admin----------------------------------//
  // XATOLIK TUZATILDI: bu yerda avval TAKRORLANGAN @Get('dashboard') bor
  // edi - butunlay OLIB TASHLANDI. Yuqoridagi getDashboard() ADMIN va
  // EMPLOYEE ikkalasi uchun ham ishlaydi (kerak bo'lsa farqni
  // cashService.getDashboard() ichida req.user.role orqali ажratish mumkin).

  @Get('users')
  getUsers(@Req() req: Request) {
    return this.cashService.getUsers(req.user);
  }

  @Delete('user/:id')
  deleteUser(@Req() req: Request, @Param('id') id: number) {
    return this.cashService.deleteUser(req.user, id);
  }

  @Get('user/me')
  getMe(@Req() req: Request) {
    return this.cashService.getMe(req.user);
  }

  @Get('history')
  findAll(
    @Req() req: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('userId') userId?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.cashService.findAll(
      {
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 20,
        userId: userId ? Number(userId) : undefined,
        search,
        from,
        to,
      },
      req.user,
    );
  }

  @Patch('user/:id')
  updateUserAdmin(
    @Req() req: Request,
    @Param('id') id: number,
    @Body() body: UpdateUserDto,
  ) {
    return this.cashService.updateUser(req.user, id, body);
  }

  @Patch('cash/status/:id')
  updateCashStatus(
    @Req() req: Request,
    @Param('id') id: number,
    @Body() body: UpdateCashStatusDto,
  ) {
    return this.cashService.updateCashStatus(req.user, id, body);
  }

  @Post('user')
  createUser(@Req() req: Request, @Body() body: CreateUserDto) {
    return this.cashService.createUser(req.user, body);
  }

  @Get('company/type/:id')
  getCompanyTypeById(@Req() req: Request, @Param('id') id: number) {
    return this.cashService.getCompanyTypeById(req.user, id);
  }

  @Get('company/type')
  getCompanyType() {
    return this.cashService.getCompanyType();
  }

  @Get('cash/:id')
  getCash(@Req() req: Request, @Param('id') id: number) {
    return this.cashService.getCash(req.user, id);
  }

  @Post('service-type')
  createServiceType(@Req() req: Request, @Body() body: CreateServiceTypeDto) {
    return this.cashService.createServiceType(req.user, body);
  }

  @Post('company')
  createCompany(@Req() req: Request, @Body() body: CreateServiceCompanyDto) {
    return this.cashService.createServiceCompany(req.user, body);
  }

  @Get('dashboard/chart')
  getDashboardChart(@Req() req: Request, @Query() query: DashboardFilterDto) {
    return this.cashService.getChartData(req.user, query);
  }

  @Get('users/:id/cashes')
  getUserCashes(
    @Req() req: Request,
    @Param('id') id: number,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.cashService.getUserCashes(req.user, id, startDate, endDate);
  }

  @Delete('service/:id')
  deleteService(@Req() req: Request, @Param('id') id: number) {
    return this.cashService.deleteService(req.user, id);
  }

  @Delete('service-type/:id')
  deleteServiceType(@Req() req: Request, @Param('id') id: number) {
    return this.cashService.deleteServiceType(req.user, id);
  }

  @Delete('cash/:id')
  deleteCash(@Req() req: Request, @Param('id') id: number) {
    return this.cashService.deleteCash(req.user, id);
  }

  @Get('cash-history/:id')
  getCashHistory(@Req() req: Request, @Param('id') id: number) {
    return this.cashService.getCashHistory(req.user, id);
  }
}
