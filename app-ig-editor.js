// SwimLoading — Instagram story EDITOR (flag: instagram_story_editor_v1; off => app-ig-story.js shows its simple card).
//
// What a web app can and cannot do with Instagram (so this is built around it, not against it):
//   - There is no web API to post, to pre-fill a caption, or to add a real hashtag / mention sticker.
//   - The native share sheet (navigator.share with a file) hands Instagram the IMAGE ONLY. Any text sent
//     with it is dropped by Instagram.
// So the editor does three things well: (1) makes the image itself worth posting (photo framing, movable
// text, colours, layouts), (2) puts the hashtag in the picture AND copies a ready caption (with #swimloading)
// to the clipboard, so it can be pasted into a Story text sticker or a post caption, (3) tells the swimmer
// exactly that, after sharing.
//
// Privacy: the photo is redrawn on a canvas, which drops EXIF (including GPS). Only the spot NAME is drawn,
// never coordinates, and the swimmer can switch the spot off.
//
// Everything is drawn on one 1080x1920 canvas from a small element model, so what the swimmer sees is exactly
// what gets exported. Depends on app-ig-story.js (for IGStory) and app.js globals; fails closed.
(function () {
    'use strict';

    var W = 1080, H = 1920;
    var HANDLE = '@swimloading', TAG = '#swimloading';
    var PREFS_KEY = 'sl_ig_editor_prefs';
    var COLORS = [
        { k: 'white',  v: '#ffffff', n: 'White' },
        { k: 'sky',    v: '#38bdf8', n: 'Blue' },
        { k: 'orange', v: '#fb923c', n: 'Orange' },
        { k: 'yellow', v: '#fde047', n: 'Yellow' },
        { k: 'pink',   v: '#f472b6', n: 'Pink' },
        { k: 'black',  v: '#0b1220', n: 'Black' }
    ];
    // Where the standard blocks sit. Instagram covers about 250px at the top and bottom, so keep text inside that.
    var LAYOUTS = {
        bottom: { n: 'Bottom', align: 'left',   x: 90,  temp: 1290, spot: 1390, when: 1454, brand: 1560, custom: 640 },
        centre: { n: 'Centre', align: 'center', x: 540, temp: 980,  spot: 1090, when: 1154, brand: 1560, custom: 640 },
        top:    { n: 'Top',    align: 'left',   x: 90,  temp: 700,  spot: 800,  when: 864,  brand: 1560, custom: 1120 }
    };
    var ORDER = ['temp', 'spot', 'when', 'brand'];
    var LABEL = { temp: 'Temperature', spot: 'Place', when: 'Date', brand: 'SwimLoading', custom: 'Your text' };

    function track(name, props) { try { analytics.track(name, props || {}); } catch (e) { /* optional */ } }
    function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (e) { return {}; } }
    function savePrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch (e) { /* storage blocked */ } }
    function isIOS() { return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }

    function loadFonts() { return (typeof _icLoadFonts === 'function') ? _icLoadFonts() : Promise.resolve(); }
    function loadLogo() {
        if (typeof _icLoadLogo === 'function') return _icLoadLogo();
        return new Promise(function (resolve) {
            var img = new Image(); img.onload = function () { resolve(img); }; img.onerror = function () { resolve(null); };
            img.src = '/icons/logo-wave.png';
        });
    }
    function decodePhoto(file) {
        function viaImg() {
            return new Promise(function (resolve, reject) {
                var url = URL.createObjectURL(file), img = new Image();
                img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
                img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode')); };
                img.src = url;
            });
        }
        if (window.createImageBitmap) return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(viaImg);
        return viaImg();
    }

    // ── element model ────────────────────────────────────────────────────────────────────────────────
    function applyLayout(els, name) {
        var L = LAYOUTS[name] || LAYOUTS.bottom;
        ORDER.forEach(function (k) { var e = els[k]; if (!e) return; e.x = L.x; e.y = L[k]; e.align = L.align; });
        if (els.custom) { els.custom.x = L.x; els.custom.y = L.custom; els.custom.align = L.align; }
    }
    function newElements(prefs, layoutName) {
        var c = prefs.colors || {};
        var els = {
            temp:  { id: 'temp',  x: 0, y: 0, scale: 1, align: 'left', color: c.temp  || '#ffffff', visible: true },
            spot:  { id: 'spot',  x: 0, y: 0, scale: 1, align: 'left', color: c.spot  || '#ffffff', visible: prefs.spot !== false },
            when:  { id: 'when',  x: 0, y: 0, scale: 1, align: 'left', color: c.when  || '#cbd5e1', visible: prefs.when !== false },
            brand: { id: 'brand', x: 0, y: 0, scale: 1, align: 'left', color: c.brand || '#38bdf8', visible: true, tag: prefs.tag !== false }
        };
        applyLayout(els, layoutName);
        return els;
    }

    // Each draw function paints one element and returns its bounding box { x, y, w, h } in canvas pixels.
    function leftFor(el, w) { return el.align === 'center' ? el.x - w / 2 : el.x; }
    var DRAW = {
        temp: function (g, el, card, F) {
            if (card.temp == null || isNaN(card.temp)) return null;
            var t = Number(card.temp).toFixed(1), size = 360 * el.scale, usize = 170 * el.scale, gap = 10 * el.scale;
            g.font = '400 ' + size + 'px ' + F.bebas; var nw = g.measureText(t).width;
            g.font = '400 ' + usize + 'px ' + F.bebas; var uw = g.measureText('°C').width;
            var total = nw + gap + uw, left = leftFor(el, total);
            g.fillStyle = el.color; g.font = '400 ' + size + 'px ' + F.bebas; g.fillText(t, left, el.y);
            // the unit uses the same colour; plain white keeps the brand blue so the default look is unchanged
            g.fillStyle = (el.color.toLowerCase() === '#ffffff') ? '#38bdf8' : el.color;
            g.font = '400 ' + usize + 'px ' + F.bebas; g.fillText('°C', left + nw + gap, el.y - 150 * el.scale);
            return { x: left, y: el.y - size * 0.74, w: total, h: size * 0.74 };
        },
        spot: function (g, el, card, F) {
            if (!card.spotName) return null;
            var size = 72 * el.scale, maxW = W - 180;
            do { g.font = '700 ' + size + 'px ' + F.sans; size -= 4; } while (g.measureText(card.spotName).width > maxW && size > 32);
            var w = g.measureText(card.spotName).width, left = leftFor(el, w);
            g.fillStyle = el.color; g.fillText(card.spotName, left, el.y);
            return { x: left, y: el.y - (size + 4) * 0.92, w: w, h: (size + 4) * 1.1 };
        },
        when: function (g, el, card, F) {
            var when = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
            var txt = when + (card.conditions ? '  ·  ' + cap(card.conditions) : '');
            var size = 42 * el.scale; g.font = '500 ' + size + 'px ' + F.sans;
            var w = g.measureText(txt).width, left = leftFor(el, w);
            g.fillStyle = el.color; g.fillText(txt, left, el.y);
            return { x: left, y: el.y - size * 0.95, w: w, h: size * 1.2 };
        },
        brand: function (g, el, card, F) {
            var s = el.scale, lh = 70 * s, wm = 54 * s, hs = 40 * s;
            var logo = F.logo, lw = logo ? logo.width * (lh / logo.height) : 0, gap = logo ? 18 * s : 0;
            g.font = '800 ' + wm + 'px ' + F.sans; var ww = g.measureText('SwimLoading').width;
            g.font = '500 ' + hs + 'px ' + F.sans; var hw = g.measureText(HANDLE).width, tw = el.tag ? g.measureText(TAG).width : 0;
            var row1 = lw + gap + ww, w = Math.max(row1, hw, tw), left = leftFor(el, w);
            var r1 = el.align === 'center' ? left + (w - row1) / 2 : left, x = r1;
            if (logo) { g.drawImage(logo, x, el.y - 52 * s, lw, lh); x += lw + gap; }
            g.fillStyle = el.color; g.font = '800 ' + wm + 'px ' + F.sans; g.fillText('SwimLoading', x, el.y);
            g.font = '500 ' + hs + 'px ' + F.sans;
            var hx = el.align === 'center' ? left + (w - hw) / 2 : left;
            g.fillStyle = '#cbd5e1'; g.fillText(HANDLE, hx, el.y + 62 * s);
            var bottom = el.y + 62 * s;
            if (el.tag) {
                var tx = el.align === 'center' ? left + (w - tw) / 2 : left;
                g.fillStyle = el.color; g.font = '700 ' + hs + 'px ' + F.sans; g.fillText(TAG, tx, el.y + 62 * s + 56 * s); bottom = el.y + 62 * s + 56 * s;
            }
            return { x: left, y: el.y - 52 * s, w: w, h: bottom - (el.y - 52 * s) + 10 };
        },
        custom: function (g, el, card, F) {
            if (!el.text) return null;
            var size = 84 * el.scale; g.font = '700 ' + size + 'px ' + F.sans;
            var w = g.measureText(el.text).width, left = leftFor(el, w);
            g.fillStyle = el.color; g.fillText(el.text, left, el.y);
            return { x: left, y: el.y - size * 0.92, w: w, h: size * 1.15 };
        }
    };

    // state: { els, order[], photo, pz {scale, ox, oy}, overlay 0|1|2 }
    async function render(state, card, canvas, opts) {
        opts = opts || {};
        await loadFonts();
        var F = { bebas: '"Bebas Neue", "Arial Narrow", sans-serif', sans: '"DM Sans", -apple-system, sans-serif', logo: await loadLogo() };
        canvas.width = W; canvas.height = H;
        var g = canvas.getContext('2d');

        var bg = g.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#080f1a'); bg.addColorStop(0.55, '#0a1628'); bg.addColorStop(1, '#07131f');
        g.fillStyle = bg; g.fillRect(0, 0, W, H);
        if (state.photo) {
            var pw = state.photo.width, ph = state.photo.height, s0 = Math.max(W / pw, H / ph), s = s0 * state.pz.scale;
            var dw = pw * s, dh = ph * s;
            var maxX = (dw - W) / 2, maxY = (dh - H) / 2;
            state.pz.ox = clamp(state.pz.ox, -maxX, maxX); state.pz.oy = clamp(state.pz.oy, -maxY, maxY);
            g.drawImage(state.photo, (W - dw) / 2 + state.pz.ox, (H - dh) / 2 + state.pz.oy, dw, dh);
        } else {
            var glow = g.createRadialGradient(W / 2, H * 0.4, 80, W / 2, H * 0.4, 760);
            glow.addColorStop(0, 'rgba(56,189,248,0.20)'); glow.addColorStop(1, 'rgba(56,189,248,0)');
            g.fillStyle = glow; g.fillRect(0, 0, W, H);
        }
        var k = [0, 0.6, 1][state.overlay == null ? 1 : state.overlay];
        if (k > 0) {
            var top = g.createLinearGradient(0, 0, 0, 420);
            top.addColorStop(0, 'rgba(8,15,26,' + (0.55 * k) + ')'); top.addColorStop(1, 'rgba(8,15,26,0)');
            g.fillStyle = top; g.fillRect(0, 0, W, 420);
            var bot = g.createLinearGradient(0, 1000, 0, H);
            bot.addColorStop(0, 'rgba(8,15,26,0)'); bot.addColorStop(0.55, 'rgba(8,15,26,' + (0.82 * k) + ')'); bot.addColorStop(1, 'rgba(8,15,26,' + (0.94 * k) + ')');
            g.fillStyle = bot; g.fillRect(0, 1000, W, H - 1000);
        }
        g.textBaseline = 'alphabetic'; g.textAlign = 'left';
        // a soft shadow keeps coloured text readable on a busy photo
        if (state.photo) { g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 22; g.shadowOffsetY = 2; }
        state.boxes = {};
        state.order.forEach(function (id) {
            var el = state.els[id]; if (!el || !el.visible) return;
            var box = DRAW[id === 'custom' ? 'custom' : id](g, el, card, F);
            if (box) state.boxes[id] = box;
        });
        g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetY = 0;
        // selection guide: preview only, never exported
        if (opts.preview && state.selected && state.boxes[state.selected]) {
            var b = state.boxes[state.selected];
            g.strokeStyle = '#38bdf8'; g.lineWidth = 6; g.setLineDash([22, 16]);
            g.strokeRect(b.x - 20, b.y - 20, b.w + 40, b.h + 40); g.setLineDash([]);
        }
        return canvas;
    }

    function defaultCaption(ctx, showSpot, tag) {
        var t = ctx.temp != null ? Number(ctx.temp).toFixed(1) + '°C' : 'Water temp';
        return t + (showSpot && ctx.spotName ? ' at ' + ctx.spotName : '') + '. Logged on ' + HANDLE + (tag ? ' ' + TAG : '');
    }

    var CSS_ID = 'igEditorCss';
    function ensureCss() {
        if (document.getElementById(CSS_ID)) return;
        var st = document.createElement('style'); st.id = CSS_ID;
        st.textContent =
            '#igEd{position:fixed;inset:0;z-index:10050;background:#050b14;display:flex;flex-direction:column;font-family:"DM Sans",-apple-system,sans-serif;color:#f1f5f9;}' +
            '#igEd *{box-sizing:border-box;}' +
            '#igEd .ed-head{display:flex;align-items:center;justify-content:space-between;padding:calc(10px + env(safe-area-inset-top,0px)) 16px 8px;}' +
            '#igEd .ed-title{font-size:15px;font-weight:800;letter-spacing:.2px;display:flex;align-items:center;gap:8px;}' +
            '#igEd .ed-x{background:none;border:none;color:#94a3b8;font-size:26px;line-height:1;min-width:44px;min-height:44px;cursor:pointer;}' +
            '#igEd .ed-stage{flex:0 0 auto;display:flex;justify-content:center;padding:0 16px;}' +
            '#igEd canvas{height:46dvh;max-height:520px;width:auto;max-width:100%;border-radius:14px;border:1px solid #1e3a5f;background:#080f1a;touch-action:none;-webkit-user-select:none;user-select:none;}' +
            '#igEd .ed-hint{font-size:12px;color:#94a3b8;text-align:center;padding:8px 16px 0;min-height:24px;}' +
            '#igEd .ed-body{flex:1 1 auto;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:6px 16px 16px;}' +
            '#igEd .ed-sec{margin-top:14px;}' +
            '#igEd .ed-lbl{font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#64748b;margin-bottom:8px;display:flex;justify-content:space-between;gap:8px;}' +
            '#igEd .ed-row{display:flex;flex-wrap:wrap;gap:8px;}' +
            '#igEd .ed-chip{min-height:44px;padding:0 16px;border-radius:999px;border:1px solid rgba(148,163,184,.35);background:transparent;color:#e2e8f0;font:600 14px "DM Sans",sans-serif;cursor:pointer;}' +
            '#igEd .ed-chip.on{background:#38bdf8;border-color:#38bdf8;color:#06121f;}' +
            '#igEd .ed-sw{width:44px;height:44px;border-radius:50%;border:2px solid rgba(148,163,184,.4);cursor:pointer;padding:0;}' +
            '#igEd .ed-sw.on{outline:3px solid #38bdf8;outline-offset:2px;}' +
            '#igEd input[type=range]{width:100%;min-height:44px;accent-color:#38bdf8;}' +
            '#igEd .ed-in{width:100%;min-height:44px;border-radius:12px;border:1px solid rgba(148,163,184,.35);background:rgba(255,255,255,.05);color:#f1f5f9;padding:10px 12px;font:500 15px "DM Sans",sans-serif;}' +
            '#igEd textarea.ed-in{min-height:84px;resize:none;line-height:1.5;}' +
            '#igEd .ed-foot{padding:10px 16px calc(14px + env(safe-area-inset-bottom,0px));border-top:1px solid #12233a;background:#050b14;display:flex;flex-direction:column;gap:10px;}' +
            '#igEd .ed-btn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:52px;border-radius:999px;border:none;font:700 16px "DM Sans",sans-serif;cursor:pointer;}' +
            '#igEd .ed-ig{color:#fff;background:linear-gradient(45deg,#f09433 0%,#e6683c 25%,#dc2743 50%,#cc2366 75%,#bc1888 100%);}' +
            '#igEd .ed-ghost{background:transparent;color:#f1f5f9;border:1px solid rgba(148,163,184,.35);}' +
            '#igEd .ed-note{font-size:12.5px;line-height:1.55;color:#cbd5e1;background:rgba(56,189,248,.08);border:1px solid rgba(56,189,248,.25);border-radius:12px;padding:10px 12px;}' +
            '#igEd .ed-small{min-height:44px;background:none;border:none;color:#38bdf8;font:600 13px "DM Sans",sans-serif;cursor:pointer;padding:0 4px;}';
        document.head.appendChild(st);
    }

    // The Instagram glyph, drawn as the rounded-square camera outline. Used only to mark "share to Instagram".
    var IG_GLYPH = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.4" cy="6.6" r="0.9" fill="#fff" stroke="none"/></svg>';
    window.IGEditorGlyph = IG_GLYPH;

    function open(ctx, surface) {
        ensureCss();
        var surf = surface || 'v2_logged';
        var prefs = loadPrefs();
        var layoutName = LAYOUTS[prefs.layout] ? prefs.layout : 'bottom';
        var state = {
            els: newElements(prefs, layoutName), order: ORDER.slice(), photo: null, pz: { scale: 1, ox: 0, oy: 0 },
            overlay: prefs.overlay == null ? 1 : prefs.overlay, selected: 'temp', boxes: {}, layout: layoutName,
            captionEdited: false, busy: false, edits: {}
        };
        var card = { temp: ctx.temp, spotName: ctx.spotName, conditions: ctx.conditions };
        if (ctx.temp == null || isNaN(ctx.temp)) { state.els.temp.visible = false; state.selected = 'spot'; }
        if (!ctx.spotName) state.els.spot.visible = false;

        var ov = document.createElement('div');
        ov.id = 'igEd'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Edit your Instagram story');
        ov.innerHTML =
            '<div class="ed-head"><div class="ed-title">' + IG_GLYPH.replace('stroke="#fff"', 'stroke="#f472b6"').replace('fill="#fff"', 'fill="#f472b6"') + ' Instagram story</div>' +
                '<button type="button" class="ed-x" id="edClose" aria-label="Close">&times;</button></div>' +
            '<div class="ed-stage"><canvas id="edCanvas" aria-label="Story preview. Drag items to move them."></canvas></div>' +
            '<div class="ed-hint" id="edHint">Tap an item to edit it. Drag to move. Pinch to resize.</div>' +
            '<div class="ed-body" id="edBody">' +
              '<div class="ed-sec"><div class="ed-lbl">Photo</div><div class="ed-row">' +
                '<label class="ed-chip" id="edPhotoBtn" style="display:inline-flex;align-items:center;cursor:pointer;position:relative;"><span id="edPhotoLbl">Add a photo</span>' +
                  '<input id="edFile" type="file" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;"></label>' +
                '<button type="button" class="ed-chip" id="edPhotoReset" style="display:none;">Reset framing</button></div></div>' +
              '<div class="ed-sec"><div class="ed-lbl">Layout</div><div class="ed-row" id="edLayouts"></div></div>' +
              '<div class="ed-sec"><div class="ed-lbl"><span>Colour</span><span id="edEditing" style="text-transform:none;letter-spacing:0;color:#38bdf8;font-weight:600;"></span></div><div class="ed-row" id="edColors"></div></div>' +
              '<div class="ed-sec"><div class="ed-lbl"><span>Size</span></div><input type="range" id="edSize" min="0.5" max="1.6" step="0.05" value="1" aria-label="Size of the selected item"></div>' +
              '<div class="ed-sec"><div class="ed-lbl">Show</div><div class="ed-row" id="edToggles"></div></div>' +
              '<div class="ed-sec"><div class="ed-lbl">Darken for readability</div><div class="ed-row" id="edOverlay"></div></div>' +
              '<div class="ed-sec"><div class="ed-lbl">Add your own text</div><div class="ed-row" style="flex-wrap:nowrap;"><input class="ed-in" id="edText" maxlength="40" placeholder="e.g. Cold plunge day">' +
                '<button type="button" class="ed-chip on" id="edAddText" style="flex:0 0 auto;">Add</button></div>' +
                '<button type="button" class="ed-small" id="edRemoveText" style="display:none;">Remove my text</button></div>' +
              '<div class="ed-sec"><div class="ed-lbl"><span>Caption</span><button type="button" class="ed-small" id="edCopy" style="margin:-12px 0;">Copy caption</button></div>' +
                '<textarea class="ed-in" id="edCaption" maxlength="300" aria-label="Caption to paste into Instagram"></textarea>' +
                '<div style="font-size:12px;color:#64748b;margin-top:6px;line-height:1.5;">Instagram cannot receive a caption from another app, so this is copied when you share. In Instagram, paste it into a text sticker on your story, or into your post caption.</div></div>' +
              '<div class="ed-note" id="edNote" style="display:none;margin-top:14px;"></div>' +
            '</div>' +
            '<div class="ed-foot"><button type="button" class="ed-btn ed-ig" id="edShare">' + IG_GLYPH + ' Share to Instagram</button>' +
              '<button type="button" class="ed-btn ed-ghost" id="edSave">Save image</button></div>';
        document.body.appendChild(ov);
        var $ = function (id) { return ov.querySelector('#' + id); };
        var canvas = $('edCanvas'), note = $('edNote'), hint = $('edHint');

        function edit(kind) { if (!state.edits[kind]) { state.edits[kind] = true; track('ig_editor_edit', { kind: kind, surface: surf }); } }
        function persist() {
            var colors = {}; ORDER.forEach(function (k) { colors[k] = state.els[k].color; });
            savePrefs({ layout: state.layout, colors: colors, overlay: state.overlay, spot: state.els.spot.visible, when: state.els.when.visible, tag: state.els.brand.tag });
        }
        function redraw() { render(state, card, canvas, { preview: true }).then(refreshControls).catch(function () { hint.textContent = 'Could not draw the picture.'; }); }
        function sel() { return state.els[state.selected] || null; }

        // ── controls ────────────────────────────────────────────────────────────────────────────────
        function chip(label, on, attrs) { return '<button type="button" class="ed-chip' + (on ? ' on' : '') + '" ' + attrs + '>' + esc(label) + '</button>'; }
        function buildStaticControls() {
            $('edLayouts').innerHTML = Object.keys(LAYOUTS).map(function (k) { return chip(LAYOUTS[k].n, state.layout === k, 'data-layout="' + k + '"'); }).join('');
            $('edColors').innerHTML = COLORS.map(function (c) { return '<button type="button" class="ed-sw" data-color="' + c.v + '" aria-label="' + c.n + '" style="background:' + c.v + ';"></button>'; }).join('');
            $('edOverlay').innerHTML = [['Off', 0], ['Soft', 1], ['Strong', 2]].map(function (o) { return chip(o[0], state.overlay === o[1], 'data-overlay="' + o[1] + '"'); }).join('');
            var tg = [];
            if (ctx.spotName) tg.push(chip('Place', state.els.spot.visible, 'data-tg="spot"'));
            tg.push(chip('Date', state.els.when.visible, 'data-tg="when"'));
            tg.push(chip('#swimloading', state.els.brand.tag, 'data-tg="tag"'));
            $('edToggles').innerHTML = tg.join('');
            $('edCaption').value = defaultCaption(ctx, state.els.spot.visible, state.els.brand.tag);
        }
        function refreshControls() {
            var e = sel();
            $('edEditing').textContent = e ? 'Editing: ' + (LABEL[state.selected] || '') : 'Tap an item on the picture';
            ov.querySelectorAll('.ed-sw').forEach(function (b) { b.classList.toggle('on', !!e && e.color.toLowerCase() === b.getAttribute('data-color').toLowerCase()); });
            ov.querySelectorAll('[data-layout]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-layout') === state.layout); });
            ov.querySelectorAll('[data-overlay]').forEach(function (b) { b.classList.toggle('on', +b.getAttribute('data-overlay') === state.overlay); });
            ov.querySelectorAll('[data-tg]').forEach(function (b) {
                var k = b.getAttribute('data-tg'); b.classList.toggle('on', k === 'tag' ? !!state.els.brand.tag : !!state.els[k].visible);
            });
            $('edSize').value = e ? e.scale : 1; $('edSize').disabled = !e;
            $('edRemoveText').style.display = (state.selected === 'custom' && state.els.custom) ? '' : 'none';
            $('edPhotoLbl').textContent = state.photo ? 'Change photo' : 'Add a photo';
            $('edPhotoReset').style.display = state.photo ? '' : 'none';
            $('edPhotoBtn').classList.toggle('on', !state.photo);
            hint.textContent = state.photo ? 'Tap an item to edit. Drag to move. Pinch to resize. Drag the photo to reframe it.' : 'Tap an item to edit it. Drag to move. Pinch to resize.';
        }
        function syncCaption() { if (!state.captionEdited) $('edCaption').value = defaultCaption(ctx, state.els.spot.visible && !!ctx.spotName, state.els.brand.tag); }

        buildStaticControls();
        ov.addEventListener('click', function (ev) {
            var t = ev.target.closest('button, label'); if (!t) return;
            if (t.hasAttribute('data-layout')) {
                state.layout = t.getAttribute('data-layout'); applyLayout(state.els, state.layout);
                edit('layout'); persist(); redraw();
            } else if (t.hasAttribute('data-color')) {
                var e = sel(); if (!e) return; e.color = t.getAttribute('data-color'); edit('colour'); persist(); redraw();
            } else if (t.hasAttribute('data-overlay')) {
                state.overlay = +t.getAttribute('data-overlay'); edit('darken'); persist(); redraw();
            } else if (t.hasAttribute('data-tg')) {
                var k = t.getAttribute('data-tg');
                if (k === 'tag') state.els.brand.tag = !state.els.brand.tag; else state.els[k].visible = !state.els[k].visible;
                if (!state.els[state.selected] || state.els[state.selected].visible === false) state.selected = 'brand';
                edit('toggle'); syncCaption(); persist(); redraw();
            }
        });
        $('edSize').addEventListener('input', function (e) { var el = sel(); if (!el) return; el.scale = +e.target.value; edit('size'); redraw(); });
        $('edCaption').addEventListener('input', function () { state.captionEdited = true; });

        $('edAddText').addEventListener('click', function () {
            var v = $('edText').value.trim(); if (!v) { $('edText').focus(); return; }
            var L = LAYOUTS[state.layout];
            state.els.custom = state.els.custom || { id: 'custom', scale: 1, color: '#ffffff', visible: true };
            var c = state.els.custom; c.text = v; c.visible = true; c.x = L.x; c.align = L.align; c.y = L.custom;
            if (state.order.indexOf('custom') < 0) state.order.push('custom');
            state.selected = 'custom'; edit('text'); $('edText').value = ''; redraw();
        });
        $('edRemoveText').addEventListener('click', function () {
            delete state.els.custom; state.order = state.order.filter(function (i) { return i !== 'custom'; });
            state.selected = 'temp'; redraw();
        });

        $('edFile').addEventListener('change', function (e) {
            var f = e.target.files && e.target.files[0]; if (!f) return;
            decodePhoto(f).then(function (img) {
                state.photo = img; state.pz = { scale: 1, ox: 0, oy: 0 }; track('ig_story_photo_added', { surface: surf, editor: true }); redraw();
            }).catch(function () { hint.textContent = 'That photo could not be opened. Try another.'; });
        });
        $('edPhotoReset').addEventListener('click', function () { state.pz = { scale: 1, ox: 0, oy: 0 }; redraw(); });

        // ── touch: drag items, pinch to resize (or zoom the photo when nothing is selected) ───────────
        var ptrs = {}, gesture = null;
        function toCanvas(ev) { var r = canvas.getBoundingClientRect(); return { x: (ev.clientX - r.left) * (W / r.width), y: (ev.clientY - r.top) * (H / r.height) }; }
        function hit(p) {
            for (var i = state.order.length - 1; i >= 0; i--) {
                var id = state.order[i], b = state.boxes[id]; if (!b || !state.els[id].visible) continue;
                if (p.x >= b.x - 30 && p.x <= b.x + b.w + 30 && p.y >= b.y - 30 && p.y <= b.y + b.h + 30) return id;
            }
            return null;
        }
        function count() { return Object.keys(ptrs).length; }
        function dist() { var k = Object.keys(ptrs); if (k.length < 2) return 0; var a = ptrs[k[0]], b = ptrs[k[1]]; return Math.hypot(a.x - b.x, a.y - b.y); }
        canvas.addEventListener('pointerdown', function (ev) {
            ev.preventDefault(); try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
            var p = toCanvas(ev); ptrs[ev.pointerId] = p;
            if (count() === 1) {
                var id = hit(p);
                if (id) { state.selected = id; gesture = { type: 'el', id: id, sx: p.x, sy: p.y, ox: state.els[id].x, oy: state.els[id].y, moved: false }; }
                else if (state.photo) { gesture = { type: 'photo', sx: p.x, sy: p.y, ox: state.pz.ox, oy: state.pz.oy, moved: false }; }
                else { state.selected = null; gesture = null; }
                redraw();
            } else if (count() === 2) {
                var tgt = state.selected && state.els[state.selected] ? { type: 'el', base: state.els[state.selected].scale } : (state.photo ? { type: 'photo', base: state.pz.scale } : null);
                gesture = tgt ? { type: 'pinch', tgt: tgt, d0: dist() } : null;
            }
        });
        canvas.addEventListener('pointermove', function (ev) {
            if (!ptrs[ev.pointerId]) return; ev.preventDefault();
            var p = toCanvas(ev); ptrs[ev.pointerId] = p;
            if (!gesture) return;
            if (gesture.type === 'pinch' && count() >= 2 && gesture.d0 > 0) {
                var f = dist() / gesture.d0;
                if (gesture.tgt.type === 'el') { state.els[state.selected].scale = clamp(gesture.tgt.base * f, 0.5, 1.6); edit('pinch'); }
                else { state.pz.scale = clamp(gesture.tgt.base * f, 1, 4); edit('photo-zoom'); }
                redraw(); return;
            }
            if (count() !== 1) return;
            var dx = p.x - gesture.sx, dy = p.y - gesture.sy;
            if (Math.abs(dx) + Math.abs(dy) > 6) gesture.moved = true;
            if (gesture.type === 'el') {
                var el = state.els[gesture.id]; el.x = clamp(gesture.ox + dx, 0, W); el.y = clamp(gesture.oy + dy, 120, H - 120);
                if (gesture.moved) edit('move');
            } else if (gesture.type === 'photo') { state.pz.ox = gesture.ox + dx; state.pz.oy = gesture.oy + dy; if (gesture.moved) edit('photo-move'); }
            redraw();
        });
        function up(ev) { delete ptrs[ev.pointerId]; if (count() < 2 && gesture && gesture.type === 'pinch') gesture = null; if (count() === 0) gesture = null; }
        canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);

        // ── export + share ────────────────────────────────────────────────────────────────────────────
        async function makeFile() {
            var out = document.createElement('canvas');
            var snap = { els: state.els, order: state.order, photo: state.photo, pz: state.pz, overlay: state.overlay, selected: null, boxes: {} };
            await render(snap, card, out, { preview: false });
            var type = state.photo ? 'image/jpeg' : 'image/png';
            var blob = await new Promise(function (res) { out.toBlob(res, type, 0.92); });
            var name = 'swimloading-story.' + (state.photo ? 'jpg' : 'png');
            return { blob: blob, name: name, file: new File([blob], name, { type: blob.type }) };
        }
        function saveBlob(blob, name) {
            var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
            document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        }
        function showNote(html) { note.innerHTML = html; note.style.display = ''; try { note.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { /* ignore */ } }
        async function copyCaption() {
            var txt = $('edCaption').value;
            try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(txt); return true; } } catch (e) { /* fall through */ }
            try { var ta = $('edCaption'); ta.focus(); ta.select(); return document.execCommand('copy'); } catch (e) { return false; }
        }
        function details() {
            return { surface: surf, layout: state.layout, has_photo: !!state.photo, tag_in_image: !!state.els.brand.tag, custom_text: !!state.els.custom,
                caption_edited: state.captionEdited, edits: Object.keys(state.edits).length, spot_shown: !!state.els.spot.visible };
        }
        $('edCopy').addEventListener('click', async function () { var ok = await copyCaption(); showNote(ok ? 'Caption copied. Paste it into your Instagram text sticker or post caption.' : 'Could not copy automatically. Press and hold the caption box and choose Copy.'); });
        $('edShare').addEventListener('click', async function () {
            if (state.busy) return; state.busy = true;
            var copied = await copyCaption();          // inside the tap, before the share sheet opens
            try {
                var m = await makeFile();
                if (navigator.canShare && navigator.canShare({ files: [m.file] })) {
                    await navigator.share({ files: [m.file] });
                    track('ig_story_shared', Object.assign({ method: 'native_share', editor: true }, details()));
                    persist();
                    showNote('<strong>Caption copied.</strong> In Instagram, choose <strong>Story</strong> (or Post), then paste it into a text sticker or your caption: press and hold, then tap Paste.');
                } else {
                    saveBlob(m.blob, m.name);
                    track('ig_story_shared', Object.assign({ method: 'download', editor: true }, details()));
                    showNote('Saved to your device' + (copied ? ' and the caption is copied' : '') + '. Open Instagram, add it to your story, then paste the caption into a text sticker.');
                }
            } catch (e) {
                if (!(e && e.name === 'AbortError')) showNote('Sharing did not work on this device. Try Save image instead.');
            }
            state.busy = false;
        });
        $('edSave').addEventListener('click', async function () {
            try {
                var m = await makeFile(); var copied = await copyCaption();
                track('ig_story_saved', Object.assign({ editor: true, ios: isIOS() }, details()));
                if (isIOS()) {
                    var url = URL.createObjectURL(m.blob), p = document.createElement('div');
                    p.style.cssText = 'position:fixed;inset:0;z-index:10060;background:#030810;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;gap:14px;';
                    p.innerHTML = '<div style="font:500 15px \'DM Sans\',sans-serif;color:#f1f5f9;text-align:center;line-height:1.5;">Press and hold the image, then tap Add to Photos.' + (copied ? '<br>Your caption is copied.' : '') + '</div>' +
                        '<img alt="Your SwimLoading story image" src="' + url + '" style="max-height:66vh;max-width:100%;border-radius:12px;"><button type="button" class="ed-btn ed-ghost" style="max-width:380px;">Done</button>';
                    p.querySelector('button').addEventListener('click', function () { p.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 2000); });
                    ov.appendChild(p);   // inside the editor so its button styles apply
                } else { saveBlob(m.blob, m.name); showNote('Saved. Open Instagram and add it to your story' + (copied ? '. Your caption is copied.' : '.')); }
            } catch (e) { showNote('Could not save the image.'); }
        });

        function close() { document.removeEventListener('keydown', onKey); ov.remove(); }
        function onKey(e) { if (e.key === 'Escape') close(); }
        document.addEventListener('keydown', onKey);
        $('edClose').addEventListener('click', close);

        track('ig_story_opened', { surface: surf, editor: true });
        redraw();
    }

    window.IGEditor = { open: open, _render: render, _layouts: LAYOUTS };
})();
