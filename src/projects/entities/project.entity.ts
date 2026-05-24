/**
 * Shape of a `projects` table row from pg. We don't pre-strip deleted_at
 * because Phase 8 will add admin endpoints that need to see it. Standard
 * reads filter `WHERE deleted_at IS NULL` at the SQL level.
 */
export interface ProjectRow {
  id: number;
  name: string;
  description: string | null;
  owner_id: number;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Public-facing shape. Matches the README contract exactly.
 */
export interface ProjectResponse {
  id: number;
  name: string;
  description: string | null;
  ownerId: number;
}

export function toProjectResponse(row: ProjectRow): ProjectResponse {
  return {
    id: Number(row.id),
    name: row.name,
    description: row.description,
    ownerId: Number(row.owner_id),
  };
}
