// The one serverless function of the site: POST /api/rpc. Everything it does lives in server/.
const { handle } = require('../server/handler');

module.exports = async function rpc(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    let body;
    try { body = req.body; } catch (e) { body = '{'; }       // a body that is not JSON: the handler answers 400
    const h = req.headers || {};
    const ip = String(h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || '').trim();
    const out = await handle({ method: req.method, body, query: req.query || {}, headers: h, ip });
    res.status(out.status || 200).json(out.body);
  } catch (err) {
    console.error('rpc failed', err);
    res.status(500).json({ ok: false, error: 'server', message: 'Something went wrong on the server.' });
  }
};
