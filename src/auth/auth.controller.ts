import { Controller, Get, Headers } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('validate')
  validate(@Headers('authorization') authorization: string) {
    return this.authService.validate(authorization);
  }
}
