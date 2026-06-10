// 저장된 종목 차트 데이터
// 정적 호스팅(GitHub Pages)에서는 증권사 API 호출이 불가하므로(CORS/인증),
// PROJECT.md 명세의 대비책에 따라 10개 종목의 차트를 내장 데이터로 제공한다.
// anchors: 최근 5년(60개월)을 5개월 간격으로 잡은 13개 기준가 — 시드 노이즈를 더해
// 월봉/1년/3개월 시리즈를 생성한다. (시드 고정 → 항상 동일한 차트)

export const TICKERS = [
  { id: 'samsung',   name: '삼성전자',   code: '005930', currency: 'KRW', vol: 0.030,
    anchors: [81000, 72000, 68000, 59000, 61500, 66000, 71500, 78500, 76000, 55500, 58500, 73000, 93000] },
  { id: 'hynix',     name: 'SK하이닉스', code: '000660', currency: 'KRW', vol: 0.045,
    anchors: [123000, 118000, 108000, 90500, 89000, 118000, 135000, 178000, 212000, 172000, 206000, 312000, 425000] },
  { id: 'sds',       name: '삼성SDS',    code: '018260', currency: 'KRW', vol: 0.025,
    anchors: [155000, 163000, 141000, 128000, 121000, 129500, 152000, 158500, 148000, 135500, 141000, 146500, 144500] },
  { id: 'kakao',     name: '카카오',     code: '035720', currency: 'KRW', vol: 0.040,
    anchors: [162000, 154000, 128000, 89000, 71000, 59500, 52500, 48500, 55500, 38500, 41500, 45500, 38000] },
  { id: 'hybe',      name: '하이브',     code: '352820', currency: 'KRW', vol: 0.045,
    anchors: [300000, 336000, 255000, 162000, 146000, 178000, 236000, 268000, 215000, 182000, 206000, 278000, 305000] },
  { id: 'celltrion', name: '셀트리온',   code: '068270', currency: 'KRW', vol: 0.038,
    anchors: [268000, 252000, 215000, 178000, 162000, 148000, 172000, 198000, 186000, 178000, 192000, 168000, 146000] },
  { id: 'tesla',     name: '테슬라',     code: 'TSLA',   currency: 'USD', vol: 0.055,
    anchors: [205, 352, 310, 225, 108, 162, 256, 242, 176, 249, 478, 290, 346] },
  { id: 'nvidia',    name: '엔비디아',   code: 'NVDA',   currency: 'USD', vol: 0.048,
    anchors: [16, 28, 24, 15, 14, 28, 42, 48, 88, 118, 134, 149, 183] },
  { id: 'bitcoin',   name: '비트코인',   code: 'BTC',    currency: 'USD', vol: 0.055,
    anchors: [35800, 57000, 46800, 29200, 16800, 23100, 29800, 43500, 64500, 69800, 97500, 104500, 119000] },
  { id: 'ripple',    name: '리플',       code: 'XRP',    currency: 'USD', vol: 0.060,
    anchors: [0.88, 1.05, 0.78, 0.39, 0.35, 0.47, 0.52, 0.62, 0.58, 0.55, 2.35, 2.62, 2.12] },
];

export const PERIODS = [
  { key: 'monthly', name: '월봉',   desc: '최근 5년 · 월 단위',   points: 61, startMonth: 0,  stepDays: 30.4, persist: 0.86, noise: 1.7,  dateFmt: 'ym'  },
  { key: '1y',      name: '1년',    desc: '최근 1년 · 주 단위',   points: 53, startMonth: 48, stepDays: 7,    persist: 0.88, noise: 1.15, dateFmt: 'ymd' },
  { key: '3m',      name: '3개월',  desc: '최근 3개월 · 일 단위', points: 66, startMonth: 57, stepDays: 1.4,  persist: 0.82, noise: 0.9,  dateFmt: 'ymd' },
];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function fmtDate(d, fmt) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return fmt === 'ym' ? `${y}.${m}` : `${String(y).slice(2)}.${m}.${dd}`;
}

// 기준가 배열을 0~60개월 구간에서 부드럽게 보간
function sampleAnchor(anchors, month) {
  const f = Math.min(Math.max(month / 5, 0), 12);
  const i = Math.min(11, Math.floor(f));
  const t = f - i;
  const tt = t * t * (3 - 2 * t); // smoothstep
  return anchors[i] * (1 - tt) + anchors[i + 1] * tt;
}

export function buildSeries(ticker, periodKey) {
  const P = PERIODS.find(p => p.key === periodKey);
  const rng = mulberry32(hashStr(ticker.id + ':' + periodKey));
  const n = P.points;
  const now = new Date();
  const prices = [];
  const labels = [];
  let w = 0; // 시드 기반 흔들림(평균 회귀 랜덤워크)
  for (let i = 0; i < n; i++) {
    const m = P.startMonth + (60 - P.startMonth) * (i / (n - 1));
    w = w * P.persist + (rng() - 0.5) * ticker.vol * P.noise;
    prices.push(sampleAnchor(ticker.anchors, m) * (1 + w));
    const d = new Date(now.getTime() - (n - 1 - i) * P.stepDays * 86400e3);
    labels.push(fmtDate(d, P.dateFmt));
  }
  return { prices, labels };
}

export function fmtPrice(ticker, p) {
  if (ticker.currency === 'KRW') return '₩' + Math.round(p).toLocaleString('ko-KR');
  if (p < 10) return '$' + p.toFixed(3);
  if (p < 1000) return '$' + p.toFixed(2);
  return '$' + Math.round(p).toLocaleString('en-US');
}
