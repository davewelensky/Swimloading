// Welcome email — HTML + plain-text builders.
// Sent once, server-side, from api/send-welcome-email.js after onboarding completes.
// Brand pattern matches blog/*.html newsletters (dark bg, cyan accent, DM Sans/Bebas Neue with
// system-font fallback — email clients that block the Google Fonts @import just show the fallback).

const INSTALL_URL = 'https://www.swimloading.com/install?src=welcome_email';
const APP_URL      = 'https://www.swimloading.com/app';

export function buildWelcomeEmailHtml(firstName) {
  const name = escapeHtml(firstName || 'there');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your SwimLoading account is ready</title>
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
      <div style="font-family:'Bebas Neue',Arial,sans-serif;font-size:34px;color:#f1f5f9;line-height:1.05;margin-bottom:18px;">
        Hi ${name},<br>Welcome to SwimLoading.
      </div>
      <div style="font-size:15px;color:#94a3b8;line-height:1.8;margin-bottom:28px;">
        Your account is ready and you can now start logging your swims, checking water conditions and building your personal swimming story.
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
            <div style="font-family:'DM Sans',Arial,sans-serif;font-size:11px;font-weight:700;color:#38bdf8;letter-spacing:2px;text-transform:uppercase;margin-bottom:14px;">Make SwimLoading work like an app</div>
            <div style="font-size:15px;color:#f1f5f9;line-height:1.7;margin-bottom:18px;">
              Add SwimLoading to your phone's home screen for one-tap access.
            </div>
            <div style="font-size:13px;color:#64748b;line-height:1.6;margin-bottom:8px;">Once it's added, you can:</div>
            <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:22px;">
              <tr><td style="font-size:13px;color:#94a3b8;line-height:2.1;">
                &bull;&nbsp; Log a swim quickly after leaving the water<br>
                &bull;&nbsp; Check recent water temperatures and conditions<br>
                &bull;&nbsp; Build your Swim Passport and personal swim story<br>
                &bull;&nbsp; Follow club activity and monthly challenges<br>
                &bull;&nbsp; Open SwimLoading without searching for the website
              </td></tr>
            </table>
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
              <tr><td align="center" style="padding-bottom:12px;">
                <a href="${INSTALL_URL}" style="display:block;background:#38bdf8;color:#080f1a;font-size:14px;font-weight:700;padding:15px 22px;border-radius:50px;text-decoration:none;letter-spacing:0.2px;">Add SwimLoading to Your Home Screen</a>
              </td></tr>
              <tr><td align="center">
                <a href="${APP_URL}" style="display:block;background:transparent;border:1px solid rgba(255,255,255,0.15);color:#f1f5f9;font-size:14px;font-weight:600;padding:14px 22px;border-radius:50px;text-decoration:none;">Open SwimLoading</a>
              </td></tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<table width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td style="padding:32px 32px 40px;" class="sp">
      <div style="font-size:14px;color:#64748b;line-height:1.8;">
        See you in the water,<br>
        <strong style="color:#f1f5f9;">Dave</strong><br>
        SwimLoading
      </div>
    </td>
  </tr>
</table>

<table width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td style="background:#050c18;border-top:1px solid #0f2240;padding:20px 32px;" class="sp">
      <div style="font-size:11px;color:#1e3a5f;line-height:1.9;">
        SwimLoading &nbsp;&middot;&nbsp; <a href="https://swimloading.com" style="color:#1e3a5f;">swimloading.com</a>
      </div>
    </td>
  </tr>
</table>

</div>
</body>
</html>`;
}

export function buildWelcomeEmailText(firstName) {
  const name = firstName || 'there';
  return `Hi ${name},

Welcome to SwimLoading.

Your account is ready and you can now start logging your swims, checking water conditions and building your personal swimming story.

MAKE SWIMLOADING WORK LIKE AN APP

Add SwimLoading to your phone's home screen for one-tap access.

Once it is added, you can:
- Log a swim quickly after leaving the water.
- Check recent water temperatures and conditions.
- Build your Swim Passport and personal swim story.
- Follow club activity and monthly challenges.
- Open SwimLoading without searching for the website.

Add SwimLoading to Your Home Screen:
${INSTALL_URL}

Open SwimLoading:
${APP_URL}

See you in the water,

Dave
SwimLoading`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
