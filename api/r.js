// SwimLoading — Share link tracker + redirector
// Route: /r?type=spot&id=X  or  /r?type=swim&id=X
// Logs the click, then 302s to /app?{type}={id}&ref=share

export default async function handler(req, res) {
    const { type, id } = req.query;

    // Validate params
    if (!type || !id || !['spot', 'swim'].includes(type)) {
        res.setHeader('Cache-Control', 'no-store');
        return res.redirect(302, '/app');
    }

    // Log the click — fire against Supabase REST API using service role key
    const supabaseUrl  = process.env.SUPABASE_URL;
    const serviceKey   = process.env.SUPABASE_SERVICE_KEY;

    if (supabaseUrl && serviceKey) {
        try {
            await fetch(`${supabaseUrl}/rest/v1/share_clicks`, {
                method: 'POST',
                headers: {
                    'Content-Type':  'application/json',
                    'apikey':        serviceKey,
                    'Authorization': `Bearer ${serviceKey}`,
                    'Prefer':        'return=minimal',
                },
                body: JSON.stringify({
                    type,
                    target_id:  id,
                    referrer:   req.headers['referer']    || null,
                    user_agent: req.headers['user-agent'] || null,
                }),
            });
        } catch (e) {
            // Don't block redirect on analytics failure
            console.error('[r] analytics write failed:', e.message);
        }
    }

    // Redirect into the app — deep link handler in loadApp() picks up the params
    const dest = `/app?${type}=${encodeURIComponent(id)}&ref=share`;
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, dest);
}
