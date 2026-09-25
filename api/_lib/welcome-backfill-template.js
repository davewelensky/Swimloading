// Backfill welcome email — HTML + plain-text builders.
//
// Sent once to people who completed onboarding but never received the normal
// welcome email, because RESEND_API_KEY was absent from Vercel from the day the
// feature shipped (29 Jul 2026) until 23 Sep 2026.
//
// Deliberately NOT the standard welcome copy. These people joined weeks ago and
// have been using the app, so "Welcome, your account is ready" would read as
// broken automation. This owns the gap, then asks how they are finding it.
//
// Brand pattern matches welcome-email-template.js.

const INSTALL_URL = 'https://www.swimloading.com/install?src=backfill_email';
const APP_URL     = 'https://www.swimloading.com/app?src=backfill_email';

export function buildBackfillHtml(firstName) {
  const name = escapeHtml(firstName || 'there');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>How are you finding SwimLoading?</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,wght@0,400;0,500;0,700;1,400&display=swap');
  body { margin:0; padding:0; background:#080f1a; font-family:'DM Sans',Arial,sans-serif; -webkit-font-smoothing:antialiased; }
  .wrap { max-width:480px; margin:0 auto; background:#080f1a; }
  a { color:#38bdf8; }
  @media (max-width:520px) { .sp { padding-left:24px !important; padding-right:24px !important; } }
</style>
</head>
<body>
<div class="wrap">

<table width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td style="background:#050c18;border-bottom:1px solid #0f2240;padding:18px 32px;" class="sp">
      <span style="font-family:'Bebas Neue',Arial,sans-serif;font-size:20px;color:#38bdf8;letter-spacing:3px;">SWIMLOADING</span>
    </td>
  </tr>
</table>

<table width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td style="padding:40px 32px 8px;" class="sp">
      <div style="font-family:'Bebas Neue',Arial,sans-serif;font-size:32px;color:#f1f5f9;line-height:1.08;margin-bottom:18px;">
        Hi ${name},<br>How are you finding it?
      </div>
      <div style="font-size:15px;color:#94a3b8;line-height:1.8;margin-bottom:20px;">
        You joined SwimLoading a few weeks ago and should have had a note from me
        then. You did not. A setting on our side quietly stopped those emails
        going out, and you were one of the people it affected. Sorry about that.
      </div>
      <div style="font-size:15px;color:#94a3b8;line-height:1.8;margin-bottom:28px;">
        Since you have actually been using it for a while now, the more useful
        question is the one in the subject line. What is working, what is
        annoying, what is missing? Just hit reply. It comes straight to me and I
        read every one.
      </div>
    </td>
  </tr>
</table>

<table width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td style="padding:0 32px;" class="sp">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a1628;border:1px solid #1e3a5f;border-radius:16px;">
        <tr>
          <td style="padding:28px 24px;">
            <div style="font-family:'DM Sans',Arial,sans-serif;font-size:11px;font-weight:700;color:#38bdf8;letter-spacing:2px;text-transform:uppercase;margin-bottom:14px;">One thing worth doing</div>
            <div style="font-size:15px;color:#f1f5f9;line-height:1.7;margin-bottom:8px;">
              Put SwimLoading on your home screen. It is not in the app store and
              does not need to be: added this way it has its own icon and opens
              full screen, no browser bar. Ten seconds, nothing to download.
            </div>
            <img src="https://www.swimloading.com/icons/home-screen.png" width="248" alt="The SwimLoading icon on a phone home screen"
                 style="width:248px;max-width:100%;height:auto;border:0;display:block;margin:18px auto 6px;">
            <div style="font-size:14px;color:#94a3b8;line-height:1.95;margin:16px 0 4px;">
              <b style="color:#f1f5f9;">iPhone:</b> open swimloading.com in Safari, tap
              <b>Share</b>, then <b>Add to Home Screen</b>, then <b>Add</b>.
            </div>
            <div style="font-size:14px;color:#94a3b8;line-height:1.95;margin-bottom:20px;">
              <b style="color:#f1f5f9;">Android:</b> open swimloading.com in Chrome, tap the
              <b>&#8942;</b> menu, then <b>Install app</b>.
            </div>
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background:#38bdf8;border-radius:50px;">
                  <a href="${INSTALL_URL}" style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:700;color:#06111f;text-decoration:none;">Show me on my phone</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<table width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td style="padding:28px 32px 44px;" class="sp">
      <div style="font-size:14px;color:#64748b;line-height:1.8;">
        Or just <a href="${APP_URL}" style="color:#38bdf8;text-decoration:none;">open the app</a>
        and log your next swim.
      </div>
      <div style="font-size:14px;color:#64748b;line-height:1.8;margin-top:22px;">
        Thanks for being an early one.<br>Dave
      </div>
    </td>
  </tr>
</table>

<table width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td style="border-top:1px solid #0f2240;padding:20px 32px;" class="sp">
      <div style="font-size:12px;color:#475569;line-height:1.6;">
        SwimLoading &middot; Cape Town<br>
        You are getting this because you created a SwimLoading account.
      </div>
    </td>
  </tr>
</table>

</div>
</body>
</html>`;
}

export function buildBackfillText(firstName) {
  const name = firstName || 'there';
  return `Hi ${name},

How are you finding it?

You joined SwimLoading a few weeks ago and should have had a note from me then.
You did not. A setting on our side quietly stopped those emails going out, and
you were one of the people it affected. Sorry about that.

Since you have actually been using it for a while now, the more useful question
is the one in the subject line. What is working, what is annoying, what is
missing? Just hit reply. It comes straight to me and I read every one.

ONE THING WORTH DOING
Put SwimLoading on your home screen. It is not in the app store and does not
need to be: added this way it has its own icon and opens full screen, no
browser bar. Ten seconds, nothing to download.

iPhone: open swimloading.com in Safari, tap Share, then Add to Home Screen,
then Add.

Android: open swimloading.com in Chrome, tap the three-dot menu, then
Install app.

Show me on my phone: ${INSTALL_URL}

Or just open the app and log your next swim.
${APP_URL}

Thanks for being an early one.
Dave

SwimLoading, Cape Town
You are getting this because you created a SwimLoading account.`;
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
