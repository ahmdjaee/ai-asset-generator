import * as THREE from 'three';

const DARK = { bg: '#18181B', g1: '#33333B', g2: '#25252B' };
const LIGHT = { bg: '#E6E6E9', g1: '#CBCBD2', g2: '#D9D9DE' };
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;
document.body.appendChild(renderer.domElement);

// ---------- environment (RoomEnvironment-like softboxes) ----------
function roomEnv() {
  const s = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(12, 10, 12), new THREE.MeshBasicMaterial({ color: 0x4a4a4a, side: THREE.BackSide }));
  room.position.y = 4; s.add(room);
  const box = (w, h, d, x, y, z, k) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k) }));
    m.position.set(x, y, z); s.add(m);
  };
  box(5, 0.2, 5, 0, 8.8, 0, 5);
  box(0.2, 3.5, 4, -5.8, 4, 0.5, 3.2);
  box(0.2, 2.5, 2.5, 5.8, 3.5, 1.5, 1.6);
  box(4, 2.5, 0.2, 0, 3.5, 5.8, 2.2);
  const pm = new THREE.PMREMGenerator(renderer);
  return pm.fromScene(s, 0.04).texture;
}
const ENV = roomEnv();

// ---------- procedural textures ----------
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function woodTexture({ base = [0.085, 0.52, 0.33], planks = 5, seed = 7, vertical = false } = {}) {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const g = c.getContext('2d'); const r = rng(seed);
  const ph = 1024 / planks;
  for (let i = 0; i < planks; i++) {
    const h = base[0] + (r() - 0.5) * 0.015, s = base[1] + (r() - 0.5) * 0.08, l = base[2] + (r() - 0.5) * 0.07;
    g.fillStyle = `hsl(${h * 360},${s * 100}%,${l * 100}%)`;
    g.fillRect(0, i * ph, 1024, ph);
    for (let k = 0; k < 70; k++) {
      const y = i * ph + r() * ph; const a = 0.05 + r() * 0.12;
      g.strokeStyle = `rgba(40,22,10,${a})`; g.lineWidth = 0.6 + r() * 2.2;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= 1024; x += 64) g.lineTo(x, y + Math.sin(x * 0.004 + r() * 6) * (2 + r() * 5));
      g.stroke();
    }
    if (r() > 0.4) { // knot
      const kx = r() * 1024, ky = i * ph + ph * (0.3 + r() * 0.4);
      for (let q = 6; q > 0; q--) { g.strokeStyle = `rgba(50,28,12,${0.12 + q * 0.03})`; g.lineWidth = 1.5; g.beginPath(); g.ellipse(kx, ky, q * 6, q * 2.5, 0, 0, Math.PI * 2); g.stroke(); }
    }
    g.fillStyle = 'rgba(25,14,6,0.85)'; g.fillRect(0, i * ph, 1024, 5);
    g.fillStyle = 'rgba(255,230,190,0.06)'; g.fillRect(0, i * ph + 5, 1024, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (vertical) { t.rotation = Math.PI / 2; t.center.set(0.5, 0.5); }
  return t;
}

// ---------- geometry helpers ----------
function roundedBox(w, h, d, r = 0.01, seg = 3) {
  const iw = w - 2 * r, ih = h - 2 * r, cr = Math.min(r * 0.8, iw / 4, ih / 4);
  const s = new THREE.Shape();
  s.moveTo(-iw / 2 + cr, -ih / 2); s.lineTo(iw / 2 - cr, -ih / 2); s.quadraticCurveTo(iw / 2, -ih / 2, iw / 2, -ih / 2 + cr);
  s.lineTo(iw / 2, ih / 2 - cr); s.quadraticCurveTo(iw / 2, ih / 2, iw / 2 - cr, ih / 2);
  s.lineTo(-iw / 2 + cr, ih / 2); s.quadraticCurveTo(-iw / 2, ih / 2, -iw / 2, ih / 2 - cr);
  s.lineTo(-iw / 2, -ih / 2 + cr); s.quadraticCurveTo(-iw / 2, -ih / 2, -iw / 2 + cr, -ih / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * r, bevelEnabled: true, bevelSize: r, bevelThickness: r, bevelSegments: seg, curveSegments: 3 });
  g.translate(0, 0, -(d - 2 * r) / 2); g.computeVertexNormals();
  return g;
}
const M = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; };

// ---------- materials ----------
function mats(kind) {
  if (kind === 'clay') {
    const clay = new THREE.MeshStandardMaterial({ color: '#B9B9BF', roughness: 0.78, metalness: 0 });
    return { wood: clay, woodLid: clay, woodLight: clay, iron: clay, brass: clay, dark: clay, leaf: clay, leaf2: clay, bark: clay, stone: clay, red: clay, cream: clay, glass: clay, flame: clay, steel: clay, leather: clay, paint: clay, emit: clay };
  }
  const wt = woodTexture({ seed: 7 }); wt.repeat.set(1.6, 1.6);
  const wl = woodTexture({ seed: 11, planks: 6 }); wl.repeat.set(1.4, 1.4);
  const wv = woodTexture({ seed: 3, base: [0.09, 0.45, 0.45] }); wv.repeat.set(1.2, 1.2);
  return {
    wood: new THREE.MeshStandardMaterial({ map: wt, roughness: 0.72 }),
    woodLid: new THREE.MeshStandardMaterial({ map: wl, roughness: 0.7 }),
    woodLight: new THREE.MeshStandardMaterial({ map: wv, roughness: 0.68 }),
    iron: new THREE.MeshStandardMaterial({ color: '#5A5A62', metalness: 0.8, roughness: 0.4 }),
    brass: new THREE.MeshStandardMaterial({ color: '#C9A24D', metalness: 1, roughness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.6 }),
    leaf: new THREE.MeshStandardMaterial({ color: '#5E8F4A', roughness: 0.85, flatShading: true }),
    leaf2: new THREE.MeshStandardMaterial({ color: '#4C7A3D', roughness: 0.85, flatShading: true }),
    bark: new THREE.MeshStandardMaterial({ color: '#6B4A33', roughness: 0.9, flatShading: true }),
    stone: new THREE.MeshStandardMaterial({ color: '#8A8A90', roughness: 0.92, flatShading: true }),
    red: new THREE.MeshStandardMaterial({ color: '#C2463A', roughness: 0.55 }),
    cream: new THREE.MeshStandardMaterial({ color: '#EEE3CF', roughness: 0.7 }),
    glass: new THREE.MeshStandardMaterial({ color: '#E8C98F', roughness: 0.1, metalness: 0, transparent: true, opacity: 0.28 }),
    flame: new THREE.MeshStandardMaterial({ color: '#FFB347', emissive: '#FF9A2E', emissiveIntensity: 2.2 }),
    steel: new THREE.MeshStandardMaterial({ color: '#E2E6EB', metalness: 0.75, roughness: 0.3 }),
    leather: new THREE.MeshStandardMaterial({ color: '#4A3022', roughness: 0.8 }),
    paint: new THREE.MeshStandardMaterial({ color: '#D8DCE2', roughness: 0.45, metalness: 0.2 }),
    emit: new THREE.MeshStandardMaterial({ color: '#7FB2FF', emissive: '#5B9BFF', emissiveIntensity: 1.6 }),
  };
}

// ---------- models ----------
function chest(m) {
  const g = new THREE.Group();
  g.add(M(roundedBox(0.62, 0.3, 0.4, 0.012), m.wood, 0, 0.17, 0));
  const lid = M(new THREE.CylinderGeometry(0.203, 0.203, 0.625, 40, 1, false, 0, Math.PI), m.woodLid, 0, 0.32, 0);
  lid.rotation.z = Math.PI / 2; g.add(lid);
  for (const x of [-0.2, 0.2]) {
    g.add(M(roundedBox(0.05, 0.31, 0.414, 0.004, 2), m.iron, x, 0.17, 0));
    const s = M(new THREE.CylinderGeometry(0.212, 0.212, 0.05, 40, 1, false, 0, Math.PI), m.iron, x, 0.32, 0); s.rotation.z = Math.PI / 2; g.add(s);
  }
  g.add(M(roundedBox(0.636, 0.04, 0.416, 0.006, 2), m.iron, 0, 0.02, 0));
  g.add(M(roundedBox(0.636, 0.026, 0.416, 0.006, 2), m.iron, 0, 0.312, 0));
  for (const x of [-0.3, 0.3]) for (const z of [-0.19, 0.19]) g.add(M(roundedBox(0.05, 0.07, 0.05, 0.006, 2), m.iron, x, 0.035, z));
  g.add(M(roundedBox(0.09, 0.11, 0.022, 0.006, 2), m.brass, 0, 0.285, 0.207));
  const kh = M(new THREE.CylinderGeometry(0.011, 0.011, 0.01, 16), m.dark, 0, 0.297, 0.219); kh.rotation.x = Math.PI / 2; g.add(kh);
  g.add(M(new THREE.BoxGeometry(0.008, 0.024, 0.01), m.dark, 0, 0.281, 0.219));
  for (const x of [-0.316, 0.316]) {
    const h = M(new THREE.TorusGeometry(0.045, 0.008, 8, 20, Math.PI), m.iron, x, 0.2, 0); h.rotation.set(Math.PI, Math.PI / 2, 0); g.add(h);
    g.add(M(roundedBox(0.012, 0.03, 0.12, 0.003, 1), m.iron, x, 0.205, 0));
  }
  return g;
}
function barrel(m) {
  const g = new THREE.Group(); const pts = [];
  for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push(new THREE.Vector2(0.21 + Math.sin(t * Math.PI) * 0.04, t * 0.62)); }
  const body = M(new THREE.LatheGeometry(pts, 28), m.woodLight); g.add(body);
  const top = M(new THREE.CylinderGeometry(0.205, 0.205, 0.012, 28), m.wood, 0, 0.61, 0); g.add(top);
  for (const t of [0.12, 0.38, 0.62, 0.88]) {
    const r = 0.21 + Math.sin(t * Math.PI) * 0.04 + 0.004;
    const hoop = M(new THREE.CylinderGeometry(r, r, 0.032, 28, 1, true), m.iron, 0, t * 0.62, 0); hoop.material = m.iron; g.add(hoop);
  }
  return g;
}
function lantern(m) {
  const g = new THREE.Group();
  g.add(M(roundedBox(0.2, 0.03, 0.2, 0.006), m.iron, 0, 0.015, 0));
  for (const x of [-0.085, 0.085]) for (const z of [-0.085, 0.085]) g.add(M(new THREE.BoxGeometry(0.014, 0.24, 0.014), m.iron, x, 0.15, z));
  g.add(M(new THREE.BoxGeometry(0.17, 0.22, 0.17), m.glass, 0, 0.14, 0));
  g.add(M(new THREE.CylinderGeometry(0.025, 0.025, 0.08, 16), m.cream, 0, 0.07, 0));
  g.add(M(new THREE.ConeGeometry(0.012, 0.035, 12), m.flame, 0, 0.13, 0));
  g.add(M(roundedBox(0.21, 0.025, 0.21, 0.006), m.iron, 0, 0.275, 0));
  const roof = M(new THREE.ConeGeometry(0.15, 0.1, 4), m.iron, 0, 0.335, 0); roof.rotation.y = Math.PI / 4; g.add(roof);
  const ring = M(new THREE.TorusGeometry(0.04, 0.007, 8, 24), m.iron, 0, 0.42, 0); g.add(ring);
  const light = new THREE.PointLight('#FFB25C', 0.6, 1.2); light.position.set(0, 0.14, 0); g.add(light);
  return g;
}
function chair(m) {
  const g = new THREE.Group();
  g.add(M(roundedBox(0.44, 0.04, 0.42, 0.008), m.woodLight, 0, 0.45, 0));
  for (const x of [-0.19, 0.19]) for (const z of [-0.18, 0.18]) g.add(M(roundedBox(0.04, 0.45, 0.04, 0.005), m.woodLight, x, 0.225, z));
  for (const x of [-0.19, 0.19]) g.add(M(roundedBox(0.04, 0.48, 0.04, 0.005), m.woodLight, x, 0.71, -0.18));
  for (const y of [0.6, 0.72, 0.84]) g.add(M(roundedBox(0.36, 0.05, 0.025, 0.005), m.woodLight, 0, y, -0.18));
  g.add(M(roundedBox(0.36, 0.025, 0.025, 0.004), m.woodLight, 0, 0.12, 0.18));
  return g;
}
function jitter(geo, amt, seed) {
  const r = rng(seed); const p = geo.attributes.position; const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    if (!map.has(k)) map.set(k, [(r() - 0.5) * amt, (r() - 0.5) * amt, (r() - 0.5) * amt]);
    const d = map.get(k); p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  geo.computeVertexNormals(); return geo;
}
function tree(m) {
  const g = new THREE.Group();
  g.add(M(new THREE.CylinderGeometry(0.05, 0.075, 0.42, 7), m.bark, 0, 0.21, 0));
  g.add(M(jitter(new THREE.IcosahedronGeometry(0.3, 1), 0.06, 3), m.leaf, 0, 0.6, 0));
  g.add(M(jitter(new THREE.IcosahedronGeometry(0.22, 1), 0.05, 5), m.leaf2, 0.14, 0.82, 0.05));
  g.add(M(jitter(new THREE.IcosahedronGeometry(0.18, 1), 0.04, 9), m.leaf, -0.13, 0.86, -0.04));
  return g;
}
function rocks(m) {
  const g = new THREE.Group();
  const a = M(jitter(new THREE.DodecahedronGeometry(0.22, 1), 0.07, 1), m.stone, 0, 0.16, 0); a.scale.set(1.2, 0.75, 1); g.add(a);
  const b = M(jitter(new THREE.DodecahedronGeometry(0.14, 1), 0.05, 2), m.stone, 0.26, 0.09, 0.08); b.scale.set(1, 0.7, 1.1); g.add(b);
  const c = M(jitter(new THREE.DodecahedronGeometry(0.1, 0), 0.04, 4), m.stone, -0.22, 0.06, 0.14); g.add(c);
  return g;
}
function mushroom(m) {
  const g = new THREE.Group(); const pts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(0.07 - t * 0.02 + Math.sin(t * 3) * 0.008, t * 0.3)); }
  g.add(M(new THREE.LatheGeometry(pts, 20), m.cream));
  const cap = M(new THREE.SphereGeometry(0.22, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), m.red, 0, 0.27, 0); cap.scale.set(1, 0.72, 1); g.add(cap);
  const r = rng(12);
  for (let i = 0; i < 9; i++) {
    const th = r() * Math.PI * 2, ph = 0.25 + r() * 0.9;
    const d = M(new THREE.SphereGeometry(0.03 + r() * 0.015, 12, 8), m.cream);
    d.position.set(Math.sin(ph) * Math.cos(th) * 0.215, 0.27 + Math.cos(ph) * 0.158, Math.sin(ph) * Math.sin(th) * 0.215);
    d.scale.set(1, 0.35, 1); d.lookAt(0, 0.1, 0); d.rotateX(Math.PI / 2); g.add(d);
  }
  return g;
}
function sword(m) {
  const g = new THREE.Group(); const s = new THREE.Shape();
  s.moveTo(-0.028, 0); s.lineTo(0.028, 0); s.lineTo(0.024, 0.52); s.lineTo(0, 0.6); s.lineTo(-0.024, 0.52); s.lineTo(-0.028, 0);
  const blade = M(new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.006, bevelSegments: 1 }), m.steel, 0, 0.2, -0.002);
  g.add(blade);
  g.add(M(roundedBox(0.2, 0.025, 0.04, 0.006), m.brass, 0, 0.19, 0));
  g.add(M(new THREE.CylinderGeometry(0.018, 0.018, 0.15, 12), m.leather, 0, 0.1, 0));
  g.add(M(new THREE.SphereGeometry(0.028, 16, 12), m.brass, 0, 0.02, 0));
  g.rotation.z = -0.25; g.position.x = 0.06;
  return g;
}
function crate(m) {
  const g = new THREE.Group();
  g.add(M(roundedBox(0.46, 0.46, 0.46, 0.01), m.woodLight, 0, 0.23, 0));
  for (const z of [-0.232, 0.232]) {
    for (const [x, y, w, h] of [[0, 0.025, 0.46, 0.05], [0, 0.435, 0.46, 0.05], [-0.205, 0.23, 0.05, 0.46], [0.205, 0.23, 0.05, 0.46]]) g.add(M(roundedBox(w, h, 0.02, 0.004), m.wood, x, y, z));
    const d = M(roundedBox(0.56, 0.05, 0.018, 0.004), m.wood, 0, 0.23, z); d.rotation.z = Math.PI / 4; g.add(d);
  }
  return g;
}
function canister(m) {
  const g = new THREE.Group();
  g.add(M(new THREE.CylinderGeometry(0.13, 0.13, 0.42, 32), m.paint, 0, 0.25, 0));
  g.add(M(new THREE.CylinderGeometry(0.14, 0.145, 0.05, 32), m.iron, 0, 0.025, 0));
  g.add(M(new THREE.CylinderGeometry(0.14, 0.14, 0.04, 32), m.iron, 0, 0.47, 0));
  g.add(M(new THREE.CylinderGeometry(0.06, 0.07, 0.05, 24), m.iron, 0, 0.515, 0));
  g.add(M(new THREE.CylinderGeometry(0.132, 0.132, 0.03, 32), m.emit, 0, 0.3, 0));
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; g.add(M(roundedBox(0.03, 0.36, 0.03, 0.004), m.iron, Math.cos(a) * 0.135, 0.25, Math.sin(a) * 0.135)); }
  return g;
}
const MODELS = { chest, barrel, lantern, chair, tree, rocks, mushroom, sword, crate, canister };

function triCount(obj) { let t = 0; obj.traverse(o => { if (o.isMesh) { const gg = o.geometry; t += (gg.index ? gg.index.count : gg.attributes.position.count) / 3; } }); return Math.round(t); }

// ---------- shot ----------
function shot({ model, kind = 'final', wire = false, w, h, bg = null, grid = null, offsetX = 0, dir = [0.9, 0.62, 1.2], margin = 1.18, fov = 30, over = null }) {
  renderer.setSize(w, h, false);
  const scene = new THREE.Scene();
  scene.environment = ENV; scene.environmentIntensity = kind === 'clay' ? 0.5 : 0.85;
  if (bg) { scene.background = new THREE.Color(bg); renderer.setClearColor(bg, 1); } else { scene.background = null; renderer.setClearColor(0x000000, 0); }
  const m = mats(kind);
  if (over) for (const [k, v] of Object.entries(over)) m[k] = new THREE.MeshStandardMaterial({ flatShading: !!m[k].flatShading, ...v });
  const obj = MODELS[model](m); scene.add(obj);
  if (wire) obj.traverse(o => { if (o.isMesh) { const l = new THREE.LineSegments(new THREE.WireframeGeometry(o.geometry), new THREE.LineBasicMaterial({ color: '#2A2A30', transparent: true, opacity: 0.55 })); o.add(l); } });
  const box = new THREE.Box3().setFromObject(obj); const sph = box.getBoundingSphere(new THREE.Sphere());
  const key = new THREE.DirectionalLight('#ffffff', kind === 'clay' ? 2.0 : 2.4);
  key.position.set(sph.center.x - 1.4, sph.center.y + 2.8, sph.center.z + 1.6); key.target.position.copy(sph.center);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera; sc.left = sc.bottom = -1.2; sc.right = sc.top = 1.2; sc.near = 0.1; sc.far = 8; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.01; key.shadow.radius = 10; key.shadow.blurSamples = 20;
  scene.add(key, key.target);
  scene.add(new THREE.HemisphereLight('#ffffff', '#3a3a40', kind === 'clay' ? 0.55 : 0.45));
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.ShadowMaterial({ opacity: bg && bg === LIGHT.bg ? 0.22 : 0.42 }));
  catcher.rotation.x = -Math.PI / 2; catcher.receiveShadow = true; scene.add(catcher);
  if (grid) {
    const c = document.createElement('canvas'); c.width = c.height = 4096; const g2d = c.getContext('2d');
    g2d.fillStyle = bg; g2d.fillRect(0, 0, 4096, 4096);
    const n = 50, step = 4096 / n;
    for (let i = 0; i <= n; i++) {
      const major = i % 5 === 0; g2d.strokeStyle = major ? grid.g1 : grid.g2; g2d.lineWidth = major ? 3.5 : 2.5;
      const p = Math.round(i * step);
      g2d.beginPath(); g2d.moveTo(p, 0); g2d.lineTo(p, 4096); g2d.stroke();
      g2d.beginPath(); g2d.moveTo(0, p); g2d.lineTo(4096, p); g2d.stroke();
    }
    const gt = new THREE.CanvasTexture(c); gt.colorSpace = THREE.SRGBColorSpace; gt.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const gp = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ map: gt, toneMapped: false, fog: true }));
    gp.rotation.x = -Math.PI / 2; gp.position.y = -0.0005; scene.add(gp);
    scene.fog = new THREE.Fog(bg, 2.2, 5.0);
  }
  const cam = new THREE.PerspectiveCamera(fov, w / h, 0.01, 100);
  const d = new THREE.Vector3(...dir).normalize();
  const dist = (sph.radius * margin) / Math.sin(THREE.MathUtils.degToRad(fov) / 2);
  cam.position.copy(sph.center).addScaledVector(d, dist);
  cam.lookAt(sph.center);
  if (offsetX) cam.setViewOffset(w, h, offsetX * w, 0, w, h);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  return { url, tris: triCount(obj), size: box.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(3)) };
}

window.renderAll = async (jobs) => {
  const out = [];
  for (const j of jobs) {
    const opts = { ...j, grid: j.grid === 'dark' ? DARK : j.grid === 'light' ? LIGHT : null, bg: j.bg === 'dark' ? DARK.bg : j.bg === 'light' ? LIGHT.bg : j.bg };
    const t0 = performance.now(); const r = shot(opts);
    out.push({ name: j.name, ...r, ms: Math.round(performance.now() - t0) });
    await new Promise(res => setTimeout(res, 0));
  }
  return out;
};
window.glInfo = () => { const gl = renderer.getContext(); const dbg = gl.getExtension('WEBGL_debug_renderer_info'); return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); };
window.ready = true;
