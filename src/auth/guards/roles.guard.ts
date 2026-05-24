import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { UserRole } from '../../users/entities/user-role.enum';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedUser } from '../auth.types';

/**
 * Role-based access control. Applied explicitly with @UseGuards(RolesGuard)
 * on routes that also have @Roles(...).
 *
 * Phase 3 wires this guard but no endpoint yet uses @Roles — Phase 8 will
 * apply it to ADMIN-only restore endpoints. Implementing it now means Phase
 * 8 is a one-line decoration rather than new infrastructure.
 *
 * Throws ForbiddenException (403) if the user's role isn't in the allow-list.
 * If no @Roles decorator is present, allows through (treats role as "any").
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const user = req.user as AuthenticatedUser | undefined;
    if (!user) {
      // Should never happen — JwtAuthGuard runs first and populates req.user.
      throw new ForbiddenException('Authentication required');
    }
    if (!required.includes(user.role)) {
      throw new ForbiddenException(`Requires role(s): ${required.join(', ')}`);
    }
    return true;
  }
}
