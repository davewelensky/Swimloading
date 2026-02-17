// SwimLoading — Web Push Edge Function
// Triggered by Database Webhook on notifications INSERT
// Sends push notification to recipient's subscribed devices

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webPush from "npm:web-push@3.6.7";

serve(async (req) => {
    try {
        const payload = await req.json();

        // Database webhook sends: { type: "INSERT", table: "notifications", record: {...} }
        const notification = payload.record;
        if (!notification || !notification.recipient_user_id) {
            return new Response(JSON.stringify({ error: "No recipient" }), { status: 400 });
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
                { status: 200 }
            );
        }

        // Configure VAPID
        const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
        const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
        const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:dave@swimloading.com";

        webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

        // Build push payload
        // Handle both "message" (from client notify()) and "body" (from DB trigger)
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
                        {
                            endpoint: sub.endpoint,
                            keys: { p256dh: sub.p256dh, auth: sub.auth }
                        },
                        pushPayload
                    );
                    return { status: "sent", endpoint: sub.endpoint.substring(0, 50) };
                } catch (err: any) {
                    // If subscription expired (410 Gone) or invalid (404), remove it
                    if (err.statusCode === 410 || err.statusCode === 404) {
                        await supabaseAdmin
                            .from("push_subscriptions")
                            .delete()
                            .eq("id", sub.id);
                        return { status: "removed_expired", endpoint: sub.endpoint.substring(0, 50) };
                    }
                    return { status: "error", error: err.message };
                }
            })
        );

        return new Response(JSON.stringify({ sent: results.length, results }), { status: 200 });
    } catch (err: any) {
        console.error("Push function error:", err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
});
