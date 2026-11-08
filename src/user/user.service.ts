import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/bot/models/user';
import { In, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { USER_INDEX_SQL } from '../common/username';

@Injectable()
export class UserService implements OnModuleInit {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Bazada birorta ham rahbar bo'lmasa, .env dagi INITIAL_ADMIN_EMAIL va
   * INITIAL_ADMIN_PASSWORD bilan SUPERADMIN yaratadi (yangi o'rnatish uchun).
   * Avvalgi ochiq `GET /user/create` endpoint'i o'rniga.
   */
  async onModuleInit() {
    // Yangi bazada migratsiya o'tkazib yuboriladi (jadval hali yo'q edi) - username indekslari shu yerda
    for (const sql of USER_INDEX_SQL) await this.userRepository.query(sql);

    const email = process.env.INITIAL_ADMIN_EMAIL;
    const password = process.env.INITIAL_ADMIN_PASSWORD;
    if (!email || !password) return;

    const admins = await this.userRepository.count({
      where: { type: In(['ADMIN', 'SUPERADMIN']), isDeleted: false },
    });
    if (admins > 0) return;

    await this.userRepository.save(
      this.userRepository.create({
        firstName: 'Super',
        lastName: 'Admin',
        email,
        hashedPassword: await bcrypt.hash(password, 10),
        type: 'SUPERADMIN',
      }),
    );
    this.logger.log(`Birinchi SUPERADMIN yaratildi: ${email}`);
  }
}
