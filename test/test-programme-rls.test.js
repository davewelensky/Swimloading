// Runs sql/applied/2026-10-08_test-programme-engine.sql against an in-memory Postgres (PGlite) with the
// Supabase roles and auth.uid() stubbed, then attacks the RLS as anon / a stranger / the athlete / the admin.
// Skipped (not failed) when @electric-sql/pglite is not installed.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DAVE = 'df137255-3add-4153-b368-32e06e2be188';
const CARINA = 'cff2fc33-4a55-451b-8c7f-20f12c1898ce';
const STRANGER = '00000000-0000-4000-8000-000000000999';
const MIGRATION = path.join(__dirname, '..', 'sql', 'applied', '2026-10-08_test-programme-engine.sql');

const STUBS = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
  CREATE TABLE public._project_identity (key text, value text);
  INSERT INTO public._project_identity VALUES ('project_name', 'swimloading');
  CREATE TABLE public.strava_imports (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
`;

async function boot() {
  let PGlite;
  try { ({ PGlite } = await import('@electric-sql/pglite')); } catch { return null; }
  const db = new PGlite();
  await db.exec(STUBS);
  await db.exec(fs.readFileSync(MIGRATION, 'utf8'));
  return db;
}

// run `fn` as a role + user; always reset afterwards
async function as(db, role, uid, fn) {
  await db.exec(`SET ROLE ${role}`);
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  try { return await fn(); } finally { await db.exec('RESET ROLE'); }
}
const fails = async (p) => { try { await p; } catch (e) { return String(e.message || e); } return null; };

test('test-programme engine: schema, seed and RLS', async (t) => {
  const db = await boot();
  if (!db) return t.skip('@electric-sql/pglite not installed');

  const { rows: [prog] } = await db.query(`SELECT id FROM test_programs WHERE slug = 'jaked-carina'`);
  const pid = prog.id;
  const prod = async (name) => (await db.query(`SELECT id FROM test_products WHERE name = $1`, [name])).rows[0].id;
  const blade = await prod('Jaked Blade');
  const costume = await prod('Training Costume 01');

  await t.test('seed: 1 programme, 2 members, 9 products, nothing invented', async () => {
    assert.equal((await db.query('SELECT count(*)::int n FROM test_program_members')).rows[0].n, 2);
    assert.equal((await db.query('SELECT count(*)::int n FROM test_products')).rows[0].n, 9);
    assert.equal((await db.query('SELECT count(*)::int n FROM test_sessions')).rows[0].n, 0);
    const { rows } = await db.query('SELECT count(*)::int n FROM test_products WHERE model_name IS NOT NULL OR received_on IS NOT NULL');
    assert.equal(rows[0].n, 0, 'model names and received dates stay NULL until confirmed');
    const racing = (await db.query(`SELECT status FROM test_products WHERE name = 'Jaked Racing Swimsuit'`)).rows[0];
    assert.equal(racing.status, 'awaiting_product');
  });

  await t.test('every table has RLS on', async () => {
    const { rows } = await db.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'test\\_%' AND relkind = 'r'`);
    assert.equal(rows.length, 7);
    rows.forEach((r) => assert.equal(r.relrowsecurity, true, r.relname));
  });

  await t.test('anon can read and write nothing', async () => {
    for (const tbl of ['test_programs','test_products','test_sessions','test_observations','test_market_signals','test_program_members']) {
      const err = await as(db, 'anon', '', () => fails(db.query(`SELECT * FROM ${tbl}`)));
      assert.match(err || '', /permission denied/, tbl);
    }
    const err = await as(db, 'anon', '', () => fails(db.query(`INSERT INTO test_sessions (program_id) VALUES ($1)`, [pid])));
    assert.match(err || '', /permission denied/);
  });

  await t.test('a signed-in stranger sees nothing and cannot insert', async () => {
    await as(db, 'authenticated', STRANGER, async () => {
      for (const tbl of ['test_programs','test_products','test_sessions','test_program_members']) {
        assert.equal((await db.query(`SELECT count(*)::int n FROM ${tbl}`)).rows[0].n, 0, tbl);
      }
      const err = await fails(db.query(`INSERT INTO test_sessions (program_id) VALUES ($1)`, [pid]));
      assert.match(err || '', /row-level security/);
    });
  });

  let sessionId;
  await t.test('athlete logs one session with several products, rating and issue rows', async () => {
    await as(db, 'authenticated', CARINA, async () => {
      const s = await db.query(
        `INSERT INTO test_sessions (program_id, environment, distance_km, water_temp_c) VALUES ($1,'sea',2.5,14.5) RETURNING id, created_by`, [pid]);
      sessionId = s.rows[0].id;
      assert.equal(s.rows[0].created_by, CARINA, 'created_by defaults to the caller');
      await db.query(`INSERT INTO test_session_products (session_id, product_id, program_id) VALUES ($1,$2,$3),($1,$4,$3)`, [sessionId, blade, pid, costume]);
      await db.query(`INSERT INTO test_session_products (session_id, product_id, program_id, report_mode) VALUES ($1,$2,$3,'no_change')`, [sessionId, await prod('Jaked Cap'), pid]);
      await db.query(`INSERT INTO test_observations (program_id, session_id, product_id, kind, criterion, score) VALUES ($1,$2,$3,'rating','shoulder_freedom',5)`, [pid, sessionId, blade]);
      await db.query(`INSERT INTO test_observations (program_id, session_id, product_id, kind, criterion, note) VALUES ($1,$2,$3,'issue','neck_chafing','slight')`, [pid, sessionId, blade]);
      assert.equal((await db.query('SELECT count(*)::int n FROM test_session_products')).rows[0].n, 3);
      assert.equal((await db.query('SELECT count(*)::int n FROM test_program_members')).rows[0].n, 1, 'a member sees only their own membership row');
    });
  });

  await t.test('athlete cannot spoof created_by, publish, manage products or delete', async () => {
    await as(db, 'authenticated', CARINA, async () => {
      assert.match(await fails(db.query(`INSERT INTO test_sessions (program_id, created_by) VALUES ($1,$2)`, [pid, DAVE])) || '', /row-level security/);
      assert.match(await fails(db.query(
        `INSERT INTO test_observations (program_id, session_id, product_id, kind, criterion, score, visibility) VALUES ($1,$2,$3,'rating','warmth',4,'publishable')`,
        [pid, sessionId, blade])) || '', /row-level security/, 'only an admin may publish');
      assert.match(await fails(db.query(`UPDATE test_observations SET visibility = 'publishable' WHERE session_id = $1`, [sessionId])) || '',
        /row-level security/, 'cannot flip an existing row to publishable');
      assert.match(await fails(db.query(`INSERT INTO test_products (program_id, name, category) VALUES ($1,'Sneaky','cap')`, [pid])) || '', /row-level security/);
      assert.equal((await db.query(`UPDATE test_products SET status = 'test_complete' RETURNING id`)).rows.length, 0);
      assert.equal((await db.query(`DELETE FROM test_sessions WHERE id = $1 RETURNING id`, [sessionId])).rows.length, 0);
    });
  });

  await t.test('admin can publish, edit the garage and delete', async () => {
    await as(db, 'authenticated', DAVE, async () => {
      const up = await db.query(`UPDATE test_observations SET visibility = 'publishable' WHERE session_id = $1 AND criterion = 'shoulder_freedom' RETURNING id`, [sessionId]);
      assert.equal(up.rows.length, 1);
      assert.equal((await db.query(`UPDATE test_products SET status = 'active_testing' WHERE id = $1 RETURNING id`, [blade])).rows.length, 1);
    });
  });

  await t.test('data integrity: ranges, rating needs a score, products cannot cross programmes', async () => {
    await as(db, 'authenticated', CARINA, async () => {
      assert.match(await fails(db.query(`INSERT INTO test_observations (program_id, session_id, product_id, kind, criterion, score) VALUES ($1,$2,$3,'rating','warmth',6)`, [pid, sessionId, blade])) || '', /check/i);
      assert.match(await fails(db.query(`INSERT INTO test_observations (program_id, session_id, product_id, kind, criterion) VALUES ($1,$2,$3,'rating','warmth')`, [pid, sessionId, blade])) || '', /check/i);
      assert.match(await fails(db.query(`INSERT INTO test_observations (program_id, session_id, product_id, kind, criterion, score) VALUES ($1,$2,$3,'rating','shoulder_freedom',3)`, [pid, sessionId, blade])) || '', /duplicate|unique/i);
      assert.match(await fails(db.query(`INSERT INTO test_sessions (program_id, water_temp_c) VALUES ($1, 99)`, [pid])) || '', /check/i);
      assert.match(await fails(db.query(`INSERT INTO test_sessions (program_id, rpe) VALUES ($1, 11)`, [pid])) || '', /check/i);
    });
    // a product from ANOTHER programme cannot be attached to this programme's session
    const other = (await db.query(`INSERT INTO test_programs (slug,title,partner_name,athlete_name) VALUES ('other-prog','o','o','o') RETURNING id`)).rows[0].id;
    const foreign = (await db.query(`INSERT INTO test_products (program_id,name,category) VALUES ($1,'Foreign','cap') RETURNING id`, [other])).rows[0].id;
    const err = await fails(db.query(`INSERT INTO test_session_products (session_id, product_id, program_id) VALUES ($1,$2,$3)`, [sessionId, foreign, pid]));
    assert.match(err || '', /foreign key|violates/i);
  });

  await t.test('test_save_session: atomic save, edit, and it cannot bypass RLS', async () => {
    const payload = (extra = {}) => [
      { product_id: blade, report_mode: 'report', observations: [
          { kind: 'rating', criterion: 'fit', score: 5 }, { kind: 'issue', criterion: 'none' }, { kind: 'note', criterion: 'athlete_note', note: 'Easy to get on' }, ...(extra.obs || []) ] },
      { product_id: costume, report_mode: 'no_change', observations: [] },
    ];
    const count = async (tbl) => (await db.query(`SELECT count(*)::int n FROM ${tbl}`)).rows[0].n;
    let id;
    await as(db, 'authenticated', CARINA, async () => {
      const before = await count('test_sessions');
      id = (await db.query(`SELECT test_save_session($1, NULL, $2::jsonb, $3::jsonb) id`,
        [pid, JSON.stringify({ environment: 'sea', athlete_note: 'first open water', data_status: 'partial' }), JSON.stringify(payload())])).rows[0].id;
      assert.equal(await count('test_sessions'), before + 1);
      assert.equal((await db.query('SELECT count(*)::int n FROM test_session_products WHERE session_id = $1', [id])).rows[0].n, 2);
      assert.equal((await db.query(`SELECT count(*)::int n FROM test_observations WHERE session_id = $1 AND visibility = 'private'`, [id])).rows[0].n, 3);

      // all-or-nothing: one bad observation (score 9) must leave NO session behind
      const sessionsBefore = await count('test_sessions');
      const err = await fails(db.query(`SELECT test_save_session($1, NULL, $2::jsonb, $3::jsonb)`,
        [pid, JSON.stringify({ environment: 'sea' }), JSON.stringify(payload({ obs: [{ kind: 'rating', criterion: 'warmth', score: 9 }] }))]));
      assert.match(err || '', /check/i);
      assert.equal(await count('test_sessions'), sessionsBefore, 'a failed save leaves no orphan session');

      assert.match(await fails(db.query(`SELECT test_save_session($1, NULL, '{}'::jsonb, '[]'::jsonb)`, [pid])) || '', /at least one product/);

      // edit: the real date and distance are entered later, products replaced
      await db.query(`SELECT test_save_session($1, $2, $3::jsonb, $4::jsonb)`,
        [pid, id, JSON.stringify({ session_date: '2026-10-04', distance_km: '2.5', environment: 'sea', water_temp_c: '14.5', data_status: 'complete' }),
         JSON.stringify([{ product_id: blade, observations: [{ kind: 'rating', criterion: 'fit', score: 4 }] }])]);
      const row = (await db.query('SELECT session_date::text d, distance_km::float k, data_status s FROM test_sessions WHERE id = $1', [id])).rows[0];
      assert.deepEqual(row, { d: '2026-10-04', k: 2.5, s: 'complete' });
      assert.equal((await db.query('SELECT count(*)::int n FROM test_session_products WHERE session_id = $1', [id])).rows[0].n, 1);
      assert.equal((await db.query('SELECT score FROM test_observations WHERE session_id = $1', [id])).rows[0].score, 4);
    });
    // a stranger cannot use the function to write into the programme (SECURITY INVOKER keeps RLS in force)
    await as(db, 'authenticated', STRANGER, async () => {
      assert.match(await fails(db.query(`SELECT test_save_session($1, NULL, '{}'::jsonb, $2::jsonb)`, [pid, JSON.stringify(payload())])) || '', /row-level security/);
      assert.match(await fails(db.query(`SELECT test_save_session($1, $2, '{}'::jsonb, $3::jsonb)`, [pid, id, JSON.stringify(payload())])) || '', /Session not found/);
    });
    const anonErr = await as(db, 'anon', '', () => fails(db.query(`SELECT test_save_session($1, NULL, '{}'::jsonb, '[]'::jsonb)`, [pid])));
    assert.match(anonErr || '', /permission denied/);
  });

  await t.test('market signals: members write, admin deletes, kept separate from product tables', async () => {
    await as(db, 'authenticated', CARINA, async () => {
      await db.query(`INSERT INTO test_market_signals (program_id, signal_type, count, channel) VALUES ($1,'where_to_buy',2,'instagram dm')`, [pid]);
      assert.equal((await db.query('DELETE FROM test_market_signals RETURNING id')).rows.length, 0, 'athlete cannot delete');
      assert.match(await fails(db.query(`INSERT INTO test_market_signals (program_id, signal_type) VALUES ($1,'made_up')`, [pid])) || '', /check/i);
    });
    await as(db, 'authenticated', DAVE, async () => {
      assert.equal((await db.query('DELETE FROM test_market_signals RETURNING id')).rows.length, 1);
    });
  });
});
