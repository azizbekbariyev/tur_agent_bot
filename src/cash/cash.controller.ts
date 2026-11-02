import {
  Controller,
  Get,
  UseGuards,
  Req,
  Body,
  Post,
  Param,
  ParseIntPipe,
  Patch,
  Delete,
  Query,
} from '@nestjs/common';
import { CashService } from './cash.service';
import { VoucherService } from './voucher.service';
import { JwtAuthGuard } from 'src/common/guard/jwt-auth.guard';
import { UserReq } from 'src/types/user.type';
import {
  CashFilterDto,
  CashListQueryDto,
  ChangePasswordDto,
  CheckNumberQueryDto,
  CreateCashDto,
  CreatePaymantDto,
  CreateServiceCompanyDto,
  CreateServiceTypeDto,
  CreateUserDto,
  DashboardFilterDto,
  OptionalDateRangeDto,
  UpdateCashDto,
  UpdateCashEmployeeBonusDto,
  UpdateCashStatusDto,
  UpdateUserDto,
  VoucherSendDto,
} from './dto/cash.dto';

type AuthReq = { user: UserReq };

// Rol bo'yicha cheklovlar CashService ichida (backendda majburiy)
@Controller()
@UseGuards(JwtAuthGuard)
export class CashController {
  constructor(
    private readonly cashService: CashService,
    private readonly voucherService: VoucherService,
  ) {}

  //------------------------------- Dashboard -------------------------------//
  @Get('dashboard')
  getDashboard(@Req() req: AuthReq, @Query() query: DashboardFilterDto) {
    return this.cashService.getDashboard(req.user, query);
  }

  @Get('dashboard/chart')
  getDashboardChart(@Req() req: AuthReq, @Query() query: DashboardFilterDto) {
    return this.cashService.getChartData(req.user, query);
  }

  @Get('dashboard-chart')
  getDashboardChart2(@Req() req: AuthReq, @Query() query: DashboardFilterDto) {
    return this.cashService.getDashboardCharts(req.user, query);
  }

  @Get('me/stats')
  getMeStats(@Req() req: AuthReq, @Query() query: DashboardFilterDto) {
    return this.cashService.getMeStats(req.user, query);
  }

  //------------------------------- Kassalar -------------------------------//
  @Get('cashes')
  getCashes(@Req() req: AuthReq, @Query() query: CashListQueryDto) {
    return this.cashService.getCashes(req.user, query);
  }

  @Get('cashes/status-counts')
  getCashStatusCounts(@Req() req: AuthReq, @Query() query: CashFilterDto) {
    return this.cashService.getCashStatusCounts(req.user, query);
  }

  @Get('cashes/check-number')
  checkCashNumber(@Query() query: CheckNumberQueryDto) {
    return this.cashService.checkCashNumber(query);
  }

  @Get('last-cashes')
  getLastCashes(@Req() req: AuthReq) {
    return this.cashService.getLastCashes(req.user);
  }

  @Post('cash')
  createCash(@Req() req: AuthReq, @Body() body: CreateCashDto) {
    return this.cashService.createCash(req.user, body);
  }

  @Get('cash/:id')
  getCash(@Req() req: AuthReq, @Param('id', ParseIntPipe) id: number) {
    return this.cashService.getCash(req.user, id);
  }

  @Patch('cash/employee/:id')
  updateCash(
    @Req() req: AuthReq,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateCashDto,
  ) {
    return this.cashService.updateCash(req.user, id, body);
  }

  @Post('cash/employee/payment/:id')
  createPaymant(
    @Req() req: AuthReq,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CreatePaymantDto,
  ) {
    return this.cashService.createPaymant(req.user, id, body);
  }

  @Patch('cash/status/:id')
  updateCashStatus(
    @Req() req: AuthReq,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateCashStatusDto,
  ) {
    return this.cashService.updateCashStatus(req.user, id, body);
  }

  @Patch('cash/employee/bonus/:id')
  updateCashEmployeeBonus(
    @Req() req: AuthReq,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateCashEmployeeBonusDto,
  ) {
    return this.cashService.updateCashEmployeeBonus(req.user, id, body);
  }

  @Delete('cash/:id')
  deleteCash(@Req() req: AuthReq, @Param('id', ParseIntPipe) id: number) {
    return this.cashService.deleteCash(req.user, id);
  }

  @Get('cash-history/:id')
  getCashHistory(@Req() req: AuthReq, @Param('id', ParseIntPipe) id: number) {
    return this.cashService.getCashHistory(req.user, id);
  }

  @Post('cash/:id/voucher/send')
  sendVoucher(
    @Req() req: AuthReq,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: VoucherSendDto,
  ) {
    return this.voucherService.send(req.user, id, body);
  }

  @Get('history')
  findAll(
    @Req() req: AuthReq,
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

  //---------------------------- Foydalanuvchilar ----------------------------//
  @Get('users')
  getUsers(@Req() req: AuthReq) {
    return this.cashService.getUsers(req.user);
  }

  @Get('users/options')
  getUserOptions() {
    return this.cashService.getUserOptions();
  }

  @Get('users/:id/cashes')
  getUserCashes(
    @Req() req: AuthReq,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: DashboardFilterDto,
  ) {
    return this.cashService.getUserCashes(
      req.user,
      id,
      query.startDate,
      query.endDate,
    );
  }

  @Get('user/me')
  getMe(@Req() req: AuthReq) {
    return this.cashService.getMe(req.user);
  }

  @Post('user')
  createUser(@Req() req: AuthReq, @Body() body: CreateUserDto) {
    return this.cashService.createUser(req.user, body);
  }

  @Patch('user/:id')
  updateUserAdmin(
    @Req() req: AuthReq,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateUserDto,
  ) {
    return this.cashService.updateUser(req.user, id, body);
  }

  @Delete('user/:id')
  deleteUser(@Req() req: AuthReq, @Param('id', ParseIntPipe) id: number) {
    return this.cashService.deleteUser(req.user, id);
  }

  @Post('change-password')
  changePassword(@Req() req: AuthReq, @Body() body: ChangePasswordDto) {
    return this.cashService.changePassword(req.user, body);
  }

  //------------------------- Xizmat turlari / katalog -------------------------//
  @Get('company/type')
  getCompanyType() {
    return this.cashService.getCompanyType();
  }

  @Get('company/type/:id')
  getCompanyTypeById(
    @Req() req: AuthReq,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: OptionalDateRangeDto,
  ) {
    return this.cashService.getCompanyTypeById(req.user, id, query);
  }

  @Patch('cash/select-service')
  selectService(@Req() req: AuthReq) {
    return this.cashService.selectService(req.user);
  }

  @Post('service-type')
  createServiceType(@Req() req: AuthReq, @Body() body: CreateServiceTypeDto) {
    return this.cashService.createServiceType(req.user, body);
  }

  @Post('company')
  createCompany(@Req() req: AuthReq, @Body() body: CreateServiceCompanyDto) {
    return this.cashService.createServiceCompany(req.user, body);
  }

  @Delete('service/:id')
  deleteService(@Req() req: AuthReq, @Param('id', ParseIntPipe) id: number) {
    return this.cashService.deleteService(req.user, id);
  }

  @Delete('service-type/:id')
  deleteServiceType(
    @Req() req: AuthReq,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.cashService.deleteServiceType(req.user, id);
  }
}
