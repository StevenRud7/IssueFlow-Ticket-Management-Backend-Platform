import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthenticatedUser, JwtPayload } from '../auth.types';
import { TokenDenylistRepository } from '../token-denylist.repository';

/**
 * Passport strategy that runs on every guarded request.
 *
 * The base Strategy class handles:
 *   1. Extracting the bearer token from the Authorization header
 *   2. Verifying the signature against JWT_SECRET
 *   3. Checking exp / nbf / iat claims
 *
 * Then `validate(payload)` runs. We add ONE check beyond the base flow:
 * is the token's jti in token_denylist? If yes, the user has logged out
 * since signing, so reject the request even though the token's signature
 * is still valid.
 *
 * Whatever `validate()` returns is attached to req.user. We strip JWT
 * book-keeping (`sub`, `iat`) but keep `jti` and `exp` so POST /auth/logout
 * has them.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly denylist: TokenDenylistRepository,
  ) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET is not set. Add it to your .env file.');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * Runs after the base library has verified the signature & expiry.
   * Throwing here turns into a 401 (Passport contract).
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload.jti || !payload.exp) {
      // A token signed by an older version of the app or by a different
      // service might lack our jti — reject defensively.
      throw new UnauthorizedException('Malformed token');
    }

    if (await this.denylist.isRevoked(payload.jti)) {
      throw new UnauthorizedException('Token has been revoked');
    }

    return {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      jti: payload.jti,
      exp: payload.exp,
    };
  }
}
