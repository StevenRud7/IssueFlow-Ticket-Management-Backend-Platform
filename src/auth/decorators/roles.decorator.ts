import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../users/entities/user-role.enum';

/**
 * Restricts an endpoint to a set of roles. Used by RolesGuard.
 *
 * Phase 3 wires the guard but no endpoint yet uses @Roles — Phase 8 will
 * apply it to the ADMIN-only soft-delete-restore endpoints.
 *
 * Multiple roles are OR'd (caller must have ANY of them).
 */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
