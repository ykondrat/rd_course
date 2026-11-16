import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';

import { DatabaseService } from '../database/database.service';
import { ReadinessService } from './readiness.service';

@Controller()
export class HealthController {
  constructor(
    private readonly readiness: ReadinessService,
    private readonly db: DatabaseService,
  ) {}

  @Get('health')
  check(): { status: string; uptime: number; timestamp: string } {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('healthz')
  live(): { alive: boolean } {
    return { alive: true };
  }

  @Get('readyz')
  async ready(@Res({ passthrough: true }) res: Response): Promise<{ ready: boolean; draining: boolean; database: boolean }> {
    const draining = this.readiness.isDraining();
    const database = this.readiness.isAcceptingTraffic() ? await this.databaseReachable() : false;
    const ready = this.readiness.isAcceptingTraffic() && database;

    if (!ready) res.status(503);

    return { ready, draining, database };
  }

  private async databaseReachable(): Promise<boolean> {
    try {
      await this.db.query('SELECT 1');

      return true;
    } catch {
      return false;
    }
  }
}
