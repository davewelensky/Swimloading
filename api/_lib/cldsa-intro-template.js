// CLDSA AGM introduction email — HTML + plain-text builders.
//
// For the 77 people who created a SwimLoading account to play the CLDSA Awards
// Challenge quiz at the 2026 AGM, where Dave sponsored a prize. Most of them
// never completed onboarding, so they have an account but have almost
// certainly never used the app.
//
// LAYOUT RULES, learned the hard way. The first version put the dark
// background on a <div> styled from a <style> block. Several clients strip or
// ignore that, so the email rendered as near-white text on white and the
// headline was invisible. So:
//
//   - every structural background is a <table> with BOTH bgcolor and an inline
//     background-color, never a class or a div
//   - every block of text carries its own colour inline
//   - the <style> block is for the mobile media query only, and the email must
//     be fully readable if it is thrown away
//   - no web fonts: Bebas Neue does not load in most clients, and the fallback
//     has to look deliberate rather than broken

const APP_URL     = 'https://www.swimloading.com/app?src=cldsa_intro';
const INSTALL_URL = 'https://www.swimloading.com/install?src=cldsa_intro';
const SHOT_URL    = 'https://www.swimloading.com/icons/home-screen.png';

const BG     = '#080f1a';
const CARD   = '#0f2036';
const EDGE   = '#1e3a5f';
const TEXT   = '#ffffff';
const MUTED  = '#a9b8cc';
const CYAN   = '#38bdf8';

const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

export function buildCldsaIntroHtml(firstName) {
  const name = escapeHtml(firstName || 'there');
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<title>You played our quiz at the CLDSA awards</title>
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
      Hi ${name}, remember the quiz?
    </div>
    <div style="font-family:${SANS};font-size:16px;line-height:1.75;color:${MUTED};margin:0 0 18px;">
      You played the CLDSA Awards Challenge at the AGM. That was us, and the
      account you made to play it is a SwimLoading account. You have probably not
      touched it since, which is fair enough, because nobody ever told you what
      it was for.
    </div>
    <div style="font-family:${SANS};font-size:16px;line-height:1.75;color:${MUTED};margin:0 0 26px;">
      So, briefly.
    </div>
  </td></tr>

  <tr><td bgcolor="${BG}" style="background-color:${BG};padding:0 32px;" class="sp">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD}" style="background-color:${CARD};border:1px solid ${EDGE};border-radius:14px;">
      <tr><td bgcolor="${CARD}" style="background-color:${CARD};padding:24px;">
        <div style="font-family:${SANS};font-size:11px;font-weight:bold;letter-spacing:2px;color:${CYAN};margin:0 0 14px;">WHAT SWIMLOADING IS</div>
        <div style="font-family:${SANS};font-size:16px;line-height:1.7;color:${TEXT};margin:0 0 12px;">
          Swimmers log the water temperature where they swim, so the rest of us
          know what we are getting into before we get in.
        </div>
        <div style="font-family:${SANS};font-size:15px;line-height:1.7;color:${MUTED};margin:0;">
          Check the temperature at a spot before you drive there. See who else has
          swum it today. Keep a record of your own swims. It is free.
        </div>
      </td></tr>
    </table>
  </td></tr>

  <tr><td bgcolor="${BG}" style="background-color:${BG};padding:28px 32px 0;" class="sp">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr><td bgcolor="${CYAN}" style="background-color:${CYAN};border-radius:40px;">
        <a href="${APP_URL}" style="display:inline-block;padding:14px 32px;font-family:${SANS};font-size:16px;font-weight:bold;color:#06111f;text-decoration:none;">Have a look</a>
      </td></tr>
    </table>
  </td></tr>

  <tr><td bgcolor="${BG}" style="background-color:${BG};padding:36px 32px 0;" class="sp">
    <div style="font-family:${SANS};font-size:22px;font-weight:bold;line-height:1.3;color:${TEXT};margin:0 0 12px;">
      Why is it not in the app store?
    </div>
    <div style="font-family:${SANS};font-size:16px;line-height:1.75;color:${MUTED};margin:0;">
      Because it does not need to be. You add it to your home screen from your
      browser and it behaves exactly like an app: own icon, full screen, no
      browser bar. Nothing to download, and it takes about ten seconds.
    </div>
  </td></tr>

  <tr><td align="center" bgcolor="${BG}" style="background-color:${BG};padding:24px 32px 4px;" class="sp">
    <img src="${SHOT_URL}" width="200" alt="The SwimLoading icon on a phone home screen" style="width:200px;max-width:60%;height:auto;display:block;" />
  </td></tr>

  <tr><td bgcolor="${BG}" style="background-color:${BG};padding:18px 32px 0;" class="sp">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD}" style="background-color:${CARD};border:1px solid ${EDGE};border-radius:14px;margin-bottom:12px;">
      <tr><td bgcolor="${CARD}" style="background-color:${CARD};padding:20px 24px;">
        <div style="font-family:${SANS};font-size:11px;font-weight:bold;letter-spacing:2px;color:${CYAN};margin:0 0 12px;">ON IPHONE OR IPAD</div>
        <div style="font-family:${SANS};font-size:15px;line-height:2;color:${TEXT};">
          1. Open swimloading.com in <b>Safari</b><br />
          2. Tap <b>Share</b>, the square with an arrow coming out of it<br />
          3. Scroll down, tap <b>Add to Home Screen</b><br />
          4. Tap <b>Add</b>
        </div>
      </td></tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD}" style="background-color:${CARD};border:1px solid ${EDGE};border-radius:14px;">
      <tr><td bgcolor="${CARD}" style="background-color:${CARD};padding:20px 24px;">
        <div style="font-family:${SANS};font-size:11px;font-weight:bold;letter-spacing:2px;color:${CYAN};margin:0 0 12px;">ON ANDROID</div>
        <div style="font-family:${SANS};font-size:15px;line-height:2;color:${TEXT};">
          1. Open swimloading.com in <b>Chrome</b><br />
          2. Tap the <b>&#8942;</b> menu, top right<br />
          3. Tap <b>Install app</b> or <b>Add to Home screen</b><br />
          4. Tap <b>Install</b>
        </div>
      </td></tr>
    </table>
  </td></tr>

  <tr><td bgcolor="${BG}" style="background-color:${BG};padding:24px 32px 40px;" class="sp">
    <div style="font-family:${SANS};font-size:15px;line-height:1.75;color:${MUTED};margin:0 0 20px;">
      Stuck? <a href="${INSTALL_URL}" style="color:${CYAN};">This page works out which phone you are on</a>.
      Or just reply and I will help.
    </div>
    <div style="font-family:${SANS};font-size:15px;line-height:1.75;color:${MUTED};margin:0;">Dave</div>
  </td></tr>

  <tr><td bgcolor="#050c18" style="background-color:#050c18;padding:20px 32px;border-top:1px solid ${EDGE};" class="sp">
    <div style="font-family:${SANS};font-size:12px;line-height:1.6;color:#6b7f99;">
      SwimLoading, Cape Town<br />
      You are getting this because you created a SwimLoading account to play the
      CLDSA Awards Challenge.
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

export function buildCldsaIntroText(firstName) {
  const name = firstName || 'there';
  return `Hi ${name}, remember the quiz?

You played the CLDSA Awards Challenge at the AGM. That was us, and the account
you made to play it is a SwimLoading account. You have probably not touched it
since, which is fair enough, because nobody ever told you what it was for.

So, briefly.

WHAT SWIMLOADING IS
Swimmers log the water temperature where they swim, so the rest of us know what
we are getting into before we get in. Check the temperature at a spot before you
drive there. See who else has swum it today. Keep a record of your own swims.
It is free.

Have a look: ${APP_URL}

WHY IS IT NOT IN THE APP STORE?
Because it does not need to be. You add it to your home screen from your browser
and it behaves exactly like an app: own icon, full screen, no browser bar.
Nothing to download, and it takes about ten seconds.

ON IPHONE OR IPAD
1. Open swimloading.com in Safari
2. Tap Share, the square with an arrow coming out of it
3. Scroll down, tap Add to Home Screen
4. Tap Add

ON ANDROID
1. Open swimloading.com in Chrome
2. Tap the three-dot menu, top right
3. Tap Install app, or Add to Home screen
4. Tap Install

Stuck? This page works out which phone you are on: ${INSTALL_URL}
Or just reply and I will help.

Dave

SwimLoading, Cape Town
You are getting this because you created a SwimLoading account to play the
CLDSA Awards Challenge.`;
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
