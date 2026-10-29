import { Controller, Get } from '@nestjs/common';
import { UserService } from './user.service';
import { Cron } from '@nestjs/schedule';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  // @Cron('* * * * *')
  @Get('create')
  createUser() {
    return this.userService.createUser();
  }
}
