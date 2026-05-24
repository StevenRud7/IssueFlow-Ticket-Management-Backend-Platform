-- =============================================================================
-- IssueFlow initial schema
-- All tables, enums, and indexes for the entire project live in this file.
-- Subsequent schema changes should go into NNN_*.sql files (002, 003, ...).
-- =============================================================================

-- ---------- Enums --------------------------------------------------------------
-- Postgres enums give us cheap, indexable, constraint-checked role/status fields.
-- They are extended (not edited) via ALTER TYPE in later migrations if needed.

CREATE TYPE user_role AS ENUM ('ADMIN', 'DEVELOPER');

CREATE TYPE ticket_status   AS ENUM ('TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE');
CREATE TYPE ticket_priority AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE ticket_type     AS ENUM ('BUG', 'FEATURE', 'TECHNICAL');

CREATE TYPE audit_action AS ENUM (
  'CREATE',
  'UPDATE',
  'DELETE',
  'RESTORE',
  'AUTO_ASSIGN',
  'PRIORITY_ESCALATED',
  'LOGIN',
  'LOGOUT'
);

CREATE TYPE audit_actor AS ENUM ('USER', 'SYSTEM');

CREATE TYPE audit_entity AS ENUM (
  'USER',
  'PROJECT',
  'TICKET',
  'COMMENT',
  'ATTACHMENT',
  'DEPENDENCY'
);

-- ---------- Users --------------------------------------------------------------
-- The user registry. password_hash holds a bcrypt hash; we never store the raw
-- password and never return password_hash to clients.
--
-- password_hash is NULLABLE: the README's "Create a user" contract documents a
-- request body of { username, email, fullName, role } with NO password, and
-- expects 200 OK. So registration without a password is valid; such a user
-- simply cannot log in (POST /auth/login) until a password is set. When a
-- password IS supplied at registration, it is hashed and stored here.

CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  username      VARCHAR(64)  NOT NULL UNIQUE,
  email         VARCHAR(255) NOT NULL UNIQUE,
  full_name     VARCHAR(255) NOT NULL,
  role          user_role    NOT NULL,
  password_hash VARCHAR(255),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Case-insensitive uniqueness so "JDoe" and "jdoe" can't co-exist;
-- also speeds up the @mention lookup in Phase 5 which is case-insensitive.
CREATE UNIQUE INDEX users_username_lower_idx ON users (LOWER(username));
CREATE UNIQUE INDEX users_email_lower_idx    ON users (LOWER(email));

-- For tie-breaking during auto-assignment (oldest registrant first).
CREATE INDEX users_created_at_idx ON users (created_at);

-- ---------- Projects -----------------------------------------------------------
-- deleted_at IS NULL for active records; soft-deleted projects keep the row but
-- get filtered out of standard reads. ADMIN can list / restore them (Phase 8).

CREATE TABLE projects (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  owner_id    BIGINT       NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX projects_owner_id_idx   ON projects (owner_id);
CREATE INDEX projects_deleted_at_idx ON projects (deleted_at) WHERE deleted_at IS NOT NULL;
CREATE INDEX projects_active_idx     ON projects (id)         WHERE deleted_at IS NULL;

-- ---------- Tickets ------------------------------------------------------------
-- The core work item. `version` powers optimistic locking (§2.4 "ticket can't be
-- updated simultaneously by two users"). Every UPDATE checks the row's current
-- version, increments it, and fails the request if there's a mismatch.
--
-- is_overdue is only set true when a CRITICAL ticket is still past its dueDate
-- (auto-escalation, §3.7).

CREATE TABLE tickets (
  id           BIGSERIAL PRIMARY KEY,
  title        VARCHAR(255)    NOT NULL,
  description  TEXT,
  status       ticket_status   NOT NULL DEFAULT 'TODO',
  priority     ticket_priority NOT NULL DEFAULT 'MEDIUM',
  type         ticket_type     NOT NULL,
  project_id   BIGINT          NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  assignee_id  BIGINT                   REFERENCES users(id)    ON DELETE SET NULL,
  due_date     TIMESTAMPTZ,
  is_overdue   BOOLEAN         NOT NULL DEFAULT FALSE,
  version      INTEGER         NOT NULL DEFAULT 1,
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX tickets_project_id_idx   ON tickets (project_id);
CREATE INDEX tickets_assignee_id_idx  ON tickets (assignee_id);
CREATE INDEX tickets_status_idx       ON tickets (status);
CREATE INDEX tickets_due_date_idx     ON tickets (due_date)   WHERE due_date  IS NOT NULL;
CREATE INDEX tickets_deleted_at_idx   ON tickets (deleted_at) WHERE deleted_at IS NOT NULL;
-- Composite index optimises the workload query (counting open tickets per
-- assignee within a project) used by auto-assignment & the workload endpoint.
CREATE INDEX tickets_workload_idx ON tickets (project_id, assignee_id, status)
  WHERE deleted_at IS NULL;

-- ---------- Comments -----------------------------------------------------------
-- Mentions are stored in a separate join table so we can index lookups by
-- mentioned user (§3.6 GET /users/:userId/mentions). `version` enables the same
-- optimistic-lock pattern as tickets (§2.5 "two users can't edit at the same time").

CREATE TABLE comments (
  id         BIGSERIAL PRIMARY KEY,
  ticket_id  BIGINT      NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id  BIGINT      NOT NULL REFERENCES users(id)   ON DELETE RESTRICT,
  content    TEXT        NOT NULL,
  version    INTEGER     NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX comments_ticket_id_idx ON comments (ticket_id);
CREATE INDEX comments_author_id_idx ON comments (author_id);

CREATE TABLE comment_mentions (
  comment_id        BIGINT      NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  mentioned_user_id BIGINT      NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (comment_id, mentioned_user_id)
);

CREATE INDEX comment_mentions_user_idx
  ON comment_mentions (mentioned_user_id, created_at DESC);

-- ---------- Ticket Dependencies (§3.2) -----------------------------------------
-- "ticket_id is blocked by blocker_id". Self-blocks are rejected by the CHECK
-- constraint, and the project-equality constraint is enforced in the service
-- layer (since CHECKs can't span tables).

CREATE TABLE ticket_dependencies (
  ticket_id  BIGINT      NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  blocker_id BIGINT      NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticket_id, blocker_id),
  CHECK (ticket_id <> blocker_id)
);

CREATE INDEX ticket_dependencies_blocker_idx ON ticket_dependencies (blocker_id);

-- ---------- Attachments (§3.3) -------------------------------------------------
-- File metadata; the raw bytes live on disk under UPLOAD_DIR. `storage_key`
-- is the on-disk filename (typically a UUID + extension) — distinct from the
-- user-facing `filename` so we never trust user-supplied paths.

CREATE TABLE attachments (
  id           BIGSERIAL PRIMARY KEY,
  ticket_id    BIGINT       NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  uploader_id  BIGINT       NOT NULL REFERENCES users(id)   ON DELETE RESTRICT,
  filename     VARCHAR(255) NOT NULL,
  content_type VARCHAR(127) NOT NULL,
  byte_size    BIGINT       NOT NULL,
  storage_key  VARCHAR(255) NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX attachments_ticket_id_idx ON attachments (ticket_id);

-- ---------- Audit Log (§3.1) ---------------------------------------------------
-- Append-only history. `metadata` (jsonb) holds free-form context such as the
-- before/after diff of a ticket update or the count of mentions resolved.

CREATE TABLE audit_logs (
  id           BIGSERIAL PRIMARY KEY,
  action       audit_action NOT NULL,
  entity_type  audit_entity NOT NULL,
  entity_id    BIGINT       NOT NULL,
  performed_by BIGINT,                                 -- nullable for SYSTEM actor
  actor        audit_actor  NOT NULL,
  metadata     JSONB        NOT NULL DEFAULT '{}'::jsonb,
  timestamp    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_logs_entity_idx       ON audit_logs (entity_type, entity_id, timestamp DESC);
CREATE INDEX audit_logs_action_idx       ON audit_logs (action,      timestamp DESC);
CREATE INDEX audit_logs_actor_idx        ON audit_logs (actor,       timestamp DESC);
CREATE INDEX audit_logs_performed_by_idx ON audit_logs (performed_by, timestamp DESC);

-- ---------- JWT deny-list (§2.2) -----------------------------------------------
-- POST /auth/logout inserts the token's jti here; the JWT strategy rejects any
-- token whose jti is present and not yet expired. A nightly cleanup job (not in
-- scope for this assignment) would prune rows where expires_at < NOW().

CREATE TABLE token_denylist (
  jti        VARCHAR(64)  PRIMARY KEY,
  user_id    BIGINT       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ  NOT NULL,
  revoked_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX token_denylist_expires_at_idx ON token_denylist (expires_at);

-- ---------- updated_at auto-bump trigger ---------------------------------------
-- One trigger function, attached to every table that has an `updated_at` column.
-- Saves repeating UPDATE ... SET updated_at = NOW() in every service method.

CREATE OR REPLACE FUNCTION bump_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION bump_updated_at();

CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION bump_updated_at();

CREATE TRIGGER trg_tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION bump_updated_at();

CREATE TRIGGER trg_comments_updated_at
  BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION bump_updated_at();