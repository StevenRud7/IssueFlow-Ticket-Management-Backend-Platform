import { TicketPriority } from './ticket-priority.enum';
import { TicketStatus } from './ticket-status.enum';
import { TicketType } from './ticket-type.enum';

/**
 * Shape of a `tickets` table row from pg. The `version` field powers
 * optimistic locking — every UPDATE checks-and-bumps it; concurrent writes
 * with the same starting version see exactly one success.
 */
export interface TicketRow {
  id: number;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  type: TicketType;
  project_id: number;
  assignee_id: number | null;
  due_date: Date | null;
  is_overdue: boolean;
  version: number;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Public-facing shape. The README contract example shows all fields
 * (including `isOverdue`) — we include `version` too so clients can pass
 * it back on the next PATCH for optimistic concurrency. The README example
 * doesn't show `version` but doesn't forbid it either, and our additional
 * field doesn't violate the contract.
 */
export interface TicketResponse {
  id: number;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  type: TicketType;
  projectId: number;
  assigneeId: number | null;
  dueDate: string | null; // ISO-8601
  isOverdue: boolean;
  version: number;
}

export function toTicketResponse(row: TicketRow): TicketResponse {
  return {
    id: Number(row.id),
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    type: row.type,
    projectId: Number(row.project_id),
    assigneeId: row.assignee_id === null ? null : Number(row.assignee_id),
    dueDate: row.due_date ? row.due_date.toISOString() : null,
    isOverdue: row.is_overdue,
    version: row.version,
  };
}
