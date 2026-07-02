# SwimLoading — Database Migration Workflow

How every schema or data change reaches the production database. This replaces
copying SQL into the Supabase dashboard. The dashboard remains a fallback only
(see bottom).

There is ONE Supabase project (`szgkzuswelntnevobnoh`) — production. There is no
staging database, so safety comes from: read-only dry-runs first, mandatory
backups before destructive statements, and a hard approval gate before any write.

## Connections (defined in `.mcp.json` — no secrets stored anywhere)

| Server | Access | Used for |
|---|---|---|
| `supabase` | Read-only Postgres user, this project only | Schema inspection, pre-checks, verification — the default |
| `supabase-admin` | Write, database tools only, this project only | Applying approved migrations — nothing else |

Authentication is OAuth in the browser (`/mcp` → select server → Authenticate).
No access tokens, service keys, or database passwords are ever typed into chat,
written to files, or committed. `.mcp.json` contains only public URLs.

`supabase-admin` must NEVER be added to the permission allowlist — its
per-call permission prompt is part of the production gate.

## The 7 steps

1. **Write** — create `sql/YYYY-MM-DD_short-description.sql` from
   `sql/MIGRATION_TEMPLATE.sql`. Every section filled: Purpose, Requested by,
   Pre-checks, Backup (if destructive), Migration (in a transaction),
   Rollback, Verify. The project-identity safety block stays at the top.

2. **Dry-run** — Claude runs the Pre-checks on the read-only `supabase` server
   and shows Dave: the full migration SQL + the affected-row counts.

3. **Backup** — if the migration contains DELETE / UPDATE / DROP / TRUNCATE,
   a backup table `_bak_YYYYMMDD_<table>` is created first
   (`CREATE TABLE ... AS SELECT`). No backup, no apply — no exceptions.
   (History: 168-row wipe Jun 7 2026, import wipe Jun 26 2026.)

4. **Approval gate** — Dave types **"apply"**. Not "ok", not "looks good" —
   the literal word. Claude never applies on its own initiative.

5. **Apply** — via `supabase-admin`, as a single transaction. Dave additionally
   approves the tool permission prompt (second lock). If the transaction
   errors, nothing was applied — report the error, fix the file, restart at
   step 2.

6. **Verify** — Claude runs the file's Verify queries on the read-only server
   and shows results against the stated expectations. A migration without
   passing verification is not done.

7. **File & commit** — `git mv` the file into `sql/applied/` and commit it
   together with the related code change (ships via `/ship`).

## Rules

- Naming: `YYYY-MM-DD_short-description.sql` — lowercase, hyphens, dated.
- One migration file per change. Never edit a file already in `sql/applied/` —
  write a new migration instead.
- Rollback notes are mandatory even when "irreversible" — say so explicitly
  and name the backup table.
- Backup tables (`_bak_*`) are cleaned up by a later migration once the change
  has been live and verified for a sensible period — never in the same session.
- RLS: any new table in an exposed schema gets RLS enabled + policies in the
  same migration (see CLUBS.md for club-scoping patterns).

## Fallback — Supabase dashboard SQL editor

If MCP is unavailable: Claude writes the migration file exactly as above,
gives Dave the absolute file path, Dave pastes it into the dashboard SQL editor
and reports back "sql done" or the error text. Steps 1, 4, 6 and 7 still apply.
