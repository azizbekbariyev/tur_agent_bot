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
} from '@nestjs/common';
import { CashService } from './cash.service';
import { JwtAuthGuard } from 'src/common/guard/jwt-auth.guard';
import {
  CashesFilterDto,
  CreateCashDto,
  CreatePaymantDto,
  DashboardFilterDto,
  UpdateUserDto,
} from './dto/cash.dto';
import { Query } from '@nestjs/common';

@Controller()
export class CashController {
  constructor(private readonly cashService: CashService) { }

  //-------------------------------Employee-------------------------------//

  @UseGuards(JwtAuthGuard)
  @Get('/dashboard')
  getDashboard(@Req() req: Request, @Query() query: DashboardFilterDto) {
    return this.cashService.getDashboard(req.user, query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('/cashes')
  getCashes(
    @Req() req: Request,
    @Query('status') status: string,
    @Query('cashNumber') cashNumber: string,
  ) {
    return this.cashService.getCashes(req.user, {
      status,
      cashNumber,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('create-cash')
  createCash(@Req() req: Request, @Body() body: CreateCashDto) {
    return this.cashService.createCash(req.user, body);
  }

  @UseGuards(JwtAuthGuard)
  @Get('cash/employee/:id')
  getCash(@Req() req: Request, @Param('id') id: number) {
    return this.cashService.getCash(req.user, id);
  }

  // @Patch('cash/employee/:id')
  // updateCash(@Req() req: Request, @Param('id') id: number) {
  //   return this.cashService.updateCash(req.user, id);
  // }

  @UseGuards(JwtAuthGuard)
  @Post('cash/employee/payment/:id')
  createPaymant(
    @Req() req: Request,
    @Param('id') id: number,
    @Body() body: CreatePaymantDto,
  ) {
    return this.cashService.createPaymant(req.user, id, body);
  }

  @Get('services')
  getServices() {
    return this.cashService.getServices();
  }

  //-----------------------------Admin----------------------------------//

  @UseGuards(JwtAuthGuard)
  @Get('dashboard')
  getDashboardAdmin(@Req() req: Request, @Query() query: DashboardFilterDto) {
    return this.cashService.getDashboard(req.user, query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('users')
  getUsers(@Req() req: Request) {
    return this.cashService.getUsers(req.user);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('user/:id')
  updateUser(
    @Req() req: Request,
    @Param('id') id: number,
    @Body() body: UpdateUserDto,
  ) {
    return this.cashService.updateUser(req.user, id, body);
  }

  @Delete('user/:id')
  deleteUser(@Req() req: Request, @Param('id') id: number) {
    return this.cashService.deleteUser(req.user, id);
  }

  @Get('user/me')
  getMe(@Req() req: Request) {
    return this.cashService.getMe(req.user);
  }
}
