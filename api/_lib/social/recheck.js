// Publish-time re-validation, shared by the hourly publisher and the autopilot (before it renders).
// `rest` = Supabase REST function (service key). Time-sensitive claims are re-checked against live tables:
//   Explore events   status/date/venue/change log   (revalidateEvents)
//   measured temps   still on record, still fresh   (conditionsRecheck)
//   partners         still live and active          (partner_pages)
import { revalidateEvents } from './validate.js';
import { conditionsRecheck } from './series.js';
import { eventIdsOf } from './publisher.js';

const FRESH = 'id,title,discipline,status,date_confirmed,start_date,verification_tier,official_url,event_venues(display_name,city,country_code)';
const rowsOf = (post, table) => [...new Set((post.facts || []).filter((f) => f.source?.table === table && f.source.row).map((f) => f.source.row))];

export function makeRecheck(rest) {
  return async (post, now = new Date()) => {
    const eventIds = eventIdsOf(post);
    if (eventIds.length) {
      const fresh = await rest(`event_editions?select=${FRESH}&id=in.(${eventIds.join(',')})`);
      const since = post.created_at ? `&changed_at=gt.${encodeURIComponent(post.created_at)}` : '';
      const changes = await rest(`event_change_log?select=edition_id,change_type&edition_id=in.(${eventIds.join(',')})&change_type=in.(date_changed,venue_changed,cancelled,postponed)${since}`);
      const v = revalidateEvents({ events: eventIds.map((id) => ({ id, title: id })) }, fresh || [], changes || [], now);
      if (!v.ok) return { ok: false, reason: `event check: ${JSON.stringify(v.dropped)}` };
    }
    if ((post.facts || []).some((f) => f.source?.table === 'spot_conditions_live')) {
      const ids = rowsOf(post, 'spot_conditions_live');
      const fresh = await rest(`spot_conditions_live?select=spot_id,water_temperature_c,observed_at,is_primary&spot_id=in.(${ids.join(',')})&water_temperature_c=not.is.null`);
      const v = conditionsRecheck(post, fresh || [], now);
      if (!v.ok) return { ok: false, reason: `conditions check: ${v.reason}` };
    }
    const partnerIds = rowsOf(post, 'partner_pages');
    if (partnerIds.length) {
      const rows = await rest(`partner_pages?select=id,chip_state,section&id=in.(${partnerIds.join(',')})`);
      if (!(rows || []).length || rows.some((r) => r.chip_state !== 'live' || r.section !== 'active')) return { ok: false, reason: 'partner is no longer live' };
    }
    return { ok: true };
  };
}
