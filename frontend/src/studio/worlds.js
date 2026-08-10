/* Five procedural deep-space worlds. Each returns { group, update(t,dt), dispose } */
import * as THREE from 'three';

export const WORLDS = [
  { key: 'nebula-drift', name: 'NEBULA DRIFT', hotkey: '1' },
  { key: 'red-planet', name: 'RED PLANET', hotkey: '2' },
  { key: 'derelict-station', name: 'DERELICT STATION', hotkey: '3' },
  { key: 'asteroid-earth', name: 'EARTHVIEW', hotkey: '4' },
  { key: 'dying-star', name: 'DYING STAR', hotkey: '5' },
];

function radialTexture(inner, outer, size = 256) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

function noiseSphereTexture(base, spots, size = 512) {
  const c = document.createElement('canvas'); c.width = size; c.height = size / 2;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, size, size / 2);
  spots.forEach(({ color, n, rMax, alpha }) => {
    g.globalAlpha = alpha;
    g.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const x = Math.random() * size, y = Math.random() * size / 2, r = Math.random() * rMax + 2;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  });
  g.globalAlpha = 1;
  return new THREE.CanvasTexture(c);
}

function starfield(count = 2200, radius = 60) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(radius * (0.5 + Math.random() * 0.5));
    pos.set([v.x, v.y, v.z], i * 3);
    const w = 0.55 + Math.random() * 0.45;
    const tint = Math.random();
    col.set([w, w * (tint > 0.85 ? 0.75 : 1), w * (tint > 0.92 ? 0.7 : 1)], i * 3);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.12, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
}

function dustField(count, spread, color, size) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) pos.set([(Math.random() - 0.5) * spread, Math.random() * 3, (Math.random() - 0.5) * spread], i * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    color, size, transparent: true, opacity: 0.6, depthWrite: false,
    blending: THREE.AdditiveBlending, map: radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 64), alphaTest: 0.01,
  }));
  return pts;
}

function sprite(tex, scale, x, y, z, opacity = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(scale); s.position.set(x, y, z);
  return s;
}

export function buildWorld(scene, key) {
  const group = new THREE.Group();
  const updaters = [];
  const stars = starfield();
  group.add(stars);
  updaters.push((t) => { stars.rotation.y = t * 0.004; });
  let fogColor = 0x02020a;
  const lights = [];

  if (key === 'nebula-drift') {
    scene.background = new THREE.Color(0x030214);
    fogColor = 0x0a0620;
    const cols = [['rgba(120,40,180,0.55)', 'rgba(0,0,0,0)'], ['rgba(200,30,70,0.5)', 'rgba(0,0,0,0)'], ['rgba(30,120,200,0.45)', 'rgba(0,0,0,0)'], ['rgba(255,90,40,0.35)', 'rgba(0,0,0,0)']];
    const sprites = [];
    for (let i = 0; i < 9; i++) {
      const [a, b] = cols[i % cols.length];
      const sp = sprite(radialTexture(a, b), 14 + Math.random() * 22, (Math.random() - 0.5) * 34, Math.random() * 14 - 4, -16 - Math.random() * 22, 0.8);
      group.add(sp); sprites.push({ sp, ph: Math.random() * 9, spd: 0.1 + Math.random() * 0.2 });
    }
    updaters.push((t) => sprites.forEach(({ sp, ph, spd }) => { sp.position.x += Math.sin(t * 0.05 + ph) * 0.002; sp.material.opacity = 0.6 + 0.2 * Math.sin(t * spd + ph); }));
    const dust = dustField(300, 8, 0x8866ff, 0.02); dust.position.y = 0.5; group.add(dust);
    updaters.push((t) => { dust.rotation.y = t * 0.02; });
    lights.push(new THREE.PointLight(0x8844ff, 30, 40)); lights[0].position.set(-4, 4, -6);
  } else if (key === 'red-planet') {
    scene.background = new THREE.Color(0x1a0703);
    fogColor = 0x2a0d05;
    const ground = new THREE.Mesh(new THREE.SphereGeometry(40, 48, 32), new THREE.MeshStandardMaterial({ map: noiseSphereTexture('#5a1c0c', [{ color: '#7a2e14', n: 300, rMax: 14, alpha: 0.4 }, { color: '#3a1006', n: 200, rMax: 20, alpha: 0.35 }]), roughness: 1 }));
    ground.position.y = -40.1; group.add(ground);
    const sun = sprite(radialTexture('rgba(255,190,120,0.95)', 'rgba(255,120,40,0)'), 9, 8, 7, -30); group.add(sun);
    const haze = sprite(radialTexture('rgba(255,110,50,0.28)', 'rgba(0,0,0,0)'), 46, 0, 4, -34); group.add(haze);
    const dust = dustField(500, 12, 0xcc6633, 0.016); group.add(dust);
    updaters.push((t) => { dust.position.x = Math.sin(t * 0.1) * 1.4; dust.rotation.y = t * 0.03; });
    lights.push(new THREE.DirectionalLight(0xffbb88, 1.6)); lights[0].position.set(6, 6, -6);
  } else if (key === 'derelict-station') {
    scene.background = new THREE.Color(0x020306);
    fogColor = 0x050810;
    // cold nebula haze behind the wreck so the silhouettes read
    const haze1 = sprite(radialTexture('rgba(40,110,190,0.4)', 'rgba(0,0,0,0)'), 34, -6, 8, -32); group.add(haze1);
    const haze2 = sprite(radialTexture('rgba(90,180,230,0.3)', 'rgba(0,0,0,0)'), 24, 8, 2, -36); group.add(haze2);
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x2a3448, roughness: 0.5, metalness: 0.85 });
    for (let i = -2; i <= 2; i++) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(0.25, 12, 0.4), beamMat);
      beam.position.set(i * 2.6, 3, -5 - Math.abs(i) * 1.4);
      beam.rotation.z = i * 0.06; group.add(beam);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(12, 0.22, 0.35), beamMat);
      cross.position.set(0, 1.2 + i * 2.1, -5.6); group.add(cross);
      // emissive strip lights running along each cross-beam
      const strip = new THREE.Mesh(new THREE.BoxGeometry(11.6, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: 0x77d5ff }));
      strip.position.set(0, 1.34 + i * 2.1, -5.55); group.add(strip);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(9, 0.35, 8, 60), new THREE.MeshStandardMaterial({ color: 0x1c2534, roughness: 0.6, metalness: 0.9 }));
    ring.position.set(4, 5, -26); ring.rotation.x = 1.1; group.add(ring);
    updaters.push((t) => { ring.rotation.z = t * 0.03; });
    const flicker = new THREE.PointLight(0x66ddff, 34, 30); flicker.position.set(-3, 4, -2); group.add(flicker);
    updaters.push((t) => { flicker.intensity = (Math.sin(t * 17) > 0.94 || Math.sin(t * 7.3) > 0.98) ? 6 : 30 + Math.sin(t * 2) * 6; });
    const warn = new THREE.PointLight(0xff3322, 22, 18); warn.position.set(4, 2.5, -4); group.add(warn);
    updaters.push((t) => { warn.intensity = 12 + 12 * Math.max(0, Math.sin(t * 1.4)); });
    const dust = dustField(300, 9, 0x99bbcc, 0.016); group.add(dust);
    updaters.push((t) => { dust.rotation.y = t * 0.015; });
    lights.push(new THREE.DirectionalLight(0x5588bb, 0.7)); lights[0].position.set(-4, 8, 6);
  } else if (key === 'asteroid-earth') {
    scene.background = new THREE.Color(0x010208);
    fogColor = 0x030512;
    const rockGeo = new THREE.IcosahedronGeometry(3.2, 2);
    const rp = rockGeo.attributes.position;
    for (let i = 0; i < rp.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(rp, i);
      v.multiplyScalar(1 + (Math.random() - 0.5) * 0.25);
      rp.setXYZ(i, v.x, v.y, v.z);
    }
    rockGeo.computeVertexNormals();
    const rock = new THREE.Mesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x3d3a42, roughness: 1, flatShading: true }));
    rock.position.set(0, -3.15, 0); rock.scale.set(1.6, 1, 1.6); group.add(rock);
    const earth = new THREE.Mesh(new THREE.SphereGeometry(4.6, 48, 48), new THREE.MeshStandardMaterial({ map: noiseSphereTexture('#1a4d8f', [{ color: '#2d7a3a', n: 42, rMax: 34, alpha: 0.85 }, { color: '#c9d8e8', n: 90, rMax: 16, alpha: 0.5 }, { color: '#e8eef5', n: 40, rMax: 10, alpha: 0.6 }]), roughness: 0.8, emissive: 0x0a1e3a, emissiveIntensity: 0.5 }));
    earth.position.set(-2.4, 7.4, -20); group.add(earth);
    const atmo = sprite(radialTexture('rgba(90,160,255,0.55)', 'rgba(0,0,0,0)'), 13.5, -2.4, 7.4, -20.3); group.add(atmo);
    const moonGlow = sprite(radialTexture('rgba(200,215,240,0.5)', 'rgba(0,0,0,0)'), 4, 5.5, 12, -30); group.add(moonGlow);
    updaters.push((t) => { earth.rotation.y = t * 0.02; atmo.material.opacity = 0.85 + 0.15 * Math.sin(t * 0.5); });
    const dust = dustField(260, 10, 0x6699ff, 0.016); group.add(dust);
    updaters.push((t) => { dust.rotation.y = t * 0.018; });
    lights.push(new THREE.DirectionalLight(0xbfd7ff, 2.2)); lights[0].position.set(-4, 8, 4);
    lights.push(new THREE.PointLight(0x4477ff, 20, 30)); lights[1].position.set(-2, 6, -10);
  } else { // dying-star
    scene.background = new THREE.Color(0x0d0302);
    fogColor = 0x1a0503;
    const star = new THREE.Mesh(new THREE.SphereGeometry(7, 48, 48), new THREE.MeshBasicMaterial({ color: 0xff5a1e }));
    star.position.set(6, 6, -34); group.add(star);
    const corona = sprite(radialTexture('rgba(255,120,30,0.9)', 'rgba(120,10,0,0)'), 34, 6, 6, -34.5); group.add(corona);
    const flare = sprite(radialTexture('rgba(255,220,160,0.9)', 'rgba(0,0,0,0)'), 12, 6, 6, -33.8); group.add(flare);
    updaters.push((t) => {
      corona.scale.setScalar(34 + Math.sin(t * 0.7) * 2.5);
      flare.material.opacity = 0.55 + 0.35 * Math.sin(t * 1.3);
      star.scale.setScalar(1 + 0.015 * Math.sin(t * 0.9));
    });
    const embers = dustField(400, 14, 0xff7733, 0.02); group.add(embers);
    updaters.push((t, dt) => { embers.rotation.y = t * 0.04; embers.position.y = Math.sin(t * 0.3) * 0.4; });
    lights.push(new THREE.DirectionalLight(0xff7744, 2.4)); lights[0].position.set(6, 5, -8);
  }

  lights.forEach((l) => group.add(l));
  scene.fog = new THREE.FogExp2(fogColor, 0.016);
  scene.add(group);

  return {
    group,
    update(t, dt) { updaters.forEach((u) => u(t, dt)); },
    dispose() {
      scene.remove(group);
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      });
    },
  };
}
