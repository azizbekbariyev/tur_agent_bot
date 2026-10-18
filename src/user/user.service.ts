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
      firstName: 'Admin1',
      lastName: 'Admin2',
      email: 'admin@mail.uz',
      hashedPassword: hashed_password,
      type: 'SUPERADMIN',
    });
    await this.userRepository.save(user);
  }
}
