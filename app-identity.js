// ============================================================
// IDENTITY LAYER V1 — Swim Cards + Cold Water Identity
// Feature-flagged: identity_layer_v1 (feature_flags table, Dave-only at launch)
// Depends on: app.js globals (supabaseClient, currentUser, currentUserProfile,
//             analytics, showToast, icon, initIcons, showShareSheet)
//
// Rules (binding product decisions, 2026-07-19):
// - Flag ON  → ONE Swim Card panel replaces the old share sheet. Never two modals.
// - Flag OFF → old showShareSheet() flow untouched (rollback path).
// - Card generation failure → fall back to the ORIGINAL share flow; the swim
//   save is already committed and is never affected.
// - Distance/duration shown ONLY when deterministically linked via
//   strava_imports.imported_to_log_id, labelled "via Strava". Never from
//   temp_logs.distance_km, never zero/blank/inferred.
// - Cold levels are awarded ONLY by the server (evaluate_cold_achievement RPC).
//   This file displays results; it never writes swimmer_achievements.
// ============================================================

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
async function _icEvaluateColdLevel(logId) {
    if (!logId) return null;
    try {
        const { data, error } = await supabaseClient
            .rpc('evaluate_cold_achievement', { p_log_id: logId });
        if (error || !data || data.error) return null;
        if (data.status === 'pending_verification' && data.newly_created) {
            // Fires once: server reports newly_created only on first insert
            analytics.track('cold_level_pending_verification', {
                level: data.level, level_key: data.level_key, temp: data.temp_c
            });
        }
        if (data.status === 'earned') {
            analytics.track('cold_level_earned', {
                level: data.level, level_key: data.level_key, temp: data.temp_c
            });
        }
        return data;
    } catch (e) {
        console.error('[identity] evaluate_cold_achievement failed', e);
        return null;
    }
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
// card: { spotName, temp, conditions, dateStr, strava, pending, milestone }
async function _icRenderCard(card) {
    await _icLoadFonts();
    const logo = await _icLoadLogo();

    const W = 1080, H = 1350;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');

    const bebas = '"Bebas Neue", "Arial Narrow", sans-serif';
    const sans  = '"DM Sans", -apple-system, sans-serif';

    // Background
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#080f1a');
    bg.addColorStop(0.55, '#0a1628');
    bg.addColorStop(1, '#07131f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Soft cyan glow behind the centrepiece
    const glow = ctx.createRadialGradient(W / 2, H * 0.42, 60, W / 2, H * 0.42, 620);
    glow.addColorStop(0, 'rgba(56,189,248,0.16)');
    glow.addColorStop(1, 'rgba(56,189,248,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Wave arcs (bottom)
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
    if (card.milestone) {
        // ── Milestone layout ──
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(148,163,184,0.9)';
        ctx.font = `600 34px ${sans}`;
        ctx.fillText('COLD WATER IDENTITY UNLOCKED', W / 2, 320);

        // Level ring
        ctx.beginPath();
        ctx.arc(W / 2, 560, 180, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(56,189,248,0.5)';
        ctx.lineWidth = 8;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(W / 2, 560, 156, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(56,189,248,0.18)';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.fillStyle = '#38bdf8';
        ctx.font = `150px ${bebas}`;
        ctx.fillText(String(card.milestone.level), W / 2, 610);
        ctx.fillStyle = 'rgba(148,163,184,0.85)';
        ctx.font = `600 30px ${sans}`;
        ctx.fillText('LEVEL', W / 2, 660);

        ctx.fillStyle = '#f1f5f9';
        ctx.font = `130px ${bebas}`;
        ctx.fillText(card.milestone.levelName.toUpperCase(), W / 2, 880);

        ctx.fillStyle = '#38bdf8';
        ctx.font = `700 46px ${sans}`;
        ctx.fillText(`${card.temp}°C — ${card.spotName}`, W / 2, 960);
        y = 1020;
    } else {
        // ── Standard layout ──
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(148,163,184,0.9)';
        ctx.font = `600 34px ${sans}`;
        ctx.fillText('SWIM LOGGED', W / 2, 330);

        const tempGrad = ctx.createLinearGradient(0, 380, 0, 680);
        tempGrad.addColorStop(0, '#7dd3fc');
        tempGrad.addColorStop(1, '#0284c7');
        ctx.fillStyle = tempGrad;
        ctx.font = `300px ${bebas}`;
        ctx.fillText(`${card.temp}°C`, W / 2, 650);

        ctx.fillStyle = '#f1f5f9';
        ctx.font = `700 60px ${sans}`;
        _icFitText(ctx, card.spotName, W / 2, 770, W - 160, `700 60px ${sans}`, sans);
        y = 850;
    }

    // Conditions + date line
    ctx.fillStyle = 'rgba(148,163,184,0.95)';
    ctx.font = `500 40px ${sans}`;
    const condStr = card.conditions
        ? card.conditions.charAt(0).toUpperCase() + card.conditions.slice(1) : null;
    const metaLine = [condStr, card.dateStr].filter(Boolean).join('  ·  ');
    if (metaLine) { ctx.fillText(metaLine, W / 2, y); y += 74; }

    // Distance — ONLY from a proven Strava linkage, always labelled.
    if (card.strava && card.strava.distanceKm > 0) {
        const distStr = `${card.strava.distanceKm.toFixed(card.strava.distanceKm >= 10 ? 1 : 2)} km` +
            (card.strava.durationStr ? `  ·  ${card.strava.durationStr}` : '');
        ctx.fillStyle = '#f1f5f9';
        ctx.font = `700 44px ${sans}`;
        ctx.fillText(distStr, W / 2, y);
        y += 52;
        ctx.fillStyle = '#fc4c02';
        ctx.font = `600 30px ${sans}`;
        ctx.fillText('via Strava', W / 2, y);
        y += 66;
    }

    // Pending-verification wording (self-reported temp)
    if (card.pending) {
        ctx.fillStyle = '#f59e0b';
        ctx.font = `500 30px ${sans}`;
        ctx.fillText('Temperature self-reported — verification pending', W / 2, y);
        y += 50;
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
    const weight = baseFont.split(' ')[0];
    ctx.font = `${weight} ${size}px ${family}`;
    while (ctx.measureText(text).width > maxWidth && size > 28) {
        size -= 4;
        ctx.font = `${weight} ${size}px ${family}`;
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

    // 1. Trusted server evaluation (never blocks the card on failure)
    const evalRes = await _icEvaluateColdLevel(ctx.logId);

    // 2. Distance only via proven Strava linkage
    const strava = await _icStravaForLog(ctx.logId);

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    const isMilestone = !!(evalRes && evalRes.status === 'earned');
    const isPending = !!(evalRes && evalRes.status === 'pending_verification');

    const card = {
        spotName: ctx.spotName || 'Swim spot',
        temp: ctx.temp,
        conditions: ctx.conditions || null,
        dateStr,
        strava,
        pending: isPending,
        milestone: isMilestone
            ? { level: evalRes.level, levelName: evalRes.level_name }
            : null
    };

    const rendered = await _icRenderCard(card);

    let shareText = `${card.spotName}: ${card.temp}°C` +
        (card.conditions ? ` • ${card.conditions.charAt(0).toUpperCase() + card.conditions.slice(1)}` : '');
    if (strava) shareText += `\n${strava.distanceKm.toFixed(strava.distanceKm >= 10 ? 1 : 2)} km via Strava`;
    if (isMilestone) shareText += `\nCold Water Identity unlocked: ${evalRes.level_name} (Level ${evalRes.level})`;
    shareText += `\nLogged on SwimLoading — swimloading.com`;

    _icCurrent = {
        blob: rendered.blob,
        dataUrl: rendered.dataUrl,
        shareText,
        fileName: `swimloading-${(card.spotName || 'swim').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`
    };

    document.getElementById('swimCardImage').src = rendered.dataUrl;
    document.getElementById('swimCardPanelTitle').textContent =
        isMilestone ? 'New level unlocked' : 'Swim logged';
    const note = document.getElementById('swimCardMilestoneNote');
    if (isMilestone) {
        note.style.display = 'block';
        note.textContent = `${evalRes.level_name} — Cold Water Level ${evalRes.level}`;
    } else {
        note.style.display = 'none';
    }
    const nativeBtn = document.getElementById('swimCardNativeShareBtn');
    nativeBtn.style.display = navigator.share ? '' : 'none';

    analytics.track('swim_card_shown', {
        source: ctx.source,
        milestone: isMilestone,
        pending: isPending,
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
const IC_LEVELS = [
    { level: 1, key: 'cold_water', name: 'Cold Water', maxC: 16 },
    { level: 2, key: 'deep_cold',  name: 'Deep Cold',  maxC: 13 },
    { level: 3, key: 'winter',     name: 'Winter',     maxC: 10 },
    { level: 4, key: 'polar',      name: 'Polar',      maxC: 7 },
    { level: 5, key: 'ice',        name: 'Ice',        maxC: 5 }
];

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
        <div id="identityViewBody">
          <div style="color:var(--text-secondary); font-size:13px; text-align:center; padding:24px;">Loading…</div>
        </div>
      </div>`;
    document.body.appendChild(div);
}

async function showIdentityView() {
    if (!(await identityLayerEnabled())) return;
    _icEnsureIdentityView();
    const modal = document.getElementById('identityViewModal');
    modal.style.display = 'block';
    document.getElementById('identityViewName').textContent =
        (currentUserProfile && currentUserProfile.display_name) || 'Swimmer';
    analytics.track('identity_view_opened');

    const body = document.getElementById('identityViewBody');
    try {
        const [achRes, statsRes] = await Promise.all([
            supabaseClient.from('swimmer_achievements')
                .select('level, level_key, level_name, status, temp_c, created_at')
                .eq('user_id', currentUser.id)
                .eq('achievement_type', 'cold_level'),
            supabaseClient.from('temp_logs')
                .select('temp_c')
                .eq('user_id', currentUser.id)
                .order('temp_c', { ascending: true })
                .limit(1)
        ]);
        const achievements = achRes.data || [];
        const earned = achievements.filter(a => a.status === 'earned');
        const pending = achievements.filter(a => a.status === 'pending_verification');
        const topLevel = earned.reduce((m, a) => Math.max(m, a.level), 0);
        const coldest = (statsRes.data && statsRes.data[0]) ? parseFloat(statsRes.data[0].temp_c) : null;

        const { count: swimCount } = await supabaseClient
            .from('temp_logs')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', currentUser.id);

        const levelRows = IC_LEVELS.map(l => {
            const isEarned = earned.some(a => a.level === l.level);
            const isPending = pending.some(a => a.level === l.level);
            const state = isEarned
                ? '<span style="color:#10b981; font-weight:700; font-size:12px;">EARNED</span>'
                : isPending
                    ? '<span style="color:#f59e0b; font-weight:700; font-size:12px;">PENDING VERIFICATION</span>'
                    : '<span style="color:#64748b; font-size:12px;">Not earned</span>';
            const border = isEarned ? 'rgba(16,185,129,0.35)' : isPending ? 'rgba(245,158,11,0.35)' : 'var(--border)';
            return `
              <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 14px; border:1px solid ${border}; border-radius:12px; margin-bottom:8px;">
                <div>
                  <div style="font-size:14px; font-weight:700; color:${isEarned ? '#f1f5f9' : 'var(--text-secondary)'};">Level ${l.level} — ${l.name}</div>
                  <div style="font-size:11px; color:#64748b;">Swim at ${l.maxC}°C or below</div>
                </div>
                ${state}
              </div>`;
        }).join('');

        const pendingNote = pending.length ? `
          <div style="background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.3); border-radius:12px; padding:12px 14px; margin-bottom:16px; font-size:12px; color:#f59e0b; line-height:1.5;">
            Pending levels use a self-reported temperature without corroboration yet. They are reviewed before a level is awarded — your card still shows the swim.
          </div>` : '';

        body.innerHTML = `
          <div style="display:flex; gap:10px; margin-bottom:18px;">
            <div style="flex:1; background:rgba(56,189,248,0.07); border:1px solid rgba(56,189,248,0.2); border-radius:14px; padding:14px; text-align:center;">
              <div style="font-size:26px; font-weight:800; color:#38bdf8;">${topLevel > 0 ? 'L' + topLevel : '—'}</div>
              <div style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Cold level</div>
            </div>
            <div style="flex:1; background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:14px; padding:14px; text-align:center;">
              <div style="font-size:26px; font-weight:800; color:#f1f5f9;">${swimCount ?? '—'}</div>
              <div style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Swims logged</div>
            </div>
            <div style="flex:1; background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:14px; padding:14px; text-align:center;">
              <div style="font-size:26px; font-weight:800; color:#f1f5f9;">${coldest !== null ? coldest + '°' : '—'}</div>
              <div style="font-size:10px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Coldest</div>
            </div>
          </div>
          ${pendingNote}
          <div style="font-size:11px; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.8px; margin-bottom:10px;">Cold water levels</div>
          ${levelRows}
          <div id="identityPublicSection" style="margin-top:20px;"></div>`;

        _icRenderPublicSection();
    } catch (e) {
        console.error('[identity] view failed', e);
        body.innerHTML = '<div style="color:var(--text-secondary); font-size:13px; text-align:center; padding:24px;">Could not load your identity right now.</div>';
    }
}

function dismissIdentityView() {
    const m = document.getElementById('identityViewModal');
    if (m) m.style.display = 'none';
}

// Public-profile opt-in — adults only; minors see nothing; unknown DOB is
// treated as restricted. The DB trigger enforces the same rule server-side.
function _icRenderPublicSection() {
    const el = document.getElementById('identityPublicSection');
    if (!el) return;
    const status = _icAdultStatus();

    if (status === 'minor') { el.innerHTML = ''; return; }

    if (status === 'unknown') {
        el.innerHTML = `
          <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:14px; padding:16px;">
            <div style="font-size:13px; font-weight:700; color:#f1f5f9; margin-bottom:6px;">Public profile</div>
            <div style="font-size:12px; color:var(--text-secondary); line-height:1.5;">
              Add your date of birth in your profile to enable a shareable public profile. Profiles stay private until you explicitly turn this on.
            </div>
          </div>`;
        return;
    }

    const isPublic = !!(currentUserProfile && currentUserProfile.identity_public);
    el.innerHTML = `
      <div style="background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:14px; padding:16px;">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
          <div style="font-size:13px; font-weight:700; color:#f1f5f9;">Public profile</div>
          <button id="identityPublicToggle" onclick="toggleIdentityPublic()" style="padding:8px 18px; border-radius:50px; border:1px solid ${isPublic ? 'rgba(16,185,129,0.5)' : 'var(--border)'}; background:${isPublic ? 'rgba(16,185,129,0.15)' : 'transparent'}; color:${isPublic ? '#10b981' : 'var(--text-secondary)'}; font-size:12px; font-weight:700; cursor:pointer;">${isPublic ? 'ON' : 'OFF'}</button>
        </div>
        <div style="font-size:12px; color:var(--text-secondary); line-height:1.5;">
          ${isPublic
            ? `Your identity is shareable at<br><span style="color:#38bdf8;">swimloading.com/swimmer/${currentUser.id}</span>`
            : 'Off by default. Turn on to get a shareable link showing your name and earned cold-water levels. You can turn it off any time.'}
        </div>
      </div>`;
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
        analytics.track(target && data && data.identity_public
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
    _icRenderPublicSection();
}
