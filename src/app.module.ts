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
      synchronize: true,
      autoLoadEntities: true,
      dropSchema: false,
    }),
    ScheduleModule.forRoot(),
    BotModule,
    CashModule,
    AuthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
