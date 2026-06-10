// Yahoo Finance에서 실제 시세를 받아 js/data.js를 생성한다.
// 사용법: node tools/fetch-data.mjs  (또는 npm run fetch-data)
// 기준일(AS_OF)까지의 종가만 사용하므로, 기준일을 바꾸면 그 시점 차트로 재생성된다.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AS_OF = '2026-06-10'; // 차트 기준일 (이 날짜 종가까지 포함)

const TICKERS = [
  { id: 'samsung',   name: '삼성전자',   code: '005930', currency: 'KRW', symbol: '005930.KS' },
  { id: 'hynix',     name: 'SK하이닉스', code: '000660', currency: 'KRW', symbol: '000660.KS' },
  { id: 'sds',       name: '삼성SDS',    code: '018260', currency: 'KRW', symbol: '018260.KS' },
  { id: 'kakao',     name: '카카오',     code: '035720', currency: 'KRW', symbol: '035720.KS' },
  { id: 'hybe',      name: '하이브',     code: '352820', currency: 'KRW', symbol: '352820.KS' },
  { id: 'celltrion', name: '셀트리온',   code: '068270', currency: 'KRW', symbol: '068270.KS' },
  { id: 'tesla',     name: '테슬라',     code: 'TSLA',   currency: 'USD', symbol: 'TSLA' },
  { id: 'nvidia',    name: '엔비디아',   code: 'NVDA',   currency: 'USD', symbol: 'NVDA' },
  { id: 'bitcoin',   name: '비트코인',   code: 'BTC',    currency: 'USD', symbol: 'BTC-USD' },
  { id: 'ripple',    name: '리플',       code: 'XRP',    currency: 'USD', symbol: 'XRP-USD' },
];

// 기준일로부터 거슬러 올라간 기간 × 봉 간격
const PERIODS = [
  { key: '1m', name: '1개월', desc: '최근 1개월 · 일봉', months: 1,  interval: '1d',  dateFmt: 'ymd' },
  { key: '3m', name: '3개월', desc: '최근 3개월 · 일봉', months: 3,  interval: '1d',  dateFmt: 'ymd' },
  { key: '1y', name: '1년',   desc: '최근 1년 · 주봉',   months: 12, interval: '1wk', dateFmt: 'ymd' },
  { key: '3y', name: '3년',   desc: '최근 3년 · 월봉',   months: 36, interval: '1mo', dateFmt: 'ym'  },
];

const asOf = new Date(AS_OF + 'T00:00:00Z');
const endTs = Math.floor(asOf.getTime() / 1000) + 86400; // 기준일 다음날 0시(UTC) 직전까지

function startTs(months, snapToMonth) {
  const d = new Date(asOf);
  d.setUTCMonth(d.getUTCMonth() - months);
  if (snapToMonth) d.setUTCDate(1); // 월봉은 월초 기준이라 시작점을 월초로 당긴다
  return Math.floor(d.getTime() / 1000);
}

async function fetchChart(symbol, p1, interval) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${p1}&period2=${endTs}&interval=${interval}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`${symbol} ${interval}: HTTP ${res.status}`);
  const json = await res.json();
  const r = json.chart?.result?.[0];
  if (!r) throw new Error(`${symbol} ${interval}: ${JSON.stringify(json.chart?.error)}`);
  return r;
}

function fmtLabel(d, fmt) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return fmt === 'ym' ? `${y}.${m}` : `${String(y).slice(2)}.${m}.${dd}`;
}

function roundPrice(p, currency) {
  if (currency === 'KRW') return Math.round(p);
  if (p >= 1000) return Math.round(p);              // BTC 등 큰 값은 정수
  if (p < 10) return Math.round(p * 10000) / 10000; // XRP 등 소액은 4자리
  return Math.round(p * 100) / 100;                 // 일반 주식 2자리
}

async function main() {
  const out = [];
  for (const t of TICKERS) {
    const series = {};
    for (const P of PERIODS) {
      const r = await fetchChart(t.symbol, startTs(P.months, P.interval === '1mo'), P.interval);
      const tz = r.meta.gmtoffset ?? 0;
      const ts = r.timestamp ?? [];
      const close = r.indicators?.quote?.[0]?.close ?? [];
      const labels = [], prices = [];
      let lastBucket = null;
      for (let i = 0; i < ts.length; i++) {
        if (close[i] == null) continue;
        if (ts[i] >= endTs) continue;
        const local = new Date((ts[i] + tz) * 1000);
        if (fmtLabel(local, 'ymd') > fmtLabel(asOf, 'ymd')) continue; // 기준일 이후 봉 제외
        // 야후가 덧붙이는 '현재가 봉'이 마지막 정규 봉과 같은 일/주/월에 겹치면 나중 것만 남긴다
        const days = Math.floor((ts[i] + tz) / 86400);
        const bucket = P.interval === '1mo' ? local.getUTCFullYear() * 12 + local.getUTCMonth()
                     : P.interval === '1wk' ? Math.floor((days + 3) / 7) // 월요일 기준 주
                     : days;
        if (bucket === lastBucket) { labels.pop(); prices.pop(); }
        lastBucket = bucket;
        labels.push(fmtLabel(local, P.dateFmt));
        prices.push(roundPrice(close[i], t.currency));
      }
      if (prices.length < 5) throw new Error(`${t.symbol} ${P.key}: ${prices.length}개 — 데이터 부족`);
      series[P.key] = { labels, prices };
      console.log(`${t.name} ${P.key}: ${prices.length}개, ${labels[0]} ~ ${labels.at(-1)}, 마지막 종가 ${prices.at(-1)}`);
      await new Promise(r2 => setTimeout(r2, 300)); // 호출 간격
    }
    out.push({ ...t, series });
  }

  const lines = [];
  lines.push('// 실제 종목 시세 데이터 (Yahoo Finance 종가, ' + AS_OF + ' 기준)');
  lines.push('// tools/fetch-data.mjs 실행으로 재생성된다. 직접 수정하지 말 것.');
  lines.push('');
  lines.push('export const TICKERS = [');
  for (const t of out) {
    lines.push(`  { id: '${t.id}', name: '${t.name}', code: '${t.code}', currency: '${t.currency}', series: {`);
    for (const P of PERIODS) {
      const s = t.series[P.key];
      lines.push(`    '${P.key}': {`);
      lines.push(`      labels: [${s.labels.map(l => `'${l}'`).join(', ')}],`);
      lines.push(`      prices: [${s.prices.join(', ')}],`);
      lines.push('    },');
    }
    lines.push('  } },');
  }
  lines.push('];');
  lines.push('');
  lines.push('export const PERIODS = [');
  for (const P of PERIODS) {
    lines.push(`  { key: '${P.key}', name: '${P.name}', desc: '${P.desc}' },`);
  }
  lines.push('];');
  lines.push('');
  lines.push(`export function buildSeries(ticker, periodKey) {
  const s = ticker.series[periodKey];
  return { prices: s.prices.slice(), labels: s.labels.slice() };
}

export function fmtPrice(ticker, p) {
  if (ticker.currency === 'KRW') return '₩' + Math.round(p).toLocaleString('ko-KR');
  if (p < 10) return '$' + p.toFixed(3);
  if (p < 1000) return '$' + p.toFixed(2);
  return '$' + Math.round(p).toLocaleString('en-US');
}`);
  lines.push('');

  const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'data.js');
  writeFileSync(dest, lines.join('\n'), 'utf8');
  console.log(`\n생성 완료: ${dest}`);
}

main().catch(e => { console.error(e); process.exit(1); });
