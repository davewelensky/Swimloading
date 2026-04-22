        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js')
                    .then(reg => console.log('SW registered:', reg.scope))
                    .catch(err => console.log('SW registration failed:', err));
            });
        }

        // ─── Fuel & Hydration Test ──────────────────────────────────────────────

        // ─── Fuel functions removed — see PHtest.html ───────────────────────────
        const FUEL_PROTOCOL_LABELS = {
            baseline:       'Baseline — No intake',
            ph500_during:   'PH500 During',
            ph1500_preload: 'PH1500 Preload',
            ph1500_ph500:   'PH1500 + PH500',
            fuel_test:      'Fuel Test (Gel/Chew)'
        };

        const SCORE_FIELDS = [
            { id: 'fuelEnergy',    label: 'Energy consistency' },
            { id: 'fuelEffort',    label: 'Perceived effort' },
            { id: 'fuelHydration', label: 'Hydration feeling' },
            { id: 'fuelStomach',   label: 'Stomach comfort' },
            { id: 'fuelRecovery',  label: 'Recovery' }
        ];

        function fuelToggle(btn) {
            const group = btn.dataset.group;
            document.querySelectorAll(`#fuelTestForm .fuel-toggle[data-group="${group}"]`).forEach(b => {
                b.style.background = 'rgba(15,23,42,0.4)';
                b.style.borderColor = 'var(--border)'; // will be overridden below via class
                b.classList.remove('active');
                b.style.color = 'var(--text-secondary)';
            });
            btn.classList.add('active');
            btn.style.background = 'rgba(56,189,248,0.12)';
            btn.style.borderColor = 'rgba(56,189,248,0.4)';
            btn.style.color = 'var(--ocean-light)';
            updateFuelSummaryPreview();
        }

        function toggleFlag(btn) {
            const on = btn.classList.toggle('active');
            btn.style.background = on ? 'rgba(56,189,248,0.12)' : 'rgba(15,23,42,0.4)';
            btn.style.borderColor = on ? 'rgba(56,189,248,0.3)' : 'var(--border)';
            btn.style.color = on ? 'var(--ocean-light)' : 'var(--text-secondary)';
            updateFuelSummaryPreview();
        }

        function buildSetEffortRows(count) {
            const el = document.getElementById('fuelSetEfforts');
            el.innerHTML = '';
            for (let i = 1; i <= count; i++) {
                el.innerHTML += `
                <div style="display:flex;align-items:center;gap:10px;">
                    <div style="font-size:12px;color:var(--text-secondary);width:42px;flex-shrink:0;">Set ${i}</div>
                    <div style="display:flex;gap:6px;flex:1;">
                        <button class="fuel-toggle active" data-group="set_${i}" data-value="same" onclick="fuelToggle(this)" style="flex:1;padding:8px 0;border-radius:8px;border:1px solid rgba(56,189,248,0.3);background:rgba(56,189,248,0.12);color:var(--ocean-light);font-size:12px;font-weight:600;cursor:pointer;">Same</button>
                        <button class="fuel-toggle" data-group="set_${i}" data-value="easier" onclick="fuelToggle(this)" style="flex:1;padding:8px 0;border-radius:8px;border:1px solid var(--border);background:rgba(15,23,42,0.4);color:var(--text-secondary);font-size:12px;font-weight:600;cursor:pointer;">Easier</button>
                        <button class="fuel-toggle" data-group="set_${i}" data-value="harder" onclick="fuelToggle(this)" style="flex:1;padding:8px 0;border-radius:8px;border:1px solid var(--border);background:rgba(15,23,42,0.4);color:var(--text-secondary);font-size:12px;font-weight:600;cursor:pointer;">Harder</button>
                    </div>
                </div>`;
            }
        }

        function buildScoreSliders() {
            const el = document.getElementById('fuelScores');
            el.innerHTML = SCORE_FIELDS.map(f => `
                <div>
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <div style="font-size:13px;color:var(--text);">${f.label}</div>
                        <div id="${f.id}Val" style="font-size:15px;font-weight:800;color:var(--ocean-light);min-width:24px;text-align:right;">7</div>
                    </div>
                    <input type="range" id="${f.id}" min="1" max="10" value="7" step="1"
                        oninput="document.getElementById('${f.id}Val').textContent=this.value;updateFuelSummaryPreview();"
                        style="width:100%;accent-color:var(--ocean-light);height:6px;cursor:pointer;">
                    <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-secondary);margin-top:3px;"><span>1 Poor</span><span>10 Great</span></div>
                </div>
            `).join('');
        }

        function getFuelFormValues() {
            const sets = [];
            const dist = parseInt(document.getElementById('fuelDistance')?.value || 5);
            const setCount = Math.min(Math.max(dist, 1), 10);
            for (let i = 1; i <= setCount; i++) {
                const active = document.querySelector(`#fuelTestForm .fuel-toggle.active[data-group="set_${i}"]`);
                sets.push(active?.dataset.value || 'same');
            }
            return {
                test_date:    document.getElementById('fuelDate').value || new Date().toISOString().slice(0,10),
                spot_id:      document.getElementById('fuelSpot').value || null,
                water_temp:   parseFloat(document.getElementById('fuelWaterTemp').value) || null,
                session_type: document.querySelector('#fuelTestForm .fuel-toggle.active[data-group="session_type"]')?.dataset.value || 'sea',
                distance_km:  parseFloat(document.getElementById('fuelDistance').value) || 5,
                structure:    document.getElementById('fuelStructure').value || '5x1000m',
                protocol:     document.querySelector('#fuelTestForm .fuel-toggle.active[data-group="protocol"]')?.dataset.value || 'baseline',
                intake_before: document.querySelector('#fuelTestForm .fuel-toggle.active[data-group="intake_before"]')?.dataset.value || 'none',
                intake_during: document.querySelector('#fuelTestForm .fuel-toggle.active[data-group="intake_during"]')?.dataset.value || 'none',
                intake_notes: document.getElementById('fuelIntakeNotes').value || null,
                set_efforts:  sets,
                energy_consistency: parseInt(document.getElementById('fuelEnergy')?.value || 7),
                perceived_effort:   parseInt(document.getElementById('fuelEffort')?.value || 7),
                hydration_feeling:  parseInt(document.getElementById('fuelHydration')?.value || 7),
                stomach_comfort:    parseInt(document.getElementById('fuelStomach')?.value || 7),
                recovery:           parseInt(document.getElementById('fuelRecovery')?.value || 7),
                stronger_finish: document.getElementById('flagStronger')?.classList.contains('active') || false,
                faded_end:      document.getElementById('flagFaded')?.classList.contains('active') || false,
                thirst:         document.getElementById('flagThirst')?.classList.contains('active') || false,
                cramping:       document.getElementById('flagCramping')?.classList.contains('active') || false,
                verdict: document.querySelector('#fuelTestForm .fuel-toggle.active[data-group="verdict"]')?.dataset.value || 'same'
            };
        }

        function generateFuelSummary(d) {
            const spotName = spots.find(s => s.id === d.spot_id)?.name || 'Unknown location';
            const proto = FUEL_PROTOCOL_LABELS[d.protocol] || d.protocol;
            const scores = [d.energy_consistency, d.perceived_effort, d.hydration_feeling, d.stomach_comfort, d.recovery];
            const avg = (scores.reduce((a,b) => a+b, 0) / scores.length).toFixed(1);
            const flags = [];
            if (d.stronger_finish) flags.push('strong finish');
            if (d.faded_end) flags.push('faded end');
            if (d.thirst) flags.push('thirst noted');
            if (d.cramping) flags.push('cramping');
            let s = `${proto} · ${spotName}`;
            if (d.water_temp) s += ` (${d.water_temp}°C)`;
            s += ` · ${d.distance_km}km ${d.structure}`;
            s += `. Avg score ${avg}/10`;
            if (d.stomach_comfort <= 5) s += ' stomach discomfort';
            if (d.energy_consistency >= 8) s += ' · high energy consistency';
            const effortCounts = d.set_efforts.reduce((acc, e) => { acc[e] = (acc[e]||0)+1; return acc; }, {});
            if (effortCounts.harder > 1) s += ` · faded over sets`;
            if (effortCounts.easier > 1) s += ` · felt progressively easier`;
            if (flags.length) s += ` · flags: ${flags.join(', ')}`;
            s += `. Verdict: ${d.verdict}.`;
            return s;
        }

        function updateFuelSummaryPreview() {
            try {
                const d = getFuelFormValues();
                const summary = generateFuelSummary(d);
                document.getElementById('fuelSummaryText').textContent = summary;
                document.getElementById('fuelSummaryPreview').style.display = 'block';
            } catch(e) { /* form not ready */ }
        }

        function showFuelForm() {
            // Set today's date
            document.getElementById('fuelDate').value = new Date().toISOString().slice(0,10);
            // Populate spot dropdown
            const sel = document.getElementById('fuelSpot');
            sel.innerHTML = '<option value="">— Select spot —</option>' +
                (spots || []).map(s => `<option value="${s.id}">${s.name}</option>`).join('');
            // Build set effort rows based on default distance
            buildSetEffortRows(5);
            buildScoreSliders();
            updateFuelSummaryPreview();
            document.getElementById('fuelTestForm').style.display = 'block';
            document.getElementById('fuelTestHistory').style.display = 'none';
            document.getElementById('fuelTestForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        function cancelFuelForm() {
            document.getElementById('fuelTestForm').style.display = 'none';
            document.getElementById('fuelTestHistory').style.display = 'block';
        }

        async function saveFuelTest() {
            if (!currentUser) { showToast('Please log in first', 'error'); return; }
            const btn = document.getElementById('fuelSaveBtn');
            btn.disabled = true;
            btn.textContent = 'Saving…';
            try {
                const d = getFuelFormValues();
                d.auto_summary = generateFuelSummary(d);
                d.user_id = currentUser.id;
                const { error } = await supabaseClient.from('fuel_tests').insert(d);
                if (error) throw error;
                showToast('Test saved!', 'success');
                cancelFuelForm();
                loadFuelTests();
            } catch(e) {
                showToast('Could not save: ' + e.message, 'error');
            } finally {
                btn.disabled = false;
                btn.textContent = 'Save Test';
            }
        }

        async function loadFuelTests() {
            const el = document.getElementById('fuelTestHistory');
            if (!currentUser) {
                el.innerHTML = '<div style="text-align:center;color:var(--text-secondary);font-size:13px;padding:20px;">Log in to see your tests.</div>';
                return;
            }
            el.innerHTML = '<div style="color:var(--text-secondary);font-size:13px;text-align:center;padding:20px;">Loading…</div>';
            const { data, error } = await supabaseClient
                .from('fuel_tests')
                .select('*, spots(name)')
                .eq('user_id', currentUser.id)
                .order('test_date', { ascending: false })
                .limit(50);
            if (error || !data?.length) {
                el.innerHTML = '<div style="text-align:center;color:var(--text-secondary);font-size:13px;padding:20px;">No tests yet — tap "+ New Test" to start tracking.</div>';
                return;
            }
            // Group by protocol for comparison insight
            const byProto = {};
            data.forEach(t => { (byProto[t.protocol] = byProto[t.protocol]||[]).push(t); });
            const protos = Object.keys(byProto);
            let html = '';
            if (protos.length > 1) {
                html += `<div class="card" style="margin-bottom:10px;">
                    <div style="font-size:11px;font-weight:700;color:var(--ocean-light);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px;">Protocol Comparison</div>
                    <div style="display:flex;flex-direction:column;gap:8px;">`;
                protos.forEach(p => {
                    const tests = byProto[p];
                    const avgStomach = (tests.reduce((s,t) => s + (t.stomach_comfort||7), 0) / tests.length).toFixed(1);
                    const avgEnergy  = (tests.reduce((s,t) => s + (t.energy_consistency||7), 0) / tests.length).toFixed(1);
                    const betterCount = tests.filter(t => t.verdict === 'better').length;
                    html += `<div style="background:rgba(15,23,42,0.5);border-radius:10px;padding:10px 12px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                            <div style="font-size:13px;font-weight:700;color:var(--text);">${FUEL_PROTOCOL_LABELS[p]||p}</div>
                            <div style="font-size:11px;color:var(--text-secondary);">${tests.length} test${tests.length!==1?'s':''}</div>
                        </div>
                        <div style="display:flex;gap:12px;">
                            <div style="font-size:11px;color:var(--text-secondary);">Stomach <strong style="color:${avgStomach>=7?'var(--success)':'var(--warning)'};">${avgStomach}</strong></div>
                            <div style="font-size:11px;color:var(--text-secondary);">Energy <strong style="color:var(--ocean-light);">${avgEnergy}</strong></div>
                            <div style="font-size:11px;color:var(--text-secondary);">Better verdict <strong style="color:var(--success);">${betterCount}/${tests.length}</strong></div>
                        </div>
                    </div>`;
                });
                html += '</div></div>';
            }
            data.forEach(t => {
                const spotName = t.spots?.name || '—';
                const dateStr = new Date(t.test_date).toLocaleDateString('en-ZA', { day:'numeric', month:'short', year:'numeric' });
                const verdictColor = t.verdict==='better' ? 'var(--success)' : t.verdict==='worse' ? 'var(--danger)' : 'var(--text-secondary)';
                const verdictEmoji = t.verdict==='better' ? 'Better' : t.verdict==='worse' ? 'Worse' : 'Same';
                const scores = [t.energy_consistency, t.perceived_effort, t.hydration_feeling, t.stomach_comfort, t.recovery].filter(Boolean);
                const avg = scores.length ? (scores.reduce((a,b)=>a+b,0)/scores.length).toFixed(1) : '—';
                html += `<div class="card" style="margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
                        <div>
                            <div style="font-size:14px;font-weight:700;color:var(--text);">${FUEL_PROTOCOL_LABELS[t.protocol]||t.protocol}</div>
                            <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">${dateStr} · ${spotName}${t.water_temp ? ' · '+t.water_temp+'°C' : ''}</div>
                        </div>
                        <div style="text-align:right;flex-shrink:0;">
                            <div style="font-size:11px;color:${verdictColor};font-weight:700;text-transform:uppercase;">${verdictEmoji}</div>
                        </div>
                    </div>
                    <div style="display:flex;gap:16px;margin-bottom:${t.auto_summary?'8':'0'}px;">
                        <div style="font-size:11px;color:var(--text-secondary);">Avg score <strong style="color:var(--ocean-light);">${avg}/10</strong></div>
                        <div style="font-size:11px;color:var(--text-secondary);">${t.distance_km}km ${t.structure||''}</div>
                        ${t.cramping ? '<div style="font-size:11px;color:var(--danger);">cramping</div>' : ''}
                        ${t.thirst ? '<div style="font-size:11px;color:var(--warning);">thirst</div>' : ''}
                    </div>
                    ${t.auto_summary ? `<div style="font-size:12px;color:var(--text-secondary);line-height:1.5;border-top:1px solid var(--border);padding-top:8px;">${t.auto_summary}</div>` : ''}
                </div>`;
            });
            el.innerHTML = html;
        }

        // Rebuild set rows when distance changes
        document.addEventListener('change', e => {
            if (e.target.id === 'fuelDistance') {
                const n = Math.min(Math.max(parseInt(e.target.value)||5, 1), 10);
                buildSetEffortRows(n);
            }
        });

        // ─── End Fuel & Hydration Test ──────────────────────────────────────────

        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js')
                    .then(reg => console.log('SW registered:', reg.scope))
                    .catch(err => console.log('SW registration failed:', err));
            });
        }
