import { Global, Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DenylistRepository } from './denylist.repository';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtService } from './jwt.service';
import { RefreshRepository } from './refresh.repository';
import { RolesGuard } from './roles.guard';
import { loadSigningKeys, SIGNING_KEYS } from './signing-keys';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    { provide: SIGNING_KEYS, useFactory: loadSigningKeys },
    JwtService,
    AuthService,
    RefreshRepository,
    DenylistRepository,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [JwtAuthGuard, RolesGuard, JwtService, DenylistRepository, AuthService],
})
export class AuthModule {}