// 노래방 신곡/인기차트 목록
// GET /api/list?type=new|chart&brand=all|tj|kumyoung
//   new   — TJ: 이달의 신곡 JSON API / 금영: kysing.kr/latest/ 1~3페이지
//   chart — TJ: TOP100 JSON API / 금영: kysing.kr/popular/
// → { type, results: [{ brand, source, songs: [...] }] }

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function fetchRaw(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      ...opts,
      headers: { 'User-Agent': UA, 'Accept-Language': 'ko,en;q=0.8', ...(opts.headers || {}) },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r;
  } finally {
    clearTimeout(t);
  }
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// ── TJ (공식 JSON API) ─────────────────────────────────────
function mapTJItems(items) {
  return (items || []).map((it) => ({
    brand: 'tj',
    no: String(it.pro),
    title: decodeEntities(it.indexTitle || ''),
    singer: decodeEntities(it.indexSong || ''),
    release: it.publishdate || '',
  }));
}

async function tjPost(path, body) {
  const r = await fetchRaw('https://www.tjmedia.com' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const j = await r.json();
  if (j.resultCode !== '99') throw new Error('TJ resultCode ' + j.resultCode);
  return j.resultData && j.resultData.items ? j.resultData.items : [];
}

async function tjNew() {
  // 한국시간 기준 이번 달, 비어 있으면 지난달
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  const ym = (d) => d.getUTCFullYear() + String(d.getUTCMonth() + 1).padStart(2, '0');
  let items = await tjPost('/legacy/api/newSongOfMonth', 'searchYm=' + ym(kst));
  if (!items.length) {
    const prev = new Date(kst.getTime());
    prev.setUTCMonth(prev.getUTCMonth() - 1);
    items = await tjPost('/legacy/api/newSongOfMonth', 'searchYm=' + ym(prev));
  }
  return mapTJItems(items);
}

async function tjChart() {
  const items = await tjPost(
    '/legacy/api/topAndHot100',
    'chartType=TOP&searchStartDate=&searchEndDate=&strType='
  );
  return mapTJItems(items);
}

// ── 금영 (kysing.kr HTML 파싱) ─────────────────────────────
// 신곡: search_chart_* / 인기차트: popular_chart_* — 마크업 패턴 동일
function parseKYList(html, prefix) {
  const songs = [];
  const chunks = html.split(prefix + '_num">').slice(1);
  for (const c of chunks) {
    const no = (c.match(/^(\d+)/) || [])[1];
    if (!no) continue;
    const tm = c.match(/<span title="([^"]*)"\s+class="tit">/);
    const sm = c.match(/<span title="([^"]*)"\s+class="tit mo-art">/);
    const rm = c.match(new RegExp(prefix + '_rel">([^<]*)<'));
    if (!tm) continue;
    songs.push({
      brand: 'kumyoung',
      no,
      title: decodeEntities(tm[1]).trim(),
      singer: sm ? decodeEntities(sm[1]).trim() : '',
      release: rm ? rm[1].trim() : '',
    });
  }
  return songs;
}

async function kyNew() {
  const pages = await Promise.all(
    [1, 2, 3].map((p) =>
      fetchRaw(`https://kysing.kr/latest/?s_page=${p}`)
        .then((r) => r.text())
        .then((h) => parseKYList(h, 'search_chart'))
        .catch(() => [])
    )
  );
  const seen = new Set();
  return pages.flat().filter((s) => (seen.has(s.no) ? false : (seen.add(s.no), true)));
}

async function kyChart() {
  const html = await (await fetchRaw('https://kysing.kr/popular/')).text();
  return parseKYList(html, 'popular_chart');
}

// ── 핸들러 ─────────────────────────────────────────────────
async function listBrand(type, brand) {
  try {
    let songs;
    if (brand === 'tj') songs = type === 'chart' ? await tjChart() : await tjNew();
    else songs = type === 'chart' ? await kyChart() : await kyNew();
    return { brand, source: 'official', songs };
  } catch {
    return { brand, source: 'error', songs: [] };
  }
}

module.exports = async (req, res) => {
  const type = req.query.type === 'chart' ? 'chart' : 'new';
  const brand = ['tj', 'kumyoung'].includes(req.query.brand) ? req.query.brand : 'all';

  const brands = brand === 'all' ? ['tj', 'kumyoung'] : [brand];
  const results = await Promise.all(brands.map((b) => listBrand(type, b)));

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=10800, stale-while-revalidate=86400');
  res.status(200).json({ type, results });
};
