// Single API entry point for GundiChest (one function keeps the project well inside the Hobby plan limits).
const { handle } = require('../server/handler');

module.exports = async function rpc(req, res) {
  try {
    const out = await handle({
      method: req.method,
      body: req.body,
      query: req.query || {},
      headers: req.headers || {},
      ip: (String(req.headers['x-forwarded-for'] || '').split(',')[0] || '').trim(),
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(out.status || 200).json(out.body);
  } catch (err) {
    console.error('rpc failed', err);
    res.status(500).json({ ok: false, error: 'server', message: 'Something went wrong on the server.' });
  }
};
