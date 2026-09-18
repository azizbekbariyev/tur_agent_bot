import { Body, Controller, Get, Headers, Post, Req, Res } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './auth.dto';
import { type Request, type Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('validate')
  validate(@Req() req: Request) {
    return this.authService.validate(req);
  }

  // @Get('refresh')
  // refresh(@Headers('authorization') authorization: string) {
  //   return this.authService.refresh(authorization);
  // }

  @Post('login')
  loginEmailPassword(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    console.log(body);
    return this.authService.loginEmailPassword(body, res);
  }
}
