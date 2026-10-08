// Vercel serverless function: GET /api/ais?mmsi=123456789
// Needs env var AISSTREAM_API_KEY (free key from aisstream.io)
const WebSocket = require('ws');
const cache = globalThis.__aisCache || (globalThis.__aisCache = {});

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const m = String((req.query && req.query.mmsi) || '').replace(/\D/g, '');
  if (m.length !== 9) return res.status(400).json({ error: 'bad_mmsi' });
  const key = process.env.AISSTREAM_API_KEY;
  if (!key) return res.status(200).json({ error: 'nokey' });

  const c = cache[m] || (cache[m] = {});
  if (c.lat != null && Date.now() - c.t < 120000) return res.status(200).json(c);

  const dbg = [], t0 = Date.now(), L = (x) => dbg.push(((Date.now() - t0) / 1000).toFixed(1) + 's ' + x);
  await new Promise((resolve) => {
    let ws, done = false, grace;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer); clearTimeout(grace);
      try { ws.close(); } catch (e) {}
      resolve();
    };
    const timer = setTimeout(finish, 50000);
    try { ws = new WebSocket('wss://stream.aisstream.io/v0/stream'); } catch (e) { return finish(); }
    ws.on('open', () => { L('open'); ws.send(JSON.stringify({
      APIKey: key,
      BoundingBoxes: [[[-90, -180], [90, 180]]],
      FiltersShipMMSI: [m],
      FilterMessageTypes: ['PositionReport', 'ShipStaticData']
    })); });
    ws.on('message', (d) => {
      let j; try { j = JSON.parse(d.toString()); } catch (e) { L('bad msg'); return; }
      if (dbg.length < 8) L('msg ' + (j.MessageType || JSON.stringify(j).slice(0, 150)));
      if (j.error) return finish();
      const meta = j.MetaData || {}, msg = j.Message || {};
      if (meta.ShipName && meta.ShipName.trim()) c.name = meta.ShipName.trim();
      if (j.MessageType === 'PositionReport' && msg.PositionReport) {
        const p = msg.PositionReport;
        c.lat = p.Latitude; c.lon = p.Longitude; c.sog = p.Sog; c.cog = p.Cog; c.t = Date.now();
        if (!grace) grace = setTimeout(finish, 1500);
      } else if (j.MessageType === 'ShipStaticData' && msg.ShipStaticData) {
        const s = msg.ShipStaticData;
        if (s.Destination) c.dest = String(s.Destination).trim();
        if (s.Name) c.name = String(s.Name).trim();
        const e = s.Eta;
        if (e && e.Month) c.eta = `${e.Day}/${e.Month} ${String(e.Hour).padStart(2, '0')}:${String(e.Minute).padStart(2, '0')}`;
      }
    });
    ws.on('error', (e) => { L('error ' + (e && e.message)); finish(); });
    ws.on('close', (code, reason) => { L('close ' + code + ' ' + String(reason || '')); finish(); });
  });

  const out = {};
  ['name', 'lat', 'lon', 'sog', 'cog', 'dest', 'eta'].forEach((k) => { if (c[k] != null) out[k] = c[k]; });
  console.log('ais', m, JSON.stringify(dbg));
  if (req.query && req.query.debug) out.debug = dbg;
  res.status(200).json(out);
};
