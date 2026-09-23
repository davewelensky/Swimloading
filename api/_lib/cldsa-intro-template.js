// CLDSA AGM introduction email — HTML + plain-text builders.
//
// For the 77 people who created a SwimLoading account to play the CLDSA Awards
// Challenge quiz at the 2026 AGM, where Dave sponsored a prize. Most of them
// (44 of 77) never completed onboarding, so they have an account but have
// almost certainly never used the app.
//
// Deliberately NOT the welcome copy and NOT the "how are you finding it"
// backfill: neither makes sense to someone who signed up to play a quiz at a
// dinner. This opens on the quiz so the email is instantly recognisable, then
// explains what SwimLoading actually is. One ask, not four.

const APP_URL     = 'https://www.swimloading.com/app?src=cldsa_intro';
const INSTALL_URL = 'https://www.swimloading.com/install?src=cldsa_intro';

export function buildCldsaIntroHtml(firstName) {
  const name = escapeHtml(firstName || 'there');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>You played our quiz at the CLDSA awards</title>
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
        Hi ${name},<br>Remember the quiz?
      </div>
      <div style="font-size:15px;color:#94a3b8;line-height:1.8;margin-bottom:20px;">
        You played the CLDSA Awards Challenge at the AGM. That was us, and the
        account you made to play it is a SwimLoading account. You have probably
        not touched it since, which is fair enough, because nobody ever told you
        what it was for.
      </div>
      <div style="font-size:15px;color:#94a3b8;line-height:1.8;margin-bottom:28px;">
        So, briefly.
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
            <div style="font-family:'DM Sans',Arial,sans-serif;font-size:11px;font-weight:700;color:#38bdf8;letter-spacing:2px;text-transform:uppercase;margin-bottom:16px;">What SwimLoading is</div>
            <div style="font-size:15px;color:#f1f5f9;line-height:1.75;margin-bottom:14px;">
              Swimmers log the water temperature where they swim, so the rest of us
              know what we are getting into before we get in.
            </div>
            <div style="font-size:14px;color:#94a3b8;line-height:1.75;">
              Check the temperature at a spot before you drive there. See who else
              has swum it today. Keep a record of your own swims. It is free, and
              it works best the more of us are logging.
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<table width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td style="padding:30px 32px 10px;" class="sp">
      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="background:#38bdf8;border-radius:50px;">
            <a href="${APP_URL}" style="display:inline-block;padding:14px 30px;font-size:15px;font-weight:700;color:#06111f;text-decoration:none;">Have a look</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>

<table width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td style="padding:18px 32px 44px;" class="sp">
      <div style="font-size:14px;color:#64748b;line-height:1.8;">
        If it is useful, <a href="${INSTALL_URL}" style="color:#38bdf8;text-decoration:none;">add it to your home screen</a>
        and it opens like an app. If it is not for you, ignore this and no hard feelings.
      </div>
      <div style="font-size:14px;color:#64748b;line-height:1.8;margin-top:22px;">
        Dave
      </div>
    </td>
  </tr>
</table>

<table width="100%" cellpadding="0" cellspacing="0" border="0">
  <tr>
    <td style="border-top:1px solid #0f2240;padding:20px 32px;" class="sp">
      <div style="font-size:12px;color:#475569;line-height:1.6;">
        SwimLoading &middot; Cape Town<br>
        You are getting this because you created a SwimLoading account to play
        the CLDSA Awards Challenge.
      </div>
    </td>
  </tr>
</table>

</div>
</body>
</html>`;
}

export function buildCldsaIntroText(firstName) {
  const name = firstName || 'there';
  return `Hi ${name},

Remember the quiz?

You played the CLDSA Awards Challenge at the AGM. That was us, and the account
you made to play it is a SwimLoading account. You have probably not touched it
since, which is fair enough, because nobody ever told you what it was for.

So, briefly.

WHAT SWIMLOADING IS
Swimmers log the water temperature where they swim, so the rest of us know what
we are getting into before we get in.

Check the temperature at a spot before you drive there. See who else has swum it
today. Keep a record of your own swims. It is free, and it works best the more
of us are logging.

Have a look: ${APP_URL}

If it is useful, add it to your home screen and it opens like an app:
${INSTALL_URL}

If it is not for you, ignore this and no hard feelings.

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
