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
import { requireClientsAccess } from '../common/roles';
import { UserReq } from '../types/user.type';
import { ClientsService } from './clients.service';
import { ClientsQueryDto, UpdateClientDto } from './clients.dto';

// Mijozlar bazasi: rahbar va buxgalter - hammasi; xodim - faqat o'z kassalaridagi mijozlar
@Controller('clients')
@UseGuards(JwtAuthGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  list(@Req() req: { user: UserReq }, @Query() query: ClientsQueryDto) {
    requireClientsAccess(req.user);
    return this.clientsService.list(req.user, query);
  }

  @Get(':id')
  getOne(@Req() req: { user: UserReq }, @Param('id', ParseIntPipe) id: number) {
    requireClientsAccess(req.user);
    return this.clientsService.getOne(req.user, id);
  }

  @Patch(':id')
  update(
    @Req() req: { user: UserReq },
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateClientDto,
  ) {
    requireClientsAccess(req.user);
    return this.clientsService.update(req.user, id, body);
  }
}
