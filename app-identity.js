// ============================================================
// IDENTITY LAYER V1 — Multi-track Swimmer Identity + Swim Cards
// Feature-flagged: identity_layer_v1 (feature_flags table, Dave-only at launch)
// Depends on: app.js globals (supabaseClient, currentUser, currentUserProfile,
//             analytics, showToast, icon, initIcons, showShareSheet)
//
// PRODUCT MODEL (corrected 2026-07-19 — see project memory before changing):
// Cold water is a SPECIALIST track, not the universal progression ladder.
// Every swimmer — Durban, tropical, inland, pool, no Strava — has a
// universal PARTICIPATION identity from valid log counts alone. Cold water
// is optional: shown only when relevant, never as an incomplete ladder.
// No numeric level/order/rank is ever rendered to the user, on the card or
// in the identity view — only track name + achievement name + a supporting
// stat. achievement_order exists in the DB purely for internal sequencing.
//
// SCHEMA DEPENDENCY: this file targets the swimmer_achievements column names
// and RPC return shapes introduced by
// sql/2026-07-19_identity-v1-multitrack-correction.sql (track_type,
// achievement_order, achievement_code, achievement_name, verification_status,
// source_log_id, metadata; evaluate_participation_achievement RPC added;
// evaluate_cold_achievement RPC rewritten to 3 levels). That migration has
// NOT been applied yet — do not deploy this file until it has been, and
// until Dave has explicitly approved the deployment pairing. See
// IMPLEMENTATION SEQUENCE note at the bottom of this header.
//
// Rules preserved from V1 (unchanged):
// - Flag ON  → ONE Swim Card panel replaces the old share sheet. Never two modals.
// - Flag OFF → old showShareSheet() flow untouched (rollback path).
// - Card generation failure → falls back to the ORIGINAL share flow; the swim
//   save is already committed and is never affected.
// - Distance/duration shown ONLY when deterministically linked via
//   strava_imports.imported_to_log_id, labelled "via Strava". Never from
//   temp_logs.distance_km, never zero/blank/inferred.
// - Achievements are awarded ONLY by the server (evaluate_participation_
//   achievement / evaluate_cold_achievement RPCs). This file displays
//   results; it never writes swimmer_achievements directly.
// - Minors and unknown-DOB accounts cannot enable a public profile — enforced
//   server-side by the trg_identity_public_guard trigger; this file mirrors
//   that check client-side only to decide what UI to show, never as the
//   actual gate.
// ============================================================

// ── Participation ladder (client-side copy for display only — the server
//    RPC is the sole source of truth for what's actually earned) ──
const IC_PARTICIPATION_CODES = ['first_swim', 'regular', 'committed', 'consistent', 'established', 'centurion'];
const IC_COLD_CODES = ['shoulder_season', 'coldwater', 'deep_winter'];
const IC_COLD_THRESHOLDS = { shoulder_season: 18, coldwater: 15, deep_winter: 10 };

// "{Name} SWIMMER" for every participation milestone except First Swim,
// which reads oddly with the suffix and is already a complete phrase.
function _icParticipationLabel(code, name) {
    if (code === 'first_swim') return (name || 'First Swim').toUpperCase();
    return `${(name || code).toUpperCase()} SWIMMER`;
}

function _icParticipationSubline(code, totalLogs, activeWeeks) {
    if (code === 'first_swim') return 'The start of your SwimLoading story';
    if (code === 'regular') return `Active across ${activeWeeks || 0} weeks`;
    return `${totalLogs || 0} swims logged`;
}

function _icColdSubline(code, pending) {
    const threshold = IC_COLD_THRESHOLDS[code];
    if (pending) return 'Self-reported — verification pending';
    return threshold ? `Verified below ${threshold}°C` : 'Verified cold swim';
}

// ── Feature flag ────────────────────────────────────────────
let _identityFlagPromise = null;

async function identityLayerEnabled() {
    if (typeof currentUser === 'undefined' || !currentUser) return false;
    if (!_identityFlagPromise) {
        _identityFlagPromise = (async () => {
            try {
                const { data, error } = await supabaseClient
                    .from('feature_flags')
                    .select('enabled_global, allowed_user_ids')
                    .eq('key', 'identity_layer_v1')
                    .maybeSingle();
                if (error || !data) return false;
                return !!data.enabled_global ||
                    (data.allowed_user_ids || []).includes(currentUser.id);
            } catch (e) {
                return false;
            }
        })();
    }
    return _identityFlagPromise;
}

// ── Post-log entry point (called from app.js / app-strava.js) ──
// ctx: { logId, spotName, temp, conditions, source: 'native'|'strava' }
// fallbackFn: the ORIGINAL share flow (or null for the Strava path).
// Contract: exactly one panel ever shows. On any card failure the original
// flow runs instead. Errors never propagate to the caller (save already done).
async function identityPostLogShare(ctx, fallbackFn) {
    let enabled = false;
    try { enabled = await identityLayerEnabled(); } catch (e) { enabled = false; }

    if (!enabled) {
        if (fallbackFn) await fallbackFn();
        return;
    }

    try {
        await showSwimCardPanel(ctx);
    } catch (e) {
        console.error('[identity] Swim Card failed — falling back to original share flow', e);
        try { analytics.track('swim_card_failed_fallback', { source: ctx.source }); } catch (_) {}
        try { if (fallbackFn) await fallbackFn(); } catch (_) {}
    }
}

// ── Server evaluation (trusted; client only requests + displays) ──
// Universal — every swim, every climate, no temperature dependency.
async function _icEvaluateParticipation(logId) {
    if (!logId) return null;
    try {
        const { data, error } = await supabaseClient
            .rpc('evaluate_participation_achievement', { p_log_id: logId });
        if (error || !data || data.error) return null;
        if (data.status === 'earned' && (data.new_levels || []).length) {
            analytics.track('participation_milestone_earned', {
                code: data.code, name: data.name,
                total_logs: data.total_logs, active_weeks: data.active_weeks
            });
        }
        return data;
    } catch (e) {
        console.error('[identity] evaluate_participation_achievement failed', e);
        return null;
    }
}

// Specialist — only ever meaningful for swims that qualify by temperature.
async function _icEvaluateColdSpecialist(logId) {
    if (!logId) return null;
    try {
        const { data, error } = await supabaseClient
            .rpc('evaluate_cold_achievement', { p_log_id: logId });
        if (error || !data || data.error) return null;
        if (data.status === 'earned' && (data.new_levels || []).length) {
            analytics.track('cold_specialist_earned', { code: data.code, name: data.name, temp: data.temp_c });
        } else if (data.status === 'pending_verification' && data.newly_created) {
            // Fires once: server reports newly_created only on first insert
            analytics.track('cold_specialist_pending_verification', { code: data.code, temp: data.temp_c });
        }
        return data;
    } catch (e) {
        console.error('[identity] evaluate_cold_achievement failed', e);
        return null;
    }
}

// ── Adaptive card story selection ───────────────────────────
// Priority: 1) newly earned milestone (either track) 2) relevant standing
// specialist identity for this swim's temperature 3) current participation
// identity 4) (Strava enrichment is layered on top, not a story of its own).
// Never returns a story for cold water when the swim doesn't qualify by
// temperature — that is what keeps an irrelevant/empty ladder off the card.
function _icSelectCardStory(participationResult, coldResult) {
    const partNewly = !!(participationResult && participationResult.status === 'earned' &&
        (participationResult.new_levels || []).length);
    const coldNewly = !!(coldResult && coldResult.status === 'earned' &&
        (coldResult.new_levels || []).length);

    // Both tracks crossing on the same swim is rare (a first-ever swim
    // being independently corroborated as cold within 24h is unlikely) —
    // when it happens, the more specific specialist story leads.
    if (coldNewly) {
        return { kind: 'milestone_cold', code: coldResult.code, name: coldResult.name, pending: false };
    }
    if (partNewly) {
        return {
            kind: 'milestone_participation', code: participationResult.code, name: participationResult.name,
            totalLogs: participationResult.total_logs, activeWeeks: participationResult.active_weeks
        };
    }

    // No new milestone this swim — show whichever standing identity is
    // relevant. A qualifying cold temperature (earned already, or pending)
    // is the more specific story for THIS swim than the general
    // participation identity, so it leads when present.
    if (coldResult && (coldResult.status === 'earned' || coldResult.status === 'pending_verification') && coldResult.code) {
        return {
            kind: 'specialist_coldwater', code: coldResult.code, name: coldResult.name,
            pending: coldResult.status === 'pending_verification'
        };
    }

    if (participationResult && participationResult.code) {
        return {
            kind: 'participation', code: participationResult.code, name: participationResult.name,
            totalLogs: participationResult.total_logs, activeWeeks: participationResult.active_weeks
        };
    }

    return { kind: 'none' };
}

// ── Strava linkage lookup (deterministic: imported_to_log_id) ──
async function _icStravaForLog(logId) {
    if (!logId) return null;
    try {
        const { data, error } = await supabaseClient
            .from('strava_imports')
            .select('distance_m, moving_time_seconds, elapsed_time_seconds')
            .eq('imported_to_log_id', logId)
            .maybeSingle();
        if (error || !data) return null;
        const distM = parseFloat(data.distance_m);
        if (!distM || distM <= 0) return null; // never show zero/blank
        const secs = data.moving_time_seconds || data.elapsed_time_seconds || null;
        return {
            distanceKm: distM / 1000,
            durationStr: secs ? _icFmtDuration(secs) : null
        };
    } catch (e) {
        return null;
    }
}

function _icFmtDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m} min`;
}

// ── Fonts for the card canvas ───────────────────────────────
let _icFontsLoaded = false;
async function _icLoadFonts() {
    if (_icFontsLoaded) return;
    try {
        if (!document.getElementById('icFontsLink')) {
            const link = document.createElement('link');
            link.id = 'icFontsLink';
            link.rel = 'stylesheet';
            link.href = 'https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@400;500;700&display=swap';
            document.head.appendChild(link);
        }
        await Promise.race([
            Promise.all([
                document.fonts.load('400 200px "Bebas Neue"'),
                document.fonts.load('700 48px "DM Sans"'),
                document.fonts.load('500 36px "DM Sans"')
            ]),
            new Promise(resolve => setTimeout(resolve, 1800))
        ]);
        _icFontsLoaded = true;
    } catch (e) { /* system fonts are an acceptable fallback */ }
}

function _icLoadLogo() {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = '/icons/logo-wave.png';
    });
}

// ── Card renderer (canvas) ──────────────────────────────────
// card: { spotName, temp, conditions, dateStr, strava, story }
// story.kind: 'milestone_participation' | 'milestone_cold' |
//             'specialist_coldwater' | 'participation' | 'none'
// No numeric level/order is ever drawn — only names and supporting stats.
async function _icRenderCard(card) {
    await _icLoadFonts();
    const logo = await _icLoadLogo();

    const W = 1080, H = 1350;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    const bebas = '"Bebas Neue", "Arial Narrow", sans-serif';
    const sans  = '"DM Sans", -apple-system, sans-serif';
    const story = card.story || { kind: 'none' };

    // Background
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#080f1a');
    bg.addColorStop(0.55, '#0a1628');
    bg.addColorStop(1, '#07131f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W / 2, H * 0.42, 60, W / 2, H * 0.42, 620);
    glow.addColorStop(0, 'rgba(56,189,248,0.16)');
    glow.addColorStop(1, 'rgba(56,189,248,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(56,189,248,${0.14 - i * 0.04})`;
        ctx.lineWidth = 5;
        const yBase = H - 170 + i * 46;
        ctx.moveTo(-40, yBase);
        for (let x = -40; x <= W + 40; x += 20) {
            ctx.lineTo(x, yBase + Math.sin((x / W) * Math.PI * 2.4 + i) * 26);
        }
        ctx.stroke();
    }
    ctx.restore();

    // Header brand
    let brandX = 80;
    if (logo) {
        const lh = 64, lw = logo.width * (lh / logo.height);
        ctx.drawImage(logo, 80, 76, lw, lh);
        brandX = 80 + lw + 22;
    }
    const brandGrad = ctx.createLinearGradient(brandX, 0, brandX + 420, 0);
    brandGrad.addColorStop(0, '#38bdf8');
    brandGrad.addColorStop(1, '#0284c7');
    ctx.fillStyle = brandGrad;
    ctx.font = `72px ${bebas}`;
    ctx.textBaseline = 'middle';
    ctx.fillText('SWIMLOADING', brandX, 112);
    ctx.textBaseline = 'alphabetic';

    let y;
    const isMilestone = story.kind === 'milestone_participation' || story.kind === 'milestone_cold';

    if (isMilestone) {
        // ── Milestone layout — no ring, no number, just the name ──
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(148,163,184,0.9)';
        ctx.font = `600 32px ${sans}`;
        ctx.fillText(
            story.kind === 'milestone_cold' ? 'COLD WATER IDENTITY UNLOCKED' : 'NEW MILESTONE',
            W / 2, 300);

        ctx.fillStyle = '#f1f5f9';
        _icFitText(ctx, (story.name || '').toUpperCase(), W / 2, 480, W - 140, `170px ${bebas}`, bebas);

        ctx.fillStyle = '#38bdf8';
        ctx.font = `700 42px ${sans}`;
        const milestoneSub = story.kind === 'milestone_cold'
            ? `${card.temp}°C — ${card.spotName}`
            : _icParticipationSubline(story.code, story.totalLogs, story.activeWeeks);
        ctx.fillText(milestoneSub, W / 2, 560);

        // Still ground the milestone card in the actual swim
        ctx.fillStyle = 'rgba(148,163,184,0.9)';
        ctx.font = `500 36px ${sans}`;
        ctx.fillText(`${card.spotName} · ${card.temp}°C`, W / 2, 660);
        y = 740;
    } else {
        // ── Standard layout ──
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(148,163,184,0.9)';
        ctx.font = `600 34px ${sans}`;
        ctx.fillText('SWIM LOGGED', W / 2, 300);

        const tempGrad = ctx.createLinearGradient(0, 350, 0, 650);
        tempGrad.addColorStop(0, '#7dd3fc');
        tempGrad.addColorStop(1, '#0284c7');
        ctx.fillStyle = tempGrad;
        ctx.font = `280px ${bebas}`;
        ctx.fillText(`${card.temp}°C`, W / 2, 610);

        ctx.fillStyle = '#f1f5f9';
        _icFitText(ctx, card.spotName, W / 2, 720, W - 160, `700 58px ${sans}`, sans);
        y = 790;
    }

    if (!isMilestone) {
        // Standing identity chip — quiet, never an "unlocked" fanfare.
        if (story.kind === 'specialist_coldwater') {
            ctx.fillStyle = '#38bdf8';
            ctx.font = `700 40px ${sans}`;
            ctx.fillText((story.name || '').toUpperCase(), W / 2, y);
            y += 46;
            ctx.fillStyle = story.pending ? '#f59e0b' : 'rgba(148,163,184,0.9)';
            ctx.font = `500 30px ${sans}`;
            ctx.fillText(_icColdSubline(story.code, story.pending), W / 2, y);
            y += 60;
        } else if (story.kind === 'participation') {
            ctx.fillStyle = '#38bdf8';
            ctx.font = `700 38px ${sans}`;
            ctx.fillText(_icParticipationLabel(story.code, story.name), W / 2, y);
            y += 44;
            ctx.fillStyle = 'rgba(148,163,184,0.9)';
            ctx.font = `500 30px ${sans}`;
            ctx.fillText(_icParticipationSubline(story.code, story.totalLogs, story.activeWeeks), W / 2, y);
            y += 60;
        }

        // Conditions line (only when the chip above didn't already cover it)
        const condStr = card.conditions
            ? card.conditions.charAt(0).toUpperCase() + card.conditions.slice(1) : null;
        if (condStr) {
            ctx.fillStyle = 'rgba(148,163,184,0.8)';
            ctx.font = `500 32px ${sans}`;
            ctx.fillText(`${condStr}  ·  ${card.dateStr}`, W / 2, y);
            y += 58;
        }
    }

    // Distance — ONLY from a proven Strava linkage, always labelled.
    if (card.strava && card.strava.distanceKm > 0) {
        const distStr = `${card.strava.distanceKm.toFixed(card.strava.distanceKm >= 10 ? 1 : 2)} km` +
            (card.strava.durationStr ? `  ·  ${card.strava.durationStr}` : '');
        ctx.fillStyle = '#f1f5f9';
        ctx.font = `700 42px ${sans}`;
        ctx.fillText(distStr, W / 2, y);
        y += 48;
        ctx.fillStyle = '#fc4c02';
        ctx.font = `600 28px ${sans}`;
        ctx.fillText('via Strava', W / 2, y);
        y += 60;
    }

    // Footer
    ctx.fillStyle = 'rgba(100,116,139,0.9)';
    ctx.font = `500 32px ${sans}`;
    ctx.fillText('swimloading.com', W / 2, H - 70);
    ctx.textAlign = 'left';

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('card_blob_failed');
    return { canvas, blob, dataUrl: canvas.toDataURL('image/png') };
}

function _icFitText(ctx, text, x, y, maxWidth, baseFont, family) {
    let size = parseInt(baseFont.match(/(\d+)px/)[1], 10);
    const weightMatch = baseFont.replace(/\d+px.*/, '').trim();
    const weight = /^\d/.test(weightMatch) ? '' : weightMatch;
    ctx.font = weight ? `${weight} ${size}px ${family}` : `${size}px ${family}`;
    while (ctx.measureText(text).width > maxWidth && size > 60) {
        size -= 6;
        ctx.font = weight ? `${weight} ${size}px ${family}` : `${size}px ${family}`;
    }
    ctx.fillText(text, x, y);
}

// ── Swim Card panel (the ONE post-log panel when the flag is on) ──
let _icPanelResolve = null;
let _icCurrent = null; // { blob, dataUrl, shareText, fileName }

function _icEnsurePanel() {
    if (document.getElementById('swimCardPanel')) return;
    const div = document.createElement('div');
    div.id = 'swimCardPanel';
    div.style.cssText = 'display:none; position:fixed; inset:0; z-index:10005; background:rgba(0,0,0,0.8); align-items:flex-end; justify-content:center;';
    div.innerHTML = `
      <div style="background:var(--surface, #0d1728); border-radius:20px 20px 0 0; padding:22px 20px 34px; width:100%; max-width:480px; max-height:92vh; overflow-y:auto;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
          <div style="font-size:11px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.8px; font-weight:700;" id="swimCardPanelTitle">Swim logged</div>
          <button onclick="dismissSwimCardPanel()" style="background:rgba(255,255,255,0.08); border:1px solid var(--border); border-radius:50%; width:30px; height:30px; color:var(--text-secondary); font-size:17px; line-height:1; cursor:pointer;">&times;</button>
        </div>
        <div id="swimCardMilestoneNote" style="display:none; font-size:15px; font-weight:700; color:#38bdf8; margin-bottom:10px;"></div>
        <div style="border-radius:14px; overflow:hidden; border:1px solid rgba(56,189,248,0.25); margin-bottom:16px;">
          <img id="swimCardImage" alt="Swim card" style="display:block; width:100%; height:auto;">
        </div>
        <div style="display:flex; gap:10px; margin-bottom:10px;">
          <button id="swimCardNativeShareBtn" onclick="swimCardNativeShare()" style="flex:1; padding:13px; background:linear-gradient(135deg,#0284c7,#0ea5e9); border:none; border-radius:50px; color:white; font-size:14px; font-weight:700; cursor:pointer;">Share</button>
          <button onclick="swimCardWhatsApp()" style="flex:1; padding:13px; background:#25d366; border:none; border-radius:50px; color:white; font-size:14px; font-weight:700; cursor:pointer;">WhatsApp</button>
        </div>
        <div style="display:flex; gap:10px; margin-bottom:10px;">
          <button onclick="swimCardSaveImage()" style="flex:1; padding:12px; background:rgba(255,255,255,0.06); border:1px solid var(--border); border-radius:50px; color:var(--text-primary); font-size:13px; font-weight:600; cursor:pointer;">Save image</button>
          <button onclick="swimCardCopyText()" style="flex:1; padding:12px; background:rgba(255,255,255,0.06); border:1px solid var(--border); border-radius:50px; color:var(--text-primary); font-size:13px; font-weight:600; cursor:pointer;">Copy text</button>
        </div>
        <div style="display:flex; gap:10px;">
          <button onclick="swimCardViewIdentity()" style="flex:1; padding:12px; background:transparent; border:1px solid rgba(56,189,248,0.4); border-radius:50px; color:#38bdf8; font-size:13px; font-weight:700; cursor:pointer;">View identity</button>
          <button onclick="dismissSwimCardPanel()" style="flex:1; padding:12px; background:transparent; border:1px solid var(--border); border-radius:50px; color:var(--text-secondary); font-size:13px; font-weight:600; cursor:pointer;">Done</button>
        </div>
      </div>`;
    document.body.appendChild(div);
}

async function showSwimCardPanel(ctx) {
    _icEnsurePanel();

    // Evaluate both tracks in parallel — participation is universal and
    // always runs; cold specialist runs too but the RPC itself decides
    // "above_threshold" for warm/pool swims, so nothing cold ever renders
    // for a Durban or pool log. Independent RPC failures degrade
    // gracefully (null) rather than blocking the card.
    const [participationResult, coldResult, strava] = await Promise.all([
        _icEvaluateParticipation(ctx.logId),
        _icEvaluateColdSpecialist(ctx.logId),
        _icStravaForLog(ctx.logId)
    ]);

    const story = _icSelectCardStory(participationResult, coldResult);

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    const card = {
        spotName: ctx.spotName || 'Swim spot',
        temp: ctx.temp,
        conditions: ctx.conditions || null,
        dateStr,
        strava,
        story
    };

    const rendered = await _icRenderCard(card);

    let shareText = `${card.spotName}: ${card.temp}°C` +
        (card.conditions ? ` • ${card.conditions.charAt(0).toUpperCase() + card.conditions.slice(1)}` : '');
    if (strava) shareText += `\n${strava.distanceKm.toFixed(strava.distanceKm >= 10 ? 1 : 2)} km via Strava`;
    if (story.kind === 'milestone_cold') {
        shareText += `\nCold Water Identity unlocked: ${story.name}`;
    } else if (story.kind === 'milestone_participation') {
        shareText += `\n${_icParticipationLabel(story.code, story.name)}`;
    } else if (story.kind === 'specialist_coldwater') {
        shareText += `\n${(story.name || '').toUpperCase()}${story.pending ? ' (verification pending)' : ''}`;
    } else if (story.kind === 'participation') {
        shareText += `\n${_icParticipationLabel(story.code, story.name)}`;
    }
    shareText += `\nLogged on SwimLoading — swimloading.com`;

    _icCurrent = {
        blob: rendered.blob,
        dataUrl: rendered.dataUrl,
        shareText,
        fileName: `swimloading-${(card.spotName || 'swim').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`
    };

    document.getElementById('swimCardImage').src = rendered.dataUrl;
    const isMilestone = story.kind === 'milestone_participation' || story.kind === 'milestone_cold';
    document.getElementById('swimCardPanelTitle').textContent =
        isMilestone ? 'New milestone' : 'Swim logged';
    const note = document.getElementById('swimCardMilestoneNote');
    if (isMilestone) {
        note.style.display = 'block';
        note.textContent = story.kind === 'milestone_cold'
            ? `${story.name} — Cold Water Identity`
            : _icParticipationLabel(story.code, story.name);
    } else {
        note.style.display = 'none';
    }
    const nativeBtn = document.getElementById('swimCardNativeShareBtn');
    nativeBtn.style.display = navigator.share ? '' : 'none';

    analytics.track('swim_card_shown', {
        source: ctx.source,
        story_kind: story.kind,
        milestone: isMilestone,
        cold_pending: story.kind === 'specialist_coldwater' && story.pending,
        has_strava_distance: !!strava
    });

    return new Promise(resolve => {
        _icPanelResolve = resolve;
        document.getElementById('swimCardPanel').style.display = 'flex';
    });
}

function dismissSwimCardPanel() {
    const p = document.getElementById('swimCardPanel');
    if (p) p.style.display = 'none';
    if (_icPanelResolve) { _icPanelResolve(); _icPanelResolve = null; }
}

async function swimCardNativeShare() {
    if (!_icCurrent) return;
    try {
        const file = new File([_icCurrent.blob], _icCurrent.fileName, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], text: _icCurrent.shareText });
        } else if (navigator.share) {
            await navigator.share({ text: _icCurrent.shareText });
        }
        analytics.track('swim_card_shared', { method: 'native' });
    } catch (e) { /* user cancelled — fine */ }
}

function swimCardWhatsApp() {
    if (!_icCurrent) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(_icCurrent.shareText)}`, '_blank');
    analytics.track('swim_card_shared', { method: 'whatsapp' });
}

function swimCardSaveImage() {
    if (!_icCurrent) return;
    const a = document.createElement('a');
    a.href = _icCurrent.dataUrl;
    a.download = _icCurrent.fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    analytics.track('swim_card_shared', { method: 'save_image' });
}

async function swimCardCopyText() {
    if (!_icCurrent) return;
    try {
        await navigator.clipboard.writeText(_icCurrent.shareText);
        showToast('Copied to clipboard', 'success');
        analytics.track('swim_card_shared', { method: 'copy_text' });
    } catch (e) {
        showToast('Could not copy', 'error');
    }
}

function swimCardViewIdentity() {
    dismissSwimCardPanel();
    showIdentityView();
}

// ── Private identity view ───────────────────────────────────
function _icAdultStatus() {
    // 'adult' | 'minor' | 'unknown' — unknown/invalid DOB is treated as restricted
    const dob = currentUserProfile && currentUserProfile.date_of_birth;
    if (!dob) return 'unknown';
    const d = new Date(dob + 'T00:00:00');
    if (isNaN(d.getTime())) return 'unknown';
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 18);
    return d <= cutoff ? 'adult' : 'minor';
}

function _icEnsureIdentityView() {
    if (document.getElementById('identityViewModal')) return;
    const div = document.createElement('div');
    div.id = 'identityViewModal';
    div.style.cssText = 'display:none; position:fixed; inset:0; z-index:10006; background:rgba(0,0,0,0.85); overflow-y:auto; padding:20px;';
    div.innerHTML = `
      <div style="max-width:480px; margin:28px auto; background:#0d1728; border:1px solid rgba(56,189,248,0.2); border-radius:20px; padding:26px 22px;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px;">
          <div>
            <div style="font-size:10px; font-weight:700; color:#38bdf8; text-transform:uppercase; letter-spacing:0.12em; margin-bottom:4px;">Swimmer identity</div>
            <div id="identityViewName" style="font-size:20px; font-weight:800; color:#f1f5f9;"></div>
          </div>
          <button onclick="dismissIdentityView()" style="background:none; border:none; color:#64748b; font-size:22px; cursor:pointer; line-height:1;">&times;</button>
        </div>
        <!-- Story Timeline tab bar (Phase 2.2) — hidden entirely unless
             story_timeline_v1 is enabled for the current user; see
             showIdentityView() and app-story-timeline.js. Records (drafted
             during Release 2.4 discovery) is explicitly OUT of this
             release per Dave's scope correction — preserved separately in
             app-records.js / sql/2026-07-20_records-v1.sql, not wired in
             here, not committed with Overview V2. -->
        <div id="identityTabBar" role="tablist" aria-label="Profile sections" style="display:none; gap:18px; margin-bottom:16px; border-bottom:1px solid var(--border);">
          <button type="button" role="tab" id="identityTabOverview" aria-selected="true" aria-controls="identityPanelOverview"
            onclick="switchIdentityTab('overview')"
            style="background:none; border:none; border-bottom:2px solid #38bdf8; color:#38bdf8; font-size:13px; font-weight:700; padding:0 0 10px; cursor:pointer;">Overview</button>
          <button type="button" role="tab" id="identityTabStory" aria-selected="false" aria-controls="identityPanelStory"
            onclick="switchIdentityTab('story')"
            style="background:none; border:none; border-bottom:2px solid transparent; color:var(--text-secondary); font-size:13px; font-weight:700; padding:0 0 10px; cursor:pointer;">Story</button>
        </div>
        <div id="identityPanelOverview" role="tabpanel" aria-labelledby="identityTabOverview">
          <div id="identityViewBody">
            <div style="color:var(--text-secondary); font-size:13px; text-align:center; padding:24px;">Loading…</div>
          </div>
        </div>
        <div id="identityPanelStory" role="tabpanel" aria-labelledby="identityTabStory" hidden></div>
      </div>`;
    document.body.appendChild(div);
}

// Pure rendering helper (also used by the multi-track test harness) — takes
// the raw DB rows/counters and returns the HTML for the body. No I/O here.
function _icBuildIdentityViewHtml({ participationCode, participationName, totalLogs, activeWeeks, coldEntries, coldest, adultStatus, identityPublic, currentUserId }) {
    const partLabel = participationCode ? _icParticipationLabel(participationCode, participationName) : 'SWIMMER';
    const partSub = participationCode ? _icParticipationSubline(participationCode, totalLogs, activeWeeks) : `${totalLogs || 0} swims logged`;

    // Cold Water Identity section: hidden entirely when there is nothing to
    // show (no earned, no pending) — never an incomplete/empty ladder.
    let coldSection = '';
    if (coldEntries && coldEntries.length) {
        const rows = coldEntries.map(e => `
          <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border:1px solid ${e.status === 'earned' ? 'rgba(16,185,129,0.35)' : 'rgba(245,158,11,0.35)'}; border-radius:12px; margin-bottom:8px;">
            <div style="font-size:14px; font-weight:700; color:#f1f5f9;">${(e.name || '').toUpperCase()}</div>
            ${e.status === 'earned'
                ? '<span style="color:#10b981; font-weight:700; font-size:12px;">VERIFIED</span>'
                : '<span style="color:#f59e0b; font-weight:700; font-size:12px;">PENDING VERIFICATION</span>'}
          </div>`).join('');
        coldSection = `
          <div style="font-size:11px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.8px; margin:20px 0 10px;">Cold Water Identity</div>
          ${rows}`;
    }

    const publicSection = adultStatus === 'minor' ? '' : (adultStatus === 'unknown' ? `
        <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:14px; padding:16px; margin-top:20px;">
          <div style="font-size:13px; font-weight:700; color:#f1f5f9; margin-bottom:6px;">Public profile</div>
          <div style="font-size:12px; color:var(--text-secondary); line-height:1.5;">
            Add your date of birth in your profile to enable a shareable public profile. Profiles stay private until you explicitly turn this on.
          </div>
        </div>` : `
        <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:14px; padding:16px; margin-top:20px;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
            <div style="font-size:13px; font-weight:700; color:#f1f5f9;">Public profile</div>
            <button id="identityPublicToggle" onclick="toggleIdentityPublic()" style="padding:8px 18px; border-radius:50px; border:1px solid ${identityPublic ? 'rgba(16,185,129,0.5)' : 'var(--border)'}; background:${identityPublic ? 'rgba(16,185,129,0.15)' : 'transparent'}; color:${identityPublic ? '#10b981' : 'var(--text-secondary)'}; font-size:12px; font-weight:700; cursor:pointer;">${identityPublic ? 'ON' : 'OFF'}</button>
          </div>
          <div style="font-size:12px; color:var(--text-secondary); line-height:1.5;">
            ${identityPublic
                ? `Your identity is shareable at<br><a href="/swimmer/${encodeURIComponent(currentUserId)}" target="_blank" rel="noopener" style="color:#38bdf8; word-break:break-all;">swimloading.com/swimmer/${currentUserId}</a>`
                : 'Off by default. Turn on to get a shareable link showing your name and earned identities. You can turn it off any time.'}
          </div>
        </div>`);

    return `
      <div style="text-align:center; margin-bottom:18px;">
        <div style="font-size:26px; font-weight:800; color:#38bdf8; margin-bottom:4px;">${partLabel}</div>
        <div style="font-size:13px; color:var(--text-secondary);">${partSub}</div>
      </div>
      <div style="display:flex; gap:10px; margin-bottom:6px;">
        <div style="flex:1; background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:14px; padding:14px; text-align:center;">
          <div style="font-size:26px; font-weight:800; color:#f1f5f9;">${totalLogs ?? '—'}</div>
          <div style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Swims logged</div>
        </div>
        <div style="flex:1; background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:14px; padding:14px; text-align:center;">
          <div style="font-size:26px; font-weight:800; color:#f1f5f9;">${coldest !== null && coldest !== undefined ? coldest + '°' : '—'}</div>
          <div style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Coldest</div>
        </div>
      </div>
      ${coldSection}
      ${publicSection}`;
}

async function showIdentityView() {
    if (!(await identityLayerEnabled())) return;
    _icEnsureIdentityView();
    const modal = document.getElementById('identityViewModal');
    modal.style.display = 'block';
    document.getElementById('identityViewName').textContent =
        (currentUserProfile && currentUserProfile.display_name) || 'Swimmer';
    analytics.track('identity_view_opened');

    // Story Timeline tab (Phase 2.2) — flag-gated, independent of
    // story_engine_v1 and of Overview V2. Always reset to the Overview
    // tab on open so a previous session's Story tab selection never
    // persists oddly.
    const tabBar = document.getElementById('identityTabBar');
    if (tabBar) {
        const showTabs = typeof storyTimelineEnabled === 'function' && await storyTimelineEnabled();
        tabBar.style.display = showTabs ? 'flex' : 'none';
        if (typeof switchIdentityTab === 'function') switchIdentityTab('overview');
    }

    // Release 2.4 — Overview V2 is a full replacement of the panel's
    // content, independently flag-gated (overview_v2), allow-listed to
    // exactly three people (Dave, Carina, Johan). For every other user
    // this whole block behaves EXACTLY as before Release 2.4 —
    // overviewV2Enabled() resolves false, get_my_swimming_overview_v1 is
    // never called, and _icRenderLegacyOverview runs unchanged.
    const body = document.getElementById('identityViewBody');
    try {
        const achRes = await supabaseClient.from('swimmer_achievements')
            .select('track_type, achievement_code, achievement_name, verification_status')
            .eq('user_id', currentUser.id);

        const rows = achRes.data || [];
        const participationRows = rows.filter(r => r.track_type === 'participation' && r.verification_status === 'earned');
        // achievement_code order encodes progression — pick the swimmer's
        // highest-reached participation milestone from the rows returned.
        const partOrderIndex = code => IC_PARTICIPATION_CODES.indexOf(code);
        const topParticipation = participationRows.sort((a, b) =>
            partOrderIndex(b.achievement_code) - partOrderIndex(a.achievement_code))[0];

        const showOverviewV2 = typeof overviewV2Enabled === 'function' && await overviewV2Enabled();

        if (showOverviewV2 && typeof renderOverviewV2 === 'function') {
            try {
                const participationLabel = topParticipation
                    ? _icParticipationLabel(topParticipation.achievement_code, topParticipation.achievement_name)
                    : 'Swimmer';
                await renderOverviewV2(body, { participationLabel });
                return;
            } catch (ovErr) {
                // Fail-open per Dave's instruction: an allow-listed user
                // whose Overview V2 load fails must still get a working
                // modal, not an error card — fall through to the exact
                // same legacy render every non-allow-listed user gets.
                console.error('[identity] overview v2 failed, falling back to legacy overview', ovErr);
                try { analytics.track('overview_v2_load_failed', { failure_stage: 'fallback_to_legacy' }); } catch (_) {}
            }
        }

        await _icRenderLegacyOverview(body, { rows, topParticipation });
    } catch (e) {
        console.error('[identity] view failed', e);
        body.innerHTML = '<div style="color:var(--text-secondary); font-size:13px; text-align:center; padding:24px;">Could not load your identity right now.</div>';
    }
}

// Exactly the pre-Release-2.4 Overview render — extracted unchanged so it
// can serve both as the default path for non-allow-listed users AND as
// the fail-open fallback for an allow-listed user whose Overview V2 load
// failed.
async function _icRenderLegacyOverview(body, { rows, topParticipation }) {
        const coldRows = rows.filter(r => r.track_type === 'cold_water' &&
            (r.verification_status === 'earned' || r.verification_status === 'pending_verification'));
        const coldEntries = coldRows
            .sort((a, b) => IC_COLD_CODES.indexOf(a.achievement_code) - IC_COLD_CODES.indexOf(b.achievement_code))
            .map(r => ({ code: r.achievement_code, name: r.achievement_name, status: r.verification_status }));

        const [statsRes, countRes] = await Promise.all([
            supabaseClient.from('temp_logs')
                .select('temp_c')
                .eq('user_id', currentUser.id)
                .order('temp_c', { ascending: true })
                .limit(1),
            supabaseClient.from('temp_logs')
                .select('id, created_at', { count: 'exact', head: true })
                .eq('user_id', currentUser.id)
        ]);

        const coldest = (statsRes.data && statsRes.data[0]) ? parseFloat(statsRes.data[0].temp_c) : null;
        const totalLogs = countRes.count ?? 0;

        // active_weeks isn't needed for display once a milestone is already
        // "regular" or higher (subline switches to log count) — only the
        // REGULAR tier needs it, computed the same way the server does.
        let activeWeeks = 0;
        if (topParticipation && topParticipation.achievement_code === 'regular') {
            const { data: allLogs } = await supabaseClient
                .from('temp_logs').select('logged_at, created_at').eq('user_id', currentUser.id);
            const weeks = new Set((allLogs || []).map(l => {
                const d = new Date(l.logged_at || l.created_at);
                const weekStart = new Date(d);
                weekStart.setDate(d.getDate() - d.getDay());
                return weekStart.toISOString().slice(0, 10);
            }));
            activeWeeks = weeks.size;
        }

        body.innerHTML = _icBuildIdentityViewHtml({
            participationCode: topParticipation ? topParticipation.achievement_code : null,
            participationName: topParticipation ? topParticipation.achievement_name : null,
            totalLogs, activeWeeks, coldEntries, coldest,
            adultStatus: _icAdultStatus(),
            identityPublic: !!(currentUserProfile && currentUserProfile.identity_public),
            currentUserId: currentUser.id
        });
}

function dismissIdentityView() {
    const m = document.getElementById('identityViewModal');
    if (m) m.style.display = 'none';
    // A Story Card deep link (Phase 2.3) may have set a pending timeline
    // highlight — closing the modal must not leave it pending for some
    // later, unrelated Story tab visit.
    if (typeof _scClearPendingHighlight === 'function') _scClearPendingHighlight();
}

async function toggleIdentityPublic() {
    if (_icAdultStatus() !== 'adult') return; // server trigger enforces this too
    const target = !(currentUserProfile && currentUserProfile.identity_public);
    const btn = document.getElementById('identityPublicToggle');
    if (btn) btn.disabled = true;
    try {
        const { error } = await supabaseClient
            .from('profiles')
            .update({ identity_public: target })
            .eq('id', currentUser.id);
        if (error) throw error;
        // Re-read: the DB trigger may have overridden the value
        const { data } = await supabaseClient
            .from('profiles')
            .select('identity_public, identity_public_enabled_at')
            .eq('id', currentUser.id)
            .single();
        if (data) {
            currentUserProfile.identity_public = data.identity_public;
            currentUserProfile.identity_public_enabled_at = data.identity_public_enabled_at;
        }
        analytics.track(data && data.identity_public
            ? 'identity_public_enabled' : 'identity_public_disabled');
        showToast(
            (data && data.identity_public)
                ? 'Public profile enabled'
                : 'Public profile is off',
            'success');
    } catch (e) {
        console.error('[identity] toggle failed', e);
        showToast('Could not update your profile setting', 'error');
    }
    showIdentityView();
}

// ── Entry point in Profile Settings (flag-gated, self-initialising) ──
(function _icInitEntryPoint() {
    let tries = 0;
    const timer = setInterval(async () => {
        tries++;
        if (typeof currentUser !== 'undefined' && currentUser) {
            clearInterval(timer);
            try {
                if (!(await identityLayerEnabled())) return;
                const el = document.getElementById('identityEntryPoint');
                if (!el) return;
                el.style.display = 'block';
                el.innerHTML = `
                  <button onclick="showIdentityView()" style="width:100%; margin-bottom:14px; padding:13px; background:rgba(56,189,248,0.08); border:1px solid rgba(56,189,248,0.35); border-radius:50px; color:#38bdf8; font-size:14px; font-weight:700; cursor:pointer;">
                    Swimmer identity
                  </button>`;
            } catch (e) { /* entry point is optional */ }
        } else if (tries > 120) {
            clearInterval(timer);
        }
    }, 1000);
})();
