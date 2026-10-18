import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import * as express from 'express';
import cookieParser from 'cookie-parser';
import { ValidationPipe } from '@nestjs/common';

async function start() {
  try {
    const PORT = process.env.PORT || 3030;
    const app = await NestFactory.create<NestExpressApplication>(AppModule);

    const allowedOrigins = [
      'https://tur-agent.test-prava.uz',
      'http://localhost:5173',
      'http://localhost:5174',
      'https://turagent.test-prava.uz',
    ];

    app.enableCors({
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          console.log('❌ CORS blocked:', origin);
          callback(new Error('CORS blocked!'), false);
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'telegram-init-data',
        'cache-control',
      ],
      exposedHeaders: ['set-cookie'],
      preflightContinue: false,
      optionsSuccessStatus: 204,
    });
    app.use('/uploads', express.static(join(process.cwd(), 'uploads')));

    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );

    await app.listen(PORT, () => {
      console.log(`🚀 Server started at http://localhost:${PORT}/api`);
    });
  } catch (error) {
    console.log('❌ Server start error:', error);
  }
}
void start();
