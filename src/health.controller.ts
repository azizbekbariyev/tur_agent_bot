import { Controller, Get, Header, Res } from '@nestjs/common';
import { type Response } from 'express';
import { DataSource } from 'typeorm';

/** Monitoring (UptimeRobot, landing serveridagi skript): GET /api/health -> "ok" / 503 "fail" */
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async health(@Res() res: Response) {
    try {
      await this.dataSource.query('SELECT 1');
      res.status(200).send('ok');
    } catch {
      res.status(503).send('fail');
    }
  }
}
