import { Request } from 'express';

declare module '@nestjs/common' {
  export interface Request {
    user: {
      id: number;
      role: string;
      telegram_id: number;
    };
  }
}
