# IssueFlow — Setup, Build & Run Guide

IssueFlow is a RESTful backend for a lightweight project/issue tracking
platform, built with **TypeScript 5.x + NestJS 11** and **PostgreSQL**
(plain SQL via the `pg` driver — no ORM).

This guide gives the exact steps to install, configure, build, run, and
test the project. **Every command is shown for three shells** — pick the
one you use:

- **bash/zsh** — macOS, Linux, WSL 2, Git Bash
- **cmd.exe** — Windows Command Prompt
- **PowerShell** — Windows PowerShell / PowerShell 7

> **Why three versions?** Shell quoting differs. bash uses single quotes;
> `cmd.exe` only understands double quotes and needs inner `"` doubled to
> `""`; PowerShell uses its own escaping. A command that works in one
> shell will often fail in another with confusing errors (a mangled JSON
> body, or `Could not resolve host`). Use the block for YOUR shell.

> **WSL note:** the project requires **WSL 2**, not WSL 1 — modern Node.js
> refuses to run under WSL 1 ("WSL 1 is not supported"). Check with
> `wsl -l -v` in PowerShell; convert with `wsl --set-version <Distro> 2`.

---

## Overview — what you'll do

Five steps take you from a clean checkout to a running, tested API. Each
has its own section below with full per-shell commands and an explanation
of *why* the step exists:

1. **Install dependencies** (§2) — download the Node packages the project needs.
2. **Start the database** (§4) — bring up PostgreSQL in Docker.
3. **Apply the schema** (§5) — create the tables the app expects.
4. **Build / run the application** (§6–§7) — compile and start the API.
5. **Run the tests** (§9) — unit tests and end-to-end tests.

Steps 3 and 4 ("Configure environment", §3) sit between install and
database; the numbered sections walk through everything in order.

### Trying the API by hand

Two extra files help you exercise the running API manually, end to end:

- **`manual-test.md`** — a step-by-step walkthrough: copy-paste `curl`
  commands that exercise every feature (users, auth, projects, tickets,
  comments, dependencies, attachments, CSV, escalation, soft-delete,
  audit), with the expected status for each.
- **`manual-test.sh`** — an automated version of that walkthrough. With
  the app running, `bash manual-test.sh` runs all the checks and prints a
  pass/fail summary. Helpful as a smoke test after any change and to generally check every feature is accurately implemented.

Both are described again in §8 once the app is up.

---

## 1. Prerequisites

| Tool           | Version             | Notes                                                        |
|----------------|---------------------|--------------------------------------------------------------|
| Node.js        | 20 LTS or newer     | `node --version` ; `https://nodejs.org/en/download`          |
| npm            | 10 or newer         | bundled with Node                                            |
| Docker         | any recent          | runs PostgreSQL via `compose.yml`                            |
| Docker Compose | v2 (`docker compose`) | bundled with Docker Desktop                                |

A PostgreSQL 14+ server is required. The provided `compose.yml` is the
easiest way to get one.

---

## 2. Install dependencies

**Purpose:** download every third-party package the project depends on
(the NestJS framework, the `pg` PostgreSQL driver, the JWT/auth
libraries, the CSV parser, the test tooling, and so on) into `node_modules`.
Nothing else will run until this is done.

Same in every shell:

```bash
npm install
```

This reads `package.json` / `package-lock.json` and installs the exact
pinned versions. Run it once after cloning, and again whenever
dependencies change.

---

## 3. Configure environment

**Purpose:** the app reads its settings (database URL, HTTP port, JWT
secret, etc.) from environment variables. `.env.example` is a template
with sensible local-development defaults; copying it to `.env` gives the
app a config file to load. The defaults match `compose.yml`, so the app
works out of the box with no edits.

Copy the example env file:

**bash/zsh:**
```bash
cp .env.example .env
```

**cmd.exe:**
```cmd
copy .env.example .env
```

**PowerShell:**
```powershell
Copy-Item .env.example .env
```

Key variables:

| Variable           | Default                                                     | Purpose                                  |
|--------------------|-------------------------------------------------------------|------------------------------------------|
| `PORT`             | `3000`                                                      | HTTP port                                |
| `DATABASE_URL`     | `postgresql://issueflow:issueflow@localhost:5432/issueflow` | PostgreSQL connection string             |
| `JWT_SECRET`       | (dev placeholder)                                           | **Change for any non-local use**         |
| `JWT_EXPIRES_IN`   | `3600`                                                      | Access-token lifetime (seconds)          |
| `UPLOAD_DIR`       | `./uploads`                                                 | Where attachment files are stored        |
| `ESCALATION_CRON`  | `0 * * * *`                                                 | Cron schedule for auto-escalation        |

---

## 4. Start the database

**Purpose:** IssueFlow stores all its data in PostgreSQL. Rather than
installing a database engine on your machine, `compose.yml` runs one in a
Docker container, pre-configured with the database name, user, and
password the app expects.

Start PostgreSQL with Docker Compose (same in every shell):

```bash
docker compose up -d
```

The `-d` flag runs it in the background ("detached"). This starts a
`postgres` container with database `issueflow`, user `issueflow`,
password `issueflow`, listening on `localhost:5432` — exactly what
`.env.example` points at. Verify it is up:

```bash
docker compose ps
```

To stop it later: `docker compose down` (`-v` also drops the data volume).

---

## 5. Apply the database schema (migration)

**Purpose:** a fresh PostgreSQL container is empty — it has no tables. The
migration creates the schema (the `users`, `projects`, `tickets`,
`comments`, `audit_logs` tables, plus enums, indexes, and triggers) so the
app has somewhere to read and write data. Without this step the app
starts but every query fails with "relation does not exist".

The schema lives in one idempotent SQL migration. Apply it (same in every
shell):

```bash
npm run migrate
```

The runner records which migrations it has applied in a
`schema_migrations` table, so re-running it is safe — it simply reports
"no pending migrations" if the schema is already up to date.

---

## 6. Build the project

**Purpose:** the source is TypeScript, which Node.js cannot run directly.
Building compiles it to plain JavaScript in `dist/`. Because the compiler
checks every type as it goes, a successful build also confirms the code
is type-correct.

Same in every shell:

```bash
npm run build
```

This is required before `start:prod` (which runs the compiled output). It
is optional before `start:dev`, which compiles on the fly.

---

## 7. Run the application

**Purpose:** start the HTTP server so the API is reachable. There are two
modes — development (auto-restarts when you edit a file) and production
(runs the already-compiled `dist/` output, no watch overhead).

Development mode (auto-reload). Same in every shell:

```bash
npm run start:dev
```

Production mode (requires `npm run build` first):

```bash
npm run start:prod
```

Either way the API is served at `http://localhost:3000`. Quick check
(same in every shell — a bare GET needs no quoting):

```bash
curl http://localhost:3000/health
```

Expect `{"status":"ok", ...}`. If you instead see a connection error, the
app isn't running; if you see a database error, revisit §4–§5.

---

## 8. First requests — the auth flow

`POST /users`, `POST /auth/login`, `GET /`, and `GET /health` are public;
**every other endpoint needs a JWT**. The commands below differ per shell
because they send JSON bodies and headers — mind the quoting.

### 8a. Register a user

**bash/zsh:**
```bash
curl -X POST http://localhost:3000/users -H 'Content-Type: application/json' -d '{"username":"jdoe","email":"jdoe@example.com","fullName":"John Doe","role":"ADMIN","password":"password123"}'
```

**cmd.exe:**
```cmd
curl -X POST http://localhost:3000/users -H "Content-Type: application/json" -d "{""username"":""jdoe"",""email"":""jdoe@example.com"",""fullName"":""John Doe"",""role"":""ADMIN"",""password"":""password123""}"
```

**PowerShell:**
```powershell
curl.exe -X POST http://localhost:3000/users -H "Content-Type: application/json" -d '{\"username\":\"jdoe\",\"email\":\"jdoe@example.com\",\"fullName\":\"John Doe\",\"role\":\"ADMIN\",\"password\":\"password123\"}'
```

> In PowerShell, use `curl.exe` (not the `curl` alias, which is
> `Invoke-WebRequest` and takes different arguments).

> **Password is optional at registration.** Per the README "Create a
> user" contract the body is `{username, email, fullName, role}` — a
> `password` may be included (as above) but is not required. A user
> created without one is still created (`200 OK`); they simply cannot log
> in until a password is set.

### 8b. Log in to obtain a JWT

**bash/zsh:**
```bash
curl -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' -d '{"username":"jdoe","password":"password123"}'
```

**cmd.exe:**
```cmd
curl -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d "{""username"":""jdoe"",""password"":""password123""}"
```

**PowerShell:**
```powershell
curl.exe -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{\"username\":\"jdoe\",\"password\":\"password123\"}'
```

The response contains `accessToken`. Save it into a variable:

**bash/zsh:**
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' -d '{"username":"jdoe","password":"password123"}' | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
```

**cmd.exe** — copy the token from the login response and set it manually:
```cmd
set "TOKEN=PASTE_THE_ACCESS_TOKEN_HERE"
```

**PowerShell:**
```powershell
$TOKEN = (curl.exe -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{\"username\":\"jdoe\",\"password\":\"password123\"}' | ConvertFrom-Json).accessToken
```

### 8c. Call a protected endpoint

**bash/zsh:**
```bash
curl http://localhost:3000/projects -H "Authorization: Bearer $TOKEN"
```

**cmd.exe:**
```cmd
curl http://localhost:3000/projects -H "Authorization: Bearer %TOKEN%"
```

**PowerShell:**
```powershell
curl.exe http://localhost:3000/projects -H "Authorization: Bearer $TOKEN"
```

### 8d. Download a CSV export

> Note: do this — and every other authenticated step — **before** the
> logout in §8f. Logging out revokes your token; any call after that with
> the same token returns `401 "Token has been revoked"`.

`GET /tickets/export?projectId={id}` returns a CSV file of every ticket
in the project, with the fields **id, title, description, status,
priority, type, assigneeId**. The API sends it with a
`Content-Disposition: attachment` header, so a **browser** (or Swagger
UI's "Download" link) saves it as a file automatically, using the
server-suggested name `tickets-project-{id}.csv`.

With `curl`, the response body prints to the terminal unless you tell it
to save. Use `-OJ` to save it under the **server-suggested filename**
(`tickets-project-1.csv`), or `-o <name>` to choose your own:

**bash/zsh:**
```bash
curl -OJ "http://localhost:3000/tickets/export?projectId=1" -H "Authorization: Bearer $TOKEN"
```

**cmd.exe:**
```cmd
curl -OJ "http://localhost:3000/tickets/export?projectId=1" -H "Authorization: Bearer %TOKEN%"
```

**PowerShell:**
```powershell
curl.exe -OJ "http://localhost:3000/tickets/export?projectId=1" -H "Authorization: Bearer $TOKEN"
```

This writes `tickets-project-1.csv` in the current directory. Its first
line is the header `id,title,description,status,priority,type,assigneeId`,
followed by one row per ticket. To bulk-import tickets, `POST
/tickets/import` accepts a CSV with the same columns (see `manual-test.md`
§10 for a full round-trip example).

### 8e. Exercising the whole API by hand

The four calls above cover the auth flow. To walk through *every* feature
— users CRUD, projects, tickets, the ticket lifecycle, dependencies,
comments and @mentions, attachments, CSV import/export, escalation,
soft-delete, and the audit log — use the two manual-test files:

- **`manual-test.md`** — a numbered, copy-paste walkthrough. Each command
  is a `curl -i` call (so you see the HTTP status), with the expected
  result noted alongside it.
- **`manual-test.sh`** — the same walkthrough automated. With the app
  running, execute it from a bash/zsh/Git Bash shell:

  ```bash
  bash manual-test.sh
  ```

  It runs 66 checks and prints a `PASS`/`FAIL` line for each, ending with
  a summary. It does not start the app itself — start the app first.

---

## 9. Run the tests

The project has two independent test layers, run with separate commands.

### 9a. Unit tests

**Purpose:** verify the business logic of each service in isolation. Every
external dependency (repositories, the database) is mocked, so these tests
are fast and need **no database** — they check decision logic, not wiring.

Same in every shell:

```bash
npm test
```

Covers all service-layer logic: input validation, the ticket lifecycle
rules, optimistic locking, @mention parsing, dependency cycle detection,
the auto-assignment selection algorithm, the escalation algorithm, CSV
parsing/validation, attachment MIME/size checks, and audit-entry emission.
133 unit tests across 12 suites.

### 9b. End-to-end tests

**Purpose:** verify the system as a whole — the e2e tests boot the real
application and make real HTTP requests against a real PostgreSQL
database, exercising controllers, validation, guards, services, SQL, and
error handling together. They catch wiring and integration problems that
isolated unit tests cannot. 75 e2e tests across 6 suites.

They require a running database and should point at a **dedicated test
database** they can freely truncate between tests.

**Step 1 — create the test database** (run once). Same in every shell:

```bash
docker compose exec db createdb -U issueflow issueflow_test
```

If it already exists you will see `database "issueflow_test" already
exists` — that is fine, skip to step 2.

**Step 2 — migrate the test database**, then **step 3 — run the e2e
tests**, both with `DATABASE_URL` pointed at the test DB.

> **IMPORTANT for cmd.exe:** wrap the whole assignment in quotes —
> `set "VAR=value"` — and put **no space before `&&`**. Without the
> quotes, `cmd` includes the space before `&&` in the value, producing a
> name like `issueflow_test ` (trailing space) and a "database does not
> exist" error.

**bash/zsh:**
```bash
DATABASE_URL=postgresql://issueflow:issueflow@localhost:5432/issueflow_test npm run migrate
DATABASE_URL=postgresql://issueflow:issueflow@localhost:5432/issueflow_test npm run test:e2e
```

**cmd.exe:**
```cmd
set "DATABASE_URL=postgresql://issueflow:issueflow@localhost:5432/issueflow_test" && npm run migrate
set "DATABASE_URL=postgresql://issueflow:issueflow@localhost:5432/issueflow_test" && npm run test:e2e
```

**PowerShell:**
```powershell
$env:DATABASE_URL="postgresql://issueflow:issueflow@localhost:5432/issueflow_test"; npm run migrate
$env:DATABASE_URL="postgresql://issueflow:issueflow@localhost:5432/issueflow_test"; npm run test:e2e
```

The e2e suites run sequentially (`maxWorkers: 1`) because they share one
database; each test truncates tables to start from a clean state.

### 9c. Test coverage

**Purpose:** run the unit suite and report how much of the code it
exercises, line by line. Useful for spotting untested logic.

Same in every shell:

```bash
npm run test:cov
```

The service layer — where the business logic lives — sits at roughly
90–98% coverage. Controllers, repositories, and module-wiring files show
lower numbers here because they are deliberately exercised by the e2e
suite (§9b) instead of the mocked unit tests.

---

## 10. Auto-escalation scheduler

A background cron job promotes the priority of overdue, unresolved tickets
(past their `dueDate`, not `DONE`). The schedule comes from
`ESCALATION_CRON` (default `0 * * * *` — hourly).

To observe a cycle immediately, an `ADMIN` can trigger one:

**bash/zsh:**
```bash
curl -X POST http://localhost:3000/admin/escalation/run -H "Authorization: Bearer $TOKEN"
```

**cmd.exe:**
```cmd
curl -X POST http://localhost:3000/admin/escalation/run -H "Authorization: Bearer %TOKEN%"
```

**PowerShell:**
```powershell
curl.exe -X POST http://localhost:3000/admin/escalation/run -H "Authorization: Bearer $TOKEN"
```

The response is a summary, e.g. `{"scanned":2,"promoted":1,"markedOverdue":1,"skipped":0}`.
On a fresh database with no overdue tickets you will correctly see
`{"scanned":0,"promoted":0,"markedOverdue":0,"skipped":0}` — there is
simply nothing to escalate yet. To see it actually promote a ticket,
create one with a past `dueDate` first; `manual-test.md` section 11 shows
the full setup.

For local testing set a fast cadence in `.env`, e.g.
`ESCALATION_CRON=*/1 * * * *` runs the job every minute.

### Logging out (do this last)

`POST /auth/logout` adds your token to a server-side deny-list, so it
**permanently stops working**. Run this only when you are finished — any
authenticated call after it with the same token returns
`401 "Token has been revoked"`. To continue afterwards, log in again
(§8b) to get a fresh token.

**bash/zsh:**
```bash
curl -X POST http://localhost:3000/auth/logout -H "Authorization: Bearer $TOKEN"
```

**cmd.exe:**
```cmd
curl -X POST http://localhost:3000/auth/logout -H "Authorization: Bearer %TOKEN%"
```

**PowerShell:**
```powershell
curl.exe -X POST http://localhost:3000/auth/logout -H "Authorization: Bearer $TOKEN"
```

---

## 11. Visual tools — API console & database browser

Two browser-based tools make manual testing easier (think of them as the
equivalent of Spring Boot's H2 console — one for the API, one for the
database). Both require nothing beyond the normal setup.

### Swagger UI — interactive API console

When the app is running, open:

```
http://localhost:3000/docs
```

This lists **every endpoint** with a "Try it out" button, so you can
exercise the whole API from the browser instead of `curl`. To call the
protected endpoints:

1. Expand `POST /auth/login`, click **Try it out**, send your credentials,
   and copy the `accessToken` from the response.
2. Click the green **Authorize** button (top right), paste the token, and
   confirm. Every subsequent request now carries the bearer token.

The UI can be disabled for a production deployment by setting
`SWAGGER_ENABLED=false` in `.env`.

### Adminer — database browser

`compose.yml` also starts **Adminer**, a lightweight web UI for the
database. After `docker compose up -d`,
open:

```
http://localhost:8080
```

Log in with:

| Field    | Value                                  |
|----------|----------------------------------------|
| System   | PostgreSQL                             |
| Server   | `db`                                   |
| Username | `issueflow`                            |
| Password | `issueflow`                            |
| Database | `issueflow` (or `issueflow_test`)      |

From there you can browse every table, run SQL, and inspect rows created
by your API calls.

---

## 12. Project layout

```
src/
├── main.ts                  app bootstrap
├── app.module.ts            root module — wires all feature modules
├── common/                  shared filters, DTOs, utils, app config
├── database/                pg pool, migration runner, 001_init.sql
├── auth/                    JWT login/logout/me, guards, decorators
├── users/                   user registry (§2.1)
├── projects/                projects CRUD + soft-delete mgmt (§2.3, §3.5)
├── tickets/                 tickets CRUD, lifecycle, dependencies,
│                            workload, CSV export/import (§2.4, §3.2/3.4/3.8)
├── comments/                comments + @mentions (§2.5, §3.6)
├── audit/                   audit log (§3.1)
├── scheduler/               auto-escalation cron job (§3.7)
└── attachments/             file attachments (§3.3)

test/                        end-to-end test suites + shared harness
```

---

## 13. Troubleshooting

| Symptom                                          | Fix                                                                                  |
|---------------------------------------------------|---------------------------------------------------------------------------------------|
| `ECONNREFUSED 127.0.0.1:5432`                     | Database not running — `docker compose up -d`.                                        |
| `relation "users" does not exist`                 | Schema not applied — `npm run migrate`.                                               |
| `database "issueflow_test " does not exist` (note the trailing space) | `cmd.exe` quoting — use `set "VAR=value"` with **no space before `&&`** (see §9b). |
| `database "issueflow_test" does not exist` on a normal `start`/`migrate` | A `DATABASE_URL` you set earlier still lingers in this terminal session and overrides `.env`. Clear it — `set DATABASE_URL=` (cmd) / `Remove-Item Env:DATABASE_URL` (PowerShell) — or open a fresh terminal. |
| `'{username:...}' should not exist` in a response | Shell quoting — on `cmd.exe` use double quotes with inner `""`; in PowerShell use `curl.exe` (see §8a). |
| `Could not resolve host: application`             | Same cause — the `Content-Type` header got split on its space by wrong quoting.       |
| `WSL 1 is not supported`                          | Convert your distro to WSL 2: `wsl --set-version <Distro> 2`, or use `cmd`/PowerShell. |
| `401 Unauthorized` on every call                  | Missing/expired JWT — log in again and send the `Authorization` header.               |
| Port 3000 already in use                          | Set a different `PORT` in `.env`.                                                     |