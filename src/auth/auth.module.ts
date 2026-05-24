import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenDenylistRepository } from './token-denylist.repository';

/**
 * Wires authentication for the whole app.
 *
 * The critical line is the APP_GUARD provider — that's what flips the
 * default from "anyone can hit any endpoint" to "every endpoint requires
 * a valid bearer token unless explicitly marked @Public()".
 *
 * After Phase 3, the only two endpoints that respond without a token are:
 *   POST /users        — registration (marked @Public in Phase 3)
 *   POST /auth/login   — token issuance (marked @Public here)
 *   GET  /              — Phase 1 greeting (also marked @Public)
 *   GET  /health        — Phase 1 health  (also marked @Public)
 *
 * JwtModule.registerAsync reads JWT_SECRET / JWT_EXPIRES_IN from ConfigService
 * at boot — env vars stay the single source of truth.
 */
@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error('JWT_SECRET is not set');
        }
        // Pass expiresIn as a number of seconds — keeps the type narrow and
        // avoids depending on jsonwebtoken's "StringValue" template type.
        // Same parser AuthService uses (kept private to AuthService; we
        // inline a minimal version here to avoid a circular import).
        const raw = (config.get<string>('JWT_EXPIRES_IN') ?? '3600').trim();
        let expiresIn = 3600;
        if (/^\d+$/.test(raw)) expiresIn = Number(raw);
        else {
          const m = /^(\d+)\s*([smhd])$/i.exec(raw);
          if (m) {
            const v = Number(m[1]);
            expiresIn =
              m[2].toLowerCase() === 's'
                ? v
                : m[2].toLowerCase() === 'm'
                  ? v * 60
                  : m[2].toLowerCase() === 'h'
                    ? v * 3600
                    : v * 86_400;
          }
        }
        return {
          secret,
          signOptions: { expiresIn },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    TokenDenylistRepository,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AuthModule {}
