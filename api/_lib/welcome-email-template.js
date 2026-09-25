// Welcome email — HTML + plain-text builders.
// Sent once, server-side, from api/send-welcome-email.js after onboarding completes.
//
// LAYOUT RULES, learned from a real failure. The first version put the dark
// background on a <div> styled from a <style> block and pulled Bebas Neue from
// Google Fonts. Clients that strip the style block rendered near-white text on
// white with the headline invisible, and the web font never loaded anywhere.
// That version was never actually delivered to anyone, because RESEND_API_KEY
// was missing from Vercel from the day it shipped until 23 Sep 2026, so the
// breakage was only caught when the same pattern was reused for the backfill
// emails and tested in a real inbox. So:
//
//   - every structural background is a <table> with BOTH bgcolor and an inline
//     background-color, never a class or a div
//   - every block of text carries its own colour inline
//   - the <style> block is for the mobile media query only, and the email must
//     be fully readable if it is thrown away
//   - no web fonts: system stack with bold weights, so it reads as deliberate
//     rather than as a failed font load
//
// Matches api/_lib/cldsa-intro-template.js and welcome-backfill-template.js.

const INSTALL_URL = 'https://www.swimloading.com/install?src=welcome_email';
const APP_URL     = 'https://www.swimloading.com/app?src=welcome_email';
const SHOT_URL    = 'https://www.swimloading.com/icons/home-screen.png';

const BG    = '#080f1a';
const CARD  = '#0f2036';
const EDGE  = '#1e3a5f';
const TEXT  = '#ffffff';
const MUTED = '#a9b8cc';
const CYAN  = '#38bdf8';

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

export function buildWelcomeEmailHtml(firstName) {
  const name = escapeHtml(firstName || 'there');
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>Your SwimLoading account is ready</title>
<style type="text/css">
  body { margin:0 !important; padding:0 !important; background-color:${BG} !important; }
  table { border-collapse:collapse; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  a { color:${CYAN}; }
  @media only screen and (max-width:520px) {
    .sp { padding-left:22px !important; padding-right:22px !important; }
    .h1 { font-size:26px !important; }
  }
</style>
</head>
<body bgcolor="${BG}" style="margin:0;padding:0;background-color:${BG};">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG}" style="background-color:${BG};">
<tr><td align="center" bgcolor="${BG}" style="background-color:${BG};padding:0;">

<table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG}" style="width:520px;max-width:520px;background-color:${BG};">

  <tr><td bgcolor="#050c18" style="background-color:#050c18;padding:20px 32px;border-bottom:1px solid ${EDGE};" class="sp">
    <span style="font-family:${SANS};font-size:15px;font-weight:bold;letter-spacing:3px;color:${CYAN};">SWIMLOADING</span>
  </td></tr>

  <tr><td bgcolor="${BG}" style="background-color:${BG};padding:38px 32px 0;" class="sp">
    <div class="h1" style="font-family:${SANS};font-size:30px;line-height:1.25;font-weight:bold;color:${TEXT};margin:0 0 18px;">
      Hi ${name}, welcome to SwimLoading.
    </div>
    <div style="font-family:${SANS};font-size:16px;line-height:1.75;color:${MUTED};margin:0 0 26px;">
      Your account is ready. You can start logging your swims, checking water
      conditions and building your personal swimming story.
    </div>
  </td></tr>

  <tr><td bgcolor="${BG}" style="background-color:${BG};padding:0 32px;" class="sp">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD}" style="background-color:${CARD};border:1px solid ${EDGE};border-radius:14px;">
      <tr><td bgcolor="${CARD}" style="background-color:${CARD};padding:24px;">
        <div style="font-family:${SANS};font-size:11px;font-weight:bold;letter-spacing:2px;color:${CYAN};margin:0 0 14px;">MAKE IT WORK LIKE AN APP</div>
        <div style="font-family:${SANS};font-size:16px;line-height:1.7;color:${TEXT};margin:0 0 16px;">
          Add SwimLoading to your phone's home screen. It is not in the app store
          and does not need to be: added this way it has its own icon and opens
          full screen, no browser bar.
        </div>
        <div style="font-family:${SANS};font-size:15px;line-height:2.1;color:${MUTED};margin:0;">
          &bull;&nbsp; Log a swim quickly after leaving the water<br />
          &bull;&nbsp; Check recent water temperatures and conditions<br />
          &bull;&nbsp; Build your Swim Passport and personal swim story<br />
          &bull;&nbsp; Follow club activity and monthly challenges<br />
          &bull;&nbsp; Open SwimLoading without searching for the website
        </div>
      </td></tr>
    </table>
  </td></tr>

  <tr><td align="center" bgcolor="${BG}" style="background-color:${BG};padding:22px 32px 4px;" class="sp">
    <img src="${SHOT_URL}" width="190" alt="The SwimLoading icon on a phone home screen" style="width:190px;max-width:58%;height:auto;display:block;" />
  </td></tr>

  <tr><td bgcolor="${BG}" style="background-color:${BG};padding:14px 32px 0;" class="sp">
    <div style="font-family:${SANS};font-size:15px;line-height:1.9;color:${MUTED};margin:0 0 10px;">
      <b style="color:${TEXT};">iPhone:</b> open swimloading.com in Safari, tap
      <b style="color:${TEXT};">Share</b> (the square with an arrow coming out of
      it), then <b style="color:${TEXT};">Add to Home Screen</b>, then
      <b style="color:${TEXT};">Add</b>.
    </div>
    <div style="font-family:${SANS};font-size:15px;line-height:1.9;color:${MUTED};margin:0 0 22px;">
      <b style="color:${TEXT};">Android:</b> open swimloading.com in Chrome, tap
      the <b style="color:${TEXT};">&#8942;</b> menu, then
      <b style="color:${TEXT};">Install app</b>.
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr><td bgcolor="${CYAN}" style="background-color:${CYAN};border-radius:40px;">
        <a href="${INSTALL_URL}" style="display:inline-block;padding:14px 30px;font-family:${SANS};font-size:16px;font-weight:bold;color:#06111f;text-decoration:none;">Show me on my phone</a>
      </td></tr>
    </table>
  </td></tr>

  <tr><td bgcolor="${BG}" style="background-color:${BG};padding:28px 32px 40px;" class="sp">
    <div style="font-family:${SANS};font-size:15px;line-height:1.75;color:${MUTED};margin:0 0 20px;">
      Or just <a href="${APP_URL}" style="color:${CYAN};">open SwimLoading</a> and
      log your first swim.
    </div>
    <div style="font-family:${SANS};font-size:15px;line-height:1.75;color:${MUTED};margin:0;">
      See you in the water,<br />
      <b style="color:${TEXT};">Dave</b>
    </div>
  </td></tr>

  <tr><td bgcolor="#050c18" style="background-color:#050c18;padding:20px 32px;border-top:1px solid ${EDGE};" class="sp">
    <div style="font-family:${SANS};font-size:12px;line-height:1.6;color:#6b7f99;">
      SwimLoading, Cape Town &nbsp;&middot;&nbsp;
      <a href="https://swimloading.com" style="color:#6b7f99;">swimloading.com</a>
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

export function buildWelcomeEmailText(firstName) {
  const name = firstName || 'there';
  return `Hi ${name}, welcome to SwimLoading.

Your account is ready. You can start logging your swims, checking water
conditions and building your personal swimming story.

MAKE IT WORK LIKE AN APP
Add SwimLoading to your phone's home screen. It is not in the app store and does
not need to be: added this way it has its own icon and opens full screen, no
browser bar.

Once it is added, you can:
- Log a swim quickly after leaving the water
- Check recent water temperatures and conditions
- Build your Swim Passport and personal swim story
- Follow club activity and monthly challenges
- Open SwimLoading without searching for the website

iPhone: open swimloading.com in Safari, tap Share (the square with an arrow
coming out of it), then Add to Home Screen, then Add.

Android: open swimloading.com in Chrome, tap the three-dot menu, then
Install app.

Show me on my phone: ${INSTALL_URL}

Or just open SwimLoading and log your first swim: ${APP_URL}

See you in the water,

Dave
SwimLoading, Cape Town`;
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
