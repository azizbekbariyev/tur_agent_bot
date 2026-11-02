import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request as ExpressRequest, Response } from 'express';
import { JwtAuthGuard } from '../common/guard/jwt-auth.guard';
import { requireAdmin } from '../common/roles';
import { UserReq } from '../types/user.type';
import { BotService } from '../bot/bot.service';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './settings.dto';

const LOGO_MIMES = ['image/png', 'image/jpeg', 'image/svg+xml'];
const LOGO_MAX_SIZE = 1024 * 1024;

/** Backendning tashqi manzili (masalan, https://x.uz/api) */
export function publicApiBase(req: ExpressRequest) {
  if (process.env.BACKEND_PUBLIC_URL) {
    return process.env.BACKEND_PUBLIC_URL.replace(/\/+$/, '');
  }
  const proto =
    (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0] ??
    req.protocol;
  return `${proto}://${req.get('host')}/api`;
}

@Controller('settings')
export class SettingsController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly botService: BotService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  getSettings() {
    return this.settingsService.get();
  }

  @Patch()
  @UseGuards(JwtAuthGuard)
  updateSettings(
    @Req() req: { user: UserReq },
    @Body() body: UpdateSettingsDto,
  ) {
    requireAdmin(req.user);
    return this.settingsService.update(body);
  }

  @Post('logo')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: LOGO_MAX_SIZE } }),
  )
  async uploadLogo(
    @Req() req: ExpressRequest & { user: UserReq },
    @UploadedFile() file?: Express.Multer.File,
  ) {
    requireAdmin(req.user);
    if (!file) throw new BadRequestException('Fayl (file) yuborilmadi');
    if (!LOGO_MIMES.includes(file.mimetype)) {
      throw new BadRequestException('Faqat PNG, JPEG yoki SVG');
    }
    const logoUrl = `${publicApiBase(req)}/settings/logo?v=${Date.now()}`;
    return this.settingsService.saveLogo(file.buffer, file.mimetype, logoUrl);
  }

  // Ochiq: logotip <img> orqali ko'rsatiladi (login sahifasida ham)
  @Get('logo')
  @Header('Cache-Control', 'public, max-age=86400')
  @Header('X-Content-Type-Options', 'nosniff')
  // SVG ichidagi skriptlar ishlamasligi uchun
  @Header(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'",
  )
  async getLogo(@Res() res: Response) {
    const logo = await this.settingsService.getLogo();
    if (!logo) throw new NotFoundException('Logotip yo‘q');
    res.type(logo.mime).send(logo.logo);
  }

  @Get('telegram')
  @UseGuards(JwtAuthGuard)
  async telegramStatus() {
    const username = await this.botService.getBotUsername();
    return { connected: !!username, botUsername: username };
  }
}
