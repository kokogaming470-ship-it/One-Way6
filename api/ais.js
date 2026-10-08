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
      const timer = setTimeout(finish, 20000);
      try {
        ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
      } catch (e) {
        return finish();
      }

      ws.on('open', () =>
        ws.send(JSON.stringify({
          APIKey: key,
          BoundingBoxes: [[[-90, -180], [90, 180]]],
          FiltersShipMMSI: need,
          FilterMessageTypes: ['PositionReport', 'ShipStaticData']
        }))
      );

      ws.on('message', (d) => {
        let j;
        try { j = JSON.parse(d.toString()); } catch (e) { return; }
        if (j.error || j.Error) return finish();

        const meta = j.MetaData || {}, msg = j.Message || {};
        const id = String(meta.MMSI || '');
        if (!id) return; // e.g. SubscriptionConfirmation
        const c = cache[id] || (cache[id] = {});

        if (meta.ShipName && meta.ShipName.trim()) c.name = meta.ShipName.trim();

        if (j.MessageType === 'PositionReport' && msg.PositionReport) {
          const p = msg.PositionReport;
          c.lat = p.Latitude; c.lon = p.Longitude; c.sog = p.Sog; c.cog = p.Cog; c.t = Date.now();
        } else if (j.MessageType === 'ShipStaticData' && msg.ShipStaticData) {
          const s = msg.ShipStaticData;
          if (s.Destination) c.dest = String(s.Destination).trim();
          if (s.Name) c.name = String(s.Name).trim();
          const e = s.Eta;
          if (e && e.Month) {
            c.eta = `${e.Day}/${e.Month} ${String(e.Hour).padStart(2, '0')}:${String(e.Minute).padStart(2, '0')}`;
          }
        }

        // once every requested ship has a position, wait briefly for static data then finish
        if (!grace && need.every((i) => cache[i] && cache[i].lat != null)) {
          grace = setTimeout(finish, 1500);
        }
      });

      ws.on('error', finish);
      ws.on('close', finish);
    });
  }

  const out = {};
  ids.forEach((i) => {
    const c = cache[i] || {};
    const o = {};
    ['name', 'lat', 'lon', 'sog', 'cog', 'dest', 'eta'].forEach((k) => { if (c[k] != null) o[k] = c[k]; });
    if (c.lat == null) o.error = 'nodata';
    out[i] = o;
  });
  // single MMSI without comma -> flat object (backward compatible)
  const single = ids.length === 1 && !String(req.query.mmsi).includes(',');
  if (single) { const o = out[ids[0]]; delete o.error; return res.status(200).json(o); }
  res.status(200).json(out);
};
