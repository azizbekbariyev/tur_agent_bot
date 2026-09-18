import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/bot/models/user';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {}

  async createUser() {
    const hashed_password = await bcrypt.hash('admin', 10);
    const user = this.userRepository.create({
      first_name: 'Admin1',
      last_name: 'Admin2',
      email: 'admin@mail.uz',
      hashed_password,
      type: 'SUPERADMIN',
    });
    await this.userRepository.save(user);
    console.log('User yaratildi');
  }
}
