// Malek Browser backend (Vercel serverless, Node 18+)
const AD = /doubleclick|googlesyndication|googleadservices|adservice|adsystem|adnxs|taboola|outbrain|popads|popcash|propeller|exoclick|juicyads|adsterra|mgid|revcontent|amazon-adsystem|criteo|pubmatic|rubiconproject|openx|smartadserver|moatads|scorecardresearch|hotjar|adsrvr|\/ads?\//i;
const FALLBACK = ['https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de', 'https://api.piped.private.coffee', 'https://pipedapi.leptons.xyz', 'https://pipedapi.orangenet.cc'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const bad = h => !h.includes('.') || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h);
const strip = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").trim();
const secs = t => (t || '').split(':').reduce((a, b) => a * 60 + (+b || 0), 0);

let cache = { t: 0, list: FALLBACK };
async function instances() {
  if (Date.now() - cache.t < 600000) return cache.list;
  try {
    const r = await fetch('https://piped-instances.kavin.rocks/', { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    const l = j.filter(x => x.api_url && !x.cdn && x.uptime_24h > 80).sort((a, b) => b.uptime_24h - a.uptime_24h).map(x => x.api_url);
    cache = { t: Date.now(), list: [...new Set([...l.slice(0, 6), ...FALLBACK])] };
  } catch (e) { cache.t = Date.now(); }
  return cache.list;
}
async function piped(path) {
  for (const b of await instances()) {
    try {
      const r = await fetch(b + path, { signal: AbortSignal.timeout(5000) });
      if (r.ok) return await r.json();
    } catch (e) {}
  }
  throw new Error('piped down');
}
const vid = v => ({ id: (v.url || '').split('v=')[1], title: v.title, thumb: v.thumbnail, by: v.uploaderName, dur: v.duration, views: v.views });

// Search YouTube directly (no third-party instance needed)
async function ytScrape(q) {
  const r = await fetch('https://www.youtube.com/results?hl=ar&gl=EG&search_query=' + encodeURIComponent(q), {
    headers: { 'user-agent': UA, 'accept-language': 'ar,en;q=0.8', cookie: 'CONSENT=YES+1; SOCS=CAI' }, signal: AbortSignal.timeout(8000)
  });
  const h = await r.text();
  const m = h.match(/var ytInitialData\s*=\s*(\{.*?\});<\/script>/s);
  if (!m) throw new Error('no data');
  const out = [];
  (function walk(o) {
    if (!o || typeof o !== 'object' || out.length > 30) return;
    if (o.videoRenderer && o.videoRenderer.videoId) {
      const v = o.videoRenderer;
      out.push({ id: v.videoId, title: (v.title.runs || []).map(x => x.text).join(''), thumb: 'https://i.ytimg.com/vi/' + v.videoId + '/mqdefault.jpg',
        by: v.ownerText && v.ownerText.runs && v.ownerText.runs[0].text, dur: secs(v.lengthText && v.lengthText.simpleText) });
    }
    for (const k in o) walk(o[k]);
  })(JSON.parse(m[1]));
  if (!out.length) throw new Error('empty');
  return out;
}
async function ytSearch(q) {
  try { return await ytScrape(q || 'الأكثر مشاهدة في مصر'); } catch (e) {}
  const d = q ? (await piped('/search?q=' + encodeURIComponent(q) + '&filter=videos')).items : await piped('/trending?region=EG');
  return d.filter(v => v.url && v.url.includes('v=')).map(vid);
}

async function webSearch(q) {
  try {
    const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q) + '&kl=xa-ar', { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(7000) });
    const h = await r.text(), out = [];
    const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(h)) && out.length < 12) {
      let link = m[1];
      const x = link.match(/uddg=([^&]+)/);
      if (x) link = decodeURIComponent(x[1]);
      if (!/^https?:/.test(link) || /y\.js/.test(link) || AD.test(link)) continue;
      out.push({ url: link, title: strip(m[2]), snip: strip(m[3]) });
    }
    if (out.length) return out;
  } catch (e) {}
  // fallback: Wikipedia (always reachable)
  const out = [];
  for (const lang of ['ar', 'en']) {
    try {
      const r = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=6`, { signal: AbortSignal.timeout(5000) });
      const j = await r.json();
      j.query.search.forEach(s => out.push({ url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, '_'))}`, title: s.title + ' - ويكيبيديا', snip: strip(s.snippet) }));
    } catch (e) {}
  }
  return out;
}

const INJECT = base => `<base href="${base}"><style>ins.adsbygoogle,[id^=google_ads],[class*=advert],[id*=advert],[class*=ad-banner],[class*=adsbox],[class*=popup-ad],iframe[src*=ads]{display:none!important}</style><script>
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[href]');if(!a||/^(javascript|#|mailto)/.test(a.getAttribute('href')))return;e.preventDefault();parent.postMessage({nav:a.href},'*')},true);
document.addEventListener('submit',function(e){var f=e.target;if((f.method||'get').toLowerCase()!=='get')return;e.preventDefault();var u=new URL(f.action||location.href,document.baseURI);new FormData(f).forEach(function(v,k){u.searchParams.set(k,v)});parent.postMessage({nav:u.href},'*')},true);
window.open=function(u){if(u)parent.postMessage({nav:new URL(u,document.baseURI).href},'*');return null};
</script>`;

module.exports = async (req, res) => {
  const { a, q, id, u } = req.query;
  try {
    if (a === 'health') {
      const t = async f => { try { const r = await f(); return r.length ? 'OK (' + r.length + ')' : 'EMPTY'; } catch (e) { return 'FAIL: ' + e.message; } };
      return res.json({
        youtube_search: await t(() => ytScrape('test')),
        piped_instances: await t(async () => (await instances()).filter(Boolean)),
        piped_stream: await t(async () => { const d = await piped('/streams/dQw4w9WgXcQ'); return d.videoStreams || []; }),
        web_search: await t(() => webSearch('test'))
      });
    }
    if (a === 'yt') return res.json(await ytSearch(q));
    if (a === 'stream') {
      const d = await piped('/streams/' + encodeURIComponent(id));
      const s = (d.videoStreams || []).filter(x => !x.videoOnly && /mp4/.test(x.mimeType)).sort((x, y) => y.bitrate - x.bitrate)[0];
      return res.json({ title: d.title, by: d.uploader, url: s && s.url, related: (d.relatedStreams || []).filter(v => v.url && v.url.includes('v=')).map(vid) });
    }
    if (a === 'web') return res.json(await webSearch(q));
    if (a === 'proxy') {
      const url = new URL(u);
      if (!/^https?:$/.test(url.protocol) || bad(url.hostname) || AD.test(url.href)) return res.status(400).send('blocked');
      const r = await fetch(url, { headers: { 'user-agent': req.headers['user-agent'] || UA, 'accept-language': 'ar,en;q=0.8' }, redirect: 'follow' });
      const ct = r.headers.get('content-type') || '';
      res.setHeader('content-type', ct);
      if (!ct.includes('text/html')) return res.send(Buffer.from(await r.arrayBuffer()));
      let h = await r.text();
      const kill = (m, s) => (AD.test(s) ? '' : m);
      h = h.replace(/<script[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi, kill)
           .replace(/<iframe[^>]*src=["']([^"']+)["'][^>]*>\s*<\/iframe>/gi, kill)
           .replace(/<meta[^>]+http-equiv=["']?(content-security-policy|x-frame-options)[^>]*>/gi, '');
      h = /<head[^>]*>/i.test(h) ? h.replace(/<head[^>]*>/i, m => m + INJECT(r.url)) : INJECT(r.url) + h;
      return res.send(h);
    }
    res.status(400).json({ error: 'bad request' });
  } catch (e) {
    res.status(502).json({ error: 'down' });
  }
};
