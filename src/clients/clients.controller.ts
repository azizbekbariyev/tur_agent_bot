import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { requireManager } from '../common/roles';
import { UserReq } from '../types/user.type';
import { ClientsService } from './clients.service';
import { ClientsQueryDto, UpdateClientDto } from './clients.dto';

// Mijozlar bazasi - rahbarlar va buxgalter uchun
@Controller('clients')
@UseGuards(JwtAuthGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  list(@Req() req: { user: UserReq }, @Query() query: ClientsQueryDto) {
    requireManager(req.user);
    return this.clientsService.list(query);
  }

  @Get(':id')
  getOne(@Req() req: { user: UserReq }, @Param('id', ParseIntPipe) id: number) {
    requireManager(req.user);
    return this.clientsService.getOne(id);
  }

  @Patch(':id')
  update(
    @Req() req: { user: UserReq },
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateClientDto,
  ) {
    requireManager(req.user);
    return this.clientsService.update(id, body);
  }
}
