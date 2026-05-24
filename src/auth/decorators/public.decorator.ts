import { SetMetadata } from '@nestjs/common';

/**
 * Marks an endpoint as publicly accessible (no JWT required).
 *
 * Since we install JwtAuthGuard as an APP_GUARD in AuthModule, *every* route
 * is locked down by default. This decorator is the explicit, audit-friendly
 * opt-out — applied to `POST /auth/login` and `POST /users` only.
 *
 * The guard reads the IS_PUBLIC_KEY metadata via Reflector at request time;
 * absence means "auth required", presence-with-true means "skip auth".
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
