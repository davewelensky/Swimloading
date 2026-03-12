// SwimLoading — Web Push Edge Function
// Mode 1 (individual): { record: notification } — sends to one user (swim cancellations etc)
// Mode 2 (broadcast):  { location, type, title, body } — sends to all subscribers at a location

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webPush from "npm:web-push@3.6.7";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        let payload: any = null;
        try {
            payload = await req.json();
        } catch (_) {
            return new Response(
                JSON.stringify({ message: "Empty body — nothing to process" }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // Create admin client (bypasses RLS)
        const supabaseAdmin = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        // Configure VAPID once
        const vapidPublicKey  = Deno.env.get("VAPID_PUBLIC_KEY")!;
        const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
        const vapidSubject    = Deno.env.get("VAPID_SUBJECT") || "mailto:dave@swimloading.com";
        webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

        // Helper: send push to a list of subscriptions, auto-clean expired ones
        async function sendToSubscriptions(subscriptions: any[], pushPayload: string) {
            return Promise.allSettled(
                subscriptions.map(async (sub: any) => {
                    try {
                        await webPush.sendNotification(
                            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
                            pushPayload
                        );
                        return { status: "sent" };
                    } catch (err: any) {
                        if (err.statusCode === 410 || err.statusCode === 404) {
                            await supabaseAdmin.from("push_subscriptions").delete().eq("id", sub.id);
                            return { status: "removed_expired" };
                        }
                        return { status: "error", error: err.message };
                    }
                })
            );
        }

        // ── Mode 2: Location broadcast ──────────────────────────────────────────
        // Payload: { location: 'ATLANTIC', type: 'temp'|'swim', title, body }
        if (payload.location) {
            const { location, type, title, body } = payload;
            const notifyCol = type === "swim" ? "notify_on_swim" : "notify_on_temp";

            const { data: subscriptions, error } = await supabaseAdmin
                .from("push_subscriptions")
                .select("id, endpoint, p256dh, auth")
                .eq("preferred_location", location)
                .eq(notifyCol, true);

            if (error || !subscriptions?.length) {
                return new Response(
                    JSON.stringify({ message: "No subscribers for this location/type" }),
                    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            const pushPayload = JSON.stringify({
                title: title || "SwimLoading",
                body: body || "",
                icon: "/icons/icon-192.png",
                badge: "/icons/icon-192.png",
                data: { url: "/app", type }
            });

            const results = await sendToSubscriptions(subscriptions, pushPayload);
            return new Response(
                JSON.stringify({ mode: "broadcast", location, type, sent: results.length, results }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ── Mode 1: Individual notification ─────────────────────────────────────
        // Payload: { record: notification } (from notifications table insert)
        const notification = payload.record || null;
        if (!notification?.recipient_user_id) {
            return new Response(
                JSON.stringify({ error: "No recipient_user_id or location" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const { data: subscriptions, error } = await supabaseAdmin
            .from("push_subscriptions")
            .select("id, endpoint, p256dh, auth")
            .eq("user_id", notification.recipient_user_id);

        if (error || !subscriptions?.length) {
            return new Response(
                JSON.stringify({ message: "No push subscriptions for this user" }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const body    = notification.message || notification.body || "";
        const swimId  = notification.swim_event_id || notification.payload?.swim_event_id;
        const pushPayload = JSON.stringify({
            title: notification.title || "SwimLoading",
            body,
            icon: "/icons/icon-192.png",
            badge: "/icons/icon-192.png",
            data: {
                url: swimId ? `/app?swim=${swimId}` : "/app",
                notification_id: notification.id,
                type: notification.type || "general"
            }
        });

        const results = await sendToSubscriptions(subscriptions, pushPayload);
        return new Response(
            JSON.stringify({ mode: "individual", sent: results.length, results }),
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
