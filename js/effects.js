import * as THREE from 'three';

// 폭죽(급등), 잔해(추락 엔딩), 별(우주 엔딩) 파티클 이펙트
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.stars = this._makeStars();
    this.stars.visible = false;
    scene.add(this.stars);
  }

  _makeStars() {
    const n = 1500;
    const arr = new Float32Array(n * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.randomDirection().multiplyScalar(900 + Math.random() * 900);
      arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff, size: 2.4, sizeAttenuation: false,
      transparent: true, opacity: 0, depthWrite: false,
    });
    return new THREE.Points(geo, mat);
  }

  setStars(opacity, pos) {
    this.stars.visible = opacity > 0.01;
    this.stars.material.opacity = opacity;
    if (pos) this.stars.position.copy(pos);
  }

  firework(center) {
    const n = 120;
    const arr = new Float32Array(n * 3);
    const vel = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      arr[i * 3] = center.x; arr[i * 3 + 1] = center.y; arr[i * 3 + 2] = center.z;
      vel.push(v.randomDirection().multiplyScalar(6 + Math.random() * 16).clone());
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const mat = new THREE.PointsMaterial({
      color: new THREE.Color().setHSL(Math.random(), 0.95, 0.62),
      size: 1.8, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    this.scene.add(pts);
    this.items.push({ kind: 'fw', obj: pts, vel, age: 0, life: 1.4 + Math.random() * 0.5 });
  }

  debris(center) {
    const group = new THREE.Group();
    const colors = [0xe8432a, 0xffd43b, 0x868e96, 0xf1f3f5];
    const parts = [];
    for (let i = 0; i < 28; i++) {
      const s = 0.4 + Math.random() * 1.4;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(s, s * 0.6, s * 0.8),
        new THREE.MeshLambertMaterial({ color: colors[i % colors.length] })
      );
      mesh.position.copy(center);
      group.add(mesh);
      parts.push({
        mesh,
        vel: new THREE.Vector3((Math.random() - 0.5) * 28, 6 + Math.random() * 22, (Math.random() - 0.5) * 28),
        rot: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9),
      });
    }
    this.scene.add(group);
    this.items.push({ kind: 'debris', obj: group, parts, age: 0, life: 3.2 });
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.age += dt;
      const k = it.age / it.life;
      if (it.kind === 'fw') {
        const attr = it.obj.geometry.attributes.position;
        for (let j = 0; j < it.vel.length; j++) {
          const vj = it.vel[j];
          vj.y -= 7 * dt;
          attr.setXYZ(j, attr.getX(j) + vj.x * dt, attr.getY(j) + vj.y * dt, attr.getZ(j) + vj.z * dt);
        }
        attr.needsUpdate = true;
        it.obj.material.opacity = Math.max(0, 1 - k);
      } else {
        for (const part of it.parts) {
          part.vel.y -= 30 * dt;
          part.mesh.position.addScaledVector(part.vel, dt);
          if (part.mesh.position.y < 0.3) {
            part.mesh.position.y = 0.3;
            part.vel.y *= -0.3;
            part.vel.x *= 0.7; part.vel.z *= 0.7;
          }
          part.mesh.rotation.x += part.rot.x * dt;
          part.mesh.rotation.y += part.rot.y * dt;
          part.mesh.rotation.z += part.rot.z * dt;
        }
      }
      if (it.age >= it.life) {
        this.scene.remove(it.obj);
        it.obj.traverse?.(o => { o.geometry?.dispose(); o.material?.dispose(); });
        if (it.kind === 'fw') { it.obj.geometry.dispose(); it.obj.material.dispose(); }
        this.items.splice(i, 1);
      }
    }
  }
}
