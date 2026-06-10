import * as THREE from 'three';
import { TICKERS, PERIODS, buildSeries, fmtPrice } from './data.js';
import { buildTrack, buildScenery, disposeGroup, SPACING } from './track.js';
import { Effects } from './effects.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';

// ---------- 렌더러 / 씬 ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const SKY = new THREE.Color(0x7ec8f2);
const SPACE_COL = new THREE.Color(0x020308);
const scene = new THREE.Scene();
scene.background = SKY.clone();
scene.fog = new THREE.Fog(SKY.clone(), 300, 1500);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(0, 60, 200);

scene.add(new THREE.HemisphereLight(0xcfe9ff, 0x77b96a, 0.95));
const sun = new THREE.DirectionalLight(0xffffff, 1.7);
sun.position.set(250, 380, 120);
scene.add(sun);

const scenery = buildScenery();
scene.add(scenery.group);
const effects = new Effects(scene);
const audio = new AudioEngine();

// ---------- 주행 물리 상수 ----------
const G = 22;        // 중력(연출용으로 과장)
const DRAG = 0.0012; // 공기 저항
const ROLL = 0.5;    // 구름 저항
const V_MAX = 46;    // 최고 속도 (m/s) → 165 km/h
const V_LIFT = 8;    // 리프트 체인 속도

const UP = new THREE.Vector3(0, 1, 0);
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

let ride = null;
let state = 'menu'; // menu | riding | result
let orbitA = 0;

// ---------- 시리즈 분석 ----------
// 마지막 구간의 추세로 엔딩 결정: 상승 마감 → 우주 / 하락 마감 → 추락 / 평탄 → 정지
function classifyEnding(prices) {
  const n = prices.length;
  const k = Math.max(4, Math.round(n * 0.1));
  const change = (prices[n - 1] - prices[n - 1 - k]) / prices[n - 1 - k];
  if (change > 0.035) return 'space';
  if (change < -0.035) return 'crash';
  return 'stop';
}

// 변동성 기준으로 급등(+1)/급락(-1)/보통(0) 구간 표시
function computeZones(prices) {
  const r = [];
  for (let i = 0; i < prices.length - 1; i++) r.push((prices[i + 1] - prices[i]) / prices[i]);
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) * (b - mean), 0) / r.length) || 1e-9;
  const th = Math.max(sd * 1.1, 0.008);
  return r.map(x => (x >= th ? 1 : x <= -th ? -1 : 0));
}

function pctText(start, cur) {
  const ch = ((cur - start) / start) * 100;
  return (ch >= 0 ? '+' : '') + ch.toFixed(1) + '%';
}

// ---------- 라이드 구성 ----------
function rebuild() {
  const ticker = TICKERS.find(t => t.id === ui.tickerId);
  const period = PERIODS.find(p => p.key === ui.periodKey);
  const series = buildSeries(ticker, period.key);
  const ending = classifyEnding(series.prices);

  if (ride) {
    scene.remove(ride.track.group);
    disposeGroup(ride.track.group);
  }
  const track = buildTrack(series.prices, ending);
  scene.add(track.group);

  ride = {
    ticker, period, series, ending, track,
    zones: computeZones(series.prices),
    mode: 'track', s: 0, v: V_LIFT, maxV: 0,
    lastZone: 0, fwT: 0, bank: 0, braking: false, launched: false,
    screamCd: 0, spaceT: 0, crashT: 0,
    vel: new THREE.Vector3(), pos: new THREE.Vector3(),
  };
  ui.drawChart(series.prices);
}

function resetDynamics() {
  ride.mode = 'track';
  ride.s = 0; ride.v = V_LIFT; ride.maxV = 0;
  ride.lastZone = 0; ride.fwT = 0; ride.bank = 0;
  ride.braking = false; ride.launched = false; ride.screamCd = 0;
  ride.spaceT = 0; ride.crashT = 0;
  ui.setDanger(false); ui.setRush(false);
}

function restoreSky() {
  scene.background.copy(SKY);
  scene.fog = new THREE.Fog(SKY.clone(), 300, 1500);
  effects.setStars(0);
}

function startRide() {
  resetDynamics();
  restoreSky();
  ui.hideMenu();
  ui.showHUD();
  ui.flash('rgba(255,255,255,0.9)');
  audio.start();
  state = 'riding';
}

const ui = new UI({
  tickers: TICKERS,
  periods: PERIODS,
  onChange: rebuild,
  onStart: startRide,
  onRetry: () => { ui.hideResult(); startRide(); },
  onBack: () => {
    ui.hideResult(); ui.hideHUD();
    restoreSky();
    audio.quiet();
    ui.showMenu();
    state = 'menu';
  },
});

// ---------- 주행 업데이트 ----------
function handleZone(zone) {
  const r = ride;
  if (zone === r.lastZone) return;
  if (zone === -1) {            // 급락 진입: 사이렌 + 비명 + 빨간 비네트
    audio.siren(true);
    audio.scream();
    ui.setDanger(true);
  } else if (r.lastZone === -1) {
    audio.siren(false);
    ui.setDanger(false);
  }
  if (zone === 1) {             // 급등(불장) 진입: 폭죽!
    ui.setRush(true);
    spawnSurgeFirework();
    spawnSurgeFirework();
    audio.firework();
  } else if (r.lastZone === 1) {
    ui.setRush(false);
  }
  r.lastZone = zone;
}

function spawnSurgeFirework() {
  const { curve, len } = ride.track;
  const u = Math.min(ride.s / len + 50 / len, 1);
  const c = curve.getPointAt(u);
  c.x += (Math.random() - 0.5) * 30;
  c.y += 12 + Math.random() * 18;
  c.z += (Math.random() - 0.5) * 40;
  effects.firework(c);
}

function placeCamera(u, dt, zone) {
  const r = ride;
  const { curve, len } = r.track;
  const p = curve.getPointAt(u);
  const tan = curve.getTangentAt(u);
  const right = _v1.crossVectors(tan, UP);
  if (right.lengthSq() < 1e-6) right.set(0, 0, 1);
  right.normalize();
  const upv = _v2.crossVectors(right, tan).normalize();

  // 커브에 따른 뱅킹(좌우 기울기)
  const t2 = curve.getTangentAt(Math.min(u + 8 / len, 1));
  const turn = tan.x * t2.z - tan.z * t2.x;
  const bankTarget = THREE.MathUtils.clamp(turn * (4 + r.v * 0.35), -0.5, 0.5);
  r.bank += (bankTarget - r.bank) * Math.min(1, dt * 3.5);

  // 속도/급락에 따른 흔들림
  const amp = Math.pow(r.v / V_MAX, 2) * 0.16 + (zone === -1 ? 0.12 : 0);
  const head = p.clone().addScaledVector(upv, 2.3);
  head.x += (Math.random() - 0.5) * amp;
  head.y += (Math.random() - 0.5) * amp;
  head.z += (Math.random() - 0.5) * amp;

  const look = curve.getPointAt(Math.min(u + 10 / len, 1)).addScaledVector(upv, 2.1);
  camera.position.copy(head);
  const rh = _v3.set(tan.z, 0, -tan.x);
  if (rh.lengthSq() > 1e-6) {
    rh.normalize();
    camera.up.set(0, 1, 0).addScaledVector(rh, r.bank).normalize();
  } else {
    camera.up.set(0, 1, 0);
  }
  camera.lookAt(look);

  // 속도감: FOV 확장
  const tFov = 72 + (r.v / V_MAX) * 16 + (zone === -1 ? 6 : 0);
  camera.fov += (tFov - camera.fov) * Math.min(1, dt * 3);
  camera.updateProjectionMatrix();
}

function updateTrackRide(dt) {
  const r = ride;
  const { curve, len, dataEndU } = r.track;
  const prices = r.series.prices;
  const N = prices.length;

  let u = Math.min(r.s / len, 1);
  const tan = curve.getTangentAt(u);
  const slope = tan.y;
  const posOnTrack = curve.getPointAt(u);

  // 현재 위치의 가격/구간
  const fi = THREE.MathUtils.clamp(posOnTrack.x / SPACING, 0, N - 1);
  const i0 = Math.min(N - 2, Math.floor(fi));
  const fr = fi - i0;
  const price = prices[i0] * (1 - fr) + prices[i0 + 1] * fr;
  const zone = (posOnTrack.x < 0 || u >= dataEndU) ? 0 : r.zones[Math.min(i0, r.zones.length - 1)];
  handleZone(zone);

  // 물리: 중력 가속(내리막 가속, 오르막 감속) + 저항, 급변 구간 부스트
  let a = -G * slope - DRAG * r.v * r.v - ROLL;
  if (zone === -1) a += 9;
  if (zone === 1) a += 5;

  const climbing = slope > 0.03 && r.v <= V_LIFT + 0.3 && !r.braking && !r.launched;
  if (r.ending === 'stop' && u > dataEndU) {
    if (!r.braking) { r.braking = true; audio.brake(); }
    a = -16;
  }
  // 우주 엔딩: 발사 램프에서 체인 대신 로켓 부스트로 가속
  if (r.ending === 'space' && u > dataEndU) {
    if (!r.launched) { r.launched = true; audio.launch(); }
    a += 34;
  }

  r.v += a * dt;
  if (climbing && r.v < V_LIFT) r.v = V_LIFT; // 리프트 체인
  if (!r.braking && r.v < 4) r.v = 4;
  r.v = Math.min(r.v, V_MAX);
  if (r.braking && r.v <= 0.5) { r.v = 0; finishRide('stop'); return; }

  r.s += r.v * dt;
  r.maxV = Math.max(r.maxV, r.v);
  u = Math.min(r.s / len, 1);

  placeCamera(u, dt, zone);
  audio.setMotion(r.v / V_MAX, climbing);

  // 가파른 다이브에서 비명
  r.screamCd -= dt;
  if (slope < -0.5 && r.v > 26 && r.screamCd <= 0) {
    audio.scream();
    r.screamCd = 2.5;
  }

  // 급등 구간 폭죽 연발
  if (zone === 1) {
    r.fwT -= dt;
    if (r.fwT <= 0) {
      r.fwT = 0.5;
      spawnSurgeFirework();
      audio.firework();
    }
  }

  ui.setHUD({
    price: fmtPrice(r.ticker, price),
    pct: pctText(prices[0], price),
    up: price >= prices[0],
    kmh: Math.round(r.v * 3.6),
    name: `${r.ticker.name} (${r.ticker.code})`,
    date: r.series.labels[Math.round(fi)],
    period: `${r.period.name} · ${r.period.desc}`,
    progress: THREE.MathUtils.clamp(posOnTrack.x / ((N - 1) * SPACING), 0, 1),
  });

  if (u >= 1) {
    if (r.ending === 'space') enterSpace(curve.getTangentAt(1));
    else if (r.ending === 'crash') enterFall(curve.getTangentAt(1));
    else finishRide('stop');
  }
}

// ---------- 엔딩: 우주 발사 ----------
function enterSpace(tan) {
  const r = ride;
  r.mode = 'space';
  r.spaceT = 0;
  r.vel.copy(tan).multiplyScalar(Math.max(r.v, 36));
  r.pos.copy(camera.position);
  audio.siren(false);
  ui.setDanger(false);
  if (!r.launched) { r.launched = true; audio.launch(); }
}

function updateSpace(dt) {
  const r = ride;
  r.spaceT += dt;
  const spd = Math.min(150, 40 + r.spaceT * 26);
  _v1.set(0.3, 1, 0).normalize().multiplyScalar(spd);
  r.vel.lerp(_v1, Math.min(1, dt * 1.4));
  r.pos.addScaledVector(r.vel, dt);
  camera.position.copy(r.pos);
  camera.up.set(0, 1, 0);
  camera.lookAt(_v2.copy(r.pos).add(r.vel));

  // 하늘 → 우주
  scene.background.lerp(SPACE_COL, Math.min(1, dt * 0.5));
  scene.fog.color.copy(scene.background);
  scene.fog.far = Math.min(5000, scene.fog.far + 900 * dt);
  effects.setStars(Math.min(1, r.spaceT / 2.5), r.pos);

  r.fwT -= dt;
  if (r.fwT <= 0) {
    r.fwT = 0.45;
    const c = _v3.copy(r.pos).addScaledVector(r.vel, 1.1);
    c.x += (Math.random() - 0.5) * 80;
    c.y += (Math.random() - 0.5) * 60;
    c.z += (Math.random() - 0.5) * 80;
    effects.firework(c.clone());
    audio.firework();
  }
  ui.setSpeed(Math.round(r.vel.length() * 3.6));
  if (r.spaceT > 6.5) finishRide('space');
}

// ---------- 엔딩: 땅으로 곤두박질 ----------
function enterFall(tan) {
  const r = ride;
  r.mode = 'fall';
  r.vel.copy(tan).multiplyScalar(Math.max(r.v, 24));
  r.pos.copy(camera.position);
}

function updateFall(dt) {
  const r = ride;
  r.vel.y -= 35 * dt;
  r.pos.addScaledVector(r.vel, dt);
  camera.position.copy(r.pos);
  camera.up.set(0, 1, 0);
  camera.lookAt(_v2.copy(r.pos).add(r.vel));
  ui.setSpeed(Math.round(r.vel.length() * 3.6));

  if (r.pos.y <= 1.3) {
    r.mode = 'crashed';
    r.crashT = 0;
    const impact = r.pos.clone();
    impact.y = 1;
    effects.debris(impact);
    ui.flash('rgba(255,60,30,0.85)');
    audio.crash();
    audio.siren(false);
    audio.setMotion(0, false);
    ui.setDanger(false);
    // 충돌 지점을 바라보는 외부 시점으로 전환해 잔해 연출
    camera.position.set(impact.x - 16, 7, impact.z + 18);
    camera.lookAt(impact);
    r.pos.copy(impact);
  }
}

function updateCrashed(dt) {
  const r = ride;
  r.crashT += dt;
  const shake = Math.max(0, 1 - r.crashT) * 0.5;
  camera.position.x += (Math.random() - 0.5) * shake;
  camera.position.y += (Math.random() - 0.5) * shake;
  if (r.crashT > 2.4) finishRide('crash');
}

// ---------- 결과 ----------
const ENDINGS = {
  space: { emoji: '🚀', title: '투 더 문!', desc: '상승 마감! 롤러코스터가 우주로 발사되었습니다.' },
  crash: { emoji: '💥', title: '곤두박질…', desc: '하락 마감… 롤러코스터가 땅에 박살났습니다.' },
  stop:  { emoji: '🛑', title: '무사 도착', desc: '평탄한 마감. 코스터가 정거장에 안전하게 멈췄습니다.' },
};

function finishRide(type) {
  state = 'result';
  audio.quiet();
  ui.setDanger(false);
  ui.setRush(false);
  ui.hideHUD();
  const r = ride;
  const prices = r.series.prices;
  const start = prices[0];
  const end = prices[prices.length - 1];
  const e = ENDINGS[type];
  ui.showResult({
    ...e,
    stats: [
      ['종목', `${r.ticker.name} (${r.ticker.code})`],
      ['구간', `${r.period.name} (${r.period.desc})`],
      ['시작가', fmtPrice(r.ticker, start)],
      ['종료가', fmtPrice(r.ticker, end)],
      ['수익률', pctText(start, end)],
      ['최고 속도', `${Math.round(r.maxV * 3.6)} km/h`],
    ],
  });
}

// ---------- 메뉴 배경: 트랙 주위를 도는 카메라 ----------
function updateOrbit(dt) {
  orbitA += dt * 0.1;
  const center = ride.track.curve.getPointAt(0.5);
  const R = Math.max(260, ride.track.len * 0.33);
  camera.position.set(center.x + Math.cos(orbitA) * R, 115, center.z + Math.sin(orbitA) * R);
  camera.up.set(0, 1, 0);
  camera.lookAt(center.x, 22, center.z);
  if (Math.abs(camera.fov - 55) > 0.1) {
    camera.fov = 55;
    camera.updateProjectionMatrix();
  }
}

// ---------- 메인 루프 ----------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  scenery.update(dt);
  effects.update(dt);
  audio.update(dt);

  if (state === 'menu' && ride) {
    updateOrbit(dt);
  } else if (state === 'riding') {
    if (ride.mode === 'track') updateTrackRide(dt);
    else if (ride.mode === 'space') updateSpace(dt);
    else if (ride.mode === 'fall') updateFall(dt);
    else if (ride.mode === 'crashed') updateCrashed(dt);
  }

  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

rebuild();
animate();
