        // CAPTURE the URL hash IMMEDIATELY before Supabase can consume it
        // Supabase's createClient() auto-detects #access_token=...&type=recovery
        // and processes + clears the hash before our code runs
        const INITIAL_HASH = window.location.hash;
        const IS_PASSWORD_RECOVERY = INITIAL_HASH && INITIAL_HASH.includes('type=recovery');
        const IS_AUTH_ERROR = INITIAL_HASH && INITIAL_HASH.includes('error=');
        const IS_EMAIL_VERIFY = INITIAL_HASH && INITIAL_HASH.includes('type=signup');

        if (IS_PASSWORD_RECOVERY || IS_AUTH_ERROR || IS_EMAIL_VERIFY) {
            console.log('Auth hash detected BEFORE Supabase init:',
                IS_PASSWORD_RECOVERY ? 'RECOVERY' : IS_AUTH_ERROR ? 'ERROR' : 'SIGNUP');
        }

        // Initialize Supabase
        const SUPABASE_URL = 'https://szgkzuswelntnevobnoh.supabase.co';
        const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA';

        // VAPID public key for Web Push notifications
        // Generate with: npx web-push generate-vapid-keys
        // Replace this placeholder after generating your keys
        const VAPID_PUBLIC_KEY = 'BAd_dnaXgagx5PBYmVLeuHsCyljuCrUQVGTd7ZqFcJnw9S1mAh-kGFkn2gcs74IBIvdugFqHmqgTnRu9dRNeBtk';

        let supabaseClient;

        // Initialize after library loads
        if (window.supabase) {
            supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        }

        // Analytics — fire-and-forget event tracking to Supabase
        const analytics = {
            track(eventName, properties = {}) {
                if (!supabaseClient) return;
                supabaseClient.from('analytics_events').insert({
                    event_name: eventName,
                    user_id: (typeof currentUser !== 'undefined' && currentUser?.id) || null,
                    properties: Object.keys(properties).length ? properties : null
                }).then(() => {});
            }
        };

        // Global state
        let currentUser = null;
        let currentUserProfile = null;  // full profile object loaded at app start
        let spots = [];
        let domains = [];  // loaded from DB — replaces all hardcoded DOMAINS arrays
        let internationalSpotIds = new Set(); // spot IDs where countries.is_domestic = false

        // Swim Score caches — var so they're accessible across all script blocks
        var conditionsCache = {}; // spot_id → array of recent temp_logs (last 96h, desc)
        var swimEventsCache = []; // upcoming active swim_events (all spots)

        // Global state for Spot Lock
        let selectedSpotLocked = false;
        let gpsSuggestedSpotId = null;

        // Active hazard reports — populated in loadDashboard(), keyed by spot_id
        let activeHazardsBySpot = {};
        let hazardAcknowledged = false; // set true after user confirms hazard warning

        // Today's wind/wave forecast — populated async by loadTodayForecast()
        var todayForecast = null; // { windSpeed, windDeg, windDirLabel, waveHeight, swellHeight }

        // Wind direction degrees → compass label (N, NNE, NE … NW, NNW)
        function windDirLabel(deg) {
            const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
            return dirs[Math.round(deg / 22.5) % 16];
        }

        // Icon helper function
        function icon(name, size = 16) {
            return `<i data-lucide="${name}" style="width: ${size}px; height: ${size}px; display: inline-block; vertical-align: middle;"></i>`;
        }

        // Initialize Lucide icons after DOM updates
        function initIcons() {
            if (window.lucide) {
                lucide.createIcons();
            }
        }

        // Check authentication on load
        async function checkAuth() {
            // Phase 5: Capture share referral BEFORE routing (URL may be cleared after auth)
            // Stored in localStorage so it survives through the signup flow
            try {
                const _cp = new URLSearchParams(window.location.search);
                if (_cp.get('ref') === 'share') {
                    const _rt = _cp.get('swim') ? 'swim' : _cp.get('spot') ? 'spot' : null;
                    const _ri = _cp.get('swim') || _cp.get('spot');
                    if (_rt && _ri) {
                        localStorage.setItem('_swimref', JSON.stringify({ type: _rt, id: _ri, ts: Date.now() }));
                    }
                }
            } catch (_) {}

            // Use the hash we captured BEFORE Supabase could consume it
            // (Supabase's createClient auto-processes and clears auth hashes)

            // Handle password recovery
            if (IS_PASSWORD_RECOVERY) {
                console.log('Recovery detected — waiting for Supabase to process token...');
                // Give Supabase a moment to exchange the token for a session
                // Then show the reset form
                await waitForSession(3000);
                showResetPasswordForm();
                return;
            }

            // Handle expired/invalid links
            if (IS_AUTH_ERROR) {
                const params = new URLSearchParams(INITIAL_HASH.substring(1));
                const errorDesc = params.get('error_description') || 'The link has expired or is invalid.';
                console.log('Auth error from URL:', errorDesc);
                window.location.hash = '';
                showAuth();
                setTimeout(() => {
                    showForgotPassword();
                    const msgEl = document.getElementById('forgotMessage');
                    msgEl.style.display = 'block';
                    msgEl.style.background = 'rgba(239, 68, 68, 0.1)';
                    msgEl.style.color = 'var(--danger)';
                    msgEl.innerHTML = decodeURIComponent(errorDesc.replace(/\+/g, ' ')) + '<br><span style="font-size:12px; color: var(--text-secondary);">Please request a new reset link below.</span>';
                }, 200);
                return;
            }

            // Handle email verification (type=signup)
            if (IS_EMAIL_VERIFY) {
                console.log('Email verification token detected');
                // Let Supabase process the token, then load
                await waitForSession(3000);
                const { data: { session } } = await supabaseClient.auth.getSession();
                window.location.hash = '';
                if (session) {
                    currentUser = session.user;
                    loadApp();
                } else {
                    showAuth();
                }
                return;
            }

            // Normal auth check - no special tokens
            const { data: { session } } = await supabaseClient.auth.getSession();
            if (session) {
                currentUser = session.user;
                loadApp();
            } else {
                showAuth();
            }
        }

        // Helper: wait for Supabase to finish processing the auth hash into a session
        function waitForSession(maxMs) {
            return new Promise((resolve) => {
                let elapsed = 0;
                const interval = setInterval(async () => {
                    elapsed += 200;
                    const { data: { session } } = await supabaseClient.auth.getSession();
                    if (session || elapsed >= maxMs) {
                        clearInterval(interval);
                        if (session) console.log('Session ready after', elapsed, 'ms');
                        else console.log('No session after', maxMs, 'ms');
                        resolve(session);
                    }
                }, 200);
            });
        }

        // Show forgot password form
        function showForgotPassword() {
            document.getElementById('loginForm').style.display = 'none';
            document.getElementById('forgotPasswordForm').style.display = 'block';
            document.querySelector('.auth-tabs').style.display = 'none';
            initIcons();
        }

        // Hide forgot password form
        function hideForgotPassword() {
            document.getElementById('forgotPasswordForm').style.display = 'none';
            document.getElementById('loginForm').style.display = 'block';
            document.querySelector('.auth-tabs').style.display = 'flex';
            document.getElementById('forgotMessage').style.display = 'none';
        }

        // Send password reset email
        let resetCooldown = false;
        async function sendPasswordReset() {
            const email = document.getElementById('forgotEmail').value;
            if (!email) {
                alert('Please enter your email address');
                return;
            }

            if (resetCooldown) return;

            const msgEl = document.getElementById('forgotMessage');
            const btn = document.getElementById('resetSendBtn');
            msgEl.style.display = 'block';
            msgEl.style.background = 'rgba(56, 189, 248, 0.1)';
            msgEl.style.color = 'var(--ocean-light)';
            msgEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;gap:8px;"><div class="spinner-small"></div> Sending reset link...</div>';
            btn.disabled = true;
            btn.style.opacity = '0.5';

            const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin + '/app'
            });

            if (error) {
                msgEl.style.background = 'rgba(239, 68, 68, 0.1)';
                msgEl.style.color = 'var(--danger)';
                msgEl.textContent = 'Error: ' + error.message;
                btn.disabled = false;
                btn.style.opacity = '1';
            } else {
                msgEl.style.background = 'rgba(16, 185, 129, 0.08)';
                msgEl.style.color = 'var(--success)';
                msgEl.innerHTML = `
                    <div style="font-weight: 600; margin-bottom: 8px;">Reset link sent!</div>
                    <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.5;">
                        Check your inbox for <strong style="color: var(--text-primary);">${email}</strong><br>
                        Also check your <strong style="color: var(--text-primary);">Spam / Junk</strong> folder<br>
                        Email can take 1-3 minutes to arrive
                    </div>
                `;

                // Start 60s cooldown with countdown
                resetCooldown = true;
                let seconds = 60;
                btn.textContent = `Resend in ${seconds}s`;
                const timer = setInterval(() => {
                    seconds--;
                    btn.textContent = `Resend in ${seconds}s`;
                    if (seconds <= 0) {
                        clearInterval(timer);
                        resetCooldown = false;
                        btn.disabled = false;
                        btn.style.opacity = '1';
                        btn.textContent = 'Resend Reset Link';
                    }
                }, 1000);
            }
        }

        // Show reset password form (after clicking email link)
        function showResetPasswordForm() {
            document.getElementById('authScreen').style.display = 'flex';
            document.getElementById('mainApp').style.display = 'none';
            // Hide all other auth forms
            document.getElementById('loginForm').style.display = 'none';
            document.getElementById('signupForm').style.display = 'none';
            document.getElementById('forgotPasswordForm').style.display = 'none';
            document.querySelector('.auth-tabs').style.display = 'none';
            // Show reset form
            document.getElementById('resetPasswordForm').style.display = 'block';
            initIcons();
        }

        // Update password
        async function updatePassword() {
            const newPass = document.getElementById('newPassword').value;
            const confirmPass = document.getElementById('confirmPassword').value;
            const msgEl = document.getElementById('resetMessage');

            if (!newPass || !confirmPass) {
                alert('Please fill in both fields');
                return;
            }

            if (newPass !== confirmPass) {
                msgEl.style.display = 'block';
                msgEl.style.background = 'rgba(239, 68, 68, 0.1)';
                msgEl.style.color = 'var(--danger)';
                msgEl.textContent = 'Passwords do not match';
                return;
            }

            if (newPass.length < 6) {
                msgEl.style.display = 'block';
                msgEl.style.background = 'rgba(239, 68, 68, 0.1)';
                msgEl.style.color = 'var(--danger)';
                msgEl.textContent = 'Password must be at least 6 characters';
                return;
            }

            msgEl.style.display = 'block';
            msgEl.style.background = 'rgba(56, 189, 248, 0.1)';
            msgEl.style.color = 'var(--ocean-light)';
            msgEl.textContent = 'Updating password...';

            const { error } = await supabaseClient.auth.updateUser({
                password: newPass
            });

            if (error) {
                msgEl.style.background = 'rgba(239, 68, 68, 0.1)';
                msgEl.style.color = 'var(--danger)';
                msgEl.textContent = 'Error: ' + error.message;
            } else {
                msgEl.style.background = 'rgba(16, 185, 129, 0.1)';
                msgEl.style.color = 'var(--success)';
                msgEl.innerHTML = 'Password updated! Redirecting...';

                // Clean up URL hash and redirect to app
                window.location.hash = '';
                setTimeout(() => {
                    document.getElementById('resetPasswordForm').style.display = 'none';
                    document.querySelector('.auth-tabs').style.display = 'flex';
                    const { data: { session } } = supabaseClient.auth.getSession().then(({ data: { session } }) => {
                        if (session) {
                            currentUser = session.user;
                            loadApp();
                        } else {
                            showAuth();
                            hideForgotPassword();
                        }
                    });
                }, 1500);
            }
        }

        // Show auth screen
        function showAuth() {
            document.getElementById('authScreen').style.display = 'flex';
            document.getElementById('mainApp').style.display = 'none';
        }

        // Load main app
        async function loadApp() {
            // Load domains early — needed for onboarding dropdowns AND main app
            await loadDomains();

            // Check if user needs onboarding
            const { data: profile } = await supabaseClient
                .from('profiles')
                .select('terms_accepted_at, avatar_url, display_name, phone, onboarding_completed_at, home_domain')
                .eq('id', currentUser.id)
                .maybeSingle();

            // NEW USER — never accepted legal
            if (!profile || !profile.terms_accepted_at) {
                document.getElementById('authScreen').style.display = 'none';
                document.getElementById('mainApp').style.display = 'none';
                showOnboardingLegal();
                return;
            }

            // INCOMPLETE USER — accepted legal but missing phone/profile details
            // Allow access but show soft banner + prompt before actions
            const isIncompleteProfile = !profile.onboarding_completed_at || !profile.phone;
            if (isIncompleteProfile) {
                window.incompleteProfile = true; // Flag for contextual prompts
            }

            // Load app regardless of profile completeness
            document.getElementById('authScreen').style.display = 'none';
            document.getElementById('mainApp').style.display = 'block';

            // Show incomplete profile banner if needed
            if (isIncompleteProfile) {
                showIncompleteProfileBanner();
            }

            // Show PWA install prompt if not dismissed
            showPwaInstallPrompt();

            // Load user avatar into header
            if (profile.avatar_url) {
                updateHeaderAvatar(profile.avatar_url);
            }

            // Set avatar color based on saved icon
            if (profile.avatar_url) {
                const avatarMeta = AVATARS.find(a => a.icon === profile.avatar_url);
                if (avatarMeta) {
                    const avatarDiv = document.querySelector('.user-avatar');
                    if (avatarDiv) {
                        avatarDiv.style.background = avatarMeta.color;
                        avatarDiv.style.borderColor = avatarMeta.color;
                    }
                }
            }

            // Store profile for dashboard filtering
            currentUserProfile = profile;

            // Load spots
            await loadSpots();

            // Build international spot ID set from countries table
            await loadCountriesAndRebuildIntl();

            // Load dashboard data
            await loadDashboard();

            // Check for unimported Strava swims (non-blocking)
            if (typeof checkStravaBanner === 'function') checkStravaBanner();

            // Load club memberships (non-blocking — shows/hides Club nav tab)
            if (typeof loadUserClubs === 'function') loadUserClubs();


            // Prompt existing users who haven't set their home region yet
            if (!currentUserProfile?.home_domain) setTimeout(showHomeDomainPrompt, 800);

            // Initialize Lucide icons
            initIcons();

            // Initialize spot lock handler
            attachSpotLockHandler();

            // Initialize nav scroll handler
            initNavScroll();

            // Start Notification Polling
            startNotificationPolling();

            // Prompt for push notifications (non-blocking banner)
            setTimeout(() => promptPushNotifications(), 2000);
            // Prompt for new swim alerts (shown after push prompt, staggered)
            setTimeout(() => promptNewSwimAlerts(), 3500);

            // Deep link: if URL has ?swim=ID, open that swim's details
            const urlParams = new URLSearchParams(window.location.search);
            const swimId = urlParams.get('swim');
            const spotDeepId = urlParams.get('spot');
            const stravaParam = urlParams.get('strava');

            if (stravaParam) {
                window.history.replaceState({}, '', window.location.pathname + window.location.hash);
                if (stravaParam === 'connected') {
                    showToast('Strava connected! You can now import your swims.', 'success');
                } else if (stravaParam === 'denied') {
                    showToast('Strava connection cancelled.', 'info');
                } else if (stravaParam === 'error') {
                    const reason = urlParams.get('reason') || 'unknown';
                    showToast(`Strava connection failed (${reason}). Please try again.`, 'error');
                }
            }

            if (swimId) {
                // Clean the URL so it doesn't re-trigger on refresh
                window.history.replaceState({}, '', window.location.pathname + window.location.hash);
                setTimeout(() => viewEventDetails(swimId), 300);
            } else if (spotDeepId) {
                // Deep link: ?spot=ID → open Trends tab → spot detail view
                window.history.replaceState({}, '', window.location.pathname + window.location.hash);
                setTimeout(async () => {
                    const spotInfo = spots.find(s => s.id === spotDeepId);
                    showPage('history');
                    await loadTrends();
                    if (spotInfo) {
                        await openSpotDetail(spotInfo.id, spotInfo.name, spotInfo.code);
                    }
                }, 400);
            }
        }

        // Sign up
        async function signUp() {
            const email = document.getElementById('signupEmail').value;
            const password = document.getElementById('signupPassword').value;
            const displayName = document.getElementById('signupName').value;
            const signupBtn = document.querySelector('#signupForm .btn');

            if (!email || !password || !displayName) {
                alert('Please fill in all fields');
                return;
            }

            if (password.length < 8) {
                alert('Password must be at least 8 characters');
                return;
            }

            // Show loading state
            signupBtn.disabled = true;
            signupBtn.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;gap:8px;"><div class="spinner-small"></div> Creating account...</div>';

            const { data, error } = await supabaseClient.auth.signUp({
                email,
                password,
                options: {
                    data: { display_name: displayName },
                    emailRedirectTo: window.location.origin + '/app'
                }
            });

            if (error) {
                signupBtn.disabled = false;
                signupBtn.textContent = 'Sign Up';
                alert('Sign up failed: ' + error.message);
            } else {
                // Create profile
                try {
                    await supabaseClient.from('profiles').insert({
                        id: data.user.id,
                        display_name: displayName
                    });
                } catch (e) {
                    console.log('Profile insert note:', e);
                }

                // Phase 5: Log conversion if user arrived via a shared link
                try {
                    const _refRaw = localStorage.getItem('_swimref');
                    if (_refRaw) {
                        const _ref = JSON.parse(_refRaw);
                        // Only count within 7 days of the click
                        if (Date.now() - _ref.ts < 7 * 24 * 60 * 60 * 1000) {
                            await supabaseClient.from('share_conversions').insert({
                                user_id:       data.user.id,
                                ref_type:      _ref.type,
                                ref_target_id: _ref.id,
                            });
                        }
                        localStorage.removeItem('_swimref');
                    }
                } catch (_) {}

                // Check if auto-confirmed (session exists) or needs email verification
                if (data.session) {
                    // Auto-confirmed! Go straight to app
                    currentUser = data.user;
                    signupBtn.innerHTML = 'Welcome aboard!';
                    setTimeout(() => {
                        signupBtn.disabled = false;
                        signupBtn.textContent = 'Sign Up';
                        loadApp();
                    }, 800);
                } else {
                    // Needs email verification - show helpful waiting screen
                    signupBtn.disabled = false;
                    signupBtn.textContent = 'Sign Up';
                    showSignupSuccess(email);
                }
            }
        }

        // Show a helpful email verification waiting screen
        function showSignupSuccess(email) {
            document.getElementById('signupForm').style.display = 'none';
            document.querySelector('.auth-tabs').style.display = 'none';

            let verifyEl = document.getElementById('signupVerifyScreen');
            if (!verifyEl) {
                verifyEl = document.createElement('div');
                verifyEl.id = 'signupVerifyScreen';
                document.querySelector('.auth-card').appendChild(verifyEl);
            }

            verifyEl.style.display = 'block';
            verifyEl.innerHTML = `
                <div style="text-align: center; padding: 10px 0;">
                    <i data-lucide="mail" style="width:48px;height:48px;color:var(--ocean-light);margin-bottom:16px;"></i>
                    <h3 style="color: var(--text-primary); font-size: 20px; margin-bottom: 8px;">Check your email</h3>
                    <p style="color: var(--text-secondary); font-size: 14px; margin-bottom: 24px; line-height: 1.5;">
                        We sent a verification link to<br>
                        <strong style="color: var(--ocean-light);">${email}</strong>
                    </p>

                    <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid var(--border); border-radius: 12px; padding: 16px; text-align: left; margin-bottom: 20px;">
                        <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.8;">
                            <div>Check your inbox</div>
                            <div>Check <strong style="color: var(--text-primary);">Spam / Junk</strong> folder</div>
                            <div>Can take 1-3 minutes to arrive</div>
                            <div>Click the link in the email to verify</div>
                        </div>
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        <button class="btn" id="resendVerifyBtn" onclick="resendVerification('${email}')" style="font-size: 13px;">
                            Resend Verification Email
                        </button>
                        <a href="#" onclick="hideSignupSuccess(); return false;" style="color: var(--text-secondary); font-size: 13px; text-decoration: none;">← Back to Login</a>
                    </div>
                </div>
            `;
            initIcons();
        }

        function hideSignupSuccess() {
            const el = document.getElementById('signupVerifyScreen');
            if (el) el.style.display = 'none';
            document.getElementById('signupForm').style.display = 'none';
            document.getElementById('loginForm').style.display = 'block';
            document.querySelector('.auth-tabs').style.display = 'flex';
            // Activate login tab
            document.querySelectorAll('.auth-tab').forEach((tab, i) => {
                tab.classList.toggle('active', i === 0);
            });
        }

        let verifyCooldown = false;
        async function resendVerification(email) {
            if (verifyCooldown) return;
            const btn = document.getElementById('resendVerifyBtn');
            btn.disabled = true;
            btn.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;gap:8px;"><div class="spinner-small"></div> Sending...</div>';

            const { error } = await supabaseClient.auth.resend({
                type: 'signup',
                email: email,
                options: {
                    emailRedirectTo: window.location.origin + '/app'
                }
            });

            if (error) {
                btn.textContent = 'Error: ' + error.message;
                btn.disabled = false;
                return;
            }

            verifyCooldown = true;
            let seconds = 60;
            btn.textContent = `Sent! Resend in ${seconds}s`;
            const timer = setInterval(() => {
                seconds--;
                btn.textContent = `Resend in ${seconds}s`;
                if (seconds <= 0) {
                    clearInterval(timer);
                    verifyCooldown = false;
                    btn.disabled = false;
                    btn.textContent = 'Resend Verification Email';
                }
            }, 1000);
        }

        // Sign in
        async function signIn() {
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;

            const { data, error } = await supabaseClient.auth.signInWithPassword({
                email,
                password
            });

            if (error) {
                alert('Login failed: ' + error.message);
            } else {
                currentUser = data.user;
                loadApp();
            }
        }

        // Sign out
        async function signOut() {
            hideProfileSettings();
            // Hide prompt + clear the dismissed flag so the next sign-in re-shows it if needed
            document.getElementById('homeDomainPrompt').style.display = 'none';
            sessionStorage.removeItem('homeDomainDismissed');
            await supabaseClient.auth.signOut();
            currentUser = null;
            currentUserProfile = null;
            showAuth();
        }

        // Load domains from DB (replaces hardcoded DOMAINS arrays everywhere)
        async function loadDomains() {
            try {
                const { data, error } = await supabaseClient
                    .from('domains')
                    .select('code, display_name, is_coastal, sort_order')
                    .order('sort_order', { ascending: true });
                if (error) throw error;
                if (data) {
                    domains = data;
                    populateRegionFilter();
                }
            } catch (err) {
                console.error('loadDomains failed:', err);
                // Non-fatal — app still works, dropdowns may be ungrouped
            }
        }

        // Load countries and rebuild the internationalSpotIds Set.
        // Must be called after loadSpots() so the spots array is populated.
        async function loadCountriesAndRebuildIntl() {
            try {
                const { data } = await supabaseClient
                    .from('countries')
                    .select('iso_code, is_domestic');
                if (!data) return;
                const intlCodes = new Set(data.filter(c => !c.is_domestic).map(c => c.iso_code));
                internationalSpotIds = new Set(spots.filter(s => intlCodes.has(s.country_code)).map(s => s.id));
            } catch (err) {
                console.error('loadCountriesAndRebuildIntl failed:', err);
                // Fallback: use hardcoded domain list so the app still works
                internationalSpotIds = new Set(spots.filter(s => INTERNATIONAL_DOMAINS.has(s.domain)).map(s => s.id));
            }
        }

        // ── Custom filter dropdown state ──────────────────────────────────────
        let _fdRegionValue = '';
        let _fdWhenValue   = '';

        function fdToggle(id) {
            const trigger = document.getElementById(id + 'Trigger');
            const panel   = document.getElementById(id + 'Panel');
            if (!trigger || !panel) return;
            const isOpen = panel.classList.contains('fd-open');
            // Close all open panels first
            document.querySelectorAll('.fd-panel.fd-open').forEach(p => p.classList.remove('fd-open'));
            document.querySelectorAll('.fd-trigger.fd-open').forEach(t => t.classList.remove('fd-open'));
            if (!isOpen) {
                panel.classList.add('fd-open');
                trigger.classList.add('fd-open');
            }
        }

        function fdSelect(id, value, label) {
            const trigger = document.getElementById(id + 'Trigger');
            const panel   = document.getElementById(id + 'Panel');
            const labelEl = document.getElementById(id + 'Label');
            if (labelEl) labelEl.textContent = label;
            if (trigger) {
                trigger.classList.remove('fd-open');
                trigger.classList.toggle('fd-active', !!value);
            }
            if (panel) panel.classList.remove('fd-open');
            // Mark selected option
            panel?.querySelectorAll('.fd-option').forEach(o => {
                o.classList.toggle('fd-selected', o.dataset.value === value);
            });
            if (id === 'fdRegion') _fdRegionValue = value;
            if (id === 'fdWhen')   _fdWhenValue   = value;
            loadEvents();
        }

        // For static fd dropdowns — syncs hidden <select>, updates label, marks selection, fires optional callback
        function fdSetSelect(selectId, value, label, fdId, callback) {
            const sel = document.getElementById(selectId);
            if (sel) sel.value = value;
            const labelEl = document.getElementById(fdId + 'Label');
            if (labelEl) labelEl.textContent = label;
            const trigger = document.getElementById(fdId + 'Trigger');
            const panel   = document.getElementById(fdId + 'Panel');
            if (trigger) { trigger.classList.remove('fd-open'); trigger.classList.toggle('fd-active', !!value); }
            if (panel) {
                panel.classList.remove('fd-open');
                panel.querySelectorAll('.fd-option').forEach(o =>
                    o.classList.toggle('fd-selected', o.dataset.value === String(value))
                );
            }
            if (callback) callback();
        }

        // For the dynamic spot dropdown in the create event form
        function fdEventSpotSelect(spotId, spotName) {
            const sel = document.getElementById('eventSpot');
            if (sel) sel.value = spotId;
            const labelEl = document.getElementById('fdEventSpotLabel');
            if (labelEl) { labelEl.textContent = spotName; labelEl.style.color = ''; }
            const trigger = document.getElementById('fdEventSpotTrigger');
            const panel   = document.getElementById('fdEventSpotPanel');
            if (trigger) { trigger.classList.remove('fd-open'); trigger.classList.add('fd-active'); }
            if (panel) {
                panel.classList.remove('fd-open');
                panel.querySelectorAll('.fd-option').forEach(o =>
                    o.classList.toggle('fd-selected', o.dataset.value === String(spotId))
                );
            }
            if (typeof onCreateFormFieldChange === 'function') onCreateFormFieldChange();
        }

        // For the dynamic spot dropdown in the profile home beach field
        function fdProfileBeachSelect(spotId, spotName) {
            const sel = document.getElementById('profileHomeBeach');
            if (sel) sel.value = spotId;
            const labelEl = document.getElementById('fdProfileBeachLabel');
            if (labelEl) {
                if (spotId) { labelEl.textContent = spotName; labelEl.style.color = ''; }
                else { labelEl.textContent = 'Select beach...'; labelEl.style.color = 'var(--text-secondary)'; }
            }
            const trigger = document.getElementById('fdProfileBeachTrigger');
            const panel   = document.getElementById('fdProfileBeachPanel');
            if (trigger) { trigger.classList.remove('fd-open'); trigger.classList.toggle('fd-active', !!spotId); }
            if (panel) {
                panel.classList.remove('fd-open');
                panel.querySelectorAll('.fd-option').forEach(o =>
                    o.classList.toggle('fd-selected', o.dataset.value === String(spotId))
                );
            }
        }

        // Reset all custom fd dropdowns in the create event form to defaults
        function fdResetCreateEventDropdowns() {
            const labelEl = document.getElementById('fdEventSpotLabel');
            if (labelEl) { labelEl.textContent = 'Select location…'; labelEl.style.color = 'var(--text-secondary)'; }
            const spotTrigger = document.getElementById('fdEventSpotTrigger');
            if (spotTrigger) spotTrigger.classList.remove('fd-active', 'fd-open');
            const spotPanel = document.getElementById('fdEventSpotPanel');
            if (spotPanel) { spotPanel.classList.remove('fd-open'); spotPanel.querySelectorAll('.fd-option').forEach(o => o.classList.remove('fd-selected')); }

            const paceLabel = document.getElementById('fdPaceLevelLabel');
            if (paceLabel) paceLabel.textContent = 'Social (2:30/100m)';
            const paceTrigger = document.getElementById('fdPaceLevelTrigger');
            if (paceTrigger) { paceTrigger.classList.remove('fd-open'); paceTrigger.classList.add('fd-active'); }
            const pacePanel = document.getElementById('fdPaceLevelPanel');
            if (pacePanel) {
                pacePanel.classList.remove('fd-open');
                pacePanel.querySelectorAll('.fd-option').forEach(o =>
                    o.classList.toggle('fd-selected', o.dataset.value === '150')
                );
            }

            const recLabel = document.getElementById('fdRecurrenceLabel');
            if (recLabel) recLabel.textContent = 'One-time';
            const recTrigger = document.getElementById('fdRecurrenceTrigger');
            if (recTrigger) { recTrigger.classList.remove('fd-open', 'fd-active'); }
            const recPanel = document.getElementById('fdRecurrencePanel');
            if (recPanel) {
                recPanel.classList.remove('fd-open');
                recPanel.querySelectorAll('.fd-option').forEach(o =>
                    o.classList.toggle('fd-selected', o.dataset.value === '')
                );
            }

            const routeLabel = document.getElementById('fdRouteTypeLabel');
            if (routeLabel) routeLabel.textContent = 'Loop (start/end same)';
            const routeTrigger = document.getElementById('fdRouteTypeTrigger');
            if (routeTrigger) { routeTrigger.classList.remove('fd-open', 'fd-active'); }
            const routePanel = document.getElementById('fdRouteTypePanel');
            if (routePanel) {
                routePanel.classList.remove('fd-open');
                routePanel.querySelectorAll('.fd-option').forEach(o =>
                    o.classList.toggle('fd-selected', o.dataset.value === 'loop')
                );
            }
        }

        // Close dropdowns on outside click
        document.addEventListener('click', e => {
            if (!e.target.closest('.fd-wrap')) {
                document.querySelectorAll('.fd-panel.fd-open').forEach(p => p.classList.remove('fd-open'));
                document.querySelectorAll('.fd-trigger.fd-open').forEach(t => t.classList.remove('fd-open'));
            }
        });

        // Populate the Swims tab Region filter dynamically from loaded domains
        function populateRegionFilter() {
            const panel = document.getElementById('fdRegionPanel');
            if (!panel) return;
            let html = `<div class="fd-option fd-selected" data-value="" onclick="fdSelect('fdRegion','','All Regions')">All Regions</div>`;
            domains.forEach(d => {
                html += `<div class="fd-option" data-value="${d.code}" onclick="fdSelect('fdRegion','${d.code}','${d.display_name}')">${d.display_name}</div>`;
            });
            panel.innerHTML = html;
        }

        // Load spots
        async function loadSpots() {
            const { data, error } = await supabaseClient
                .from('spots')
                .select('*')
                .eq('active', true)
                .order('name', { ascending: true });



            if (data) {
                spots = data;
                populateSpotDropdowns();
                populateMonthFilter();
            }
        }

        // Build grouped spot options using <optgroup> by region
        function buildGroupedSpotOptions(includeAllOption = false) {
            const domainCodes = domains.map(d => d.code);
            let html = includeAllOption ? '<option value="">All Locations</option>' : '';

            domains.forEach(d => {
                const domainSpots = spots.filter(s => s.domain === d.code);
                if (domainSpots.length === 0) return;
                html += `<optgroup label="— ${d.display_name} —">`;
                domainSpots.forEach(spot => {
                    html += `<option value="${spot.id}">${spot.name}</option>`;
                });
                html += '</optgroup>';
            });

            // Any spots with unknown domain
            const ungrouped = spots.filter(s => !domainCodes.includes(s.domain));
            if (ungrouped.length > 0) {
                html += '<optgroup label="Other">';
                ungrouped.forEach(spot => {
                    html += `<option value="${spot.id}">${spot.name}</option>`;
                });
                html += '</optgroup>';
            }

            return html;
        }

        // Populate spot dropdowns with region grouping
        function populateSpotDropdowns() {
            const groupedOptions = buildGroupedSpotOptions(false);
            const groupedOptionsWithAll = buildGroupedSpotOptions(true);

            const selects = document.querySelectorAll('select[data-spots]');
            selects.forEach(select => {
                select.innerHTML = groupedOptions;
            });

            // Also populate history filter
            const historyFilter = document.getElementById('historySpotFilter');
            if (historyFilter) {
                historyFilter.innerHTML = groupedOptionsWithAll;
            }

            // Populate custom fd dropdown panel for profile home beach
            const profileBeachPanel = document.getElementById('fdProfileBeachPanel');
            if (profileBeachPanel) {
                const domainCodes = domains.map(d => d.code);
                let fdHtml = `<div class="fd-option" data-value="" onclick="fdProfileBeachSelect('','Select beach...')">None</div>`;
                domains.forEach(d => {
                    const domainSpots = spots.filter(s => s.domain === d.code);
                    if (domainSpots.length === 0) return;
                    fdHtml += `<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);padding:8px 16px 4px;font-weight:700;pointer-events:none;">— ${d.display_name} —</div>`;
                    domainSpots.forEach(spot => {
                        fdHtml += `<div class="fd-option" data-value="${spot.id}" onclick="fdProfileBeachSelect(${spot.id},'${spot.name.replace(/'/g, "\\'")}')">${spot.name}</div>`;
                    });
                });
                const ungrouped = spots.filter(s => !domainCodes.includes(s.domain));
                if (ungrouped.length > 0) {
                    fdHtml += `<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);padding:8px 16px 4px;font-weight:700;pointer-events:none;">— Other —</div>`;
                    ungrouped.forEach(spot => {
                        fdHtml += `<div class="fd-option" data-value="${spot.id}" onclick="fdProfileBeachSelect(${spot.id},'${spot.name.replace(/'/g, "\\'")}')">${spot.name}</div>`;
                    });
                }
                profileBeachPanel.innerHTML = fdHtml;
            }

            // Populate custom fd dropdown panel for create event form
            const eventSpotPanel = document.getElementById('fdEventSpotPanel');
            if (eventSpotPanel) {
                const domainCodes = domains.map(d => d.code);
                let fdHtml = '';
                domains.forEach(d => {
                    const domainSpots = spots.filter(s => s.domain === d.code);
                    if (domainSpots.length === 0) return;
                    fdHtml += `<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);padding:8px 16px 4px;font-weight:700;pointer-events:none;">— ${d.display_name} —</div>`;
                    domainSpots.forEach(spot => {
                        fdHtml += `<div class="fd-option" data-value="${spot.id}" onclick="fdEventSpotSelect(${spot.id},'${spot.name.replace(/'/g, "\\'")}')">${spot.name}</div>`;
                    });
                });
                const ungrouped = spots.filter(s => !domainCodes.includes(s.domain));
                if (ungrouped.length > 0) {
                    fdHtml += `<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);padding:8px 16px 4px;font-weight:700;pointer-events:none;">— Other —</div>`;
                    ungrouped.forEach(spot => {
                        fdHtml += `<div class="fd-option" data-value="${spot.id}" onclick="fdEventSpotSelect(${spot.id},'${spot.name.replace(/'/g, "\\'")}')">${spot.name}</div>`;
                    });
                }
                eventSpotPanel.innerHTML = fdHtml;
            }
        }

        // Populate the "When" month filter with the next 12 months
        function populateMonthFilter() {
            const panel = document.getElementById('fdWhenPanel');
            if (!panel) return;
            const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            const now = new Date();
            let html = `<div class="fd-option fd-selected" data-value="" onclick="fdSelect('fdWhen','','All upcoming')">All upcoming</div>`;
            for (let i = 0; i < 12; i++) {
                const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
                const val = `${d.getFullYear()}-${d.getMonth() + 1}`;
                const label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
                html += `<div class="fd-option" data-value="${val}" onclick="fdSelect('fdWhen','${val}','${label}')">${label}</div>`;
            }
            panel.innerHTML = html;
        }

        // Attach Spot Lock Handler
        function attachSpotLockHandler() {
            // The picker sets selectedSpotLocked directly via selectSpotFromPicker()
            // Also watch the hidden select for programmatic changes (dashboard auto-select, etc.)
            const spotSelect = document.getElementById('logTempSpotSelect');
            if (spotSelect) {
                spotSelect.removeEventListener('change', handleSpotLock);
                spotSelect.addEventListener('change', handleSpotLock);
            }
        }

        function handleSpotLock() {
            selectedSpotLocked = true;
        }

        // Nav Scroll Handler
        function initNavScroll() {
            const navTabs = document.querySelector('.nav-tabs');
            const navFade = document.querySelector('.nav-fade');

            if (!navTabs || !navFade) return;

            const checkScroll = () => {
                // If scrolled to end (within 5px tolerance), hide fade
                const isAtEnd = navTabs.scrollWidth - navTabs.scrollLeft - navTabs.clientWidth < 5;
                navFade.style.opacity = isAtEnd ? '0' : '1';
            };

            navTabs.removeEventListener('scroll', checkScroll);
            navTabs.addEventListener('scroll', checkScroll);

            // Checks initially
            checkScroll();

            // Also check on resize
            window.addEventListener('resize', checkScroll);
        }

        // Phone normalisation — SA numbers stored as +27XXXXXXXXX, international accepted as-is
        // Accepts: SA 0XXXXXXXXX, +27, 27XXXXXXXXX, any international +CCXXXXXXX, or 7-15 digit local
        function formatSAPhone(raw) {
            if (!raw || !raw.trim()) return null;
            let n = raw.replace(/[\s\-\(\)\.]/g, ''); // strip spaces, dashes, brackets, dots
            // SA normalisation
            if      (/^0\d{9}$/.test(n))        n = '+27' + n.slice(1);
            else if (/^27\d{9}$/.test(n))       n = '+' + n;
            else if (/^\+270\d{9}$/.test(n))    n = '+27' + n.slice(4);
            if (/^\+27\d{9}$/.test(n)) return n;
            // International: any +CC followed by 6-14 digits
            if (/^\+\d{7,15}$/.test(n)) return n;
            // No country code: accept 7-15 digit local numbers as-is
            if (/^\d{7,15}$/.test(n)) return raw.trim();
            return null;
        }

        // Age calculation helper for temps
        function getAgeDisplay(timestamp) {
            const now = new Date();
            const then = new Date(timestamp);
            const diffMs = now - then;
            const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

            if (diffHours < 24) {
                return `${diffHours}h`;
            } else {
                const diffDays = Math.floor(diffHours / 24);
                return `${diffDays}d`;
            }
        }

        // Check if temp is fresh (<=96h)
        function isTempFresh(timestamp) {
            const now = new Date();
            const then = new Date(timestamp);
            const diffMs = now - then;
            const diffHours = diffMs / (1000 * 60 * 60);
            return diffHours <= 96;
        }

        // Helper to parse route from notes (legacy support)
        function parseRouteFromNotes(notes) {
            if (!notes || !notes.startsWith('Route: ')) return { route: null, notes: notes };
            const pipeIndex = notes.indexOf(' | ');
            if (pipeIndex !== -1) {
                return {
                    route: notes.substring(7, pipeIndex).trim(),
                    notes: notes.substring(pipeIndex + 3).trim()
                };
            } else {
                return {
                    route: notes.substring(7).trim(),
                    notes: ''
                };
            }
        }

        // Load dashboard
        async function loadDashboard() {
            loadMonthlyChallengeSummary(); // non-blocking
            loadSpotlightBanner();         // non-blocking
            loadNotifications();           // non-blocking
            loadClubCard();                // non-blocking

            // Populate shared caches in background (used by Trends/Swims tabs and hazard checks)
            (async () => {
                try {
                    const since96h = new Date(Date.now() - 96 * 60 * 60 * 1000).toISOString();
                    const [conditionsResult, eventsResult, latestTempsResult, hazardsResult] = await Promise.all([
                        supabaseClient.from('temp_logs').select('spot_id, conditions, hazards, created_at, temp_c').gte('created_at', since96h).order('created_at', { ascending: false }).limit(200),
                        supabaseClient.from('swim_events').select('location_name, start_at, status').eq('status', 'active').gte('start_at', new Date().toISOString()).limit(50),
                        supabaseClient.from('latest_spot_temps').select('spot_id, spot_name, spot_code, temp_c, updated_at, water_type, domain').order('updated_at', { ascending: false }),
                        supabaseClient.from('hazard_reports').select('spot_id, severity, title, hazard_type, active_until').is('resolved_at', null)
                    ]);
                    conditionsCache = {};
                    (conditionsResult.data || []).forEach(log => {
                        if (!conditionsCache[log.spot_id]) conditionsCache[log.spot_id] = [];
                        conditionsCache[log.spot_id].push(log);
                    });
                    swimEventsCache = eventsResult.data || [];
                    const dashNowMs = Date.now();
                    activeHazardsBySpot = {};
                    for (const h of (hazardsResult.data || [])) {
                        if (h.active_until && new Date(h.active_until).getTime() <= dashNowMs) continue;
                        if (!activeHazardsBySpot[h.spot_id]) activeHazardsBySpot[h.spot_id] = [];
                        activeHazardsBySpot[h.spot_id].push(h);
                    }
                    loadTodayForecast(latestTempsResult.data || []);
                } catch (e) { console.error('Cache fill error:', e); }
            })();

            const conditionColors = { calm: '#10b981', choppy: '#f59e0b', rough: '#ef4444', extreme: '#7c3aed' };

            try {
                // ── Community Stats this week ─────────────────────────────────────────
                const since7dStats = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
                const [newMembersRes, newSpotsRes, weekLogsRes] = await Promise.all([
                    supabaseClient.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', since7dStats),
                    supabaseClient.from('spots').select('*', { count: 'exact', head: true }).gte('created_at', since7dStats),
                    supabaseClient.from('temp_logs').select('*', { count: 'exact', head: true }).gte('created_at', since7dStats)
                ]);

                document.getElementById('dashStats').innerHTML = `
                    <div class="dash-label"><i data-lucide="activity" style="width:13px;height:13px;color:var(--text-secondary);"></i>This week</div>
                    <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px;">
                        <div style="text-align:center; background:rgba(56,189,248,0.08); border-radius:10px; padding:10px 6px; border:1px solid rgba(56,189,248,0.12);">
                            <div style="font-size:22px; font-weight:800; color:var(--ocean-light); line-height:1;">${newMembersRes.count || 0}</div>
                            <div style="font-size:10px; color:var(--text-secondary); margin-top:4px; text-transform:uppercase; letter-spacing:0.5px; font-weight:600;">New Members</div>
                        </div>
                        <div style="text-align:center; background:rgba(16,185,129,0.08); border-radius:10px; padding:10px 6px; border:1px solid rgba(16,185,129,0.12);">
                            <div style="font-size:22px; font-weight:800; color:var(--success); line-height:1;">${newSpotsRes.count || 0}</div>
                            <div style="font-size:10px; color:var(--text-secondary); margin-top:4px; text-transform:uppercase; letter-spacing:0.5px; font-weight:600;">New Spots</div>
                        </div>
                        <div style="text-align:center; background:rgba(245,158,11,0.08); border-radius:10px; padding:10px 6px; border:1px solid rgba(245,158,11,0.12);">
                            <div style="font-size:22px; font-weight:800; color:var(--warning); line-height:1;">${weekLogsRes.count || 0}</div>
                            <div style="font-size:10px; color:var(--text-secondary); margin-top:4px; text-transform:uppercase; letter-spacing:0.5px; font-weight:600;">Logs</div>
                        </div>
                    </div>`;

                // ── Best Spots Right Now (aggregated, last 7 days) ────────────────────
                const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
                const todayMidnight = new Date(); todayMidnight.setHours(0,0,0,0);
                const yesterdayMidnight = new Date(todayMidnight.getTime() - 24*60*60*1000);

                const { data: spotLogs } = await supabaseClient
                    .from('temp_logs')
                    .select('user_id, temp_c, conditions, notes, created_at, spot_id, spots!temp_logs_spot_id_fkey(name, water_type)')
                    .gte('created_at', since7d)
                    .order('created_at', { ascending: false })
                    .limit(200);

                // Aggregate by spot client-side
                const spotMap = {};
                (spotLogs || []).forEach(log => {
                    const sid = log.spot_id;
                    if (!spotMap[sid]) {
                        spotMap[sid] = { name: log.spots?.name || 'Unknown', latestLog: log, todayCount: 0, yesterdayCount: 0, latestWithNote: null };
                    }
                    const t = new Date(log.created_at);
                    if (t >= todayMidnight) spotMap[sid].todayCount++;
                    else if (t >= yesterdayMidnight) spotMap[sid].yesterdayCount++;
                    // Only carry forward a note if it came from TODAY's logs — avoids stale notes
                    // being attributed to today's logger
                    if (!spotMap[sid].latestWithNote && log.notes && new Date(log.created_at) >= todayMidnight) {
                        spotMap[sid].latestWithNote = log;
                    }
                });

                // SA scored section uses top 4 domestic spots only
                const topSpots = Object.values(spotMap)
                    .sort((a,b) => new Date(b.latestLog.created_at) - new Date(a.latestLog.created_at))
                    .slice(0, 4);

                // International spots get their own cut — independent of SA top-4 so they
                // always appear regardless of how many SA spots logged recently.
                // Wider staleness window (30 days) since international loggers are fewer.
                const intlStale30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                const intlSpots = Object.values(spotMap)
                    .filter(s => {
                        const spotInfo = spots.find(sp => sp.id === s.latestLog.spot_id);
                        const isIntl = internationalSpotIds.has(s.latestLog.spot_id) || INTERNATIONAL_DOMAINS.has(spotInfo?.domain);
                        return isIntl && new Date(s.latestLog.created_at) >= intlStale30d;
                    })
                    .sort((a,b) => new Date(b.latestLog.created_at) - new Date(a.latestLog.created_at))
                    .slice(0, 5);

                // Fetch names for latest loggers (SA + international combined)
                const allDisplaySpots = [...topSpots, ...intlSpots];
                const spotUserIds = [...new Set(allDisplaySpots.flatMap(s => [s.latestLog.user_id, s.latestWithNote?.user_id].filter(Boolean)))];
                const { data: spotProfiles } = spotUserIds.length
                    ? await supabaseClient.from('profiles').select('id, display_name').in('id', spotUserIds)
                    : { data: [] };
                const spotNameMap = Object.fromEntries((spotProfiles || []).map(p => [p.id, p.display_name]));

                const recentLogsEl = document.getElementById('dashRecentLogs');
                const recentLogsWrap = document.getElementById('dashRecentLogsWrap');

                if (intlSpots.length === 0) {
                    if (recentLogsWrap) recentLogsWrap.style.display = 'none';
                } else {
                    if (recentLogsWrap) recentLogsWrap.style.display = 'block';
                    // Store share data keyed by spot_id for safe inline onclick access
                    window._spotShareData = window._spotShareData || {};

                    recentLogsEl.innerHTML = intlSpots.map(s => {
                        const log = s.latestLog;
                        const cond = log.conditions?.toLowerCase();
                        const condColor = conditionColors[cond] || '#64748b';
                        const timeAgo = getTimeAgo(new Date(log.created_at));
                        const logCount = s.todayCount > 0
                            ? `${s.todayCount} log${s.todayCount>1?'s':''} today`
                            : s.yesterdayCount > 0 ? `${s.yesterdayCount} log${s.yesterdayCount>1?'s':''} yesterday` : '';
                        const latestUser = spotNameMap[log.user_id] || 'Swimmer';
                        const noteLog = s.latestWithNote;
                        const noteUser = noteLog ? (spotNameMap[noteLog.user_id] || 'Swimmer').split(' ')[0] : null;
                        const rawNote = noteLog?.notes || '';
                        const noteText = rawNote.replace(/\[GPS:[\s\d.,+-]+\]/g, '').trim() || null;

                        // Smart card alerting
                        const notesLower = (noteText || '').toLowerCase();
                        const isRed = cond === 'rough' || cond === 'extreme'
                            || /jell|shark|sewage|danger/.test(notesLower);
                        const isAmber = !isRed && log.temp_c < 12;
                        const cardBg = isRed ? 'rgba(239,68,68,0.08)' : isAmber ? 'rgba(245,158,11,0.08)' : 'rgba(15,23,42,0.5)';
                        const cardBorder = isRed ? 'rgba(239,68,68,0.35)' : isAmber ? 'rgba(245,158,11,0.35)' : 'rgba(56,189,248,0.12)';
                        const tempColor = getDisplayTempColor(log.temp_c, log.spots?.water_type);

                        // Stash share data so the inline button can access it safely
                        window._spotShareData[log.spot_id] = { name: s.name, temp: log.temp_c, cond, noteUser, noteText, logCount };

                        // International spot detection — gold accent treatment
                        // Domain-code fallback ensures treatment applies even before
                        // loadCountriesAndRebuildIntl() resolves (async timing).
                        const spotInfo2 = spots.find(sp => sp.id === log.spot_id);
                        const isIntl = internationalSpotIds.has(log.spot_id) || INTERNATIONAL_DOMAINS.has(spotInfo2?.domain);
                        const countryCode = spotInfo2?.country_code || '';
                        const countryLabel = isIntl && countryCode && COUNTRY_NAMES[countryCode]
                            ? ` <span style="font-size:12px;font-weight:500;color:#d97706;">(${COUNTRY_NAMES[countryCode]})</span>` : '';
                        const intlBorder = isIntl ? 'border-left:3px solid #d97706;' : '';
                        const intlGlobe = isIntl ? `<i data-lucide="globe" style="width:12px;height:12px;color:#d97706;flex-shrink:0;" title="International"></i>` : '';

                        return `
                        <div style="background:${isIntl ? 'rgba(217,119,6,0.06)' : cardBg}; border:1px solid ${isIntl ? 'rgba(217,119,6,0.35)' : cardBorder}; border-radius:12px; padding:14px; margin-bottom:8px;${intlBorder}">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                                <div style="font-weight:700; color:var(--text-primary); font-size:15px; display:flex; align-items:center; gap:5px;">${s.name}${countryLabel}${intlGlobe}</div>
                                <div style="font-size:22px; font-weight:800; color:${tempColor}; line-height:1;">${log.temp_c}°C</div>
                            </div>
                            <div style="margin-top:7px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                                ${cond ? `<span style="background:${condColor}20; color:${condColor}; border:1px solid ${condColor}40; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; text-transform:capitalize;">${cond}</span>` : ''}
                                <span style="font-size:12px; color:var(--text-secondary);">${timeAgo}</span>
                                ${logCount ? `<span style="font-size:12px; color:var(--text-secondary);">· ${logCount}</span>` : ''}
                            </div>
                            <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:6px;">
                                <div style="font-size:12px; color:var(--text-secondary); font-style:${noteText ? 'italic' : 'normal'}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0;">
                                    ${noteText ? `${noteUser}: "${noteText}"` : latestUser}
                                </div>
                                <button onclick="shareSpotConditions('${log.spot_id}')"
                                    style="flex-shrink:0; margin-left:10px; padding:5px 10px; background:#25d36622; border:1px solid #25d36655; border-radius:8px; color:#25d366; font-size:11px; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:5px; white-space:nowrap;">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="#25d366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                                    Share
                                </button>
                            </div>
                        </div>`;
                    }).join('');
                }

                // ── Coming Up ─────────────────────────────────────────────────────────
                const { data: nextSwims } = await supabaseClient
                    .from('swim_events')
                    .select('id, title, location_name, start_at')
                    .gte('start_at', new Date().toISOString())
                    .neq('status', 'cancelled')
                    .order('start_at', { ascending: true })
                    .limit(1);

                const nextSwim = nextSwims?.[0];
                const comingUpEl = document.getElementById('dashComingUp');
                if (nextSwim) {
                    const d = new Date(nextSwim.start_at);
                    const isToday = d.toDateString() === new Date().toDateString();
                    const dateStr = isToday ? 'Today' : d.toLocaleDateString('en-ZA', { weekday: 'short', month: 'short', day: 'numeric' });
                    const timeStr = d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
                    comingUpEl.style.display = 'block';
                    comingUpEl.innerHTML = `
                        <div style="font-weight:700; color:var(--text-primary); font-size:16px; margin-bottom:10px;">Coming Up</div>
                        <div style="background:rgba(15,23,42,0.5); border:1px solid rgba(56,189,248,0.2); border-radius:14px; padding:14px 16px;">
                            <div style="font-weight:700; font-size:15px; color:var(--text-primary); margin-bottom:4px;">${nextSwim.title}</div>
                            <div style="font-size:13px; color:var(--text-secondary); margin-bottom:10px;">
                                <i data-lucide="map-pin" style="width:13px;height:13px;vertical-align:middle;"></i> ${nextSwim.location_name}
                                &nbsp;·&nbsp;
                                <i data-lucide="clock" style="width:13px;height:13px;vertical-align:middle;"></i> ${dateStr} at ${timeStr}
                            </div>
                            <div style="display:flex; gap:8px;">
                                <button class="btn" onclick="viewEventDetails('${nextSwim.id}')" style="flex:1; padding:8px; font-size:13px; background:rgba(56,189,248,0.12); color:var(--ocean-light); border:1px solid rgba(56,189,248,0.25);">Details</button>
                                <button class="btn" onclick="showPage('events')" style="flex:1; padding:8px; font-size:13px; background:linear-gradient(135deg,#0284c7,#0ea5e9); color:white; border:none;">I'm Going</button>
                            </div>
                        </div>`;
                } else {
                    comingUpEl.style.display = 'none';
                }

                initIcons();

            } catch (err) {
                console.error('loadDashboard error:', err);
            }
        }

        async function loadTodayForecast(latestTemps) {
            try {
                const today = new Date().toISOString().split('T')[0];
                const [windRes, marineRes] = await Promise.all([
                    fetch(`https://api.open-meteo.com/v1/forecast?latitude=-34.2269&longitude=18.4648&daily=wind_speed_10m_max,wind_direction_10m_dominant&wind_speed_unit=kmh&timezone=Africa%2FJohannesburg&start_date=${today}&end_date=${today}`),
                    fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=-34.2269&longitude=18.4648&daily=wave_height_max,swell_wave_height_max&timezone=Africa%2FJohannesburg&start_date=${today}&end_date=${today}`)
                ]);
                if (!windRes.ok || !marineRes.ok) return;
                const wind = await windRes.json();
                const marine = await marineRes.json();
                const wSpd = wind?.daily?.wind_speed_10m_max?.[0];
                const wDeg = wind?.daily?.wind_direction_10m_dominant?.[0];
                const wvH  = marine?.daily?.wave_height_max?.[0];
                const swH  = marine?.daily?.swell_wave_height_max?.[0];
                if (wSpd == null || wDeg == null) return;
                todayForecast = {
                    windSpeed:    Math.round(wSpd),
                    windDeg:      wDeg,
                    windDirText:  windDirLabel(wDeg),
                    waveHeight:   wvH  != null ? Math.round(wvH  * 10) / 10 : null,
                    swellHeight:  swH  != null ? Math.round(swH  * 10) / 10 : null
                };
                // Re-render Best Spots with forecast-adjusted scores
                renderBestSpots(latestTemps, conditionsCache, swimEventsCache);
            } catch (e) {
                console.warn('Forecast fetch failed (non-fatal):', e);
            }
        }

        function renderDashConditions(logs) {
            document.getElementById('dashConditions').innerHTML = `
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
                    ${logs.map(log => {
                const color = log.temp_c < 10 ? '#6366f1' : log.temp_c < 12 ? '#3b82f6' : log.temp_c < 16 ? '#06b6d4' : log.temp_c < 20 ? '#10b981' : log.temp_c < 24 ? '#f59e0b' : log.temp_c < 28 ? '#f97316' : '#ef4444';
                const age = getAgeDisplay(log.created_at);
                const isFresh = isTempFresh(log.created_at);
                const spotInfo = spots.find(s => s.id === log.spot_id);
                const spotCode = spotInfo ? spotInfo.code : '';

                // Conditions + hazards — use log directly (fetched with select('*'), has all fields)
                const cond           = log.conditions;
                const logHazards     = Array.isArray(log.hazards) ? log.hazards : [];

                // Serious = red dot warning; notable = info pill shown on card
                const SERIOUS   = ['shark', 'sewage'];
                const NOTABLE   = ['jellyfish', 'fireweed', 'seals', 'strong current'];
                const PILL_CFG  = {
                    fireweed:         { label: 'Fireweed',        color: '#fb923c' },
                    jellyfish:        { label: 'Jellyfish',       color: '#60a5fa' },
                    seals:            { label: 'Seals',           color: '#94a3b8' },
                    'strong current': { label: 'Strong Current',  color: '#f59e0b' },
                    shark:            { label: 'Shark',           color: '#ef4444' },
                    sewage:           { label: 'Sewage',          color: '#ef4444' },
                };
                const seriousHazards = logHazards.filter(h => SERIOUS.includes(h));
                const sightings      = logHazards.filter(h => NOTABLE.includes(h));
                const hasDanger      = seriousHazards.length > 0 || (activeHazardsBySpot[log.spot_id]?.length > 0);

                const condColor  = cond === 'extreme' ? '#ef4444' : cond === 'rough' ? '#f97316' : '#f59e0b';
                const condBadge  = (cond && cond !== 'calm')
                    ? `<div style="font-size:9px;font-weight:700;color:${condColor};margin-top:3px;letter-spacing:.05em;">${cond.toUpperCase()}</div>`
                    : '';
                // Hazard pill badges — info pills for notable, red dot for serious
                const sightingBadge = sightings.length > 0
                    ? `<div style="display:flex;flex-wrap:wrap;gap:3px;justify-content:center;margin-top:4px;">${
                        sightings.map(h => {
                            const cfg = PILL_CFG[h] || { label: h, color: '#94a3b8' };
                            return `<span style="font-size:8px;font-weight:700;color:${cfg.color};background:${cfg.color}22;padding:2px 5px;border-radius:4px;letter-spacing:0.3px;">${cfg.label.toUpperCase()}</span>`;
                        }).join('')
                    }</div>`
                    : '';
                const hazardDot = hasDanger
                    ? `<div style="position:absolute;top:7px;right:8px;width:8px;height:8px;border-radius:50%;background:#ef4444;box-shadow:0 0 4px #ef4444;" title="${seriousHazards.join(', ')}"></div>`
                    : '';

                return `
                                <div onclick="goToSpotTrend('${log.spot_id}', '${(log.spotName || 'Unknown').replace(/'/g, "\\'")}', '${spotCode}')" style="position:relative;cursor: pointer; background: rgba(15, 23, 42, 0.6); border-radius: 14px; padding: 14px; text-align: center; border: 1px solid ${hasDanger ? 'rgba(239,68,68,0.35)' : color + '20'}; ${!isFresh ? 'opacity: 0.5;' : ''} transition: all 0.2s ease;">
                                    ${hazardDot}
                                    <div style="font-size: 28px; font-weight: 800; color: ${color}; text-shadow: 0 0 20px ${color}30; line-height: 1.1;">${log.temp_c}°</div>
                                    <div style="font-size: 10px; font-weight: 500; color: ${color}; opacity: 0.7; margin-top: 2px;">${age}</div>
                                    <div style="font-size: 11px; color: var(--text-secondary); margin-top: 6px; font-weight: 600;">${log.spotName || 'Unknown'}</div>
                                    ${condBadge}
                                    ${sightingBadge}
                                    <div style="font-size: 10px; color: var(--text-secondary); opacity: 0.5; margin-top: 2px;">${getTimeAgo(new Date(log.created_at))}</div>
                                    <div style="font-size: 9px; color: var(--ocean-light); margin-top: 4px; opacity: 0.6;">tap for trends →</div>
                                </div>
                            `;
            }).join('')}
                </div>
            `;
            initIcons();
        }

        // ==========================================
        // SWIM SCORE INTELLIGENCE
        // ==========================================

        function calculateSwimScore(spot, recentLogs, upcomingSwims, forecast = null) {
            // spot: row from latest_spot_temps { spot_id, spot_name, temp_c, updated_at, water_type }
            // recentLogs: array of temp_logs for this spot (last 96h, desc by created_at)
            // upcomingSwims: array of swim_events (active, future)
            // forecast: optional { windSpeed, windDeg, waveHeight, swellHeight } from Open-Meteo
            // Returns: { score, label, emoji, color }

            const now = Date.now();
            const ageHours = (now - new Date(spot.updated_at).getTime()) / 3600000;

            // -- Freshness (35pts) --
            let freshness = 0;
            if (ageHours < 6)       freshness = 35;
            else if (ageHours < 24) freshness = 25;
            else if (ageHours < 96) freshness = 12;
            else                    freshness = 0;

            // -- Conditions (35pts) -- from most recent log
            const mostRecentLog = recentLogs && recentLogs[0];
            let conditions = 15; // neutral default
            if (mostRecentLog && (now - new Date(mostRecentLog.created_at).getTime()) < 96 * 3600000) {
                const c = (mostRecentLog.conditions || '').toLowerCase().trim();
                if (c === 'calm')          conditions = 35;
                else if (c === 'choppy')   conditions = 22;
                else if (c === 'rough')    conditions = 8;
                else if (c === 'extreme')  conditions = 0;
                else                       conditions = 15;
            }

            // -- Temperature (20pts) -- Cape Town ocean ranges
            let temp = 15; // neutral for non-ocean types
            const isOceanType = ['OCEAN', 'TIDAL_POOL'].includes(spot.water_type);
            if (isOceanType && spot.temp_c != null) {
                const t = spot.temp_c;
                if (t >= 16 && t <= 22)      temp = 20;
                else if (t >= 14 && t < 16)  temp = 15;
                else if (t >= 12 && t < 14)  temp = 10;
                else if (t < 12)             temp = 5;
                else if (t > 22 && t <= 24)  temp = 16;
                else                         temp = 12; // >24
            }

            // -- Hazard penalty — frequency-weighted across recent logs + notes scanning --
            // Checks ALL recent logs (not just the latest) and scans free-text notes for keywords.
            // If 4/5 logs mention fireweed, the penalty scales up to reflect the real picture.
            let hazardPenalty = 0;
            const logsToScan = (recentLogs || []).slice(0, 10);
            const logCount   = Math.max(logsToScan.length, 1);

            const HAZARD_CFG = [
                { keywords: ['shark'],                                                        base: 30 },
                { keywords: ['sewage', 'sewerage', 'pollution'],                              base: 20 },
                { keywords: ['strong current', 'rip current', 'rip'],                        base: 18 },
                { keywords: ['jellyfish', 'jelly', 'bluebottle', 'fireweed',
                             'fire weed', 'stings', 'stinging', 'sea lice'],                 base: 22 },
                { keywords: ['seal'],                                                         base: 3  },
            ];

            for (const cfg of HAZARD_CFG) {
                let hitCount = 0;
                for (const log of logsToScan) {
                    const hazStr  = (Array.isArray(log.hazards) ? log.hazards.join(' ') : '').toLowerCase();
                    const noteStr = (log.notes || '').toLowerCase();
                    if (cfg.keywords.some(kw => (hazStr + ' ' + noteStr).includes(kw))) hitCount++;
                }
                if (hitCount === 0) continue;
                // Frequency multiplier: isolated report = 0.5×, majority = 1.3×, overwhelming = 1.6×
                const freq       = hitCount / logCount;
                const multiplier = freq >= 0.75 ? 1.6 : freq >= 0.5 ? 1.3 : freq >= 0.25 ? 1.0 : 0.5;
                hazardPenalty   += Math.round(cfg.base * multiplier);
            }
            hazardPenalty = Math.min(hazardPenalty, 50); // cap so single spot doesn't go below 0

            // -- Activity bonus (up to +10) --
            const spotNameNorm = (spot.spot_name || '').trim().toLowerCase();
            const sevenDaysFromNow = now + 7 * 24 * 3600000;
            const matchingSwims = (upcomingSwims || []).filter(e => {
                if (!e.start_at || new Date(e.start_at).getTime() > sevenDaysFromNow) return false;
                const locNorm = (e.location_name || '').trim().toLowerCase();
                return locNorm.includes(spotNameNorm) || spotNameNorm.includes(locNorm);
            });
            const activityBonus = matchingSwims.length >= 2 ? 10 : matchingSwims.length === 1 ? 5 : 0;

            // -- Forecast adjustments (wind + swell) --
            let forecastAdj = 0;
            if (forecast) {
                const spd = forecast.windSpeed || 0;
                const deg = forecast.windDeg   || 0;
                const wvH = forecast.waveHeight || 0;
                // Wind penalty
                if (spd > 40)      forecastAdj -= 25;
                else if (spd > 30) forecastAdj -= 15;
                else if (spd > 20) forecastAdj -= 5;
                // NW wind bonus — cleans up Cape Town conditions, drives False Bay current
                const isNW = (deg >= 270 && deg <= 360) || deg <= 45;
                if (isNW && spd < 20) forecastAdj += 8;
                // Swell penalty
                if (wvH > 2.5)      forecastAdj -= 20;
                else if (wvH > 1.5) forecastAdj -= 10;
            }

            // -- Final score --
            const raw = freshness + conditions + temp - hazardPenalty + activityBonus + forecastAdj;

            // Temperature cap — cold water cannot score "Great" regardless of freshness/conditions
            let scoreCap = 100;
            if (isOceanType && spot.temp_c != null) {
                const t = spot.temp_c;
                if (t < 14)       scoreCap = 49;  // Cold (< 14°C) → max "Fair"
                else if (t < 16)  scoreCap = 74;  // Cool (14–15.9°C) → max "Good"
                // ≥ 16°C: no cap — full range available
            }
            const score = Math.max(0, Math.min(scoreCap, Math.round(raw)));

            // -- Band --
            let label, emoji, color;
            if (score >= 75)      { label = 'Great'; emoji = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#10b981;vertical-align:middle;flex-shrink:0;"></span>'; color = '#10b981'; }
            else if (score >= 50) { label = 'Good';  emoji = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f59e0b;vertical-align:middle;flex-shrink:0;"></span>'; color = '#f59e0b'; }
            else if (score >= 25) { label = 'Fair';  emoji = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#f97316;vertical-align:middle;flex-shrink:0;"></span>'; color = '#f97316'; }
            else                  { label = 'Rough'; emoji = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#ef4444;vertical-align:middle;flex-shrink:0;"></span>'; color = '#ef4444'; }

            return { score, label, emoji, color };
        }

        function swimScoreBadgeHtml(s) {
            if (!s) return '';
            return `<div style="font-size:10px;font-weight:700;color:${s.color};text-align:right;margin-top:2px;">${s.emoji} ${s.label}</div>`;
        }

        function renderBestSpots(latestTemps, condBySpot, upcomingSwims) {
            const el = document.getElementById('dashBestSpots');
            if (!el) return;

            if (!latestTemps || latestTemps.length === 0) {
                el.innerHTML = `<div style="text-align:center;padding:16px;color:var(--text-secondary);font-size:13px;">No recent data available</div>`;
                return;
            }

            // Score every spot — ocean/coastal only for "Best Spots" recommendations
            const OCEAN_TYPES = ['OCEAN', 'TIDAL_POOL', 'LAGOON'];
            const scored = latestTemps
                .filter(spot => OCEAN_TYPES.includes(spot.water_type) &&
                    !internationalSpotIds.has(spot.spot_id) &&
                    !INTERNATIONAL_DOMAINS.has(spot.domain))
                .map(spot => {
                    const recentLogs = condBySpot[spot.spot_id] || [];
                    const swimScore = calculateSwimScore(spot, recentLogs, upcomingSwims, todayForecast);
                    return { ...spot, swimScore };
                });

            // Sort by score desc, tiebreak by freshness
            const top3 = scored
                .sort((a, b) => {
                    if (b.swimScore.score !== a.swimScore.score) return b.swimScore.score - a.swimScore.score;
                    return new Date(b.updated_at) - new Date(a.updated_at);
                })
                .slice(0, 3);

            // Check if any data is fresh enough to be meaningful
            const hasFreshData = top3.some(s => (Date.now() - new Date(s.updated_at).getTime()) < 96 * 3600000);
            if (!hasFreshData) {
                el.innerHTML = `<div style="text-align:center;padding:16px;color:var(--text-secondary);font-size:13px;">No recent conditions logged</div>`;
                return;
            }

            // Wind indicator — only shown when forecast is available
            const windLine = todayForecast
                ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${todayForecast.windDirText} ${todayForecast.windSpeed} km/h${todayForecast.waveHeight != null ? ' · ' + todayForecast.waveHeight + 'm' : ''}</div>`
                : '';

            // Use profile map built during temp-card fetch (shared via window._dashProfileMap)
            const bestSpotsProfileMap = window._dashProfileMap || {};

            el.innerHTML = top3.map((spot, i) => {
                const { score, label, emoji, color } = spot.swimScore;
                const spotInfo = spots.find(s => s.id === spot.spot_id);
                const spotCode = spotInfo ? spotInfo.code : (spot.spot_code || '');
                const ageHours = (Date.now() - new Date(spot.updated_at).getTime()) / 3600000;
                const ageText = ageHours < 1 ? 'just now'
                    : ageHours < 24 ? `${Math.round(ageHours)}h ago`
                    : `${Math.round(ageHours / 24)}d ago`;
                const spotNameSafe = (spot.spot_name || '').replace(/'/g, "\\'");
                const spotHazards = activeHazardsBySpot[spot.spot_id] || [];
                const hazardBanner = spotHazards.length > 0
                    ? `<div style="margin-top:8px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);border-radius:6px;padding:4px 8px;font-size:11px;font-weight:600;color:#ef4444;">${spotHazards[0].title}</div>`
                    : '';

                const logs = condBySpot[spot.spot_id] || [];
                const recentLogHazards = logs[0]?.hazards || [];
                const hasLogHazard = recentLogHazards.some(h => ['shark', 'sewage'].includes(h));

                const latestLog = logs[0];
                const loggerProfile = latestLog?.user_id ? bestSpotsProfileMap[latestLog.user_id] : null;
                const loggerName = loggerProfile?.display_name || null;
                const byLine = loggerName
                    ? `<span> · by ${loggerName}</span>`
                    : '';

                const borderColor = spotHazards.length > 0 ? '#ef4444' : color;

                return `
                    <div onclick="goToSpotTrend('${spot.spot_id}', '${spotNameSafe}', '${spotCode}')"
                         class="bs-card" style="border-left-color:${borderColor};">
                        <div style="display:flex;align-items:center;gap:12px;">
                            <div style="flex:1;min-width:0;">
                                <div style="font-weight:700;color:var(--text-primary);font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${spot.spot_name}</div>
                                ${windLine}
                                <div style="font-size:11px;color:var(--text-secondary);margin-top:3px;display:flex;align-items:center;gap:3px;">
                                    <i data-lucide="clock" style="width:10px;height:10px;flex-shrink:0;"></i>${ageText}${byLine}
                                </div>
                            </div>
                            <div style="text-align:right;flex-shrink:0;">
                                <div class="bs-temp" style="color:${getDisplayTempColor(spot.temp_c, spot.water_type)};">${spot.temp_c}°C${hasLogHazard ? ' <i data-lucide="alert-triangle" style="width:12px;height:12px;color:#ef4444;vertical-align:middle;" title="' + recentLogHazards.join(', ') + '"></i>' : ''}</div>
                                <div style="display:flex;align-items:center;justify-content:flex-end;gap:3px;margin-top:3px;">
                                    ${emoji}
                                    <span style="font-size:11px;font-weight:700;color:${color};">${label}</span>
                                </div>
                            </div>
                        </div>
                        ${hazardBanner}
                    </div>
                `;
            }).join('');
        }

        async function goToSpotTrend(spotId, spotName, spotCode) {
            // Navigate to trends page
            showPage('history');
            // Wait for trends to load, then drill into the spot
            await new Promise(resolve => setTimeout(resolve, 500));
            // If trendsData isn't populated yet, wait a bit more
            let retries = 0;
            while (!trendsData || Object.keys(trendsData).length === 0) {
                if (retries > 10) break;
                await new Promise(resolve => setTimeout(resolve, 300));
                retries++;
            }
            openSpotDetail(spotId, spotName, spotCode);
        }

        // History view state
        let historyView = 'my'; // 'my' or 'community'
        let tempChart = null;

        // Toggle history view
        function toggleHistoryView(el, view) {
            historyView = view;
            el.parentElement.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
            el.classList.add('active');
            loadHistory();
        }

        // Load history and trends
        async function loadHistory() {
            const spotFilter = document.getElementById('historySpotFilter').value;

            try {
                // First, try simple query without joins
                let query = supabaseClient
                    .from('temp_logs')
                    .select('*')
                    .order('created_at', { ascending: false })
                    .limit(50);

                // Filter by user if "My Logs" is selected
                if (historyView === 'my') {
                    query = query.eq('user_id', currentUser.id);
                }

                // Filter by spot if selected
                if (spotFilter) {
                    query = query.eq('spot_id', spotFilter);
                }

                const { data: logs, error } = await query;

                if (error) {
                    console.error('Error loading history:', error);
                    console.error('Error details:', JSON.stringify(error, null, 2));
                    document.getElementById('historyList').innerHTML =
                        `<div style="color: var(--danger); text-align: center; padding: 20px;">
                            Error loading history<br>
                            <small style="font-size: 11px;">${error.message || 'Unknown error'}</small>
                        </div>`;
                    return;
                }

                console.log('Loaded logs:', logs);

                // Now load spot and profile data separately
                if (logs && logs.length > 0) {
                    const spotIds = [...new Set(logs.map(l => l.spot_id).filter(Boolean))];
                    const userIds = [...new Set(logs.map(l => l.user_id).filter(Boolean))];

                    // Load spots
                    const { data: spotsData } = await supabaseClient
                        .from('spots')
                        .select('id, name')
                        .in('id', spotIds);

                    // Load profiles
                    const { data: profilesData } = await supabaseClient
                        .from('profiles')
                        .select('id, display_name')
                        .in('id', userIds);

                    // Create lookup maps
                    const spotMap = {};
                    const profileMap = {};

                    if (spotsData) spotsData.forEach(s => spotMap[s.id] = s);
                    if (profilesData) profilesData.forEach(p => profileMap[p.id] = p);

                    // Attach to logs
                    logs.forEach(log => {
                        log.spots = spotMap[log.spot_id] || null;
                        log.profiles = profileMap[log.user_id] || null;
                    });
                }

                // Render list
                renderHistoryList(logs);

                // Render chart
                renderTempChart(logs);
            } catch (err) {
                console.error('Caught error:', err);
                document.getElementById('historyList').innerHTML =
                    `<div style="color: var(--danger); text-align: center; padding: 20px;">
                        Unexpected error<br>
                        <small style="font-size: 11px;">${err.message}</small>
                    </div>`;
            }
        }

        // Render history list
        function renderHistoryList(logs) {
            const container = document.getElementById('historyList');

            if (!logs || logs.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; color: var(--text-secondary); padding: 20px;">
                        No temperature logs yet. Be the first to log!
                    </div>
                `;
                return;
            }

            // Group by spot to get latest per spot
            const bySpot = {};
            logs.forEach(log => {
                if (!bySpot[log.spot_id]) {
                    bySpot[log.spot_id] = log;
                }
            });

            const allSpots = Object.values(bySpot);

            // Separate fresh (<=96h) and stale (>96h)
            const freshTemps = allSpots.filter(log => isTempFresh(log.created_at));
            const staleTemps = allSpots.filter(log => !isTempFresh(log.created_at));

            let html = '';

            // Fresh temps section
            if (freshTemps.length > 0) {
                html += freshTemps.map(log => {
                    const date = new Date(log.created_at);
                    const timeAgo = getTimeAgo(date);
                    const age = getAgeDisplay(log.created_at);
                    const spotName = log.spots?.name || 'Unknown';
                    const userName = log.profiles?.display_name || 'Anonymous';

                    return `
                    <div style="background: rgba(15, 23, 42, 0.6); border: 2px solid rgba(56, 189, 248, 0.2); border-radius: 12px; padding: 16px; margin-bottom: 12px;">
                        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                            <div>
                                <div style="font-size: 18px; font-weight: 600; color: ${getTempColor(log.temp_c)};">
                                    ${log.temp_c}°C <span style="font-size: 12px; font-weight: 400; color: var(--text-secondary);">${age}</span>
                                </div>
                                <div style="font-size: 13px; color: var(--text-secondary);">
                                    <i data-lucide="map-pin" style="width: 14px; height: 14px; vertical-align: middle;"></i> ${spotName}
                                </div>
                            </div>
                            <div style="text-align: right;">
                                <div style="font-size: 12px; color: var(--text-secondary);">
                                    ${timeAgo}
                                </div>
                                <div style="font-size: 12px; color: var(--text-secondary);">
                                    ${userName}
                                </div>
                            </div>
                        </div>
                        ${log.conditions ? `
                            <div style="display: inline-block; background: rgba(56, 189, 248, 0.2); padding: 4px 10px; border-radius: 6px; font-size: 11px; margin-right: 6px; margin-top: 6px;">
                                ${log.conditions}
                            </div>
                        ` : ''}
                        ${log.hazards && log.hazards.length > 0 ? log.hazards.map(h => `
                            <div style="display: inline-block; background: rgba(245, 158, 11, 0.2); padding: 4px 10px; border-radius: 6px; font-size: 11px; margin-right: 6px; margin-top: 6px;">
                                ${h}
                            </div>
                        `).join('') : ''}
                        ${log.notes ? `
                            <div style="margin-top: 10px; font-size: 13px; color: var(--text-secondary); font-style: italic;">
                                "${log.notes}"
                            </div>
                        ` : ''}
                    </div>
                `;
                }).join('');
            }

            // Stale temps section (collapsible)
            if (staleTemps.length > 0) {
                html += `
                    <div style="margin-top: 24px; border-top: 1px solid var(--border); padding-top: 16px;">
                        <div onclick="toggleStaleTemps()" style="cursor: pointer; display: flex; justify-content: space-between; align-items: center; padding: 12px; background: rgba(15, 23, 42, 0.4); border-radius: 8px; margin-bottom: 12px;">
                            <div style="font-size: 14px; font-weight: 600; color: var(--text-secondary);">
                                <i data-lucide="clock" style="width: 14px; height: 14px; vertical-align: middle;"></i> Stale Temperatures (${staleTemps.length})
                            </div>
                            <i id="staleToggleIcon" data-lucide="chevron-down" style="width: 16px; height: 16px;"></i>
                        </div>
                        <div id="staleTempsContainer" style="display: none;">
                            ${staleTemps.map(log => {
                    const date = new Date(log.created_at);
                    const timeAgo = getTimeAgo(date);
                    const age = getAgeDisplay(log.created_at);
                    const spotName = log.spots?.name || 'Unknown';
                    const userName = log.profiles?.display_name || 'Anonymous';

                    return `
                                    <div style="background: rgba(15, 23, 42, 0.4); border: 2px solid rgba(56, 189, 248, 0.1); border-radius: 12px; padding: 16px; margin-bottom: 12px; opacity: 0.6;">
                                        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                                            <div>
                                                <div style="font-size: 18px; font-weight: 600; color: var(--ocean-light);">
                                                    ${log.temp_c}°C <span style="font-size: 12px; font-weight: 400; color: var(--text-secondary);">${age}</span>
                                                </div>
                                                <div style="font-size: 13px; color: var(--text-secondary);">
                                                    <i data-lucide="map-pin" style="width: 14px; height: 14px; vertical-align: middle;"></i> ${spotName}
                                                </div>
                                            </div>
                                            <div style="text-align: right;">
                                                <div style="font-size: 12px; color: var(--text-secondary);">
                                                    ${timeAgo}
                                                </div>
                                                <div style="font-size: 12px; color: var(--text-secondary);">
                                                    ${userName}
                                                </div>
                                            </div>
                                        </div>
                                        ${log.conditions ? `
                                            <div style="display: inline-block; background: rgba(56, 189, 248, 0.1); padding: 4px 10px; border-radius: 6px; font-size: 11px; margin-right: 6px; margin-top: 6px;">
                                                ${log.conditions}
                                            </div>
                                        ` : ''}
                                        ${log.hazards && log.hazards.length > 0 ? log.hazards.map(h => `
                                            <div style="display: inline-block; background: rgba(245, 158, 11, 0.1); padding: 4px 10px; border-radius: 6px; font-size: 11px; margin-right: 6px; margin-top: 6px;">
                                                ${h}
                                            </div>
                                        `).join('') : ''}
                                        ${log.notes ? `
                                            <div style="margin-top: 10px; font-size: 13px; color: var(--text-secondary); font-style: italic;">
                                                "${log.notes}"
                                            </div>
                                        ` : ''}
                                    </div>
                                `;
                }).join('')}
                        </div>
                    </div>
                `;
            }

            container.innerHTML = html;
            initIcons();
        }

        // Toggle stale temps visibility
        function toggleStaleTemps() {
            const container = document.getElementById('staleTempsContainer');
            const icon = document.getElementById('staleToggleIcon');
            if (container.style.display === 'none') {
                container.style.display = 'block';
                icon.setAttribute('data-lucide', 'chevron-up');
            } else {
                container.style.display = 'none';
                icon.setAttribute('data-lucide', 'chevron-down');
            }
            initIcons();
        }

        // Render temperature chart
        function renderTempChart(logs) {
            const ctx = document.getElementById('tempChart');

            if (!logs || logs.length === 0) {
                ctx.style.display = 'none';
                return;
            }

            ctx.style.display = 'block';

            // Prepare data (reverse to show oldest to newest)
            const reversedLogs = [...logs].reverse();
            const labels = reversedLogs.map(log => {
                const date = new Date(log.created_at);
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            });
            const temps = reversedLogs.map(log => log.temp_c);

            // Destroy existing chart
            if (tempChart) {
                tempChart.destroy();
            }

            // Create new chart
            tempChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Water Temperature (°C)',
                        data: temps,
                        borderColor: '#38bdf8',
                        backgroundColor: 'rgba(56, 189, 248, 0.1)',
                        borderWidth: 3,
                        tension: 0.4,
                        fill: true,
                        pointBackgroundColor: '#38bdf8',
                        pointBorderColor: '#0c4a6e',
                        pointBorderWidth: 2,
                        pointRadius: 5,
                        pointHoverRadius: 7
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: {
                            display: false
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: false,
                            grid: {
                                color: 'rgba(56, 189, 248, 0.1)'
                            },
                            ticks: {
                                color: '#94a3b8',
                                callback: function (value) {
                                    return value + '°C';
                                }
                            }
                        },
                        x: {
                            grid: {
                                color: 'rgba(56, 189, 248, 0.1)'
                            },
                            ticks: {
                                color: '#94a3b8'
                            }
                        }
                    }
                }
            });
        }

        // Helper: Get time ago string
        function getTimeAgo(date) {
            const seconds = Math.floor((new Date() - date) / 1000);

            if (seconds < 60) return 'Just now';
            if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
            if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
            if (seconds < 604800) return Math.floor(seconds / 86400) + 'd ago';

            return date.toLocaleDateString();
        }

        // ========== SWIM EVENTS ==========

        // ══════════════════════════════════════════════════════════════════
        // "I'M SWIMMING" — lightweight swim posts
        // ══════════════════════════════════════════════════════════════════

        let _swimPostDateTime = null;  // ISO string of selected swim time
        let _editingSwimPostId = null; // null = new post, string = editing existing

        function showImSwimming(editPayload) {
            _swimPostDateTime = null;
            _editingSwimPostId = editPayload?.id || null;

            // Populate spot dropdown — same grouped options as every other spot picker
            const sel = document.getElementById('swimPostSpot');
            sel.innerHTML = buildGroupedSpotOptions(false);

            if (editPayload) {
                // Pre-fill for editing
                if (editPayload.spotId) sel.value = editPayload.spotId;
                document.getElementById('swimPostNote').value = editPayload.note || '';
                // Show current time in custom picker
                if (editPayload.swimDt) {
                    const d = new Date(editPayload.swimDt);
                    // Format for datetime-local input: YYYY-MM-DDTHH:MM
                    const pad = n => String(n).padStart(2, '0');
                    document.getElementById('swimPostCustomTime').value =
                        `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                    _swimPostDateTime = editPayload.swimDt;
                }
                document.getElementById('swimCustomTimeWrap').style.display = 'block';
                document.getElementById('swimPostBtn').textContent = 'Update';
                _buildSwimWhenButtons(true); // show quick-select but don't auto-select any
            } else {
                // New post
                if (gpsSuggestedSpotId) sel.value = gpsSuggestedSpotId;
                document.getElementById('swimPostNote').value = '';
                document.getElementById('swimPostCustomTime').value = '';
                document.getElementById('swimCustomTimeWrap').style.display = 'none';
                document.getElementById('swimPostBtn').textContent = 'Post';
                _buildSwimWhenButtons(false);
            }

            document.getElementById('imSwimmingModal').style.display = 'flex';
            initIcons();
        }

        function hideImSwimming() {
            _editingSwimPostId = null;
            document.getElementById('imSwimmingModal').style.display = 'none';
        }

        function editSwimPost(postId) {
            const d = (window._swimCardShareData || {})[postId];
            if (!d) return;
            showImSwimming({ id: postId, spotId: d.spotId, swimDt: d.swimDt, note: d.note });
        }

        function _buildSwimWhenButtons(editMode = false) {
            const now = new Date();
            const options = [];

            // In 1 hour — round up to nearest 15 min
            const inHour = new Date(now.getTime() + 60 * 60 * 1000);
            const mins = inHour.getMinutes();
            const roundedMins = mins === 0 ? 0 : Math.ceil(mins / 15) * 15;
            if (roundedMins === 60) { inHour.setHours(inHour.getHours() + 1, 0, 0, 0); }
            else { inHour.setMinutes(roundedMins, 0, 0); }
            options.push({ label: 'In 1 hour', dt: inHour });

            // This afternoon (5pm) — only if it's before 4pm
            if (now.getHours() < 16) {
                const afternoon = new Date(now);
                afternoon.setHours(17, 0, 0, 0);
                options.push({ label: 'This afternoon (5pm)', dt: afternoon });
            }

            // Tomorrow morning (7am) — always
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(7, 0, 0, 0);
            options.push({ label: 'Tomorrow morning (7am)', dt: tomorrow });

            // Custom
            options.push({ label: 'Custom time', dt: null });

            document.getElementById('swimWhenBtns').innerHTML = options.map((opt, i) => `
                <button id="swimWhenBtn_${i}" onclick="_selectSwimWhen(${i})"
                    data-dt="${opt.dt ? opt.dt.toISOString() : ''}"
                    style="padding:8px 14px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer;
                        border:1px solid rgba(56,189,248,0.3); background:rgba(56,189,248,0.07);
                        color:var(--text-primary); white-space:nowrap;">
                    ${opt.label}
                </button>`).join('');
        }

        function _selectSwimWhen(idx) {
            document.querySelectorAll('#swimWhenBtns button').forEach((b, i) => {
                const active = i === idx;
                b.style.background = active ? 'rgba(56,189,248,0.22)' : 'rgba(56,189,248,0.07)';
                b.style.borderColor = active ? 'var(--ocean-light)' : 'rgba(56,189,248,0.3)';
                b.style.color = active ? 'var(--ocean-light)' : 'var(--text-primary)';
            });
            const btn = document.getElementById(`swimWhenBtn_${idx}`);
            const dtStr = btn?.dataset?.dt;
            if (dtStr) {
                _swimPostDateTime = dtStr;
                document.getElementById('swimCustomTimeWrap').style.display = 'none';
            } else {
                _swimPostDateTime = null;
                document.getElementById('swimCustomTimeWrap').style.display = 'block';
                document.getElementById('swimPostCustomTime').focus();
            }
        }

        async function postImSwimming() {
            const btn = document.getElementById('swimPostBtn');
            const spotId = document.getElementById('swimPostSpot').value;
            const note = document.getElementById('swimPostNote').value.trim();

            // Resolve datetime
            let swimDt = _swimPostDateTime
                ? new Date(_swimPostDateTime)
                : document.getElementById('swimPostCustomTime').value
                    ? new Date(document.getElementById('swimPostCustomTime').value)
                    : null;

            if (!spotId) { showToast('Please select a location', 'error'); return; }
            if (!swimDt || isNaN(swimDt.getTime())) {
                showToast('Please select when you\'re swimming', 'error'); return;
            }
            if (swimDt <= new Date()) {
                showToast('Pick a time in the future', 'error'); return;
            }

            const expiresAt = new Date(swimDt.getTime() + 24 * 60 * 60 * 1000);
            const spotName = document.getElementById('swimPostSpot').options[document.getElementById('swimPostSpot').selectedIndex]?.text || 'the spot';

            btn.disabled = true;
            btn.textContent = _editingSwimPostId ? 'Updating...' : 'Posting...';

            let error;

            if (_editingSwimPostId) {
                // ── Update existing post ──
                ({ error } = await supabaseClient.from('swimming_posts')
                    .update({
                        spot_id: spotId,
                        swim_datetime: swimDt.toISOString(),
                        notes: note || null,
                        expires_at: expiresAt.toISOString(),
                    })
                    .eq('id', _editingSwimPostId)
                    .eq('user_id', currentUser.id));
            } else {
                // ── Spam check only for new posts ──
                const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
                const { count } = await supabaseClient
                    .from('swimming_posts')
                    .select('*', { count: 'exact', head: true })
                    .eq('user_id', currentUser.id)
                    .gte('created_at', dayStart.toISOString());
                if ((count || 0) >= 5) {
                    btn.disabled = false;
                    btn.textContent = 'Post';
                    showToast("You've posted 5 swims today. Focus on swimming!", 'info');
                    return;
                }
                // ── Insert new post ──
                ({ error } = await supabaseClient.from('swimming_posts').insert({
                    user_id: currentUser.id,
                    spot_id: spotId,
                    swim_datetime: swimDt.toISOString(),
                    notes: note || null,
                    expires_at: expiresAt.toISOString(),
                }));
            }

            btn.disabled = false;
            btn.textContent = _editingSwimPostId ? 'Update' : 'Post';

            if (error) {
                console.error('swimming_posts error:', error);
                showToast('Error saving — try again', 'error');
                return;
            }

            const wasEditing = !!_editingSwimPostId;
            hideImSwimming();
            loadSwimmingPosts();
            if (wasEditing) {
                showToast('Swim updated ✓', 'success');
            } else {
                showSwimPostShare(spotName, swimDt.toISOString(), note);
                // Broadcast push to subscribers at this location
                const swimSpot = spots.find(s => s.id === spotId);
                if (swimSpot?.domain) {
                    broadcastPush(swimSpot.domain, 'swim', 'SwimLoading',
                        `A swim has been posted at ${spotName} — check conditions`);
                }
            }
        }

        async function loadSwimmingPosts() {
            const feedEl = document.getElementById('swimPostsFeed');
            if (!feedEl) return;

            const now = new Date().toISOString();
            const cutoff48h = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

            // Fetch posts — NO FK hints, no join (avoids PostgREST hint issues on new table)
            // Show all non-expired posts within 48h window, including ones happening right now
            const { data: posts, error } = await supabaseClient
                .from('swimming_posts')
                .select('id, user_id, swim_datetime, notes, spot_id, created_at')
                .gt('expires_at', now)               // still active (within 2h of swim time)
                .lte('swim_datetime', cutoff48h)      // not more than 48h away
                .order('swim_datetime', { ascending: true })
                .limit(20);

            if (error) { console.error('loadSwimmingPosts error:', error); feedEl.style.display = 'none'; return; }

            const allPosts = posts || [];
            if (allPosts.length === 0) { feedEl.style.display = 'none'; return; }

            // Fetch spots separately
            const spotIds = [...new Set(allPosts.map(p => p.spot_id).filter(Boolean))];
            const { data: spotsData } = spotIds.length
                ? await supabaseClient.from('spots').select('id, name, domain').in('id', spotIds)
                : { data: [] };
            const spotMap = Object.fromEntries((spotsData || []).map(s => [s.id, s]));

            // Fetch display names from profiles separately
            const userIds = [...new Set(allPosts.map(p => p.user_id))];
            const { data: profilesData } = userIds.length
                ? await supabaseClient.from('profiles').select('id, display_name').in('id', userIds)
                : { data: [] };
            const profileMap = Object.fromEntries((profilesData || []).map(p => [p.id, p.display_name]));

            // Fetch all interests in one query
            const postIds = allPosts.map(p => p.id);
            const { data: interests } = await supabaseClient
                .from('swimming_post_interest')
                .select('post_id, user_id, interest_type')
                .in('post_id', postIds);

            const iMap = {};
            (interests || []).forEach(i => {
                if (!iMap[i.post_id]) iMap[i.post_id] = { joins: 0, maybes: 0, myType: null };
                if (i.interest_type === 'join') iMap[i.post_id].joins++;
                else iMap[i.post_id].maybes++;
                if (i.user_id === currentUser?.id) iMap[i.post_id].myType = i.interest_type;
            });

            const display = allPosts.slice(0, 5);
            const hasMore = allPosts.length > 5;

            feedEl.style.display = 'block';
            feedEl.innerHTML = `
                <div style="font-weight:700; color:var(--text-primary); font-size:15px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:baseline;">
                    <span>Who's Swimming Soon</span>
                    ${hasMore ? `<a onclick="loadAllSwimmingPosts()" style="font-size:12px; color:var(--ocean-light); cursor:pointer;">View all ${allPosts.length} →</a>` : ''}
                </div>
                ${display.map(p => _renderSwimPostCard(p, spotMap, profileMap, iMap[p.id] || { joins: 0, maybes: 0, myType: null })).join('')}
                <div style="height:1px; background:rgba(56,189,248,0.1); margin-bottom:16px;"></div>
            `;
            initIcons();
        }

        function _renderSwimPostCard(post, spotMap, profileMap, interest) {
            const name = profileMap[post.user_id] || 'Swimmer';
            const initials = name.split(' ').map(w => w[0] || '').join('').toUpperCase().slice(0, 2) || '?';
            const spotName = spotMap[post.spot_id]?.name || 'Unknown spot';
            const dt = new Date(post.swim_datetime);
            const todayStr = new Date().toDateString();
            const tomorrowStr = new Date(Date.now() + 86400000).toDateString();
            const dayLabel = dt.toDateString() === todayStr ? 'Today'
                : dt.toDateString() === tomorrowStr ? 'Tomorrow'
                : dt.toLocaleDateString('en-ZA', { weekday: 'short', month: 'short', day: 'numeric' });
            const timeLabel = dt.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
            const isMe = post.user_id === currentUser?.id;
            const joinActive = interest.myType === 'join';
            const maybeActive = interest.myType === 'maybe';

            // Stash data for share button (avoids unsafe inline string escaping)
            window._swimCardShareData = window._swimCardShareData || {};
            window._swimCardShareData[post.id] = { name, spotName, swimDt: post.swim_datetime, note: post.notes };

            return `
            <div style="background:rgba(15,23,42,0.5); border:1px solid rgba(56,189,248,0.12); border-radius:12px; padding:14px; margin-bottom:10px;">
                <div style="display:flex; gap:12px; align-items:flex-start;">
                    <div style="width:38px; height:38px; border-radius:50%; background:linear-gradient(135deg,#059669,#10b981); display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; color:white; flex-shrink:0;">${initials}</div>
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:700; font-size:14px; color:var(--text-primary); display:flex; align-items:center; gap:6px;">
                            ${name} is swimming
                            ${isMe ? `<button onclick="editSwimPost('${post.id}')" title="Edit post" style="background:none; border:none; color:var(--ocean-light); cursor:pointer; font-size:11px; opacity:0.7; line-height:1; padding:0; margin-left:auto;">Edit</button>
                             <button onclick="deleteSwimPost('${post.id}')" title="Remove post" style="background:none; border:none; color:var(--text-secondary); cursor:pointer; font-size:11px; opacity:0.5; line-height:1; padding:0;">✕</button>` : ''}
                        </div>
                        <div style="font-size:13px; color:var(--text-secondary); margin-top:3px; display:flex; align-items:center; gap:4px; flex-wrap:wrap;">
                            <i data-lucide="map-pin" style="width:12px;height:12px;flex-shrink:0;"></i> ${spotName}
                            <span style="color:rgba(100,116,139,0.5);">·</span>
                            <i data-lucide="clock" style="width:12px;height:12px;flex-shrink:0;"></i> ${dayLabel} • ${timeLabel}
                        </div>
                        ${post.notes ? `<div style="margin-top:5px; font-size:12px; color:var(--text-secondary); font-style:italic;">"${post.notes}"</div>` : ''}
                    </div>
                </div>
                <div style="display:flex; gap:8px; align-items:center; margin-top:12px;">
                    <button onclick="toggleSwimInterest('${post.id}','join')"
                        style="padding:7px 14px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer;
                            border:1px solid ${joinActive ? '#0ea5e9' : 'rgba(56,189,248,0.3)'};
                            background:${joinActive ? 'rgba(14,165,233,0.18)' : 'rgba(56,189,248,0.06)'};
                            color:${joinActive ? 'var(--ocean-light)' : 'var(--text-secondary)'};">
                        ${joinActive ? '✓ Joining' : 'Join'}
                    </button>
                    <button onclick="toggleSwimInterest('${post.id}','maybe')"
                        style="padding:7px 14px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer;
                            border:1px solid ${maybeActive ? 'rgba(56,189,248,0.5)' : 'rgba(56,189,248,0.18)'};
                            background:transparent;
                            color:${maybeActive ? 'var(--ocean-light)' : 'var(--text-secondary)'};">
                        ${maybeActive ? '✓ Maybe' : 'Maybe'}
                    </button>
                    ${interest.joins > 0 ? `<span style="font-size:12px; color:var(--text-secondary); margin-left:2px;">${interest.joins} joining</span>` : ''}
                    <button onclick="shareSwimPostCard('${post.id}')"
                        style="margin-left:auto; padding:7px 12px; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer;
                            background:#25d36618; border:1px solid #25d36650; color:#25d366;
                            display:flex; align-items:center; gap:5px;">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="#25d366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                        Share
                    </button>
                </div>
            </div>`;
        }

        async function toggleSwimInterest(postId, interestType) {
            if (!currentUser) return;

            // Check current state from DB (small, fast query)
            const { data: existing } = await supabaseClient
                .from('swimming_post_interest')
                .select('interest_type')
                .eq('post_id', postId)
                .eq('user_id', currentUser.id)
                .maybeSingle();

            if (existing?.interest_type === interestType) {
                // Same button tapped again → remove interest (toggle off)
                await supabaseClient.from('swimming_post_interest')
                    .delete()
                    .eq('post_id', postId)
                    .eq('user_id', currentUser.id);
            } else {
                // New or switched interest → upsert
                await supabaseClient.from('swimming_post_interest').upsert({
                    post_id: postId,
                    user_id: currentUser.id,
                    interest_type: interestType,
                }, { onConflict: 'post_id,user_id' });
            }

            loadSwimmingPosts(); // re-render with fresh counts
        }

        async function deleteSwimPost(postId) {
            if (!confirm('Remove your swim post?')) return;
            const { error } = await supabaseClient.from('swimming_posts')
                .delete()
                .eq('id', postId)
                .eq('user_id', currentUser.id);
            if (!error) loadSwimmingPosts();
        }

        function loadAllSwimmingPosts() {
            showToast('Showing top 5 — full list coming soon', 'info');
        }

        // ── Swim post WhatsApp share ──────────────────────────────────────────
        let _swimPostShareMsg = '';

        function showSwimPostShare(spotName, swimDt, note) {
            const dt = new Date(swimDt);
            const todayStr = new Date().toDateString();
            const tomorrowStr = new Date(Date.now() + 86400000).toDateString();
            const dayLabel = dt.toDateString() === todayStr ? 'today'
                : dt.toDateString() === tomorrowStr ? 'tomorrow'
                : dt.toLocaleDateString('en-ZA', { weekday: 'long', month: 'short', day: 'numeric' });
            const timeLabel = dt.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });

            document.getElementById('swimPostShareTitle').textContent = `${spotName} — ${dayLabel} at ${timeLabel}`;
            _swimPostShareMsg = `I'm swimming at ${spotName} — ${dayLabel} at ${timeLabel}${note ? '\n"' + note + '"' : ''}\n\nCome join me! SwimLoading — swimloading.com/app`;
            document.getElementById('swimPostShareMessage').textContent = _swimPostShareMsg;
            document.getElementById('swimPostShareModal').style.display = 'flex';
        }

        function dismissSwimPostShare() {
            document.getElementById('swimPostShareModal').style.display = 'none';
        }

        function swimPostShareWhatsApp() {
            window.open(`https://wa.me/?text=${encodeURIComponent(_swimPostShareMsg)}`, '_blank');
            dismissSwimPostShare();
        }

        // Share button on a feed card (for other users sharing someone else's post)
        function shareSwimPostCard(postId) {
            const d = (window._swimCardShareData || {})[postId];
            if (!d) return;
            const dt = new Date(d.swimDt);
            const todayStr = new Date().toDateString();
            const tomorrowStr = new Date(Date.now() + 86400000).toDateString();
            const dayLabel = dt.toDateString() === todayStr ? 'today'
                : dt.toDateString() === tomorrowStr ? 'tomorrow'
                : dt.toLocaleDateString('en-ZA', { weekday: 'long', month: 'short', day: 'numeric' });
            const timeLabel = dt.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
            const msg = `${d.name} is swimming at ${d.spotName} — ${dayLabel} at ${timeLabel}${d.note ? '\n"' + d.note + '"' : ''}\n\nJoin on SwimLoading — swimloading.com/app`;
            window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
        }

        // ══════════════════════════════════════════════════════════════════
        // Show/hide create event modal
        function showCreateEvent() {
            // Default to 08:00 AM today
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            document.getElementById('eventDateTime').value = `${year}-${month}-${day}T08:00`;

            document.getElementById('createEventModal').style.display = 'block';
        }

        function hideCreateEvent() {
            document.getElementById('createEventModal').style.display = 'none';
            document.getElementById('createEventForm').reset();
            // Clear overlap warning
            const overlapEl = document.getElementById('swimOverlapWarning');
            if (overlapEl) { overlapEl.style.display = 'none'; overlapEl.innerHTML = ''; }
            // Reset recurrence fields
            const endGroup = document.getElementById('recurrenceEndGroup');
            if (endGroup) endGroup.style.display = 'none';
            const previewEl = document.getElementById('recurrencePreview');
            if (previewEl) previewEl.style.display = 'none';
            // Reset distance mode back to single
            const singleGroup = document.getElementById('singleDistanceGroup');
            const multiGroup  = document.getElementById('multiDistanceGroup');
            if (singleGroup) { singleGroup.style.display = 'block'; singleGroup.querySelector('input').required = true; }
            if (multiGroup)  multiGroup.style.display = 'none';
            resetRaceDistances();
            // Reset swim type to Group Swim
            const sel = document.getElementById('eventCategory');
            if (sel) sel.value = 'group_swim';
            const titleEl = document.getElementById('createModalTitle');
            if (titleEl) titleEl.textContent = 'Organise a Group Swim';
            const submitBtn = document.getElementById('createSubmitBtn');
            if (submitBtn) submitBtn.textContent = 'Create Swim';
            const groupBtn = document.getElementById('typeGroupSwimBtn');
            const raceBtn  = document.getElementById('typeRaceBtn');
            if (groupBtn) { groupBtn.style.borderColor = 'var(--ocean-blue)'; groupBtn.style.background = 'rgba(2,132,199,0.15)'; }
            if (raceBtn)  { raceBtn.style.borderColor  = 'rgba(56,189,248,0.15)'; raceBtn.style.background = 'rgba(15,23,42,0.6)'; }
            const posterGroup = document.getElementById('posterUploadGroup');
            if (posterGroup) posterGroup.style.display = 'none';
            // Reset custom fd dropdowns
            fdResetCreateEventDropdowns();
        }

        // ========== SUGGEST A SPOT ==========

        function showSuggestSpot() {
            document.getElementById('suggestSpotModal').style.display = 'block';
            document.getElementById('suggestSpotForm').reset();
            document.getElementById('submitSuggestBtn').disabled = false;
            document.getElementById('submitSuggestBtn').textContent = 'Submit Suggestion';
        }

        function hideSuggestSpot() {
            document.getElementById('suggestSpotModal').style.display = 'none';
        }

        async function submitSpotSuggestion(e) {
            e.preventDefault();

            const btn = document.getElementById('submitSuggestBtn');
            btn.disabled = true;
            btn.textContent = 'Submitting...';

            const name = document.getElementById('suggestSpotName').value.trim();
            const type = document.getElementById('suggestSpotType').value;
            const region = document.getElementById('suggestSpotRegion').value.trim();
            const description = document.getElementById('suggestSpotDescription').value.trim();

            if (description.length < 20) {
                showToast('Please provide a longer description (20+ characters)', 'error');
                btn.disabled = false;
                btn.textContent = 'Submit Suggestion';
                return;
            }

            const { error } = await supabaseClient
                .from('spot_suggestions')
                .insert({
                    user_id: currentUser.id,
                    spot_name: name,
                    water_type: type,
                    region: region || null,
                    description: description
                });

            if (error) {
                if (error.message.includes('row-level security') || error.code === '42501') {
                    showToast('You already have 3 pending suggestions. Wait for review.', 'error');
                } else {
                    showToast('Error submitting suggestion: ' + error.message, 'error');
                }
                btn.disabled = false;
                btn.textContent = 'Submit Suggestion';
                return;
            }

            showToast('Spot suggestion submitted! We\'ll review it soon.', 'success');
            hideSuggestSpot();
        }

        function clearEventFilter() {
            fdSelect('fdRegion', '', 'All Regions');
            fdSelect('fdWhen',   '', 'All upcoming');
        }

        // Load events
        async function loadEvents() {
            loadSwimmingPosts(); // non-blocking — loads "Who's Swimming Soon" feed in parallel
            try {
                console.log('Loading events...');

                // Populate activeHazardsBySpot so getHazardsForEvent() works on the Swims tab
                // (loadDashboard fills this on the dashboard tab, but loadEvents runs standalone)
                try {
                    const { data: allHazardsForEvents } = await supabaseClient
                        .from('hazard_reports')
                        .select('spot_id, severity, title, hazard_type, active_until')
                        .is('resolved_at', null);
                    // Filter expired ones in JS to avoid PostgREST .or() timestamp issues
                    const evNow = Date.now();
                    const activeHazardsForEvents = (allHazardsForEvents || []).filter(h =>
                        !h.active_until || new Date(h.active_until).getTime() > evNow
                    );
                    activeHazardsBySpot = {};
                    for (const h of activeHazardsForEvents) {
                        if (!activeHazardsBySpot[h.spot_id]) activeHazardsBySpot[h.spot_id] = [];
                        activeHazardsBySpot[h.spot_id].push(h);
                    }
                } catch (hazErr) {
                    console.warn('Could not load hazards for events tab:', hazErr);
                }

                // Query swim_events + public club_events in parallel
                const nowIso = new Date().toISOString();
                const [{ data: events, error }, { data: clubEventsRaw }] = await Promise.all([
                    supabaseClient
                        .from('swim_events')
                        .select('*')
                        .gte('start_at', nowIso)
                        .order('start_at', { ascending: true })
                        .limit(50),
                    supabaseClient
                        .from('club_events')
                        .select('*, clubs(id, name, code, slug, logo_url, domain)')
                        .eq('is_public', true)
                        .eq('is_active', true)
                        .gte('event_date', nowIso.slice(0, 10))
                        .order('event_date', { ascending: true })
                        .limit(30),
                ]);

                // Normalise public club events to match swim_events shape
                const clubEventsNormalised = (clubEventsRaw || []).map(ce => ({
                    id:              'club::' + ce.id,   // prefix to distinguish
                    _isClubEvent:    true,
                    _club:           ce.clubs,
                    _clubEventId:    ce.id,
                    _allowsDayOf:    ce.allows_day_entries,
                    _isLeague:       ce.is_league,
                    title:           ce.title,
                    location_name:   ce.title,
                    description:     ce.description,
                    start_at:        ce.event_date + (ce.start_time ? 'T' + ce.start_time : 'T07:00:00'),
                    status:          'active',
                    domain:          ce.clubs?.domain || null,
                    spot_id:         null,
                    max_participants: ce.entry_cap || null,
                    created_by:      ce.created_by,
                }));

                console.log('Events query result:', { events, error });

                if (error) {
                    console.error('Error loading events:', error);
                    document.getElementById('eventsList').innerHTML =
                        `<div style="color: var(--danger); text-align: center; padding: 20px;">
                            Error loading events<br>
                            <small style="font-size: 11px;">${error.message || JSON.stringify(error)}</small>
                        </div>`;
                    return;
                }

                // Merge swim_events + public club events, sort by date
                const now = new Date();
                const swimEventsFiltered = (events || []).filter(e => new Date(e.start_at) >= now);
                let upcomingEvents = [...swimEventsFiltered, ...clubEventsNormalised]
                    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));

                // Apply region + month filters
                const selectedRegion = _fdRegionValue;
                const selectedMonth  = _fdWhenValue;

                // Show/hide clear link
                const clearLink = document.getElementById('clearEventFilter');
                if (clearLink) clearLink.style.display = (selectedRegion || selectedMonth) ? 'inline' : 'none';

                if (selectedRegion) {
                    upcomingEvents = upcomingEvents.filter(e => {
                        const spot = spots.find(s => s.id === e.spot_id);
                        return spot && spot.domain === selectedRegion;
                    });
                }

                if (selectedMonth) {
                    const [filterYear, filterMon] = selectedMonth.split('-').map(Number);
                    upcomingEvents = upcomingEvents.filter(e => {
                        const d = new Date(e.start_at);
                        return d.getFullYear() === filterYear && (d.getMonth() + 1) === filterMon;
                    });
                }

                // Sort cancelled swims to the bottom
                upcomingEvents.sort((a, b) => {
                    if (a.status === 'cancelled' && b.status !== 'cancelled') return 1;
                    if (a.status !== 'cancelled' && b.status === 'cancelled') return -1;
                    return 0;
                });

                // For recurring series — show only the next upcoming instance, not all of them
                const seriesSeen = new Set();
                upcomingEvents = upcomingEvents.filter(e => {
                    if (!e.recurrence_series_id) return true;               // one-time: always show
                    if (seriesSeen.has(e.recurrence_series_id)) return false; // subsequent: skip
                    seriesSeen.add(e.recurrence_series_id);
                    return true;                                              // first of series: show
                });

                console.log('Upcoming events:', upcomingEvents);

                // If no events, show empty state
                if (!upcomingEvents || upcomingEvents.length === 0) {
                    const hasFilter = !!(selectedRegion || selectedMonth);
                    document.getElementById('eventsList').innerHTML = `
                        <div style="text-align: center; color: var(--text-secondary); padding: 40px 20px;">
                            <div style="font-size: 48px; margin-bottom: 16px;"><i data-lucide="waves" style="width: 48px; height: 48px;"></i></div>
                            <div style="font-size: 16px; margin-bottom: 8px;">${hasFilter ? 'No swims for this location yet' : 'No upcoming swims'}</div>
                            <div style="font-size: 13px; margin-bottom: 20px;">${hasFilter ? 'Create a new swim or clear the filter.' : 'Be the first to create one!'}</div>
                            ${hasFilter ? '<button class="btn btn-secondary" onclick="clearEventFilter()" style="width: auto; padding: 10px 20px;">Clear Filter</button>' : ''}
                        </div>
                    `;
                    return;
                }

                console.log('Successfully loaded events:', upcomingEvents);

                // Load creator profiles
                const creatorIds = [...new Set(upcomingEvents.map(e => e.created_by).filter(Boolean))];
                const { data: profilesData } = await supabaseClient
                    .from('profiles')
                    .select('id, display_name')
                    .in('id', creatorIds);

                const profileMap = {};
                if (profilesData) profilesData.forEach(p => profileMap[p.id] = p);

                console.log('Profile map:', profileMap);
                console.log('Creator IDs needed:', creatorIds);

                // Only pass real swim_event IDs to participant queries (not club:: prefixed)
                const realEventIds = upcomingEvents.filter(e => !e._isClubEvent).map(e => e.id);

                // Load user's status for these events (swim_events only)
                const { data: userStatuses } = await supabaseClient
                    .from('swim_participants')
                    .select('swim_event_id, status, needs_reconfirm')
                    .eq('user_id', currentUser.id)
                    .in('swim_event_id', realEventIds.length ? realEventIds : ['00000000-0000-0000-0000-000000000000']);

                const statusMap = {};
                const reconfirmMap = {};
                if (userStatuses) userStatuses.forEach(r => {
                    statusMap[r.swim_event_id] = r.status;
                    reconfirmMap[r.swim_event_id] = r.needs_reconfirm;
                });

                // Load participant counts for these events
                const { data: counts } = await supabaseClient
                    .from('swim_participants')
                    .select('swim_event_id, status')
                    .in('swim_event_id', realEventIds.length ? realEventIds : ['00000000-0000-0000-0000-000000000000']);

                const countMap = {};
                if (counts) {
                    counts.forEach(c => {
                        if (!countMap[c.swim_event_id]) countMap[c.swim_event_id] = { confirmed: 0, pending: 0 };
                        if (c.status === 'approved') countMap[c.swim_event_id].confirmed++;
                        if (c.status === 'requested') countMap[c.swim_event_id].pending++;
                    });
                }

                // Show events with your actual data structure
                const html = upcomingEvents.map(event => {
                    // ── Club event — simplified card ─────────────────────────────
                    if (event._isClubEvent) {
                        const club = event._club;
                        const eventDate = new Date(event.start_at);
                        const dateStr = eventDate.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' });
                        const timeStr = eventDate.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
                        return `
                        <div style="background:var(--card-bg);border:1px solid rgba(56,189,248,0.15);border-radius:16px;padding:16px;margin-bottom:12px;position:relative;overflow:hidden;">
                            <div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,rgba(56,189,248,0.6),transparent);"></div>
                            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                                ${club?.logo_url ? `<img src="${club.logo_url}" style="height:20px;width:auto;object-fit:contain;opacity:0.85;">` : ''}
                                <span style="font-size:10px;font-weight:800;color:var(--ocean-light);text-transform:uppercase;letter-spacing:0.1em;">${club?.name || 'Club Event'}</span>
                                ${event._isLeague ? `<span style="font-size:9px;font-weight:800;background:rgba(251,191,36,0.12);color:#fbbf24;border:1px solid rgba(251,191,36,0.3);padding:2px 7px;border-radius:4px;text-transform:uppercase;letter-spacing:0.08em;">League</span>` : ''}
                            </div>
                            <div style="font-size:15px;font-weight:700;color:var(--text-primary);margin-bottom:6px;">${event.title}</div>
                            <div style="display:flex;flex-wrap:wrap;gap:12px;font-size:12px;color:var(--text-secondary);margin-bottom:12px;">
                                <span style="display:flex;align-items:center;gap:4px;"><i data-lucide="calendar" style="width:12px;height:12px;"></i>${dateStr}</span>
                                <span style="display:flex;align-items:center;gap:4px;"><i data-lucide="clock" style="width:12px;height:12px;"></i>${timeStr}</span>
                                ${event.max_participants ? `<span style="display:flex;align-items:center;gap:4px;"><i data-lucide="users" style="width:12px;height:12px;"></i>Cap: ${event.max_participants}</span>` : ''}
                            </div>
                            ${event.description ? `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px;line-height:1.5;">${event.description}</div>` : ''}
                            <div style="display:flex;gap:8px;">
                                <a href="/clubs/${club?.slug || ''}" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.2);border-radius:10px;padding:9px 14px;font-size:12px;font-weight:700;color:var(--ocean-light);text-decoration:none;">
                                    <i data-lucide="external-link" style="width:12px;height:12px;"></i>View on club page
                                </a>
                                ${event._allowsDayOf ? `<div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--success);font-weight:600;padding:0 4px;"><i data-lucide="check-circle" style="width:12px;height:12px;"></i>Open — day-of entry</div>` : `<div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text-secondary);font-weight:600;padding:0 4px;"><i data-lucide="lock" style="width:12px;height:12px;"></i>Members only</div>`}
                            </div>
                        </div>`;
                    }

                    // ── Standard swim_event card ──────────────────────────────────
                    const eventDate = new Date(event.start_at);
                    const dateStr = eventDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                    const timeStr = eventDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                    const creatorName = profileMap[event.created_by]?.display_name || 'Anonymous';
                    const userStatus = statusMap[event.id];
                    const userNeedsReconfirm = reconfirmMap[event.id];
                    const isCancelled = event.status === 'cancelled';

                    // Participant counts
                    const confirmed = countMap[event.id]?.confirmed || 0;
                    const pending = countMap[event.id]?.pending || 0;
                    const maxPart = event.max_participants;
                    const spotsLeft = maxPart ? (maxPart - confirmed) : null;

                    // Determine pace level (for display)
                    const paceVal = event.target_pace_sec_per_100m;
                    let paceLabel = 'Developing';
                    let paceEmoji = '<i data-lucide="heart" style="width: 14px; height: 14px; vertical-align: middle;"></i>';

                    if (paceVal === 0) {
                        paceLabel = 'Race Pace';
                        paceEmoji = '<i data-lucide="flag" style="width: 14px; height: 14px; vertical-align: middle;"></i>';
                    } else if (paceVal <= 100) {
                        paceLabel = 'Fast';
                        paceEmoji = '<i data-lucide="zap" style="width: 14px; height: 14px; vertical-align: middle;"></i>';
                    } else if (paceVal <= 120) {
                        paceLabel = 'Steady';
                        paceEmoji = '<i data-lucide="trending-up" style="width: 14px; height: 14px; vertical-align: middle;"></i>';
                    } else if (paceVal <= 150) {
                        paceLabel = 'Social';
                        paceEmoji = '<i data-lucide="users" style="width: 14px; height: 14px; vertical-align: middle;"></i>';
                    }

                    // Build RSVP buttons - clean 2-column layout
                    let rsvpButtons = '';
                    if (isCancelled) {
                        rsvpButtons = `
                            <div style="display: flex; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.1);">
                                <button class="btn" style="flex: 1; padding: 10px; font-size: 13px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: var(--danger); cursor: not-allowed;" disabled>
                                    Cancelled
                                </button>
                                <button class="btn" style="flex: 1; padding: 10px; font-size: 13px; background: transparent; border: 1px solid var(--text-secondary); color: var(--text-secondary);" onclick="event.stopPropagation(); viewEventDetails('${event.id}')">
                                    Details
                                </button>
                            </div>
                        `;
                    } else if (userStatus === 'approved' && userNeedsReconfirm) {
                        rsvpButtons = `
                            <div style="margin-top: 12px; padding-top: 12px; border-top: 2px solid var(--warning);">
                                <div style="font-size: 12px; font-weight: 700; color: var(--warning); margin-bottom: 6px; display: flex; align-items: center; gap: 5px;">
                                    <i data-lucide="alert-triangle" style="width: 13px; height: 13px;"></i> Swim changed — still in?
                                </div>
                                ${event.last_change_summary ? `<div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 8px; line-height: 1.5;">${event.last_change_summary}</div>` : ''}
                                <div style="display: flex; gap: 8px;">
                                    <button class="btn btn-success" style="flex: 1; padding: 10px; font-size: 13px; font-weight: 700;" onclick="event.stopPropagation(); reconfirmRsvp('${event.id}', true)">
                                        ✓ Still In
                                    </button>
                                    <button class="btn" style="flex: 1; padding: 10px; font-size: 13px; background: transparent; border: 2px solid var(--danger); color: var(--danger); font-weight: 700;" onclick="event.stopPropagation(); reconfirmRsvp('${event.id}', false)">
                                        ✕ Drop Out
                                    </button>
                                </div>
                            </div>
                        `;
                    } else if (userStatus === 'approved') {
                        rsvpButtons = `
                            <div style="display: flex; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.1);">
                                <button class="btn btn-success" style="flex: 1; padding: 10px; font-size: 13px;" disabled>
                                    ✓ You're Going
                                </button>
                                <button class="btn" style="flex: 1; padding: 10px; font-size: 13px; background: transparent; border: 1px solid var(--text-secondary); color: var(--text-secondary);" onclick="event.stopPropagation(); viewEventDetails('${event.id}')">
                                    Details
                                </button>
                            </div>
                            <div style="display: flex; gap: 8px; margin-top: 8px;">
                                <button class="btn" style="flex: 1; padding: 8px; font-size: 12px; background: rgba(234, 179, 8, 0.15); border: 1px solid rgba(234, 179, 8, 0.3); color: var(--warning);" onclick="event.stopPropagation(); viewEventDetails('${event.id}')">
                                    Running Late
                                </button>
                                <button class="btn" style="flex: 1; padding: 8px; font-size: 12px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: var(--danger);" onclick="event.stopPropagation(); leaveEvent('${event.id}')">
                                    Cancel RSVP
                                </button>
                            </div>
                        `;
                    } else if (userStatus === 'requested') {
                        rsvpButtons = `
                            <div style="display: flex; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.1);">
                                <button class="btn" style="flex: 1; padding: 10px; font-size: 13px; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.2); color: var(--ocean-light); cursor: not-allowed;" disabled>
                                    Request Sent
                                </button>
                                <button class="btn" style="flex: 1; padding: 10px; font-size: 13px; background: transparent; border: 1px solid var(--text-secondary); color: var(--text-secondary);" onclick="event.stopPropagation(); viewEventDetails('${event.id}')">
                                    Details
                                </button>
                                <button class="btn" style="flex: 1; padding: 10px; font-size: 13px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: var(--danger);" onclick="event.stopPropagation(); leaveEvent('${event.id}')">
                                    Cancel
                                </button>
                            </div>
                        `;
                    } else {
                        rsvpButtons = `
                            <div style="display: flex; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.1);">
                                <button class="btn btn-success" style="flex: 1; padding: 10px; font-size: 13px;" onclick="event.stopPropagation(); joinEvent('${event.id}', 'going')">
                                    I'm Going
                                </button>
                                <button class="btn" style="flex: 1; padding: 10px; font-size: 13px; background: rgba(234, 179, 8, 0.15); border: 1px solid rgba(234, 179, 8, 0.3); color: var(--warning);" onclick="event.stopPropagation(); joinEvent('${event.id}', 'maybe')">
                                    Maybe
                                </button>
                                <button class="btn" style="flex: 1; padding: 10px; font-size: 13px; background: transparent; border: 1px solid var(--text-secondary); color: var(--text-secondary);" onclick="event.stopPropagation(); viewEventDetails('${event.id}')">
                                    Details
                                </button>
                            </div>
                        `;
                    }

                    const routeInfo = parseRouteFromNotes(event.notes);
                    const displayRoute = event.route_type ? event.route_type.replace(/_/g, ' ') : routeInfo.route;
                    const displayNotes = event.description || event.notes;
                    const eventHazards = getHazardsForEvent(event);
                    const hazardWarning = eventHazards.length > 0
                        ? `<div style="margin-top:8px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.5);border-radius:8px;padding:8px 12px;display:flex;align-items:center;gap:8px;"><span style="font-size:16px;">&#x26A0;&#xFE0F;</span><div><div style="font-size:12px;font-weight:700;color:#ef4444;">HAZARD AT THIS LOCATION</div><div style="font-size:11px;color:var(--text-secondary);margin-top:1px;">${eventHazards[0].title}</div></div></div>`
                        : '';
                    const posterHtml = event.poster_url
                        ? `<img src="${event.poster_url}" alt="Event poster" onclick="event.stopPropagation()" style="width:100%;border-radius:8px;margin-top:10px;max-height:220px;object-fit:cover;cursor:default;">`
                        : '';

                    return `
                        <div style="background: rgba(15, 23, 42, 0.6); border: 2px solid ${isCancelled ? 'rgba(239, 68, 68, 0.2)' : (eventHazards.length > 0 ? 'rgba(239,68,68,0.4)' : 'rgba(56, 189, 248, 0.2)')}; border-radius: 12px; padding: 18px; margin-bottom: 14px; cursor: pointer; opacity: ${isCancelled ? '0.6' : '1'}; transition: all 0.2s;" onclick="viewEventDetails('${event.id}')">
                            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                                <div style="flex: 1;">
                                    <div style="font-size: 18px; font-weight: 600; color: ${isCancelled ? 'var(--text-secondary)' : 'var(--text-primary)'}; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
                                        ${event.title || 'Untitled Swim'}
                                        ${isCancelled ? `
                                            <span style="background: var(--danger); color: white; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 800; letter-spacing: 0.5px;">CANCELLED</span>
                                        ` : ''}
                                    </div>
                                    <div style="font-size: 13px; color: var(--text-secondary);">
                                        ${event.location_name || 'Location TBD'}
                                    </div>
                                </div>
                                <div style="text-align: right;">
                                    <div style="font-size: 14px; color: var(--ocean-light); font-weight: 600;">
                                        ${dateStr}
                                    </div>
                                    <div style="font-size: 13px; color: var(--text-secondary);">
                                        ${timeStr}
                                    </div>
                                </div>
                            </div>
                            
                            <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px;">
                                <div style="background: rgba(56, 189, 248, 0.15); padding: 4px 10px; border-radius: 6px; font-size: 11px; font-weight: 600; color: var(--ocean-light);">
                                    ${paceLabel}
                                </div>
                                ${event.category === 'official_race' ? `<div style="background:rgba(245,158,11,0.15);padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;color:#f59e0b;letter-spacing:0.3px;">OFFICIAL</div>` : ''}
                                ${event.recurrence_type ? `<div style="background:rgba(16,185,129,0.12);padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;color:#10b981;">${formatRecurrenceLabel(event.recurrence_type, event.start_at)}</div>` : ''}
                                ${displayRoute ? `
                                    <div style="background: rgba(56, 189, 248, 0.1); padding: 4px 10px; border-radius: 6px; font-size: 11px; color: var(--text-secondary);">
                                        ${displayRoute}
                                    </div>
                                ` : ''}
                                ${event.tow_float_recommended ? `
                                    <div style="background: rgba(251, 191, 36, 0.15); padding: 4px 10px; border-radius: 6px; font-size: 11px; color: var(--warning);">
                                        Tow Float
                                    </div>
                                ` : ''}
                                ${event.bright_cap_recommended ? `
                                    <div style="background: rgba(251, 191, 36, 0.15); padding: 4px 10px; border-radius: 6px; font-size: 11px; color: var(--warning);">
                                        Bright Cap
                                    </div>
                                ` : ''}
                                ${(event.distances_km && event.distances_km.length)
                                    ? event.distances_km.map(d => `
                                    <div style="background:rgba(16,185,129,0.15);padding:4px 10px;border-radius:6px;font-size:11px;color:var(--success);">
                                        ${d}km
                                    </div>`).join('')
                                    : event.distance_km ? `
                                    <div style="background:rgba(16,185,129,0.15);padding:4px 10px;border-radius:6px;font-size:11px;color:var(--success);">
                                        ${event.distance_km}km
                                    </div>` : ''
                                }
                                <div style="background: rgba(139, 92, 246, 0.15); padding: 4px 10px; border-radius: 6px; font-size: 11px; color: #a78bfa;">
                                    ${confirmed} going${pending > 0 ? ` · ${pending} pending` : ''}${spotsLeft !== null ? ` · ${spotsLeft} left` : ''}
                                </div>
                            </div>
                            
                            ${displayNotes ? `
                                <div style="font-size: 13px; color: var(--text-secondary); margin-bottom: 8px; line-height: 1.5;">
                                    ${displayNotes.substring(0, 100)}${displayNotes.length > 100 ? '...' : ''}
                                </div>
                            ` : ''}
                            
                            <div style="font-size: 12px; color: var(--text-secondary);">
                                Created by ${creatorName}
                            </div>
                            
                            ${hazardWarning}
                            ${posterHtml}
                            ${rsvpButtons}
                        </div>
                    `;
                }).join('');

                document.getElementById('eventsList').innerHTML = html;
                initIcons(); // Initialize Lucide icons

            } catch (err) {
                console.error('Caught error:', err);
                document.getElementById('eventsList').innerHTML =
                    `<div style="color: var(--danger); text-align: center; padding: 20px;">
                        Unexpected error<br>
                        <small style="font-size: 11px;">${err.message}</small>
                    </div>`;
            }
        }


        // Submit new event  
        async function submitEvent(e) {
            e.preventDefault();

            // Check if profile is complete
            if (window.incompleteProfile) {
                showToast('Please complete your profile first to RSVP', 'info');
                showOnboardingPersonal();
                return;
            }

            // Get form values
            const title = document.getElementById('eventName')?.value;
            const spotSelect = document.getElementById('eventSpot');
            const spotId = spotSelect?.value;
            const startAt = document.getElementById('eventDateTime')?.value + ':00+02:00'; // Appending SAST offset (+02:00)
            const paceLevel = document.getElementById('eventPaceLevel')?.value;
            const eventCategory = document.getElementById('eventCategory')?.value || 'group_swim';
            const distanceKm = eventCategory === 'official_race'
                ? 0
                : parseFloat(document.getElementById('eventDistance')?.value) || 0;
            const notes = document.getElementById('eventDescription')?.value;

            // Find the spot name from the ID
            const spot = spots.find(s => s.id === spotId);
            const locationName = spot ? spot.name : spotSelect?.options[spotSelect.selectedIndex]?.text;

            // Pace level is now stored directly as integer (no mapping needed)
            const targetPace = parseInt(paceLevel, 10);

            // Handle coordination fields
            const routeType = document.getElementById('eventRouteType')?.value;
            const towFloat = document.getElementById('eventTowFloat')?.checked;
            const brightCap = document.getElementById('eventBrightCap')?.checked;
            const logistics = document.getElementById('eventLogistics')?.value;
            const chatUrl = document.getElementById('eventChatUrl')?.value;

            let recurrenceType = document.getElementById('eventRecurrence')?.value || '';
            // Resolve flexible monthly selector into stored format monthly_{nth}_{dow}
            if (recurrenceType === 'monthly') {
                const nth = document.getElementById('monthlyNth')?.value || '1';
                const dow = document.getElementById('monthlyDow')?.value || '0';
                recurrenceType = `monthly_${nth}_${dow}`;
            }
            const recurrenceEndVal = document.getElementById('eventRecurrenceEnd')?.value || '';
            const dateTimeVal = document.getElementById('eventDateTime')?.value || '';

            // Block swims set in the past
            if (dateTimeVal && new Date(startAt) < new Date()) {
                showToast('Swim time is already in the past — please pick a future date and time.', 'error');
                return;
            }

            // Hazard check — require acknowledgement before posting to a flagged spot
            const _activeHazards = spotId ? (activeHazardsBySpot[spotId] || []) : [];
            if (_activeHazards.length > 0 && !hazardAcknowledged) {
                showHazardConfirm(_activeHazards);
                return;
            }
            hazardAcknowledged = false; // reset for next create

            const baseEvent = {
                created_by: currentUser.id,
                title: title,
                location_name: locationName,
                spot_id: spot?.id || null,
                lat: spot?.latitude || null,
                lng: spot?.longitude || null,
                distance_km: distanceKm,
                distances_km: eventCategory === 'official_race' ? selectedRaceDistances : null,
                target_pace_sec_per_100m: targetPace,
                notes: notes,
                route_type: routeType,
                tow_float_recommended: towFloat,
                bright_cap_recommended: brightCap,
                logistics_note: logistics,
                external_chat_url: chatUrl,
                requires_approval: document.getElementById('eventRequireApproval')?.checked || false,
                status: 'planned',
                category: eventCategory,
            };

            let eventsToInsert = [];

            if (recurrenceType && recurrenceEndVal && dateTimeVal) {
                const seriesId = crypto.randomUUID();
                const [datePart, timePart] = dateTimeVal.split('T');
                const endDate = new Date(recurrenceEndVal + 'T12:00:00Z');

                const pushInstance = (dateObj) => {
                    if (eventsToInsert.length >= 60) return;
                    const y = dateObj.getUTCFullYear();
                    const mo = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
                    const d  = String(dateObj.getUTCDate()).padStart(2, '0');
                    eventsToInsert.push({
                        ...baseEvent,
                        start_at: `${y}-${mo}-${d}T${timePart}:00+02:00`,
                        recurrence_type: recurrenceType,
                        recurrence_end_date: recurrenceEndVal,
                        recurrence_series_id: seriesId
                    });
                };

                if (recurrenceType.startsWith('monthly_')) {
                    // Generic monthly_{nth}_{dow} — nth=5 means "last"
                    const parts = recurrenceType.split('_');
                    let nth = 1, targetDow = 0;
                    if (parts.length === 3) { nth = parseInt(parts[1]); targetDow = parseInt(parts[2]); }
                    // Legacy aliases
                    if (recurrenceType === 'monthly_first_sunday') { nth = 1; targetDow = 0; }
                    if (recurrenceType === 'monthly_last_sunday')  { nth = 5; targetDow = 0; }

                    const startUTC = new Date(datePart + 'T12:00:00Z');
                    let curMonth = new Date(Date.UTC(startUTC.getUTCFullYear(), startUTC.getUTCMonth(), 1));
                    while (curMonth <= endDate && eventsToInsert.length < 60) {
                        const yr = curMonth.getUTCFullYear();
                        const mo = curMonth.getUTCMonth();
                        let target;
                        if (nth === 5) {
                            // "Last" occurrence: start from last day of month, go back to targetDow
                            const lastDay = new Date(Date.UTC(yr, mo + 1, 0));
                            const diff = (lastDay.getUTCDay() - targetDow + 7) % 7;
                            target = new Date(Date.UTC(yr, mo, lastDay.getUTCDate() - diff));
                        } else {
                            // nth occurrence: find first targetDow, then add (nth-1)*7 days
                            const firstDay = new Date(Date.UTC(yr, mo, 1));
                            const offset = (targetDow - firstDay.getUTCDay() + 7) % 7;
                            target = new Date(Date.UTC(yr, mo, 1 + offset + (nth - 1) * 7));
                        }
                        if (target >= startUTC && target <= endDate) pushInstance(target);
                        curMonth.setUTCMonth(curMonth.getUTCMonth() + 1);
                    }
                } else {
                    // Daily / weekdays / weekends / weekly / fortnightly
                    const stepDays = recurrenceType === 'weekly' ? 7 : recurrenceType === 'fortnightly' ? 14 : 1;
                    let cur = new Date(datePart + 'T12:00:00Z');
                    while (cur <= endDate && eventsToInsert.length < 60) {
                        const dow = cur.getUTCDay();
                        const include = recurrenceType === 'weekdays' ? (dow >= 1 && dow <= 5)
                                      : recurrenceType === 'weekends' ? (dow === 0 || dow === 6)
                                      : true;
                        if (include) pushInstance(cur);
                        cur.setUTCDate(cur.getUTCDate() + stepDays);
                    }
                }
            } else {
                // One-time event
                eventsToInsert = [{ ...baseEvent, start_at: startAt }];
            }

            const { data, error } = await supabaseClient
                .from('swim_events')
                .insert(eventsToInsert)
                .select();

            if (error) {
                alert('Error creating event: ' + error.message);
                console.error('Event creation error:', error);
                return;
            }

            // Upload poster and update all instances in the series
            const posterFile = document.getElementById('eventPoster')?.files?.[0];
            if (posterFile && data?.length) {
                try {
                    const ext = posterFile.name.split('.').pop();
                    const path = `${data[0].id}.${ext}`;
                    const { error: upErr } = await supabaseClient.storage
                        .from('event-posters')
                        .upload(path, posterFile, { upsert: true, contentType: posterFile.type });
                    if (!upErr) {
                        const { data: urlData } = supabaseClient.storage.from('event-posters').getPublicUrl(path);
                        const posterUrl = urlData?.publicUrl;
                        if (posterUrl) {
                            // Apply to all instances in this series (or just the one-off)
                            const ids = data.map(ev => ev.id);
                            await supabaseClient.from('swim_events').update({ poster_url: posterUrl }).in('id', ids);
                        }
                    }
                } catch (pErr) { console.warn('Poster upload failed (non-blocking):', pErr); }
            }

            // Auto-join creator as organizer for all instances
            if (data && data.length > 0) {
                try {
                    const participantRows = data.map(ev => ({
                        swim_event_id: ev.id,
                        user_id: currentUser.id,
                        rsvp: 'going',
                        status: 'approved',
                        requested_at: new Date().toISOString(),
                        decided_at: new Date().toISOString(),
                        decided_by: currentUser.id
                    }));
                    await supabaseClient
                        .from('swim_participants')
                        .upsert(participantRows, { onConflict: 'swim_event_id,user_id' });
                } catch (err) {
                    console.error('Could not auto-join event:', err);
                }
            }

            const typeLabel = { daily:'daily', weekdays:'weekdays', weekends:'weekends', weekly:'weekly', fortnightly:'fortnightly' }[recurrenceType] || '';
            const toastMsg = recurrenceType && data?.length > 1
                ? `${data.length} ${typeLabel} swims created!`
                : 'Swim created successfully!';
            showToast(toastMsg, 'success');
            analytics.track('swim_created', { category: eventCategory, recurrence: recurrenceType || 'none', count: data?.length || 1 });
            hideCreateEvent();
            loadEvents();

            // Check for new badges after creating a swim
            await checkAndAwardBadges();

            // Notify opted-in users about the new swim (once, using first event)
            if (data && data[0]) {
                const newEventId = data[0].id;
                try {
                    const [creatorRes, optedInRes] = await Promise.all([
                        supabaseClient.from('profiles').select('display_name').eq('id', currentUser.id).single(),
                        supabaseClient.from('profiles').select('id').eq('notify_new_swims', true).neq('id', currentUser.id)
                    ]);

                    const hostName = creatorRes.data?.display_name || 'Someone';
                    const optedIn = optedInRes.data || [];

                    if (optedIn.length > 0) {
                        const distStr = baseEvent.distance_km ? `${baseEvent.distance_km}km · ` : '';
                        const timeStr = new Date(data[0].start_at).toLocaleString('en-ZA', {
                            weekday: 'short', month: 'short', day: 'numeric',
                            hour: '2-digit', minute: '2-digit'
                        });
                        const spotsStr = data[0].max_participants ? ` · ${data[0].max_participants} spots` : '';
                        const recurStr = data[0]?.recurrence_type ? ` · ${data[0].recurrence_type}` : '';
                        const notifMessage = `${baseEvent.location_name} · ${distStr}${timeStr}${spotsStr}${recurStr}`;

                        for (const user of optedIn) {
                            await notify(
                                user.id, newEventId, 'new_swim',
                                `${hostName} posted a new swim!`,
                                notifMessage,
                                { swim_event_id: newEventId }
                            );
                        }
                        showToast(`${optedIn.length} swimmer${optedIn.length!==1?'s':''} notified`, 'success');
                    }
                } catch (err) {
                    console.error('Error sending new swim notifications:', err);
                }
            }

            // Offer to share the new swim
            if (data && data[0]) {
                setTimeout(() => offerShareSwim(data[0]), 500);
            }
        }

        // ==========================================
        // SWIM OVERLAP DETECTION
        // ==========================================

        function onCreateFormFieldChange() {
            const spotId = document.getElementById('eventSpot')?.value;
            const dateVal = document.getElementById('eventDateTime')?.value;
            if (spotId && dateVal) {
                checkSwimOverlap(spotId, dateVal + ':00+02:00');
            } else {
                // Clear warning if either field is empty
                const el = document.getElementById('swimOverlapWarning');
                if (el) { el.style.display = 'none'; el.innerHTML = ''; }
            }
            updateRecurrencePreview();
            // Inline hazard cue
            const _hw = document.getElementById('spotHazardWarning');
            if (_hw) {
                const _hz = spotId ? (activeHazardsBySpot[spotId] || []) : [];
                if (_hz.length > 0) {
                    _hw.style.display = 'block';
                    _hw.innerHTML = '<strong>Active hazard at this spot:</strong> ' + _hz.map(h => h.title).join(' · ');
                } else {
                    _hw.style.display = 'none';
                }
            }
        }

        function formatRecurrenceLabel(rt, startAt) {
            if (rt === 'weekly' || rt === 'fortnightly') {
                const day = new Date(startAt).toLocaleDateString('en-ZA', { weekday: 'long' });
                return rt === 'weekly' ? `Every ${day}` : `Every 2nd ${day}`;
            }
            // Legacy monthly types (backward compat)
            if (rt === 'monthly_last_sunday') return 'Monthly (last Sunday)';
            if (rt === 'monthly_first_sunday') return 'Monthly (first Sunday)';
            // Flexible monthly: monthly_{nth}_{dow}
            if (rt && rt.startsWith('monthly_')) {
                const parts = rt.split('_');
                if (parts.length === 3) {
                    const nth = parseInt(parts[1]);
                    const dow = parseInt(parts[2]);
                    const ordinals = ['', '1st', '2nd', '3rd', '4th', 'last'];
                    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
                    return `Monthly (${ordinals[nth] || nth} ${days[dow] || dow})`;
                }
            }
            return { monthly:'Monthly', daily:'Daily', weekdays:'Weekdays (Mon–Fri)', weekends:'Weekends (Sat–Sun)' }[rt] || rt;
        }

        function onRecurrenceChange() {
            const val = document.getElementById('eventRecurrence')?.value;
            const endGroup = document.getElementById('recurrenceEndGroup');
            if (endGroup) endGroup.style.display = val ? 'block' : 'none';
            // Show/hide monthly sub-picker
            const monthlyGroup = document.getElementById('monthlySubGroup');
            if (monthlyGroup) monthlyGroup.style.display = val === 'monthly' ? 'block' : 'none';
            updateRecurrencePreview();
        }

        // Tracks distances for multi-distance race events
        let selectedRaceDistances = [];

        function selectSwimType(val) {
            const sel = document.getElementById('eventCategory');
            if (sel) sel.value = val;
            onCategoryChange();
        }

        function onCategoryChange() {
            const val = document.getElementById('eventCategory')?.value;
            const isRace = val === 'official_race';

            // Update type card button visuals
            const groupBtn = document.getElementById('typeGroupSwimBtn');
            const raceBtn  = document.getElementById('typeRaceBtn');
            if (groupBtn) {
                groupBtn.style.borderColor = isRace ? 'rgba(56,189,248,0.15)' : 'var(--ocean-blue)';
                groupBtn.style.background  = isRace ? 'rgba(15,23,42,0.6)' : 'rgba(2,132,199,0.15)';
            }
            if (raceBtn) {
                raceBtn.style.borderColor = isRace ? '#f59e0b' : 'rgba(56,189,248,0.15)';
                raceBtn.style.background  = isRace ? 'rgba(245,158,11,0.12)' : 'rgba(15,23,42,0.6)';
            }

            // Update modal title + submit button + name placeholder
            const titleEl = document.getElementById('createModalTitle');
            if (titleEl) titleEl.textContent = isRace ? 'Create Official Race' : 'Organise a Group Swim';
            const submitBtn = document.getElementById('createSubmitBtn');
            if (submitBtn) submitBtn.textContent = isRace ? 'Create Race' : 'Create Swim';
            const nameInput = document.getElementById('eventName');
            if (nameInput) nameInput.placeholder = isRace
                ? 'e.g., Groenpunt Open Water Challenge'
                : 'e.g., Morning Clifton Lap';

            // Poster upload visibility
            const posterGroup = document.getElementById('posterUploadGroup');
            if (posterGroup) posterGroup.style.display = isRace ? 'block' : 'none';

            // Distance mode toggle
            const singleGroup = document.getElementById('singleDistanceGroup');
            const multiGroup  = document.getElementById('multiDistanceGroup');
            if (singleGroup) {
                singleGroup.style.display = isRace ? 'none' : 'block';
                const distInput = singleGroup.querySelector('input');
                if (distInput) distInput.required = !isRace;
            }
            if (multiGroup) multiGroup.style.display = isRace ? 'block' : 'none';
        }

        function addRaceDistance(val) {
            const num = parseFloat(val);
            if (isNaN(num) || num <= 0) return;
            if (selectedRaceDistances.includes(num)) return; // no duplicates
            selectedRaceDistances.push(num);
            selectedRaceDistances.sort((a, b) => a - b);
            renderDistancePills();
        }

        function addCustomRaceDistance() {
            const input = document.getElementById('customDistanceInput');
            const val = parseFloat(input?.value);
            if (isNaN(val) || val <= 0) return;
            addRaceDistance(val);
            if (input) input.value = '';
        }

        function removeRaceDistance(val) {
            selectedRaceDistances = selectedRaceDistances.filter(d => d !== val);
            renderDistancePills();
        }

        function formatRaceDistance(km) {
            return km < 1 ? `${Math.round(km * 1000)}m` : `${km}km`;
        }

        function renderDistancePills() {
            const container = document.getElementById('selectedDistancesPills');
            const hint = document.getElementById('noDistancesHint');
            if (!container) return;
            if (hint) hint.style.display = selectedRaceDistances.length ? 'none' : 'inline';
            // Remove old pills (keep hint span)
            Array.from(container.children).forEach(el => {
                if (el.id !== 'noDistancesHint') el.remove();
            });
            selectedRaceDistances.forEach(d => {
                const pill = document.createElement('div');
                pill.style.cssText = 'display:inline-flex;align-items:center;gap:6px;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);border-radius:20px;padding:5px 14px;font-size:13px;font-weight:600;color:var(--success);';
                pill.innerHTML = `${formatRaceDistance(d)} <span onclick="removeRaceDistance(${d})" style="cursor:pointer;opacity:0.6;font-size:16px;line-height:1;margin-left:2px;">×</span>`;
                container.appendChild(pill);
            });
        }

        function resetRaceDistances() {
            selectedRaceDistances = [];
            renderDistancePills();
        }

        // Poster file preview
        document.addEventListener('change', function(e) {
            if (e.target.id !== 'eventPoster') return;
            const file = e.target.files?.[0];
            const preview = document.getElementById('posterPreview');
            const img = document.getElementById('posterPreviewImg');
            if (file && preview && img) {
                img.src = URL.createObjectURL(file);
                preview.style.display = 'block';
            }
        });

        function updateRecurrencePreview() {
            const recurrenceType = document.getElementById('eventRecurrence')?.value;
            const endDateVal = document.getElementById('eventRecurrenceEnd')?.value;
            const dateVal = document.getElementById('eventDateTime')?.value;
            const previewEl = document.getElementById('recurrencePreview');
            if (!previewEl) return;
            if (!recurrenceType || !endDateVal || !dateVal) {
                previewEl.style.display = 'none';
                return;
            }
            const stepDays = recurrenceType === 'daily' ? 1 : recurrenceType === 'weekly' ? 7 : 14;
            const [datePart] = dateVal.split('T');
            let cur = new Date(datePart + 'T12:00:00');
            const end = new Date(endDateVal + 'T12:00:00');
            let count = 0;
            while (cur <= end && count < 52) { count++; cur.setDate(cur.getDate() + stepDays); }
            const typeLabel = formatRecurrenceLabel(recurrenceType, datePart + 'T12:00:00');
            const endFmt = new Date(endDateVal + 'T12:00:00').toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
            previewEl.style.display = 'block';
            previewEl.textContent = `Will create ${count} swim${count !== 1 ? 's' : ''} (${typeLabel.toLowerCase()}) until ${endFmt}`;
        }

        async function checkSwimOverlap(spotId, startAt) {
            const el = document.getElementById('swimOverlapWarning');
            if (!el || !spotId || !startAt) return;

            const spot = spots.find(s => s.id === spotId);
            if (!spot) return;

            try {
                const startMs = new Date(startAt).getTime();
                const twoHoursBefore = new Date(startMs - 2 * 60 * 60 * 1000).toISOString();
                const twoHoursAfter  = new Date(startMs + 2 * 60 * 60 * 1000).toISOString();

                const { data: nearby } = await supabaseClient
                    .from('swim_events')
                    .select('id, title, location_name, start_at, created_by, target_pace_sec_per_100m, distance_km')
                    .neq('status', 'cancelled')
                    .neq('created_by', currentUser.id)
                    .gte('start_at', twoHoursBefore)
                    .lte('start_at', twoHoursAfter)
                    .eq('lat', spot.latitude)
                    .eq('lng', spot.longitude);

                renderOverlapWarning(nearby || []);
            } catch (err) {
                console.error('Overlap check error:', err);
            }
        }

        async function renderOverlapWarning(overlappingSwims) {
            const el = document.getElementById('swimOverlapWarning');
            if (!el) return;

            if (!overlappingSwims || overlappingSwims.length === 0) {
                el.style.display = 'none';
                el.innerHTML = '';
                return;
            }

            // Fetch organiser names
            const creatorIds = [...new Set(overlappingSwims.map(s => s.created_by))];
            const { data: organisers } = await supabaseClient
                .from('profiles')
                .select('id, display_name')
                .in('id', creatorIds);
            const organiserMap = {};
            (organisers || []).forEach(p => organiserMap[p.id] = p.display_name);

            const paceLabel = p => {
                if (p <= 100) return 'Fast';
                if (p <= 120) return 'Steady';
                if (p <= 150) return 'Social';
                return 'Developing';
            };

            el.innerHTML = `
                <div style="background: rgba(245,158,11,0.12); border: 1px solid rgba(245,158,11,0.4);
                            border-radius: 12px; padding: 14px 16px;">
                    <div style="font-weight: 700; color: var(--warning); font-size: 13px; margin-bottom: 10px;">
                        There's already a swim at this location around this time
                    </div>
                    ${overlappingSwims.map(s => {
                        const d = new Date(s.start_at);
                        const dateStr = d.toLocaleDateString('en-ZA', { weekday: 'short', month: 'short', day: 'numeric' });
                        const timeStr = d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
                        const distStr = s.distance_km ? `${s.distance_km}km · ` : '';
                        const pace = s.target_pace_sec_per_100m ? paceLabel(s.target_pace_sec_per_100m) : '';
                        const organiser = organiserMap[s.created_by] || 'Someone';
                        return `
                            <div style="margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid rgba(245,158,11,0.15);">
                                <div style="font-weight: 700; color: var(--text-primary); font-size: 14px;">${s.title}</div>
                                <div style="font-size: 12px; color: var(--text-secondary); margin-top: 3px;">
                                    ${dateStr} at ${timeStr} · ${distStr}${pace}
                                </div>
                                <div style="font-size: 12px; color: var(--text-secondary); margin-top: 2px;">
                                    Organiser: <strong style="color: var(--text-primary);">${organiser}</strong>
                                </div>
                            </div>
                        `;
                    }).join('')}
                    <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 12px;">
                        Consider joining this swim instead, or contact the organiser before creating a similar one.
                    </div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        ${overlappingSwims.map(s => `
                            <button onclick="viewOverlapSwim('${s.id}')"
                                style="background: rgba(245,158,11,0.2); border: 1px solid rgba(245,158,11,0.4);
                                       color: var(--warning); padding: 6px 14px; border-radius: 8px;
                                       font-size: 12px; font-weight: 700; cursor: pointer;">
                                View ${organiserMap[s.created_by] ? organiserMap[s.created_by] + "'s swim" : 'Swim'}
                            </button>
                        `).join('')}
                        <button onclick="dismissOverlapWarning()"
                            style="background: rgba(15,23,42,0.6); border: 1.5px solid rgba(56,189,248,0.2);
                                   color: var(--text-primary); padding: 6px 14px; border-radius: 8px;
                                   font-size: 12px; font-weight: 700; cursor: pointer; transition: all 0.2s;">
                            Create anyway →
                        </button>
                    </div>
                </div>
            `;
            el.style.display = 'block';
        }

        function viewOverlapSwim(swimId) {
            // Close create form and navigate to the swim
            hideCreateEvent();
            loadEventDetails(swimId);
        }

        function dismissOverlapWarning() {
            const el = document.getElementById('swimOverlapWarning');
            if (el) { el.style.display = 'none'; el.innerHTML = ''; }
        }

        // Share a swim via WhatsApp or copy link
        function getSwimShareUrl(eventId) {
            return `https://swimloading.com/r?type=swim&id=${encodeURIComponent(eventId)}`;
        }

        function getSwimShareText(event) {
            const d = new Date(event.start_at);
            const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            const distance = event.distance_km ? ` • ${event.distance_km}km` : '';
            return `${event.title}\n${event.location_name}\n${dateStr} at ${timeStr}${distance}\n\nJoin us on SwimLoading!`;
        }

        function shareSwimWhatsApp(event) {
            const text = getSwimShareText(event);
            const url = getSwimShareUrl(event.id);
            const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text + '\n\n' + url)}`;
            window.open(whatsappUrl, '_blank');
        }

        async function shareSwimLink(event) {
            const url = getSwimShareUrl(event.id);
            const text = getSwimShareText(event);

            // Try native share first (works on mobile)
            if (navigator.share) {
                try {
                    await navigator.share({
                        title: event.title,
                        text: text,
                        url: url
                    });
                    return;
                } catch (e) {
                    // User cancelled or not supported, fall back to clipboard
                }
            }

            // Fallback: copy to clipboard
            try {
                await navigator.clipboard.writeText(url);
                showToast('Link copied to clipboard!', 'success');
            } catch (e) {
                // Final fallback
                const input = document.createElement('input');
                input.value = url;
                document.body.appendChild(input);
                input.select();
                document.execCommand('copy');
                document.body.removeChild(input);
                showToast('Link copied!', 'success');
            }
        }

        function offerShareSwim(event) {
            // Show a share prompt after creating a swim
            const modal = document.getElementById('eventDetailsModal');
            modal.style.display = 'block';
            document.getElementById('eventDetailsContent').innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <div style="margin-bottom: 16px;"><i data-lucide="waves" style="width:48px;height:48px;color:var(--ocean-light);opacity:0.4;"></i></div>
                    <h2 style="color: var(--text-primary); font-size: 22px; margin-bottom: 8px;">Swim Created!</h2>
                    <div style="color: var(--text-secondary); font-size: 14px; margin-bottom: 24px;">Invite swimmers to join — even if they're not on the app yet</div>

                    <button onclick="shareSwimWhatsApp(${JSON.stringify(event).replace(/"/g, '&quot;')})"
                            style="width: 100%; padding: 14px; border-radius: 12px; border: none; background: #25D366; color: white; font-size: 16px; font-weight: 700; cursor: pointer; margin-bottom: 10px; display: flex; align-items: center; justify-content: center; gap: 10px;">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                        Share on WhatsApp
                    </button>

                    <button onclick="shareSwimLink(${JSON.stringify(event).replace(/"/g, '&quot;')})"
                            style="width: 100%; padding: 14px; border-radius: 12px; border: 2px solid var(--border); background: transparent; color: var(--text-primary); font-size: 16px; font-weight: 600; cursor: pointer; margin-bottom: 10px; display: flex; align-items: center; justify-content: center; gap: 10px;">
                        <i data-lucide="link" style="width: 18px; height: 18px;"></i>
                        Copy Link
                    </button>

                    <button onclick="hideEventDetails()"
                            style="width: 100%; padding: 12px; border-radius: 12px; border: none; background: transparent; color: var(--text-secondary); font-size: 14px; cursor: pointer; margin-top: 4px;">
                        Skip for now
                    </button>
                </div>
            `;
            document.getElementById('eventDetailsActions').innerHTML = '';
            initIcons();
        }

        // View event details (placeholder)
        // RSVP to event
        // Check if user has safety info before joining a swim
        async function checkSafetyInfo() {
            const { data: profile } = await supabaseClient
                .from('profiles')
                .select('phone, emergency_contact_name, emergency_contact_phone')
                .eq('id', currentUser.id)
                .single();

            if (!profile || !profile.phone || !profile.emergency_contact_name || !profile.emergency_contact_phone) {
                showToast('Please add your phone & emergency contact in Profile first', 'error');
                setTimeout(() => showProfileSettings(), 500);
                return false;
            }
            return true;
        }

        async function rsvpToEvent(eventId, rsvpStatus) {
            try {
                // Safety gate: require phone + emergency contact
                if (rsvpStatus === 'going') {
                    const safe = await checkSafetyInfo();
                    if (!safe) return;
                }

                // Determine status based on event requirements
                const { data: event } = await supabaseClient
                    .from('swim_events')
                    .select('requires_approval')
                    .eq('id', eventId)
                    .single();

                const status = event?.requires_approval ? 'requested' : 'approved';

                const { error } = await supabaseClient
                    .from('swim_participants')
                    .upsert({
                        swim_event_id: eventId,
                        user_id: currentUser.id,
                        rsvp: rsvpStatus,
                        status: status
                    }, { onConflict: 'swim_event_id,user_id' });

                if (error) throw error;

                if (status === 'requested') {
                    showToast('Request sent to organizer!', 'info');
                } else {
                    showToast(rsvpStatus === 'going' ? "You're in!" : 'RSVP updated', 'success');
                }
                analytics.track('swim_joined', { rsvp: rsvpStatus });

                await showEventDetails(eventId);
                loadEvents();
                loadDashboard();

                // Check for new badges after joining a swim
                await checkAndAwardBadges();
            } catch (err) {
                console.error('RSVP Error:', err);
                alert('Error updating RSVP: ' + err.message);
            }
        }
        async function updateJoinStatus(eventId, memberId, newStatus) {
            try {
                console.log('Updating join status:', memberId, 'to', newStatus);

                // Get member details to know WHO we are notifying
                const { data: member } = await supabaseClient
                    .from('swim_participants')
                    .select('user_id, swim_event_id')
                    .eq('id', memberId)
                    .single();

                const { error } = await supabaseClient
                    .from('swim_participants')
                    .update({
                        status: newStatus,
                        decided_at: new Date().toISOString(),
                        decided_by: currentUser.id
                    })
                    .eq('id', memberId);

                if (error) throw error;

                // Create notification for the user
                if (member) {
                    const { data: event } = await supabaseClient
                        .from('swim_events')
                        .select('title, start_at, location_name')
                        .eq('id', eventId)
                        .single();

                    const eventDate = new Date(event.start_at).toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit'
                    }) + ' on ' + new Date(event.start_at).toLocaleDateString('en-US', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short'
                    });

                    const swimTitle = event.title || event.location_name;
                    const type = newStatus === 'approved' ? 'approval_granted' : 'approval_rejected';
                    const title = newStatus === 'approved' ? 'Approved to join' : 'Join request declined';
                    const message = newStatus === 'approved'
                        ? `Your request to join "${swimTitle}" at ${eventDate} has been approved!`
                        : `Your request to join "${swimTitle}" at ${eventDate} was declined.`;

                    await notify(member.user_id, eventId, type, title, message, { swim_event_id: eventId, decision: newStatus });
                }

                showToast(newStatus === 'approved' ? 'Swimmer approved!' : 'Request declined', 'success');
                await showEventDetails(eventId); // Refresh modal
                await loadEvents(); // Refresh home
            } catch (err) {
                console.error('Error updating status:', err);
                alert('Error: ' + err.message);
            }
        }

        // View event (compatibility function)
        function viewEvent(eventId) {
            showEventDetails(eventId);
        }

        // View event details (wrapper for compatibility)
        async function viewEventDetails(eventId) {
            showPage('events');
            await showEventDetails(eventId);
        }

        // Show event details modal
        async function showEventDetails(eventId) {
            // Find the event
            const event = await loadEventDetails(eventId);
            if (!event) return;

            document.getElementById('eventDetailsModal').style.display = 'block';
            document.body.style.overflow = 'hidden';
            renderEventDetails(event);
        }

        function hideEventDetails() {
            document.getElementById('eventDetailsModal').style.display = 'none';
            document.body.style.overflow = '';
        }

        function showHazardConfirm(hazards) {
            const modal = document.getElementById('eventDetailsModal');
            modal.style.display = 'block';
            document.body.style.overflow = 'hidden';
            document.getElementById('eventDetailsContent').innerHTML = `
                <div style="text-align:center;padding:8px 0 20px;">
                    <div style="margin-bottom:12px;"><i data-lucide="alert-triangle" style="width:44px;height:44px;color:#ef4444;opacity:0.7;"></i></div>
                    <h3 style="color:#f59e0b;font-size:18px;font-weight:800;margin-bottom:8px;">Hazard at this location</h3>
                    <div style="font-size:13px;line-height:1.6;margin-bottom:16px;">
                        ${hazards.map(h => `<div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:10px 14px;margin-bottom:8px;text-align:left;">
                            <div style="font-weight:700;color:var(--text);">${h.title}</div>
                            ${h.description ? `<div style="font-size:12px;color:var(--text-secondary);margin-top:3px;">${h.description}</div>` : ''}
                        </div>`).join('')}
                    </div>
                    <div style="font-size:12px;color:var(--text-secondary);margin-bottom:20px;line-height:1.5;">
                        Please ensure all participants are aware before creating this swim.<br>
                        NSRI Emergency: <strong style="color:var(--text);">087 094 9774</strong>
                    </div>
                    <div style="display:flex;gap:10px;">
                        <button onclick="hideEventDetails()" style="flex:1;padding:13px;background:rgba(15,23,42,0.6);border:2px solid rgba(56,189,248,0.2);border-radius:12px;color:var(--text-primary);font-weight:600;font-size:14px;cursor:pointer;transition:all 0.2s;">Cancel</button>
                        <button onclick="proceedCreateAnyway()" style="flex:1;padding:13px;background:#f59e0b;border:none;border-radius:12px;color:#000;font-weight:700;font-size:14px;cursor:pointer;">Create anyway</button>
                    </div>
                </div>`;
        }

        function proceedCreateAnyway() {
            hazardAcknowledged = true;
            hideEventDetails();
            document.getElementById('createEventForm').requestSubmit();
        }

        async function loadEventDetails(eventId) {
            try {
                console.log('Loading event details for:', eventId);

                const { data: event, error } = await supabaseClient
                    .from('swim_events')
                    .select('*')
                    .eq('id', eventId)
                    .single();

                if (error) throw error;

                console.log('Event loaded:', event);

                // Load creator profile
                const { data: creatorProfile, error: creatorError } = await supabaseClient
                    .from('profiles')
                    .select('display_name')
                    .eq('id', event.created_by)
                    .maybeSingle();

                if (creatorError) {
                    console.error('Error loading creator:', creatorError);
                }

                event.creatorName = creatorProfile?.display_name || 'Anonymous';
                console.log('Creator:', event.creatorName);

                // Load participants - simple query without join
                const { data: members, error: membersError } = await supabaseClient
                    .from('swim_participants')
                    .select('*')
                    .eq('swim_event_id', eventId);

                console.log('Members loaded:', { members, membersError });

                // Load profiles for these members separately
                if (members && members.length > 0) {
                    const userIds = members.map(m => m.user_id);
                    const { data: profiles } = await supabaseClient
                        .from('profiles')
                        .select('id, display_name, phone, emergency_contact_name, emergency_contact_phone')
                        .in('id', userIds);

                    console.log('Profiles loaded:', profiles);

                    // Attach profiles to members
                    members.forEach(member => {
                        const profile = profiles?.find(p => p.id === member.user_id);
                        member.profiles = profile;
                    });
                }

                event.members = members || [];

                // Check if current user is attending
                const myMember = members?.find(m => m.user_id === currentUser.id);
                event.userStatus = myMember?.status || null;
                event.userNeedsReconfirm = myMember?.needs_reconfirm || false;

                console.log('User status:', event.userStatus);

                return event;
            } catch (err) {
                console.error('Error loading event:', err);
                alert('Error loading event details: ' + err.message);
                return null;
            }
        }

        function renderEventDetails(event) {
            const isCancelled = event.status === 'cancelled';
            const eventDate = new Date(event.start_at);
            const attending = event.members.filter(m => m.status === 'approved').length;
            const pending = event.members.filter(m => m.status === 'requested').length;

            const html = `
                <div style="margin-bottom: 20px;">
                    ${isCancelled ? `
                        <div style="background: rgba(239, 68, 68, 0.15); border: 2px solid var(--danger); border-radius: 12px; padding: 16px; margin-bottom: 20px; text-align: center;">
                            <div style="color: var(--danger); font-size: 18px; font-weight: 800; letter-spacing: 1px;">SWIM CANCELLED</div>
                            <div style="color: var(--text-secondary); font-size: 13px; margin-top: 4px;">This event will no longer take place.</div>
                        </div>
                    ` : ''}
                    <div style="display: flex; justify-content: space-between; align-items: start;">
                        <h2 style="font-size: 24px; color: var(--text-primary); margin-bottom: 8px;">${event.title || 'Group Swim'}</h2>
                        ${(function () {
                    const created = new Date(event.created_at);
                    const updated = new Date(event.updated_at);
                    if (updated - created > 60000) {
                        return `
                                    <div style="background: rgba(56, 189, 248, 0.2); color: var(--ocean-light); padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; border: 1px solid rgba(56, 189, 248, 0.3);">
                                        <i data-lucide="refresh-cw" style="width: 12px; height: 12px; vertical-align: middle;"></i> UPDATED
                                    </div>
                                `;
                    }
                    return '';
                })()}
                    </div>
                    <div style="color: var(--text-secondary); font-size: 14px;">Created by ${event.creatorName}</div>
                </div>
                
                <div style="background: rgba(15, 23, 42, 0.6); border-radius: 12px; padding: 16px; margin-bottom: 20px;">
                    <div style="margin-bottom: 12px;">
                        <span style="color: var(--text-secondary); font-size: 13px;"><i data-lucide="map-pin" style="width: 14px; height: 14px; vertical-align: middle;"></i> LOCATION</span>
                        <div style="color: var(--text-primary); font-size: 16px; font-weight: 600; margin-top: 4px;">${event.location_name}</div>
                    </div>
                    
                    <div style="margin-bottom: 12px;">
                        <span style="color: var(--text-secondary); font-size: 13px;"><i data-lucide="calendar" style="width: 14px; height: 14px; vertical-align: middle;"></i> DATE & TIME</span>
                        <div style="color: var(--text-primary); font-size: 16px; font-weight: 600; margin-top: 4px;">
                            ${eventDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                            <br>${eventDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                    </div>
                    
                    ${event.distance_km ? `
                        <div style="margin-bottom: 12px;">
                            <span style="color: var(--text-secondary); font-size: 13px;"><i data-lucide="ruler" style="width: 14px; height: 14px; vertical-align: middle;"></i> DISTANCE</span>
                            <div style="color: var(--text-primary); font-size: 16px; font-weight: 600; margin-top: 4px;">${event.distance_km}km</div>
                        </div>
                    ` : ''}
                    
                    ${(function () {
                    const routeInfo = parseRouteFromNotes(event.notes);
                    const displayRoute = event.route_type ? event.route_type.replace(/_/g, ' ') : routeInfo.route;
                    return displayRoute ? `
                            <div style="margin-bottom: 12px;">
                                <span style="color: var(--text-secondary); font-size: 13px;"><i data-lucide="repeat" style="width: 14px; height: 14px; vertical-align: middle;"></i> ROUTE TYPE</span>
                                <div style="color: var(--text-primary); font-size: 16px; font-weight: 600; margin-top: 4px;">${displayRoute}</div>
                            </div>
                        ` : '';
                })()}

                    ${(event.tow_float_recommended || event.bright_cap_recommended) ? `
                        <div style="margin-bottom: 12px;">
                            <span style="color: var(--text-secondary); font-size: 13px;"><i data-lucide="shield" style="width: 14px; height: 14px; vertical-align: middle;"></i> SAFETY RECOMMENDED</span>
                            <div style="display: flex; gap: 8px; margin-top: 6px;">
                                ${event.tow_float_recommended ? `
                                    <div style="background: rgba(251, 191, 36, 0.15); color: var(--warning); padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; border: 1px solid rgba(251, 191, 36, 0.3);">
                                        Tow Float
                                    </div>
                                ` : ''}
                                ${event.bright_cap_recommended ? `
                                    <div style="background: rgba(251, 191, 36, 0.15); color: var(--warning); padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; border: 1px solid rgba(251, 191, 36, 0.3);">
                                        Bright Cap
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                    ` : ''}
                    
                    ${event.logistics_note ? `
                        <div style="margin-bottom: 12px;">
                            <span style="color: var(--text-secondary); font-size: 13px;"><i data-lucide="truck" style="width: 14px; height: 14px; vertical-align: middle;"></i> LOGISTICS</span>
                            <div style="color: var(--text-primary); font-size: 14px; margin-top: 4px; line-height: 1.6;">${event.logistics_note}</div>
                        </div>
                    ` : ''}
                    <!-- Private Coordination Details -->
                ${(() => {
                    const isApproved = event.userStatus === 'approved';
                    const isCreator = event.created_by === currentUser.id;
                    const isRequested = event.userStatus === 'requested';

                    if (!isApproved && !isCreator) {
                        return isRequested ? `
                            <div style="background: rgba(234, 179, 8, 0.1); border: 1px solid rgba(234, 179, 8, 0.3); border-radius: 12px; padding: 16px; margin-bottom: 20px; text-align: center;">
                                <div style="color: var(--warning); font-size: 14px; font-weight: 700;"><i data-lucide="clock" style="width: 14px; height: 14px; vertical-align: middle;"></i> APPROVAL REQUESTED</div>
                                <div style="color: var(--text-secondary); font-size: 12px; margin-top: 4px;">The host must approve your request before you can see fixed logistics or group chat links.</div>
                            </div>
                        ` : '';
                    }

                    return `
                        <!-- Coordination Info -->
                        ${event.external_chat_url ? `
                            <div style="background: rgba(37, 211, 102, 0.1); border: 1px solid rgba(37, 211, 102, 0.3); border-radius: 12px; padding: 16px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between;">
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <div style="width: 40px; height: 40px; border-radius: 50%; background: #25D366; display: flex; align-items: center; justify-content: center; color: white;">
                                        <i data-lucide="message-circle" style="width: 20px; height: 20px;"></i>
                                    </div>
                                    <div>
                                        <div style="font-weight: 700; color: #25D366; font-size: 13px;">WHATSAPP GROUP</div>
                                        <a href="${event.external_chat_url}" target="_blank" style="color: white; font-size: 14px; text-decoration: underline;">Click to join WhatsApp group</a>
                                    </div>
                                </div>
                                <i data-lucide="external-link" style="width: 16px; height: 16px; color: var(--text-secondary);"></i>
                            </div>
                        ` : ''}
                    `;
                })()}

                <!-- Pending Requests for Creator -->
                ${(event.created_by === currentUser.id && event.members.some(m => m.status === 'requested')) ? `
                    <div style="background: rgba(234, 179, 8, 0.1); border: 1px solid var(--warning); border-radius: 12px; padding: 16px; margin-bottom: 20px;">
                        <div style="font-weight: 700; color: var(--warning); font-size: 14px; margin-bottom: 12px;"><i data-lucide="bell" style="width: 14px; height: 14px; vertical-align: middle;"></i> PENDING REQUESTS</div>
                        ${event.members.filter(m => m.status === 'requested').map(m => `
                            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <div style="width: 28px; height: 28px; border-radius: 50%; background: ${m.profiles?.avatar_url?.startsWith('http') ? 'transparent' : 'var(--warning)'}; display: flex; align-items: center; justify-content: center; color: black; font-weight: 700; font-size: 12px; overflow:hidden;">
                                        ${m.profiles?.avatar_url?.startsWith('http') ? `<img src="${m.profiles.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` : (m.profiles?.avatar_url ? `<i data-lucide="${m.profiles.avatar_url}" style="width: 14px; height: 14px;"></i>` : (m.profiles?.display_name?.charAt(0) || '?'))}
                                    </div>
                                    <span style="font-size: 14px; color: var(--text-primary);">${m.profiles?.display_name || 'Anonymous'}</span>
                                </div>
                                <div style="display: flex; gap: 8px;">
                                    <button class="btn btn-success" style="padding: 6px 12px; font-size: 11px;" onclick="updateJoinStatus('${event.id}', '${m.id}', 'approved')">Approve</button>
                                    <button class="btn" style="padding: 6px 12px; font-size: 11px; background: transparent; border: 1px solid var(--danger); color: var(--danger);" onclick="updateJoinStatus('${event.id}', '${m.id}', 'rejected')">Reject</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : ''}

                <!-- Running Late Section -->
                ${(function () {
                    const isCancelled = event.status === 'cancelled';
                    const approvedMembers = event.members.filter(m => m.status === 'approved');
                    const me = approvedMembers.find(m => m.user_id === currentUser.id);
                    const lateMembers = approvedMembers
                        .filter(m => m.late_status)
                        .sort((a, b) => new Date(b.late_updated_at) - new Date(a.late_updated_at));

                    if (isCancelled || (!me && lateMembers.length === 0)) return '';

                    const lateLabels = {
                        'on_my_way': 'On my way',
                        'late_5': '5 mins late',
                        'late_15': '15 mins late',
                        'late_30': '30 mins late'
                    };

                    const now = new Date();
                    const startAt = new Date(event.start_at);
                    const diffMs = now - startAt;
                    const diffMins = diffMs / (1000 * 60);
                    // Open window: -60 min to +120 min
                    const isOpen = diffMins >= -60 && diffMins <= 120;

                    const isGoing = me && me.rsvp === 'going';

                    let disabledReason = '';
                    if (!me) disabledReason = 'You must be approved to send updates.';
                    else if (!isGoing) disabledReason = "You must RSVP 'Going'.";
                    else if (!isOpen) disabledReason = 'Opens 60 mins before swim.';

                    return `
                        <div style="background: rgba(15, 23, 42, 0.4); border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin-bottom: 20px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                <div style="font-weight: 700; color: var(--text-primary); font-size: 14px;"><i data-lucide="clock" style="width: 14px; height: 14px; vertical-align: middle;"></i> RUNNING LATE?</div>
                                <select onchange="markRunningLate('${event.id}', this.value, this.options[this.selectedIndex].text)" 
                                        ${disabledReason ? 'disabled' : ''}
                                        style="background: var(--bg-dark); color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px; padding: 4px 8px; font-size: 12px; outline: none; cursor: pointer; ${disabledReason ? 'opacity: 0.5; cursor: not-allowed;' : ''}">
                                    <option value="">${disabledReason || 'Update status...'}</option>
                                    <option value="on_my_way">On my way</option>
                                    <option value="late_5">5 mins late</option>
                                    <option value="late_15">15 mins late</option>
                                    <option value="late_30">30 mins late</option>
                                </select>
                            </div>

                            ${lateMembers.length > 0 ? `
                                <div style="display: flex; flex-direction: column; gap: 8px;">
                                    ${lateMembers.map(lm => `
                                        <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 8px;">
                                            <div style="display: flex; align-items: center; gap: 8px;">
                                                <div style="width: 24px; height: 24px; border-radius: 50%; background: var(--ocean-blue); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700;">
                                                    ${lm.profiles?.display_name?.charAt(0) || '?'}
                                                </div>
                                                <span style="font-size: 13px; color: var(--text-primary);">${lm.profiles?.display_name || 'Swimmer'}</span>
                                            </div>
                                            <div style="display: flex; flex-direction: column; align-items: flex-end;">
                                                <span style="font-size: 12px; font-weight: 700; color: var(--warning);">${lateLabels[lm.late_status]}</span>
                                                <span style="font-size: 10px; color: var(--text-secondary); opacity: 0.7;">${getTimeAgo(new Date(lm.late_updated_at))}</span>
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                            ` : `
                                <div style="text-align: center; color: var(--text-secondary); font-size: 12px; padding: 10px; border: 1px dashed rgba(255,255,255,0.05); border-radius: 8px;">No one is running late yet</div>
                            `}
                        </div>
                    `;
                })()}

                <div style="background: rgba(56, 189, 248, 0.1); border-radius: 12px; padding: 16px; margin-bottom: 20px;">
                    <div style="font-weight: 600; color: var(--ocean-light); margin-bottom: 12px;"><i data-lucide="users" style="width: 14px; height: 14px; vertical-align: middle;"></i> Participants (${attending}${pending > 0 ? ` + ${pending} pending` : ''})</div>
                    ${(() => {
                        const isParticipant = event.members.some(m => m.user_id === currentUser.id && (m.status === 'approved' || m.status === 'requested'));
                        const visible = event.members.filter(m => m.status === 'approved' || m.status === 'requested');
                        if (visible.length === 0) return '<div style="color: var(--text-secondary); font-size: 13px;">No one has joined yet. Be the first!</div>';
                        return visible.map(m => `
                            <div style="margin-bottom: 10px; background: rgba(0,0,0,0.15); border-radius: 10px; padding: 10px 12px;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <div style="width: 32px; height: 32px; border-radius: 50%; background: ${m.profiles?.avatar_url?.startsWith('http') ? 'transparent' : (m.status === 'requested' ? 'var(--warning)' : 'var(--ocean-blue)')}; display: flex; align-items: center; justify-content: center; color: ${m.status === 'requested' ? 'black' : 'white'}; font-weight: 600; flex-shrink: 0; overflow:hidden;">
                                        ${m.profiles?.avatar_url?.startsWith('http') ? `<img src="${m.profiles.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">` : (m.profiles?.avatar_url ? '<i data-lucide="' + m.profiles.avatar_url + '" style="width: 16px; height: 16px;"></i>' : (m.profiles?.display_name?.charAt(0) || '?'))}
                                    </div>
                                    <div style="flex: 1;">
                                        <div style="color: var(--text-primary); font-size: 14px;">
                                            ${m.profiles?.display_name || 'Anonymous'}
                                            ${m.status === 'requested' ? '<span style="color: var(--warning); font-size: 10px; font-weight: 800; margin-left: 4px; border: 1px solid var(--warning); padding: 1px 4px; border-radius: 4px;">PENDING</span>' : ''}
                                        </div>
                                        ${m.user_id === event.created_by ? '<div style="color: var(--ocean-light); font-size: 12px;">Swim Host</div>' : ''}
                                    </div>
                                    <div style="color: var(--text-secondary); font-size: 12px;">
                                        ${m.status === 'approved' ? '✓ Going' : m.status === 'requested' ? '? Interested' : ''}
                                    </div>
                                </div>
                                ${isParticipant && m.profiles?.phone ? `
                                    <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.05); display: flex; gap: 12px; flex-wrap: wrap;">
                                        <a href="tel:${m.profiles.phone}" style="color: var(--ocean-light); font-size: 12px; text-decoration: none;">${m.profiles.phone}</a>
                                        ${m.profiles.emergency_contact_name ? `<span style="color: var(--text-secondary); font-size: 11px;">ICE: ${m.profiles.emergency_contact_name} <a href="tel:${m.profiles.emergency_contact_phone}" style="color: var(--danger); text-decoration: none;">${m.profiles.emergency_contact_phone || ''}</a></span>` : ''}
                                    </div>
                                ` : ''}
                            </div>
                        `).join('');
                    })()}
                </div>
                
                <div id="eventDetailsActions"></div>
            `;

            document.getElementById('eventDetailsContent').innerHTML = html;

            // Render action buttons
            renderEventActions(event);
        }

        function renderEventActions(event) {
            const container = document.getElementById('eventDetailsActions');
            const isCancelled = event.status === 'cancelled';
            let html = '';

            if (isCancelled) {
                html = `
                    <div style="text-align: center; padding: 15px; background: rgba(15, 23, 42, 0.4); border-radius: 12px; border: 1px dashed var(--border); width: 100%;">
                        <div style="color: var(--text-secondary); font-size: 14px;">This swim has been cancelled.</div>
                    </div>
                `;
                container.innerHTML = html;
                return;
            }

            if (event.userNeedsReconfirm && event.userStatus === 'approved') {
                // Swim has changed — swimmer must re-confirm
                html += `
                    <div style="background: rgba(234,179,8,0.12); border: 2px solid var(--warning); border-radius: 14px; padding: 16px; margin-bottom: 4px; width: 100%;">
                        <div style="font-weight: 800; color: var(--warning); font-size: 15px; margin-bottom: 6px; display: flex; align-items: center; gap: 6px;">
                            <i data-lucide="alert-triangle" style="width: 16px; height: 16px;"></i> This swim has changed
                        </div>
                        ${event.last_change_summary ? `<div style="font-size: 12px; color: var(--text-primary); margin-bottom: 12px; line-height: 1.6;">${event.last_change_summary}</div>` : ''}
                        <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 14px;">Are you still in?</div>
                        <div style="display: flex; gap: 10px;">
                            <button class="btn btn-success" style="flex: 1; font-weight: 700;" onclick="reconfirmRsvp('${event.id}', true)">
                                <i data-lucide="check" style="width: 14px; height: 14px; vertical-align: middle;"></i> Still In
                            </button>
                            <button class="btn" style="flex: 1; background: transparent; border: 2px solid var(--danger); color: var(--danger); font-weight: 700;" onclick="reconfirmRsvp('${event.id}', false)">
                                <i data-lucide="x" style="width: 14px; height: 14px; vertical-align: middle;"></i> Drop Out
                            </button>
                        </div>
                    </div>
                `;
            } else if (event.userStatus === 'approved') {
                html += `
                    <button class="btn" style="background: var(--success);" disabled><i data-lucide="check" style="width: 14px; height: 14px; vertical-align: middle;"></i> You're Going</button>
                    <button class="btn" style="background: transparent; border: 2px solid var(--danger); color: var(--danger); margin-top: 10px;" onclick="leaveEvent('${event.id}')">Cancel RSVP</button>
                `;
            } else if (event.userStatus === 'requested') {
                html += `
                    <div style="background: rgba(234, 179, 8, 0.1); border: 1px solid rgba(234, 179, 8, 0.3); border-radius: 12px; padding: 12px; margin-bottom: 12px; text-align: center; width: 100%;">
                        <div style="color: var(--warning); font-weight: 700; font-size: 14px;"><i data-lucide="clock" style="width: 16px; height: 16px; vertical-align: middle;"></i> Approval Requested</div>
                        <div style="color: var(--text-secondary); font-size: 12px; margin-top: 4px;">The host must approve your request before you can see fixed logistics or group chat links.</div>
                    </div>
                    <button class="btn" style="background: transparent; border: 2px solid var(--danger); color: var(--danger);" onclick="leaveEvent('${event.id}')">Cancel RSVP</button>
                `;
            } else {
                html += `
                    <button class="btn btn-success" onclick="joinEvent('${event.id}', 'going')">Join Swim</button>
                    <button class="btn" style="background: rgba(255,255,255,0.1); margin-top: 10px;" onclick="joinEvent('${event.id}', 'maybe')">Maybe</button>
                `;
            }

            // Share button — always visible
            html += `
                <div style="display: flex; gap: 8px; margin-top: 10px; width: 100%;">
                    <button class="btn" style="flex: 1; background: #25D366; color: white;" onclick="shareSwimWhatsApp(${JSON.stringify({id: event.id, title: event.title, location_name: event.location_name, start_at: event.start_at, distance_km: event.distance_km}).replace(/"/g, '&quot;')})">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="white" style="vertical-align: middle;"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                        Share
                    </button>
                    <button class="btn" style="flex: 1; background: rgba(255,255,255,0.1);" onclick="shareSwimLink(${JSON.stringify({id: event.id, title: event.title, location_name: event.location_name, start_at: event.start_at, distance_km: event.distance_km}).replace(/"/g, '&quot;')})">
                        <i data-lucide="link" style="width: 14px; height: 14px; vertical-align: middle;"></i> Copy Link
                    </button>
                </div>
            `;

            // Creator-only Edit and Cancel buttons
            if (event.created_by === currentUser.id) {
                html += `
                    <div style="display: flex; gap: 8px; margin-top: 10px; width: 100%;">
                        <button class="btn" style="flex: 1; background: var(--ocean-blue);" onclick="editEvent('${event.id}')">
                            <i data-lucide="edit-3" style="width: 14px; height: 14px; vertical-align: middle;"></i> Edit
                        </button>
                        <button class="btn" style="flex: 1; background: transparent; border: 2px solid var(--danger); color: var(--danger);" onclick="cancelSwim('${event.id}')">
                            <i data-lucide="x-circle" style="width: 14px; height: 14px; vertical-align: middle;"></i> Cancel
                        </button>
                    </div>
                `;
            }

            container.innerHTML = html;
            initIcons();
        }

        async function editEvent(eventId) {
            const event = await loadEventDetails(eventId);
            if (!event) return;

            // Build spot options with current selection
            const spotOptions = spots.map(s => `<option value="${s.id}" ${s.name === event.location_name ? 'selected' : ''}>${s.name}</option>`).join('');

            const html = `
                <div style="margin-bottom: 20px;">
                    <h2 style="font-size: 20px; color: var(--text-primary); margin-bottom: 8px;">Edit Swim</h2>
                </div>

                <div class="form-group">
                    <div class="form-label">Swim Name</div>
                    <input type="text" id="editEventTitle" placeholder="e.g. Morning Skins at Glen Beach" value="${(event.title || '').replace(/"/g, '&quot;')}">
                </div>

                <div class="form-group">
                    <div class="form-label">Location</div>
                    <select id="editEventSpot" data-spots>${spotOptions}</select>
                </div>

                <div class="form-group">
                    <div class="form-label">Date & Time (SAST)</div>
                    <input type="datetime-local" id="editEventDateTime" value="${(function () {
                    const d = new Date(event.start_at);
                    const pad = (n) => String(n).padStart(2, '0');
                    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                })()}">
                </div>

                <div class="form-group">
                    <div class="form-label">Distance (km)</div>
                    <input type="number" id="editEventDistance" step="0.1" placeholder="e.g., 2.5" value="${event.distance_km || ''}">
                </div>

                <div class="form-group">
                    <div class="form-label">Pace Category</div>
                    <select id="editEventPace">
                        <option value="100" ${event.target_pace_sec_per_100m == 100 ? 'selected' : ''}>Fast (1:40/100m)</option>
                        <option value="120" ${event.target_pace_sec_per_100m == 120 ? 'selected' : ''}>Steady (2:00/100m)</option>
                        <option value="150" ${event.target_pace_sec_per_100m == 150 || !event.target_pace_sec_per_100m ? 'selected' : ''}>Social (2:30/100m)</option>
                        <option value="180" ${event.target_pace_sec_per_100m == 180 ? 'selected' : ''}>Developing (3:00/100m)</option>
                    </select>
                </div>

                <div class="form-group">
                    <div class="form-label">Route Type</div>
                    <select id="editEventRouteType">
                        <option value="loop" ${event.route_type === 'loop' ? 'selected' : ''}>Loop</option>
                        <option value="out_and_back" ${event.route_type === 'out_and_back' ? 'selected' : ''}>Out & back</option>
                        <option value="point_to_point" ${event.route_type === 'point_to_point' ? 'selected' : ''}>Point-to-point</option>
                    </select>
                </div>

                <div class="form-group">
                    <div class="form-label">Logistics Note</div>
                    <textarea id="editEventLogistics" placeholder="Lifts, car shuffle, etc...">${event.logistics_note || ''}</textarea>
                </div>

                <details style="margin-bottom: 20px; background: rgba(0,0,0,0.2); border-radius: 12px; padding: 4px;">
                    <summary style="cursor: pointer; padding: 12px; color: var(--text-secondary); font-size: 14px; font-weight: 600;">
                        Safety Recommendations
                    </summary>
                    <div style="padding: 12px;">
                        <label style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px; cursor: pointer;">
                            <input type="checkbox" id="editEventTowFloat" ${event.tow_float_recommended ? 'checked' : ''} style="width: 18px; height: 18px;">
                            <span style="font-size: 14px; color: var(--text-primary);">Tow float recommended</span>
                        </label>
                        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                            <input type="checkbox" id="editEventBrightCap" ${event.bright_cap_recommended ? 'checked' : ''} style="width: 18px; height: 18px;">
                            <span style="font-size: 14px; color: var(--text-primary);">Bright cap recommended</span>
                        </label>
                    </div>
                </details>

                <div class="form-group">
                    <div class="form-label">External Group Link</div>
                    <input type="url" id="editEventChatUrl" placeholder="WhatsApp link..." value="${event.external_chat_url || ''}">
                </div>

                <div style="display: flex; gap: 10px; margin-top: 20px;">
                    <button class="btn btn-success" style="flex: 1;" onclick="saveEventUpdates('${eventId}')">Save Changes</button>
                    <button class="btn" style="flex: 1; background: rgba(255,255,255,0.1);" onclick="showEventDetails('${eventId}')">Cancel</button>
                </div>
            `;

            document.getElementById('eventDetailsContent').innerHTML = html;
            document.getElementById('eventDetailsActions').innerHTML = '';
            // Re-populate spot dropdown with grouped options if available
            const editSpotSelect = document.getElementById('editEventSpot');
            if (editSpotSelect && typeof buildGroupedSpotOptions === 'function') {
                buildGroupedSpotOptions(editSpotSelect);
                // Re-select the current spot
                const currentSpot = spots.find(s => s.name === event.location_name);
                if (currentSpot) editSpotSelect.value = currentSpot.id;
            }
        }

        async function saveEventUpdates(eventId) {
            try {
                // Fetch current event to diff for smart notification
                const { data: oldEvt } = await supabaseClient
                    .from('swim_events')
                    .select('*')
                    .eq('id', eventId)
                    .single();

                const title = document.getElementById('editEventTitle').value.trim();
                const startAt = document.getElementById('editEventDateTime').value + ':00+02:00';
                const routeType = document.getElementById('editEventRouteType').value;
                const logistics = document.getElementById('editEventLogistics').value;
                const chatUrl = document.getElementById('editEventChatUrl').value;

                // New fields
                const spotId = document.getElementById('editEventSpot')?.value;
                const spot = spots.find(s => s.id === spotId);
                const locationName = spot ? spot.name : oldEvt?.location_name;
                const distanceKm = parseFloat(document.getElementById('editEventDistance')?.value) || 0;
                const targetPace = parseInt(document.getElementById('editEventPace')?.value, 10) || null;
                const towFloat = document.getElementById('editEventTowFloat')?.checked || false;
                const brightCap = document.getElementById('editEventBrightCap')?.checked || false;

                // Detect significant changes (ones that affect whether swimmers still want to come)
                const significantChanges = [];
                if (oldEvt) {
                    if (locationName && locationName !== oldEvt.location_name)
                        significantChanges.push(`Location: ${oldEvt.location_name} → ${locationName}`);
                    if (distanceKm && distanceKm !== oldEvt.distance_km)
                        significantChanges.push(`Distance: ${oldEvt.distance_km || '?'}km → ${distanceKm}km`);
                    const oldTime = new Date(oldEvt.start_at).getTime();
                    const newTime = new Date(startAt).getTime();
                    if (Math.abs(oldTime - newTime) > 60000)
                        significantChanges.push(`Time: ${new Date(startAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })} on ${new Date(startAt).toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })}`);
                    if (title && title !== oldEvt.title)
                        significantChanges.push(`Name: ${title}`);
                }
                const isSignificant = significantChanges.length > 0;
                const changeSummary = significantChanges.join(' · ');

                const { error } = await supabaseClient
                    .from('swim_events')
                    .update({
                        title: title || null,
                        start_at: startAt,
                        location_name: locationName,
                        lat: spot?.latitude || oldEvt?.lat || null,
                        lng: spot?.longitude || oldEvt?.lng || null,
                        distance_km: distanceKm,
                        target_pace_sec_per_100m: targetPace,
                        route_type: routeType,
                        tow_float_recommended: towFloat,
                        bright_cap_recommended: brightCap,
                        logistics_note: logistics,
                        external_chat_url: chatUrl,
                        last_change_summary: isSignificant ? changeSummary : oldEvt?.last_change_summary,
                        updated_at: new Date().toISOString(),
                        updated_by: currentUser.id
                    })
                    .eq('id', eventId);

                if (error) throw error;

                // Notify participants
                try {
                    const { data: participants } = await supabaseClient
                        .from('swim_participants')
                        .select('user_id, id, status')
                        .eq('swim_event_id', eventId)
                        .in('status', ['approved', 'requested']);

                    if (participants && participants.length > 0) {
                        const swimTitle = title || locationName || 'A swim';

                        // If significant changes: reset approved participants to needs_reconfirm
                        if (isSignificant) {
                            const approvedIds = participants
                                .filter(p => p.status === 'approved' && p.user_id !== currentUser.id)
                                .map(p => p.id);

                            if (approvedIds.length > 0) {
                                await supabaseClient
                                    .from('swim_participants')
                                    .update({ needs_reconfirm: true })
                                    .in('id', approvedIds);
                            }
                        }

                        const notifTitle = isSignificant ? 'Swim changed — please re-confirm' : 'Swim details updated';
                        const notifMsg = isSignificant
                            ? `"${swimTitle}" has changed: ${significantChanges.join(', ')}. Please re-confirm your RSVP.`
                            : `"${swimTitle}" has been updated.`;

                        for (const p of participants) {
                            if (p.user_id === currentUser.id) continue;
                            await notify(
                                p.user_id,
                                eventId,
                                'swim_updated',
                                notifTitle,
                                notifMsg,
                                { swim_event_id: eventId, needs_reconfirm: isSignificant }
                            );
                        }
                    }
                } catch (notifErr) {
                    console.error('Could not notify participants:', notifErr);
                }

                showToast(isSignificant ? 'Swim updated — participants notified to re-confirm!' : 'Swim details updated!', 'success');
                await showEventDetails(eventId);
                loadEvents();
                loadDashboard();
            } catch (err) {
                console.error('Error updating swim:', err);
                alert('Error updating swim: ' + err.message);
            }
        }

        async function joinEvent(eventId, action) {
            try {
                // Safety gate: require phone + emergency contact for join/confirm
                if (action !== 'maybe') {
                    const safe = await checkSafetyInfo();
                    if (!safe) return;
                }

                console.log('Joining/Confirming event:', eventId, 'with action:', action);

                // 1. Get event details to check for approval requirement
                const { data: event, error: eventError } = await supabaseClient
                    .from('swim_events')
                    .select('requires_approval')
                    .eq('id', eventId)
                    .single();

                if (eventError) throw eventError;

                // 2. Determine status
                // Rule: If requires_approval = true, Join/Maybe/Confirm -> 'requested'
                // Rule: If requires_approval = false, Join/Confirm -> 'approved'
                // Rule: Maybe is always 'requested' if we can't distinguish it without rsvp column? 
                // Actually, the prompt says "Join/Maybe/Confirm must create/update swim_participants.status = 'requested'" if requires_approval is true.
                // If requires_approval is false, Join/Confirm can set 'approved' immediately.
                let status = 'requested';
                if (!event.requires_approval && action !== 'maybe') {
                    status = 'approved';
                }

                // 3. Upsert into swim_participants
                // Rule: Leaving then re-joining should reset late_* columns to NULL.
                const { error } = await supabaseClient
                    .from('swim_participants')
                    .upsert({
                        swim_event_id: eventId,
                        user_id: currentUser.id,
                        status: status,
                        rsvp: action === 'maybe' ? 'maybe' : 'going',
                        needs_reconfirm: false,
                        late_status: null,
                        late_updated_at: null,
                        late_last_notified_at: null
                    }, { onConflict: 'swim_event_id,user_id' });

                if (error) throw error;

                console.log('Successfully updated participation in event:', eventId, 'to status:', status);

                // FORCE refresh event details modal if it's open
                const modal = document.getElementById('eventDetailsModal');
                if (modal && modal.style.display === 'block') {
                    await showEventDetails(eventId);
                }

                showToast(status === 'requested' ? "Request sent to host!" : "You're in!", 'success');

                loadEvents(); // Refresh list
                loadDashboard(); // Refresh dashboard
            } catch (err) {
                console.error('Error joining event:', err);
                alert('Error joining event: ' + err.message);
            }
        }

        async function leaveEvent(eventId) {
            if (!confirm('Cancel your RSVP for this swim?')) return;

            try {
                // Rule: "Cancel RSVP" should set status='left' (do not delete row).
                // 1. Fetch event details for notification
                const { data: eventData } = await supabaseClient
                    .from('swim_events')
                    .select('created_by, title, location_name, start_time')
                    .eq('id', eventId)
                    .single();

                // 2. Update status
                const { error } = await supabaseClient
                    .from('swim_participants')
                    .update({ status: 'left' })
                    .eq('swim_event_id', eventId)
                    .eq('user_id', currentUser.id);

                if (error) throw error;

                showToast('RSVP cancelled', 'info');

                // 3. Notify Creator
                if (eventData && eventData.created_by && eventData.created_by !== currentUser.id) {
                    const displayName = currentUser.user_metadata?.display_name || 'A swimmer';
                    const eventTitle = eventData.title || eventData.location_name;
                    const startTime = new Date(eventData.start_time).toLocaleString(undefined, {
                        weekday: 'short', hour: 'numeric', minute: '2-digit'
                    });

                    await notify(
                        eventData.created_by,
                        eventId,
                        'rsvp_cancelled',
                        'RSVP Cancelled',
                        `${displayName} cancelled their RSVP for ${eventTitle} (${startTime})`,
                        { swim_event_id: eventId, actor_user_id: currentUser.id, action: 'cancel_rsvp' }
                    );
                }

                // Refresh event details modal if it's open
                const modal = document.getElementById('eventDetailsModal');
                if (modal && modal.style.display === 'block') {
                    await showEventDetails(eventId); // Refresh the modal
                }

                loadEvents(); // Refresh events list
                loadDashboard(); // Refresh dashboard
            } catch (err) {
                alert('Error cancelling RSVP: ' + err.message);
            }
        }

        // Re-confirm or drop out after a swim has changed
        async function reconfirmRsvp(eventId, stillIn) {
            try {
                if (stillIn) {
                    // Clear the reconfirm flag — they're still coming
                    await supabaseClient
                        .from('swim_participants')
                        .update({ needs_reconfirm: false })
                        .eq('swim_event_id', eventId)
                        .eq('user_id', currentUser.id);

                    showToast("Great — you're still in!", 'success');
                    await showEventDetails(eventId);
                    loadEvents();
                } else {
                    // They're out — treat same as leaving
                    await supabaseClient
                        .from('swim_participants')
                        .update({ status: 'left', needs_reconfirm: false })
                        .eq('swim_event_id', eventId)
                        .eq('user_id', currentUser.id);

                    // Notify host
                    const { data: eventData } = await supabaseClient
                        .from('swim_events')
                        .select('created_by, title, location_name')
                        .eq('id', eventId)
                        .single();

                    if (eventData?.created_by && eventData.created_by !== currentUser.id) {
                        const displayName = currentUser.user_metadata?.display_name || 'A swimmer';
                        await notify(
                            eventData.created_by,
                            eventId,
                            'rsvp_cancelled',
                            'RSVP Cancelled',
                            `${displayName} dropped out after the swim details changed.`,
                            { swim_event_id: eventId, actor_user_id: currentUser.id, action: 'drop_out' }
                        );
                    }

                    showToast('No worries — RSVP cancelled', 'info');
                    await showEventDetails(eventId);
                    loadEvents();
                    loadDashboard();
                }
            } catch (err) {
                console.error('Error reconfirming RSVP:', err);
                showToast('Error: ' + err.message, 'error');
            }
        }

        // Mark user as running late
        async function markRunningLate(eventId, status, label) {
            if (!status) return;

            try {
                // 1. Get current member record
                const { data: member, error: memberError } = await supabaseClient
                    .from('swim_participants')
                    .select('*, profiles(display_name)')
                    .eq('swim_event_id', eventId)
                    .eq('user_id', currentUser.id)
                    .single();

                if (memberError || !member) {
                    showToast("You must RSVP 'Going' before using Running Late.", 'error');
                    return;
                }

                // Strict check: Status must be approved AND RSVP must be 'going'
                if (member.status !== 'approved' || member.rsvp !== 'going') {
                    showToast("You must RSVP 'Going' before using Running Late.", 'error');
                    return;
                }

                // Time Gating: 1 hour before to 2 hours after start_at
                const { data: eventData } = await supabaseClient
                    .from('swim_events')
                    .select('start_at')
                    .eq('id', eventId)
                    .single();

                if (eventData) {
                    const startAt = new Date(eventData.start_at);
                    const now = new Date();
                    const diffMs = now - startAt;
                    const diffMins = diffMs / (1000 * 60);

                    // -60 mins to +120 mins
                    if (diffMins < -60 || diffMins > 120) {
                        showToast("Running Late updates are only available near swim time.", 'error');
                        return;
                    }
                }

                // 2. Throttling logic
                const severity = {
                    'on_my_way': 1,
                    'late_5': 2,
                    'late_15': 3,
                    'late_30': 4
                };

                const lastNotified = member.late_last_notified_at ? new Date(member.late_last_notified_at) : null;
                const now = new Date();
                const diffMins = lastNotified ? (now - lastNotified) / 60000 : 999;

                const oldSeverity = severity[member.late_status] || 0;
                const newSeverity = severity[status] || 0;

                let shouldNotify = false;
                if (diffMins > 5) {
                    shouldNotify = true;
                } else if (newSeverity > oldSeverity) {
                    shouldNotify = true;
                }

                // 3. Update participant record
                const updateData = {
                    late_status: status,
                    late_updated_at: now.toISOString()
                };

                if (shouldNotify) {
                    updateData.late_last_notified_at = now.toISOString();
                }

                const { error: updateError } = await supabaseClient
                    .from('swim_participants')
                    .update(updateData)
                    .eq('id', member.id);

                if (updateError) throw updateError;

                // 4. Send notifications if needed
                if (shouldNotify) {
                    // Get event details
                    const { data: event } = await supabaseClient
                        .from('swim_events')
                        .select('title, location_name')
                        .eq('id', eventId)
                        .single();

                    // Get other approved participants
                    const { data: others } = await supabaseClient
                        .from('swim_participants')
                        .select('user_id')
                        .eq('swim_event_id', eventId)
                        .eq('status', 'approved')
                        .neq('user_id', currentUser.id);

                    if (others && others.length > 0) {
                        const displayName = member.profiles?.display_name || 'A swimmer';
                        const swimName = event.title || event.location_name;

                        // Extract minutes from label/status for payload
                        let minutes = 0;
                        if (status === 'late_5') minutes = 5;
                        else if (status === 'late_15') minutes = 15;
                        else if (status === 'late_30') minutes = 30;

                        for (const o of others) {
                            await notify(
                                o.user_id,
                                eventId,
                                'participant_late',
                                'Running late',
                                `${displayName} is running late (${label}) for ${swimName}`,
                                {
                                    swim_event_id: eventId,
                                    actor_user_id: currentUser.id,
                                    late_status: status,
                                    minutes: minutes
                                }
                            );
                        }
                    }
                }

                showToast(shouldNotify ? `Status updated and group notified: ${label}` : `Status updated: ${label}`, 'success');

                // Refresh detail and dashboard
                await viewEventDetails(eventId);
                loadDashboard();

            } catch (err) {
                console.error('Error marking late:', err);
                alert('Error updating late status: ' + err.message);
            }
        }

        async function cancelSwim(eventId) {
            if (!confirm("Are you sure you want to cancel this swim? This will notify all participants.")) return;

            try {
                // 1. Get event details and participants first
                const { data: event } = await supabaseClient
                    .from('swim_events')
                    .select('title, start_at, location_name')
                    .eq('id', eventId)
                    .single();

                const { data: participants } = await supabaseClient
                    .from('swim_participants')
                    .select('user_id')
                    .eq('swim_event_id', eventId)
                    .in('status', ['approved', 'requested']);

                // 2. Update status to cancelled
                const { error: cancelError } = await supabaseClient
                    .from('swim_events')
                    .update({ status: 'cancelled' })
                    .eq('id', eventId);

                if (cancelError) throw cancelError;

                // 3. Create notifications for all participants (except creator)
                if (participants && participants.length > 0) {
                    const eventDate = new Date(event.start_at).toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit'
                    }) + ' on ' + new Date(event.start_at).toLocaleDateString('en-US', {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short'
                    });

                    const swimTitle = event.title || event.location_name;
                    const message = `The swim "${swimTitle}" at ${eventDate} has been cancelled by the host.`;

                    for (const p of participants) {
                        if (p.user_id !== currentUser.id) {
                            await notify(
                                p.user_id,
                                eventId,
                                'swim_cancelled',
                                'Swim cancelled',
                                message,
                                { swim_event_id: eventId, status: 'cancelled' }
                            );
                        }
                    }
                }

                showToast('Swim cancelled and participants notified.', 'success');
                await viewEventDetails(eventId);
                loadEvents();
                loadDashboard();

            } catch (err) {
                console.error('Error cancelling swim:', err);
                alert('Error cancelling swim: ' + err.message);
            }
        }

        function showToast(message, type) {
            // Simple toast notification
            const toast = document.createElement('div');
            toast.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: ${type === 'success' ? 'var(--success)' : type === 'error' ? 'var(--danger)' : 'var(--ocean-blue)'};
                color: white;
                padding: 16px 24px;
                border-radius: 12px;
                font-weight: 600;
                z-index: 99999;
                animation: slideUp 0.3s ease;
            `;
            toast.textContent = message;
            document.body.appendChild(toast);

            setTimeout(() => {
                toast.style.animation = 'slideDown 0.3s ease';
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }

        // ========== PROFILE SETTINGS ==========

        // Global to store profile being edited
        let editingProfile = null;
        // Avatar options (ocean-themed Lucide icons)
        const AVATARS = [
            { icon: 'anchor', color: '#3b82f6', name: 'Anchor' },
            { icon: 'waves', color: '#06b6d4', name: 'Waves' },
            { icon: 'compass', color: '#10b981', name: 'Compass' },
            { icon: 'ship', color: '#f59e0b', name: 'Ship' },
            { icon: 'sailboat', color: '#ef4444', name: 'Sailboat' },
            { icon: 'fish', color: '#8b5cf6', name: 'Fish' },
            { icon: 'droplets', color: '#ec4899', name: 'Droplets' },
            { icon: 'gem', color: '#14b8a6', name: 'Gem' },
            { icon: 'zap', color: '#6366f1', name: 'Lightning' },
            { icon: 'flame', color: '#f97316', name: 'Flame' },
            { icon: 'star', color: '#84cc16', name: 'Star' },
            { icon: 'trophy', color: '#06b6d4', name: 'Trophy' },
            { icon: 'shield', color: '#0ea5e9', name: 'Shield' },
            { icon: 'target', color: '#22c55e', name: 'Target' },
            { icon: 'award', color: '#a855f7', name: 'Award' },
            { icon: 'crown', color: '#f43f5e', name: 'Crown' },
            { icon: 'sun', color: '#eab308', name: 'Sun' },
            { icon: 'wind', color: '#38bdf8', name: 'Wind' },
            { icon: 'mountain', color: '#64748b', name: 'Mountain' },
            { icon: 'activity', color: '#22c55e', name: 'Activity' },
            { icon: 'heart', color: '#e11d48', name: 'Heart' },
            { icon: 'dumbbell', color: '#7c3aed', name: 'Dumbbell' },
            { icon: 'timer', color: '#f97316', name: 'Timer' },
            { icon: 'binoculars', color: '#0ea5e9', name: 'Binoculars' }
        ];



        // Helper to update the header profile icon — supports both photo URLs and icon names
        function updateHeaderAvatar(avatarValue = 'user') {
            const avatarDiv = document.querySelector('.user-avatar');
            if (!avatarDiv) return;
            const isUrl = avatarValue && (avatarValue.startsWith('http') || avatarValue.startsWith('blob'));
            if (isUrl) {
                avatarDiv.innerHTML = `<img src="${avatarValue}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.innerHTML='<i data-lucide=\\'user\\' style=\\'width:18px;height:18px;color:white;\\'></i>'; if(window.lucide) lucide.createIcons();">`;
                avatarDiv.style.background = 'transparent';
                avatarDiv.style.borderColor = 'var(--ocean-light)';
            } else {
                const iconToUse = avatarValue || 'user';
                avatarDiv.innerHTML = `<i data-lucide="${iconToUse}" style="width: 18px; height: 18px; color: white;"></i>`;
                const avatarMeta = AVATARS.find(a => a.icon === iconToUse);
                if (avatarMeta) {
                    avatarDiv.style.background = avatarMeta.color;
                    avatarDiv.style.borderColor = avatarMeta.color;
                } else {
                    avatarDiv.style.background = 'linear-gradient(135deg, var(--ocean-blue) 0%, var(--ocean-dark) 100%)';
                    avatarDiv.style.borderColor = 'var(--ocean-light)';
                }
                if (window.lucide) lucide.createIcons();
            }
        }

        // Switch between Photo and Icon tabs in avatar picker
        function switchAvatarTab(tab) {
            const photoPanel = document.getElementById('avatarPhotoPanel');
            const iconPanel = document.getElementById('avatarIconPanel');
            const tabPhoto = document.getElementById('avatarTabPhoto');
            const tabIcon = document.getElementById('avatarTabIcon');
            if (!photoPanel || !iconPanel) return;
            const activeStyle = 'background:linear-gradient(135deg,var(--ocean-blue),var(--ocean-dark));color:white;border:2px solid var(--ocean-blue);border-radius:8px;padding:8px 16px;font-size:13px;font-weight:600;cursor:pointer;';
            const inactiveStyle = 'background:rgba(15,23,42,0.6);color:var(--text-secondary);border:2px solid rgba(56,189,248,0.15);border-radius:8px;padding:8px 16px;font-size:13px;font-weight:500;cursor:pointer;';
            if (tab === 'photo') {
                photoPanel.style.display = 'block';
                iconPanel.style.display = 'none';
                if (tabPhoto) tabPhoto.style.cssText = activeStyle;
                if (tabIcon) tabIcon.style.cssText = inactiveStyle;
            } else {
                photoPanel.style.display = 'none';
                iconPanel.style.display = 'block';
                if (tabPhoto) tabPhoto.style.cssText = inactiveStyle;
                if (tabIcon) tabIcon.style.cssText = activeStyle;
                renderAvatarGrid();
            }
        }

        // Render the circular photo preview in the upload panel
        function renderAvatarPhotoPreview(src) {
            const preview = document.getElementById('avatarPhotoPreview');
            if (!preview) return;
            if (src) {
                preview.innerHTML = `<img src="${src}" style="width:90px;height:90px;object-fit:cover;border-radius:50%;border:3px solid var(--ocean-light);display:block;margin:0 auto;">`;
            } else {
                preview.innerHTML = `<div style="width:90px;height:90px;border-radius:50%;border:2px dashed rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;margin:0 auto;color:var(--text-secondary);font-size:13px;">No photo</div>`;
            }
        }

        // Handle avatar photo file selection and upload to Supabase Storage
        async function handleAvatarFileSelect(event) {
            const file = event.target.files[0];
            if (!file) return;
            if (file.size > 2 * 1024 * 1024) { showToast('Photo must be under 2MB', 'error'); return; }
            if (!file.type.startsWith('image/')) { showToast('Please select an image file', 'error'); return; }

            // Validate and extract file extension
            const validExts = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
            const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : 'jpg';
            if (!validExts.includes(ext)) {
                showToast('Please use a JPG, PNG, or WEBP file', 'error');
                return;
            }

            // Show local preview immediately
            const reader = new FileReader();
            reader.onload = e => renderAvatarPhotoPreview(e.target.result);
            reader.readAsDataURL(file);

            // Upload to Supabase Storage
            const path = `${currentUser.id}/avatar.${ext}`;
            showToast('Uploading photo…', 'info');
            const { error } = await supabaseClient.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
            if (error) {
                console.error('Avatar upload error:', error);
                showToast('Upload failed: ' + error.message, 'error');
                return;
            }

            // Get public URL and set as selected avatar
            const { data } = supabaseClient.storage.from('avatars').getPublicUrl(path);
            selectedAvatar = data.publicUrl + '?t=' + Date.now(); // cache-bust on re-upload
            showToast('Photo uploaded ✓', 'success');
            renderAvatarPhotoPreview(selectedAvatar);
        }

        // ── Hazard Reporting ───────────────────────────────────────────────────────

        let selectedHazardSeverity = 'caution';
        let hazardPhotoUrl = null;

        function showHazardReport() {
            const modal = document.getElementById('hazardReportModal');
            if (!modal) return;
            modal.style.display = 'block';

            // Populate region dropdown
            const regSel = document.getElementById('hazardRegion');
            if (regSel) {
                let html = '<option value="">Select a region…</option>';
                domains.forEach(d => {
                    html += `<option value="${d.code}">${d.display_name}</option>`;
                });
                regSel.innerHTML = html;
                regSel.value = '';
            }

            // Reset spot dropdown — disabled until region chosen
            const spotSel = document.getElementById('hazardSpot');
            if (spotSel) {
                spotSel.innerHTML = '<option value="">Select a region first…</option>';
                spotSel.disabled = true;
            }

            hazardPhotoUrl = null;
            document.getElementById('hazardPhotoPreview').innerHTML = '';
            document.getElementById('hazardTitle').value = '';
            document.getElementById('hazardDescription').value = '';
            document.getElementById('hazardDuration').value = '24';
            selectSeverity('caution');
        }

        function updateHazardSpotsByRegion() {
            const regionCode = document.getElementById('hazardRegion')?.value;
            const spotSel = document.getElementById('hazardSpot');
            if (!spotSel) return;

            if (!regionCode) {
                spotSel.innerHTML = '<option value="">Select a region first…</option>';
                spotSel.disabled = true;
                return;
            }

            const regionSpots = spots
                .filter(s => s.domain === regionCode)
                .sort((a, b) => a.name.localeCompare(b.name));

            if (regionSpots.length === 0) {
                spotSel.innerHTML = '<option value="">No spots in this region</option>';
                spotSel.disabled = true;
                return;
            }

            let html = '<option value="">Select a spot…</option>';
            regionSpots.forEach(spot => {
                html += `<option value="${spot.id}">${spot.name}</option>`;
            });
            spotSel.innerHTML = html;
            spotSel.disabled = false;
        }

        function hideHazardReport() {
            const modal = document.getElementById('hazardReportModal');
            if (modal) modal.style.display = 'none';
            document.getElementById('hazardTitle').value = '';
            document.getElementById('hazardDescription').value = '';
            hazardPhotoUrl = null;
            document.getElementById('hazardPhotoPreview').innerHTML = '';
        }

        function selectSeverity(level) {
            selectedHazardSeverity = level;
            ['info','caution','danger'].forEach(l => {
                const el = document.getElementById('sev' + l.charAt(0).toUpperCase() + l.slice(1));
                if (el) el.classList.toggle('active', l === level);
            });
        }

        async function handleHazardPhotoSelect(event) {
            const file = event.target.files[0];
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) { showToast('Photo must be under 5MB', 'error'); return; }
            const validExts = ['jpg', 'jpeg', 'png', 'webp'];
            const ext = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : 'jpg';
            if (!validExts.includes(ext)) { showToast('Please use a JPG or PNG file', 'error'); return; }

            // Local preview
            const reader = new FileReader();
            reader.onload = e => {
                document.getElementById('hazardPhotoPreview').innerHTML =
                    `<img src="${e.target.result}" style="width:100%;max-height:160px;object-fit:cover;border-radius:8px;margin-bottom:4px;">`;
            };
            reader.readAsDataURL(file);

            // Upload to Supabase Storage
            const path = `${currentUser.id}/${Date.now()}.${ext}`;
            showToast('Uploading photo…', 'info');
            const { error } = await supabaseClient.storage.from('hazards').upload(path, file, { upsert: false, contentType: file.type });
            if (error) { console.error('Hazard photo upload error:', error); showToast('Photo upload failed: ' + error.message, 'error'); return; }
            const { data } = supabaseClient.storage.from('hazards').getPublicUrl(path);
            hazardPhotoUrl = data.publicUrl;
            showToast('Photo attached ✓', 'success');
        }

        async function submitHazardReport() {
            const btn = document.getElementById('submitHazardBtn');
            const spotId = document.getElementById('hazardSpot').value;
            const hazardType = document.getElementById('hazardType').value;
            const title = document.getElementById('hazardTitle').value.trim();
            const description = document.getElementById('hazardDescription').value.trim();
            const durationHours = parseInt(document.getElementById('hazardDuration').value, 10);

            if (!spotId) { showToast('Please select a location', 'error'); return; }
            if (!title) { showToast('Please add a short title', 'error'); return; }

            btn.disabled = true;
            btn.textContent = 'Submitting…';

            const activeUntil = durationHours > 0
                ? new Date(Date.now() + durationHours * 3600000).toISOString()
                : null;

            const { error } = await supabaseClient.from('hazard_reports').insert({
                user_id: currentUser.id,
                spot_id: spotId,
                hazard_type: hazardType,
                severity: selectedHazardSeverity,
                title,
                description: description || null,
                photo_url: hazardPhotoUrl,
                active_until: activeUntil
            });

            btn.disabled = false;
            btn.textContent = 'Submit Hazard Report';

            if (error) {
                console.error('Hazard report error:', error);
                showToast('Error submitting: ' + error.message, 'error');
                return;
            }

            showToast('Hazard reported — thanks for keeping swimmers safe!', 'success');
            hideHazardReport();
            loadHazards();
            loadDashboard();

            // Notify participants of upcoming swims at/near the affected spot
            try {
                const hazardSpot = spots.find(s => s.id === spotId);
                const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 3600000).toISOString();
                console.log('[Hazard notify] hazardSpot:', hazardSpot?.name, hazardSpot?.latitude, hazardSpot?.longitude);

                const { data: affectedSwims, error: swimsErr } = await supabaseClient
                    .from('swim_events')
                    .select('id, title, location_name, lat, lng, spot_id, status')
                    .neq('status', 'cancelled')
                    .gte('start_at', new Date().toISOString())
                    .lte('start_at', sevenDaysFromNow);

                console.log('[Hazard notify] upcoming swims found:', affectedSwims?.length, swimsErr);

                const nearbySwims = (affectedSwims || []).filter(ev => {
                    if (ev.spot_id === spotId) { console.log('[Hazard notify] spot_id match:', ev.title); return true; }
                    if (ev.lat && ev.lng && hazardSpot) {
                        const dist = getDistanceKm(ev.lat, ev.lng, hazardSpot.latitude, hazardSpot.longitude);
                        console.log('[Hazard notify] dist check:', ev.title, dist.toFixed(1) + 'km');
                        return dist < 10; // 10km radius covers full False Bay south peninsula corridor
                    }
                    console.log('[Hazard notify] no coords for:', ev.title);
                    return false;
                });

                console.log('[Hazard notify] nearbySwims:', nearbySwims.map(s => s.title));

                for (const swim of nearbySwims) {
                    const { data: participants } = await supabaseClient
                        .from('swim_participants')
                        .select('user_id')
                        .eq('swim_event_id', swim.id)
                        .in('status', ['approved', 'requested']);

                    console.log('[Hazard notify] participants for', swim.title, ':', participants?.length);

                    for (const p of (participants || [])) {
                        if (p.user_id === currentUser.id) continue;
                        await notify(
                            p.user_id,
                            swim.id,
                            'hazard_alert',
                            `Hazard at ${hazardSpot?.name || 'your swim location'}`,
                            `${title} — affects your upcoming swim: ${swim.title}`,
                            { hazard_spot_id: spotId }
                        );
                    }
                }

                if (nearbySwims.length > 0) {
                    console.log(`[Hazard notify] Done — notifications sent for ${nearbySwims.length} affected swim(s)`);
                } else {
                    console.log('[Hazard notify] No nearby swims found — no notifications sent');
                }
            } catch (notifyErr) {
                console.error('Hazard notify error (non-fatal):', notifyErr);
            }
        }

        async function loadHazards() {
            const el = document.getElementById('activeHazardsList');
            if (!el) return;
            el.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;">Loading…</div>';
            try {
                // Fetch hazards + reporter name (avoid spots join — look up spot name from local spots array)
                const { data: allHazards, error } = await supabaseClient
                    .from('hazard_reports')
                    .select('id, spot_id, hazard_type, severity, title, description, photo_url, active_until, resolved_at, created_at, user_id, profiles(display_name)')
                    .is('resolved_at', null)
                    .order('created_at', { ascending: false });

                console.log('[loadHazards] result:', allHazards?.length, error);

                if (error) {
                    console.error('loadHazards error:', error);
                    el.innerHTML = '<div style="color:var(--danger);font-size:13px;">Error loading hazards: ' + error.message + '</div>';
                    return;
                }

                // Filter out expired hazards in JS
                const now = Date.now();
                const hazards = (allHazards || []).filter(h =>
                    !h.active_until || new Date(h.active_until).getTime() > now
                );

                // Attach spot name from local spots array
                hazards.forEach(h => {
                    const spot = spots.find(s => s.id === h.spot_id);
                    h._spotName = spot?.name || 'Unknown spot';
                });

                renderActiveHazards(hazards);
            } catch (e) {
                console.error('[loadHazards] exception:', e);
                el.innerHTML = '<div style="color:var(--danger);font-size:13px;">Error loading hazards</div>';
            }
        }

        let _fdSafetyValue = '';

        function onSafetyRegionChange() {
            renderSafetyRegionalContent();
        }

        function populateSafetyRegionSelect() {
            const panel = document.getElementById('fdSafetyPanel');
            if (!panel || !domains.length) return;
            const home = currentUserProfile?.home_domain || '';
            if (home) {
                _fdSafetyValue = home;
                const homeLabel = (domains.find(d => d.code === home)?.display_name || home) + ' (home)';
                const labelEl = document.getElementById('fdSafetyLabel');
                if (labelEl) labelEl.textContent = homeLabel;
                const trigger = document.getElementById('fdSafetyTrigger');
                if (trigger) trigger.classList.add('fd-active');
            }
            let html = '';
            if (!home) html = `<div class="fd-option fd-selected" data-value="" onclick="fdSafetySelect('','Select region…')">Select region…</div>`;
            domains
                .filter(d => d.code !== 'INLAND')
                .forEach(d => {
                    const label = d.display_name + (d.code === home ? ' (home)' : '');
                    const sel = d.code === home ? 'fd-selected' : '';
                    html += `<div class="fd-option ${sel}" data-value="${d.code}" onclick="fdSafetySelect('${d.code}','${label}')">${label}</div>`;
                });
            panel.innerHTML = html;
            if (home) renderSafetyRegionalContent();
        }

        function fdSafetySelect(value, label) {
            _fdSafetyValue = value;
            const labelEl = document.getElementById('fdSafetyLabel');
            if (labelEl) labelEl.textContent = label || 'Select region…';
            const trigger = document.getElementById('fdSafetyTrigger');
            if (trigger) { trigger.classList.remove('fd-open'); trigger.classList.toggle('fd-active', !!value); }
            const panel = document.getElementById('fdSafetyPanel');
            if (panel) {
                panel.classList.remove('fd-open');
                panel.querySelectorAll('.fd-option').forEach(o => o.classList.toggle('fd-selected', o.dataset.value === value));
            }
            renderSafetyRegionalContent();
        }

        function renderSafetyRegionalContent() {
            const domain = _fdSafetyValue || (currentUserProfile?.home_domain || '');

            // ── Region group lookup — add new domains here as the app grows ──────
            const SAFETY_GROUP = {
                ATLANTIC:     'cape',
                FALSE_BAY:    'cape',
                WEST_COAST:   'cape',
                SOUTH_COAST:  'cape',
                GARDEN_ROUTE: 'garden_route',
                EASTERN_CAPE: 'eastern_cape',
                KZN:          'kzn',
                NAMIBIA:           'namibia',
                UK:                'uk',
                EUROPE:            'europe',
                WESTERN_AUSTRALIA: 'western_australia',
                USA:               'usa',
            };
            const group = SAFETY_GROUP[domain] || '';

            const isIntlGroup = group === 'uk' || group === 'europe' || group === 'western_australia' || group === 'usa';

            // ── Show/hide sharks section — no sharks for UK/Europe (WA has sharks) ─
            const sharksSection = document.getElementById('sharksSection');
            if (sharksSection) {
                const noSharks = group === 'uk' || group === 'europe';
                sharksSection.style.display = noSharks ? 'none' : '';
            }

            // ── Swap national emergency contacts for international regions ────────
            const contactsList = document.getElementById('safetyEmergencyContactsList');
            if (contactsList) {
                if (isIntlGroup) {
                    const intlNational = group === 'uk'
                        ? `<a href="tel:999" style="display:flex;justify-content:space-between;align-items:center;background:rgba(0,0,0,0.3);padding:12px;border-radius:8px;text-decoration:none;border:1px solid rgba(255,255,255,0.05);">
                            <div><div style="display:flex;align-items:center;gap:8px;color:var(--text-primary);font-weight:700;font-size:14px;"><i data-lucide="phone-call" style="width:14px;height:14px;flex-shrink:0;"></i> Emergency Services</div><div style="color:var(--text-secondary);font-size:11px;margin-top:2px;">Police · Ambulance · Fire · Coastguard</div></div>
                            <span style="color:#38bdf8;font-weight:800;font-size:15px;white-space:nowrap;margin-left:12px;">999</span></a>`
                        : group === 'western_australia'
                        ? `<a href="tel:000" style="display:flex;justify-content:space-between;align-items:center;background:rgba(0,0,0,0.3);padding:12px;border-radius:8px;text-decoration:none;border:1px solid rgba(255,255,255,0.05);">
                            <div><div style="display:flex;align-items:center;gap:8px;color:var(--text-primary);font-weight:700;font-size:14px;"><i data-lucide="phone-call" style="width:14px;height:14px;flex-shrink:0;"></i> Emergency Services</div><div style="color:var(--text-secondary);font-size:11px;margin-top:2px;">Police · Ambulance · Fire · Sea Rescue</div></div>
                            <span style="color:#38bdf8;font-weight:800;font-size:15px;white-space:nowrap;margin-left:12px;">000</span></a>`
                        : group === 'usa'
                        ? `<a href="tel:911" style="display:flex;justify-content:space-between;align-items:center;background:rgba(0,0,0,0.3);padding:12px;border-radius:8px;text-decoration:none;border:1px solid rgba(255,255,255,0.05);">
                            <div><div style="display:flex;align-items:center;gap:8px;color:var(--text-primary);font-weight:700;font-size:14px;"><i data-lucide="phone-call" style="width:14px;height:14px;flex-shrink:0;"></i> Emergency Services</div><div style="color:var(--text-secondary);font-size:11px;margin-top:2px;">Police · Ambulance · Fire · Coast Guard</div></div>
                            <span style="color:#38bdf8;font-weight:800;font-size:15px;white-space:nowrap;margin-left:12px;">911</span></a>`
                        : `<a href="tel:112" style="display:flex;justify-content:space-between;align-items:center;background:rgba(0,0,0,0.3);padding:12px;border-radius:8px;text-decoration:none;border:1px solid rgba(255,255,255,0.05);">
                            <div><div style="display:flex;align-items:center;gap:8px;color:var(--text-primary);font-weight:700;font-size:14px;"><i data-lucide="phone-call" style="width:14px;height:14px;flex-shrink:0;"></i> Emergency Services</div><div style="color:var(--text-secondary);font-size:11px;margin-top:2px;">Police · Ambulance · Fire · Rescue</div></div>
                            <span style="color:#38bdf8;font-weight:800;font-size:15px;white-space:nowrap;margin-left:12px;">112</span></a>`;
                    contactsList.innerHTML = intlNational + '<div id="safetyRegionalContacts"></div>';
                } else {
                    // Restore SA defaults if switching back from international
                    if (!contactsList.querySelector('a[href="tel:0870949774"]')) {
                        contactsList.innerHTML = `
                            <a href="tel:0870949774" style="display:flex;justify-content:space-between;align-items:center;background:rgba(0,0,0,0.3);padding:12px;border-radius:8px;text-decoration:none;border:1px solid rgba(255,255,255,0.05);">
                                <div><div style="display:flex;align-items:center;gap:8px;color:var(--text-primary);font-weight:700;font-size:14px;"><i data-lucide="anchor" style="width:14px;height:14px;flex-shrink:0;"></i> NSRI Sea Rescue</div><div style="color:var(--text-secondary);font-size:11px;margin-top:2px;">National · Water rescue / missing swimmer</div></div>
                                <span style="color:#38bdf8;font-weight:800;font-size:15px;white-space:nowrap;margin-left:12px;">087 094 9774</span></a>
                            <a href="tel:10177" style="display:flex;justify-content:space-between;align-items:center;background:rgba(0,0,0,0.3);padding:12px;border-radius:8px;text-decoration:none;border:1px solid rgba(255,255,255,0.05);">
                                <div><div style="display:flex;align-items:center;gap:8px;color:var(--text-primary);font-weight:700;font-size:14px;"><i data-lucide="ambulance" style="width:14px;height:14px;flex-shrink:0;"></i> Ambulance</div><div style="color:var(--text-secondary);font-size:11px;margin-top:2px;">National · Medical emergency</div></div>
                                <span style="color:#38bdf8;font-weight:800;font-size:15px;white-space:nowrap;margin-left:12px;">10177</span></a>
                            <a href="tel:10111" style="display:flex;justify-content:space-between;align-items:center;background:rgba(0,0,0,0.3);padding:12px;border-radius:8px;text-decoration:none;border:1px solid rgba(255,255,255,0.05);">
                                <div><div style="display:flex;align-items:center;gap:8px;color:var(--text-primary);font-weight:700;font-size:14px;"><i data-lucide="shield" style="width:14px;height:14px;flex-shrink:0;"></i> Police</div><div style="color:var(--text-secondary);font-size:11px;margin-top:2px;">National · Immediate danger</div></div>
                                <span style="color:#38bdf8;font-weight:800;font-size:15px;white-space:nowrap;margin-left:12px;">10111</span></a>
                            <div id="safetyRegionalContacts"></div>`;
                    }
                }
            }

            // ── No region selected — prompt user to pick one ─────────────────────
            const noRegionBanner = document.getElementById('safetyNoRegionBanner');
            if (noRegionBanner) noRegionBanner.style.display = group ? 'none' : '';

            // ── Seal content: Cape Fur Seals (+ rabies) present in WC and Namibia ─
            const showSeals = group === 'cape' || group === 'namibia';
            const sealVaccineTip = document.getElementById('sealVaccineTip');
            if (sealVaccineTip) sealVaccineTip.style.display = showSeals ? '' : 'none';
            ['sealBiteSection','sealsMarineSection'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = showSeals ? '' : 'none';
            });

            // ── Regional alert tip card ──────────────────────────────────────────
            const alertTip = document.getElementById('regionalAlertTip');
            if (alertTip) {
                const ALERT_TIPS = {
                    kzn: {
                        color: '#ef4444', icon: 'bell', title: 'KZN Shark Alerts',
                        body: 'Download the <strong>SharkSmart app</strong> for real-time KZN Sharks Board alerts. The Sharks Board maintains protective nets and drum lines at major KZN beaches — always check net status before swimming at unfamiliar spots.',
                    },
                    garden_route: {
                        color: '#f59e0b', icon: 'alert-triangle', title: 'Garden Route Hazards',
                        body: 'Watch for strong tidal flows and currents in estuaries and lagoons (Knysna, Keurbooms). No shark nets in this region — Great White and Zambezi sharks are present. Check CapeNature alerts before open water swims.',
                    },
                    eastern_cape: {
                        color: '#f59e0b', icon: 'alert-triangle', title: 'Eastern Cape Conditions',
                        body: 'No shark nets on most PE/Gqeberha beaches. During the <strong>Sardine Run (June–July)</strong> shark activity is elevated along the coast. Zambezi/Bull sharks frequent river mouths. Monitor local advisories.',
                    },
                    namibia: {
                        color: '#ef4444', icon: 'wifi-off', title: 'Remote Swimming — Extra Caution',
                        body: 'Namibia\'s coastline is remote. Nearest hospital may be hours away. Always swim with a buddy, notify someone of your plan, and consider carrying a PLB (Personal Locator Beacon). Cold shock risk is HIGH (Benguela current 10–15°C).',
                    },
                    uk: {
                        color: '#f59e0b', icon: 'alert-triangle', title: 'UK Open Water Hazards',
                        body: 'Check <strong>Swim England</strong> or local club advisories before swimming at unfamiliar spots. Blue-green algae blooms are common in lakes and reservoirs May–September — if water looks green/foamy, stay out. Cold shock risk is HIGH in winter (UK rivers/lakes 3–10°C).',
                    },
                    europe: {
                        color: '#f59e0b', icon: 'alert-triangle', title: 'European Open Water Hazards',
                        body: 'Water quality varies by country. Check local bathing water status before swimming. Blue-green algae blooms occur in warm, calm freshwater in summer. Cold shock is a real risk in northern European waters.',
                    },
                    western_australia: {
                        color: '#ef4444', icon: 'alert-triangle', title: 'WA Shark Alert',
                        body: 'Western Australia has one of the highest rates of shark encounters globally. Download the <strong>SharkSmart WA app</strong> for real-time alerts. Always swim between the flags at patrolled beaches and check Surf Life Saving WA advisories before entering the water.',
                    },
                    usa: {
                        color: '#f59e0b', icon: 'alert-triangle', title: 'San Francisco Bay — Know Before You Go',
                        body: '<strong>Aquatic Park</strong> is sheltered and generally safe year-round. <strong>Ocean Beach</strong> is a different story — extremely strong rip currents, cold Pacific surf, and no lifeguards year-round. Great White Sharks are active near the Farallon Islands (25 miles offshore) and occasionally enter the Bay. Water is cold (12–16°C) — acclimatise gradually.',
                    },
                };
                const tip = ALERT_TIPS[group];
                if (tip) {
                    const rgb = tip.color === '#ef4444' ? '239,68,68' : '245,158,11';
                    alertTip.style.display = '';
                    alertTip.innerHTML = `<div style="background:rgba(${rgb},0.08);border:1px solid ${tip.color}40;border-left:3px solid ${tip.color};border-radius:10px;padding:12px;margin-bottom:2px;">
                        <div style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:13px;color:var(--text-primary);margin-bottom:4px;">
                            <i data-lucide="${tip.icon}" style="width:13px;height:13px;"></i> ${tip.title}
                        </div>
                        <div style="font-size:12px;color:var(--text-secondary);line-height:1.6;">${tip.body.replace(/<strong>/g,'<strong style="color:var(--text-primary);">')}</div>
                    </div>`;
                } else {
                    alertTip.style.display = 'none';
                    alertTip.innerHTML = '';
                }
            }

            // ── Shark regional note (inside Marine Life section) ─────────────────
            const SHARK_NOTES = {
                cape:         `<strong>Western Cape:</strong> No shark nets on most Cape beaches. Great White Sharks prevalent near seal colonies (Duiker Island, Boulders, Dyer Island). Check <a href="https://www.sharkspotters.org.za" target="_blank" style="color:#38bdf8;">Shark Spotters</a> flag status before swimming.`,
                garden_route: `<strong>Garden Route:</strong> No shark nets. Great White and Zambezi/Bull sharks possible, especially near river mouths and estuaries (Knysna Lagoon, Keurbooms River). Check CapeNature advisories.`,
                eastern_cape: `<strong>Eastern Cape:</strong> No shark nets on most PE/Gqeberha beaches. Zambezi/Bull sharks active near river mouths (Sundays River, Bushmans). Sardine Run (June–July) brings elevated shark activity along the entire EC coastline.`,
                kzn:          `<strong>KwaZulu-Natal:</strong> KZN Sharks Board protective nets and drum lines at most major beaches. Download the <strong>SharkSmart app</strong> for real-time alerts. Always check net status at unfamiliar spots.`,
                namibia:      `<strong>Namibia:</strong> No shark nets. Remote coastline with limited rescue infrastructure. Great White and Zambezi/Bull sharks present. Always swim with a buddy.`,
                uk:                null,
                europe:            null,
                western_australia: `<strong>Western Australia:</strong> Great White Sharks are active along the WA coast year-round. No shark nets at Cottesloe — swim at patrolled beaches between the flags. Download the <strong>SharkSmart WA app</strong> for real-time tagged shark alerts.`,
                usa:               `<strong>San Francisco Bay Area:</strong> Great White Sharks patrol the waters near the Farallon Islands (25 miles offshore) and are occasionally tracked entering the Bay. Attacks inside Aquatic Park are extremely rare — the cove has a 50+ year safety record. Check the <strong>Shark Net app</strong> for tagged shark activity off the California coast.`,
            };
            const sharksNote = document.getElementById('sharksRegionalNote');
            if (sharksNote) {
                const note = SHARK_NOTES[group];
                sharksNote.innerHTML = note
                    ? `<div style="margin-top:8px;padding:8px 10px;background:rgba(239,68,68,0.07);border-radius:8px;font-size:12px;color:var(--text-secondary);line-height:1.5;">${note.replace(/<strong>/g,'<strong style="color:var(--text-primary);">')}</div>`
                    : '';
            }

            // ── Cold water note (inside Cold Water section) ──────────────────────
            const COLD_NOTES = {
                cape:         `<strong>Western Cape temps:</strong> Atlantic 10–14°C · False Bay 14–18°C. Cold shock on entry is a real risk — acclimatise gradually and never swim alone in cold water.`,
                garden_route: `<strong>Garden Route temps:</strong> 18–22°C (Agulhas current). Can drop after upwelling events. Cold shock less likely than the Cape — still dress warmly after swimming.`,
                eastern_cape: `<strong>Eastern Cape temps:</strong> 17–22°C (mixed Agulhas/Benguela). Cooler in winter. Conditions can vary — always check local reports before open water swims.`,
                kzn:          `<strong>KZN temps:</strong> Indian Ocean 22–28°C. Hypothermia risk is low, but monitor for thermoclines (sudden cold layers) in deeper open water and after heavy rainfall.`,
                namibia:      `<strong>Namibia temps:</strong> Cold Benguela current keeps water at 10–15°C year-round. Cold shock risk is HIGH — same as Cape Atlantic. Nearest hospital may be very far away.`,
                uk:                `<strong>UK temps:</strong> Rivers, lakes and lidos range from 3–8°C in winter to 16–20°C in summer. Cold shock on entry is a serious risk in cooler months — acclimatise gradually, never swim alone, and have warm layers ready immediately after.`,
                europe:            `<strong>European open water:</strong> Temperatures vary widely by region and season. Nordic/Alpine lakes can be 5–15°C even in summer. Check local conditions before swimming and always have a warm change ready.`,
                western_australia: `<strong>WA (Indian Ocean) temps:</strong> Perth's Indian Ocean runs 17–22°C in summer and 15–18°C in winter — comfortable year-round. Cold shock is a low risk, but be aware of strong afternoon sea breezes (Fremantle Doctor) creating chop and currents at exposed beaches.`,
                usa:               `<strong>San Francisco Bay temps:</strong> Aquatic Park runs 12–16°C year-round — cold even in summer, thanks to Pacific upwelling. The Pacific at Ocean Beach is typically 11–14°C. Cold shock on entry is a real risk. The local Dolphin Club and South End Rowing Club swim here daily without wetsuits — acclimatise gradually.`,
            };
            const coldNote = document.getElementById('coldWaterRegionalNote');
            if (coldNote) {
                const note = COLD_NOTES[group];
                coldNote.innerHTML = note
                    ? `<div style="margin-top:8px;padding:8px 10px;background:rgba(56,189,248,0.07);border-radius:8px;font-size:12px;color:var(--text-secondary);line-height:1.5;">${note.replace(/<strong>/g,'<strong style="color:var(--text-primary);">')}</div>`
                    : '';
            }

            // ── Helper: contact card row ─────────────────────────────────────────
            function contactCard(href, icon, label, sub, phone, phoneColor) {
                const col = phoneColor || '#38bdf8';
                return `<a href="${href}" ${href.startsWith('http') ? 'target="_blank"' : ''} style="display:flex;justify-content:space-between;align-items:center;background:rgba(0,0,0,0.3);padding:12px;border-radius:8px;text-decoration:none;border:1px solid rgba(255,255,255,0.05);">
                    <div>
                        <div style="display:flex;align-items:center;gap:8px;color:var(--text-primary);font-weight:700;font-size:14px;"><i data-lucide="${icon}" style="width:14px;height:14px;flex-shrink:0;"></i> ${label}</div>
                        <div style="color:var(--text-secondary);font-size:11px;margin-top:2px;">${sub}</div>
                    </div>
                    <span style="color:${col};font-weight:800;font-size:15px;white-space:nowrap;margin-left:12px;">${phone}</span>
                </a>`;
            }

            // ── Regional emergency contacts (added below national) ───────────────
            const REGIONAL_CONTACTS = {
                cape:         [['tel:0214807700','building-2','City of Cape Town','Beach closures · Coastal emergencies','021 480 7700']],
                garden_route: [['tel:0832362924','leaf','CapeNature','Wildlife incidents · Nature reserves','083 236 2924']],
                eastern_cape: [['tel:0415073911','anchor','NSRI PE (Station 6)','Water rescue · Nelson Mandela Bay','041 507 3911']],
                kzn:          [
                    ['tel:0315664400','shield-alert','KZN Sharks Board','Shark incidents · Marine safety','031 566 0400'],
                    ['tel:0313617500','anchor','NSRI Durban','Local water rescue · Station 5','031 361 7500'],
                    ['tel:0313119900','building-2','eThekwini Emergency','City emergency services','031 311 9900'],
                ],
                namibia:      [['tel:112','phone','Emergency (from mobile)','Police · Ambulance · Rescue','112']],
                uk:           [
                    ['tel:999','phone','Emergency Services','Police · Ambulance · Fire','999'],
                    ['tel:999','anchor','HM Coastguard','Maritime emergency · Coastal rescue','999'],
                    ['tel:116006','heart','Samaritans','Mental health emergency','116 006'],
                ],
                europe:            [['tel:112','phone','European Emergency','Police · Ambulance · Rescue','112']],
                western_australia: [
                    ['tel:000','phone','Emergency Services','Police · Ambulance · Fire','000'],
                    ['tel:1800075111','anchor','Volunteer Sea Rescue','VMRWA — Marine emergency · WA coastline','1800 075 111'],
                ],
                usa: [
                    ['tel:911','phone','Emergency Services','Police · Ambulance · Fire · Coast Guard','911'],
                    ['tel:14153995555','anchor','USCG Sector San Francisco','US Coast Guard · Marine emergency','415-399-3547'],
                ],
            };
            const contactsEl = document.getElementById('safetyRegionalContacts');
            if (contactsEl) {
                contactsEl.innerHTML = (REGIONAL_CONTACTS[group] || []).map(c => contactCard(...c)).join('');
            }

            // ── Regional reporting section ───────────────────────────────────────
            const REGIONAL_REPORTING = {
                cape: { title: 'Reporting (Western Cape)', contacts: [
                    ['tel:0217004158','paw-print','Cape of Good Hope SPCA','Rabid / injured seals on beach','021 700 4158'],
                    ['tel:0832362924','leaf','CapeNature','Wildlife incidents · Nature reserve areas','083 236 2924'],
                    ['tel:0217830234','mountain-snow','Table Mountain National Park','TMNP coastline incidents','021 783 0234'],
                    ['tel:0860103089','droplets','Coastal Pollution / Water Quality','City of Cape Town — sewage, pollution, closures','0860 103 089'],
                    ['https://wa.me/27600181505','message-circle','City WhatsApp Line','Report coastal issues via WhatsApp','060 018 1505','#25d366'],
                ]},
                garden_route: { title: 'Reporting (Garden Route)', contacts: [
                    ['tel:0832362924','leaf','CapeNature','Wildlife incidents · Nature reserve areas','083 236 2924'],
                    ['tel:0448022455','mountain-snow','Garden Route National Park','Wilderness · Knysna · Tsitsikamma coastline','044 802 2455'],
                ]},
                eastern_cape: { title: 'Reporting (Eastern Cape)', contacts: [
                    ['tel:0415073911','anchor','NSRI PE (Station 6)','Water rescue · Nelson Mandela Bay','041 507 3911'],
                    ['tel:0415085800','leaf','DEDEAT Nature Conservation','Eastern Cape wildlife incidents','041 508 5800'],
                ]},
                kzn: { title: 'Reporting (KwaZulu-Natal)', contacts: [
                    ['tel:0338451000','leaf','Ezemvelo KZN Wildlife','Marine / nature reserve incidents','033 845 1000'],
                    ['tel:0315664400','shield-alert','KZN Sharks Board','Report shark incidents · Beach nets','031 566 0400'],
                ]},
                namibia: { title: 'Reporting (Namibia)', contacts: [
                    ['tel:112','phone','Namibia Emergency (mobile)','Police · Ambulance · Search & Rescue','112'],
                ]},
                uk: { title: 'Reporting (United Kingdom)', contacts: [
                    ['tel:999','anchor','HM Coastguard','Maritime emergency · Coastal rescue','999'],
                    ['https://www.environmentagency.gov.uk/','droplets','Environment Agency','Water quality · Pollution incidents','0800 807 060'],
                    ['https://www.wildswimming.co.uk/','waves','Outdoor Swimming Society','Community advice · UK swim spots','wildswimming.co.uk'],
                ]},
                europe: { title: 'Reporting (Europe)', contacts: [
                    ['tel:112','phone','European Emergency','Police · Ambulance · Rescue','112'],
                ]},
                western_australia: { title: 'Reporting (Western Australia)', contacts: [
                    ['tel:000','phone','Emergency Services','Police · Ambulance · Fire','000'],
                    ['https://www.sharksmart.com.au/','shield-alert','SharkSmart WA','Report shark sightings · Real-time alerts','sharksmart.com.au'],
                    ['tel:0897226300','droplets','WA Dept of Water & Environmental Reg.','Water quality · Pollution incidents','08 9722 6300'],
                ]},
                usa: { title: 'Reporting (San Francisco)', contacts: [
                    ['tel:911','phone','Emergency Services','Police · Ambulance · Fire · Coast Guard','911'],
                    ['tel:14153995555','anchor','USCG Sector San Francisco','Marine emergency · Search & rescue','415-399-3547'],
                    ['tel:14157050100','droplets','SF Bay Regional Water Quality','Pollution · Sewage · Water quality incidents','415-705-0100'],
                ]},
            };
            const reportingEl = document.getElementById('safetyRegionalReporting');
            if (reportingEl) {
                const rd = REGIONAL_REPORTING[group];
                if (rd) {
                    reportingEl.innerHTML = `<div style="background:rgba(30,41,59,0.8);border-radius:12px;padding:16px;margin-bottom:16px;border:1px solid rgba(255,255,255,0.1);">
                        <div style="font-weight:700;color:var(--text-primary);margin-bottom:12px;font-size:16px;display:flex;align-items:center;gap:8px;">
                            <i data-lucide="flag" style="width:18px;height:18px;color:#38bdf8;"></i> ${rd.title}
                        </div>
                        <div style="display:grid;gap:8px;">${rd.contacts.map(c => contactCard(...c)).join('')}</div>
                    </div>`;
                } else {
                    reportingEl.innerHTML = '';
                }
            }
        }

        function renderActiveHazards(hazards) {
            const el = document.getElementById('activeHazardsList');
            if (!el) return;
            if (hazards.length === 0) {
                el.innerHTML = `<div style="display:flex;align-items:center;gap:8px;color:var(--text-secondary);font-size:13px;padding:8px 0;">
                    <span style="width:8px;height:8px;border-radius:50%;background:#10b981;flex-shrink:0;display:inline-block;"></span>
                    No active hazards reported — all clear
                </div>`;
                return;
            }
            const severityColour = { info: '#38bdf8', caution: '#f59e0b', danger: '#ef4444' };
            const severityLabel  = { info: 'INFO', caution: 'CAUTION', danger: 'DANGER' };
            el.innerHTML = hazards.map(h => {
                const col   = severityColour[h.severity] || '#f59e0b';
                const label = severityLabel[h.severity]  || 'CAUTION';
                const when  = getTimeAgo(new Date(h.created_at));
                const expiryDate = h.active_until ? new Date(h.active_until) : null;
                const expires = expiryDate
                    ? `Expires ${expiryDate.toLocaleDateString('en-ZA', { weekday:'short', day:'numeric', month:'short' })} at ${expiryDate.toLocaleTimeString('en-ZA', { hour:'2-digit', minute:'2-digit' })}`
                    : 'No expiry set';
                return `
                <div style="background:rgba(239,68,68,0.08);border:1px solid ${col}40;border-left:3px solid ${col};border-radius:10px;padding:12px;margin-bottom:10px;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                        <span style="font-size:10px;font-weight:800;color:${col};background:${col}20;padding:2px 7px;border-radius:4px;letter-spacing:0.5px;">${label}</span>
                        <span style="font-weight:700;font-size:14px;color:var(--text-primary);">${h.title}</span>
                    </div>
                    <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">
                        <i data-lucide="map-pin" style="width:11px;height:11px;vertical-align:middle;margin-right:2px;"></i>${h._spotName || 'Unknown spot'} · ${when} · by ${h.profiles?.display_name || 'Anonymous'}
                    </div>
                    ${h.description ? `<div style="font-size:12px;color:var(--text-primary);margin-top:6px;opacity:0.85;">${h.description}</div>` : ''}
                    ${h.photo_url ? `<img src="${h.photo_url}" style="width:100%;max-height:120px;object-fit:cover;border-radius:6px;margin-top:8px;">` : ''}
                    <div style="font-size:11px;color:var(--text-secondary);margin-top:6px;">${expires}</div>
                </div>`;
            }).join('');
            initIcons(); // re-init after async render so Lucide icons resolve
        }

        // Returns active hazards for a given swim event (by spot_id or coordinate proximity)
        function getHazardsForEvent(ev) {
            if (!ev) return [];
            // 1. Direct spot_id match
            if (ev.spot_id && activeHazardsBySpot[ev.spot_id]) {
                return activeHazardsBySpot[ev.spot_id];
            }
            // 2. Coordinate proximity — 10km radius covers False Bay south peninsula
            if (ev.lat && ev.lng) {
                for (const [spotId, hazards] of Object.entries(activeHazardsBySpot)) {
                    const spot = spots.find(s => s.id === spotId);
                    if (!spot) continue;
                    const dist = getDistanceKm(ev.lat, ev.lng, spot.latitude, spot.longitude);
                    if (dist < 10) return hazards;
                }
            }
            // 3. Location name fallback — for older swims with no lat/lng/spot_id
            // Check if the swim's location_name contains any hazard spot name (or vice versa)
            if (ev.location_name) {
                const evLoc = ev.location_name.toLowerCase();
                for (const [spotId, hazards] of Object.entries(activeHazardsBySpot)) {
                    const spot = spots.find(s => s.id === spotId);
                    if (!spot) continue;
                    const spotName = spot.name.toLowerCase();
                    // Match if location contains spot name or spot name contains location keyword
                    if (evLoc.includes(spotName) || spotName.includes(evLoc.split(' ')[0])) {
                        return hazards;
                    }
                }
            }
            return [];
        }


        async function showProfileSettings() {
            if (!currentUser) { console.warn('showProfileSettings: no currentUser'); return; }
            const modal = document.getElementById('profileModal');
            if (!modal) { console.warn('showProfileSettings: no profileModal element'); return; }
            modal.style.display = 'block';
            modal.style.zIndex = '10002';
            document.getElementById('profileEmail').textContent = currentUser.email;

            // Show loading overlay while data fetches
            const profileOverlay = document.getElementById('profileLoadingOverlay');
            if (profileOverlay) {
                profileOverlay.style.display = 'flex';
                profileOverlay.style.alignItems = 'center';
                profileOverlay.style.justifyContent = 'center';
            }

            // Load current profile
            try {
                const { data: profile } = await supabaseClient
                    .from('profiles')
                    .select('*')
                    .eq('id', currentUser.id)
                    .single();

                if (profile) {
                    editingProfile = profile;
                    selectedAvatar = profile.avatar_url;
                    updateHeaderAvatar(profile.avatar_url);

                    // Init avatar tab — show photo tab if they have a photo URL, else icon tab
                    const isPhotoUrl = profile.avatar_url && profile.avatar_url.startsWith('http');
                    if (isPhotoUrl) {
                        switchAvatarTab('photo');
                        renderAvatarPhotoPreview(profile.avatar_url);
                    } else {
                        switchAvatarTab('icon');
                    }

                    document.getElementById('profileDisplayName').value = profile.display_name || '';
                    document.getElementById('profilePhone').value = profile.phone || '';
                    document.getElementById('profileEmergencyName').value = profile.emergency_contact_name || '';
                    document.getElementById('profileEmergencyPhone').value = profile.emergency_contact_phone || '';
                    document.getElementById('profileAddress').value = profile.address_line1 || '';
                    document.getElementById('profileAddressLine2').value = profile.address_line2 || '';
                    document.getElementById('profileCity').value = profile.city || '';
                    document.getElementById('profilePostal').value = profile.postal_code || '';
                    document.getElementById('profileHomeBeach').value = profile.home_beach_id || '';
                    // Sync fd beach label
                    const beachLabel = document.getElementById('fdProfileBeachLabel');
                    const beachTrigger = document.getElementById('fdProfileBeachTrigger');
                    if (profile.home_beach_id) {
                        const beachSpot = spots.find(s => String(s.id) === String(profile.home_beach_id));
                        if (beachSpot && beachLabel) { beachLabel.textContent = beachSpot.name; beachLabel.style.color = ''; }
                        if (beachTrigger) beachTrigger.classList.add('fd-active');
                    } else {
                        if (beachLabel) { beachLabel.textContent = 'Select beach...'; beachLabel.style.color = 'var(--text-secondary)'; }
                        if (beachTrigger) beachTrigger.classList.remove('fd-active');
                    }

                    const hds = document.getElementById('profileHomeDomain');
                    hds.innerHTML = '<option value="">Select region...</option>'
                        + domains.map(d => `<option value="${d.code}">${d.display_name}</option>`).join('');
                    hds.value = profile.home_domain || '';
                    // Sync fd domain panel and label
                    const fdDomainPanel = document.getElementById('fdProfileDomainPanel');
                    if (fdDomainPanel) {
                        let fdHtml = `<div class="fd-option${!profile.home_domain ? ' fd-selected' : ''}" data-value="" onclick="fdSetSelect('profileHomeDomain','','Select region...','fdProfileDomain')">Select region...</div>`;
                        domains.forEach(d => {
                            const sel = d.code === profile.home_domain ? ' fd-selected' : '';
                            fdHtml += `<div class="fd-option${sel}" data-value="${d.code}" onclick="fdSetSelect('profileHomeDomain','${d.code}','${d.display_name}','fdProfileDomain')">${d.display_name}</div>`;
                        });
                        fdDomainPanel.innerHTML = fdHtml;
                    }
                    const domainLabel = profile.home_domain ? domains.find(d => d.code === profile.home_domain)?.display_name : null;
                    const fdDomainLabelEl = document.getElementById('fdProfileDomainLabel');
                    if (fdDomainLabelEl) { fdDomainLabelEl.textContent = domainLabel || 'Select region...'; fdDomainLabelEl.style.color = domainLabel ? '' : 'var(--text-secondary)'; }
                    const fdDomainTrigger = document.getElementById('fdProfileDomainTrigger');
                    if (fdDomainTrigger) fdDomainTrigger.classList.toggle('fd-active', !!profile.home_domain);

                    document.getElementById('profilePreferredSuit').value = profile.preferred_suit || 'both';
                    // Sync fd suit label
                    const suitVal = profile.preferred_suit || 'both';
                    const suitLabels = { skins: 'Skins (No Wetsuit)', wetsuit: 'Wetsuit', both: 'Both' };
                    const fdSuitLabelEl = document.getElementById('fdProfileSuitLabel');
                    if (fdSuitLabelEl) fdSuitLabelEl.textContent = suitLabels[suitVal] || 'Both';
                    const fdSuitPanel = document.getElementById('fdProfileSuitPanel');
                    if (fdSuitPanel) fdSuitPanel.querySelectorAll('.fd-option').forEach(o => o.classList.toggle('fd-selected', o.dataset.value === suitVal));
                    document.getElementById('profileColdTolerance').value = profile.cold_tolerance_min_c || '';

                    // Times
                    if (profile.pool_1km_time_seconds) {
                        const mins = Math.floor(profile.pool_1km_time_seconds / 60);
                        const secs = profile.pool_1km_time_seconds % 60;
                        document.getElementById('profilePoolTime').value = `${mins}:${secs.toString().padStart(2, '0')}`;
                    } else {
                        document.getElementById('profilePoolTime').value = '';
                    }

                    if (profile.ocean_1km_time_seconds) {
                        const mins = Math.floor(profile.ocean_1km_time_seconds / 60);
                        const secs = profile.ocean_1km_time_seconds % 60;
                        document.getElementById('profileOceanTime').value = `${mins}:${secs.toString().padStart(2, '0')}`;
                    } else {
                        document.getElementById('profileOceanTime').value = '';
                    }
                }

                renderAvatarGrid();

                // Render swim alerts / notification preferences card
                if ('PushManager' in window && VAPID_PUBLIC_KEY !== 'REPLACE_WITH_YOUR_VAPID_PUBLIC_KEY') {
                    renderNotifOptIn();
                }

                // Render Strava connection card
                if (typeof initStravaSection === 'function') initStravaSection();

                // Render club membership card (if member of any club)
                if (typeof loadClubMembership === 'function') loadClubMembership();
            } catch (err) {
                console.error('Error loading profile:', err);
            } finally {
                // Hide loading overlay once data is ready (or on error)
                if (profileOverlay) profileOverlay.style.display = 'none';
                initIcons();
            }
        }

        function renderAvatarGrid() {
            const grid = document.getElementById('avatarGrid');
            if (!grid) return;
            grid.innerHTML = '';

            AVATARS.forEach(avatar => {
                const div = document.createElement('div');
                const isSelected = selectedAvatar === avatar.icon;
                div.style.cssText = `
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 24px;
                    cursor: pointer;
                    padding: 18px;
                    border-radius: 14px;
                    background: ${avatar.color};
                    opacity: ${isSelected ? '1' : '0.75'};
                    border: 3px solid ${isSelected ? 'white' : 'transparent'};
                    transition: all 0.2s;
                    box-shadow: ${isSelected ? '0 6px 16px rgba(0,0,0,0.35)' : '0 2px 8px rgba(0,0,0,0.15)'};
                    transform: ${isSelected ? 'scale(1.05)' : 'scale(1)'};
                `;
                div.innerHTML = `<i data-lucide="${avatar.icon}" style="width: 28px; height: 28px; color: white;"></i>`;
                div.title = avatar.name;
                div.onmouseenter = () => {
                    if (!isSelected) {
                        div.style.opacity = '0.9';
                        div.style.transform = 'scale(1.05)';
                    }
                };
                div.onmouseleave = () => {
                    if (!isSelected) {
                        div.style.opacity = '0.75';
                        div.style.transform = 'scale(1)';
                    }
                };
                div.onclick = () => {
                    selectedAvatar = avatar.icon;
                    renderAvatarGrid();
                };
                grid.appendChild(div);
            });
            initIcons(); // Re-initialize Lucide icons
        }

        function hideProfileSettings() {
            document.getElementById('profileModal').style.display = 'none';
        }

        async function saveProfile() {
            const displayName = document.getElementById('profileDisplayName').value;
            const phone = document.getElementById('profilePhone').value.trim();
            const emergencyName = document.getElementById('profileEmergencyName').value.trim();
            const emergencyPhone = document.getElementById('profileEmergencyPhone').value.trim();
            const homeBeachId = document.getElementById('profileHomeBeach').value;
            const preferredSuit = document.getElementById('profilePreferredSuit').value;
            const coldTolerance = document.getElementById('profileColdTolerance').value;
            const poolTimeStr = document.getElementById('profilePoolTime').value;
            const oceanTimeStr = document.getElementById('profileOceanTime').value;

            if (!displayName) {
                alert('Please enter a display name');
                return;
            }

            // Helper: mm:ss OR raw seconds to integer seconds (Tolerant)
            const mmssToSeconds = (val) => {
                if (!val) return null;
                const s = String(val).trim();
                if (!s) return null;

                // Normalize separators: dots, spaces, semicolons -> colon
                const normalized = s.replace(/[.;\s]+/g, ':');

                // If digits only
                if (/^\d+$/.test(normalized)) return parseInt(normalized, 10);

                // If mm:ss
                const parts = normalized.split(':');
                if (parts.length === 2) {
                    const m = parseInt(parts[0], 10) || 0;
                    const sc = parseInt(parts[1], 10) || 0;
                    // Basic validation: seconds should be < 60
                    if (sc >= 60) return null;
                    return m * 60 + sc;
                }
                return null;
            };

            // Derive Tier
            const poolTierFromSeconds = (poolSec) => {
                if (poolSec == null) return "unsure";
                if (poolSec < 870) return "fast";      // Fast (< 1:27/100m)
                if (poolSec <= 989) return "steady";   // Steady (1:27-1:38/100m)
                if (poolSec <= 1140) return "social"; // Social (1:39-1:54/100m)
                return "developing";                      // Developing (> 1:54/100m)
            };

            const poolSeconds = mmssToSeconds(poolTimeStr);
            const oceanSeconds = mmssToSeconds(oceanTimeStr);
            const experienceLevel = poolTierFromSeconds(poolSeconds);

            // Validate + normalise SA phone numbers (optional in profile — allow empty/null)
            let normalizedPhone = null;
            if (phone) {
                normalizedPhone = formatSAPhone(phone);
                if (!normalizedPhone) {
                    showToast('Phone number looks invalid — include country code e.g. +27 82 336 9790', 'error');
                    document.getElementById('profilePhone').style.borderColor = 'var(--danger)';
                    return;
                }
            }
            let normalizedEmergencyPhone = null;
            if (emergencyPhone) {
                // Try SA format first, then accept any international number with 7+ digits
                normalizedEmergencyPhone = formatSAPhone(emergencyPhone);
                if (!normalizedEmergencyPhone) {
                    const digitsOnly = emergencyPhone.replace(/\D/g, '');
                    if (digitsOnly.length >= 7) {
                        // Accept as-is (international numbers, Namibia +264, etc.)
                        normalizedEmergencyPhone = emergencyPhone.trim();
                    } else {
                        showToast('Emergency contact phone looks invalid — please check the number', 'error');
                        document.getElementById('profileEmergencyPhone').style.borderColor = 'var(--danger)';
                        return;
                    }
                }
            }

            const profileAddress = document.getElementById('profileAddress')?.value.trim() || null;
            const profileAddressLine2 = document.getElementById('profileAddressLine2')?.value.trim() || null;
            const profileCity = document.getElementById('profileCity')?.value.trim() || null;
            const profilePostal = document.getElementById('profilePostal')?.value.trim() || null;
            const profileHomeDomain = document.getElementById('profileHomeDomain')?.value || null;

            const payload = {
                display_name: displayName,
                phone: normalizedPhone,
                emergency_contact_name: emergencyName || null,
                emergency_contact_phone: normalizedEmergencyPhone,
                address_line1: profileAddress,
                address_line2: profileAddressLine2,
                city: profileCity,
                postal_code: profilePostal,
                home_beach_id: homeBeachId || null,
                home_domain: profileHomeDomain,
                preferred_suit: preferredSuit,
                cold_tolerance_min_c: coldTolerance ? parseFloat(coldTolerance) : null,
                pool_1km_time_seconds: poolSeconds,
                ocean_1km_time_seconds: oceanSeconds,
                experience_level: experienceLevel,
                avatar_url: selectedAvatar
            };

            // Onboarding check
            if (editingProfile && !editingProfile.onboarding_completed_at) {
                payload.onboarding_completed_at = new Date().toISOString();
            }

            // Final guard: never write null/empty experience_level
            if (!payload.experience_level) {
                payload.experience_level = "unsure";
            }

            console.log("PROFILE SAVE PAYLOAD", payload);

            try {
                const { error } = await supabaseClient
                    .from('profiles')
                    .update(payload)
                    .eq('id', currentUser.id);

                if (error) throw error;

                // Success!
                updateHeaderAvatar(selectedAvatar);
                if (currentUserProfile) currentUserProfile.home_domain = profileHomeDomain;

                showToast('Profile updated!', 'success');
                hideProfileSettings();
                loadDashboard();
            } catch (err) {
                console.error('Error saving profile:', err);
                alert('Error saving profile: ' + err.message);
            }
        }

        // ===== ONBOARDING FUNCTIONS =====

        function showOnboardingLegal() {
            document.getElementById('onboardingLegal').style.display = 'block';
            document.getElementById('onboardingPersonal').style.display = 'none';
            setTimeout(() => initIcons(), 100);
        }

        function showOnboardingPersonal() {
            document.getElementById('onboardingLegal').style.display = 'none';
            document.getElementById('onboardingPersonal').style.display = 'block';
            populateOnboardingRegions();
            setTimeout(() => initIcons(), 100);
        }

        function populateOnboardingRegions() {
            const sel = document.getElementById('obHomeDomain');
            if (!sel || domains.length === 0) return;
            sel.innerHTML = '<option value="">Select your region...</option>'
                + domains.map(d => `<option value="${d.code}">${d.display_name}</option>`).join('');
        }

        function checkOnboardingBoxes() {
            const terms = document.getElementById('obTerms').checked;
            const privacy = document.getElementById('obPrivacy').checked;
            const waiver = document.getElementById('obWaiver').checked;
            const data = document.getElementById('obData').checked;

            const btn = document.getElementById('obAcceptBtn');
            const allChecked = terms && privacy && waiver && data;
            btn.disabled = !allChecked;
            btn.style.opacity = allChecked ? '1' : '0.5';
            btn.style.cursor = allChecked ? 'pointer' : 'not-allowed';
        }

        // Consent document content (embedded for file:// compatibility)
        const consentDocuments = {
            terms: {
                title: 'Terms of Service',
                content: `
<h4 style="color: #38bdf8; margin-bottom: 12px;">SwimLoading Terms of Service</h4>
<p><strong>Effective Date:</strong> January 2025</p>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">1. Acceptance of Terms</h4>
<p>By accessing or using SwimLoading ("the App"), you agree to be bound by these Terms of Service. If you do not agree, do not use the App.</p>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">2. Description of Service</h4>
<p>SwimLoading is a community platform for open water swimmers to:</p>
<ul style="margin: 8px 0 8px 20px;">
<li>Log and share water temperature readings</li>
<li>View swim conditions at various spots</li>
<li>Connect with the local swimming community</li>
<li>Track swimming activities</li>
</ul>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">3. User Responsibilities</h4>
<p>You agree to:</p>
<ul style="margin: 8px 0 8px 20px;">
<li>Provide accurate information when logging temperatures and conditions</li>
<li>Not misuse the service or attempt to harm other users</li>
<li>Respect the community and other swimmers</li>
<li>Keep your account credentials secure</li>
</ul>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">4. Safety Disclaimer</h4>
<p>SwimLoading provides information for convenience only. <strong>You are solely responsible for assessing conditions and your own safety.</strong> Never rely solely on app data for safety decisions.</p>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">5. Intellectual Property</h4>
<p>The App and its content are owned by SwimLoading. User-submitted data (temperatures, conditions) may be used to improve the service and shared with the community.</p>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">6. Termination</h4>
<p>We may suspend or terminate accounts that violate these terms or for any reason at our discretion.</p>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">7. Changes to Terms</h4>
<p>We may update these terms at any time. Continued use constitutes acceptance of changes.</p>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">8. Governing Law</h4>
<p>These terms are governed by the laws of South Africa.</p>
`
            },
            privacy: {
                title: 'Privacy Policy (POPIA Compliant)',
                content: `
<h4 style="color: #38bdf8; margin-bottom: 12px;">SwimLoading Privacy Policy</h4>
<p><strong>Effective Date:</strong> January 2025</p>
<p>This policy complies with the Protection of Personal Information Act (POPIA) of South Africa.</p>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">1. Information We Collect</h4>
<p><strong>Account Information:</strong></p>
<ul style="margin: 8px 0 8px 20px;">
<li>Email address</li>
<li>Full name</li>
<li>Phone number (for emergency contact)</li>
<li>Date of birth</li>
<li>Physical address</li>
</ul>

<p><strong>Usage Data:</strong></p>
<ul style="margin: 8px 0 8px 20px;">
<li>Temperature logs you submit</li>
<li>GPS coordinates (when you grant permission)</li>
<li>Swim check-ins and activities</li>
<li>App usage patterns</li>
</ul>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">2. How We Use Your Information</h4>
<ul style="margin: 8px 0 8px 20px;">
<li>To provide and improve the SwimLoading service</li>
<li>To display community temperature data</li>
<li>For safety features (check-in/check-out, emergency contacts)</li>
<li>To communicate important updates</li>
<li>For anonymized research to improve ocean safety</li>
</ul>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">3. Data Sharing</h4>
<p>We may share data with:</p>
<ul style="margin: 8px 0 8px 20px;">
<li><strong>Other users:</strong> Your temperature logs and swim spot data (not personal details)</li>
<li><strong>Emergency services:</strong> If you fail to check out from a swim</li>
<li><strong>Research partners:</strong> Anonymized data only, for ocean safety research</li>
</ul>
<p>We do <strong>not</strong> sell your personal information.</p>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">4. Your POPIA Rights</h4>
<p>Under POPIA, you have the right to:</p>
<ul style="margin: 8px 0 8px 20px;">
<li>Access your personal information</li>
<li>Correct inaccurate information</li>
<li>Request deletion of your data</li>
<li>Object to processing</li>
<li>Withdraw consent</li>
</ul>
<p>To exercise these rights, contact us at privacy@swimloading.com</p>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">5. Data Security</h4>
<p>We use industry-standard security measures to protect your data, including encryption in transit and at rest.</p>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">6. Data Retention</h4>
<p>We retain your data for as long as your account is active. You may request deletion at any time.</p>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">7. Information Officer</h4>
<p>SwimLoading's Information Officer can be contacted at: privacy@swimloading.com</p>
`
            },
            waiver: {
                title: 'Liability Waiver',
                content: `
<h4 style="color: #ef4444; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                        <i data-lucide="alert-triangle" style="width: 18px; height: 18px;"></i> LIABILITY WAIVER AND ASSUMPTION OF RISK
                    </h4>
<p><strong>PLEASE READ CAREFULLY BEFORE ACCEPTING</strong></p>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">ACKNOWLEDGMENT OF RISKS</h4>
<p>I understand and acknowledge that <strong>open water swimming is an inherently dangerous activity</strong> that involves serious risks including but not limited to:</p>
<ul style="margin: 8px 0 8px 20px;">
<li>Drowning and death</li>
<li>Hypothermia and cold water shock</li>
<li>Cardiac events</li>
<li>Marine life encounters (sharks, jellyfish, etc.)</li>
<li>Strong currents, waves, and changing conditions</li>
<li>Boat traffic and watercraft collisions</li>
<li>Physical injury or permanent disability</li>
</ul>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">VOLUNTARY PARTICIPATION</h4>
<p>I voluntarily choose to participate in open water swimming activities. I understand that SwimLoading is an information platform only and <strong>does not supervise, organize, or control any swimming activities</strong>.</p>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">RELEASE OF LIABILITY</h4>
<p>In consideration of being allowed to use SwimLoading, I hereby:</p>
<ol style="margin: 8px 0 8px 20px;">
<li><strong>RELEASE AND DISCHARGE</strong> SwimLoading, its owners, operators, employees, and affiliates from any and all liability, claims, demands, or causes of action that may arise from my use of the app or participation in open water swimming.</li>
<li><strong>WAIVE</strong> any claims I may have against SwimLoading for injury, death, or property damage.</li>
<li><strong>ASSUME ALL RISKS</strong> associated with open water swimming, whether known or unknown.</li>
</ol>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">DATA ACCURACY DISCLAIMER</h4>
<p>I understand that:</p>
<ul style="margin: 8px 0 8px 20px;">
<li>Temperature and condition data is user-submitted and may be <strong>inaccurate</strong></li>
<li>Conditions can change rapidly and without warning</li>
<li>I must <strong>independently verify all conditions</strong> before swimming</li>
<li>SwimLoading makes <strong>no guarantees</strong> about data accuracy</li>
</ul>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">INDEMNIFICATION</h4>
<p>I agree to indemnify and hold harmless SwimLoading from any claims, damages, or expenses arising from my swimming activities or use of the app.</p>

<h4 style="color: #ef4444; margin: 16px 0 8px 0; display: flex; align-items: center; gap: 8px;">
    <i data-lucide="alert-triangle" style="width: 18px; height: 18px;"></i> BY ACCEPTING, I CONFIRM THAT:
</h4>
<ul style="margin: 8px 0 8px 20px;">
<li>I have read and understood this waiver</li>
<li>I am at least 18 years old (or have parental consent)</li>
<li>I accept full responsibility for my safety</li>
<li>I am physically fit to participate in open water swimming</li>
</ul>
`
            },
            data: {
                title: 'Data Collection Consent',
                content: `
<h4 style="color: #38bdf8; margin-bottom: 12px;">Data Collection Consent</h4>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">Purpose of Data Collection</h4>
<p>SwimLoading collects data to:</p>
<ul style="margin: 8px 0 8px 20px;">
<li>Build a community resource of ocean conditions</li>
<li>Improve safety for open water swimmers</li>
<li>Enable features like check-in/check-out safety systems</li>
<li>Support research into ocean swimming safety</li>
</ul>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">What Data We Collect</h4>
<p><strong>Location Data:</strong></p>
<ul style="margin: 8px 0 8px 20px;">
<li>GPS coordinates when you log temperatures</li>
<li>Location during check-in/check-out</li>
<li>This helps verify spot accuracy and enables safety features</li>
</ul>

<p><strong>Activity Data:</strong></p>
<ul style="margin: 8px 0 8px 20px;">
<li>Temperature readings you submit</li>
<li>Conditions and hazards you report</li>
<li>Your swim activities and check-ins</li>
</ul>

<p><strong>Personal Data:</strong></p>
<ul style="margin: 8px 0 8px 20px;">
<li>Contact information for safety features</li>
<li>Emergency contact details</li>
</ul>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">How We Use This Data</h4>
<ol style="margin: 8px 0 8px 20px;">
<li><strong>Community Features:</strong> Sharing temperature and condition data with other swimmers</li>
<li><strong>Safety:</strong> Alerting emergency contacts if you don't check out</li>
<li><strong>Improvement:</strong> Making the app better based on usage patterns</li>
<li><strong>Research:</strong> Anonymized data may be used for ocean safety research</li>
</ol>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">Your Control Over Your Data</h4>
<ul style="margin: 8px 0 8px 20px;">
<li>You can disable GPS permissions in your device settings</li>
<li>You can request a copy of your data at any time</li>
<li>You can request deletion of your account and data</li>
<li>Temperature logs may be retained anonymously for community benefit</li>
</ul>

<h4 style="color: #f8fafc; margin: 16px 0 8px 0;">Third-Party Sharing</h4>
<p>Your data may be shared with:</p>
<ul style="margin: 8px 0 8px 20px;">
<li><strong>Other users:</strong> Temperature logs (with optional anonymity)</li>
<li><strong>Emergency services:</strong> Only when safety features are triggered</li>
<li><strong>Insurance partners:</strong> Only with your explicit additional consent</li>
</ul>

<h4 style="color: #38bdf8; margin: 16px 0 8px 0;">By accepting, you consent to:</h4>
<ul style="margin: 8px 0 8px 20px;">
<li>Collection of the data described above</li>
<li>Use of this data for the stated purposes</li>
<li>Sharing as described in this policy</li>
</ul>
`
            }
        };

        function openConsentModal(docType) {
            const doc = consentDocuments[docType];
            if (!doc) return;

            document.getElementById('consentModalTitle').textContent = doc.title;
            document.getElementById('consentModalBody').innerHTML = doc.content;

            const modal = document.getElementById('consentModal');
            modal.style.display = 'flex';
        }

        function closeConsentModal() {
            document.getElementById('consentModal').style.display = 'none';
        }

        // ESC key to close modal
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                closeConsentModal();
            }
        });

        // Click outside modal to close
        document.getElementById('consentModal')?.addEventListener('click', function (e) {
            if (e.target === this) {
                closeConsentModal();
            }
        });

        async function acceptOnboardingLegal() {
            try {
                const now = new Date().toISOString();

                // Check if profile exists
                const { data: existing } = await supabaseClient
                    .from('profiles')
                    .select('id')
                    .eq('id', currentUser.id)
                    .maybeSingle();

                if (existing) {
                    const { error } = await supabaseClient
                        .from('profiles')
                        .update({
                            terms_accepted_at: now,
                            privacy_accepted_at: now,
                            waiver_accepted_at: now,
                            data_consent_at: now
                        })
                        .eq('id', currentUser.id);

                    if (error) throw error;
                } else {
                    const { error } = await supabaseClient
                        .from('profiles')
                        .insert({
                            id: currentUser.id,
                            display_name: currentUser.email.split('@')[0],
                            terms_accepted_at: now,
                            privacy_accepted_at: now,
                            waiver_accepted_at: now,
                            data_consent_at: now,
                            experience_level: 'unsure' // Canonical default to satisfy constraint
                        });

                    if (error) throw error;
                }

                showOnboardingPersonal();
            } catch (err) {
                console.error('Error accepting legal:', err);
                alert('Error: ' + err.message);
            }
        }

        async function saveOnboardingPersonal() {
            const fullName = document.getElementById('obFullName').value.trim();
            const phone = document.getElementById('obPhone').value.trim();
            const dob = document.getElementById('obDOB').value;
            const address = document.getElementById('obAddress').value.trim();
            const addressLine2 = document.getElementById('obAddressLine2')?.value.trim() || null;
            const city = document.getElementById('obCity').value.trim();
            const postal = document.getElementById('obPostal').value.trim();
            const emergencyName = document.getElementById('obEmergencyName').value.trim();
            const emergencyPhone = document.getElementById('obEmergencyPhone').value.trim();
            const homeDomain = document.getElementById('obHomeDomain')?.value || '';

            if (!fullName || !phone || !dob || !address || !city || !postal || !emergencyName || !emergencyPhone) {
                alert('Please fill in all required fields, including your emergency contact');
                return;
            }
            if (!homeDomain) {
                showToast('Please select your home swimming region', 'error');
                return;
            }

            // Validate + normalise SA phone numbers
            const normalizedPhone = formatSAPhone(phone);
            if (!normalizedPhone) {
                showToast('Phone number looks invalid — include country code e.g. +27 82 336 9790', 'error');
                document.getElementById('obPhone').style.borderColor = 'var(--danger)';
                return;
            }
            let normalizedEmergencyPhone = formatSAPhone(emergencyPhone);
            if (!normalizedEmergencyPhone) {
                const digitsOnly = emergencyPhone.replace(/\D/g, '');
                if (digitsOnly.length >= 7) {
                    normalizedEmergencyPhone = emergencyPhone.trim();
                } else {
                    showToast('Emergency contact phone looks invalid — please check the number', 'error');
                    document.getElementById('obEmergencyPhone').style.borderColor = 'var(--danger)';
                    return;
                }
            }

            try {
                const { error } = await supabaseClient
                    .from('profiles')
                    .update({
                        full_name: fullName,
                        display_name: fullName,   // sync display_name so name appears throughout app
                        phone: normalizedPhone,
                        date_of_birth: dob,
                        address_line1: address,
                        address_line2: addressLine2,
                        city: city,
                        postal_code: postal,
                        emergency_contact_name: emergencyName,
                        emergency_contact_phone: normalizedEmergencyPhone,
                        home_domain: homeDomain,
                        onboarding_completed_at: new Date().toISOString()
                    })
                    .eq('id', currentUser.id);

                if (error) throw error;

                // Notify admins (in-app) + push subscribers who want new member alerts
                try {
                    const { data: admins } = await supabaseClient
                        .from('profiles')
                        .select('id')
                        .eq('is_admin', true);
                    for (const admin of (admins || [])) {
                        await notify(admin.id, null, 'new_signup',
                            'New swimmer joined!',
                            `${fullName} has completed onboarding and is ready to swim.`,
                            { new_user_id: currentUser.id }
                        );
                    }
                    // Push broadcast to anyone subscribed to new_member notifications
                    broadcastPush(null, 'new_member',
                        'New swimmer joined!',
                        `${fullName} just joined SwimLoading — welcome them in!`
                    );
                } catch (notifErr) {
                    console.warn('Admin notification failed (non-blocking):', notifErr);
                }

                // Hide onboarding, show main app
                document.getElementById('onboardingLegal').style.display = 'none';
                document.getElementById('onboardingPersonal').style.display = 'none';
                document.getElementById('mainApp').style.display = 'block';

                await loadSpots();
                await loadDashboard();
                initIcons();
                attachSpotLockHandler();
                initNavScroll();
                startNotificationPolling();
                setTimeout(() => promptPushNotifications(), 2000);
                setTimeout(() => promptNewSwimAlerts(), 3500);
            } catch (err) {
                console.error('Error saving personal details:', err);
                alert('Error: ' + err.message);
            }
        }

        // ===== END ONBOARDING =====

        // GPS State
        let currentGpsLocation = null;

        // Get current GPS location (still callable externally, e.g. from dashboard)
        async function getCurrentLocation() {
            const status = document.getElementById('gpsStatus');

            if (!navigator.geolocation) {
                alert('GPS not supported on this device');
                return;
            }

            if (status) { status.textContent = 'Detecting...'; status.style.color = 'var(--warning)'; }

            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    const lat = position.coords.latitude;
                    const lng = position.coords.longitude;
                    currentGpsLocation = { lat, lng };
                    pickerGpsCoords = { lat, lng };

                    // Find nearest spot
                    const nearest = findNearestSpot(lat, lng);

                    if (nearest) {
                        gpsSuggestedSpotId = nearest.spot.id;

                        // Update hidden select AND visible trigger if not already locked
                        if (!selectedSpotLocked) {
                            const select = document.getElementById('logTempSpotSelect');
                            if (select) select.value = nearest.spot.id;
                            const trigger = document.getElementById('spotPickerTrigger');
                            const label   = document.getElementById('spTriggerText');
                            if (trigger) trigger.classList.add('sp-has-value');
                            if (label)   label.textContent = nearest.spot.name;
                            // Adapt form fields for pool vs open water
                            applyPoolFormMode(nearest.spot.id);
                        }

                        if (status) {
                            status.innerHTML = `<i data-lucide="map-pin" style="width:11px;height:11px;vertical-align:middle;margin-right:3px;"></i>${nearest.spot.name} · ${nearest.distance.toFixed(1)} km`;
                            status.style.color = 'var(--success)';
                        }
                    } else {
                        if (status) {
                            status.textContent = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
                            status.style.color = 'var(--ocean-light)';
                        }
                    }
                    initIcons();
                },
                (error) => {
                    console.error('GPS error:', error);
                    if (status) { status.textContent = 'Location access denied'; status.style.color = 'var(--danger)'; }
                    if (error.code === 1) alert('Please allow location access to use GPS');
                },
                { enableHighAccuracy: true, timeout: 10000 }
            );
        }

        // Calculate distance between two points (Haversine formula)
        function getDistanceKm(lat1, lng1, lat2, lng2) {
            const R = 6371; // Earth's radius in km
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLng = (lng2 - lng1) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLng / 2) * Math.sin(dLng / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
        }

        // Find nearest spot to GPS coordinates
        function findNearestSpot(lat, lng) {
            if (!spots || spots.length === 0) return null;

            let nearest = null;
            let minDistance = Infinity;

            for (const spot of spots) {
                const distance = getDistanceKm(lat, lng, spot.latitude, spot.longitude);
                if (distance < minDistance) {
                    minDistance = distance;
                    nearest = { spot, distance };
                }
            }

            // Only return if within 10km (reasonable for Cape Town spots)
            return minDistance <= 10 ? nearest : null;
        }

        // ── SPOT PICKER SHEET ───────────────────────────────────────────────────
        let pickerCategory = 'OCEAN';
        let pickerBrand    = null;   // null=All, 'VIRGIN_ACTIVE', 'PUBLIC' — Pool tab only
        let pickerDomain   = null;   // null=All, or a domain code — Ocean/Lagoon/Inland tabs
        let pickerSearch   = '';
        let pickerUserSpotIds  = new Set(); // spot IDs this user has previously logged
        let pickerRecentSpots  = [];        // [{id, name}] ordered by most recent log, max 5
        let pickerGpsCoords    = null;      // { lat, lng } once GPS resolves
        let pickerGpsLoaded    = false;

        const SP_TYPE_LABELS = { OCEAN: 'Ocean', POOL: 'Pool', LAGOON: 'Lagoon', DAM: 'Inland', LAKE: 'Lake' };
        const SP_TYPE_ICONS  = { OCEAN: 'waves', POOL: 'droplets', LAGOON: 'anchor', DAM: 'mountain-snow', LAKE: 'waves' };
        const INTERNATIONAL_DOMAINS = new Set(['EUROPE', 'NAMIBIA', 'UK', 'WESTERN_AUSTRALIA', 'USA']);
        const COUNTRY_NAMES = { ZA: 'South Africa', NA: 'Namibia', CH: 'Switzerland', AU: 'Australia', GB: 'United Kingdom', FR: 'France', DE: 'Germany', IT: 'Italy' };
        const AREA_DISPLAY = {
            ATLANTIC: 'Atlantic Seaboard',
            FALSE_BAY: 'False Bay',
            KZN: 'KwaZulu-Natal',
            INLAND: 'Inland',
        };

        // Format domain code to readable area name, falling back to the domains table
        function spAreaName(domainCode) {
            if (AREA_DISPLAY[domainCode]) return AREA_DISPLAY[domainCode];
            const d = domains.find(d => d.code === domainCode);
            return d ? d.display_name : domainCode;
        }

        // Keyboard-aware viewport handler.
        // Sets padding-bottom on the overlay = keyboard height.
        // The sheet (align-items:flex-end) naturally floats above the padding,
        // which means it sits above the keyboard. No coordinate arithmetic needed.
        function _spViewportResize() {
            const overlay = document.getElementById('spotPickerOverlay');
            if (!overlay || !overlay.classList.contains('sp-open')) return;
            const kbH = window.visualViewport
                ? Math.max(0, window.innerHeight - window.visualViewport.height)
                : 0;
            overlay.style.paddingBottom = kbH + 'px';
        }

        function _spResetOverlaySize() {
            const overlay = document.getElementById('spotPickerOverlay');
            if (!overlay) return;
            overlay.style.paddingBottom = '';
        }

        function _spSearchFocus() {
            // Fire at staggered intervals — keyboard animation takes ~300ms on iOS
            [50, 200, 400].forEach(d => setTimeout(_spViewportResize, d));
        }

        function _spSearchBlur() {
            setTimeout(_spResetOverlaySize, 50);
        }

        // Open the picker sheet
        async function openSpotPicker() {
            _spResetOverlaySize();
            document.getElementById('spotPickerOverlay').classList.add('sp-open');
            document.body.style.overflow = 'hidden';

            // Track viewport changes (keyboard open/close on mobile)
            if (window.visualViewport) {
                window.visualViewport.addEventListener('resize', _spViewportResize);
                window.visualViewport.addEventListener('scroll', _spViewportResize);
            }

            // Seed the correct sub-filter strip for the current category
            if (pickerCategory === 'POOL') {
                const bs = document.getElementById('spBrandStrip');
                if (bs) bs.classList.add('sp-visible');
            } else {
                renderRegionStrip(pickerCategory);
            }

            // Render immediately with whatever we have
            renderSpotPickerList();

            // Load user log history once — also build recents list
            if (currentUser && pickerUserSpotIds.size === 0) {
                supabaseClient
                    .from('temp_logs')
                    .select('spot_id')
                    .eq('user_id', currentUser.id)
                    .order('created_at', { ascending: false })
                    .limit(100)
                    .then(({ data }) => {
                        if (data) {
                            const seen = new Set();
                            pickerRecentSpots = [];
                            for (const r of data) {
                                pickerUserSpotIds.add(r.spot_id);
                                if (!seen.has(r.spot_id)) {
                                    seen.add(r.spot_id);
                                    const spot = spots.find(s => s.id === r.spot_id);
                                    if (spot) pickerRecentSpots.push({ id: spot.id, name: spot.name });
                                    if (pickerRecentSpots.length >= 5) break;
                                }
                            }
                            renderRecentsStrip();
                            renderSpotPickerList();
                        }
                    });
            } else if (pickerRecentSpots.length > 0) {
                renderRecentsStrip();
            }

            // Request GPS (silent — doesn't pop an alert if already denied)
            if (!pickerGpsLoaded && navigator.geolocation) {
                pickerGpsLoaded = true;
                navigator.geolocation.getCurrentPosition(
                    pos => {
                        pickerGpsCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                        currentGpsLocation = pickerGpsCoords;
                        renderSpotPickerList();
                    },
                    () => { /* silently ignore denial */ },
                    { enableHighAccuracy: true, timeout: 8000 }
                );
            } else if (currentGpsLocation) {
                pickerGpsCoords = currentGpsLocation;
            }
        }

        function closeSpotPicker() {
            document.getElementById('spotPickerOverlay').classList.remove('sp-open');
            _spResetOverlaySize();
            document.body.style.overflow = '';

            // Stop watching viewport
            if (window.visualViewport) {
                window.visualViewport.removeEventListener('resize', _spViewportResize);
                window.visualViewport.removeEventListener('scroll', _spViewportResize);
            }

            // Dismiss keyboard if search was focused
            const inp = document.getElementById('spSearchInput');
            if (inp) inp.blur();
        }

        function renderRecentsStrip() {
            const strip = document.getElementById('spRecentsStrip');
            if (!strip || pickerRecentSpots.length === 0) return;
            strip.style.cssText = 'display:block; padding:0 16px 10px; flex-shrink:0; max-height:70px; overflow:hidden;';
            strip.innerHTML = `
                <div style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px;">Recent</div>
                <div style="display:flex;flex-wrap:nowrap;gap:7px;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:none;">
                    ${pickerRecentSpots.map(r =>
                        `<div style="flex-shrink:0;padding:6px 13px;background:rgba(34,211,238,0.08);border:1px solid rgba(34,211,238,0.22);border-radius:100px;font-size:12px;font-weight:600;color:#7ec8e3;cursor:pointer;white-space:nowrap;"
                              data-spot-id="${r.id}"
                              data-spot-name="${r.name.replace(/"/g, '&quot;')}"
                              onclick="selectSpotFromPicker(this.dataset.spotId, this.dataset.spotName)">${r.name}</div>`
                    ).join('')}
                </div>`;
        }

        function setPickerCategory(cat, tabEl) {
            pickerCategory = cat;
            document.querySelectorAll('.sp-tab').forEach(t => t.classList.remove('active'));
            if (tabEl) tabEl.classList.add('active');
            pickerSearch = '';
            pickerDomain = null;
            const inp = document.getElementById('spSearchInput');
            if (inp) inp.value = '';
            document.getElementById('spSearchClear').style.display = 'none';

            const brandStrip = document.getElementById('spBrandStrip');
            if (cat === 'POOL') {
                // Show brand strip, hide region strip
                if (brandStrip) brandStrip.classList.add('sp-visible');
                const regionStrip = document.getElementById('spRegionStrip');
                if (regionStrip) { regionStrip.classList.remove('sp-visible'); regionStrip.innerHTML = ''; }
                pickerBrand = null;
                document.querySelectorAll('.sp-brand-pill').forEach((p, i) => p.classList.toggle('active', i === 0));
            } else {
                // Hide brand strip, build region strip for this category
                if (brandStrip) brandStrip.classList.remove('sp-visible');
                pickerBrand = null;
                renderRegionStrip(cat);
            }
            renderSpotPickerList();
        }

        function setPickerBrand(brand, pillEl) {
            pickerBrand = brand;
            document.querySelectorAll('.sp-brand-pill').forEach(p => p.classList.remove('active'));
            if (pillEl) pillEl.classList.add('active');
            renderSpotPickerList();
        }

        function setPickerDomain(domain, pillEl) {
            pickerDomain = domain;
            // Clear __intl__ token if set (switching back to normal category view)
            if (pickerSearch === '__intl__') pickerSearch = '';
            document.querySelectorAll('.sp-region-pill').forEach(p => p.classList.remove('active'));
            if (pillEl) pillEl.classList.add('active');
            renderSpotPickerList();
        }

        // Build region strip pills for the current non-pool category
        function renderRegionStrip(cat) {
            const strip = document.getElementById('spRegionStrip');
            if (!strip) return;

            // Find which domains have spots in this category
            const activeDomains = [...new Set(
                spots.filter(s => s.active !== false && s.water_type === cat).map(s => s.domain)
            )];

            // Check if any international spots exist across ALL categories
            const hasIntlSpots = spots.some(s => s.active !== false && internationalSpotIds.has(s.id));

            // Only show strip if there are multiple domains OR international spots exist
            if (activeDomains.length <= 1 && !hasIntlSpots) {
                strip.classList.remove('sp-visible');
                strip.innerHTML = '';
                return;
            }

            // Separate local domains from international ones using spot-level country data
            const localDomains = activeDomains.filter(c => !spots.some(s => s.domain === c && internationalSpotIds.has(s.id)));
            const intlInCat    = activeDomains.filter(c =>  spots.some(s => s.domain === c && internationalSpotIds.has(s.id)));

            // Build pills — "All" first, then local domains, then a single "International" pill
            let html = `<div class="sp-brand-pill sp-region-pill active" onclick="setPickerDomain(null,this)">All</div>`;
            localDomains.forEach(code => {
                const name = spAreaName(code);
                html += `<div class="sp-brand-pill sp-region-pill" onclick="setPickerDomain('${code}',this)">${name}</div>`;
            });

            // Always show International pill if any intl spots exist anywhere
            if (hasIntlSpots) {
                html += `<div class="sp-brand-pill sp-region-pill" style="border-color:#d97706;color:#d97706;" onclick="setPickerIntl(this)"><i data-lucide="globe" style="width:11px;height:11px;display:inline-block;vertical-align:middle;margin-right:3px;"></i>International</div>`;
            }

            strip.innerHTML = html;
            strip.classList.add('sp-visible');
            initIcons();
        }

        // Show all international spots cross-category
        function setPickerIntl(pillEl) {
            // Deselect all pills, highlight this one
            document.querySelectorAll('.sp-region-pill').forEach(p => p.classList.remove('active'));
            if (pillEl) pillEl.classList.add('active');

            // Trigger cross-category search for international spots
            pickerDomain = null;
            pickerSearch = '__intl__';
            renderSpotPickerList();
        }

        function onSpPickerSearch(val) {
            pickerSearch = val;
            document.getElementById('spSearchClear').style.display = val ? 'block' : 'none';
            renderSpotPickerList();
        }

        function clearSpPickerSearch() {
            pickerSearch = '';
            const inp = document.getElementById('spSearchInput');
            if (inp) inp.value = '';
            document.getElementById('spSearchClear').style.display = 'none';
            renderSpotPickerList();
        }

        // Select a spot from the picker
        function selectSpotFromPicker(spotId, spotName) {
            // Update hidden select (used by submitTempLog)
            const sel = document.getElementById('logTempSpotSelect');
            if (sel) sel.value = spotId;

            // Update visible trigger
            const trigger = document.getElementById('spotPickerTrigger');
            const label   = document.getElementById('spTriggerText');
            if (trigger) trigger.classList.add('sp-has-value');
            if (label)   label.textContent = spotName;

            // Mark as user-chosen (locks GPS suggestion)
            selectedSpotLocked = true;
            gpsSuggestedSpotId = spotId;

            // GPS status line
            const status = document.getElementById('gpsStatus');
            if (status) {
                status.textContent = '';
            }

            // Adapt form for pool vs open water
            applyPoolFormMode(spotId);

            closeSpotPicker();
            initIcons();
        }

        // Show/hide conditions & hazards based on whether the selected spot is a pool.
        // Pools are always calm — no choppy/rough/extreme, no ocean hazards.
        function applyPoolFormMode(spotId) {
            const spot = spots.find(s => s.id === spotId || s.id === parseInt(spotId));
            const isPool = spot && (spot.water_type === 'POOL' || spot.water_type === 'TIDAL_POOL');

            const conditionsGroup  = document.getElementById('conditionsFormGroup');
            const hazardsGroup     = document.getElementById('hazardsFormGroup');
            const poolNotice       = document.getElementById('poolModeNotice');

            if (isPool) {
                // Hide conditions grid, show pool notice, hide hazards
                if (conditionsGroup) conditionsGroup.style.display = 'none';
                if (poolNotice)      poolNotice.style.display = 'block';
                if (hazardsGroup)    hazardsGroup.style.display = 'none';
                // Ensure Calm is active so submitTempLog reads 'Calm'
                document.querySelectorAll('#conditionsGrid .toggle-btn').forEach((btn, i) => {
                    btn.classList.toggle('active', i === 0);
                });
            } else {
                // Restore full form for open water
                if (conditionsGroup) conditionsGroup.style.display = 'block';
                if (poolNotice)      poolNotice.style.display = 'none';
                if (hazardsGroup)    hazardsGroup.style.display = 'block';
            }
        }

        // Build a single spot row HTML
        function _spRowHTML(s, currentVal, delay) {
            const isSelected = s.id === currentVal;
            const isLogged   = pickerUserSpotIds.has(s.id);
            const distStr    = s._dist !== null
                ? (s._dist < 1 ? (s._dist * 1000).toFixed(0) + ' m' : s._dist.toFixed(1) + ' km')
                : '';
            const isVA   = s.brand === 'VIRGIN_ACTIVE';
            const iconHtml = isVA
                ? `<div class="sp-va-badge">VA</div>`
                : `<div class="sp-row-icon${isSelected ? '' : ''}">
                       <i data-lucide="${SP_TYPE_ICONS[s.water_type] || 'map-pin'}" style="width:16px;height:16px;"></i>
                   </div>`;
            return `
                <div class="sp-row${isSelected ? ' selected' : ''}"
                     data-spot-id="${s.id}"
                     data-spot-name="${s.name.replace(/"/g, '&quot;')}"
                     onclick="selectSpotFromPicker(this.dataset.spotId, this.dataset.spotName)"
                     style="animation: spRowFadeIn 0.25s ${delay}ms ease both;">
                    ${iconHtml}
                    <div class="sp-row-main">
                        <div class="sp-row-name">${s.name}${internationalSpotIds.has(s.id) ? ' <i data-lucide="globe" style="width:11px;height:11px;color:#fbbf24;vertical-align:middle;display:inline-block;"></i>' : ''}</div>
                        <div class="sp-row-type">${spAreaName(s.domain)} · ${SP_TYPE_LABELS[s.water_type] || s.water_type}</div>
                    </div>
                    <div class="sp-row-right">
                        ${distStr ? `<span class="sp-row-distance">${distStr}</span>` : ''}
                        ${isLogged ? '<div class="sp-logged-dot" title="Logged here before"></div>' : ''}
                    </div>
                </div>`;
        }

        // Render the spot list for current category + brand + search
        function renderSpotPickerList() {
            const container = document.getElementById('spList');
            if (!container) return;

            const q          = pickerSearch.trim().toLowerCase();
            const currentVal = document.getElementById('logTempSpotSelect')?.value || '';

            if (q === '__intl__') {
                // International pill — show all spots where countries.is_domestic = false
                const filtered = spots.filter(s => s.active !== false && internationalSpotIds.has(s.id));
                if (filtered.length === 0) {
                    container.innerHTML = `<div class="sp-empty"><div class="sp-empty-icon"><i data-lucide="globe" style="width:32px;height:32px;"></i></div><div class="sp-empty-text">No international spots found</div></div>${spAddRowHTML()}`;
                    initIcons();
                    return;
                }
                const spotsWithDist = filtered.map(s => ({
                    ...s,
                    _dist: (pickerGpsCoords && s.latitude && s.longitude)
                        ? getDistanceKm(pickerGpsCoords.lat, pickerGpsCoords.lng, s.latitude, s.longitude)
                        : null
                })).sort((a, b) => {
                    if (a._dist !== null && b._dist !== null) return a._dist - b._dist;
                    if (a._dist !== null) return -1;
                    if (b._dist !== null) return 1;
                    return a.name.localeCompare(b.name);
                });
                let html = '';
                spotsWithDist.forEach((s, i) => { html += _spRowHTML(s, currentVal, Math.min(i * 18, 300)); });
                html += spAddRowHTML();
                container.innerHTML = html;
                initIcons();
                return;
            }

            if (q) {
                // Cross-category search — ignore active tab, find any matching spot
                const filtered = spots.filter(s => s.active !== false && (
                    s.name.toLowerCase().includes(q) ||
                    (s.area || '').toLowerCase().includes(q) ||
                    spAreaName(s.domain).toLowerCase().includes(q) ||
                    (s.domain || '').toLowerCase().includes(q)
                ));

                if (filtered.length === 0) {
                    container.innerHTML = `
                        <div class="sp-empty">
                            <div class="sp-empty-icon"><i data-lucide="search" style="width:32px;height:32px;"></i></div>
                            <div class="sp-empty-text">No spots found for "${pickerSearch}"</div>
                        </div>
                        ${spAddRowHTML()}`;
                    initIcons();
                    return;
                }

                // Attach distance + render flat list with type label
                const spotsWithDist = filtered.map(s => ({
                    ...s,
                    _dist: (pickerGpsCoords && s.latitude && s.longitude)
                        ? getDistanceKm(pickerGpsCoords.lat, pickerGpsCoords.lng, s.latitude, s.longitude)
                        : null
                })).sort((a, b) => {
                    if (a._dist !== null && b._dist !== null) return a._dist - b._dist;
                    if (a._dist !== null) return -1;
                    if (b._dist !== null) return 1;
                    return a.name.localeCompare(b.name);
                });

                let html = '';
                spotsWithDist.forEach((s, i) => {
                    html += _spRowHTML(s, currentVal, Math.min(i * 18, 300));
                });
                html += spAddRowHTML();
                container.innerHTML = html;
                initIcons();
                return;
            }

            // ── Normal (no search): category + sub-filters ────────────────────────
            let filtered = spots.filter(s => s.active !== false && s.water_type === pickerCategory);

            // Region sub-filter (Ocean / Lagoon / Inland tabs)
            if (pickerCategory !== 'POOL' && pickerDomain !== null) {
                filtered = filtered.filter(s => s.domain === pickerDomain);
            }

            // Brand sub-filter (Pool tab only)
            if (pickerCategory === 'POOL' && pickerBrand !== null) {
                if (pickerBrand === 'VIRGIN_ACTIVE') {
                    filtered = filtered.filter(s => s.brand === 'VIRGIN_ACTIVE');
                } else if (pickerBrand === 'PUBLIC') {
                    filtered = filtered.filter(s => !s.brand);
                }
            }

            if (filtered.length === 0) {
                const label = pickerBrand === 'VIRGIN_ACTIVE' ? 'Virgin Active'
                            : pickerBrand === 'PUBLIC'        ? 'public pool'
                            : SP_TYPE_LABELS[pickerCategory].toLowerCase();
                container.innerHTML = `
                    <div class="sp-empty">
                        <div class="sp-empty-icon"><i data-lucide="${SP_TYPE_ICONS[pickerCategory]}" style="width:32px;height:32px;"></i></div>
                        <div class="sp-empty-text">No ${label} spots found${q ? ` for "${pickerSearch}"` : ''}</div>
                    </div>
                    ${spAddRowHTML()}`;
                initIcons();
                return;
            }

            // Attach distance
            let spotsWithDist = filtered.map(s => {
                const dist = (pickerGpsCoords && s.latitude && s.longitude)
                    ? getDistanceKm(pickerGpsCoords.lat, pickerGpsCoords.lng, s.latitude, s.longitude)
                    : null;
                return { ...s, _dist: dist };
            });

            // ── Virgin Active: flat list, distance only, no area headers ──────────
            if (pickerCategory === 'POOL' && pickerBrand === 'VIRGIN_ACTIVE') {
                spotsWithDist.sort((a, b) => {
                    if (a._dist !== null && b._dist !== null) return a._dist - b._dist;
                    if (a._dist !== null) return -1;
                    if (b._dist !== null) return 1;
                    return a.name.localeCompare(b.name);
                });
                let html = '';
                spotsWithDist.forEach((s, i) => {
                    html += _spRowHTML(s, currentVal, Math.min(i * 18, 300));
                });
                html += spAddRowHTML();
                container.innerHTML = html;
                initIcons();
                return;
            }

            // ── Grouped view: sort by distance, group by domain ───────────────────
            // Global sort: by nearest spot distance first, alphabetical fallback
            spotsWithDist.sort((a, b) => {
                if (a._dist !== null && b._dist !== null) return a._dist - b._dist;
                if (a._dist !== null) return -1;
                if (b._dist !== null) return 1;
                return a.name.localeCompare(b.name);
            });

            // Build domain groups preserving GPS order
            const domainOrder = [];
            const byDomain = {};
            spotsWithDist.forEach(s => {
                if (!byDomain[s.domain]) { byDomain[s.domain] = []; domainOrder.push(s.domain); }
                byDomain[s.domain].push(s);
            });

            let html = '';
            let rowIdx = 0;
            domainOrder.forEach(domain => {
                let areaSpots = byDomain[domain];

                // "All" pools: VA branches first within each group, then public
                if (pickerCategory === 'POOL' && pickerBrand === null) {
                    const va  = areaSpots.filter(s => s.brand === 'VIRGIN_ACTIVE');
                    const pub = areaSpots.filter(s => s.brand !== 'VIRGIN_ACTIVE');
                    areaSpots = [...va, ...pub];
                }

                const count = areaSpots.length;
                // Suppress area header when user has already filtered to a single domain
                const singleDomain = pickerDomain !== null || (pickerCategory === 'POOL' && pickerBrand === 'VIRGIN_ACTIVE');
                if (!singleDomain) {
                    const label = pickerCategory === 'POOL'
                        ? `${spAreaName(domain)} · ${count} pool${count !== 1 ? 's' : ''}`
                        : spAreaName(domain);
                    html += `<div class="sp-area-header">${label}</div>`;
                }
                areaSpots.forEach(s => {
                    html += _spRowHTML(s, currentVal, Math.min(rowIdx * 18, 300));
                    rowIdx++;
                });
            });

            html += spAddRowHTML();
            container.innerHTML = html;
            initIcons();
        }

        function spAddRowHTML() {
            return `
                <div class="sp-add-row" onclick="closeSpotPicker(); showSuggestSpot();">
                    <div class="sp-add-icon">
                        <i data-lucide="plus" style="width:16px;height:16px;"></i>
                    </div>
                    <div>
                        <div class="sp-add-label">Can't find your spot? Add it</div>
                    </div>
                </div>`;
        }

        // Toggle backdate picker for temp logging
        function toggleBackdate() {
            const picker = document.getElementById('backdatePicker');
            const btn = document.getElementById('backdateToggleBtn');
            const label = document.getElementById('backdateToggleLabel');
            const input = document.getElementById('backdateTime');
            if (picker.style.display === 'none') {
                picker.style.display = 'block';
                btn.style.background = 'rgba(14,165,233,0.1)';
                btn.style.borderColor = 'rgba(14,165,233,0.4)';
                label.style.color = 'var(--ocean-light)';
                // Set max to now, min to 48h ago, default to now
                const now = new Date();
                const ago48 = new Date(now.getTime() - 48 * 60 * 60 * 1000);
                const pad = n => String(n).padStart(2, '0');
                const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                input.max = fmt(now);
                input.min = fmt(ago48);
                input.value = fmt(now);
            } else {
                picker.style.display = 'none';
                btn.style.background = 'rgba(15,23,42,0.6)';
                btn.style.borderColor = 'rgba(56,189,248,0.2)';
                label.style.color = 'var(--text-secondary)';
                input.value = '';
            }
        }

        // Submit temperature log
        let _locationConfirmResolve = null;

        function confirmLocationBeforeSubmit(spotName) {
            return new Promise(resolve => {
                _locationConfirmResolve = resolve;
                document.getElementById('locationConfirmSpotName').textContent = spotName;
                const modal = document.getElementById('locationConfirmModal');
                modal.style.display = 'flex';
            });
        }

        function resolveLocationConfirm(confirmed) {
            document.getElementById('locationConfirmModal').style.display = 'none';
            if (_locationConfirmResolve) {
                _locationConfirmResolve(confirmed);
                _locationConfirmResolve = null;
            }
        }

        function cancelLocationConfirm() {
            document.getElementById('locationConfirmModal').style.display = 'none';
            if (_locationConfirmResolve) {
                _locationConfirmResolve(false);
                _locationConfirmResolve = null;
            }
            showPage('dashboard');
        }

        // ── Phase 1: Share conditions after logging ──────────────────────────────
        let _shareSheetResolve = null;
        let _shareSheetMessage = '';

        function showShareSheet(spotName, temp, conditions) {
            const cond = conditions ? conditions.charAt(0).toUpperCase() + conditions.slice(1) : '';
            const message = `${spotName}: ${temp}°C${cond ? ' • ' + cond : ''}\nLogged on SwimLoading — swimloading.com`;
            _shareSheetMessage = message;
            document.getElementById('shareSheetTitle').textContent = `${spotName}: ${temp}°C${cond ? ' • ' + cond : ''}`;
            document.getElementById('shareSheetMessage').textContent = message;
            return new Promise(resolve => {
                _shareSheetResolve = resolve;
                document.getElementById('shareConditionsModal').style.display = 'flex';
            });
        }

        function dismissShareSheet() {
            document.getElementById('shareConditionsModal').style.display = 'none';
            if (_shareSheetResolve) { _shareSheetResolve(); _shareSheetResolve = null; }
        }

        function shareSheetWhatsApp() {
            const url = `https://wa.me/?text=${encodeURIComponent(_shareSheetMessage)}`;
            window.open(url, '_blank');
            dismissShareSheet();
            analytics.track('whatsapp_shared');
        }

        // Phase 3+4+5: Share spot conditions from Latest Conditions cards (tracked deep link)
        function shareSpotConditions(spotId) {
            const d = (window._spotShareData || {})[spotId];
            if (!d) return;
            const condStr = d.cond ? ` • ${d.cond.charAt(0).toUpperCase() + d.cond.slice(1)}` : '';
            const countStr = d.logCount ? `\n${d.logCount}` : '';
            const noteStr = d.noteText ? `\n"${d.noteText}"` : '';
            const trackLink = `https://swimloading.com/r?type=spot&id=${encodeURIComponent(spotId)}`;
            const msg = `${d.name}: ${d.temp}°C${condStr}${countStr}${noteStr}\n\nCheck conditions → ${trackLink}`;
            window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
        }

        async function submitTempLog() {
            const submitBtn = document.getElementById('submitTempBtn');
            if (submitBtn.disabled) return;

            // Check if profile is complete
            if (window.incompleteProfile) {
                showToast('Please complete your profile first to log temperatures', 'info');
                showOnboardingPersonal();
                return;
            }

            // Location confirmation — show before any validation
            const spotSelectEl = document.getElementById('logTempSpotSelect');
            const spotId = spotSelectEl?.value || '';
            const spotForConfirm = spots.find(s => s.id === spotId);
            const spotNameForConfirm = spotForConfirm?.name || document.getElementById('spTriggerText')?.textContent || 'Unknown spot';
            const locationConfirmed = await confirmLocationBeforeSubmit(spotNameForConfirm);
            if (!locationConfirmed) return;

            submitBtn.disabled = true;
            submitBtn.textContent = 'Sharing...';
            const temp = parseFloat(document.getElementById('tempValue').textContent);
            const conditionsRaw = document.querySelector('#logTemp .toggle-btn.active')?.textContent.trim() || 'Calm';

            // Remove emojis and extract just the word (calm, choppy, rough, extreme)
            const conditions = conditionsRaw.replace(/[^\w\s]/g, '').trim().toLowerCase();

            // Get selected hazards and remove emojis
            const hazards = Array.from(document.querySelectorAll('#hazardsToggleGroup .toggle-btn.active'))
                .map(btn => btn.textContent.replace(/[^\w\s]/g, '').trim().toLowerCase());

            const notes = document.querySelector('#logTemp textarea').value;

            // Check for backdated time
            const backdateInput = document.getElementById('backdateTime');
            const backdatePicker = document.getElementById('backdatePicker');
            let loggedAt = null;
            if (backdatePicker && backdatePicker.style.display !== 'none' && backdateInput && backdateInput.value) {
                const chosenTime = new Date(backdateInput.value);
                const now = new Date();
                const ago48 = new Date(now.getTime() - 48 * 60 * 60 * 1000);
                if (chosenTime > now) {
                    showToast('Cannot log a future time.', 'error');
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Share Conditions';
                    return;
                }
                if (chosenTime < ago48) {
                    showToast('Cannot backdate more than 48 hours.', 'error');
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Share Conditions';
                    return;
                }
                loggedAt = chosenTime.toISOString();
            }

            // Duplicate check: prevent logging same spot within 1 hour
            // For backdated logs, check around the chosen time instead of now
            const checkTime = loggedAt ? new Date(loggedAt) : new Date();
            const oneHourBefore = new Date(checkTime.getTime() - 60 * 60 * 1000).toISOString();
            const oneHourAfter = new Date(checkTime.getTime() + 60 * 60 * 1000).toISOString();
            const { data: recentLogs } = await supabaseClient
                .from('temp_logs')
                .select('id, created_at, logged_at')
                .eq('user_id', currentUser.id)
                .eq('spot_id', spotId)
                .gte('logged_at', oneHourBefore)
                .lte('logged_at', oneHourAfter)
                .limit(1);

            if (recentLogs && recentLogs.length > 0) {
                const logTime = new Date(recentLogs[0].logged_at || recentLogs[0].created_at);
                const minsAgo = Math.round(Math.abs(checkTime - logTime) / 60000);
                const minsLeft = 60 - minsAgo;
                showToast(`You already logged this spot within an hour of that time. Try again in ${minsLeft > 0 ? minsLeft : 1} min.`, 'error');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Share Conditions';
                return;
            }

            // Smart temp validation — compare against recent readings for this spot
            const spotInfo = spots.find(s => s.id === spotId);
            const waterType = spotInfo ? spotInfo.water_type : 'OCEAN';

            // Absolute range check by water type
            // KZN / Indian Ocean is significantly warmer — raise ocean ceiling to 30°C
            // Warm-water domains: raise ocean ceiling to 30°C (Agulhas + Indian Ocean)
            const warmDomains = ['KZN', 'GARDEN_ROUTE', 'EASTERN_CAPE'];
            const isWarmDomain = warmDomains.includes(spotInfo?.domain);
            const ranges = {
                'OCEAN':  isWarmDomain ? { min: 14, max: 30, label: 'ocean' } : { min: 10, max: 22, label: 'ocean' },
                'LAGOON': { min: 10, max: 30, label: 'lagoon' },
                'DAM':    { min: 10, max: 28, label: 'dam' },
                'LAKE':   { min: 4,  max: 28, label: 'lake' },
                'POOL':   { min: 18, max: 34, label: 'pool' }
            };
            const range = ranges[waterType] || ranges['OCEAN'];

            let warning = null;

            if (temp < range.min || temp > range.max) {
                warning = `${temp}° seems unusual for a ${range.label} spot (typical: ${range.min}°–${range.max}°).`;
            }

            // Compare against recent community logs for this spot (time-aware)
            if (!warning) {
                const { data: recentSpotLogs } = await supabaseClient
                    .from('temp_logs')
                    .select('temp_c, created_at')
                    .eq('spot_id', spotId)
                    .order('created_at', { ascending: false })
                    .limit(5);

                if (recentSpotLogs && recentSpotLogs.length >= 2) {
                    const avgTemp = recentSpotLogs.reduce((sum, l) => sum + parseFloat(l.temp_c), 0) / recentSpotLogs.length;
                    const diff = Math.abs(temp - avgTemp);
                    // Time since most recent log in hours
                    const mostRecentLog = new Date(recentSpotLogs[0].created_at);
                    const hoursSince = (Date.now() - mostRecentLog) / (1000 * 60 * 60);
                    // Scale threshold: 4° within 24hrs, 6° within 3 days, 8° beyond that
                    const threshold = hoursSince < 24 ? 4 : hoursSince < 72 ? 6 : 8;
                    if (diff > threshold) {
                        const timeAgo = hoursSince < 24 ? `${Math.round(hoursSince)} hours` : `${Math.round(hoursSince / 24)} days`;
                        warning = `${temp}° is ${diff.toFixed(1)}° ${temp > avgTemp ? 'warmer' : 'colder'} than recent readings (avg ${avgTemp.toFixed(1)}°, last logged ${timeAgo} ago) at ${spotInfo ? spotInfo.name : 'this spot'}.`;
                    }
                }
            }

            if (warning) {
                const proceed = confirm(`Temperature Check\n\n${warning}\n\nAre you sure this is correct?`);
                if (!proceed) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Share Conditions';
                    return;
                }
            }

            // Determine location source
            let locationSource = 'fallback';
            if (selectedSpotLocked) {
                locationSource = 'manual';
            } else if (currentGpsLocation) {
                locationSource = 'gps';
            }

            // Build insert object
            const logData = {
                user_id: currentUser.id,
                spot_id: spotId,
                temp_c: temp,
                conditions: conditions,
                hazards: hazards,
                notes: notes,
                location_source: locationSource,
                gps_spot_id: gpsSuggestedSpotId
            };

            // Add backdated timestamp if set
            if (loggedAt) {
                logData.logged_at = loggedAt;
            }

            // Store GPS in dedicated lat/lng columns only — never in notes
            if (currentGpsLocation) {
                logData.lat = currentGpsLocation.lat;
                logData.lng = currentGpsLocation.lng;
            }

            const { data, error } = await supabaseClient
                .from('temp_logs')
                .insert(logData);

            if (error) {
                alert('Error logging temperature: ' + error.message);
                console.error(error);
                submitBtn.disabled = false;
                submitBtn.textContent = 'Share Conditions';
            } else {
                // Calculate points earned for this log
                const ptsEarned = 10;
                showToast(loggedAt ? `Backdated conditions logged! +${ptsEarned} points!` : `Conditions shared! +${ptsEarned} points`, 'success');
                analytics.track('temp_logged', { spot: spotNameForConfirm, temp, conditions });
                if (hazards.length > 0) analytics.track('hazard_reported', { hazards });

                // Reset backdate picker
                const bdPicker = document.getElementById('backdatePicker');
                const bdBtn = document.getElementById('backdateToggleBtn');
                const bdLabel = document.getElementById('backdateToggleLabel');
                if (bdPicker) bdPicker.style.display = 'none';
                if (bdBtn) { bdBtn.style.background = 'rgba(15,23,42,0.6)'; bdBtn.style.borderColor = 'rgba(56,189,248,0.2)'; }
                if (bdLabel) bdLabel.style.color = 'var(--text-secondary)';
                const bdInput = document.getElementById('backdateTime');
                if (bdInput) bdInput.value = '';

                // Reset GPS, lock state, and spot picker trigger
                selectedSpotLocked = false;
                gpsSuggestedSpotId = null;
                currentGpsLocation = null;
                pickerGpsCoords = null;
                pickerGpsLoaded = false;
                const trigger = document.getElementById('spotPickerTrigger');
                const label   = document.getElementById('spTriggerText');
                if (trigger) trigger.classList.remove('sp-has-value');
                if (label)   label.textContent = 'Select a spot...';
                const status = document.getElementById('gpsStatus');
                if (status) status.textContent = '';

                // Check for new badges after logging a temp
                await checkAndAwardBadges();

                // Phase 1: Show WhatsApp share sheet for live (non-backdated) logs
                if (!loggedAt) {
                    await showShareSheet(spotNameForConfirm, temp, conditions);
                    // Broadcast push to subscribers at this location
                    const loggedSpot = spots.find(s => s.id === spotId);
                    if (loggedSpot?.domain) {
                        const poster = currentUserProfile?.display_name || 'Someone';
                        broadcastPush(loggedSpot.domain, 'temp', 'SwimLoading',
                            `${poster} just logged ${temp}°C at ${spotNameForConfirm}`);
                    }
                }

                // Re-enable button and switch to dashboard
                submitBtn.disabled = false;
                submitBtn.textContent = 'Share Conditions';
                showPage('dashboard');
                await loadDashboard();
                await loadLeaderboard(); // Refresh leaderboard to show new points
            }
        }

        // ============================================
        // BADGES SYSTEM
        // Uses existing badges + user_badges tables in Supabase
        // Badge definitions are fetched from the badges table
        // Criteria is stored as jsonb with keys like:
        //   logs_required, streak_required, temp_max,
        //   swims_required, hazard, time_before, pace_max, distance_min
        // ============================================

        // Cache for badge definitions (loaded from DB)
        let allBadges = [];

        async function loadBadgeDefinitions() {
            if (allBadges.length > 0) return allBadges;
            const { data, error } = await supabaseClient
                .from('badges')
                .select('*')
                .order('category, name');
            if (!error && data) allBadges = data;
            return allBadges;
        }

        // Check all badge criteria and award any newly earned badges
        async function checkAndAwardBadges() {
            if (!currentUser) return;

            try {
                // Load badge definitions from DB
                const badges = await loadBadgeDefinitions();
                if (badges.length === 0) return;

                // Get user's already-earned badge IDs
                const { data: existingBadges } = await supabaseClient
                    .from('user_badges')
                    .select('badge_id')
                    .eq('user_id', currentUser.id);

                const earnedIds = new Set((existingBadges || []).map(b => b.badge_id));

                // Skip badges already earned
                const unchecked = badges.filter(b => !earnedIds.has(b.id));
                if (unchecked.length === 0) return;

                // Gather user data needed for criteria checks
                const { data: stats } = await supabaseClient
                    .from('user_stats')
                    .select('*')
                    .eq('user_id', currentUser.id)
                    .single();

                const { count: logCount } = await supabaseClient
                    .from('temp_logs')
                    .select('*', { count: 'exact', head: true })
                    .eq('user_id', currentUser.id);

                const { count: swimCount } = await supabaseClient
                    .from('swim_participants')
                    .select('*', { count: 'exact', head: true })
                    .eq('user_id', currentUser.id)
                    .eq('status', 'approved');

                const { count: organisedCount } = await supabaseClient
                    .from('swim_events')
                    .select('*', { count: 'exact', head: true })
                    .eq('created_by', currentUser.id)
                    .neq('status', 'cancelled');

                // Get temp data for temp_max checks
                const { data: userLogs } = await supabaseClient
                    .from('temp_logs')
                    .select('temp_c, conditions, created_at')
                    .eq('user_id', currentUser.id);

                const temps = (userLogs || []).map(l => l.temp_c).filter(t => t != null);
                const minTemp = temps.length > 0 ? Math.min(...temps) : 99;

                // Check for hazard badges (e.g. "seals" logged in conditions)
                const allConditions = (userLogs || [])
                    .map(l => (l.conditions || '').toLowerCase())
                    .join(' ');

                // Check for early bird (time_before: "06:00")
                const logTimes = (userLogs || []).map(l => {
                    const d = new Date(l.created_at);
                    return d.getHours() * 100 + d.getMinutes(); // e.g. 530 for 05:30
                });

                const streak = stats?.current_streak || 0;

                // Evaluate each unchecked badge
                const newBadges = [];
                for (const badge of unchecked) {
                    const c = badge.criteria || {};
                    let earned = false;

                    // logs_required: number of temp logs
                    if (c.logs_required != null) {
                        earned = logCount >= c.logs_required;
                    }

                    // streak_required: consecutive days
                    if (c.streak_required != null) {
                        earned = streak >= c.streak_required;
                    }

                    // swims_required: group swim participation
                    if (c.swims_required != null) {
                        earned = swimCount >= c.swims_required;
                    }

                    // organised_required: group swims created/organised
                    if (c.organised_required != null) {
                        earned = organisedCount >= c.organised_required;
                    }

                    // temp_max: logged a temp AT OR BELOW this value
                    if (c.temp_max != null && !c.distance_min) {
                        earned = minTemp <= c.temp_max;
                    }

                    // Polar Bear: temp_max + distance_min (cold water + long swim)
                    // Skip for now — needs swim distance data we don't track per log yet
                    if (c.temp_max != null && c.distance_min != null) {
                        earned = false; // Will enable when distance tracking is added
                    }

                    // hazard: logged a specific hazard (e.g. "seals")
                    if (c.hazard != null) {
                        earned = allConditions.includes(c.hazard.toLowerCase());
                    }

                    // time_before: logged a temp before this time (e.g. "06:00")
                    if (c.time_before != null) {
                        const [h, m] = c.time_before.split(':').map(Number);
                        const threshold = h * 100 + m; // e.g. 600 for 06:00
                        earned = logTimes.some(t => t < threshold);
                    }

                    // pace_max: skip for now — needs pace data from swim profile
                    if (c.pace_max != null) {
                        earned = false; // Will enable when swim pacing is added
                    }

                    if (earned) {
                        newBadges.push(badge);
                    }
                }

                // Award new badges
                if (newBadges.length > 0) {
                    const inserts = newBadges.map(b => ({
                        user_id: currentUser.id,
                        badge_id: b.id,  // uuid from badges table
                        earned_at: new Date().toISOString()
                    }));

                    const { error: insertErr } = await supabaseClient.from('user_badges').insert(inserts);

                    if (!insertErr) {
                        for (const badge of newBadges) {
                            showToast(`Badge unlocked: ${badge.name}!`, 'success');
                        }
                        renderDashBadges(); // refresh home badge section immediately
                    } else {
                        console.error('Badge insert error:', insertErr);
                    }
                }

            } catch (err) {
                console.error('Badge check error:', err);
            }
        }

        // Render badges section on dashboard
        async function renderDashBadges() {
            const container = document.getElementById('dashBadges');
            if (!container) return;

            try {
                // Load all badge definitions from DB
                const badges = await loadBadgeDefinitions();

                // Get user's earned badges (with badge details via join)
                const { data: earnedBadges } = await supabaseClient
                    .from('user_badges')
                    .select('badge_id, earned_at')
                    .eq('user_id', currentUser.id);

                const earnedIds = new Set((earnedBadges || []).map(b => b.badge_id));

                if (badges.length === 0) {
                    container.innerHTML = '';
                    return;
                }

                const earned = badges.filter(b => earnedIds.has(b.id));
                const locked = badges.filter(b => !earnedIds.has(b.id));

                // Show all earned + up to 4 locked previews (to keep section compact)
                const MAX_LOCKED_PREVIEW = 4;
                const lockedToShow = locked.slice(0, MAX_LOCKED_PREVIEW);
                const hiddenCount = locked.length - lockedToShow.length;

                let html = '<div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;">';

                for (const badge of earned) {
                    const safeDesc = badge.description.replace(/'/g, "\\'");
                    html += `
                        <div title="${badge.name}: ${badge.description}"
                             style="width: 56px; height: 56px; border-radius: 14px; background: rgba(56, 189, 248, 0.15); border: 2px solid rgba(56, 189, 248, 0.3); display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer;"
                             onclick="showToast('${badge.name} — ${safeDesc}', 'success')">
                            <i data-lucide="${badge.icon}" style="width: 24px; height: 24px; color: var(--ocean-light);"></i>
                            <span style="font-size: 8px; color: var(--text-secondary); margin-top: 2px; max-width: 50px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${badge.name}</span>
                        </div>
                    `;
                }

                for (const badge of lockedToShow) {
                    const safeDesc = badge.description.replace(/'/g, "\\'");
                    html += `
                        <div title="${badge.name}: ${badge.description}"
                             style="width: 56px; height: 56px; border-radius: 14px; background: rgba(255,255,255,0.03); border: 2px solid rgba(255,255,255,0.06); display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0.35; cursor: pointer;"
                             onclick="showToast('${badge.name} — ${safeDesc} (locked)', 'info')">
                            <span style="font-size: 11px; font-weight: 700; color: var(--text-secondary); opacity: 0.5;">LOCKED</span>
                            <span style="font-size: 8px; color: var(--text-secondary); margin-top: 2px; max-width: 50px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${badge.name}</span>
                        </div>
                    `;
                }

                // "+N more" pill if there are hidden locked badges
                if (hiddenCount > 0) {
                    html += `
                        <div style="width: 56px; height: 56px; border-radius: 14px; background: rgba(255,255,255,0.03); border: 2px dashed rgba(255,255,255,0.1); display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0.5; cursor: pointer;"
                             onclick="document.getElementById('dashBadges').closest('.page').scrollTo({top: document.getElementById('dashBadges').offsetTop, behavior: 'smooth'}); renderDashBadgesExpanded();" title="See all badges">
                            <span style="font-size: 14px; font-weight: 700; color: var(--text-secondary);">+${hiddenCount}</span>
                            <span style="font-size: 8px; color: var(--text-secondary); margin-top: 2px;">more</span>
                        </div>
                    `;
                }

                html += '</div>';

                if (earnedIds.size === 0) {
                    html += `<div style="text-align: center; margin-top: 8px; color: var(--text-secondary); font-size: 12px;">Log a temperature to earn your first badge!</div>`;
                } else {
                    html += `<div style="text-align: center; margin-top: 8px; color: var(--text-secondary); font-size: 12px;">${earnedIds.size} of ${badges.length} badges earned</div>`;
                }

                container.innerHTML = html;

            } catch (err) {
                console.error('Badge render error:', err);
                container.innerHTML = '';
            }
        }

        // Expand badge section to show all badges in-place
        async function renderDashBadgesExpanded() {
            const container = document.getElementById('dashBadges');
            if (!container) return;
            try {
                const badges = await loadBadgeDefinitions();
                const { data: earnedBadges } = await supabaseClient
                    .from('user_badges').select('badge_id').eq('user_id', currentUser.id);
                const earnedIds = new Set((earnedBadges || []).map(b => b.badge_id));
                const earned = badges.filter(b => earnedIds.has(b.id));
                const locked = badges.filter(b => !earnedIds.has(b.id));

                let html = '<div style="display: flex; flex-wrap: wrap; gap: 8px; justify-content: center;">';
                for (const badge of earned) {
                    const safeDesc = badge.description.replace(/'/g, "\\'");
                    html += `<div title="${badge.name}" style="width:56px;height:56px;border-radius:14px;background:rgba(56,189,248,0.15);border:2px solid rgba(56,189,248,0.3);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;" onclick="showToast('${badge.name} — ${safeDesc}', 'success')"><i data-lucide="${badge.icon}" style="width:24px;height:24px;color:var(--ocean-light);"></i><span style="font-size:8px;color:var(--text-secondary);margin-top:2px;max-width:50px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${badge.name}</span></div>`;
                }
                for (const badge of locked) {
                    const safeDesc = badge.description.replace(/'/g, "\\'");
                    html += `<div title="${badge.name}: ${badge.description}" style="width:56px;height:56px;border-radius:14px;background:rgba(255,255,255,0.03);border:2px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:0.35;cursor:pointer;" onclick="showToast('${badge.name} — ${safeDesc}', 'info')"><i data-lucide="lock" style="width:20px;height:20px;color:var(--text-secondary);"></i><span style="font-size:8px;color:var(--text-secondary);margin-top:2px;max-width:50px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${badge.name}</span></div>`;
                }
                html += '</div>';
                html += `<div style="text-align:center;margin-top:8px;color:var(--text-secondary);font-size:12px;">${earnedIds.size} of ${badges.length} badges earned · <span style="cursor:pointer;color:var(--ocean-light);" onclick="renderDashBadges()">show less</span></div>`;
                container.innerHTML = html;
            } catch(err) { console.error('Badge expand error:', err); }
        }


        // Show incomplete profile banner at top of page
        function showIncompleteProfileBanner() {
            const banner = document.createElement('div');
            banner.id = 'incompleteProfileBanner';
            banner.style.cssText = `
                position: sticky; top: 0; z-index: 99;
                background: linear-gradient(135deg, rgba(245,158,11,0.1), rgba(245,158,11,0.05));
                border-bottom: 1px solid rgba(245,158,11,0.3);
                padding: 12px 16px;
                display: flex; align-items: center; justify-content: space-between; gap: 12px;
                font-size: 13px; color: var(--text-secondary);
            `;
            banner.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                    <i data-lucide="alert-circle" style="width: 16px; height: 16px; color: var(--warning); flex-shrink: 0;"></i>
                    <span>Complete your profile to RSVP and log temperatures</span>
                </div>
                <button onclick="showOnboardingPersonal()" style="background: var(--ocean-light); color: white; border: none; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">Complete</button>
                <button onclick="document.getElementById('incompleteProfileBanner').style.display='none';" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 0; font-size: 16px;">✕</button>
            `;
            const mainApp = document.getElementById('mainApp');
            if (mainApp && mainApp.parentNode) {
                mainApp.parentNode.insertBefore(banner, mainApp);
                setTimeout(() => initIcons(), 0);
            }
        }

        // Show PWA install prompt with iOS/Android instructions
        function showPwaInstallPrompt() {
            const dismissKey = 'pwaInstallDismissCount';
            const dismissCount = parseInt(localStorage.getItem(dismissKey) || '0');
            if (dismissCount >= 3) return; // Don't show after 3 dismissals

            // Detect device
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
            const isAndroid = /Android/.test(navigator.userAgent);
            const isPWACapable = isIOS || isAndroid;

            if (!isPWACapable || window.matchMedia('(display-mode: standalone)').matches) return; // Already installed

            const banner = document.createElement('div');
            banner.id = 'pwaInstallBanner';
            banner.style.cssText = `
                position: sticky; top: 48px; z-index: 98;
                background: linear-gradient(135deg, rgba(56,189,248,0.1), rgba(56,189,248,0.05));
                border-bottom: 1px solid rgba(56,189,248,0.3);
                padding: 12px 16px;
                display: flex; align-items: center; justify-content: space-between; gap: 12px;
                font-size: 13px; color: var(--text-secondary);
            `;
            const instructions = isIOS
                ? 'Tap Share → Add to Home Screen for offline access & notifications'
                : 'Tap menu → Install app for offline access & notifications';

            banner.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                    <i data-lucide="smartphone" style="width: 16px; height: 16px; color: var(--ocean-light); flex-shrink: 0;"></i>
                    <span>${instructions}</span>
                </div>
                <button onclick="document.getElementById('pwaInstallBanner').remove(); localStorage.setItem('${dismissKey}', '${dismissCount + 1}');" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 0; font-size: 16px;">✕</button>
            `;
            const mainApp = document.getElementById('mainApp');
            if (mainApp && mainApp.parentNode) {
                mainApp.parentNode.insertBefore(banner, mainApp);
                setTimeout(() => initIcons(), 0);
            }
        }

        // Initialize on page load
        window.addEventListener('DOMContentLoaded', checkAuth);
