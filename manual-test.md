# Manual Testing Guide

A step-by-step walkthrough to exercise every IssueFlow feature by hand.
Run the commands in order — later steps depend on ids created earlier.

There are two ways to use this guide:

1. **Automated script** — run `bash manual-test.sh` (bash/zsh, WSL 2, or
   Git Bash on Windows). It executes the whole walkthrough and prints a
   pass/fail line for each step.
2. **Copy-paste** — follow the sections below one command at a time, which
   is better for poking at individual features.

If you prefer a GUI, import the same calls into Postman or Insomnia — the
flow is identical.

---

## Shell note — the commands below are written for bash/zsh

The `curl` commands in this guide use **bash/zsh syntax** (single quotes
around JSON bodies and headers). They work as-is on **macOS, Linux,
WSL 2, and Git Bash**.

**On Windows `cmd.exe` or PowerShell, single quotes do not work** — you
must convert each command. Two mechanical rules:

**For `cmd.exe`:**
- Replace the outer single quotes with double quotes.
- Double every inner double quote: `"` becomes `""`.
- Example — this bash command:
  ```bash
  curl -X POST http://localhost:3000/users -H 'Content-Type: application/json' -d '{"username":"alice","role":"ADMIN"}'
  ```
  becomes, in `cmd.exe`:
  ```cmd
  curl -X POST http://localhost:3000/users -H "Content-Type: application/json" -d "{""username"":""alice"",""role"":""ADMIN""}"
  ```

**For PowerShell:**
- Use `curl.exe` (the bare `curl` is an alias for `Invoke-WebRequest`).
- Keep single quotes around the body, but escape inner double quotes as `\"`.
- Example:
  ```powershell
  curl.exe -X POST http://localhost:3000/users -H "Content-Type: application/json" -d '{\"username\":\"alice\",\"role\":\"ADMIN\"}'
  ```

**Variables** also differ: bash `$TOKEN` → `cmd.exe` `%TOKEN%` →
PowerShell `$TOKEN`. Setting a variable: bash `TOKEN=...` → cmd.exe
`set "TOKEN=..."` → PowerShell `$TOKEN="..."`.

> The simplest path on Windows is to run the commands inside **Git Bash**
> or a **WSL 2** shell, where the bash forms below work unchanged — or
> just run `bash manual-test.sh`.

---

## 0. Prerequisites

```bash
docker compose up -d      # start PostgreSQL
npm run migrate           # apply the schema
npm run start:dev         # run the app (leave this running in one terminal)
```

In a second terminal, use the commands below. They assume the API is at
`http://localhost:3000`.

> Tip: install `jq` for readable JSON (`brew install jq` / `apt install jq`).
> Every command below works without it; `jq` just pretty-prints.

---

## Reading the output — important

Every `curl` below uses the **`-i`** flag, which prints the **response
status line and headers** before the body. This matters for two reasons:

- You can **see the HTTP status** (e.g. `HTTP/1.1 200 OK`,
  `HTTP/1.1 409 Conflict`) — essential for the negative checks, where the
  whole point is that the call *should* fail with a 400/401/404/409.
- If the app is **not reachable**, `curl -i` still prints a visible
  connection error. (With `curl -s` — silent — a failed connection prints
  *nothing at all*, which looks like the command "did nothing".)

If a command prints nothing or a connection error: the app isn't running.
Start it with `npm run start:dev` in a separate terminal first.

---

## 1. Health (public, no auth)

```bash
curl -i http://localhost:3000/
curl -i http://localhost:3000/health
```

Expect `HTTP/1.1 200 OK` and a body of `{"status":"ok",...}`.

---

## 2. User Management (§2.1)

`POST /users` is public (it's how the first user is created); the other
user endpoints require a JWT, so the read/update/delete steps below come
after section 3 obtains a token. For convenience they are grouped here as
one feature; run section 3 first if you want to execute them immediately.

### 2a. Register users (public)

Register an ADMIN and two DEVELOPERs — each should return `200 OK`:

```bash
curl -i -X POST http://localhost:3000/users -H 'Content-Type: application/json' -d '{"username":"alice","email":"alice@example.com","fullName":"Alice Admin","role":"ADMIN","password":"password123"}'
```
```bash
curl -i -X POST http://localhost:3000/users -H 'Content-Type: application/json' -d '{"username":"bob","email":"bob@example.com","fullName":"Bob Dev","role":"DEVELOPER","password":"password123"}'
```
```bash
curl -i -X POST http://localhost:3000/users -H 'Content-Type: application/json' -d '{"username":"carol","email":"carol@example.com","fullName":"Carol Dev","role":"DEVELOPER","password":"password123"}'
```

The README "Create a user" contract body is `{username, email, fullName,
role}` — **password is optional**. A user created without one is still
created with `200 OK`, but cannot log in until a password is set. Verify
that contract directly:

```bash
# register WITHOUT a password -> still 200 OK
curl -i -X POST http://localhost:3000/users -H 'Content-Type: application/json' -d '{"username":"dave","email":"dave@example.com","fullName":"Dave NoPass","role":"DEVELOPER"}'
```
```bash
# that passwordless user cannot log in -> 401 Unauthorized
curl -i -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' -d '{"username":"dave","password":"anything"}'
```

**Negative checks:**

```bash
# duplicate username -> 409 Conflict
curl -i -X POST http://localhost:3000/users -H 'Content-Type: application/json' -d '{"username":"alice","email":"x@x.com","fullName":"X","role":"ADMIN","password":"password123"}'
```
```bash
# invalid role -> 400 Bad Request
curl -i -X POST http://localhost:3000/users -H 'Content-Type: application/json' -d '{"username":"bad","email":"x@x.com","fullName":"X","role":"WIZARD","password":"password123"}'
```

### 2b. Read, update, and delete users (authenticated)

These need a token — run section 3 first and have `$TOKEN` set.

```bash
# list all users
curl -i http://localhost:3000/users -H "Authorization: Bearer $TOKEN"
```
```bash
# get one user by id
curl -i http://localhost:3000/users/1 -H "Authorization: Bearer $TOKEN"
```
```bash
# get a non-existent user -> 404 Not Found
curl -i http://localhost:3000/users/99999 -H "Authorization: Bearer $TOKEN"
```

Update a user — note the endpoint is `POST /users/update/:id` (per the
README contract), and only `fullName` and `role` are updatable:

```bash
# update bob's fullName and role
curl -i -X POST http://localhost:3000/users/update/2 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"fullName":"Bob Senior Dev","role":"ADMIN"}'
```
```bash
# confirm the change took effect
curl -i http://localhost:3000/users/2 -H "Authorization: Bearer $TOKEN"
```
```bash
# update with an invalid role -> 400 Bad Request
curl -i -X POST http://localhost:3000/users/update/2 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"role":"WIZARD"}'
```

Delete a user:

```bash
# delete the passwordless user dave (id 4) -> 200 OK
curl -i -X DELETE http://localhost:3000/users/4 -H "Authorization: Bearer $TOKEN"
```
```bash
# he is now gone -> 404 Not Found
curl -i http://localhost:3000/users/4 -H "Authorization: Bearer $TOKEN"
```

---

## 3. Authentication

Log in as alice and capture the token. The `jq` form extracts it
automatically; without `jq`, run the plain login and copy the
`accessToken` value by hand.

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' -d '{"username":"alice","password":"password123"}' | jq -r .accessToken)
echo "$TOKEN"
```

No `jq`? Run this, then copy the token manually:

```bash
curl -i -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' -d '{"username":"alice","password":"password123"}'
```
```bash
export TOKEN=PASTE_THE_ACCESS_TOKEN_HERE
```

> Note: the token-capture command above uses `curl -s` (silent) on
> purpose — its output is fed into the variable, not your screen. `echo
> "$TOKEN"` then shows what was captured. If it prints an empty line, the
> login failed (app down, or wrong credentials).

```bash
# whoami
curl -i http://localhost:3000/auth/me -H "Authorization: Bearer $TOKEN"
```
```bash
# wrong password -> 401
curl -i -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' -d '{"username":"alice","password":"wrong"}'
```
```bash
# protected route with no token -> 401
curl -i http://localhost:3000/projects
```

---

## 4. Projects

```bash
# create
curl -i -X POST http://localhost:3000/projects -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"Website Revamp","description":"Q3 marketing site","ownerId":1}'
```
```bash
# list
curl -i http://localhost:3000/projects -H "Authorization: Bearer $TOKEN"
```
```bash
# get one
curl -i http://localhost:3000/projects/1 -H "Authorization: Bearer $TOKEN"
```
```bash
# update
curl -i -X PATCH http://localhost:3000/projects/1 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"Website Revamp v2"}'
```
```bash
# non-existent owner -> 404
curl -i -X POST http://localhost:3000/projects -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"name":"Bad","description":"x","ownerId":999}'
```

---

## 5. Tickets + auto-assignment (§3.8)

Create tickets **without** `assigneeId` — they auto-assign to the
least-loaded developer (bob, then carol):

```bash
curl -i -X POST http://localhost:3000/tickets -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"title":"Fix nav bar","type":"BUG","projectId":1}'
```
```bash
curl -i -X POST http://localhost:3000/tickets -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"title":"Add dark mode","type":"FEATURE","projectId":1}'
```

Check `assigneeId` in each response body: ticket 1 -> bob (id 2),
ticket 2 -> carol (id 3).

```bash
# workload — developers sorted by open-ticket count
curl -i http://localhost:3000/projects/1/workload -H "Authorization: Bearer $TOKEN"
```
```bash
# list / filter by project
curl -i "http://localhost:3000/tickets?projectId=1" -H "Authorization: Bearer $TOKEN"
```

---

## 6. Ticket lifecycle + optimistic locking (§2.4)

```bash
# get the current version (starts at 1)
curl -i http://localhost:3000/tickets/1 -H "Authorization: Bearer $TOKEN"
```

Move the ticket forward — send the current version each time, then use
the new version the response returns:

```bash
# TODO -> IN_PROGRESS (version 1)
curl -i -X PATCH http://localhost:3000/tickets/1 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"status":"IN_PROGRESS","version":1}'
```
```bash
# backwards transition -> 400
curl -i -X PATCH http://localhost:3000/tickets/1 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"status":"TODO","version":2}'
```
```bash
# stale version -> 409
curl -i -X PATCH http://localhost:3000/tickets/1 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"title":"stale write","version":1}'
```

---

## 7. Dependencies (§3.2)

```bash
# ticket 1 is blocked by ticket 2
curl -i -X POST http://localhost:3000/tickets/1/dependencies -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"blockedBy":2}'
```
```bash
# list blockers
curl -i http://localhost:3000/tickets/1/dependencies -H "Authorization: Bearer $TOKEN"
```
```bash
# self-dependency -> 400
curl -i -X POST http://localhost:3000/tickets/1/dependencies -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"blockedBy":1}'
```
```bash
# cycle -> 400 (1 is already blocked by 2; the reverse closes a loop)
curl -i -X POST http://localhost:3000/tickets/2/dependencies -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"blockedBy":1}'
```
```bash
# 1 -> DONE blocked while blocker 2 is unresolved -> 409
curl -i -X PATCH http://localhost:3000/tickets/1 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"status":"DONE","version":2}'
```
```bash
# resolve ticket 2
curl -i -X PATCH http://localhost:3000/tickets/2 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"status":"DONE","version":1}'
```
```bash
# now 1 -> DONE succeeds
curl -i -X PATCH http://localhost:3000/tickets/1 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"status":"DONE","version":2}'
```

---

## 8. Comments + @mentions (§2.5, §3.6)

```bash
# create a comment that mentions bob
curl -i -X POST http://localhost:3000/tickets/2/comments -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"authorId":1,"content":"Looking into this @bob, thanks"}'
```

The response body includes a `mentionedUsers` array with bob resolved.

```bash
# list comments
curl -i http://localhost:3000/tickets/2/comments -H "Authorization: Bearer $TOKEN"
```
```bash
# bob's mention feed (bob is user id 2)
curl -i http://localhost:3000/users/2/mentions -H "Authorization: Bearer $TOKEN"
```

---

## 9. Attachments (§3.3)

> The upload/CSV steps create small test files in the **current
> directory** (`./note.txt`, `./bad.exe`, `./import.csv`, and the
> exported `tickets-project-1.csv`). Relative paths are used deliberately
> — a hardcoded `/tmp/...` path does not exist on Windows and would make
> `curl -F file=@...` fail. Delete these files afterwards if you like;
> they are throwaway.

```bash
# make a small test file
echo "hello" > ./note.txt
```
```bash
# upload it
curl -i -X POST http://localhost:3000/tickets/2/attachments -H "Authorization: Bearer $TOKEN" -F "file=@./note.txt;type=text/plain"
```
```bash
# list attachments
curl -i http://localhost:3000/tickets/2/attachments -H "Authorization: Bearer $TOKEN"
```
```bash
# disallowed type -> 400
echo "x" > ./bad.exe
curl -i -X POST http://localhost:3000/tickets/2/attachments -H "Authorization: Bearer $TOKEN" -F "file=@./bad.exe;type=application/x-msdownload"
```
```bash
# delete attachment 1
curl -i -X DELETE http://localhost:3000/tickets/2/attachments/1 -H "Authorization: Bearer $TOKEN"
```

---

## 10. CSV export / import (§3.4)

### Export — download the CSV to a file

Plain `curl` prints the response body to the terminal. To save it as a
file, use **`-OJ`** — `-O` writes to a file, `-J` uses the **filename the
server suggests** in its `Content-Disposition` header, which is
`tickets-project-{id}.csv`:

```bash
# saves as tickets-project-1.csv in the current directory
curl -OJ "http://localhost:3000/tickets/export?projectId=1" -H "Authorization: Bearer $TOKEN"
```

Inspect the file — the **header row must be exactly these seven fields,
in this order** (per §3.4):

```bash
head -n 1 tickets-project-1.csv
# expected: id,title,description,status,priority,type,assigneeId
```
```bash
# see the whole file (header + one row per ticket)
cat tickets-project-1.csv
```

Check the response headers too — the API marks it as a downloadable file:

```bash
# -i shows headers: expect Content-Type: text/csv and
# Content-Disposition: attachment; filename="tickets-project-1.csv"
curl -i "http://localhost:3000/tickets/export?projectId=1" -H "Authorization: Bearer $TOKEN" -o /dev/null
```

```bash
# export without projectId -> 400 Bad Request
curl -i "http://localhost:3000/tickets/export" -H "Authorization: Bearer $TOKEN"
```

> In a browser or in Swagger UI (`/docs`), `GET /tickets/export` triggers
> a real file download (`tickets-project-1.csv`) automatically because of
> the `Content-Disposition` header — no flags needed there.

### Import — upload a CSV

Create a CSV (2 valid rows, 1 invalid) and import it:

```bash
printf 'title,description,status,priority,type,assigneeId\nImported one,from csv,TODO,HIGH,BUG,\nImported two,from csv,IN_PROGRESS,LOW,FEATURE,\n,missing title row,,,BUG,\n' > ./import.csv
```
```bash
curl -i -X POST http://localhost:3000/tickets/import -H "Authorization: Bearer $TOKEN" -F "file=@./import.csv;type=text/csv" -F "projectId=1"
```

Expect `{"created":2,"failed":1,"errors":[{"row":3,...}]}`.

### Round-trip check

Re-export and confirm the rows you just imported now appear in the CSV:

```bash
curl -OJ "http://localhost:3000/tickets/export?projectId=1" -H "Authorization: Bearer $TOKEN"
grep "Imported one" tickets-project-1.csv
```

---

## 11. Auto-escalation (§3.7)

Escalation promotes overdue tickets' priority. To test it without waiting
for the hourly cron: create a ticket with a `dueDate`, backdate it in the
DB, then trigger a cycle.

```bash
# create with a future dueDate and LOW priority
curl -i -X POST http://localhost:3000/tickets -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"title":"Overdue soon","type":"BUG","projectId":1,"priority":"LOW","dueDate":"2999-01-01T00:00:00Z"}'
```
```bash
# backdate its dueDate so it counts as overdue (the one direct-DB step)
docker compose exec db psql -U issueflow -d issueflow -c "UPDATE tickets SET due_date = NOW() - INTERVAL '2 days' WHERE title = 'Overdue soon';"
```
```bash
# trigger an escalation cycle (ADMIN only)
curl -i -X POST http://localhost:3000/admin/escalation/run -H "Authorization: Bearer $TOKEN"
```

Expect `{"scanned":...,"promoted":1,...}`. Re-fetch the ticket — its
`priority` moved LOW -> MEDIUM.

---

## 12. Soft delete + restore (§3.5, ADMIN-only)

```bash
# soft-delete ticket 1
curl -i -X DELETE http://localhost:3000/tickets/1 -H "Authorization: Bearer $TOKEN"
```
```bash
# it's gone from the normal list
curl -i "http://localhost:3000/tickets?projectId=1" -H "Authorization: Bearer $TOKEN"
```
```bash
# but visible in the deleted list (ADMIN)
curl -i "http://localhost:3000/tickets/deleted?projectId=1" -H "Authorization: Bearer $TOKEN"
```
```bash
# restore it
curl -i -X POST http://localhost:3000/tickets/1/restore -H "Authorization: Bearer $TOKEN"
```
```bash
# restoring again -> 409
curl -i -X POST http://localhost:3000/tickets/1/restore -H "Authorization: Bearer $TOKEN"
```

**RBAC check** — a DEVELOPER must be forbidden from the deleted/restore
endpoints:

```bash
DEVTOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' -d '{"username":"bob","password":"password123"}' | jq -r .accessToken)
```
```bash
# -> 403 Forbidden
curl -i "http://localhost:3000/tickets/deleted?projectId=1" -H "Authorization: Bearer $DEVTOKEN"
```

---

## 13. Audit log (§3.1)

Every action above was recorded. Browse it:

```bash
# everything (paginated, newest first)
curl -i http://localhost:3000/audit-logs -H "Authorization: Bearer $TOKEN"
```
```bash
# only ticket events
curl -i "http://localhost:3000/audit-logs?entityType=TICKET" -H "Authorization: Bearer $TOKEN"
```
```bash
# everything that happened to ticket 1
curl -i "http://localhost:3000/audit-logs?entityType=TICKET&entityId=1" -H "Authorization: Bearer $TOKEN"
```
```bash
# SYSTEM-actor auto-assignments
curl -i "http://localhost:3000/audit-logs?action=AUTO_ASSIGN" -H "Authorization: Bearer $TOKEN"
```
```bash
# escalation events
curl -i "http://localhost:3000/audit-logs?action=PRIORITY_ESCALATED" -H "Authorization: Bearer $TOKEN"
```

---

## 14. Logout

```bash
curl -i -X POST http://localhost:3000/auth/logout -H "Authorization: Bearer $TOKEN"
```
```bash
# the same token is now deny-listed -> 401
curl -i http://localhost:3000/auth/me -H "Authorization: Bearer $TOKEN"
```

---

That covers every endpoint and every key rule. To start fresh, reset the
database:

```bash
docker compose exec db psql -U issueflow -d issueflow -c "TRUNCATE users, projects, tickets, comments, comment_mentions, ticket_dependencies, attachments, audit_logs, token_denylist RESTART IDENTITY CASCADE;"
```