// SwimLoading — Web Push Edge Function
// Mode 1 (individual):  { record: notification }        — sends to one user
// Mode 2 (broadcast):   { location, type, title, body } — sends to all subscribers in that location
// Mode 3 (new_member):  { type: 'new_member', title, body } — sends to all with notify_on_new_member=true

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

        const supabaseAdmin = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        const vapidPublicKey  = Deno.env.get("VAPID_PUBLIC_KEY")!;
        const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
        const vapidSubject    = Deno.env.get("VAPID_SUBJECT") || "mailto:dave@swimloading.com";
        webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

        // Helper: send to a list of subscriptions, auto-clean expired ones
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

        // ── Mode 3: New member broadcast ─────────────────────────────────────────
        // Payload: { type: 'new_member', title, body }
        if (payload.type === "new_member") {
            const { title, body } = payload;

            const { data: subscriptions } = await supabaseAdmin
                .from("push_subscriptions")
                .select("id, endpoint, p256dh, auth")
                .eq("notify_on_new_member", true);

            if (!subscriptions?.length) {
                return new Response(
                    JSON.stringify({ message: "No subscribers for new_member" }),
                    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            const pushPayload = JSON.stringify({
                title: title || "New swimmer joined!",
                body: body || "",
                icon: "/icons/icon-192.png",
                badge: "/icons/icon-192.png",
                data: { url: "/app", type: "new_member" }
            });

            const results = await sendToSubscriptions(subscriptions, pushPayload);
            return new Response(
                JSON.stringify({ mode: "new_member", sent: results.length, results }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // ── Mode 2: Location broadcast ────────────────────────────────────────────
        // Payload: { location: 'ATLANTIC', type: 'temp'|'swim', title, body }
        if (payload.location) {
            const { location, type, title, body } = payload;
            const notifyCol = type === "swim" ? "notify_on_swim" : "notify_on_temp";

            // Query subs where preferred_locations array CONTAINS this location
            const { data: subscriptions } = await supabaseAdmin
                .from("push_subscriptions")
                .select("id, endpoint, p256dh, auth")
                .contains("preferred_locations", [location])
                .eq(notifyCol, true);

            if (!subscriptions?.length) {
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

        // ── Mode 1: Individual notification ──────────────────────────────────────
        // Payload: { record: notification }
        const notification = payload.record || null;
        if (!notification?.recipient_user_id) {
            return new Response(
                JSON.stringify({ error: "No recipient_user_id or location" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const { data: subscriptions } = await supabaseAdmin
            .from("push_subscriptions")
            .select("id, endpoint, p256dh, auth")
            .eq("user_id", notification.recipient_user_id);

        if (!subscriptions?.length) {
            return new Response(
                JSON.stringify({ message: "No push subscriptions for this user" }),
                { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const notifBody = notification.message || notification.body || "";
        const swimId    = notification.swim_event_id || notification.payload?.swim_event_id;
        const pushPayload = JSON.stringify({
            title: notification.title || "SwimLoading",
            body: notifBody,
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
