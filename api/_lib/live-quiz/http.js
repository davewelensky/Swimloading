// HTTP layer for the live quiz — one handler, action in the path:
//   /api/live-quiz/<action>   (vercel.json rewrites to /api/live-quiz?action=<action>)
// Built as a factory so scripts/live-quiz-dev.mjs can run the identical
// handler against the in-memory store with fake auth.
import { QuizError } from './service.js';

export const PUBLIC_BASE = 'https://www.swimloading.com';

export function createHandler({ service, getUserId, qrSvg }) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const url = new URL(req.url || '/', 'http://x');
    const action = url.searchParams.get('action') || url.pathname.split('/').filter(Boolean).pop();
    const slug = url.searchParams.get('slug') || (req.body && req.body.slug) || '';
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const userId = () => getUserId(req.headers['authorization']);

    try {
      switch (`${req.method} ${action}`) {
        // ── public ──
        case 'GET state':       return res.status(200).json(await service.getPublicState(slug));
        case 'GET leaderboard': return res.status(200).json({ leaderboard: await service.getPublicLeaderboard(slug) });
        case 'GET qr': {
          const svg = await qrSvg(`${PUBLIC_BASE}/live/${encodeURIComponent(slug)}`);
          res.setHeader('Content-Type', 'image/svg+xml');
          if (url.searchParams.get('download')) res.setHeader('Content-Disposition', `attachment; filename="swimloading-${slug}-qr.svg"`);
          return res.status(200).send(svg);
        }
        case 'POST signup': return res.status(200).json(await service.signup(slug, body));
        // ── player ──
        case 'POST join':   return res.status(200).json(await service.join(slug, await userId()));
        case 'GET me':      return res.status(200).json(await service.me(slug, await userId()));
        case 'GET next':    return res.status(200).json(await service.nextQuestion(slug, await userId()));
        case 'POST answer': return res.status(200).json(await service.answer(slug, await userId(), body.question_id, body.selected_answer));
        // ── admin ──
        case 'GET admin-event': return res.status(200).json(await service.adminGetEvent(await userId(), slug));
        case 'POST admin': {
          const uid = await userId();
          switch (body.op) {
            case 'save-event':      return res.status(200).json(await service.adminSaveEvent(uid, body.event || {}));
            case 'status':          return res.status(200).json(await service.adminSetStatus(uid, slug, body.status));
            case 'active':          return res.status(200).json(await service.adminSetActive(uid, slug, body.is_active));
            case 'save-question':   return res.status(200).json(await service.adminSaveQuestion(uid, slug, body.question || {}));
            case 'delete-question': return res.status(200).json(await service.adminDeleteQuestion(uid, slug, body.question_id));
            case 'reorder':         return res.status(200).json(await service.adminReorderQuestions(uid, slug, body.ordered_ids || []));
            case 'reset':           return res.status(200).json(await service.adminReset(uid, slug));
            default: throw new QuizError(400, 'bad_op');
          }
        }
        default:
          return res.status(404).json({ error: 'unknown_action' });
      }
    } catch (err) {
      if (err instanceof QuizError) return res.status(err.status).json({ error: err.code, message: err.message });
      console.error('[live-quiz]', action, err);
      return res.status(500).json({ error: 'server_error' });
    }
  };
}
