/* site-lead-form.js: shared enquiry-form handler for SwimLoading marketing pages.
 *
 * Posts a lead into a Supabase table via the public anon key (same key the app
 * and partner pages already use), and fires analytics events alongside it.
 *
 * Served with no-cache headers (see vercel.json) so it never needs a ?v=N bump.
 *
 * Usage:
 *   <script src="/site-lead-form.js"></script>
 *   window.swimLeadForm({
 *     formId: 'labForm', msgId: 'formMsg', submitId: 'f-submit',
 *     endpoint: '/api/lab-enquiry',   // preferred: server inserts AND notifies
 *     table: 'swim_lab_enquiries',    // fallback when no endpoint is given
 *     source: 'aquasharks-lab',
 *     clubSlug: 'aqua-sharks-atlantic',
 *     pageEvent: 'aquasharks_lab_page_view', leadEvent: 'aquasharks_lab_enquiry'
 *   });
 *
 * The form's inputs are read by their `name` attributes. Any name that matches a
 * column on the target table is sent; `contact_name` and `email` are required.
 */
(function () {
  'use strict';

  var SB_URL = 'https://szgkzuswelntnevobnoh.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6Z2t6dXN3ZWxudG5ldm9ibm9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgxODY1NTUsImV4cCI6MjA4Mzc2MjU1NX0.UfKqj2OZ-XeyzCy-MZYZqsDWjn_4EKrhgCFR8eIK2NA';

  function headers() {
    return {
      'apikey':        SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal'
    };
  }

  function track(eventName, properties) {
    try {
      fetch(SB_URL + '/rest/v1/analytics_events', {
        method: 'POST',
        keepalive: true,
        headers: headers(),
        body: JSON.stringify({
          event_name: eventName,
          user_id: null,
          properties: properties || null
        })
      }).catch(function () {});
    } catch (e) { /* never block the page */ }
  }

  // Exposed so pages can track clicks without re-declaring the key.
  window.swimTrack = track;

  function clean(v) {
    if (typeof v !== 'string') return null;
    var t = v.trim();
    return t === '' ? null : t;
  }

  window.swimLeadForm = function (opts) {
    opts = opts || {};

    if (opts.pageEvent) track(opts.pageEvent);

    var form   = document.getElementById(opts.formId);
    var msg    = document.getElementById(opts.msgId);
    var submit = document.getElementById(opts.submitId);
    if (!form || !msg || !submit) return;

    function say(kind, text) {
      msg.className = 'form-msg ' + kind;
      msg.textContent = text;
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      msg.className = 'form-msg';
      msg.textContent = '';

      var data = {};
      new FormData(form).forEach(function (value, key) { data[key] = value; });

      if (!clean(data.contact_name)) { say('err', 'Please add your name.'); return; }
      if (!clean(data.email) || !/^\S+@\S+\.\S+$/.test(data.email.trim())) {
        say('err', 'Please add a valid email address.'); return;
      }

      var row = {
        club_slug:    opts.clubSlug || null,
        source:       opts.source   || null,
        contact_name: clean(data.contact_name),
        swimmer_name: clean(data.swimmer_name),
        email:        clean(data.email),
        phone:        clean(data.phone),
        squad:        clean(data.squad),
        package:      clean(data.package),
        notes:        clean(data.notes)
      };

      // A hidden field a person never sees. Bots fill it in.
      row.website = data.website || null;

      submit.disabled = true;
      submit.style.opacity = '0.6';

      // Posting to an endpoint lets the server insert with the service key and
      // send the notification in one go.
      function postDirect() {
        return fetch(SB_URL + '/rest/v1/' + opts.table, {
          method: 'POST',
          headers: headers(),
          body: JSON.stringify(row)
        }).then(function (r) {
          if (!r.ok) throw new Error('direct HTTP ' + r.status);
          return 'direct';
        });
      }

      var send = opts.endpoint
        ? fetch(opts.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(row)
          }).then(function (r) {
            if (r.ok) return 'endpoint';
            // Losing the lead is worse than losing the notification, so if the
            // endpoint is down write straight to the table instead.
            return postDirect().then(function () { return 'fallback'; });
          }).catch(function () {
            return postDirect().then(function () { return 'fallback'; });
          })
        : postDirect();

      send
        .then(function (via) {
          form.reset();
          say('ok', 'Thanks, that is through. We will come back to you with session times.');
          if (opts.leadEvent) track(opts.leadEvent, { package: row.package, via: via });
        })
        .catch(function () {
          say('err', 'That did not go through. Please email dave@swimloading.com and we will sort it out.');
        })
        .then(function () {
          submit.disabled = false;
          submit.style.opacity = '1';
        });
    });
  };
})();
