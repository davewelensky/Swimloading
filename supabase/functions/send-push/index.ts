// SwimLoading — Web Push Edge Function
// Called directly from notify() in index.html (preferred)
// Also triggered by the push_on_notification database webhook (fallback)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webPush from "npm:web-push@3.6.7";

// CORS headers — required for browser-side invocations
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
    // Handle CORS preflight (browser sends this before the real POST)
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        // Parse body — direct invocations send { record: notification }
        // DB webhook sends { type, table, schema, record } OR sometimes empty body
        let notification = null;
        try {
            const payload = await req.json();
            notification = payload.record || null;
        } catch (_) {
            // Webhook fired with empty/invalid body — nothing to process
            return new Response(
                JSON.stringify({ message: "Empty body — nothing to process" }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        if (!notification || !notification.recipient_user_id) {
            return new Response(
                JSON.stringify({ error: "No recipient" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Create admin client (bypasses RLS)
        const supabaseAdmin = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        // Get all push subscriptions for this user
        const { data: subscriptions, error } = await supabaseAdmin
            .from("push_subscriptions")
            .select("*")
            .eq("user_id", notification.recipient_user_id);

        if (error || !subscriptions || subscriptions.length === 0) {
            return new Response(
                JSON.stringify({ message: "No push subscriptions for this user" }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Configure VAPID
        const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
        const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
        const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:dave@swimloading.com";
        webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

        // Build push payload
        const body = notification.message || notification.body || "";
        const swimEventId = notification.swim_event_id || notification.payload?.swim_event_id;

        const pushPayload = JSON.stringify({
            title: notification.title || "SwimLoading",
            body: body,
            icon: "/icons/icon-192.png",
            badge: "/icons/icon-192.png",
            data: {
                url: swimEventId ? `/app?swim=${swimEventId}` : "/app",
                notification_id: notification.id,
                type: notification.type || "general"
            }
        });

        // Send to each subscription
        const results = await Promise.allSettled(
            subscriptions.map(async (sub: any) => {
                try {
                    await webPush.sendNotification(
                        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                        pushPayload
                    );
                    return { status: "sent", endpoint: sub.endpoint.substring(0, 50) };
                } catch (err: any) {
                    // Remove expired or invalid subscriptions automatically
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        await supabaseAdmin.from("push_subscriptions").delete().eq("id", sub.id);
                        return { status: "removed_expired", endpoint: sub.endpoint.substring(0, 50) };
                    }
                    return { status: "error", error: err.message };
                }
            })
        );

        return new Response(
            JSON.stringify({ sent: results.length, results }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (err: any) {
        console.error("Push function error:", err);
        return new Response(
            JSON.stringify({ error: err.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
