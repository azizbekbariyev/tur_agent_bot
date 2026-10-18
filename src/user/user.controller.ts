import { Controller } from '@nestjs/common';
import { UserService } from './user.service';
import { Cron } from '@nestjs/schedule';

@Controller()
export class UserController {
  constructor(private readonly userService: UserService) {}

  // @Cron('* * * * *')
  createUser() {
    return this.userService.createUser();
  }
}
