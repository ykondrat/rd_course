import { Body, Controller, Get, Headers, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { CurrentUser, Principal } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FilesService, IntentBody } from './files.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('uploads/intent')
  @HttpCode(200)
  intent(
    @CurrentUser() me: Principal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: IntentBody,
  ) {
    return this.files.intent(me.userId, body, idempotencyKey);
  }

  @Get('uploads/:id/parts')
  parts(@CurrentUser() me: Principal, @Param('id') fileId: string) {
    return this.files.parts(me.userId, fileId);
  }

  @Post('uploads/commit')
  @HttpCode(200)
  commit(@CurrentUser() me: Principal, @Body() body: { file_id: string }) {
    return this.files.commit(me.userId, body.file_id);
  }

  @Get('files/:id')
  async download(@CurrentUser() me: Principal, @Param('id') fileId: string, @Res() res: Response): Promise<void> {
    const url = await this.files.downloadUrl(me.userId, fileId);

    res.redirect(302, url);
  }
}