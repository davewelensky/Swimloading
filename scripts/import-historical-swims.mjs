/**
 * SwimLoading — Historical Swim Data Import
 * Imports Big Bay Events CSV (2014-2024) into Supabase
 *
 * Usage:
 *   node scripts/import-historical-swims.mjs
 *
 * Requirements:
 *   npm install @supabase/supabase-js
 *
 * You need the SERVICE ROLE KEY (not anon key) to bypass RLS.
 * Get it from: Supabase Dashboard → Settings → API → service_role key
 */

import { createClient } from '@supabase/supabase-js';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── CONFIG ────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://szgkzuswelntnevobnoh.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const CSV_PATH = join(__dirname, '..', 'Swim Summary New Format 1.1xlsx.csv');

if (!SUPABASE_SERVICE_KEY) {
    console.error('❌  Set SUPABASE_SERVICE_KEY env var first:');
    console.error('    export SUPABASE_SERVICE_KEY="your-service-role-key"');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
});

// ─── NORMALIZATION HELPERS ──────────────────────────────────────────────────

function normalizeConditions(raw) {
    const map = {
        'good':            'good',
        'good conditions': 'good',
        'bumpy':           'bumpy',
        'choppy':          'choppy',
        'misty':           'misty',
        'big swell':       'big_swell',
        'rain':            'rain',
        'all seasons':     'all_seasons',
    };
    return map[raw.trim().toLowerCase()] || null;
}

function normalizeCategory(raw) {
    const map = {
        'skins':    'skins',
        'wetsuit':  'wetsuit',
        'relay':    'relay',
        'assisted': 'assisted',
    };
    return map[raw.trim().toLowerCase()] || null;
}

function normalizeStroke(raw) {
    const map = {
        'butterfly':    'butterfly',
        'breast stroke': 'breaststroke',
        'breaststroke': 'breaststroke',
    };
    return map[raw.trim().toLowerCase()] || null;
}

function normalizeGender(raw) {
    const g = raw.trim().toUpperCase();
    return (g === 'M' || g === 'F') ? g : null;
}

function parseDecimal(raw) {
    // Handle European comma decimals: "7,4" → 7.4
    if (!raw || raw.trim() === '' || raw.trim() === '0') return null;
    const val = parseFloat(raw.trim().replace(',', '.'));
    return isNaN(val) ? null : val;
}

function parseDate(raw) {
    // "January 4, 2014" → "2014-01-04"
    if (!raw || raw.trim() === '') return null;
    const d = new Date(raw.trim());
    if (isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0];
}

function parseDuration(raw) {
    // "2:30:00" or "08:09:26" → PostgreSQL interval string
    if (!raw || raw.trim() === '') return null;
    const parts = raw.trim().split(':');
    if (parts.length !== 3) return null;
    const [h, m, s] = parts.map(Number);
    if (isNaN(h) || isNaN(m) || isNaN(s)) return null;
    return `${h} hours ${m} minutes ${s} seconds`;
}

function hashEmail(email) {
    if (!email || email.trim() === '0' || email.trim() === '#N/A' || !email.includes('@')) return null;
    return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

function isGroupName(name, email, dob) {
    if (!name) return false;
    const n = name.trim();
    // Known group names or patterns
    if (n === 'Mad Swimmers') return true;
    if (n === 'Filipinos') return true;
    if (n.includes(',') && n.split(',').length > 2) return true; // "A, B, C, D"
    if (n.toLowerCase().includes('relay') && n.includes('-')) return true; // "Andrea Mason - Anneke Boshoff relay"
    if ((email === '0' || email === '#N/A') && (dob === '00/01/1900' || dob === '') && n.split(' ').length < 2) return true;
    return false;
}

function normalizeRouteName(raw) {
    return raw.trim(); // Just trim — unique routes are inserted as-is
}

function normalizeNameForLookup(name) {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isValidValue(val) {
    return val && val.trim() !== '' && val.trim() !== '0' && val.trim() !== '#N/A';
}

// ─── CSV READER ─────────────────────────────────────────────────────────────

async function readCSV(filePath) {
    const rows = [];
    const rl = createInterface({
        input: createReadStream(filePath),
        crlfDelay: Infinity
    });

    let isHeader = true;
    for await (const line of rl) {
        if (isHeader) { isHeader = false; continue; } // skip header
        if (!line.trim()) continue;

        const cols = line.split(';');
        rows.push({
            rowNum:      parseInt(cols[0]) || 0,
            date:        cols[1]?.trim() || '',
            swimmer:     cols[2]?.trim() || '',
            route:       cols[3]?.trim() || '',
            conditions:  cols[4]?.trim() || '',
            dist:        cols[5]?.trim() || '',
            temp:        cols[6]?.trim() || '',
            time:        cols[7]?.trim() || '',
            category:    cols[8]?.trim() || '',
            stroke:      cols[9]?.trim() || '',
            islandEscape: cols[10]?.trim() || '',
            jammers:     cols[11]?.trim() || '',
            relay:       cols[12]?.trim() || '',
            email:       cols[13]?.trim() || '',
            name:        cols[14]?.trim() || '',
            dob:         cols[15]?.trim() || '',
            gender:      cols[16]?.trim() || '',
            city:        cols[17]?.trim() || '',
            country:     cols[18]?.trim() || '',
        });
    }
    return rows;
}

// ─── PASS 1: IMPORT ROUTES ──────────────────────────────────────────────────

async function importRoutes(rows) {
    console.log('\n📍 Pass 1: Importing routes...');

    const uniqueRoutes = [...new Set(rows.map(r => normalizeRouteName(r.route)).filter(Boolean))];
    console.log(`   Found ${uniqueRoutes.length} unique routes`);

    // Route metadata — water body and crossing classification
    const routeMeta = {
        'False Bay - W-E solo':              { water_body: 'false_bay', is_crossing: true, distance_km: 33 },
        'False Bay - W-E relay':             { water_body: 'false_bay', is_crossing: true, distance_km: 33 },
        'Robben Island - Big Bay':           { water_body: 'atlantic',  is_crossing: true, distance_km: 7.4 },
        'Big Bay - Robben Island':           { water_body: 'atlantic',  is_crossing: true, distance_km: 7.4 },
        'Big Bay - RI - Big Bay':            { water_body: 'atlantic',  is_crossing: true, distance_km: 14.8 },
        'Big Bay - around RI - Big Bay':     { water_body: 'atlantic',  is_crossing: true, distance_km: 24 },
        'Around Robben Island':              { water_body: 'atlantic',  is_crossing: true, distance_km: 11 },
        'Robben Island - 3Anchor Bay':       { water_body: 'atlantic',  is_crossing: true, distance_km: 10.2 },
        '3 Anchor Bay - Robben Island':      { water_body: 'atlantic',  is_crossing: true, distance_km: 10.2 },
        'Robben Island - Melkbos':           { water_body: 'atlantic',  is_crossing: true, distance_km: 10.5 },
        'Melkbos - RI - Melkbos':            { water_body: 'atlantic',  is_crossing: true },
        'Milnerton - Robben Island - Big Bay':{ water_body: 'atlantic', is_crossing: true },
        'Milnerton Lighthouse - Big Bay':    { water_body: 'atlantic',  is_crossing: false },
        'Llandudno - RI':                    { water_body: 'atlantic',  is_crossing: true, distance_km: 22 },
        'Llandudno - Camps Bay':             { water_body: 'atlantic',  is_crossing: false, distance_km: 8 },
        'Llandudno - Clifton':               { water_body: 'atlantic',  is_crossing: false, distance_km: 10 },
        'Camps Bay - Oceana':                { water_body: 'atlantic',  is_crossing: false },
        'Camps Bay - Robben Island':         { water_body: 'atlantic',  is_crossing: true },
        'Clifton - Oceana':                  { water_body: 'atlantic',  is_crossing: false, distance_km: 8 },
        'Oceana - RI':                       { water_body: 'atlantic',  is_crossing: true },
        'Hout Bay - RI':                     { water_body: 'atlantic',  is_crossing: true },
        'Hout Bay - Sandy Bay':              { water_body: 'atlantic',  is_crossing: false, distance_km: 10.2 },
        'Kommetjie - Hout Bay':              { water_body: 'atlantic',  is_crossing: false },
        'Kommetjie - Scarborough':           { water_body: 'atlantic',  is_crossing: false },
        'Cape Point':                        { water_body: 'mixed',     is_crossing: true, distance_km: 8 },
        'Cape Point - Gordons Bay':          { water_body: 'mixed',     is_crossing: true },
        'Three Capes':                       { water_body: 'mixed',     is_crossing: true },
        'Simon\'s Town - Muizenburg':        { water_body: 'false_bay', is_crossing: false },
        'Simon\'s Town - Muizenburg - ST':   { water_body: 'false_bay', is_crossing: false },
        'Fishhoek - Miller\'s Point':        { water_body: 'false_bay', is_crossing: false },
        'Miller\'s Point -Fishhoek':         { water_body: 'false_bay', is_crossing: false },
        'Gordon\'s Bay - RooiEls':           { water_body: 'false_bay', is_crossing: true },
        'Dassen Island - Long route':        { water_body: 'west_coast', is_crossing: true, distance_km: 11 },
        'Dassen Island - Yzerfontein':       { water_body: 'west_coast', is_crossing: true },
        'RI - Dassen Island - Relay':        { water_body: 'atlantic',  is_crossing: true },
        'Yzerfontein - Dassen - Yzer':       { water_body: 'west_coast', is_crossing: true },
        'Preek Stoel - Pearly\'s':           { water_body: 'west_coast', is_crossing: false, distance_km: 8 },
        'Preek Stoel - Mykonos':             { water_body: 'west_coast', is_crossing: false, distance_km: 12 },
        'Mykonos - Preek Stoel':             { water_body: 'west_coast', is_crossing: false, distance_km: 12 },
        'Preek Stoel - Mykonos - Preek Stoel': { water_body: 'west_coast', is_crossing: false },
        'Mykonos - Preek Stoel - Mykonos':   { water_body: 'west_coast', is_crossing: false },
        'Pearly\'s - Preek Stoel':           { water_body: 'west_coast', is_crossing: false, distance_km: 8 },
        'Preek Stoel - Pearly\'s - Preek Stoel': { water_body: 'west_coast', is_crossing: false },
        'Preek Stoel - Friday Island':       { water_body: 'west_coast', is_crossing: false },
        'BB - Melkbos':                      { water_body: 'atlantic',  is_crossing: false },
        'Dogs Leg - BB-RI-Oceana':           { water_body: 'atlantic',  is_crossing: true },
        'Dogs leg':                          { water_body: 'atlantic',  is_crossing: false },
        'Quad RI - Blouberg':                { water_body: 'atlantic',  is_crossing: true },
        'Triple - RI - BB - RI - BB':        { water_body: 'atlantic',  is_crossing: true },
        'Westcoast Angle':                   { water_body: 'west_coast', is_crossing: false },
        'NSRI stat - stat':                  { water_body: 'atlantic',  is_crossing: false },
    };

    const routeInserts = uniqueRoutes.map(name => ({
        name,
        name_normalized: name.toLowerCase().trim(),
        ...(routeMeta[name] || { water_body: null, is_crossing: false }),
    }));

    const { error } = await supabase
        .from('historical_routes')
        .upsert(routeInserts, { onConflict: 'name' });

    if (error) {
        console.error('❌  Route insert error:', error.message);
        process.exit(1);
    }

    // Fetch back with IDs
    const { data: routes } = await supabase
        .from('historical_routes')
        .select('id, name');

    const routeMap = {};
    routes.forEach(r => { routeMap[r.name] = r.id; });
    console.log(`   ✅  ${routes.length} routes imported`);
    return routeMap;
}

// ─── PASS 2: IMPORT SWIMMERS ────────────────────────────────────────────────

async function importSwimmers(rows) {
    console.log('\n🏊 Pass 2: Importing swimmers...');

    // Deduplicate by name_normalized + gender + email_hash
    const swimmerMap = new Map(); // key → swimmer data

    for (const row of rows) {
        const rawName = isValidValue(row.name) ? row.name : row.swimmer;
        if (!rawName) continue;

        const nameNorm = normalizeNameForLookup(rawName);
        const gender   = normalizeGender(row.gender);
        const emailHash = hashEmail(row.email);
        const isGroup  = isGroupName(rawName, row.email, row.dob);

        // Key: prefer email hash for dedup (most reliable), fallback to name+gender
        const key = emailHash || `${nameNorm}|${gender}`;

        if (!swimmerMap.has(key)) {
            swimmerMap.set(key, {
                display_name:     rawName.trim(),
                name_normalized:  nameNorm,
                gender,
                city:             isValidValue(row.city)    ? row.city.trim()    : null,
                country:          isValidValue(row.country) ? row.country.trim() : null,
                email_hash:       emailHash,
                is_group:         isGroup,
            });
        }
    }

    const swimmers = Array.from(swimmerMap.values());
    console.log(`   Found ${swimmers.length} unique swimmers`);

    // Insert in batches of 500 — ignore duplicates via plain insert
    const BATCH = 500;
    for (let i = 0; i < swimmers.length; i += BATCH) {
        const batch = swimmers.slice(i, i + BATCH);
        const { error } = await supabase
            .from('historical_swimmers')
            .insert(batch, { ignoreDuplicates: true });
        if (error) {
            console.error(`❌  Swimmer insert error (batch ${i}):`, error.message);
            process.exit(1);
        }
        process.stdout.write(`   Inserted ${Math.min(i + BATCH, swimmers.length)}/${swimmers.length} swimmers\r`);
    }

    // Fetch back with IDs — build lookup by email_hash and by name_normalized+gender
    const { data: allSwimmers } = await supabase
        .from('historical_swimmers')
        .select('id, name_normalized, gender, email_hash');

    const byEmailHash = {};
    const byNameGender = {};
    const byNameOnly = {};
    allSwimmers.forEach(s => {
        if (s.email_hash) byEmailHash[s.email_hash] = s.id;
        const k = `${s.name_normalized}|${s.gender}`;
        if (!byNameGender[k]) byNameGender[k] = s.id;
        // Name-only fallback for rows missing gender
        if (!byNameOnly[s.name_normalized]) byNameOnly[s.name_normalized] = s.id;
    });

    console.log(`\n   ✅  ${allSwimmers.length} swimmers imported`);
    return { byEmailHash, byNameGender, byNameOnly };
}

// ─── PASS 3: IMPORT SWIMS ──────────────────────────────────────────────────

async function importSwims(rows, routeMap, swimmerLookup) {
    console.log('\n🌊 Pass 3: Importing swims...');

    const { byEmailHash, byNameGender, byNameOnly } = swimmerLookup;
    const skipped = [];
    const swims = [];

    // Track sub-index per source_row_num (relay teams share same row number)
    const rowNumCount = {};

    for (const row of rows) {
        const routeName = normalizeRouteName(row.route);
        const routeId   = routeMap[routeName];
        if (!routeId) {
            skipped.push({ row: row.rowNum, reason: `Unknown route: ${routeName}` });
            continue;
        }

        const rawName   = isValidValue(row.name) ? row.name : row.swimmer;
        const altName   = isValidValue(row.swimmer) ? row.swimmer : null; // fallback if name/swimmer differ
        const nameNorm  = normalizeNameForLookup(rawName || '');
        const altNorm   = altName ? normalizeNameForLookup(altName) : null;
        const gender    = normalizeGender(row.gender);
        const emailHash = hashEmail(row.email);

        const swimmerId = (emailHash && byEmailHash[emailHash])
            || byNameGender[`${nameNorm}|${gender}`]
            || byNameGender[`${nameNorm}|null`]
            || byNameGender[`${nameNorm}|M`]
            || byNameGender[`${nameNorm}|F`]
            || byNameOnly[nameNorm]
            // also try the swimmer column spelling if different
            || (altNorm && byNameGender[`${altNorm}|${gender}`])
            || (altNorm && byNameGender[`${altNorm}|null`])
            || (altNorm && byNameGender[`${altNorm}|M`])
            || (altNorm && byNameGender[`${altNorm}|F`])
            || (altNorm && byNameOnly[altNorm]);

        if (!swimmerId) {
            // Debug: show exactly what we tried
            if (['Claire Gibson','Rebecca Thomas','Donovan Miller'].includes(rawName?.trim())) {
                console.log(`\nDEBUG row ${row.rowNum}: name="${rawName}" nameNorm="${nameNorm}" gender="${gender}" emailHash="${emailHash}"`);
                console.log(`  byEmailHash hit: ${emailHash ? !!byEmailHash[emailHash] : 'no email'}`);
                console.log(`  byNameOnly hit: ${!!byNameOnly[nameNorm]}`);
                console.log(`  byNameGender keys with this name:`, Object.keys(byNameGender).filter(k => k.startsWith(nameNorm)));
            }
            skipped.push({ row: row.rowNum, reason: `Swimmer not found: ${rawName}` });
            continue;
        }

        const swimDate = parseDate(row.date);
        if (!swimDate) {
            skipped.push({ row: row.rowNum, reason: `Invalid date: ${row.date}` });
            continue;
        }

        const category = normalizeCategory(row.category);
        if (!category) {
            skipped.push({ row: row.rowNum, reason: `Unknown category: ${row.category}` });
            continue;
        }

        // Handle relay teams sharing same source_row_num — append sub-index
        rowNumCount[row.rowNum] = (rowNumCount[row.rowNum] || 0) + 1;
        const subIdx = rowNumCount[row.rowNum];
        // Store as large integer: row 1377 relay member 2 → 13770002
        const sourceRowNum = row.rowNum * 10000 + subIdx;

        swims.push({
            source_row_num:  sourceRowNum,
            swim_date:       swimDate,
            swimmer_id:      swimmerId,
            route_id:        routeId,
            conditions:      normalizeConditions(row.conditions),
            distance_km:     parseDecimal(row.dist),
            water_temp_c:    parseDecimal(row.temp),
            duration:        parseDuration(row.time),
            category,
            stroke:          normalizeStroke(row.stroke),
            is_island_escape: row.islandEscape?.toLowerCase() === 'yes',
            is_relay:        row.relay?.toLowerCase() === 'yes' || category === 'relay',
            is_jammers:      row.jammers?.toLowerCase() === 'yes',
            source:          'big_bay_events',
        });
    }

    console.log(`   Prepared ${swims.length} swim records (${skipped.length} skipped)`);
    if (skipped.length > 0) {
        console.log('   Skipped rows:');
        skipped.forEach(s => console.log(`     Row ${s.row}: ${s.reason}`));
    }

    // Insert in batches of 500
    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < swims.length; i += BATCH) {
        const batch = swims.slice(i, i + BATCH);
        const { error } = await supabase
            .from('historical_swims')
            .insert(batch, { ignoreDuplicates: true });
        if (error) {
            console.error(`❌  Swim insert error (batch ${i}):`, error.message);
            console.error(error);
            process.exit(1);
        }
        inserted += batch.length;
        process.stdout.write(`   Inserted ${inserted}/${swims.length} swims\r`);
    }

    console.log(`\n   ✅  ${swims.length} swims imported`);
    return swims.length;
}

// ─── VERIFICATION QUERIES ───────────────────────────────────────────────────

async function verify() {
    console.log('\n✔️  Verifying import...\n');

    // Count checks
    const { count: routeCount } = await supabase.from('historical_routes').select('*', { count: 'exact', head: true });
    const { count: swimmerCount } = await supabase.from('historical_swimmers').select('*', { count: 'exact', head: true });
    const { count: swimCount } = await supabase.from('historical_swims').select('*', { count: 'exact', head: true });

    console.log(`   Routes:   ${routeCount}`);
    console.log(`   Swimmers: ${swimmerCount}`);
    console.log(`   Swims:    ${swimCount}`);

    // False Bay crossings check
    const { data: falseBay } = await supabase
        .from('historical_swims')
        .select(`
            swim_date,
            water_temp_c,
            duration,
            category,
            historical_swimmers!inner(display_name),
            historical_routes!inner(name)
        `)
        .like('historical_routes.name', 'False Bay%')
        .eq('category', 'skins')
        .order('duration', { ascending: true })
        .limit(5);

    console.log('\n   🏆 Top 5 False Bay solo times (skins):');
    falseBay?.forEach((s, i) => {
        const dur = s.duration ? `${s.duration}` : 'N/A';
        console.log(`   ${i+1}. ${s.historical_swimmers?.display_name} — ${dur} @ ${s.water_temp_c}°C (${s.swim_date})`);
    });
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

async function main() {
    console.log('🌊 SwimLoading Historical Data Import');
    console.log('=====================================');
    console.log(`   CSV: ${CSV_PATH}`);
    console.log(`   Target: ${SUPABASE_URL}\n`);

    // Read CSV
    console.log('📄 Reading CSV...');
    const rows = await readCSV(CSV_PATH);
    console.log(`   ✅  ${rows.length} rows read`);

    // Run 3 passes
    const routeMap      = await importRoutes(rows);
    const swimmerLookup = await importSwimmers(rows);
    await importSwims(rows, routeMap, swimmerLookup);

    // Verify
    await verify();

    console.log('\n🎉 Import complete!\n');
}

main().catch(err => {
    console.error('❌  Fatal error:', err);
    process.exit(1);
});
