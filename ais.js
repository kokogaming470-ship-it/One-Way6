// Vercel serverless function: GET /api/ais?mmsi=111111111,222222222,...
// Needs env var AISSTREAM_API_KEY (free key from aisstream.io)
const WebSocket = require('ws');
const cache = globalThis.__aisCache || (globalThis.__aisCache = {});
const FRESH_MS = 120000;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const ids = [...new Set(
    String((req.query && req.query.mmsi) || '')
      .split(',')
      .map((s) => s.replace(/\D/g, ''))
      .filter((s) => s.length === 9)
  )].slice(0, 50);
  if (!ids.length) return res.status(400).json({ error: 'bad_mmsi' });

  const key = process.env.AISSTREAM_API_KEY;
  if (!key) return res.status(200).json({ error: 'nokey' });

  const isFresh = (i) => cache[i] && cache[i].lat != null && Date.now() - cache[i].t < FRESH_MS;
  const need = ids.filter((i) => !isFresh(i));

  if (need.length) {
    await new Promise((resolve) => {
      let ws, done = false, grace;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearTimeout(grace);
        try { ws.close(); } catch (e) {}
        resolve();
      };