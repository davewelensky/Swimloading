// SwimLoading — Instagram story card (PROTOTYPE, flag: instagram_story_v1, Dave-only at launch).
//
// After a log, the swimmer can add a photo (camera or library) and share a 1080x1920 story image with
// the temperature, spot and date over it. There is no Instagram web API for posting or for adding a
// real tag sticker, so: the image carries "@swimloading" as text, the caption is copied to the
// clipboard, and the native share sheet (navigator.share with a file) hands the image to Instagram.
// Desktop / browsers without file sharing fall back to a download.
//
// Privacy: the photo is redrawn on a canvas, which drops EXIF (including any GPS). Only the spot NAME
// is drawn, never coordinates, and the swimmer can switch the spot name off.
//
// Depends on app.js globals (supabaseClient, currentUser, analytics). Fails closed: no flag row, or any
// error, means nothing is shown. Hooked in from app-v2-done.js via IGStory.attach().
(function () {
    'use strict';

    var FLAG = 'instagram_story_v1';
    var HANDLE = '@swimloading';
    var W = 1080, H = 1920;
    var _flag = null;

    function enabled() {
        if (typeof currentUser === 'undefined' || !currentUser) return Promise.resolve(false);
        if (!_flag) {
            _flag = (async function () {
                try {
                    var r = await supabaseClient.from('feature_flags').select('enabled_global, allowed_user_ids').eq('key', FLAG).maybeSingle();
                    if (r.error || !r.data) return false;
                    return !!r.data.enabled_global || (r.data.allowed_user_ids || []).indexOf(currentUser.id) !== -1;
                } catch (e) { return false; }
            })();
        }
        return _flag;
    }
    function track(name, props) { try { analytics.track(name, props || {}); } catch (e) { /* optional */ } }
    function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

    function loadFonts() {
        if (typeof _icLoadFonts === 'function') return _icLoadFonts();
        return Promise.resolve();
    }
    function loadLogo() {
        if (typeof _icLoadLogo === 'function') return _icLoadLogo();
        return new Promise(function (resolve) {
            var img = new Image();
            img.onload = function () { resolve(img); };
            img.onerror = function () { resolve(null); };
            img.src = '/icons/logo-wave.png';
        });
    }
    // Decode a picked photo with its EXIF orientation applied. createImageBitmap first, <img> fallback.
    function decodePhoto(file) {
        if (window.createImageBitmap) {
            return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return viaImg(file); });
        }
        return viaImg(file);
    }
    function viaImg(file) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(file), img = new Image();
            img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
            img.src = url;
        });
    }

    // card: { temp (number|null), spotName, showSpot, conditions, photo (bitmap|img|null) }
    async function render(card, canvas) {
        await loadFonts();
        var logo = await loadLogo();
        canvas.width = W; canvas.height = H;
        var g = canvas.getContext('2d');
        var bebas = '"Bebas Neue", "Arial Narrow", sans-serif';
        var sans = '"DM Sans", -apple-system, sans-serif';

        // Background: photo cover-fit, or the brand gradient
        var bg = g.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#080f1a'); bg.addColorStop(0.55, '#0a1628'); bg.addColorStop(1, '#07131f');
        g.fillStyle = bg; g.fillRect(0, 0, W, H);
        if (card.photo) {
            var pw = card.photo.width, ph = card.photo.height, s = Math.max(W / pw, H / ph);
            var dw = pw * s, dh = ph * s;
            g.drawImage(card.photo, (W - dw) / 2, (H - dh) / 2, dw, dh);
        } else {
            var glow = g.createRadialGradient(W / 2, H * 0.4, 80, W / 2, H * 0.4, 760);
            glow.addColorStop(0, 'rgba(56,189,248,0.20)'); glow.addColorStop(1, 'rgba(56,189,248,0)');
            g.fillStyle = glow; g.fillRect(0, 0, W, H);
        }
        // Legibility scrims (top light, bottom heavy). Instagram covers ~250px top and bottom, so keep text inside.
        var top = g.createLinearGradient(0, 0, 0, 420);
        top.addColorStop(0, 'rgba(8,15,26,0.55)'); top.addColorStop(1, 'rgba(8,15,26,0)');
        g.fillStyle = top; g.fillRect(0, 0, W, 420);
        var bot = g.createLinearGradient(0, 1000, 0, H);
        bot.addColorStop(0, 'rgba(8,15,26,0)'); bot.addColorStop(0.55, 'rgba(8,15,26,0.82)'); bot.addColorStop(1, 'rgba(8,15,26,0.94)');
        g.fillStyle = bot; g.fillRect(0, 1000, W, H - 1000);

        var X = 90, y = 1290;
        g.textBaseline = 'alphabetic'; g.textAlign = 'left';

        // Temperature
        if (card.temp != null && !isNaN(card.temp)) {
            var t = Number(card.temp).toFixed(1);
            g.fillStyle = '#f1f5f9'; g.font = '400 360px ' + bebas;
            g.fillText(t, X, y);
            var tw = g.measureText(t).width;
            g.fillStyle = '#38bdf8'; g.font = '400 170px ' + bebas;
            g.fillText('°C', X + tw + 10, y - 150);
        }
        // Spot
        var line = y + 100;
        if (card.showSpot && card.spotName) {
            var size = 72;
            g.fillStyle = '#f1f5f9';
            do { g.font = '700 ' + size + 'px ' + sans; size -= 4; } while (g.measureText(card.spotName).width > W - 2 * X && size > 36);
            g.fillText(card.spotName, X, line); line += 64;
        }
        var when = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        g.fillStyle = '#cbd5e1'; g.font = '500 42px ' + sans;
        g.fillText(when + (card.conditions ? '  ·  ' + cap(card.conditions) : ''), X, line);

        // Brand block
        var by = 1560;
        if (logo) { var lh = 70, lw = logo.width * (lh / logo.height); g.drawImage(logo, X, by - 52, lw, lh); X += lw + 18; }
        g.fillStyle = '#38bdf8'; g.font = '800 54px ' + sans; g.fillText('SwimLoading', X, by);
        g.fillStyle = '#94a3b8'; g.font = '500 40px ' + sans; g.fillText(HANDLE, 90, by + 62);
        return canvas;
    }

    function toBlob(canvas, photo) {
        return new Promise(function (resolve) { canvas.toBlob(resolve, photo ? 'image/jpeg' : 'image/png', 0.92); });
    }

    function caption(ctx, showSpot) {
        var t = ctx.temp != null ? Number(ctx.temp).toFixed(1) + '°C' : '';
        return (t ? t : 'Water temp') + (showSpot && ctx.spotName ? ' at ' + ctx.spotName : '') + '. Logged on ' + HANDLE + ' swimloading.com';
    }

    function isIOS() { return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }

    function open(ctx) {
        var state = { photo: null, showSpot: true, busy: false };
        var ov = document.createElement('div');
        ov.id = 'igStoryOverlay';
        ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Share to Instagram story');
        ov.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(3,8,16,0.86);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto;';
        var sansCss = 'font-family:\'DM Sans\',sans-serif;';
        ov.innerHTML =
            '<div style="width:100%;max-width:380px;background:#0a1628;border:1px solid #1e3a5f;border-radius:20px;padding:18px;box-sizing:border-box;margin:auto;">' +
              '<div style="' + sansCss + 'font-size:11px;font-weight:700;color:#38bdf8;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">Instagram story</div>' +
              '<div style="text-align:center;margin-bottom:12px;"><canvas id="igCanvas" style="height:46vh;max-height:420px;width:auto;max-width:100%;border-radius:12px;border:1px solid #1e3a5f;background:#080f1a;"></canvas></div>' +
              '<label id="igPhotoBtn" class="v2-btn v2-btn-primary" style="display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;margin-bottom:10px;box-sizing:border-box;width:100%;position:relative;"><i data-lucide="camera"></i><span id="igPhotoLbl">Take or choose a photo</span>' +
                '<input id="igFile" type="file" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;"></label>' +
              '<label style="display:flex;align-items:center;gap:10px;' + sansCss + 'font-size:14px;color:#cbd5e1;margin:0 2px 14px;cursor:pointer;"><input id="igSpot" type="checkbox" checked style="width:18px;height:18px;">Show the spot name</label>' +
              '<button type="button" class="v2-btn v2-btn-ghost" id="igShare">Share without a photo</button>' +
              '<button type="button" class="v2-btn v2-btn-ghost" id="igSave" style="margin-top:10px;"><i data-lucide="download"></i>Save image</button>' +
              '<div id="igNote" style="' + sansCss + 'font-size:12px;color:#94a3b8;line-height:1.6;margin:12px 2px 0;">Pick Instagram in the share sheet, then Story. Instagram not in the row? Swipe the app row, or tap Save image and add it from Instagram. The caption is copied for you.</div>' +
              '<button type="button" class="v2-btn v2-btn-ghost" id="igClose" style="margin-top:12px;">Close</button>' +
            '</div>';
        document.body.appendChild(ov);
        function icons() { if (typeof initIcons === 'function') initIcons(); else if (window.lucide) window.lucide.createIcons(); }
        icons();

        var canvas = ov.querySelector('#igCanvas'), note = ov.querySelector('#igNote');
        var photoBtn = ov.querySelector('#igPhotoBtn'), shareBtn = ov.querySelector('#igShare');
        function card() { return { temp: ctx.temp, spotName: ctx.spotName, showSpot: state.showSpot, conditions: ctx.conditions, photo: state.photo }; }
        function redraw() { render(card(), canvas).catch(function () { note.textContent = 'Could not draw the card.'; }); }
        // Photo first: primary button is "photo" until there is one, then "share" takes over.
        function refresh() {
            var has = !!state.photo;
            photoBtn.className = 'v2-btn ' + (has ? 'v2-btn-ghost' : 'v2-btn-primary');
            ov.querySelector('#igPhotoLbl').textContent = has ? 'Change photo' : 'Take or choose a photo';
            shareBtn.className = 'v2-btn ' + (has ? 'v2-btn-primary' : 'v2-btn-ghost');
            shareBtn.textContent = has ? 'Share to Instagram story' : 'Share without a photo';
        }
        function close() { document.removeEventListener('keydown', onKey); ov.remove(); }
        function onKey(e) { if (e.key === 'Escape') close(); }
        document.addEventListener('keydown', onKey);
        ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
        ov.querySelector('#igClose').addEventListener('click', close);

        ov.querySelector('#igSpot').addEventListener('change', function (e) { state.showSpot = e.target.checked; redraw(); });
        ov.querySelector('#igFile').addEventListener('change', function (e) {
            var f = e.target.files && e.target.files[0];
            if (!f) return;
            decodePhoto(f).then(function (img) {
                state.photo = img; refresh();
                track('ig_story_photo_added', { surface: 'v2_logged' });
                redraw();
            }).catch(function () { note.textContent = 'That photo could not be opened. Try another.'; });
        });

        async function makeFile() {
            await render(card(), canvas);
            var blob = await toBlob(canvas, !!state.photo);
            var name = 'swimloading-story.' + (state.photo ? 'jpg' : 'png');
            return { blob: blob, name: name, file: new File([blob], name, { type: blob.type }) };
        }
        shareBtn.addEventListener('click', async function () {
            if (state.busy) return; state.busy = true;
            var cap_ = caption(ctx, state.showSpot);
            // Clipboard must be written inside the tap; best effort.
            try { if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(cap_); } catch (e) { /* ignore */ }
            try {
                var m = await makeFile();
                if (navigator.canShare && navigator.canShare({ files: [m.file] })) {
                    await navigator.share({ files: [m.file] });
                    track('ig_story_shared', { method: 'native_share', has_photo: !!state.photo, spot_shown: state.showSpot });
                } else {
                    saveBlob(m.blob, m.name);
                    note.textContent = 'Saved to your device. Open Instagram and add it to your story.';
                    track('ig_story_shared', { method: 'download', has_photo: !!state.photo, spot_shown: state.showSpot });
                }
            } catch (e) {
                if (!(e && e.name === 'AbortError')) note.textContent = 'Sharing did not work on this device. Try Save image instead.';
            }
            state.busy = false;
        });
        ov.querySelector('#igSave').addEventListener('click', async function () {
            try {
                var m = await makeFile();
                track('ig_story_saved', { has_photo: !!state.photo, ios: isIOS() });
                if (isIOS()) showHoldToSave(m.blob); else { saveBlob(m.blob, m.name); note.textContent = 'Saved. Open Instagram and add it to your story.'; }
            } catch (e) { note.textContent = 'Could not save the image.'; }
        });

        // iPhone: a download would land in Files, not Photos. Show the image full screen so it can be
        // pressed and held, then "Add to Photos".
        function showHoldToSave(blob) {
            var url = URL.createObjectURL(blob);
            var p = document.createElement('div');
            p.style.cssText = 'position:fixed;inset:0;z-index:10060;background:#030810;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;gap:14px;';
            p.innerHTML = '<div style="' + sansCss + 'font-size:15px;color:#f1f5f9;text-align:center;line-height:1.5;">Press and hold the image, then tap Add to Photos.</div>' +
                '<img alt="Your SwimLoading story image" src="' + url + '" style="max-height:68vh;max-width:100%;border-radius:12px;">' +
                '<button type="button" class="v2-btn v2-btn-ghost" style="max-width:380px;">Done</button>';
            p.querySelector('button').addEventListener('click', function () { p.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000); });
            document.body.appendChild(p);
        }
        function saveBlob(blob, name) {
            var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        }

        track('ig_story_opened', { surface: 'v2_logged' });
        refresh(); redraw();
        // Ask for the photo straight away (still inside the tap that opened this screen, so browsers allow it)
        try { ov.querySelector('#igFile').click(); } catch (e) { /* the button is right there */ }
    }

    // Adds the button after `anchorEl` (the WhatsApp button) when the flag is on.
    function attach(ctx, anchorEl) {
        if (!anchorEl) return;
        enabled().then(function (on) {
            if (!on || !anchorEl.isConnected || document.getElementById('v2DoneIG')) return;
            var b = document.createElement('button');
            b.type = 'button'; b.id = 'v2DoneIG'; b.className = 'v2-btn v2-btn-ghost'; b.style.marginTop = '10px';
            b.innerHTML = '<i data-lucide="camera"></i>Share to Instagram story';
            b.addEventListener('click', function () { open(ctx); });
            anchorEl.insertAdjacentElement('afterend', b);
            if (typeof initIcons === 'function') initIcons(); else if (window.lucide) window.lucide.createIcons();
        }).catch(function () { /* optional */ });
    }

    window.IGStory = { attach: attach, open: open, enabled: enabled, _render: render };
})();
