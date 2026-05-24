import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth.types';

/**
 * Resolves the authenticated user (set on req.user by JwtStrategy.validate)
 * directly into a controller handler argument.
 *
 *   @Get('me')
 *   me(@CurrentUser() user: AuthenticatedUser) { return user; }
 *
 * The optional `field` argument lets you pick one property cheaply:
 *
 *   @Get('whoami')
 *   whoami(@CurrentUser('id') userId: number) { ... }
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as AuthenticatedUser | undefined;
    if (!user) return undefined;
    return field ? user[field] : user;
  },
);
