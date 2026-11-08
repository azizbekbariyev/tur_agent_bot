import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { type Request, type Response } from 'express';
import { OidcService } from './oidc.service';

/** Login serveri (login.travance.uz) bilan bog'liq yo'llar: /api/auth/... */
@Controller('auth')
export class OidcController {
  constructor(private readonly oidc: OidcService) {}

  /** Kirish sahifasi uchun: qaysi usullar yoqilgan */
  @Get('config')
  @Header('Cache-Control', 'no-store')
  config() {
    return this.oidc.publicConfig();
  }

  /** "Travance orqali kirish" tugmasi shu yerga olib keladi */
  @Get('oidc/start')
  @Header('Cache-Control', 'no-store')
  start(@Res() res: Response) {
    return this.oidc.start(res);
  }

  @Get('oidc/callback')
  @Header('Cache-Control', 'no-store')
  callback(@Req() req: Request, @Res() res: Response) {
    return this.oidc.callback(req, res);
  }

  /** Filialdagi "Chiqish"dan keyin: login serveridan ham chiqish */
  @Get('oidc/logout')
  @Header('Cache-Control', 'no-store')
  logout(@Res() res: Response) {
    return this.oidc.logoutRedirect(res);
  }

  /** Login serveri -> filial (server-server): application/x-www-form-urlencoded, logout_token */
  @Post('oidc/backchannel-logout')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async backchannelLogout(@Body() body: { logout_token?: unknown }) {
    await this.oidc.backchannelLogout(body?.logout_token);
    return { ok: true };
  }

  /** Login serveri -> filial (server-server): zaxira kirish uchun bcrypt hash, imzolangan */
  @Post('internal/password-hash')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async passwordHash(@Body() body: { token?: unknown }) {
    await this.oidc.receivePasswordHash(body?.token);
  }
}
