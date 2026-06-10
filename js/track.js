import * as THREE from 'three';

export const SPACING = 14;      // 데이터 1포인트당 트랙 길이
const H_MIN = 5, H_MAX = 46;    // 가격 → 레일 높이 매핑 범위
const UP = new THREE.Vector3(0, 1, 0);

// 옆으로 완만하게 휘어지는 코스 모양 (시각적 재미용)
const lat = i => 26 * Math.sin(i * 0.16) + 12 * Math.sin(i * 0.052 + 1.3);

// 가격 시리즈 → 롤러코스터 트랙 (엔딩 타입에 따라 마지막 런아웃 구간이 달라짐)
export function buildTrack(prices, endingType) {
  const N = prices.length;
  let min = Infinity, max = -Infinity;
  for (const p of prices) { min = Math.min(min, p); max = Math.max(max, p); }
  const span = (max - min) || 1;
  const hOf = p => H_MIN + ((p - min) / span) * (H_MAX - H_MIN);

  const pts = [];
  const h0 = hOf(prices[0]);
  for (let i = -3; i < 0; i++) pts.push(new THREE.Vector3(i * SPACING, h0, lat(0))); // 승강장 진입 구간
  for (let i = 0; i < N; i++) pts.push(new THREE.Vector3(i * SPACING, hOf(prices[i]), lat(i)));

  const lastX = (N - 1) * SPACING;
  const lastH = hOf(prices[N - 1]);
  const lastZ = lat(N - 1);
  if (endingType === 'space') {
    // 우주 발사 램프: 점점 가팔라지며 하늘로
    pts.push(new THREE.Vector3(lastX + 14, lastH + 2, lastZ));
    pts.push(new THREE.Vector3(lastX + 26, lastH + 13, lastZ));
    pts.push(new THREE.Vector3(lastX + 35, lastH + 32, lastZ));
    pts.push(new THREE.Vector3(lastX + 41, lastH + 60, lastZ));
  } else if (endingType === 'crash') {
    // 살짝 들어올렸다가 땅으로 곤두박질치는 다이브
    pts.push(new THREE.Vector3(lastX + 12, lastH + 7, lastZ));
    pts.push(new THREE.Vector3(lastX + 22, Math.max(3.5, lastH * 0.35), lastZ));
    pts.push(new THREE.Vector3(lastX + 28, 1.0, lastZ));
  } else {
    // 평탄한 정거장 런아웃 (브레이크 구간)
    for (let k = 1; k <= 4; k++) pts.push(new THREE.Vector3(lastX + k * 12, lastH, lastZ));
  }

  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
  curve.arcLengthDivisions = 1000;
  const len = curve.getLength();

  // 마지막 데이터 포인트(x = lastX)에 해당하는 곡선 파라미터 u
  let dataEndU = 1;
  for (let j = 0; j <= 400; j++) {
    const u = j / 400;
    if (curve.getPointAt(u).x >= lastX - 0.01) { dataEndU = u; break; }
  }

  const group = new THREE.Group();
  group.add(buildRails(curve, len));
  group.add(buildStation(h0, lat(0)));
  return { curve, len, group, dataEndU };
}

function buildRails(curve, len) {
  const g = new THREE.Group();
  const M = Math.max(200, Math.min(1400, Math.round(len / 0.9)));

  const leftPts = [], rightPts = [], frames = [];
  for (let j = 0; j <= M; j++) {
    const u = j / M;
    const p = curve.getPointAt(u);
    const tan = curve.getTangentAt(u);
    const right = new THREE.Vector3().crossVectors(tan, UP);
    if (right.lengthSq() < 1e-6) right.set(0, 0, 1);
    right.normalize();
    const upv = new THREE.Vector3().crossVectors(right, tan).normalize();
    leftPts.push(p.clone().addScaledVector(right, -1.1));
    rightPts.push(p.clone().addScaledVector(right, 1.1));
    frames.push({ p, tan, right, upv });
  }

  const railMat = new THREE.MeshLambertMaterial({ color: 0xe8432a });
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(leftPts), M, 0.22, 6), railMat));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rightPts), M, 0.22, 6), railMat));

  // 침목
  const tieEvery = 3;
  const tieCount = Math.floor(M / tieEvery);
  const ties = new THREE.InstancedMesh(
    new THREE.BoxGeometry(3.1, 0.14, 0.55),
    new THREE.MeshLambertMaterial({ color: 0xffd43b }),
    tieCount
  );
  const m4 = new THREE.Matrix4();
  const tmp = new THREE.Vector3();
  for (let j = 0; j < tieCount; j++) {
    const f = frames[j * tieEvery];
    m4.makeBasis(f.right, f.upv, f.tan);
    m4.setPosition(tmp.copy(f.p).addScaledVector(f.upv, -0.25));
    ties.setMatrixAt(j, m4);
  }
  ties.instanceMatrix.needsUpdate = true;
  g.add(ties);

  // 지지 기둥
  const supGeo = new THREE.CylinderGeometry(0.16, 0.16, 1, 6);
  supGeo.translate(0, 0.5, 0); // 바닥 기준 스케일링용
  const idxs = [];
  for (let j = 0; j < M; j += 7) if (frames[j].p.y > 2) idxs.push(j);
  const sup = new THREE.InstancedMesh(supGeo, new THREE.MeshLambertMaterial({ color: 0xf1f3f5 }), idxs.length);
  const dummy = new THREE.Object3D();
  idxs.forEach((j, k) => {
    const f = frames[j];
    dummy.position.set(f.p.x, 0, f.p.z);
    dummy.scale.set(1, Math.max(0.5, f.p.y - 0.5), 1);
    dummy.updateMatrix();
    sup.setMatrixAt(k, dummy.matrix);
  });
  sup.instanceMatrix.needsUpdate = true;
  g.add(sup);

  return g;
}

function buildStation(h0, z0) {
  const g = new THREE.Group();
  const plat = new THREE.Mesh(new THREE.BoxGeometry(34, 1.2, 10), new THREE.MeshLambertMaterial({ color: 0xced4da }));
  plat.position.set(-21, h0 - 1.7, z0);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(34, 0.7, 12), new THREE.MeshLambertMaterial({ color: 0xfa5252 }));
  roof.position.set(-21, h0 + 4.6, z0);
  g.add(plat, roof);
  const postMat = new THREE.MeshLambertMaterial({ color: 0xf8f9fa });
  for (const dx of [-14, 14]) for (const dz of [-4.6, 4.6]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 6.3, 8), postMat);
    post.position.set(-21 + dx, h0 + 1.4, z0 + dz);
    g.add(post);
  }
  return g;
}

// 잔디밭 + 나무 + 구름 (롤러코스터 타이쿤 느낌의 놀이공원 배경)
export function buildScenery() {
  const group = new THREE.Group();

  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c2 = cv.getContext('2d');
  c2.fillStyle = '#7bc862'; c2.fillRect(0, 0, 128, 128);
  c2.fillStyle = '#71bd58'; c2.fillRect(0, 0, 64, 64); c2.fillRect(64, 64, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(90, 90);
  tex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(7000, 7000), new THREE.MeshLambertMaterial({ map: tex }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.x = 450;
  group.add(ground);

  // 나무들 (트랙 통로를 비켜서 배치)
  const trunkGeo = new THREE.CylinderGeometry(0.5, 0.7, 3, 6);
  const coneGeo = new THREE.ConeGeometry(3.2, 7, 7);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8d5a2b });
  const greens = [0x2f9e44, 0x37b24d, 0x2b8a3e].map(c => new THREE.MeshLambertMaterial({ color: c }));
  for (let i = 0; i < 64; i++) {
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat); trunk.position.y = 1.5;
    const cone = new THREE.Mesh(coneGeo, greens[i % 3]); cone.position.y = 6;
    t.add(trunk, cone);
    const s = 0.7 + Math.random() * 0.9;
    t.scale.setScalar(s);
    const side = Math.random() < 0.5 ? -1 : 1;
    t.position.set(-80 + Math.random() * 1130, 0, side * (55 + Math.random() * 260));
    group.add(t);
  }

  // 구름 스프라이트
  const ccv = document.createElement('canvas');
  ccv.width = ccv.height = 128;
  const cc = ccv.getContext('2d');
  const grad = cc.createRadialGradient(64, 64, 8, 64, 64, 60);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.7, 'rgba(255,255,255,.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  cc.fillStyle = grad; cc.fillRect(0, 0, 128, 128);
  const cloudTex = new THREE.CanvasTexture(ccv);
  const clouds = [];
  for (let i = 0; i < 10; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, transparent: true, opacity: 0.85, depthWrite: false }));
    sp.scale.set(70 + Math.random() * 60, 32 + Math.random() * 22, 1);
    sp.position.set(-300 + Math.random() * 1600, 95 + Math.random() * 70, -420 + Math.random() * 840);
    sp.userData.v = 2 + Math.random() * 3;
    clouds.push(sp);
    group.add(sp);
  }

  return {
    group,
    update(dt) {
      for (const c of clouds) {
        c.position.x += c.userData.v * dt;
        if (c.position.x > 1500) c.position.x = -450;
      }
    },
  };
}

export function disposeGroup(g) {
  g.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
    }
  });
}
