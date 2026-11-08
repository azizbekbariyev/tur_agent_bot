import { Module } from '@nestjs/common';
import { TelegrafModule } from 'nestjs-telegraf';
import { session } from 'telegraf';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BOT_NAME } from './app.constants';
import { BotModule } from './bot/bot.module';
import { ConfigModule } from '@nestjs/config';
import { CashModule } from './cash/cash.module';
import { AuthModule } from './auth/auth.module';
import { ScheduleModule } from '@nestjs/schedule';
import { UserModule } from './user/user.module';
import { SettingsModule } from './settings/settings.module';
import { PartnersModule } from './partners/partners.module';
import { ClientsModule } from './clients/clients.module';
import { ReportsModule } from './reports/reports.module';
import { BruttoRateNumeric1761955200000 } from './migrations/1761955200000-BruttoRateNumeric';
import { TimestampsWithTimeZone1761955300000 } from './migrations/1761955300000-TimestampsWithTimeZone';
import { CashSeqNo1761955400000 } from './migrations/1761955400000-CashSeqNo';
import { UserUsername1762600000000 } from './migrations/1762600000000-UserUsername';
import { SessionOidcSid1762700000000 } from './migrations/1762700000000-SessionOidcSid';
import { botEnabled } from './common/flags';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TelegrafModule.forRootAsync({
      botName: BOT_NAME,
      useFactory: () => ({
        token: process.env.BOT_TOKEN!,
        middlewares: [session()],
        include: [],
        // BOT_ENABLED=false (test nusxa): polling boshlanmaydi
        ...(botEnabled() ? {} : { launchOptions: false as const }),
      }),
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.PG_HOST,
      port: Number(process.env.PG_PORT),
      username: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      database: process.env.PG_DB,
      entities: [],
      // Migratsiyalar synchronize'dan OLDIN ishlaydi: ustun turini ma'lumot yo'qotmasdan o'zgartirish uchun
      migrations: [
        BruttoRateNumeric1761955200000,
        TimestampsWithTimeZone1761955300000,
        CashSeqNo1761955400000,
        UserUsername1762600000000,
        SessionOidcSid1762700000000,
      ],
      migrationsRun: true,
      synchronize: true,
      autoLoadEntities: true,
      dropSchema: false,
    }),
    ScheduleModule.forRoot(),
    BotModule,
    CashModule,
    AuthModule,
    UserModule,
    SettingsModule,
    PartnersModule,
    ClientsModule,
    ReportsModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
