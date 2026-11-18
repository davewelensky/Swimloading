# SQL tests — 2026-11-18 JAKED business workspace

Proves `sql/applied/2026-11-18_create-user-roles.sql` + `sql/applied/2026-11-18_jaked-business-workspace.sql`
against a throwaway local Postgres (16+) with a Supabase-like stub (`anon` / `authenticated` /
`service_role`, `auth.users`, `auth.uid()` from `request.jwt.claim.sub`, production-shaped
`partner_enquiries`). Never point this at production.

```bash
P="psql -h <socket-dir> -p <port> -U postgres -v ON_ERROR_STOP=1 -q"
$P -c 'create database jaked_t'
$P -d jaked_t -f test/sql/jaked-business-workspace/00_stub.sql
$P -d jaked_t -f sql/applied/2026-11-18_create-user-roles.sql
$P -d jaked_t -f sql/applied/2026-11-18_jaked-business-workspace.sql
$P -d jaked_t -f sql/applied/2026-11-18_jaked-function-privileges.sql
$P -d jaked_t -f test/sql/jaked-business-workspace/10_behaviour.sql   # every check prints "OK …"; any FAIL raises
$P -d jaked_t -c "delete from partner_enquiries where entry_method='manual'"  # rollback needs email NOT NULL to hold
$P -d jaked_t -f test/sql/jaked-business-workspace/20_rollback.sql
```

Result 18 Nov 2026 (Postgres 16.15): both migrations applied; 12/12 OK checks, 0 FAIL;
rollback returned the schema to its starting state (1 role, no new tables/columns/functions,
`email` NOT NULL again).

What `10_behaviour.sql` checks: Carina (partner_manager) can create/update tasks and read the
log; cannot delete tasks, write the log, read `partner_enquiries` directly, spoof `created_by`,
or grant roles. Another signed-in user and anon see nothing. Web-form enquiries still need an
email; manual ones need an author + channel and may have a phone only. Status changes are
logged with the actor and old/new values; a no-op update is not logged; deletes are logged.
The log cannot be updated, deleted or truncated (not even by the owner). Revoking Carina
removes her access and is itself logged.
