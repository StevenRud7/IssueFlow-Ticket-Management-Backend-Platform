# AI & Agents — Development Log

This document records how AI was used to build IssueFlow.

## Model used

**Claude Opus 4.7 and Sonnet 4.6** (Anthropic), used through an agentic coding interface
with file-system and shell access. The agent could read the provided
skeleton, the `README.md` API contract, and the requirements PDF; create
and edit files; run `npm` scripts; and execute a real PostgreSQL instance
to verify each feature end-to-end before moving on. I as well created and utilized a backend skill, which is attached in the submission.

## Approach

The work was deliberately split into **nine phases**, each implemented,
tested, and reviewed before starting the next. I worked together with Claude, to code and generate all the code. Tested each feature as we went on throughout the phases both within Claude and manually myself in Git Bash and as well in the Swagger UI just as an extra redudency for validating every implemented feature. Every phase followed the same loop:

1. Re-read the relevant `README.md` rows and PDF sections as the
   authoritative contract.
2. Implement the feature in layered modules
   (Controller → Service → Repository), with `class-validator` DTOs.
3. Write unit tests (mocked repositories) for every business rule.
4. Type-check, lint, build, and run the unit suite.
5. Run a live integration check against a real PostgreSQL database.
6. Review the diff, then proceed to the next phase.

The phases were: (1) Foundation — config, DB wiring, migrations, exception
filters; (2) User Management; (3) Auth + JWT guards; (4) Projects + basic
Tickets; (5) Comments + @Mentions; (6) Audit Log; (7) Dependencies +
Auto-Assignment + Auto-Escalation; (8) Soft-Delete management +
Attachments + CSV Export/Import; (9) End-to-end tests + documentation.

## Key technical decisions made with the agent

- **Plain SQL via `pg`** (no ORM) — the assignment explicitly permits it
  and it keeps the data layer transparent.
- **Layered architecture** — thin controllers, business rules in services,
  all SQL isolated in repositories. Makes unit testing straightforward
  (mock the repository) and keeps concerns separated.
- **Optimistic locking** via a `version` column on tickets and comments,
  surfaced as `409 Conflict` with a human-readable message.
- **Soft delete** via a `deleted_at` column; normal reads filter it out,
  ADMIN-only endpoints manage and restore deleted records.
- **Audit log** as a global, cross-cutting module — every mutating service
  emits `CREATE`/`UPDATE`/`DELETE`/`RESTORE` entries; automated actions
  (auto-assignment, escalation) emit `SYSTEM`-actor entries.
- **Escalation** split into a testable pure algorithm (`EscalationService`)
  and a thin cron wrapper (`EscalationScheduler`).

## Main prompts

The prompts below are representative of the interaction — the opening
brief and the per-phase instructions.

### Opening prompt

> I'm building in TypeScript with NestJS, a RESTful backend API for IssueFlow, a lightweight project and issue tracking platform.
> The system manages users, projects, tickets (issues), and comments on tickets.
> I've attached the NestJS/TypeScript skeleton, `compose.yml`, the `README.md` API contract,
> and TDP_issueflow_requirements.pdf, which breaks down the entire project and what needs to be implemented.
> Use TypeScript + NestJS with plain SQL on PostgreSQL (no ORM). Treat the README API table and the PDF
> as the authoritative contract. Before writing code, propose a
> phase-by-phase implementation plan, then we'll build it phase by phase.
> For each phase: implement it, write unit tests for every key behavior,
> type-check / lint / build, run the unit tests, then verify the endpoints
> against a real PostgreSQL database before breaking down everything that was built.

### Per-phase prompt (repeated for phases 2–9)

> Go ahead with Phase N (`phase name`). Follow the README and the
> requirements PDF as the contract. Implement the feature with the
> layered Controller/Service/Repository structure, add DTO validation,
> write thorough unit tests covering every key behavior, and verify it
> live against PostgreSQL. Provide a detailed summary and explanation of
> everything done at the end of the phase.

### Representative detailed prompts

> Phase 3 — Auth: implement JWT-based authentication. Every endpoint must
> be protected by default except `POST /users`, `POST /auth/login`,
> `GET /`, and `GET /health`. Logout must invalidate the token (a
> deny-list is fine). Use a global guard so protection is the default and
> exemptions are explicit.

> Phase 7 — implement three features: ticket dependencies (with
> same-project enforcement and cycle detection, and the rule that a ticket
> can't move to DONE while a blocker is unresolved); auto-assignment of
> the least-loaded developer on ticket creation when no assignee is given,
> with ties broken by registration order; and the auto-escalation
> scheduler that promotes overdue tickets' priority one level per cycle,
> is idempotent, and records SYSTEM-actor audit entries.

> Phase 9 — write end-to-end tests that exercise the real HTTP API against
> a real database and cover every key behavior of the implementation:
> auth flow, CRUD, the ticket lifecycle, optimistic locking, mentions,
> dependencies + cycle rejection, auto-assignment, escalation, soft-delete
> + restore, attachments with MIME/size validation, and CSV round-trip.
> Then finalize `run.md`.

### Recurring review prompts

Throughout, short corrective prompts were used to tighten the result,
e.g. asking why a test produced a noisy log line (leading to silencing an
expected-error log in the audit-service spec), and confirming each phase
worked before continuing ("Ok great it works, go ahead with the next
phase").

## Verification

Every phase was verified three ways before being accepted: a clean
`tsc` + `eslint` + `nest build`, a passing unit-test run, and a live
integration run with `curl` against a real PostgreSQL instance. The final
state has **133 unit tests** and **81 end-to-end tests** — 214 in total —
all passing, with the e2e suite running against a real database through
the full HTTP stack.

Additionally at the end created `manual-test.md` and `manual-test.sh` (ran by `bash manual-test.sh`), which has a step by step walkthrough containing a command that tests for every single required feature. Has a total of 66 tests.

Here would be the output of running `bash manual-test.sh`:
```
==================================================
 IssueFlow manual smoke test  —  http://localhost:3000
==================================================

[0] Preflight — checking the app is reachable...
  OK — app responded on http://localhost:3000

[1] Health
  PASS  GET /  (HTTP 200)
  PASS  GET /health  (HTTP 200)

[2] User registration
  PASS  register alice (ADMIN)  (HTTP 200)
  PASS  register bob (DEVELOPER)  (HTTP 200)
  PASS  register carol (DEVELOPER)  (HTTP 200)
  PASS  duplicate username -> 409  (HTTP 409)
  PASS  invalid role -> 400  (HTTP 400)
  PASS  register WITHOUT password -> 200 (README contract)  (HTTP 200)
  PASS  passwordless user cannot log in -> 401  (HTTP 401)

[3] Authentication
  PASS  login alice -> token obtained
  PASS  GET /auth/me  (HTTP 200)
  PASS  wrong password -> 401  (HTTP 401)
  PASS  no token -> 401  (HTTP 401)

[3b] User management — read / update / delete
  PASS  GET /users (list)  (HTTP 200)
  PASS  GET /users/1 (by id)  (HTTP 200)
  PASS  GET /users/99999 -> 404  (HTTP 404)
  PASS  POST /users/update/2 (fullName+role)  (HTTP 200)
  PASS  user update persisted (fullName changed)
  PASS  update with invalid role -> 400  (HTTP 400)
  PASS  restore bob to DEVELOPER  (HTTP 200)
  PASS  DELETE /users/:id (dave)  (HTTP 200)
  PASS  deleted user is gone -> 404  (HTTP 404)

[4] Projects
  PASS  create project  (HTTP 200)
  PASS  list projects  (HTTP 200)
  PASS  bad owner -> 404  (HTTP 404)

[5] Tickets + auto-assignment
  PASS  create ticket 1  (HTTP 200)
  PASS  ticket 1 auto-assigned to user 2
  PASS  create ticket 2  (HTTP 200)
  PASS  GET /projects/:id/workload  (HTTP 200)
  PASS  invalid ticket type -> 400  (HTTP 400)

[6] Ticket lifecycle + optimistic locking
  PASS  TODO -> IN_PROGRESS (v1)  (HTTP 200)
  PASS  backward transition -> 400  (HTTP 400)
  PASS  stale version -> 409  (HTTP 409)

[7] Dependencies
  PASS  add 1 blocked-by 2  (HTTP 200)
  PASS  list dependencies  (HTTP 200)
  PASS  self-dependency -> 400  (HTTP 400)
  PASS  cycle -> 400  (HTTP 400)
  PASS  DONE blocked by unresolved blocker -> 409  (HTTP 409)
  PASS  resolve blocker (ticket 2 -> DONE)  (HTTP 200)

[8] Comments + @mentions
  PASS  create comment with @mention  (HTTP 200)
  PASS  list comments  (HTTP 200)
  PASS  bob's mention feed  (HTTP 200)

[9] Attachments
  PASS  upload text/plain  (HTTP 200)
  PASS  disallowed MIME -> 400  (HTTP 400)
  PASS  list attachments  (HTTP 200)
  PASS  delete attachment  (HTTP 200)

[10] CSV export / import
  PASS  export CSV  (HTTP 200)
  PASS  export without projectId -> 400  (HTTP 400)
  PASS  exported CSV saved to disk (132 bytes)
  PASS  CSV header has the 7 required fields in order
  PASS  CSV contains 2 ticket data row(s)
  PASS  CSV import created 2 valid rows, rejected the invalid one
  PASS  re-export includes an imported ticket (round-trip)

[11] Auto-escalation
  PASS  trigger escalation cycle  (HTTP 200)
  PASS  overdue ticket escalated LOW -> MEDIUM

[12] Soft delete + restore
  PASS  soft-delete ticket 1  (HTTP 200)
  PASS  list deleted (ADMIN)  (HTTP 200)
  PASS  restore ticket 1  (HTTP 200)
  PASS  restore again -> 409  (HTTP 409)
  PASS  DEVELOPER on /tickets/deleted -> 403  (HTTP 403)

[13] Audit log
  PASS  GET /audit-logs  (HTTP 200)
  PASS  filter entityType=TICKET  (HTTP 200)
  PASS  filter action=AUTO_ASSIGN  (HTTP 200)
  PASS  invalid filter enum -> 400  (HTTP 400)

[14] Logout
  PASS  POST /auth/logout  (HTTP 200)
  PASS  token deny-listed after logout -> 401  (HTTP 401)

==================================================
 RESULT:  66 passed,  0 failed
==================================================
```