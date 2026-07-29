// SwimLoading — in-app install prompt (reusable, platform-aware).
// Loaded after app.js/app-nav.js/etc. Depends on the global `analytics` object
// defined in app.js (app.js:45) — falls back to a no-op if unavailable so this
// script can never break page load.
//
// Eligibility (any one triggers it): 30s of app usage, first swim logged,
// second authenticated session, or onboarding completed. Preferred trigger is
// "first swim logged" (fires almost immediately after that CustomEvent).
//
// Dismissal: 1st dismissal -> hide 7 days, 2nd -> hide 30 days, 3rd -> stop
// automatic prompts permanently. Never shown in standalone mode, never shown
// while another modal is open, never shown mid swim-log.

(function () {
    'use strict';

    const KEY_DISMISSED_AT   = 'swimloading_install_prompt_dismissed_at';
    const KEY_DISMISS_COUNT  = 'swimloading_install_prompt_dismiss_count';
    const KEY_INSTALL_DETECTED = 'swimloading_install_detected';
    const KEY_SESSION_COUNT  = 'swimloading_session_count';
    const KEY_SESSION_FLAG   = 'swimloading_session_counted'; // sessionStorage — one increment per browser session

    const DAY_MS = 24 * 60 * 60 * 1000;
    const WAIT_AFTER_DISMISS = { 1: 7 * DAY_MS, 2: 30 * DAY_MS };

    function track(name, props) {
        try {
            if (window.analytics && typeof window.analytics.track === 'function') {
                window.analytics.track(name, props || {});
            }
        } catch (e) { /* never let analytics break the app */ }
    }

    function isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    }

    function isIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    }

    // Heuristic — no reliable generic "is a modal open" signal exists across this
    // codebase's many hand-built modals, so this checks for common visible-modal
    // shapes (id/class containing "modal" or "overlay" with non-none display).
    // Flagged for live-device testing: may miss a modal that doesn't match this pattern.
    function isAnyModalOpen() {
        const candidates = document.querySelectorAll('[id*="odal"], [class*="odal"], [id*="verlay"], [class*="verlay"]');
        for (const el of candidates) {
            if (el.id === 'installPromptModal' || el.id === 'installPromptIOSModal') continue;
            const style = window.getComputedStyle(el);
            if (style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null) {
                return true;
            }
        }
        return false;
    }

    function getDismissCount() {
        return parseInt(localStorage.getItem(KEY_DISMISS_COUNT) || '0', 10);
    }

    function canShowNow() {
        if (isStandalone()) return false;
        if (localStorage.getItem(KEY_INSTALL_DETECTED) === '1') return false;

        const count = getDismissCount();
        if (count >= 3) return false; // third dismissal = stop automatic prompts permanently

        const dismissedAt = parseInt(localStorage.getItem(KEY_DISMISSED_AT) || '0', 10);
        if (dismissedAt && count >= 1) {
            const wait = WAIT_AFTER_DISMISS[count] || Infinity;
            if (Date.now() - dismissedAt < wait) return false;
        }
        return true;
    }

    function recordSession() {
        try {
            if (!sessionStorage.getItem(KEY_SESSION_FLAG)) {
                sessionStorage.setItem(KEY_SESSION_FLAG, '1');
                const n = parseInt(localStorage.getItem(KEY_SESSION_COUNT) || '0', 10) + 1;
                localStorage.setItem(KEY_SESSION_COUNT, String(n));
            }
        } catch (e) {}
    }

    function getSessionCount() {
        return parseInt(localStorage.getItem(KEY_SESSION_COUNT) || '0', 10);
    }

    // ---- native install prompt capture ----
    let deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
    });
    window.addEventListener('appinstalled', () => {
        try { localStorage.setItem(KEY_INSTALL_DETECTED, '1'); } catch (e) {}
        track('app_installed', { source: 'in_app_prompt_or_browser' });
        closePrompt(false);
    });

    let eligibleTracked = false;
    let shown = false;

    function markEligible(reason) {
        if (eligibleTracked || shown) return;
        eligibleTracked = true;
        track('install_prompt_eligible', { reason });
        attemptShow(reason);
    }

    function attemptShow(reason, retriesLeft) {
        if (retriesLeft === undefined) retriesLeft = 5;
        if (shown) return;
        if (!canShowNow()) return;
        if (isAnyModalOpen() || document.hidden) {
            if (retriesLeft > 0) setTimeout(() => attemptShow(reason, retriesLeft - 1), 1500);
            return;
        }
        renderPrompt(reason);
    }

    function renderPrompt(reason) {
        if (shown) return;
        shown = true;
        track('install_prompt_shown', { reason });

        const overlay = document.createElement('div');
        overlay.id = 'installPromptModal';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:10050;background:rgba(5,10,20,0.72);display:flex;align-items:flex-end;justify-content:center;';
        overlay.innerHTML = `
            <div style="width:100%;max-width:480px;background:#0d1728;border:1px solid rgba(255,255,255,0.08);border-radius:20px 20px 0 0;padding:26px 24px 22px;">
                <div style="font-family:'Bebas Neue',sans-serif,Arial;font-size:24px;letter-spacing:0.3px;color:#f1f5f9;margin-bottom:8px;">Add SwimLoading to Your Home Screen</div>
                <div style="font-size:14px;color:#94a3b8;line-height:1.7;margin-bottom:20px;">Open SwimLoading in one tap to log swims, check current water temperatures and track your progress.</div>
                <button id="installPromptInstallBtn" style="display:block;width:100%;background:#38bdf8;color:#080f1a;border:none;font-size:15px;font-weight:700;padding:14px 22px;border-radius:50px;cursor:pointer;margin-bottom:10px;">Install app</button>
                <button id="installPromptMaybeBtn" style="display:block;width:100%;background:transparent;border:1px solid rgba(255,255,255,0.15);color:#f1f5f9;font-size:14px;font-weight:600;padding:13px 22px;border-radius:50px;cursor:pointer;margin-bottom:10px;">Maybe later</button>
                <button id="installPromptShowMeBtn" style="display:block;width:100%;background:none;border:none;color:#64748b;font-size:13px;padding:6px;cursor:pointer;">Show me how</button>
            </div>
        `;
        document.body.appendChild(overlay);

        document.getElementById('installPromptShowMeBtn').addEventListener('click', () => {
            track('install_prompt_clicked', { action: 'show_me_how' });
            window.location.href = '/install';
        });

        document.getElementById('installPromptMaybeBtn').addEventListener('click', () => dismiss());

        document.getElementById('installPromptInstallBtn').addEventListener('click', async () => {
            track('install_prompt_clicked', { action: 'install_app' });
            if (deferredPrompt) {
                deferredPrompt.prompt();
                const choice = await deferredPrompt.userChoice;
                track(choice.outcome === 'accepted' ? 'native_install_prompt_accepted' : 'native_install_prompt_dismissed');
                deferredPrompt = null;
                closePrompt(false);
            } else if (isIOS()) {
                showIOSInstructions();
            } else {
                closePrompt(false);
                window.location.href = '/install';
            }
        });
    }

    function showIOSInstructions() {
        track('ios_install_instructions_viewed', { source: 'in_app_prompt' });
        const overlay = document.getElementById('installPromptModal');
        if (!overlay) return;
        overlay.innerHTML = `
            <div style="width:100%;max-width:480px;background:#0d1728;border:1px solid rgba(255,255,255,0.08);border-radius:20px 20px 0 0;padding:26px 24px 30px;">
                <div style="font-family:'Bebas Neue',sans-serif,Arial;font-size:22px;letter-spacing:0.3px;color:#f1f5f9;margin-bottom:16px;">Install on iPhone or iPad</div>
                <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:22px;">
                    <div style="display:flex;gap:10px;align-items:flex-start;font-size:14px;color:#94a3b8;"><span style="flex-shrink:0;width:20px;height:20px;border-radius:50%;background:rgba(56,189,248,0.15);border:1px solid rgba(56,189,248,0.3);color:#38bdf8;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;">1</span>Tap <strong style="color:#f1f5f9;">Share</strong></div>
                    <div style="display:flex;gap:10px;align-items:flex-start;font-size:14px;color:#94a3b8;"><span style="flex-shrink:0;width:20px;height:20px;border-radius:50%;background:rgba(56,189,248,0.15);border:1px solid rgba(56,189,248,0.3);color:#38bdf8;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;">2</span>Select <strong style="color:#f1f5f9;">Add to Home Screen</strong></div>
                    <div style="display:flex;gap:10px;align-items:flex-start;font-size:14px;color:#94a3b8;"><span style="flex-shrink:0;width:20px;height:20px;border-radius:50%;background:rgba(56,189,248,0.15);border:1px solid rgba(56,189,248,0.3);color:#38bdf8;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;">3</span>Tap <strong style="color:#f1f5f9;">Add</strong></div>
                </div>
                <button id="installPromptCloseBtn" style="display:block;width:100%;background:transparent;border:1px solid rgba(255,255,255,0.15);color:#f1f5f9;font-size:14px;font-weight:600;padding:13px 22px;border-radius:50px;cursor:pointer;">Got it</button>
            </div>
        `;
        document.getElementById('installPromptCloseBtn').addEventListener('click', () => closePrompt(false));
    }

    function dismiss() {
        const count = getDismissCount() + 1;
        try {
            localStorage.setItem(KEY_DISMISS_COUNT, String(count));
            localStorage.setItem(KEY_DISMISSED_AT, String(Date.now()));
        } catch (e) {}
        track('install_prompt_dismissed', { dismiss_count: count });
        closePrompt(true);
    }

    function closePrompt() {
        const overlay = document.getElementById('installPromptModal');
        if (overlay) overlay.remove();
    }

    // ---- eligibility triggers ----
    function init() {
        if (isStandalone()) {
            // Confirms an install that may not have fired 'appinstalled' in this session
            // (e.g. installed previously, opened from home screen now).
            try { localStorage.setItem(KEY_INSTALL_DETECTED, '1'); } catch (e) {}
            return;
        }
        if (localStorage.getItem(KEY_INSTALL_DETECTED) === '1') return;

        recordSession();

        setTimeout(() => markEligible('30s_usage'), 30000);
        window.addEventListener('swimloading:temp_logged', () => setTimeout(() => markEligible('first_swim_logged'), 1200));
        window.addEventListener('swimloading:onboarding_completed', () => markEligible('welcome_flow_completed'));
        if (getSessionCount() >= 2) markEligible('second_session');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
