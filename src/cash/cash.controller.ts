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
  CreateCashDto,
  CreatePaymantDto,
  CreateUserDto,
  DashboardFilterDto,
  UpdateCashDto,
  UpdateCashStatusDto,
  UpdateUserDto,
} from './dto/cash.dto';
import { Query } from '@nestjs/common';

@Controller()
export class CashController {
  constructor(private readonly cashService: CashService) {}

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
  @Post('cash')
  createCash(@Req() req: Request, @Body() body: CreateCashDto) {
    return this.cashService.createCash(req.user, body);
  }

  @UseGuards(JwtAuthGuard)
  @Get('cash/:id')
  async getCash(@Req() req: Request, @Param('id') id: number) {
    return this.cashService.getCash(req.user, id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('cash/employee/:id')
  updateCash(
    @Req() req: Request,
    @Param('id') id: number,
    @Body() body: UpdateCashDto,
  ) {
    return this.cashService.updateCash(req.user, id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('cash/employee/payment/:id')
  createPaymant(
    @Req() req: Request,
    @Param('id') id: number,
    @Body() body: CreatePaymantDto,
  ) {
    return this.cashService.createPaymant(req.user, id, body);
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

  @Delete('user/:id')
  deleteUser(@Req() req: Request, @Param('id') id: number) {
    return this.cashService.deleteUser(req.user, id);
  }

  @Get('user/me')
  getMe(@Req() req: Request) {
    return this.cashService.getMe(req.user);
  }

  @UseGuards(JwtAuthGuard)
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

  @UseGuards(JwtAuthGuard)
  @Patch('user/:id')
  updateUserAdmin(
    @Req() req: Request,
    @Param('id') id: number,
    @Body() body: UpdateUserDto,
  ) {
    return this.cashService.updateUser(req.user, id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('cash/status/:id')
  updateCashStatus(
    @Req() req: Request,
    @Param('id') id: number,
    @Body() body: UpdateCashStatusDto,
  ) {
    return this.cashService.updateCashStatus(req.user, id, body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('user')
  createUser(@Req() req: Request, @Body() body: CreateUserDto) {
    return this.cashService.createUser(req.user, body);
  }
}
