// /api/live-quiz/<action> — CLDSA Awards live quiz (Sept 2026).
// Rules in api/_lib/live-quiz/service.js; storage in store-supabase.js.
import QRCode from 'qrcode';
import { getUserId } from './strava/token-helper.js';
import { createService } from './_lib/live-quiz/service.js';
import { createSupabaseStore } from './_lib/live-quiz/store-supabase.js';
import { createHandler } from './_lib/live-quiz/http.js';

const service = createService(createSupabaseStore());
const qrSvg = (text) => QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#080f1a', light: '#ffffff' } });

export default createHandler({ service, getUserId, qrSvg });
