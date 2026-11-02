import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/bot/models/user';
import { UserService } from './user.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UserService],
})
export class UserModule {}
