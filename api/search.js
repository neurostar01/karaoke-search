// 노래방 곡번호 검색 프록시
// 공식 사이트(TJ미디어 / 금영 kysing.kr)를 서버에서 조회·파싱하고,
// 실패하거나 결과가 없으면 비공식 API(api.manana.kr)로 폴백한다.
//
// GET /api/search?q=사계&mode=song|singer&brand=all|tj|kumyoung
// → { query, mode, results: [{ brand, source: official|manana|error, songs: [...] }] }

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function fetchText(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'ko,en;q=0.8' },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
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

function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

// ── TJ미디어 (www.tjmedia.com) ─────────────────────────────
// 결과 마크업: <span class="num2">번호</span> … title3 블록의 <p><span>제목</span></p></div>
//              … <li class="grid-item title4 singer"><p><span>가수</span></p></li>
function parseTJ(html) {
  const songs = [];
  const chunks = html.split('<span class="num2">').slice(1);
  for (const c of chunks) {
    const no = (c.match(/^(\d+)/) || [])[1];
    if (!no) continue;
    const tm = c.match(/title3"[\s\S]*?<p[^>]*>\s*<span>([\s\S]*?)<\/span>\s*<\/p>\s*<\/div>/);
    const sm = c.match(/title4 singer"><p><span>([\s\S]*?)<\/span>/);
    if (!tm || !sm) continue;
    songs.push({ brand: 'tj', no, title: stripTags(tm[1]), singer: stripTags(sm[1]), release: '' });
  }
  return songs;
}

async function searchTJ(q, mode) {
  const strType = mode === 'singer' ? 2 : 1; // 1=곡제목, 2=가수명
  const url =
    'https://www.tjmedia.com/song/accompaniment_search' +
    `?pageNo=1&pageRowCnt=100&strSotrGubun=ASC&strSortType=&nationType=&strType=${strType}` +
    `&searchTxt=${encodeURIComponent(q)}`;
  return parseTJ(await fetchText(url));
}

// ── 금영 (kysing.kr) ───────────────────────────────────────
// 결과 마크업: <li class="search_chart_num">번호</li>
//              <span title="제목" class="tit"> / <span title="가수" class="tit mo-art">
//              <li class="search_chart_rel">2025.01</li>
function parseKY(html) {
  const songs = [];
  const chunks = html.split('search_chart_num">').slice(1);
  for (const c of chunks) {
    const no = (c.match(/^(\d+)/) || [])[1];
    if (!no) continue;
    const tm = c.match(/<span title="([^"]*)"\s+class="tit">/);
    const sm = c.match(/<span title="([^"]*)"\s+class="tit mo-art">/);
    const rm = c.match(/search_chart_rel">([^<]*)</);
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

async function searchKY(q, mode) {
  const category = mode === 'singer' ? 7 : 2; // 2=곡명, 7=아티스트
  const url = `https://kysing.kr/search/?category=${category}&keyword=${encodeURIComponent(q)}`;
  return parseKY(await fetchText(url));
}

// ── manana.kr 폴백 ─────────────────────────────────────────
async function searchManana(q, mode, brand) {
  const type = mode === 'singer' ? 'singer' : 'song';
  const r = await fetch(
    `https://api.manana.kr/karaoke/${type}/${encodeURIComponent(q)}/${brand}.json`,
    { headers: { 'User-Agent': UA } }
  );
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  return (Array.isArray(d) ? d : []).map((s) => ({
    brand: s.brand,
    no: String(s.no),
    title: s.title,
    singer: s.singer,
    release: s.release && s.release !== '0000-00-00' ? s.release : '',
  }));
}

async function searchBrand(q, mode, brand) {
  let official = null;
  try {
    official = brand === 'tj' ? await searchTJ(q, mode) : await searchKY(q, mode);
  } catch {
    official = null;
  }
  if (official && official.length) return { brand, source: 'official', songs: official };

  // 공식 결과가 0곡이면 파싱 실패 가능성도 있으므로 manana로 교차 확인
  try {
    const fb = await searchManana(q, mode, brand);
    if (fb.length) return { brand, source: 'manana', songs: fb };
  } catch {
    /* 폴백도 실패 */
  }
  return official
    ? { brand, source: 'official', songs: [] }
    : { brand, source: 'error', songs: [] };
}

module.exports = async (req, res) => {
  const q = String(req.query.q || '').trim();
  const mode = req.query.mode === 'singer' ? 'singer' : 'song';
  const brand = ['tj', 'kumyoung'].includes(req.query.brand) ? req.query.brand : 'all';

  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!q) {
    res.status(400).json({ error: 'q 파라미터가 필요합니다' });
    return;
  }

  const brands = brand === 'all' ? ['tj', 'kumyoung'] : [brand];
  const results = await Promise.all(brands.map((b) => searchBrand(q, mode, b)));

  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
  res.status(200).json({ query: q, mode, results });
};
