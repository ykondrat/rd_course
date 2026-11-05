import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';

import { AuthService, TokenPair } from './auth.service';
import { CurrentUser, Principal } from './current-user.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: { email: string; password: string }): Promise<TokenPair> {
    return this.auth.login(body.email, body.password);
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() body: { refresh_token: string }): Promise<TokenPair> {
    return this.auth.refreshTokens(body.refresh_token);
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  logout(@CurrentUser() me: Principal) {
    return this.auth.logout(me);
  }
}