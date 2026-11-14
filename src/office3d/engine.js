// Mamacos Voip — modo 3D (escritório). Gerado a partir de mamaco-3d/office/*.js
/* eslint-disable */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
// =====================================================================
// PERSONAGEM (mamaco) + CATÁLOGO DE SKINS
// =====================================================================
//
// Como adicionar uma skin nova (sem mexer no personagem):
//   1. Se precisar de uma peça nova (ex.: jaqueta, crachá, capa), registre
//      em PARTS:  PARTS.cracha = (m) => { ...monta um THREE.Group... }
//      Ela é montada uma vez por personagem, só quando alguém usar.
//   2. Registre a roupa:  registerOutfit('jaqueta', { label, sleeves, pants,
//      shoe, sole, bottom, parts: ['cracha', ...] })
//   3. Chapéus e acessórios do rosto funcionam igual: HATS / FACEWEAR.
// No app de verdade esse catálogo viria do banco (skins compradas, de
// evento, de time etc.) — o personagem só lê o catálogo.

const FACE = 0xf2c79b;
const EAR_IN = 0xe89a8f;

// Relevo fininho (pelo, tecido) feito em canvas — dá textura sem pesar.
function noiseTex(size, seed, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  draw(g, size, r);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const FUR_BUMP = noiseTex(128, 17, (g, n, r) => {
  g.fillStyle = '#808080'; g.fillRect(0, 0, n, n);
  for (let i = 0; i < 2600; i++) {
    const x = r() * n, y = r() * n, l = 2 + r() * 5;
    g.strokeStyle = `rgba(${r() < 0.5 ? 255 : 0},${r() < 0.5 ? 255 : 0},${r() < 0.5 ? 255 : 0},0.18)`;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 2, y + l); g.stroke();
  }
});
FUR_BUMP.repeat.set(3, 3);
const CLOTH_BUMP = noiseTex(64, 29, (g, n) => {
  g.fillStyle = '#808080'; g.fillRect(0, 0, n, n);
  g.fillStyle = 'rgba(255,255,255,0.22)';
  for (let y = 0; y < n; y += 2) g.fillRect(0, y, n, 1);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let x = 0; x < n; x += 2) g.fillRect(x, 0, 1, n);
});
CLOTH_BUMP.repeat.set(8, 8);
function mat(color, rough = 0.55, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
}
function mesh(geo, material, cast = true) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}
const SPH = (r, w = 20, h = 14) => new THREE.SphereGeometry(r, w, h);
const CAP = (r, l) => new THREE.CapsuleGeometry(r, l, 6, 14);
const damp = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const LEG_KEYS = new Set(['thighL', 'thighR', 'kneeL', 'kneeR', 'ankleL', 'ankleR', 'hipZL', 'hipZR']);
const HEAD_KEYS = new Set(['headYaw', 'headPitch', 'headRoll', 'tailYaw', 'tailPitch', 'earWig']);

class Spring {
  constructor(v = 0, stiff = 120, damping = 16) { this.v = v; this.vel = 0; this.k = stiff; this.c = damping; }
  step(target, dt) {
    this.vel += ((target - this.v) * this.k - this.vel * this.c) * dt;
    this.v += this.vel * dt;
    return this.v;
  }
}

// ---------- Peças de roupa (presas no tronco) ----------
const PARTS = {
  hood(m) {
    const g = new THREE.Group();
    const hood = mesh(SPH(0.22), m.top);
    hood.scale.set(1.2, 0.7, 0.8);
    hood.position.set(0, 0.56, -0.2);
    const rim = mesh(new THREE.TorusGeometry(0.19, 0.045, 8, 24), m.top);
    rim.rotation.x = Math.PI / 2 + 0.5;
    rim.position.set(0, 0.6, -0.08);
    g.add(hood, rim);
    return g;
  },
  pocket(m) {
    const p = mesh(SPH(0.16), m.top);
    p.scale.set(1.3, 0.55, 0.45);
    p.position.set(0, 0.14, 0.235);
    return p;
  },
  strings(m) {
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      const str = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6), m.shirtW);
      str.position.set(0.05 * s, 0.5, 0.26);
      str.rotation.x = -0.25;
      const tip = mesh(SPH(0.014, 8, 6), m.shirtW);
      tip.position.set(0.05 * s, 0.42, 0.28);
      g.add(str, tip);
    }
    return g;
  },
  collar(m) {
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      const c = mesh(new THREE.BoxGeometry(0.11, 0.025, 0.08), m.top);
      c.position.set(0.07 * s, 0.6, 0.15);
      c.rotation.set(0.5, 0.35 * s, -0.55 * s);
      g.add(c);
    }
    return g;
  },
  tie(m) {
    const g = new THREE.Group();
    const knot = mesh(SPH(0.032, 10, 8), m.tieM);
    knot.scale.set(1, 0.9, 0.7);
    knot.position.set(0, 0.565, 0.25);
    const blade = mesh(new THREE.ConeGeometry(0.05, 0.3, 4), m.tieM);
    blade.rotation.set(Math.PI + 0.35, Math.PI / 4, 0);
    blade.scale.set(1, 1, 0.35);
    blade.position.set(0, 0.42, 0.285);
    g.add(knot, blade);
    return g;
  },
  shirtFront(m) {
    const s = mesh(SPH(0.17), m.shirtW);
    s.scale.set(0.62, 1.05, 0.5);
    s.position.set(0, 0.42, 0.205);
    return s;
  },
  lapels(m) {
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      const l = mesh(new THREE.BoxGeometry(0.06, 0.26, 0.03), m.top);
      l.position.set(0.085 * s, 0.44, 0.245);
      l.rotation.set(-0.35, 0, 0.32 * s);
      g.add(l);
    }
    return g;
  },
  stripe(m) {
    const s = mesh(new THREE.TorusGeometry(0.295, 0.03, 8, 32), m.rgbM);
    s.rotation.x = Math.PI / 2;
    s.position.y = 0.32;
    s.scale.set(1, 0.88, 1);
    return s;
  },
  badge(m) {
    // crachá da empresa
    const g = new THREE.Group();
    const cord = mesh(new THREE.TorusGeometry(0.16, 0.008, 6, 24, Math.PI), m.tieM);
    cord.rotation.set(Math.PI / 2 + 0.6, 0, Math.PI);
    cord.position.set(0, 0.55, 0.12);
    const card = mesh(new THREE.BoxGeometry(0.08, 0.11, 0.01), m.shirtW);
    card.position.set(0, 0.36, 0.27);
    card.rotation.x = -0.2;
    g.add(cord, card);
    return g;
  },
};

// ---------- Roupas ----------
const OUTFITS = {};
function registerOutfit(id, def) {
  OUTFITS[id] = { sleeves: 'short', pants: 'shorts', shoe: '#f3efe9', sole: '#c9c2bb', bottom: null, parts: [], ...def };
}
registerOutfit('casual',    { label: 'Casual',    bottom: '#2f3e5c' });
registerOutfit('moletom',   { label: 'Moletom',   sleeves: 'long', pants: 'long', shoe: '#9aa0aa', sole: '#e9e5df', parts: ['hood', 'pocket', 'strings'] });
registerOutfit('social',    { label: 'Social',    sleeves: 'long', pants: 'long', shoe: '#2a211c', sole: '#18120f', bottom: '#2b2f3a', parts: ['collar', 'tie'], topDefault: '#f5f0e8' });
registerOutfit('executivo', { label: 'Executivo', sleeves: 'long', pants: 'long', shoe: '#1a1512', sole: '#0f0c0a', parts: ['lapels', 'shirtFront', 'tie'], topDefault: '#1f1b24' });
registerOutfit('gamer',     { label: 'Gamer',     shoe: '#ef4444', sole: '#f5f0e8', bottom: '#1d1a22', parts: ['stripe'], hat: 'capBack', rgb: true });
registerOutfit('cracha',    { label: 'Crachá',    sleeves: 'long', pants: 'long', shoe: '#3a332e', sole: '#1c1714', bottom: '#33384a', parts: ['collar', 'badge'], topDefault: '#9ec5ff' });
// Espaço pra próximas skins: registerOutfit('nova', { label: '...', parts: [...] })

// ---------- Chapéus (na cabeça; esconde o topete) ----------
const HATS = {
  cap(m, back = false) {
    const g = new THREE.Group();
    const dome = mesh(new THREE.SphereGeometry(0.385, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), m.capM);
    dome.position.y = 0.37;
    dome.scale.set(1.04, 0.85, 1.02);
    const brim = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.025, 24, 1, false, -Math.PI / 2, Math.PI), m.capM);
    brim.scale.set(1.25, 1, 1.15);
    brim.position.set(0, 0.39, 0.3);
    brim.rotation.x = 0.12;
    const button = mesh(SPH(0.03, 8, 6), m.capM);
    button.position.y = 0.71;
    g.add(dome, brim, button);
    if (back) g.rotation.y = Math.PI;
    return g;
  },
  capBack(m) { return HATS.cap(m, true); },
  beanie(m) {
    const g = new THREE.Group();
    const dome = mesh(new THREE.SphereGeometry(0.39, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), m.capM);
    dome.position.y = 0.38;
    dome.scale.set(1.03, 0.95, 1.02);
    const cuff = mesh(new THREE.TorusGeometry(0.385, 0.06, 10, 32), m.capM);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = 0.42;
    const pom = mesh(SPH(0.08, 12, 10), m.shirtW);
    pom.position.y = 0.76;
    g.add(dome, cuff, pom);
    return g;
  },
};
const HAT_LABELS = { cap: 'Boné', beanie: 'Gorro' };

// ---------- Rosto ----------
const FACEWEAR = {
  shades(m) {
    const g = new THREE.Group();
    const lensM = new THREE.MeshStandardMaterial({ color: 0x0b0b10, roughness: 0.15, metalness: 0.6 });
    for (const s of [-1, 1]) {
      const lens = mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.02, 20), lensM);
      lens.rotation.x = Math.PI / 2; lens.rotation.z = 0.18 * s;
      lens.scale.set(1, 1, 0.78);
      lens.position.set(0.1 * s, 0.37, 0.39);
      const arm = mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.3, 6), lensM);
      arm.rotation.x = Math.PI / 2;
      arm.position.set(0.19 * s, 0.38, 0.22);
      g.add(lens, arm);
    }
    const bridge = mesh(new THREE.BoxGeometry(0.06, 0.015, 0.015), lensM);
    bridge.position.set(0, 0.385, 0.405);
    g.add(bridge);
    return g;
  },
  glasses(m) {
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      const rim = mesh(new THREE.TorusGeometry(0.075, 0.012, 6, 24), m.glass);
      rim.position.set(0.1 * s, 0.37, 0.385);
      rim.rotation.y = 0.18 * s;
      const arm = mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.3, 6), m.glass);
      arm.rotation.x = Math.PI / 2;
      arm.position.set(0.19 * s, 0.38, 0.22);
      g.add(rim, arm);
    }
    const bridge = mesh(new THREE.TorusGeometry(0.03, 0.01, 6, 10, Math.PI), m.glass);
    bridge.position.set(0, 0.38, 0.4);
    g.add(bridge);
    return g;
  },
};

class Mamaco {
  constructor({ fur, top, name, outfit = 'casual', headset = true, glasses = false, hat = null, tie = '#c0392b', hatColor = '#1f1b24', style = 'classico' }) {
    this.name = name;
    this.style = style;
    // ajustes de proporção (o mamaco "fofo" é baixinho e cabeçudo)
    this.sitLift = 0.08; this.lieY = 0.27; this.stepScale = 1; this.armSpread = 0; this.waddle = 1;
    this.backY = 0.3; this.backZ = -0.27;
    this.fur = mat(fur, 0.68, { bumpMap: FUR_BUMP, bumpScale: 0.6 });
    this.top = mat(top, 0.62, { bumpMap: CLOTH_BUMP, bumpScale: 0.25 });
    this.bottom = mat(0x2f3e5c, 0.75, { bumpMap: CLOTH_BUMP, bumpScale: 0.25 });
    this.face = mat(FACE, 0.6);
    this.dark = mat(0x16111a, 0.3);
    this.white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.earIn = mat(EAR_IN, 0.7);
    this.gear = mat(0x1d1a22, 0.35);
    this.shoe = mat(0xf3efe9, 0.45);
    this.sole = mat(0xc9c2bb, 0.8);
    this.shirtW = mat(0xf5f0e8, 0.6);
    this.tieM = mat(tie, 0.45);
    this.capM = mat(hatColor, 0.6);
    this.glass = mat(0x15121a, 0.25);
    this.glow = new THREE.MeshStandardMaterial({ color: 0x34d399, emissive: 0x34d399, emissiveIntensity: 0, roughness: 0.4 });
    this.rgbM = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff3366, emissiveIntensity: 0, roughness: 0.4 });

    const root = (this.root = new THREE.Group());
    const rig = (this.rig = new THREE.Group());
    root.add(rig);
    this.H = 0.52;
    const hips = (this.hips = new THREE.Group());
    hips.position.y = this.H;
    rig.add(hips);
    const pelvis = (this.pelvis = new THREE.Group());
    hips.add(pelvis);
    const shorts = mesh(SPH(0.24), this.bottom);
    shorts.scale.set(1.18, 0.62, 0.95);
    shorts.position.y = 0.03;
    pelvis.add(shorts);

    this.legs = [-1, 1].map((side) => {
      const hip = new THREE.Group();
      hip.position.set(0.14 * side, 0, 0);
      const thigh = mesh(CAP(0.095, 0.1), this.bottom);
      thigh.position.y = -0.1;
      const knee = new THREE.Group();
      knee.position.y = -0.2;
      const shin = mesh(CAP(0.083, 0.1), this.fur);
      shin.position.y = -0.1;
      const ankle = new THREE.Group();
      ankle.position.y = -0.2;
      const shoe = mesh(SPH(0.115), this.shoe);
      shoe.scale.set(0.95, 0.55, 1.5);
      shoe.position.set(0, -0.035, 0.055);
      const sole = mesh(SPH(0.118, 16, 8), this.sole);
      sole.scale.set(1, 0.22, 1.55);
      sole.position.set(0, -0.078, 0.055);
      ankle.add(shoe, sole);
      knee.add(shin, ankle);
      hip.add(thigh, knee);
      pelvis.add(hip);
      return { hip, knee, ankle, thigh, shin };
    });

    const torso = (this.torso = new THREE.Group());
    hips.add(torso);
    const body = mesh(CAP(0.3, 0.18), this.top);
    body.position.y = 0.27;
    body.scale.set(1, 1, 0.88);
    this.body = body;
    const collar = mesh(new THREE.TorusGeometry(0.17, 0.035, 8, 24), this.top);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.6;
    torso.add(body, collar);
    this.parts = {};

    this.arms = [-1, 1].map((side) => {
      const shoulder = new THREE.Group();
      shoulder.position.set(0.31 * side, 0.5, 0);
      const sleeve = mesh(SPH(0.1, 16, 12), this.top);
      const upper = mesh(CAP(0.072, 0.12), this.fur);
      upper.position.y = -0.1;
      const elbow = new THREE.Group();
      elbow.position.y = -0.2;
      const fore = mesh(CAP(0.067, 0.1), this.fur);
      fore.position.y = -0.09;
      const hand = mesh(SPH(0.085, 16, 12), this.face);
      hand.scale.set(1, 1.05, 0.85);
      hand.position.y = -0.21;
      elbow.add(fore, hand);
      shoulder.add(sleeve, upper, elbow);
      torso.add(shoulder);
      return { shoulder, elbow, upper, fore, sleeve, hand };
    });
    // caneca de café (aparece quando pega café)
    const mug = (this.mug = new THREE.Group());
    const mugM = new THREE.MeshStandardMaterial({ color: 0xf5f0e8, roughness: 0.4 });
    const cup = mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.15, 16), mugM);
    const coffee = mesh(new THREE.CircleGeometry(0.062, 16), new THREE.MeshStandardMaterial({ color: 0x3b2314, roughness: 0.3 }), false);
    coffee.rotation.x = -Math.PI / 2; coffee.position.y = 0.068;
    const handle = mesh(new THREE.TorusGeometry(0.035, 0.012, 6, 12), mugM, false);
    handle.position.set(0.075, 0, 0); handle.rotation.y = Math.PI / 2;
    const mugBand = mesh(new THREE.CylinderGeometry(0.071, 0.071, 0.03, 16), new THREE.MeshStandardMaterial({ color: 0xf4511e, roughness: 0.5 }), false);
    mug.add(cup, coffee, handle, mugBand);
    // latinha de energético (mesma mão, troca com a caneca)
    const can = (this.can = new THREE.Group());
    const canBody = mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.17, 16), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.35, metalness: 0.6 }));
    const canTop = mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.02, 16), new THREE.MeshStandardMaterial({ color: 0xc9ccd1, roughness: 0.3, metalness: 0.8 }), false);
    canTop.position.y = 0.095;
    const canBolt = mesh(new THREE.CylinderGeometry(0.0565, 0.0565, 0.06, 16), new THREE.MeshStandardMaterial({ color: 0x7cff3a, roughness: 0.4, emissive: 0x2a7a00, emissiveIntensity: 0.6 }), false);
    can.add(canBody, canTop, canBolt);
    can.visible = false;
    mug.add(can);
    mug.position.set(0, -0.23, 0.07);
    mug.visible = false;
    this.arms[0].elbow.add(mug);

    const neck = (this.neck = new THREE.Group());
    neck.position.y = 0.6;
    torso.add(neck);
    const head = (this.head = new THREE.Group());
    neck.add(head);
    const skull = mesh(SPH(0.37, 24, 16), this.fur);
    skull.position.y = 0.31;
    skull.scale.set(1.04, 0.96, 0.98);
    head.add(skull);
    for (const side of [-1, 1]) {
      const m = mesh(SPH(0.155), this.face);
      m.position.set(0.1 * side, 0.36, 0.215);
      m.scale.set(1, 1.08, 0.62);
      head.add(m);
    }
    const muzzle = mesh(SPH(0.19), this.face);
    muzzle.position.set(0, 0.2, 0.25);
    muzzle.scale.set(1.18, 0.82, 0.72);
    head.add(muzzle);
    this.eyes = [-1, 1].map((side) => {
      const eye = new THREE.Group();
      eye.position.set(0.1 * side, 0.37, 0.33);
      const ball = mesh(SPH(0.056, 14, 10), this.dark, false);
      const pupil = new THREE.Group();
      const spark = new THREE.Mesh(SPH(0.018, 8, 6), this.white);
      spark.position.set(0.018, 0.022, 0.045);
      pupil.add(spark);
      eye.add(ball, pupil);
      eye.userData.pupil = pupil;
      head.add(eye);
      return eye;
    });
    this.brows = [-1, 1].map((side) => {
      const b = mesh(CAP(0.016, 0.07), this.dark, false);
      b.rotation.z = Math.PI / 2 - 0.22 * side;
      b.position.set(0.1 * side, 0.46, 0.325);
      head.add(b);
      return b;
    });
    for (const side of [-1, 1]) {
      const n = mesh(SPH(0.016, 8, 6), this.dark, false);
      n.position.set(0.035 * side, 0.245, 0.39);
      n.scale.set(1.2, 0.8, 0.6);
      head.add(n);
    }
    const smile = mesh(new THREE.TorusGeometry(0.065, 0.013, 6, 18, Math.PI), this.dark, false);
    smile.rotation.set(-0.35, 0, Math.PI);
    smile.position.set(0, 0.17, 0.37);
    head.add(smile);
    this.smile = smile;
    const mouth = mesh(SPH(0.05, 12, 8), this.dark, false);
    mouth.scale.set(1.2, 0.01, 0.5);
    mouth.position.set(0, 0.165, 0.365);
    mouth.visible = false;
    head.add(mouth);
    this.mouth = mouth;
    this.ears = [-1, 1].map((side) => {
      const ear = new THREE.Group();
      ear.position.set(0.37 * side, 0.32, -0.02);
      const outer = mesh(SPH(0.12, 16, 12), this.fur);
      outer.scale.set(0.42, 1, 1);
      const inner = mesh(SPH(0.075, 12, 10), this.earIn, false);
      inner.scale.set(0.3, 1, 1);
      inner.position.x = 0.025 * side;
      ear.add(outer, inner);
      head.add(ear);
      return ear;
    });
    const tuft = (this.tuft = new THREE.Group());
    tuft.position.set(0, 0.66, 0.02);
    [[-0.05, -0.35, 0.09], [0.02, 0.05, 0.12], [0.08, 0.4, 0.085]].forEach(([x, rz, h]) => {
      const c = mesh(new THREE.ConeGeometry(0.045, h, 10), this.fur);
      c.position.set(x, h / 2 - 0.02, 0);
      c.rotation.z = rz;
      tuft.add(c);
    });
    head.add(tuft);

    const hs = (this.headset = new THREE.Group());
    const band = mesh(new THREE.TorusGeometry(0.385, 0.03, 8, 32, Math.PI), this.gear);
    band.position.y = 0.31;
    this.band = band;
    hs.add(band);
    for (const side of [-1, 1]) {
      const cup = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 20), this.gear);
      cup.rotation.z = Math.PI / 2;
      cup.position.set(0.39 * side, 0.31, 0);
      const pad = mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.02, 18), this.rgbM, false);
      pad.rotation.z = Math.PI / 2;
      pad.position.set(0.435 * side, 0.31, 0);
      hs.add(cup, pad);
    }
    const boom = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.4, 0.27, 0.04), new THREE.Vector3(0.36, 0.18, 0.22),
      new THREE.Vector3(0.2, 0.14, 0.36), new THREE.Vector3(0.11, 0.14, 0.4),
    ]);
    hs.add(mesh(new THREE.TubeGeometry(boom, 14, 0.014, 6), this.gear, false));
    const tip = mesh(SPH(0.032, 10, 8), this.glow, false);
    tip.position.set(0.17, 0.1, 0.38);
    hs.add(tip);
    head.add(hs);
    this.hats = {};
    this.faces = {};

    const tailPivot = (this.tail = new THREE.Group());
    tailPivot.position.set(0, 0.06, -0.22);
    const tc = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -0.04, -0.2), new THREE.Vector3(0, 0.08, -0.38),
      new THREE.Vector3(0, 0.3, -0.42), new THREE.Vector3(0, 0.42, -0.3), new THREE.Vector3(0, 0.36, -0.2),
    ]);
    tailPivot.add(mesh(new THREE.TubeGeometry(tc, 28, 0.04, 8), this.fur));
    const tailEnd = mesh(SPH(0.04, 10, 8), this.fur);
    tailEnd.position.set(0, 0.36, -0.2);
    tailPivot.add(tailEnd);
    hips.add(tailPivot);

    this.pose = {};
    this.phase = Math.random() * 6;
    this.gaitW = 0; this.runW = 0;
    this.lean = new Spring(0, 90, 11);
    this.bank = new Spring(0, 70, 10);
    this.crouch = new Spring(0, 260, 20);
    this.squash = 0; this.squashV = 0;
    this.blinkT = 2 + Math.random() * 3; this.blink = 0;
    this.lookT = 0; this.lookYaw = 0; this.lookPitch = 0;
    this.weightT = 2 + Math.random() * 3; this.weightSide = 1; this.weight = 0;
    this.talking = false; this.waveT = 0; this.dancing = false;
    this.sitting = false; this.seatH = 0.22; this.typing = false;
    this.mood = 'normal'; // 'normal' | 'rest' (descansando, com sono) | 'sleep' (dormindo)
    this.lie = 0;
    this.lying = false;   // deitado (cama, sofá, rede)
    this.sitK = 0;        // 0 = em pé, 1 = sentado/deitado (transição suave)
    this.sway = false;    // balança (rede)
    this.yawnT = 4 + Math.random() * 8; this.yawn = 0;
    this.drinkT = 0;      // segurando café (segundos)
    this.guard = false;   // segurança: braços cruzados
    this.state = { outfit, headset, glasses, hat };
    this.expr = 'normal'; this.exprT = 0;
    if (style === 'fofo') { buildFofo(this); this.state.headset = headset && false; }
    this.setOutfit(outfit, { keepHat: !!hat });
    this.applyAccessories();
  }

  setFur(c) { this.fur.color.set(c); }
  setTop(c) { this.top.color.set(c); this.syncBottom(); }

  setOutfit(id, { keepHat = false } = {}) {
    if (this.fofo) { setFofoSkin(this, id); return; }
    const o = OUTFITS[id] || OUTFITS.casual;
    const prev = OUTFITS[this.state.outfit];
    this.state.outfit = id;
    for (const pid of o.parts) {
      if (!this.parts[pid] && PARTS[pid]) {
        this.parts[pid] = PARTS[pid](this);
        this.torso.add(this.parts[pid]);
      }
    }
    for (const pid in this.parts) this.parts[pid].visible = o.parts.includes(pid);
    const long = o.sleeves === 'long';
    for (const a of this.arms) {
      a.upper.material = long ? this.top : this.fur;
      a.fore.material = long ? this.top : this.fur;
      a.sleeve.scale.setScalar(long ? 0.9 : 1);
    }
    this.bottomColor = o.bottom;
    for (const l of this.legs) l.shin.material = o.pants === 'long' ? this.bottom : this.fur;
    this.shoe.color.set(o.shoe);
    this.sole.color.set(o.sole);
    this.rgb = !!o.rgb;
    if (!keepHat) {
      if (o.hat) this.state.hat = o.hat;
      else if (prev && prev.hat && this.state.hat === prev.hat) this.state.hat = null;
    }
    this.syncBottom();
    this.applyAccessories();
  }
  syncBottom() {
    if (this.bottomColor) this.bottom.color.set(this.bottomColor);
    else this.bottom.color.copy(this.top.color).multiplyScalar(this.state.outfit === 'moletom' ? 0.85 : 1);
  }
  setAccessory(name, on) {
    if (name === 'headset') this.state.headset = on;
    else if (name in FACEWEAR) this.state[name] = on;
    else if (name in HATS) this.state.hat = on ? name : null;
    else if (name in BACKWEAR) this.state.back = on ? name : null;
    this.applyAccessories();
  }
  applyAccessories() {
    const s = this.state;
    this.headset.visible = s.headset;
    for (const id in FACEWEAR) {
      if (s[id] && !this.faces[id]) {
        this.faces[id] = FACEWEAR[id](this);
        if (this.fofo) this.faces[id].position.set(0, -0.035, 0.035); // rosto do mamaco novo é mais saliente
        this.head.add(this.faces[id]);
      }
      if (this.faces[id]) this.faces[id].visible = !!s[id];
    }
    if (s.hat && !this.hats[s.hat] && HATS[s.hat]) { this.hats[s.hat] = HATS[s.hat](this); this.head.add(this.hats[s.hat]); }
    for (const id in this.hats) this.hats[id].visible = s.hat === id;
    this.tuft.visible = !s.hat && !this.coversHead;
    this.backs ||= {};
    if (s.back && !this.backs[s.back] && BACKWEAR[s.back]) { this.backs[s.back] = BACKWEAR[s.back](this); this.torso.add(this.backs[s.back]); }
    for (const id in this.backs) this.backs[id].visible = s.back === id;
    this.band.scale.setScalar(s.hat ? 1.07 : 1);
    this.ears.forEach((e) => e.scale.setScalar(s.headset ? 0.75 : 1));
  }

  wave() { this.waveT = 2.4; }
  anticipate() { this.crouch.vel += 6; }
  land(impact) { this.crouch.vel += impact * 30; this.squash = Math.min(0.2, impact * 0.6); }

  update(dt, t, st = {}) {
    if (this.fofo) return rpgUpdate(this, dt, t, st);
    const { speed = 0, air = false, vy = 0, turn = 0, accel = 0 } = st;
    const P = {};
    const moving = speed > 0.06 && !air;
    // sentar/deitar: desce devagar (inclina pra frente, dobra os joelhos) e
    // levanta empurrando o corpo — nada de "teletransportar" pro assento
    const down = (this.sitting || this.lying) && !air;
    this.sitK = damp(this.sitK, down ? 1 : 0, down ? 3.6 : 4.8, dt);
    const se = smooth(this.sitK);
    // Peso da marcha: sobe rápido ao arrancar e cai suave ao parar (sem "deslizar")
    this.gaitW = damp(this.gaitW, clamp(speed / 1.2, 0, 1), moving ? 9 : 6, dt);
    this.runW = damp(this.runW, clamp((speed - 3.6) / 2.2, 0, 1), 5, dt);
    const g = this.gaitW, r = this.runW;
    const walkK = clamp(speed / 3.0, 0, 1);
    // Passo mais longo quanto mais rápido (como gente: não só mais rápido, mais comprido)
    const step = (0.3 + 0.2 * walkK + 0.32 * r) * this.stepScale;
    if (!air) this.phase += dt * Math.PI * Math.max(speed, 0) / step;
    // Virando parado: dá passinhos no lugar em vez de girar deslizando
    const turnStep = speed < 0.5 ? clamp(Math.abs(turn) / 3, 0, 1) : 0;
    if (!air && turnStep > 0.05) this.phase += dt * 9 * turnStep;
    this.turnStepW = damp(this.turnStepW || 0, turnStep, 10, dt);
    const ph = this.phase;
    const sL = Math.sin(ph), cL = Math.cos(ph);

    const A = (0.22 + 0.3 * walkK + 0.3 * r) * g + 0.18 * this.turnStepW;
    const leg = (p) => {
      const s = Math.sin(p), c = Math.cos(p);
      const thigh = -A * s - 0.12 * r * g;
      // joelho: dobra no balanço (perna indo pra frente) e um tico ao pisar (amortece)
      const swing = smooth(c * 1.2 + 0.1);
      const contact = smooth(1 - Math.abs(s) * 3) * (c < 0 ? 1 : 0);
      const gg = Math.max(g, this.turnStepW);
      const knee = (0.06 + (0.5 + 0.25 * walkK) * swing + 1.0 * r * swing + 0.12 * r + 0.12 * contact * walkK) * gg;
      // pé: calcanhar toca primeiro, depois rola até a ponta e empurra
      const heel = smooth(c * 2 - 1.2) * (s > 0 ? 1 : 0);
      const toeOff = smooth(-c * 1.4 - 0.3) * (s < 0 ? 1 : 0);
      const ankle = -(thigh + knee) * 0.9 + (0.4 * toeOff - 0.18 * heel) * gg - 0.12 * swing * gg;
      return { thigh, knee, ankle };
    };
    const lL = leg(ph), lR = leg(ph + Math.PI);
    P.thighL = lL.thigh; P.kneeL = lL.knee; P.ankleL = lL.ankle;
    P.thighR = lR.thigh; P.kneeR = lR.knee; P.ankleR = lR.ankle;
    P.hipZL = 0.02; P.hipZR = -0.02;
    const s2 = sL * sL;
    // quadril: desce um pouco no passo aberto (andando) / sobe no voo (correndo)
    P.hipsY = this.H - (0.01 + 0.03 * r) * g - (0.018 + 0.012 * walkK) * s2 * g * (1 - r) + 0.05 * s2 * r * g;
    P.hipsX = -0.022 * cL * g * (1 - 0.6 * r) * this.waddle;
    P.pelvisYaw = (0.1 + 0.08 * walkK) * sL * g;
    P.pelvisRoll = 0.05 * cL * g * (1 - 0.5 * r) * this.waddle;
    P.torsoYaw = -(0.12 + 0.1 * walkK) * sL * g - P.pelvisYaw * 0.6;
    P.torsoRoll = -P.pelvisRoll * 0.6;
    // braços: atrasados um tico em relação às pernas (balanço solto, não robótico)
    const B = (0.25 + 0.25 * walkK + 0.45 * r) * g;
    const aph = ph - 0.35;
    const sA = Math.sin(aph);
    P.shL = B * sA; P.shR = -B * sA;
    P.shZL = 0.14 + 0.1 * r + 0.03 * g * Math.max(0, -sA); P.shZR = -0.14 - 0.1 * r - 0.03 * g * Math.max(0, sA);
    // antebraço "chicoteia" depois do ombro (atraso maior)
    const fL = Math.max(0, Math.sin(aph - 0.9)), fR = Math.max(0, -Math.sin(aph - 0.9));
    P.elL = -(0.22 * g + 1.15 * r + (0.28 + 0.25 * r) * fL * g);
    P.elR = -(0.22 * g + 1.15 * r + (0.28 + 0.25 * r) * fR * g);
    P.elZR = 0;

    const idle = 1 - g;
    this.weightT -= dt;
    if (this.weightT <= 0) { this.weightT = 3 + Math.random() * 4; this.weightSide *= -1; }
    this.weight = damp(this.weight, this.weightSide * idle * (this.sitting ? 0 : 1), 2.2, dt);
    const w = this.weight;
    P.hipsX += 0.035 * w;
    P.pelvisRoll += -0.06 * w;
    P.torsoRoll += 0.045 * w;
    P.kneeL += Math.max(0, -w) * 0.28; P.thighL -= Math.max(0, -w) * 0.1; P.ankleL -= Math.max(0, -w) * 0.12;
    P.kneeR += Math.max(0, w) * 0.28; P.thighR -= Math.max(0, w) * 0.1; P.ankleR -= Math.max(0, w) * 0.12;
    P.breathe = Math.sin(t * 2.0) * 0.012 * (0.4 + idle);
    P.shZL += Math.sin(t * 2.0) * 0.02 * idle; P.shZR -= Math.sin(t * 2.0) * 0.02 * idle;
    P.elL -= 0.12 * idle; P.elR -= 0.12 * idle;

    this.lookT -= dt;
    if (this.lookT <= 0) {
      this.lookT = 1.4 + Math.random() * 3;
      this.lookYaw = Math.random() < 0.4 ? 0 : (Math.random() - 0.5) * 1.1;
      this.lookPitch = (Math.random() - 0.5) * 0.25;
    }
    const leanT = 0.04 * g + 0.22 * r + clamp(accel * 0.035, -0.18, 0.16);
    const transit = Math.sin(Math.PI * se) * (this.lying ? 0.25 : 0.5);
    const lean = this.lean.step(this.lying ? transit * (1 - this.lie) : this.sitting ? -0.06 * se + transit : leanT + transit, dt);
    const bank = this.bank.step(clamp(-turn * speed * 0.05, -0.3, 0.3), dt);
    P.headYaw = this.lookYaw * idle + clamp(turn * 0.12, -0.45, 0.45) - P.torsoYaw * 0.8 - P.pelvisYaw * 0.5;
    P.headPitch = -lean * 0.7 + this.lookPitch * idle + Math.abs(cL) * 0.035 * g * (1 - r);
    P.headRoll = -(P.torsoRoll + P.pelvisRoll + bank) * 0.6;
    P.tailYaw = Math.sin(t * 1.5) * 0.3 * idle + sL * 0.3 * g;
    P.tailPitch = -0.3 * r + Math.sin(t * 1.1) * 0.08 - lean * 0.5;
    P.earWig = 0; P.brow = 0; P.mouth = 0;

    if (this.dancing && !moving && !air) {
      const b = t * 6.5, sb = Math.sin(b);
      P.hipsY = this.H - 0.05 - Math.abs(sb) * 0.05;
      P.hipsX = sb * 0.05;
      P.pelvisRoll = sb * 0.14; P.pelvisYaw = Math.sin(b * 0.5) * 0.25;
      P.torsoRoll = -sb * 0.1; P.torsoYaw = -Math.sin(b * 0.5) * 0.35;
      P.kneeL = 0.35 + Math.max(0, sb) * 0.35; P.kneeR = 0.35 + Math.max(0, -sb) * 0.35;
      P.thighL = -0.2 - Math.max(0, sb) * 0.2; P.thighR = -0.2 - Math.max(0, -sb) * 0.2;
      P.ankleL = -(P.thighL + P.kneeL); P.ankleR = -(P.thighR + P.kneeR);
      P.shL = -0.6 + Math.sin(b + 1) * 0.5; P.shR = -0.6 - Math.sin(b + 1) * 0.5;
      P.shZL = 0.9 + sb * 0.3; P.shZR = -0.9 + sb * 0.3;
      P.elL = -1.3; P.elR = -1.3;
      P.headRoll = -sb * 0.15; P.headYaw = Math.sin(b * 0.5) * 0.3; P.headPitch = Math.abs(sb) * 0.1;
      P.tailYaw = sb * 0.6;
    }

    if (se > 0.001) {
      const S = {};
      if (this.lying) {
        // deitado de barriga pra cima (o corpo todo gira — ver this.lie)
        Object.assign(S, {
          hipsY: this.H, hipsX: 0, thighL: 0.05, thighR: -0.05, kneeL: 0.12, kneeR: 0.3, ankleL: 0.55, ankleR: 0.5,
          hipZL: 0.06, hipZR: -0.06, pelvisRoll: 0, pelvisYaw: 0, torsoRoll: 0, torsoYaw: 0,
          shL: -0.25, shR: -0.25, shZL: 0.35, shZR: -0.35, elL: -1.2, elR: -1.2,
          headPitch: 0.05, headYaw: 0.25, headRoll: 0.1, breathe: Math.sin(t * 1.1) * 0.035, tailYaw: 0, tailPitch: 0.3,
        });
        if (this.mood === 'rest') {
          // cochilando no sofá/rede: uma perna dobrada, mãos atrás da cabeça
          Object.assign(S, { kneeR: 0.9, thighR: -0.45, ankleR: 0.2, shL: -2.6, shR: -2.6, shZL: 0.5, shZR: -0.5, elL: -2.2, elR: -2.2, headYaw: 0.15 + Math.sin(t * 0.4) * 0.05, breathe: Math.sin(t * 1.3) * 0.03 });
        }
      } else {
        // seatH = altura do assento; pernas penduradas se a cadeira for alta
        const hang = clamp((this.seatH - 0.25) / 0.4, 0, 1);
        Object.assign(S, {
          hipsY: this.seatH + this.sitLift, hipsX: 0, thighL: -1.5, thighR: -1.5,
          kneeL: 1.5 - 0.25 * hang + Math.sin(t * 1.3) * 0.08 * hang, kneeR: 1.5 - 0.25 * hang - Math.sin(t * 1.3 + 1) * 0.08 * hang,
          ankleL: 0, ankleR: 0, hipZL: 0.08, hipZR: -0.08, pelvisRoll: 0, pelvisYaw: 0, torsoRoll: 0, torsoYaw: 0,
          shL: -0.42, shR: -0.42, shZL: 0.2, shZR: -0.2, elL: -0.75, elR: -0.75, breathe: P.breathe * 1.4,
        });
        if (this.typing) {
          Object.assign(S, {
            shL: -0.95 + Math.sin(t * 15) * 0.05, shR: -0.95 + Math.sin(t * 13 + 2) * 0.05, shZL: 0.22, shZR: -0.22,
            elL: -0.75 + Math.sin(t * 17) * 0.1, elR: -0.75 + Math.sin(t * 14 + 1) * 0.1,
            headPitch: 0.12 + this.lookPitch * 0.3, headYaw: this.lookYaw * 0.25,
          });
        } else {
          // sentado à toa: troca de posição de vez em quando, olha em volta
          const fidget = Math.sin(t * 0.37) > 0.6 ? 1 : 0;
          S.kneeL += fidget * 0.25; S.thighL += fidget * 0.12;
          S.headYaw = this.lookYaw * 0.6; S.headPitch = this.lookPitch * 0.6;
        }
        if (this.mood === 'rest') {
          // largado no pufe/poltrona: encosta, estica as pernas, mãos na barriga
          Object.assign(S, { thighL: -1.25, thighR: -1.15, kneeL: 0.75, kneeR: 0.9, ankleL: 0.25, ankleR: 0.2, shL: -0.35, shR: -0.35, shZL: 0.3, shZR: -0.3, elL: -1.35, elR: -1.35, headPitch: -0.12 + Math.sin(t * 0.6) * 0.03, headRoll: 0.22, headYaw: 0.1, breathe: Math.sin(t * 1.2) * 0.02 });
        }
      }
      // meio do caminho (sentando/levantando): mãos vão pros joelhos
      const mid = Math.sin(Math.PI * se) * (this.lying ? 0 : 1);
      for (const k in S) P[k] = P[k] + (S[k] - P[k]) * se;
      P.shL -= 0.35 * mid; P.shR -= 0.35 * mid; P.elL -= 0.3 * mid; P.elR -= 0.3 * mid;
      P.kneeL += 0.25 * mid; P.kneeR += 0.25 * mid;
    }

    if (this.guard && !moving) {
      // segurança: braços cruzados, firme, olhando o movimento
      Object.assign(P, { shL: -0.85, shR: -0.8, shZL: -0.42, shZR: 0.42, elL: -1.95, elR: -2.05, elZR: 0, hipsX: 0 });
      P.thighL = -0.02; P.thighR = -0.02; P.hipZL = 0.09; P.hipZR = -0.09; P.kneeL = 0.03; P.kneeR = 0.03; P.ankleL = 0; P.ankleR = 0;
      P.pelvisRoll = 0; P.torsoRoll = 0; P.tailYaw = Math.sin(t * 0.8) * 0.1;
      P.headYaw = this.guardLook ?? this.lookYaw * 0.4; P.headPitch = 0.02;
    }

    if (air) {
      const up = clamp(vy / 5, -1, 1);
      P.thighL = -0.9; P.kneeL = 1.3; P.ankleL = 0.1;
      P.thighR = -0.25; P.kneeR = 0.7; P.ankleR = 0.2;
      P.shL = -0.4 - up * 0.4; P.shR = -0.4 - up * 0.4;
      P.shZL = 1.0 + up * 0.5; P.shZR = -1.0 - up * 0.5;
      P.elL = -0.5; P.elR = -0.5;
      P.headPitch = 0.1 * up; P.tailPitch = 0.5 * up; P.earWig = up;
    }

    const cr = clamp(this.crouch.step(0, dt), -0.2, 1);
    if (cr > 0 && !air && !this.sitting) {
      P.hipsY -= 0.16 * cr;
      P.thighL -= 0.85 * cr; P.thighR -= 0.85 * cr;
      P.kneeL += 1.6 * cr; P.kneeR += 1.6 * cr;
      P.ankleL -= 0.75 * cr; P.ankleR -= 0.75 * cr;
      P.shL += 0.5 * cr; P.shR += 0.5 * cr;
    }

    if (this.waveT > 0) {
      this.waveT -= dt;
      const k = smooth(this.waveT / 0.3) * smooth((2.4 - this.waveT) / 0.3);
      P.shZR = P.shZR * (1 - k) + -2.0 * k;
      P.shR = P.shR * (1 - k) + -0.35 * k;
      P.elR = P.elR * (1 - k) + (-0.55 + Math.sin(t * 11) * 0.45) * k;
      P.elZR = Math.sin(t * 11) * 0.25 * k;
      P.headRoll += 0.1 * k;
      P.brow = 0.6 * k;
    }

    // com sono: boceja de vez em quando
    if (this.mood === 'rest' || (this.mood === 'normal' && this.sleepy)) {
      this.yawnT -= dt;
      if (this.yawnT <= 0 && this.yawn <= 0) { this.yawn = 2.4; this.yawnT = 7 + Math.random() * 9; }
    }
    if (this.yawn > 0) {
      this.yawn -= dt;
      const k = Math.sin(Math.PI * clamp(1 - this.yawn / 2.4, 0, 1));
      P.mouth = Math.max(P.mouth, k * 1.15);
      P.headPitch -= 0.22 * k; P.brow = Math.max(P.brow, 0.7 * k);
      if (!this.lying && !this.typing && !moving) { P.shL = P.shL * (1 - k) - 2.4 * k; P.shR = P.shR * (1 - k) - 2.4 * k; P.elL = P.elL * (1 - k) - 0.6 * k; P.elR = P.elR * (1 - k) - 0.6 * k; }
    }
    // café na mão: segura na altura do peito e dá uns goles
    if (this.drinkT > 0) {
      this.drinkT -= dt;
      const cyc = (t % 3.2) / 3.2;
      const sip = moving ? 0 : smooth(clamp((cyc - 0.55) / 0.12, 0, 1)) * smooth(clamp((0.95 - cyc) / 0.12, 0, 1));
      P.shR = -0.45 - 0.3 * sip; P.shZR = -0.12; P.elR = -1.45 - 0.75 * sip; P.elZR = 0;
      if (sip > 0.5) { P.headPitch -= 0.25 * sip; P.mouth = Math.max(P.mouth, 0.15); }
    }

    if (this.talking) {
      P.mouth = Math.abs(Math.sin(t * 13 + Math.sin(t * 4.3) * 2)) * (0.55 + 0.45 * Math.sin(t * 2.7) ** 2);
      P.headPitch += Math.sin(t * 5.5) * 0.035;
      P.brow = Math.max(P.brow, 0.25 + 0.25 * Math.sin(t * 3));
      if (this.waveT <= 0 && !moving && !this.dancing && !this.typing) {
        P.elL += -0.5 - Math.max(0, Math.sin(t * 2.3)) * 0.5;
        P.shL += -0.25 * Math.max(0, Math.sin(t * 2.3));
      }
    }

    // Pernas seguem rápido (pé não pode escorregar); tronco, braços e cabeça
    // vêm atrás com molas (ação sobreposta) — é o que tira o ar duro.
    const active = moving || air || this.crouch.v > 0.05;
    for (const k in P) {
      if (this.pose[k] === undefined) this.pose[k] = P[k];
      let lam;
      if (k === 'mouth') lam = 30;
      else if (LEG_KEYS.has(k)) lam = active ? 26 : 10;
      else if (HEAD_KEYS.has(k)) lam = active ? 9 : 6;
      else lam = active ? 14 : 8;
      this.pose[k] = damp(this.pose[k], P[k], lam, dt);
    }
    const p = Object.assign(this.poseOut || (this.poseOut = {}), this.pose);
    if (!this.sp) this.sp = { torsoYaw: new Spring(0, 70, 11), torsoRoll: new Spring(0, 70, 10), headRoll: new Spring(0, 45, 8), headYaw: new Spring(0, 55, 10), hipsY: new Spring(p.hipsY, 260, 26), tailYaw: new Spring(0, 30, 5) };
    for (const k in this.sp) p[k] = this.sp[k].step(p[k], Math.min(dt, 1 / 30));
    this.hips.position.set(p.hipsX, p.hipsY, 0);
    this.pelvis.rotation.set(0, p.pelvisYaw, p.pelvisRoll);
    this.rig.rotation.z = bank;
    const [legR, legL] = this.legs;
    legL.hip.rotation.set(p.thighL, 0, p.hipZL);
    legR.hip.rotation.set(p.thighR, 0, p.hipZR);
    legL.knee.rotation.x = p.kneeL; legR.knee.rotation.x = p.kneeR;
    legL.ankle.rotation.x = p.ankleL; legR.ankle.rotation.x = p.ankleR;
    this.torso.rotation.set(lean, p.torsoYaw, p.torsoRoll);
    this.body.scale.set(1 + p.breathe * 0.5, 1 + p.breathe, 0.88 + p.breathe * 0.6);
    const [armR, armL] = this.arms;
    armL.shoulder.rotation.set(p.shL, 0, p.shZL + this.armSpread);
    armR.shoulder.rotation.set(p.shR, 0, p.shZR - this.armSpread);
    armL.elbow.rotation.set(p.elL, 0, 0);
    armR.elbow.rotation.set(p.elR, 0, p.elZR);
    this.neck.rotation.set(p.headPitch, p.headYaw, p.headRoll);
    this.tail.rotation.set(p.tailPitch, p.tailYaw, 0);
    this.ears[0].rotation.z = p.earWig * 0.35 + Math.sin(t * 3.1) * 0.03;
    this.ears[1].rotation.z = -p.earWig * 0.35 - Math.sin(t * 3.3) * 0.03;
    this.brows.forEach((b) => (b.position.y = 0.46 + p.brow * 0.03));
    // uma boca só: sorriso parado, boca aberta falando
    const open = p.mouth > 0.08;
    this.mouth.visible = open;
    this.smile.visible = !open && (!this.fofo || this.expr === 'feliz');
    this.mouth.scale.y = 0.15 + p.mouth * 0.65;
    this.glow.emissiveIntensity = this.talking ? 0.8 + p.mouth * 1.6 : 0;
    const eyeX = clamp((this.lookYaw * idle + turn * 0.1) * 0.025, -0.012, 0.012);
    this.eyes.forEach((e) => (e.userData.pupil.position.x = damp(e.userData.pupil.position.x, eyeX, 12, dt)));
    if (this.rgb) {
      const hue = (t * 0.12) % 1;
      this.rgbM.emissive.setHSL(hue, 0.9, 0.5);
      this.rgbM.emissiveIntensity = 1.1;
      this.rgbM.color.setHSL(hue, 0.8, 0.35);
    } else {
      this.rgbM.emissiveIntensity = 0;
      this.rgbM.color.copy(this.top.color);
    }
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blink = 0.13; this.blinkT = 2 + Math.random() * 4; }
    if (this.blink > 0) this.blink -= dt;
    const sleepy = this.mood === 'rest' || this.sleepy;
    const eyeY = this.mood === 'sleep' || this.yawn > 0.3 ? 0.08 : this.blink > 0 ? 0.12 : sleepy ? 0.3 + Math.max(0, Math.sin(t * 0.7)) * 0.12 : 1;
    this.eyes.forEach((e) => (e.scale.y = damp(e.scale.y, eyeY, 40, dt)));
    this.squashV += (-this.squash * 220 - this.squashV * 16) * dt;
    this.squash += this.squashV * dt;
    const q = this.squash - (air ? clamp(Math.abs(vy) * 0.012, 0, 0.06) : 0);
    this.rig.scale.set(1 + q * 0.5, 1 - q, 1 + q * 0.5);
    // deita só depois de sentar (e levanta o tronco antes de pôr os pés no chão)
    this.lie = damp(this.lie, this.lying && this.sitK > 0.55 ? 1 : 0, 3.2, dt);
    const L = smooth(this.lie);
    this.rig.rotation.x = -Math.PI / 2 * L;
    this.rig.position.set(0, L * ((this.bedH ?? 0.5) + this.lieY), L * 0.86);
    this.rig.rotation.z = this.rig.rotation.z * (1 - L) + (this.sway ? Math.sin(t * 0.9) * 0.09 * L : 0);
    this.mug.visible = this.drinkT > 0;
    if (this.mug.visible) this.mug.rotation.x = -(p.shR + p.elR);
    if (this.fofo) fofoFace(this, dt, air, p.mouth > 0.08);
    if (this.wings && this.state.back === 'asas') {
      const flap = air ? Math.sin(t * 18) * 0.6 : Math.sin(t * 2.2) * 0.12 + (moving ? Math.sin(t * 9) * 0.18 : 0);
      for (const w of this.wings) w.rotation.y = w.userData.side * (0.35 + flap);
    }
  }
}

// =====================================================================
// MAMACO NOVO ("fofo") — feito a partir da ficha de personagem: cabeça
// grande e redonda, rosto bege em "coração", olhos ovais pretos, orelhas
// grandes, barriga bege, braços/pernas curtinhos, mão e pé bege com dedos.
// Usa o MESMO esqueleto/animações do mamaco clássico (só troca as peças e
// as proporções), então anda, senta, deita, bebe café etc. igual.
//
// Skins (fantasias/roupas): FOFO_SKINS. Pra criar uma nova:
//   registerFofoSkin('id', { label, colors: { body, arm, fore, leg, belly,
//     hand, foot, skull, ear, face }, belly: true/false, hood: '#cor',
//     shorts: '#cor', coversHead: true, build(m, add) { add('head', group) } })
// Alvos do add: head, torso, pelvis, shoulderL/R, elbowL/R, kneeL/R, ankleL/R.
// =====================================================================

const FOFO_BROWN = '#7a4529';
const FOFO_PEACH = '#f0c39b';
const FOFO_HAND = '#f5cfaa';
const FOFO_EAR_IN = '#e8ad84';

// sombra em faixas (visual de RPG); roughness/metalness ficam só como dado
let FOFO_GRAD = null;
function fofoGrad() {
  if (FOFO_GRAD) return FOFO_GRAD;
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255, 178, 178, 178, 255, 222, 222, 222, 255, 255, 255, 255, 255]), 4, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return (FOFO_GRAD = t);
}
const fmat = (color, rough = 0.82, extra = {}) => {
  const { metalness = 0, roughness, ...rest } = extra;
  const m = new THREE.MeshToonMaterial({ color, gradientMap: fofoGrad(), ...rest });
  if (metalness > 0.4) m.color.offsetHSL(0, -0.05, 0.05);
  return m;
};
const fmesh = (geo, material, cast = true) => mesh(geo, material, cast);

// ---------- Peças modeladas no Blender (blender/parts.py) ----------
// Vêm compactadas (posição em int16 + índices) e viram geometria na hora.
const FOFO_PARTS = {"head": {"s": 2.0409598466798254e-05, "p": "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", "n": "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", "i": "FgEAAAQAAQAWAQYACAABAAYAAgABAAgADwARAAsABAAUAUEBBQBBAQMABgAWAQQACQAGAA0AAwBCAQwABwAFABUACQANAA8ACwAKAA8AFAASAI8BFQADABMAFQATABQADgAHABUAEAAWABcAEQAQABgAGAAQABcAEQAYANADjwEZANEDGgAUANEDFwAWABoAAgAIAB4AHAAhAB0AHAAbAB8AGwAeAB8AHAAfACEAHwAeACAAzQIhACIAIgAmACcAIAALACMAHwAgACQAIAAjACUAIQAkACYAJgAkACUAJgAlAC0AKgAnACgAJQArACwALgAtACwAKAAuADIAKwARANADLAArADAAKwDQAzAALAAwADEAMgAuADEAMgAxADQANQAzADQAPABdAF4APABeAF8AOQA6ADYANwA4ADoAOwA5ADwAPgA4ADcAPwBhAD4APgBhADgAQgA5ADsAQwA/AD4ARAA+AEAAQgBFAEAAbgBDAEcATABuAEcARwBEAEgASgBHAEgARQBGAEsASABFAEsASgBMAEcATABKAE0ATgBKAEkASQBLAFAASQBQAFIAVABSAFEAVABRAHoAUwBSAFQAVgBcAIsAXQBWAFcAVwBWAIUAVgCDAIYAXACKAIsAWwBcAFYAXQBbAFYAYgBZAFwAYgBcAFoAYACTAGIAZQCVAGAAZACVAGUAYQBgAGIAaABkAGUAmABkAGgAbABnAGoAawBsAGoAaQCYAGgAaQBoAGwAnQBpAGwAagBnAG4AnQBsAG0AnQBtAG8AawBuAEwAcABrAEwAbwBrAHAAcwBwAHEAcwBxAHUAbwBwAHIAcgBwAHMAcQBMAE0AdAB1AHEAdQB0AHkAdgB1AHkAeQB0AFMAeQBTAHgAewB4AFQAfAB2AHkAfgB4AH0AfQB4AH8AhwCEALQAgAC3ALkAhgCDAIcAhwCDAIQAgwCCAIQAhQCGAIcAiQC+AMAAigCMAIsAiADAAIwAjQDFAI8AjgDFAI0AkACNAIkAjwCJAI0AkgCRAJcAkgCOAI0AlADGAJIAzADHAJkAmQCWAGQAmQDHAJYAmgDMAJkAnACYAGkAnQCbAJwAngCdAG8A1QDQAJ8AnwDWANUAoAChAKIApACiAKMA1wCgAKQAdwCiAHIApQCiAHcA2gCjAKUAqAClAHwAqQB+AH0AfAB+AKcApwB+AKkApwCpAKoAqQCrAKoArACuAK0AsgC9ALMAtACEALUAhACyALUAtAC1ALYAtACvALgAsAC3ALEAugDAALsAugC7APAA6gC6APAAhAC8ALIAsgC8AL0AvADqAL0AvAC6AOoAvgCPAMQAuwC+AL8AwwDCAMEA8QDEAMIAxgD3AMEAyQD3AMYAxwDIAJQAyADGAJQAyQDGAMgAygDIAMcAzQDKAMwAywDNAM8A0ADOAJsA0QDOANAA0QDPAM4A0gDTANEA1AADAdIA0gDQANUA1gDUANUA2AAEAdQA2gCkAKMA2wDZAKQA2wDaANwA4QDgAN8A4QDfAKoA4QCqAOIA4wCtAK4A5ADiAK0A5gC2AOUA5wDmABYB6ADnAAEA8AAaAeoAvQDqAOsAvQDrALMAswDrAOwAtgCzAOUA+QD2APgA+gD4AMoA+wD6AMsAJgH5APoA/AD6APsA/QDLAM8A/QD7AMsA/QDPANMAAgEBAQMBLQEFAQcBCgEIAdwAMQEIAQoB4ADeAN0ACwHeAA0BDAHeAOAADAHgAOEADgEMAeEADwHhAOIADgHhAA8BOwEQAREBFAHlABUBEwEVAeUAAgDoAAEAFwHpABwBGgEXAewA6QAXARoBGAEbAUUBGwEcAe0AHwHzAPQAGwHzAB0BIgEkASEBJgEhAfkA/AAnASYBJwH8AP4A/wArAQABKwEoAQABLAFVASsBLgEsAQIBMAEuAS0BMwEvATEBWgEvATMBCgEyATEBMgEKATQBXgEyATQBNQFeATQBNgELAQ0BNwE2AQwBOAE3ARIBOgESATkBPAE7AREBOwFkATkBPQFkATwBPwFAARMBRAE/AT4BFQETAUABawFHAUkBHQFHAUUBGAFFAUYBQwEYAUYBRwFGAUUBHQFJAUcBSgEgASQBSwEkASIBTQElAScBTgFNAScBTgF1AU0BTwFOAScBUAFOAU8BKAFSAU8BUwFSAVEBUgFQAU8BVQFRASoBVAFTAVEBWgFZATABhAFbAVwBXAFaAV8BXwFdAVwBNQFgAV4BOAFiATcBYgFhATUBiwFiATgBYwE4AToBZAE6ATkBzAE6AWQBZgE/AWUBaAFnAUYBaQFoAWwBaQFqAWcBcAFrAW8BcwFyAXEBbQFuAXIBdAFxAUwBdAFMAXUBeAF6AXkBUAF5AU4BUwF8AVIBfAF7AVABVAF8AVMBfgF/AVQBnQF+AYABgwGCAYEBgwGEAYUBiAFgAWEBhwFgAYgBigGIAYkBjAESAGYBkQGQAWwBjQFpAZABkwGSAXABrwGRAZIBsgGTAXABlAFtAXMBlAGyAW0BlwF3AXYBlwGWAXcBegGXAXYBewF4AXkBfQGZAXsBmwGaAX0BfwGcAZsBnQGeAX8BggGfAYABgwGgAYIBogGDAYUBogGhAYMBowGFAYYBpAGGAYcBpQHHAaMBpAGlAaMBiAGkAYcBigGkAYgBpwGmAYoBpwGKAagBjQGQAaoBqgGQAawBjgGrARkArQGQAZEBrgGsAa0BrQGRAa8BsQGtAa8BsQGvAbABtQGwAbQBsgGwAZMBswGyAZQBtgGUAZUBtgGzAZQBtgGVAbcBuAG3AZYBeAG6AZcBugF4AZgBugG4AZcBugG5AbgBuwG5AboBmQG8AZgBvQGcAb4BvwGeAZ0BngG+AZwBwAG+AZ4BvwHAAZ4BnwG/AZ0BwgHDAZ8BoAHCAZ8BoQHCAaABxwHFAaMBGATFAccBGATHAaUBxgHFARgEpQHIARgEyAGlAaYBygFkAT0BzAFjAToBzwFjAcwBzQHMAcoBzQHKAcsB0gHRAdABzAHQAc8B0wHSAc0B0wHNAc4B1gHVAdEB1gHRAdIB0wHWAdIB2AHXAdMB2QH6AdsB3AHbAdoB3AHdAeEB4wHfAeAB5AHjAeAB5QHiAeYB5wHjAegB6wHkAeUB6wHwAekB7gHrAeUB7gHlAeYB8AHqAekB8QHqAfAB7AHrAe0B7QHrAe4B7wFRAOoB8gHvAfEBVQDzAfQB+wH1AfYB9QEcAvYB9gEdAvcB+QFfAFgA+QH1AfsB+gH7AdoB+wH4AdoB2gH4AfwB+wH3AfgB+AH+AfwB3gHdAfwB/AH9Ad4B/QElAv8B4gHeAQEC3gH/AQICAwIBAgQCAgIAAgQCCALmAQUCBwLuAQgCCAIJAgoC7AHtARACDALtAQcCCwIHAggCDAIHAgsCCwIKAg0CEQIQAgwCEgIRAgwCEwIOAg0CFAJ6AA8CFQLyARECPAIWAhECQAIXAhQCTAIYArkA8wGBABgCGQIaAhwCHwIeAlICJQIkAiYCJgIkAigCKAIkAicCKQIoAicCAwIEAi0CBAIAAiwCBAIsAi0CLQIsAi4CLQIuAi8CMAItAjECLQIvAjECCgIJAjICCgIyAjMCMgIwAjECNAIyAjECMwIyAjUCNQIyAjQCNgIKAjMCNwIzAjUCDQI2AjkCOQI2AjsCNgI3AjsCNwI4Am8CPQI8AhMCPQJCAjwCOgI5AjsCPwI9AjoCQwJIAkECRAJDAkECRAJBAkICdwJEAkICRQKsABcCrgCsAEUCfQJHAkYCSAJGAkECRgJFAkACfQJGAkgCegJDAkQCegJIAkMCuQCwAEkCTAK5AEkCGgJNAk4CTQJLAk4CUAKHAlECUAIeAk8CUwJSAlECVAJRAokCVAKJAowCVgIgAlQCJwJWAlcCVwJVAo0CWAJXAo0CWwInAlcCXAJbAlgCXAJdAl4CWwJXAlgCWAJZAlwCXAJZAl0CXwJeAl0CXQKWAmACKwIpAmECYQIpAlsCYQJaAmICLgJmAi8CZgJoAmcCYwJkAmgCMQIvAmoCLwJmAmcCLwJnAmoCNAIxAmoCNAJqAmsCNQI0AmwCcQI1AmwCcQJsAnICbwJzAjsCdAJvAnACdQJzAnYCeQI/AnUCeAJ8AncCegJ9AkgCewJEAncCzAJ7AnwCzALJAnsCRwJ+Aq4A4wCuAH4CfQJ+AkcCyQJ6AnsCsADoAIAC6AACAIACgAICABsASgKCAksCSgKBAoIChAJLAoIChAKDAoYCiwKIAtECVQKMAo0CjgKMAooCjgKKAtUCjgKSApACWQKUApMCjQKQApQCkwKXApYCkwKVApcCpAJoAmQCaQJnAmgCuAJ0ArMCuQKzArUCswK7ArgCuwK6ArgCuQK8ArsCwAK7AsEC+QLBArsCwwLCAnwCfgLGAuMAxwLIAn8CyQLIAscCywLKAskC/wLMAsICxQIBA8ICgQIbAIICggIbABwAhAIcAB0AhAIdAIMCzgKFAs8CzgLPAtACiwLRAtICzgLQAtECigLSAtUC1wLVAg4D1gLVAtcCkgKOAtYC2ALZAtwC+gLAAsEC+QL6AsEC+wL6AvkC9wL6AjgD/wIJA8sCAQMAA/8CQQMBAwIDQQMDAwEDQQMCA/4CyAIEA8YCBwMEA8gCBgMFAwQDBwPKAssCygIHA8gCCQMKAwcDzwLNAiIAzwILA9ACDAPQAgsDDwMNAxADDgMPAxIDEQMOAxIDFAPUAhUD1AITAxUD3ALUAhQDOwM5A/oCOQNDAzgDOwP6AvsCOANDA/4C/gJDA0ADOQNCA0MDAwNIAwADAwNGA0UDRgMDA0EDQQNAA0QDBgM9AQUDCgMIAwcDCgN0AwgDSQMJAwADSQN0AwoDCwMpAEoDSgMpAC8ADQNLAxADTAMQA0sDEgMQA00DEwMSA00DEwNNA04DEwNOA08DTANQA00DTgNQA3wDbwNyA0QDbwNuA3IDRgNEA3EDRANyA3EDdQPHA3QDRQN2A0gDdQNJA0gDdgOfA3UDLwApACoASgMvAHcDdwMvADMAeAN3AzMATANLA3cDTAN3A3kDdwN4A3kDeQN4A3oDTAN5A1ADewN8A30DfAN6A30DTwN7A1IDfwN7A30DcgNwA50DbgOYA3ADmAOZA3ADcgOcA3EDcQOcA3MDoQNzA5wDwAOcA50DnwOgA54DogOgA58DogOfA3MDcQNzA3YDeAMzADUAowN4AzUAegOjA6QDfQN6A6QDpQN9A6QDfQOlA6cDcAOZA78DvQO/A74DwQOhA8ADwAPCA8EDvQPCA8ADwwPOA6ADoQPEA6IDogPDA6ADxQM9AQYDxQPLAT0BRwPFAwYDzgHLAcUDdAPIA0cDxgPUAc4ByQPUAcYDyAPJA8YDoAPHA54DoAPLA8cDzAPJA8oDywPOA80DoAPOA8sDzwMXANQD0AMYANUD0QPTA9IDGgDSA9QD1QPPA9YDzwPaA9YD0wP+A9cD0gPTA9gD2APTA9cDzwPZA9oD2AM+BNsD2QPbA9wD3gPWA90D2wNABN8D2wPfA+AD4APfA4UE3QPcA+ED3gPdA+ID4gPdA+ED4gPhA+UD5QPhA+MDMADmA+cDMQAwAOcD6QMxAOgD5gPVA9YD6wPmA9YD5wPmA+sD7wPpA+4D6gPpA+8D8APrA94D8QPrA/AD7APxA+0D8gPtA/ED9QPwA+ID8gPxA/YD9wPyA/YD9wP2A/oD+APzA/cD9QPiA+QD+gP1A/kDqwGuAf0DrgEABP8DAwQCBLEBAwSxAbUBtgEJBLMBswEEBLQBCQQlBAQEtgG3AQkEBwQJBLcBBwQKBAkEuAEHBLcBuQEHBLgBCwQHBLkBCwQIBAcEDAS5AbsBvAENBLsBDQQrBAwEDwQOBJoBDgQsBA0EEAS9Ab4BMAQPBL0BEAQwBL0BwAEQBL4BEQTAAcEBFATBARIEFAQSBBMEEwTCAcQBFwQVBBYEGAQWBMYBGgQYBMgBGgQZBBgEGgTIAckB/wMcBP0D/QMcBB0E/wMgBBwEHAQeBB0EHwT+Ax0EAAQgBP8DAQQhBEEEAQRBBCAEHARBBB4EIARBBBwEAQQCBCEEIgQhBAIEBQQkBLUBtQEkBAMEJQQjBAUEJgQnBAoEBgQoBCUECAQmBAoEKQQIBAsEDAQpBAsELgQrBCwELwQuBCwEEAQxBDAEMgQQBBEEMwQRBBQEFwQ2BBUENwQ2BBcEGQQ4BBYEOAQXBBYEOARaBFgEWAQXBDgEOwQ5BBoEOwRcBDkEHgRDBGAEPQQfBB4E1wM9BD4EQAQ+BD8ERQRBBCEEQQRDBB4EQwRBBEIEIgREBCEERARFBCEEKARJBCUEJwRLBCgEKQRNBCYETARNBCkETQRLBCcEKgRMBCkETgRMBCoEUAQtBC4EbgRPBFAEUQQxBDIEUgRRBDMEUgQzBFMEVAQ1BDQENgRWBFUENwRWBDYEWwQ7BDoEWwRcBDsEWwRdBFwEPAReBDoEZARhBD8ERgRjBEIEQgRjBEMEYwRiBIYERgRiBGMEZgRlBEQESARmBEQESwRpBCgEagRoBGkEagSSBGgEagRLBGsETgRrBE0EbQROBE8EbAROBG0EbwRtBG4EmwRwBHEEcQRRBFIEcwRxBFIEdARTBFQEVQR0BFQEoASfBHQEVQR1BHQEdwRVBFYEdwRWBFcEeAR3BHkEfAR7BF0EXgRdBFsEXQR9BHwEXwR+BF4EfwSoBH4EgQSpBH8EYQSJBIoE3wODBIQEhASvBK4EgwSKBK8E3wOEBIUEhQSwBLEEsASFBK4E4wOFBLEEhwRkBIYEYQRkBIkEiQRkBIcEYgRlBIsEhgSMBI0EjwSMBIsEjgSPBIsEugSMBI8EkgSQBGgElASTBJIElgSUBJIExgSUBJYEbASWBGsEbASXBJYEmASXBGwEmQSYBGwEmwRvBHAEmgSZBJsEcgScBHEEngRyBJ8EzQTMBJ4EogShBKAEdgSgBHQEdgSjBKIEpAR4BHkEeASlBKME1ASlBKQEpgTVBKQEegSkBHkEfQSmBHwEpwSmBH0EqASnBH0EqQSqBIAEgASqBKcEfwSpBIAEqwSpBIEEqwTaBKkEqwSsBNoEiwWrBIEErQSrBIsFsASuBLkEsQS5BLIE4wOxBLQEsQSyBN8EtATgBLUEigS2BLcEtwS9BOYEuASKBLcEjwSOBL4EwgS/BL4EwAS6BL4EwQTCBI4ElQTEBMEEwgS+BI4ExATDBMIExQTzBJUElATFBJMExgTFBJQExwTzBMUEyATHBMYEnQTKBJoE/gTKBJ0E/gSdBMsEywSdBMwEoQTNBJ4EzwTNBKEE0ATPBKEE0ASiBKME1ATSBKUE1ATXBNIE1QTXBNQE1gTVBKYEpwSqBNkEDwWqBNoE2gTbBA8FrATbBNoE3gTcBN0ErQTdBKsErQTeBN0E4QS4BOYEuQS4BOEE4gS5BOEE4wTiBBQF4ATjBOQE5QS1BOAE4ATkBOUE5gTnBOkE6gThBOkE6wTABL4E7QS8BOwE7wTsBOsE7wTwBB8F8gTEBPME9ATyBPME9gTzBPUEyQT4BMcE9wT1BPgE+QT3BPgE+gT4BMkE+gT7BPgE/AT7BPoE+wT5BPgE/AT9BPsE/gT8BPoEAAXLBM4EAQUCBQAFAQXOBNEEAwUBBdEEBAUDBdEEBAXRBNME1wQGBdIEBQUEBQYFCQUGBdcE2AQKBQkFCAUHBQkFOAUKBQsFDAU4BQsFDwUNBQwF3AT7BhAF+wYOBRAFGAXjBBQF5ATjBBgFEQXkBBIF5QTkBBEF6gTpBBMFEwXpBBwFFAXiBBUFFQXiBOoEFgXqBBMFFQXqBBYFGAUUBRcFFAUVBRcFGQUYBRcFEgUYBRkFEQUSBRoFGgUSBRkFGwXtBPEEEwUcBR0FHQUcBRsFIAXxBB8FHQUbBSEF9AQiBfAEIgUjBR8FIwUgBR8FIwUlBSAFJwUiBfYEJgX2BPcEJgUnBfYEJAUjBScFJgUkBScFKAUkBSYFJgX3BPkE/QQsBfsEKwUsBf0E+wQsBfkELQUqBSwFKwUtBSwFLwUtBSsFAwUCBQEFAwUwBQIFAwVXBTAFOAUzBQgFDQU1BQwFNQU5BTYFOgUOBfsGOgVjBWIFOwVjBToFHgUdBUIFQgVBBUgFQwU8BUIFPwU9BUUFQAUhBSUFRAVCBUgFSgVIBUkFJAVHBSUFKAVLBSQFSQVIBUcFSQVHBUsFTAVJBUsFTwVLBU4FUAUqBS0FVgVRBVAFLwVSBS0FVAVVBVYFWAVUBVMFWAVZBVQFVQVUBVkFWQVaBVUFWgV7BXoFMgVZBVgFXAVaBVkFXgVaBV0FXgV/BVoFYQV/BV8FYAVhBV8FNAVdBVwFNgVeBV0FYgVjBV8FSgVpBUQFRgVDBWUFZwVlBWYFZAVGBWcFagVKBUwFagVpBUoFZgVqBWsFZwVmBWsFbgVMBU8FcAVrBW8FcQVsBW0FcwVuBU8FcwVPBVEFdQVvBW4FcAVvBXcFeAV3BXwFeAVwBXcFeQVyBXgFcQVyBXkFdAVWBVUFdAV2BXUFfAV2BXoFewV9BXwF1QEbBMkBgQUbBNUB1gGCBdUBgwWCBdYB1wGDBdYBhAXXAdgBhAWDBdcBgQU8BBsEhQWBBYIFhgWCBYMFhgWFBYIFhgWIBYUFiAVfBIUFiQWBBIgFhwWJBYYFiAV/BF8EiwWBBIkFjAU1AOoDNQCMBaMDpQOQBY8FpQW8A6YFqQXCA74D0gW+A6cFvgO/A6UFpwW+A6UF0gWoBakFwQOoBcQDjAWsBa0FrAXvA64FjQWMBa0FrwWNBa0FjgWNBbEFjwWQBbMFsgWzBd0F0gWnBdMF0gXUBagF1QXUBdIF1wWrBaoF1wXYBQsGrQWuBbAFrgXvA/QD2gWwBa4F2wWwBdoF3gWyBd0F3wXhBd0F3gXdBeAFAwYEBgIGAwYBBgQGBAbTBdEFBQYLBtkF1gXVBQYGBwbZBdYFCgYJBgsGDAb4Aw0G+AP3A/wD2gWuBQwG2wXaBQ4GDwbbBQ4GEAbhBdwFFgYSBhQGNQY3BnAGBgYBBgMGLwYDBgIGOAYHBjYGOAYFBgcGeQY5BjoGOwZtBwgGfAY6BjsGPAYIBgkGdgZzBgoGCgYFBnYG+wP6Az4G/AP3A/sDDQb8Az8GgQYOBg0GQQYOBkIGhQZBBkIGRAYRBkMGRwYTBkQGFAZHBkgGRwZEBkYGSAZHBkkGTAZIBkkGNAZsBjAGbgZsBjQGbQZsBm4GcQZ3BrwGdwZxBroGvAY3BjAGvAYwBmwGcwZ2BnQGdAZ8BnMGdwZ2BjgGdwa6BnUGeAatBIIEeAaCBDkG3gStBHgGeQZ4BjkGewZ5BjoGcgZ7BnwGPQbkA7MEPQazBLUEfgY9BrUEfwY+Bn0GfwZ9Bn4GfgZ9Bj0GPwY+Bn8GgAY/Bn8GggY/BoAGggaBBkAGhgaFBoQGhwZFBkMGiwZJBooGiwZLBkwGiAZFBokGjAaIBokGjQaKBogGjQaMBs0GjwaOBo0G2AadBt4GrAbvBqsGrwawBrIGuAZtBrIG9wbABr8G+QbcBN4EvgbBBnIGvQa+BnIGvwbABnUGwQZ6BnkGegbeBHgGwga1BOUEwwZ/Bn4GwwZ+BsIGgAZ/BsYGxgZ/BsMGggaABsgGyAaABsUGywaEBsgGhwaGBsoGygbLBswGzwbKBswGzAbLBgMHzgbNBokGiQbKBs8G0AbRBtIG0waPBs0G1AaPBtMG0wbOBtAG2QbUBtMG1gaTBpQG1gaUBo8G1AbWBo8G1QbUBtkG2gbVBtkG2gbZBtwG2AbaBtwG2wbZBtAG3QbbBtIG3AbbBt0G3wbVBtoG4QbYBtwG4QbcBt0G4QbdBgsH4AbhBgsH2AbeBtoG4gaeBuAG4gbjBuUG5gblBucG5QbjBucGFAfmBucG6QblBuYG6gbmBusG5gYUB+0GrgbqBu8G6gbrBu8GqwbvBusGqwbsBvAGqwbrBuwG7AbrBu0G8AbuBvEGHAfyBvEGtQawBvAG8gYhB/MGIQcgB/MG8ga0BrYG9Ab2BvUG9gYkB/UG9wb4BrkGIAf4BvcG+Ab0BrkG+Ab2BvQG8wb3BrsG+gbcBPkG/AYkB/kG9QYkB74GuQb0Br0GuQa9BsAG5QQRBf0G/Qb+BsIG/gbEBsIGAAfEBv4GAAf+Bv8GAQcEB8cGAAcBB8QGAwfLBskGAgcDB8kGBQcCBysHKwcCBwQHBgfPBswGBQfMBgMHCAcGBwUHCgcJBzIH3QbSBgcHCwcKBwwHDgcMBzYH4wYNBw4HEQcOBxIHEQfjBg4H7QYUBxUHFgcVBxAHGAcXBxsH7gYYBxwH7gYVBxgH8gYbByEHGwccBxgHHgcfB/YGIQcZByIH+gYjB/sGSwdjBSMHHQdKByUH9gYlByQHHwcdByUHHwclB/YGJwf/BhoFJwc+BSYHJwcAB/8GKQcoBycHKAcqBwAHLQcrByoHKQctBygHBQcrBzAHNAcvBy4HMQcwBywHMwcyBzEHMQcsBy8HMwcxBzQHNQcKBzIHVAczBzQHNwcKBzUHNgcKBzcHNwczBzgHOQc4B1QHOwc2BzcHOQc3BzgHDwc2BzsHEgc7BzwHEwcSBzwHEgcPBzsHPwc9Bz4HPQdbBz4HEwc8Bz0HQQdiB0IHQwc+B0kHSQc+B0EHRwdFB0QHSQdHB0gHSQdAB0cHQAdFB0cHQwdJB0gHSwdMB2MFRAdMB0sHHwdHBx0HTgcpByYHJgc/BWQFTgcmB2QFTwdRB04HUAdNB1EHUAc0By4HUgdRB08HNAdQB1UHVAc0B1UHVQdQB1MHVgdVB1MHWAdUB1UHVwdZB1oHWwdcB2IHWwddB1wHXAdWB1oHXQdYB1wHXwd+BV4HWQd5BX4FXwdZB34FYAdfB2MHYgdhB2AHYgdcB2EHRgdeB2EFRQdeB0YHZAeEBdgBZAfYAcwDZQdkB8wDZQfMA80DzgNlB80DaQdoB6sFCAZoB2kHigWHBWcHbAdmB2gHawdqB2cHbQdsB2gHOQZqB2sHAwBBAUIBBQAEAEEBDQAGAAQADQAEAAcABwAEAAUACAAGAAkACgAIAAkADABmARIAEwADAAwAEwAMABIAFQAFAAMADgANAAcADwAKAAkADwANAA4AEAAOABYAEAAPAA4AEQAjAAsAjwESAIwBFAATABIAFQAUABYAFgAOABUAFACPAdEDFgAUABoAGwACAB4AHgAIACAAIAAIAAoAJAAhAB8AIgAhACYACwMiACcAIAAKAAsAJAAgACUAJgAtACgAJwAmACgAKQAnACoA5wFQAEsAJQAjACsALQAlACwAKAAtAC4AKgAoADIAMwAqADIALwAqADMALgAsADEANAAzADIAXwA9ADwAPAA2AF0AOgA4AGMAOQA3ADoAOwA8AD0APAA5ADYAPwBmAGEAOQBAADcANwBAAD4AQAA5AEIAQQBCADsAQwBmAD8AQwBnAGYARABDAD4ARQBEAEAARgBFAEIARgBCAEEAbgBnAEMARwBDAEQASABEAEUA5wFLAEYASgBIAEkATgBNAEoASwBJAEgAUABRAFIAlwBkAJYATgBJAFIAUwBOAFIAhQBWAIYAXgBXAFgAWABXAFUAVQBXAIUAXABZAIoAOgBbAF0AOgBjAFsAYwBaAFsAWwBaAFwANgA6AF0AXgBYAF8AXgBdAFcAWgBhAGIAYgCTAFkAkwCQAFkAYwA4AFoAYQBaADgAYACVAJMAZgBgAGEAZgBlAGAAZwBoAGUAZgBnAGUAbABoAGcAawBqAG4AbQBsAGsAbwBtAGsAcgChAG8AcQBwAEwAdABxAE0AdABNAE4AdABOAFMAdwBzAHUAdwB1AHYAcwB3AHIAeABTAFQAegB7AFQAfgB5AHgAfwB4AHsAgACHALcAgQCAALkAjAC8AIIAggC8AIQAvACMALoAugCMAMAAVQCFAIAAVQCAAIEAgACFAIcAiQDAAIgAiQCPAL4AiwCMAIIAigCIAIwAVgCLAIMAgwCLAIIAkACJAIgAWQCIAIoAkACIAFkAkQCVAJcAkQCSAI0AkwCRAJAAkQCNAJAAfwCrAH0AlwDHAJQAxwCXAJYAlACSAJcAlQCRAJMAmACZAGQAmwDOAJoAnQCcAGkAnACZAJgAmgCZAJwAnACbAJoAngDQAJ0A0ACbAJ0AnwDQAJ4AoQCeAG8AoQCfAJ4AoADWAJ8AogChAHIAoACfAKEAogCkAKAAdgClAHcAowCiAKUAfAB5AH4ApQB2AHwApwCoAHwAqACmAKUAqQB9AKsAsgC2ALUArQCrAKwArQCqAKsAygDLAPoAtwCHALQAuAC3ALQArwC0ALYAsAC5ALcAsQC3ALgA8AC7AO4AxAC/AL4AuwDAAL4AwwDxAMIAjgDBAMIAxQDEAI8AxQCOAMIAwgDEAMUA9wDDAMEAwQCOAJIAwQCSAMYAygD4AMkAyADKAMkA6QDvABwBzADKAMcAmgDOAMwAzgDNAMwAzgDPAM0A0gDRANAA0QDTAM8A1ADSANUA1AAEAQMB1wDWAKAA1wDYANYA1gDYANQA2QDYANcABQHYANkA2wCkANoA2QDXAKQACAHZANsApgDaAKUA3AAIAdsAqADdAKYApgDcANoA3QDcAKYA3QAJAdwA3wCoAKcA3wDdAKgAqgDfAKcA4ADdAN8ArQDiAKoA4wDkAK0A5QCzAOwA5gCvALYA5wC4AK8A5wCvAOYA6ACxALgA6ACwALEA6AC4AOcAGgHrAOoA7ADrABoB7gC/AO8A7gC7AL8AGgHuAOkA7wDtABwB7QC/APIA8gDzAO0A8gC/AMQA8gDEAPEAyQD2APcAHgH1APcAwwD1APEA8gDxAPUA9QDDAPcA9ADyAPUA/wADAQEB9gAeAfcA9gAjAR4B+QAjAfYA+gD5APgA+gD8ACYB/QD+APsA/gD8APsA0wD/AP0A/QD/AAAB/QAAAf4A4gAQAQ8BAQErAf8AAwHTANIABAECAQMBBQEGAQQBBgECAQQB2AAFAQQBBQEtAQYBBwEFAdkACAEHAdkAMQEvAQcBMQEHAQgBCQEKAdwACQHdAN4ACQE0AQoBCwEJAd4ADAENAd4A5AARARABFAHmAOUADgESAQwBOwEPARABPgETAewAEwHlAOwAFQFBARQBAAAWAeYAAAAUAQQAAQDnABYBFwEcARgBGAEZARcBPgHsABcBPgEXARkBGAEcARsBHwEdAfMA8wDyAPQA7QDzABsB9QAeAfQAHgEfAfQAIAEfAR4BIAFIAR8BIwEgAR4BJAEgASMBIQEkASMBJQEhASYBJQEiASEB+QAhASMBJwElASYB/gApAScB/gAoASkBKAFPASkBAAEoAf4AKwEqASgBAQEsASsBKwFVASoBAgEsAQEBLAFXAVUBLgFWASwBBgEuAQIBBgEtAS4BBwEvAS0BLwEwAS0BMAFWAS4BLwFaATABMgEzATEBXgEzATIBCwE0AQkBNQE0AQsBNgE1AQsBNgENAQwBEgE3AQwBDwE5AQ4BOQESAQ4BOwE5AQ8BPAFkATsBPwETAT4BQAEMAEIBQgEVAUABRgFnAUMBQwEZARgBGQFEAT4BGQFnAUQBZwEZAUMBRQEbAR0BSAEdAR8BSAFJAR0BbwFJAUgBbgFvAUgBSgFIASABSgFuAUgBSwFKASQBIgFMAUsBTQEiASUBTQFMASIBKQFPAScBKgFRASgBUQFSASgBVQFUAVEBVQFXAVQBLAFWAVcBVgFYAVcBVwFYAX4BWQFYAVYBWQGBAVgBMAFZAVYBXAFbAVoBWgFbAVkBXgFfATMBMwFfAVoBYAFfAV4BXwFgAV0BYQFgATUBYgE2ATcBNgFiATUBiwFhAWIBOgE4ARIBagFlAUQBZgFAAT8BZQE/AUQBjAFmAWUBjgGNAaoBaAFpAWcBZwFqAUQBawFsAUcBkgFsAWsBRgFHAWwBbAFoAUYBbwFrAUkBcAFvAW4BcgFuAUoBSwFyAUoBcQFyAUsBTAFxAUsBlQFzAXEBdAGVAXEBTQF1AUwBdQF3AXQBdgF3AXUBTgF5AXUBegF2AXUBeQF6AXUBewF5AVABUgF8AVABfAF9AXsBVAGbAXwBVAF/AZsBVwF+AVQBWAGAAX4BWAGBAYABgQGCAYABXQGEAVwBgwGBAVkBWwGDAVkBWwGEAYMBXQGFAYQBYAGHAV0BXQGGAYUBhwGGAV0BiQGIAWEBiwGJAWEBigGJAYsBYwGLATgBjQFlAWoBjQGMAWUBdAGWAZUBjwGMAY4BkAFpAWwBjQFqAWkBcAGSAWsBkgGRAWwBkwGvAZIBbQFwAW4BbQGyAXABcwFtAXIBlQGUAXMBpgHJAcgBegF4AZcBewGYAXgBewGZAZgBfQGaAZkBmwF9AXwBmwGcAZoBfgGdAX8BfwGeAZwBgAGfAZ0BggGgAZ8BoQGgAYMBowGiAYUBowHFAaIBpAGjAYYBigGmAaQBpAGmAaUBqAGKAYsBqQGnAagBqgGrAY4BqwGqAawBrgGrAawBGQCPAY4BrQGsAZABsAGvAZMBtAGwAbIBswG0AbIBsAG1AbEBlQGWAbcBlwG4AZYBvAG6AZgBmgEOBJkBmQEOBLwBnAG9AZoBvQEPBJoBvwHBAcABnwHDAb8BwwHBAb8BoQHEAcIBogHFAaEBxQHEAaEBxQHGAcQBPQDbATsAyQGnAakBZAHKAcwBywHKAT0BqAGLAWMBzwGoAWMBzQHQAcwBzgHNAcsB0QHPAdABzwHRAagB0QGpAagBzQHSAdAB1AHTAc4B1QHJAakB0QHVAakB1wHWAdMB1AHYAdMBPQBfAPkB2QE9APkB2QH5AfoB3wE7ANsB2wH6AdoB3QHcAdoBQQDjAUYA3wHbAeAB4AHbAdwB4QHgAdwB4QHdAeIB4gHdAd4B6AFPAOcB5AHgAeEB5AHhAeUB5QHhAeIB5wFGAOMB6QHqAegB5AHpAeMB4wHpAegB6wHpAeQBJQIiAiMCUQBPAOoB7AHwAesB8QHwAewBegBRAO8BDwJ6AO8B8QHvAeoBEALxAewBEALyAfEB9AH5AVgA+QH0AfUB9AFYAFUA9AHzARsC9AEbAvUB9QEbAhwC+AH3ASEC9gEcAh0C+gH5AfsB+wH2AfcB/QH8Af4B/gH4ASICJQL9Af4BIgL4ASECBQLiAQEC3QHaAfwB3gH9Af8BAgL/AQAC/wElAiYC/wEmAgACAQLeAQICAQICAgQC8gEUAg8CBQIBAgYCBgIBAgMCMAIGAgMCCALuAeYBBgIIAgUCCQIIAgYCCQIGAjACBwLtAe4BDgIMAgsCCgILAggCDQIOAgsC8gEPAu8B8gEQAhECEALtAQwCEgIMAg4CEwISAg4CFAJ7AHoAFQJAAhQCFgIVAhECEgI8AhECEwI8AhICFwJ/AHsAFAIXAnsAeQLDAngCFgJBAhUCuQAYAoEAGQIYAkwCGQJMAk0CGgIZAk0C8wFVAIEA8wEYAhkCGQIbAvMBGwIZAhwCHAIaAh0CHQIaAh4CHQIeAh8CIQL3AR0CIQIdAh8CIgIhAh8CIgIfAiMCIwIfAiACHwJTAiACJAIjAiACJAIgAlYCJQIjAiQCAAImAigCKgIoAikCKgIAAigCLAIAAioCLgIsAioCLgIqAisCMAIDAi0CMgIJAjACNgINAgoCNwI2AjMCOAI3AjUCEwINAjkCcwI6AjsCOwI3Am8COQI9AhMCOgI9AjkCPwI+Aj0CdQI/AjoCQQJGAkACQgJBAhYCPAJCAhYCPgJCAj0CQgI+AncCrAB/ABcCRgJHAkUCRwKuAEUCQAJFAhcCSgJMAkkCTQJMAkoCSwJNAkoCTwJOAksCTwKGAocCUAJPAocCGgJOAk8CHgIaAk8CUwIfAlICUgIeAlACUgJQAlECVAJTAlECVQJUAowCIAJTAlQCVQJWAlQCJwIkAlYCVwJWAlUCWAKNApQCKQInAlsCWgJbAlwCWgJcAl4CWAKUAlkCXQJZApYCXwJdAmACKwIqAikCYQJbAloCYgIrAmECYwJaAl4CYgJaAmMCZQJjAl4CZQJeAl8CZAJjAmUCZgIuAisCYgJmAisCaAJmAmICaAJiAmMCaQJqAmcCbAI0AmsCOAI1AnECcAI4AnECcAJvAjgCcwJvAnQCtAJwAnECdQI6AnMCdAJ2AnMCdAK4AnYCPgI/AngCdwI+AngCeAI/AnkCdgJ5AnUCgAJKAkkCewJ6AkQCewJ3AnwCeALDAnwCfQLHAn8CfQJ/An4CfQJ6AscCxwJ6AskCSQKwAIACgQKAAhsAiwKMAokChgJLAoQChgJPAksCUQKHAogChwKGAoMChwKDAoUCzgKHAoUCiQKIAosCiAKHAs4CiALOAtECiQJRAogCkgKPApACjgKNAowCkwKQAo8ClQKPApEC2AKVApECkAKNAo4CugK/AnkCkwKPApUCWQKTApYCpQJpAmgCpQJoAqQCdAJwArMCtQKzAnACtAK1AnACugJ2ArgCswK5ArsCzQKFAoMCwAK6ArsCfALCAswCvwLFAsMCwgLDAsUCvwLEAsUCwALEAr8CwAL3AsQCfwLGAn4CfwLIAsYCyQLKAsgCzALLAskCzAL/AssCEQHjAMYCPAERAcYChAKCAhwAzQKDAh0AzQIdACEA1gKRApIC0wLRAtACigKLAtIC0gLRAtMCjgLVAtYC2AKRAtkC2QLWAtcC1ALZAhED2gKVAtgC3ALZAtQCuwL4AvkCAgP3Av4C9wLAAvoC+QL4AvsCxQICAwEDxQLEAgID1wIRA9kC9wI4A/4CCQP/AgAD/wLCAgEDAAMBAwMDxgIFAzwBBAMFA8YCPQE8AQUDBAMIAwYDCQMHA8sCBAMHAwgDCwPPAiIA0wLQAgwD0wIMAw0DDwPVAtIC1QIPAw4DDwPSAtMCDwPTAg0DEwMRAxIDEwPUAhEDDwMQAxIDOAP6AjkD/gJAA0EDSAMDA0UDRANGA0EDCANHAwYDAANIA0kDCgMJA0kDKQALAycADAMLA0oDDANKA0sDDQMMA0sDEANMA00DUANOA00DTwNOA3wDFQMTA08DbgNDA0IDQwNvA0ADbwNEA0ADbwNDA24DcgNuA3ADRQNGA3YDdgNGA3EDSQN1A3QDdQOeA8cDSAN2A3UDSwNKA3cDewNPA3wDfANQA3oDegNQA3kDcgOdA5wDdQOfA54DdgNzA58DogNzA6EDowN6A3gDfwN9A6cDugO8A5kD/gPRAxkAvwOZA7wDnQNwA70DcAO/A70DoQOcA8ADnQO9A8ADwgO9A74DxAPDA6IDoQPBA8QDxQPGA84BRwPGA8UDRwPIA8YDRwMIA3QDdAPHA8gDyAPKA8kDxwPLA8gDyAPLA8oDyQPYAdQByQPMA9gBywPNA8oDygPNA8wDGAAXAM8D1QMYAM8D6gM0AOkDGgDRA9IDFwAaANQD1wP+Ax8E1APSA9kD2QPSA9gDzwPUA9kD2APXAz4E2QPYA9sD2gPZA9wD3QPaA9wD1gPaA90D2wM+BEAE3APbA+AD4QPcA+AD4QPgA+MD4AOFBOMD5QPkA+ID5gPQA9UD5gMwANAD6AMxAOcD6QM0ADEA/gOrAf0D7APnA+sD7APtA+cD7QPoA+cD7gPoA+0D7gPpA+gD3gPrA9YD8QPsA+sD8gPuA+0D8gPzA+4D8wPvA+4D8wP0A+8D4gPwA94D9gPxA/AD9gPwA/UD+gP2A/UD9wPzA/ID+wP3A/oD+QP1A+QD/QOuAf8DrQECBAEErQEABK4BrQEBBAAExgEVBMQBtAEEBLUBBAQFBLUBBASzAQkEBgQlBAkEBwQIBAoECQQKBAYEDAQLBLkBvAG7AboBuwENBAwEDgQNBLwBDwQsBA4EwAERBBAEwwESBMEBwgESBMMBFAQRBMEBwgETBBIEFQQTBMQBKwQpBAwEGQQWBBgEGwQaBMkB/gP9Ax0EAAQBBCAEAwQiBAIEBQQjBCQEAwQkBCIEBAQlBAUECgQnBAYEBgQnBCgEKQQmBAgEjQSHBIYELAQrBA0ELgQtBCsELwRQBC4EMAQsBA8EMAQvBCwEMQQvBDAEMgQxBBAEMwQyBBEENQQzBBQENAQ1BBQENgQTBBUEEwQ0BBQENgQ0BBMEGQQ5BDgEOQRaBDgEFwRYBDcEGgQ5BBkEGgQbBDsEGwQ6BDsEGwQ8BDoEHgRgBD0E1wMfBD0EHQQeBB8EPgQ9BD8EPQRgBD8EQQRFBEIERgRCBEUERARGBEUEIwRHBCQEJARHBCIEIgRHBEgEIgRIBEQERwRKBEgEJQRJBCMEIwRJBEcESQRKBEcEJgRNBCcETAROBE0ELQQqBCsELQRPBCoETwROBCoEUARPBC0ELwRuBFAEUQQvBDEEUQRwBC8EcARuBC8EMwRRBDIENARVBFQENQRTBDMEVARTBDUENgRVBDQEVwRWBDcEWARXBDcEWARZBFcEWARaBFkEWgR7BFkEOQRcBFoEWgRcBHsEXARdBHsEOgReBFsEPwRhBEAEPwRgBGQEQASDBN8DgwRABGEEYARDBGQEYwRkBEMERARlBEYERgRlBGIESgRnBEgESARnBGYEZQRmBIsEZwSRBGYESQRoBEoESQRpBGgESgRoBGcEaASQBGcEKARpBEkESwRqBGkETQRrBEsEawSWBGoETgRsBGsEbQRvBGwEbgRtBE8EcARvBG4EUQRxBHAEUwRzBFIEcwRyBHEEdARzBFMEdASfBHMEdAR1BHYEdwR1BFUEdwR4BHUEVwR5BHcEWQR5BFcEWQR6BHkEWQR7BHoEewR8BHoEXgR+BF0EfgR9BF0EfgSoBH0EXwR/BH4EgwSvBIQEYQSKBIMErgSFBIQEtATlA+MD5APlA7QEYwSGBGQEwAS7BLoEiQSHBLYEhwSIBLYEiwSMBGIEjASGBGIEjAS6BI0EZgSOBIsEZgSRBI4EZwSQBJEEkATBBJEEkQTBBI4EkgSTBJAEkASTBMEEkwSVBMEEagSWBJIElwTGBJYEbwSZBGwEmQSaBJgEmwSZBG8EmwScBJ0EnQSaBJsEnASbBHEEzAScBHIEngTMBHIEnwRyBHMEoASeBJ8EoAShBJ4EogSgBHYEdQR4BHYEeASjBHYEeASkBKUEpATVBNQEegR8BKYEegSmBKQEfwSABKgEgASnBKgEggStBIsFsQSwBLkEtASzBOQDtASxBN8EtAS1BLME4AS0BN8EiQS2BIoEtgS9BLcEigS4BK8ErgSvBLgEuQSuBLgEuAS3BOYEiASNBLoEuwSIBLoE0wSjBNIEtgSIBLsEvQS2BLsEjwS+BLoEwQTEBMIEkwTFBJUElQTzBMQExwTFBMYEmATIBJcEyATGBJcEyATJBMcEmgTIBJgEmgTKBMgEyATKBMkEnATMBJ0EzQTLBMwEzQTOBMsEzwTOBM0E0ATRBM8EzwTRBM4EogTQBKEE2wTdBBAF0wTSBAYFpQTSBKME1QTWBNcE1gQJBdcE1gTYBAkFpwTYBKYEpgTYBNYEpwTZBNgEqgQPBdkE3QTcBBAFvAS9BLsEqQTaBKoEqwTdBKwEuQTiBLIE3wSyBOMEsgTiBOME4ATfBOME6wS8BMAE5gS9BOcE5wToBOkE5gTpBOEE6gTiBOEEvwTrBL4E7gTyBPAEvATtBOcE5wTtBOgEwgTDBL8EwwTuBL8EMQUzBTIF7gTvBL8E6wS/BO8E8ATvBO4E7wTxBOwExATyBMME9ATwBPIExwT1BPME8wT2BPQE9QT3BPYE+AT1BMcEygT6BMkE/gT6BMoEywT/BP4E/wT8BP4E/wT9BPwEAQUABc4EywQABf8E0ATTBNEEBgUEBdMECQUHBQYFBgUHBQUFCgXYBAsFCQUKBQgFCgU4BQgF2ATZBAsFDwULBdkEDwUMBQsF2wQNBQ8F2wQOBQ0FEAUOBdsEEgXkBBgFFwUVBRYF8QTtBOwEGwXoBO0E6QToBBwFGwUcBegEHgUTBR0FHgUWBRMFHwXxBO8EIAUbBfEEIQUbBSAF8AQiBR8FIAUlBSEFJAUlBSMF9gQiBfQEJwUjBSIFKQUmBfkEKQUoBSYF+QQsBSkFLAUqBSkFAAUuBf8E/wQuBf0ELgUrBf0ELgUvBSsFAAUCBS4FAgUvBS4FAgUwBS8FBAUFBQMFBQUxBQMFAwUxBVcFMwVbBTIFCAUzBQcFBQUHBTMFMwU4BTQFFwU9BRkFMwU0BVsFOAU1BTQFNAU1BTYFNAVcBVsFDAU1BTgFDQU5BTUFDQUOBTkFNgU5BTcFDgU6BTkFOwU6BfsGOQU6BWIFYgU3BTkFPAUXBRYFPAUWBR4FQwU9BTwFPgUZBT0FPgUaBRkFPwU+BT0FQQUdBSEFQgUdBUEFQgU8BR4FQgVEBUMFTgVRBU8FRgVFBUMFRwVABSUFQAVBBSEFQAVIBUEFRwVIBUAFSAVKBUQFSwVHBSQFTAVKBUkFKQVNBSgFTQVLBSgFTgVLBU0FTwVMBUsFKgVNBSkFKgVQBU0FTQVQBU4FUgVWBVAFVwUyBVgFLQVSBVAFLwVTBVIFUgVTBVYFUwVUBVYFLwUwBVMFMAVXBVMFVwVYBVMFWgV6BVUFbQVoBWcFWwVZBTIFWwVcBVkFXAVdBVoFXgVfBX8FWgV/BXsFNAU2BV0FNgU3BV4FXgU3BV8FNwViBV8FYwVgBV8FRgU/BUUFRgVkBT8FaQVlBUQFaQVmBWUFZQVDBUQFZwVGBWUFZwVoBWQFagVmBWkFfAWABX4FbQVnBWsFbgVqBUwFbwVqBW4FbwVrBWoFbQVrBXAFcAVyBW0FcgVxBW0FcwV0BXUFcwV1BW4FdQV3BW8FdgV3BXUFeAVyBXAFVgVzBVEFVgV0BXMFegV7BXwFdgV8BXcFeAV+BXkFgwWHBYYFVQV6BXQFegV2BXQFewV/BX0FfwWABX0FfwVhBYAF1QGCBYEFgQWFBTwEPASFBV8EPARfBF4EhgWJBYgFhwWKBYkFgQR/BIgFigWLBYkFigWCBIsFjQWjA4wFjQWkA6MDpQOkA5AFjgWkA40FkAWkA44FjwWnA6UDqwXDA6oF0gWpBb4DvwO8A6UFqQXBA8IDqQWoBcEDswWOBbEFxAOqBcMDqgXEA6gFjAXqA6wFrAXqA+8DrgWtBawFrwWxBY0FsgWPBbMF3gW1BbIFsAXcBa8FpgWnBaUF0QXTBacFqAXUBdgF1QXWBdQF1gXZBdQF2QXYBdQF0gXTBdUF1wVpB6sFqAXYBaoF2AXXBaoFDAauBfQDrwWtBbAFrwXfBbEF3QWzBbEF3wXdBbEF4AXdBeEF4QXfBdwF0wUEBgEG1QXTBQEGBgbVBQEGBwbWBQYGBwYFBtkF1wULBgkG1wUJBmkHCQYIBmkH2QULBtgFBQYKBgsG+AMMBvMDDAb0A/MD/AMNBvgDDgbaBQwGDQYOBgwGEAbcBdsFDwYQBtsFEQYTBhAGEQYQBg8GEgbeBeAFFAYSBuAFEwbhBRAG4AXhBRMGFQYUBuAFFQbgBRMGOwZzBnwGMgYvBgIGNAYwBi8GNQY2BgYGcAY2BjUGNQYGBgMGAwYvBjAGNQYDBjcGMAY3BgMGOAZ2BgUGBwYGBjYGOwY6Bm0HCgY8BgkGPAY7BggGCgZzBjwGQwZGBkQGPQb5A+QDPgb6A/kDPgb5A30GPwb8A/sDQAaBBg0GPwZABg0GQQYPBg4GgQZCBg4GQQYRBg8GQwYRBkEGRwYUBhUGEQZEBhMGQwZBBoUGvAZtBrgGRwYVBhMGSQZHBkYGSAYWBhQGTAZLBkgGhwaJBkUGdwY2BnAGvAZwBjcGcAa8BncGdQZ0BnYGdAZyBnwGdwZ1BnYGNgZ3BjgGeQZ6BngGOgZ8BnsGwQZ5BnsGPQZ9BvkDPwb7Az4GggZABj8GggaDBoEGggbIBoMGgwZCBoEGhQZCBoMGhAaFBoMGhgaHBoUGhwZDBoUGiAZGBkUGRgaKBkkGsgZuBq8GiwZMBkkGjAaNBogGigaOBosGjgaKBo0GzQaPBo0GjwaUBo4GkQZNBosGjgaRBosGjgaUBpEGlAaTBpEGrAauBu8GsAavBrEGsAaxBqsGqwaxBqwGsgawBrUGuAa1BrYGuAa2BrcGtga0BrcGuga3BrsGtQa4BrIGwAb3BrkGcQa4BrcGvwa6BrsGuwb3Br8Gvgb0BvUG/Ab5BnoGvgb8BsEGwAZyBnQGdQbABnQGwAa9BnIGuga/BnUGwQb8BnoGegb5Bt4EcgbBBnsGwgZ+BrUExgbFBoAGxwbFBsYGhAaDBsgGyQbIBsUGywbIBskGyQbFBscGywbKBoYGywaGBoQGzQaMBokGzwbOBokG0QbOBs8G0AbOBtEGBgfRBs8GzgbTBs0G1QbWBtQG2QbTBtAG1QbXBtYG2wbcBtkG2wbQBtIG3gbfBtoG3wbXBtUG4QbgBtgG4AaeBtgG4gbgBuMG5gbqBukG6wbmBu0G8AbsBu4G8Qa1BvAGHAfxBu4GsAarBvAGtwa0BrsGtAbzBrsG8wYgB/cG8wa0BvIG8Qa2BrUG8ga2BvEG+gb7BtwEJAf6BvkGvgYkB/wG/QYaBf8GwgblBP0GxAbDBsIGxAbGBsMGEgcQBxEH/Qb/Bv4GxwbGBsQGAQfHBsQGBAfJBscGAgfJBgQHAAcqBwEHAgcFBwMHBgfMBgUHCAcHBwYHMAcIBwUHBwfRBgYHBwfSBtEGMgcJBwgHCQcHBwgHCQfdBgcHCgcLB90GCgfdBgkHDQcLBwwHNgcMBwoHDQfgBgsHDAcOBw0HDwcOBzYH4wbgBg0HFAcRBxAHHgcaB0gHEgcOBw8H5wbjBhEHFAfnBhEHEAcVBxQHEAcTBxYH7QYVB+wGFwcWBz8HFwcYBxYHFQfuBuwGGAcVBxYHGQdDBxoH8gYcBxsHGQchBxsHGQcbBxcHHgdIBx8HHwdIB0cHIAciB/gGIQciByAHHgf4BiIHIgcZBxoHZAVPB04H+wYjBzsFOwUjB2MFIwdKB0sH+gYlByMHJAclB/oGJQdKByMH9gb4Bh4HPgUnBxoFJwcoBwAHKgcEBwEHKwcEByoHJgc+BT8FJgcpBycHTQcuBykHLAcrBy0HKActByoHLQcvBywHKQcuBy0HLgcvBy0HMAcrBywHMgcIBzAHMgcwBzEHNAcxBy8HMwc1BzIHVAc4BzMHMwc3BzUHOQc7BzcHPAc5BzoHPAc7BzkHPQc8BzoHWwc9BzoHPgdbB0EHPwcWBxMHPwcTBz0HRQdgB2MHSQdBB0AHQAdBB0IHQAdCB2AHQwc/Bz4HQwcXBz8HTAdFB0YHYQVgBUYHTAdGB2AFRAdFB0wHRQdAB2AHQwcZBxcHGgdDB0gHYwVMB2AFHQdEB0oHSgdEB0sHRwdEBx0HTgdNBykHTwdsBVIHTgdRB00HUAcuB00HhAVnB4cFUQdTB1AHUwdRB1IHcQVSB2wFVwdWB1MHVwdTB1IHcQVXB1IHVgdYB1UHWAc5B1QHOgc5B1gHeQVZB3EFWQdXB3EFWgdWB1cHXAdYB1YHXAdaB2EHXQc6B1gHgAVeB34FYAdhB18HYwdfB14HYQdaB18HWQdfB1oHYgdBB1sHWwc6B10HRQdjB14HXgeABWEFQgdiB2AHzgOrBWUHZQdmB2QHaAdmB2UHZgdnB2QHZQerBWgHageKBWcHZgdrB2cHbAdrB2YHCAZtB2gHageCBIoFagc5BoIEbAc6BmsHOgY5BmsHbQc6BmwHDwAQABEAEQArACMA5wFPAFAAUABPAFEAlwCVAGQAfwCsAKsAsgCzALYAygDNAMsA6QDuAO8AGgHwAO4A7QDvAL8AyQD4APYA/wDTAAMB4gDkABAB5ADjABEBFAEAAOYAFQFCAUEBQAFmAQwAjgGMAY0BdAF3AZYBpgGnAckBPQDZAdsB3wFBADsAQQDfAeMB6AHqAU8AJQL+ASICBQLmAeIB8gEVAhQCFQJBAkACeQK/AsMCdgK6AnkCgAKBAkoCiwKKAowCkgKRAo8CkwKUApACugLAAr8CzQLPAoUC1gLZApECuwK8AvgCAgPEAvcC1wIOAxEDugOiBbwD/gPTA9ED6gM1ADQA/gMZAKsBrQGxAQIExgEWBBUEKwQqBCkEjQSIBIcEwAS8BLsE0wTQBKME2wSsBN0EvATnBL0E6wTsBLwE7gTDBPIEMQUFBTMFFwU8BT0FQwVFBT0FTgVQBVEFVwUxBTIFbQVsBWgFfAV9BYAFeAV8BX4FgwWEBYcFqwXOA8MDswWQBY4FsAXbBdwFrwXcBd8FOwY8BnMGQwZFBkYGvAZsBm0GhwbKBokGRgaIBooGsgZtBm4GugZxBrcGcQa8BrgGvga9BvQG/QYRBRoFEgcTBxAHHgciBxoHZAVoBU8HTwdoBWwFhAVkB2cHXwJgAp0CagJpAqkCawJqAm4CbQJrAm4CagKpAm4CbAJtAnICtAJxAnIClwKaApgClQLaApoCnQKfAp4CmQKbAp8CoAKeAp8CogJlAqECoQKeAqMCngKgAqMCogKkAmQCpwKiAqgCpAKiAqcCpwKoAqYCogKjAqgCqQJpAqUCqwKqAqYCqQKqAq0CrwKtAq4CrwKuArACcgJtAqwCcgKsArECtwKvAu8CsQK9ArUCtgK9ArECsgK2ArECsgKvArcC8QK2ArcCvQK5ArUCvAK5Ar0CvQK2Ar4C2gLdAtsC3AIUA90C2wIYA98C3gLfAhoD4ALeAh0DqAKjAuQCoALhAuUC4QLjAuYC5QLmAiMD5wLkAuoC6wKrAuwC7ALoAuoCKgPsAuoCqwLrAq4CrgLtArAC7gLsAiwD7wKwAvAC8ALuAi4DtwLvAvIC8QK3AvIC8AIzA/IC/AK8Ar4CtgLxAr4CvgLxAvUC8QLzAvUC/QL2AjoDGAPdAhkDGQMUAxcDGQMcAxgDGwMYAxwDHgMdAx8DIAMeAx8D4wLgAh4D4wIeAyEDIQMeAyADIgMhAyAD5gLjAiEDIwMkAyUDJAMiAyYD6gLpAicD6QIjAygDJwMoA14D7AIqAywDKQMnAysDLQMsAysD7gIsAy4DLgMsA2EDYQMsAy0DLwMuA2ED8AIuAzADLgMvAzED9AIzAzIDMwM0AzUDMAMxAzQDNgMyAzcDOgM9AzsDPwM6AzcDOgM8Az0DPQNCAzkDFwMVA1EDGwMcA1QDVQMWA1MDVgNVA1cDIAMfA1gDWANUA4IDIgMgA1sDWgMiA1sDJgMiA10DXQMiA1oDKAMlA18DKwNkA2IDLQMrA2IDYwMtA2IDXwNkA14DYgNkA4sDLwNhA2UDjgNhA2MDMQMvA2YDLwNnA2YDaANpA2YDNAMxA2YDNANmA2kDNQNpA2gDaANqAzUDbANrA2gDmgNrA2wDPgM8A20DPgNuA0IDbQOYA24DPwNqA2sDbQNrA5oDUQNSA34DUgN7A38DfgNSA38DgAN+A6gDUwOAA1cDggNWA1cDhAOCA4MDWQOEA4UDiAOGA4cDXQNaA4YDXQOIA4kDYwOLA4wDYAONA2QDjAOLA40DjwOOA4wDkQOSA48DkwNmA5IDlQNsA5MDlQOaA2wDbQObA5gDbQOaA5sDmwOZA5gDmwOWA5kDmgOWA5sDqgOoA6YDrAOpA6sDgQOpA6wDrQODA6wDhwOvA4gDrwOFA5YFiAOvA7ADsQOIA7ADiQOxA7MDsgOzA7QDtQNgA7IDtgO1A7IDsgO0A7YDkAO1A7YDjwOQA7cDkAONA7UDkQO3A7gDlAO4A6AFuQOUA6AFlAO5A5cDugOWA5UDlQOXA7kDlQO5A7sDugOVA7sDogW6A7sDrAOrA5MFkwWrA5IFrAOTBZQFrQOUBZUFlgWVBbwFsQOwA5gFtAOzA5kFmQWzA7EDmQWxA5gFtAOaBbYDnAWQA7YDtgOaBZwFnAWaBcMFngWfBZ0FtwOcBZ8FnAXGBZ8FoAWhBbkDuwOkBaIFvAOiBaYFtAWPBbIFtAWyBbUFqgORBbYFtgWSBaoDkgW2BbgFkwWSBbgFkwW4BbkFlAWTBboFlgW8BbsFlQW6BbwFuwW8Bb0FlwW7Bb4FlwW+Bb8FwQWZBcIFmwXBBcIFnAXDBccFwwXEBccFxgXHBfQFxwXEBfQFngWdBckFnQXGBcgFzQWeBcoFzQXKBcsFpAXOBc8FpgWiBaQFpwWmBdEFpAXPBaYFpgXPBdAFtQXeBRIGtwW2BbUFtwW1BeIF4wW4BbcF5QW5BeMF5AXlBeYF5AW6BbkFvAXkBb0FvQXkBecF5AXmBecF6QW9BegF6wW/BewFvwXqBewF7QXrBR8G7QXABesF7gXCBe8FxQXEBfAF8gXFBfAF8AXuBe8FxAXFBfQF9AXxBfUF9QXxBfMF9QXzBfYFyQXIBfcFygX5BcwF/AXMBfoF+gX3BfgF0AX+BdEF0AUxBv4FzwXOBQAGMQYABv0F4gUSBhYGGQYXBhYGSAYZBhYGGQYYBhcG4wXiBRcG5gXlBRoG5gUaBhsG5gUbBk8G6AXnBRwG5wXmBRwG6AUcBh4G6gXoBR0GHwbsBR0GIAYiBiEGIwbvBSEGJgYlBiQGKAYnBl0GKwYpBmIG9wX2BfgFKQb2BSgGKgb6BSsG+gX4BSsGLAb8BSoGLQYsBi4GMwb/Bf4FMgb/BTMGMgYCBv8FaAYxBi0GaAYzBjEGNAYvBjIGbwY0BjMGSgYYBhkGSwYZBkgGTgZKBksGTQZOBksGTwYbBkoGHAZPBlAGHAZQBlEGHgZRBlUGVAYdBlUGmQZYBlcGIgYdBlQGIgZUBlYGWQYkBloGWgZYBpkGJgYkBlkGJgZZBl8GXwZbBmAGKAZdBmEGXQZeBmEGYgYpBmMGYwYoBmEGYwZhBmQGZAZhBqMGZgYrBmIGqQZiBmQGaQZqBmsGagavBm4GagZuBm8GkQZOBk0GlwaSBtYGVQZTBpYGUwaSBpcGmgabBpUGlQbXBt8GmgZXBpsGlgaXBpsGnAaZBpgGnAaYBp0GngadBtgGmAbfBt4GmQZcBloGmQaaBpgGoAadBp4GnwagBp4GoQagBp8G5AahBp8GXwZgBqMGowZgBqUGowalBqQGpgalBqIGpwamBqIGqQakBqYGqgamBqcGqganBq0GpwaoBq4GZwapBqoGqgatBmcGaQazBq8GswaxBq8GswasBrEG5QbkBp8G6AbkBuUGqAbqBq4GbQJsAmsClgKXApgClwKVApoCnAKZApgCnAKYApoCmwKZApwCmwKcAt4CYAKWApkCnQJgApkCmQKWApgCnwKdApkCoQJlAl8CXwKdAqECoQKdAp4CowKiAqECogJkAmUCpwKlAqQCqALnAqYCqQKlAqoCqgKlAqcCqwKtAqoCpgKqAqcCbgKpAq0CrQKsAm4CrgKtAqsCrAJtAm4CsgKxAqwCrAKtAq8CsgKsAq8C7wKvArACtAJyArECsQK1ArQCtwK2ArICvgK8Ar0C4gKfApsC2ALcAtoC3QLaAtwC2wLdAhgDmgLaAtsC3wKcApoC3gKcAt8C3wKaAtsCHQPeAhoDoAKfAuEC4gKbAt4C4ALiAt4C4wLhAuIC4wLiAuACowKgAuUC5AKjAuUC5QLhAuYC6AKmAucC5wKoAuQC6ALnAuoC6QLkAuUC6gLkAukC6QLlAiMDqwKmAugC7AKrAugC7QKuAusC7ALtAusCsALtAu4C7gLtAuwC8AKwAu4C8wLxAvIC8gLvAvAC8wLyAvQC9ALyAjMDvgL1AvwC9gL8AvUC9QI2A/YC9QLzAjYD+AK8AvwC+AL8AvsC/QL8AvYC/AL9AvsC+wL9AjsDbQM/A2sDFAMVAxcD3QIUAxkDGQMXAxYDGgPfAhgDGgMYAxsDHQMaAxsDHgPgAh0DHwMdAxsDJAPmAiEDIwPmAiQDIgMkAyEDJQMkAyYDJwPpAigDKAMjAyUDKQPqAicDKgPqAikDKwMqAykDLAMqAysDXgMrAycDMAMuAzEDMAMzA/ACMwMwAzQDNgPzAvQCNgP0AjID9gI2AzcDMgMzAzUDNwMyA2oD/QI6AzsDOgP2AjcDOwM9AzkDPAM6Az8DPQM8Az4DPQM+A0IDUQMVA08DFgMXA1EDUwMWA1EDHAMZAxYDVQMcAxYDVAMcA1YDHANVA1YDVQNTA1cDggNUA1YDVAMfAxsDHwNUA1gDIANYA1kDWwMgA1kDXAMmA10DJQMmA1wDXgMoA18DXwMlA1wDZAMrA14DYQMtA2MDZANfA2ADYwNiA4sDjgNlA2EDZwMvA2UDNQM0A2kDagMyAzUDaANrA2oDqwOoA6oDPgNtA24DPwM3A2oDUQNPA1IDUwNRA34DUwN+A4ADgAOoA6kDgQNXA4ADgQOCA1cDgwOCA4EDhANYA4IDWQNYA4QDhgNaA1sDhwNbA1kDhgNbA4cDhwNZA4UDiQNcA10DiANdA4YDigNfA1wDigNcA4kDiwNkA40DYANfA4oDtQONA2ADjAOOA2MDkAOMA40DkAOPA4wDlAOSA5EDZwNlA44DkgNnA44DkgOOA48DkwNoA2YDlAOTA5IDZgNnA5IDkwNsA2gDlgOaA5UDkwOUA5cDlwOVA5MDpgN/A6cDfgN/A6gDpgOoA38DgQOAA6kDgwOBA6wDrgOEA4MDhQOEA64DrgODA60DrwOHA4UDsQOJA4gDswOKA4kDsgOKA7MDYAOKA7IDkQOPA7cDlAORA7gDmQOWA7oDpwORBaYDqgOmA5EFkgWrA6oDlAWtA6wDlgWFA64DrgOtA5UFlgWuA5UFlwWwA68DrwOWBbsFlwWvA7sFmAWwA5cFwQW0A5kFwQWbBbQDmgW0A5sFtwOQA5wFngW4A58FuAO3A58FnQWfBcYFngWgBbgDoQWgBZ4FuQOjBbsDowW5A6EFpAW7A6MFzQWjBaEFtAWRBY8FtQW2BbQFtgWRBbQFuAW2BbcFugWTBbkFlQWUBboFvAW6BeQF6QW+BbsF6QW7Bb0FmAWXBb8FwAWYBb8F6wXABb8FwAWZBZgFwgWZBcAFwwWaBZsFxAXDBZsFxwXGBZwFyQWdBcgFyAXGBfQFygWeBckFygXJBfkFywXKBcwFzQWhBZ4FowXOBaQFzgXNBcsFpgXQBdEF7gXEBZsF4gW1BRIG4gXjBbcF4wW5BbgF5AW5BeUF6AW9BecF6gW+BekFvwW+BeoF6gXpBegF6wXsBR8G7QXCBcAFwgXuBZsF7wXCBe0F7wXtBSAGFwYaBuUF8QXFBfIF8AXvBSUG8wXxBfIF9AXFBfEF9QXIBfQF9wXIBfUF9wX1BfYFzAX5BfoF+QXJBfcF+gX5BfcFzgXLBfsF/AXLBcwF/AX7BcsF/AX9BfsF0QX+BQQG/gX/BQQGMQbQBQAG/wUCBgQG0AXPBQAGAAbOBfsF/QUABvsFFgYXBuIF5QXjBRcGSgYaBhgGGwYaBkoGHAbmBU8GHQbsBeoFHQboBR4GIAbtBR8GIgYfBh0GIAYfBiIGJAYjBiEGIQbvBSAGIwYlBu8FJQYjBiQGJwYlBiYG8gXwBSUG8wXyBSUGJwbzBSUGKAb2BfMFKAbzBScGKQb4BfYFKgb8BfoFKwb4BSkG/QX8BSwGLQb9BSwGLgYsBioGMQYzBv4FMwY0BjIGbwYzBmgGMQb9BS0GSwZKBhkGUgZPBkoGUAZPBlIGTgZSBkoGUwZQBlIGVQZRBlAGVQZQBlMGHgYcBlEGHQYeBlUGVgZUBlcGWAZWBlcGWAYhBlYGJAYhBlgGWgYkBlgGWwZZBloGWwZaBlwGVgYhBiIGJwYmBl0GXQYmBl4GXwZZBlsGXgYmBl8GYQZeBqMGowZeBl8GYwYpBigGZAZiBmMGZgYqBisGLgYqBmYGqQZmBmIGZwYuBmYGZwZmBqkGawZlBmkGawYtBi4GaAYtBmsGZQZrBi4GZQYuBmcGawZvBmgGbwZuBjQGagZvBmsGTQZLBosGkAZOBpEGkwaQBpEGkgaQBpMGkAZSBk4GkAZTBlIGkwbWBpIGlQaXBtYGVAZVBpYGkgZTBpAGlwaWBlMGlQabBpcGmgaVBt8GmgbfBpgGVwZUBpYGVwaaBpkGmwZXBpYGnQaYBt4GmQacBlwGoAacBp0GnwaeBuIGXAZgBlsGoAZgBlwGoAZcBpwGYAagBqEG5AalBqEG6AalBuQGogalBugGpQZgBqEGpgakBqUGogaoBqcGZAajBqQGpAapBmQGpgaqBqkGrQanBqwGpwauBqwGZwatBmUGrwZqBmkGZQatBrMGswZpBmUGswatBqwG1waVBtYG5QafBuIG6QboBuUGqAaiBugGqAboBukG6gaoBukG4gLhAp8CbQM8Az8DqwOpA6gDpwOPBZEFzQXOBaMF7gXwBcQFFwYYBhoG", "g": [[0, 9162, "skull"], [9162, 2238, "face"]]}, "ear": {"s": 4.122684762792715e-06, "p": "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", "n": "k8DwitAGj9LbiNvul8Pbh9r7i+TYhO3rg+36kPHGkALFggDwh/jbhQnigf//xJLtrKH684Tp1IkGBoH/pMHEzaS5z5TT+4zMCJyyp6rirK7Q6sCUmdrBur+s5aylrtKqoeuutu2bx9WX2+qJANuHoP+tvgKU+f6BlroAksQUm78phuALhucXieUkjdMfktkyg+8Khfcgje4yl+RCl/NHggALgwMWi/8yt5oQz5Ah/IQZ84wxoK4OqKsiw583pr8+zqRIDpVC+KFUpNVMvMRZ2rVgGLNi/MRwrutfxdZo5+N5pARYyPxyyA9xiw3Rgg78nyK2kBzKkC7ZiR3dhBTrhBv7iCbumUDbiCn/k0DxpVbomhK2tBGb0xyN/x+FtSeinCy/3zeStT2t10qhBkiYpUDDz1iyrVHN9Wu9B16ruWDV227L2nbmoFMKtmb3Bn3shBcNhgwgixEvlQpEihwkiCIalR49jTEWlTMuojZDjzoFm0gc6B95rh1dqi1SzURe2zJvsUlD3VRYD1FgvmsR53QurFAzuGEm02JE/mVN/3sf43sILozoR5cDIpXFE66hUa7LQ6+5Rp3ZYrffbsPwWabxabkCJc6RNLyiTM+mXsu8Z8bRU+ajZt+8czYCex8KcTEeLu2LIQ6GSgCZbO/Aaf24dx4ieQ8kcwU1fggNe/weeNgDcdzTctDlfRIPaUYSY0YlUGIHfOT8fBgJePTZfQsUZzM3aSI/fgsLdf8xewbgehAefAYdZxJJL4wTLZErWqoYS6czZLwoMqhNW788UMZQPMxjeSTxdSHbY99JHdZ1K+l1TOBhZ/BJffrtfRD0eQ7cbhbECvd+9QR+QQFtU/RgZQFNb8YUb84jaEn3fgwCbTnifOsUczLta9Y1aizKfgz+e/ggdhjYfwT+XBGqc+8zfOwTGTCNPx+WRTWkaCbCdt4hbMoodM4QLEykUkS7MV24MWfJVVDOC3XQVlnkMHHgTWUDZ0v8GnwLMnT0cA/GZ/dKYx+3ePIofBHpato7f/wKaTzbazHQeNsUeSPzdtIFex//a0Hrf/oBeP3YdunYbwLCcOvHHhF6SRRmZBRMfOQAeuPscdTYXipKEz9sHiZ1QSxkc8r8ccrqRUJUXEA8R2YcI2s6VFIwYkofNFpJJHIrfwL+f/77fPjofAwYf/3/f/8Cf/4Ce+rqf/v+dCMnf/cAbTckaEgN", "i": "AAAoAAEAAgAEAAAAAwACAAAABgAcAAIACQAcAAYABgAHAAwACAADAAUAJQAgAAkACgAlAAkACQAGAAwADAAHAAsADQAMAAsACwAHAAgACAAwAA4AEQAWABcAEwASABEADwAWABEAFwAVABgAGAAVAB4ABAAaABkAGQAaABYAKAAAABAAAAAZABAAEAAZAA8AGQAWAA8AjwAeABsAHwAdABwAHgAVAB0AHwAgACIAIwAkACIAKAA8ACkAKwAFAAEAAQApAC4AKwAuACwALgA/AC8ALwA/AEMABQArADAAMAArACwAMQAwACwALAAtADEANgA1ADEANwAyADQANwA0AHMAOQA4ABIAOQA6ADsAKAAQADwAPAAQADgAKQA9ACoAPwAqAD4APQA4ADkAPQA5AD4APgA5ADsAQAA+ADsAPwBEAEMARABAAEUARwBFAEYAMwBDAEgASABDAEkASQBDAEQASgBJAEcASwA0AEgASwBIAEwATABIAEoATADSANMAWwAKAE4ADQALAFQAVAALAE8AUQBOAFMAUQBTAFIAYABRAFIAUABbAFEAYABQAFEATgANAFMAVABTAA0AVgBTAFQAVQBUAE8AVABVAFYAUgBWAFkAVwBZAFoAWQB6AG0AXQAnACYAXgAnAF0AYABfAFAAYgBfAGAAYgBhAF8AYwBkAGEAYwBiAGYAZgBkAGMAZwBmAGUAaQBmAGgAagBnAFcAZgBnAGoAbADzAGsAagBaAG4AbABqAG4ATwA1AHAAcAA1ADYAcQA3AHIAdQBxAHQAcgB0AHEAdgByAHMAdwB1AHgAeQB4AHYAewB6AHcAfQBzAEsATQBLAEwA0wBNAEwAfgB2AH0AfgB9AIAAfQBNAHwAgAB9AHwAgAB/AH4AfwB5AH4AfwAUAYMAhgB7AHgAhwBtAHsAewCGAIcAgQB/AIgAfwCCAIgAiACCAIkAhQCLAIQAhQCKAIsAEwCMAI0AjwCRABgAjgAXABgAjAAXAI4AkACTAJIAlQCNAIwAlgCNAJUAlQCSAJMAGwCYAI8AJACXABsAnACXAKEAmACXAJkAnACZAJcAJwChACQAoQAnAKIAnAChAKMAvwA6AL4AvgATAI0AQQA7AL8AwAC/AL4AwwBCAEEARwBGAMYA0gDLANQA6ADkAKMApQCjAOQA5wBeAGEA5wCiAF4A5wDoAKIA8QDwAPMA9QDxAPMA9QD0APEA9gD3APQAbwD1APMA+AD2APkA1gDUANUADwEOAdYAFAF8ABUBFQENAQ4BDwETARYBGwEtAfYAhQAgAYoAIAGFABwBiQAcAYUAHwGJAIMAIAEbAfgAGwH2APgABAACABQAAgAcABQAAwAGAAIAAwAAAAUAAQAFAAAACQAgABwABwAGAAMAAwAIAAcADAAKAAkACwAIAA4AEgAQAA8ADwARABIAGgAUABUAAAAEABkAFgAaABUAFwAWABUAGwAeAB0AFAAcAB0AHQAVABQABAAUABoAHAAgAB8AIAAhACIAHwAiABsAHwAbAB0AIQAjACIAJAAbACIAIQAgACUAJgAhACUAJgAjACEAJwAkACMAAQAoACkALgArAAEALAAuAC0ALgApACoALwAtAC4ALgAqAD8ACAAFADAAMgAxAC0AMgAtAC8AMgAvADMAMwAvAEMANQAOADAANQAwADEANwAxADIANAAyADMAOAAQABIAOQASADoAOgASABMAPQApADwAKgA9AD4APQA8ADgAPwA+AEAAQAA7AEEAQgBAAEEAQABEAD8AQgBFAEAARQBCAEYARwBEAEUANAAzAEgASgBIAEkASQBEAEcAcwA0AEsA0gBMAEoAWwAlAAoADQBOAAwATgAKAAwADgBPAAsAUQBbAE4AZQBgAFIAZQBSAFcAUgBTAFYAWABWAFUAWQBWAFgAWQBYAHoAVwBSAFkAXAAmACUAWwBcACUAXABdACYAJwAjACYAXwBcAFsAUABfAFsAXwBdAFwAYQBdAF8AYQBeAF0AYwBhAGIAYgBgAGUAZQBmAGIAZgBpAGQAZwBlAFcAagBXAFoAawBmAGoAawBoAGYAagBsAGsAWQBuAFoAWQBtAG4AbwDzAGwAiwBsAG4AbACLAG8ATwAOADUAcQA2ADEAcQBwADYAcQAxADcAcwByADcAcABVAE8AdQBwAHEAdgB0AHIAdgB4AHQAWABVAHAAdwBYAHAAdQB3AHAAdwB6AFgAdQB0AHgAewBtAHoAeAB7AHcAfQBLAE0A0wB8AE0AfQB2AHMAfgB5AHYAeAB5AIEAgQB5AH8AfwCAABQBggB/AIMAhABuAG0AhABtAIcAhwCFAIQAhgCIAIcAiACFAIcAgQCGAHgAhgCBAIgAggCDAIkAiACJAIUAiwBuAIQAiwCKAPgAEQAXAIwAEwARAIwAjACOAJIAkgCOAJAAkgCVAIwAlACVAJMAlACWAJUAGwCXAJgAjwAYAB4AJAChAJcAowClAJwAvgA6ABMAvwA7ADoAwAC+AI0AlgDAAI0AwwBBAL8AwQDDAL8AwQC/AMAAwADCAMEARgBCAMMAygBKAEcAywBKAMoAygBHAMYAzADKAMYAywDKAMwAyQDMAMYAzQDMAMkA0gBKAMsA1ADLANUA1QDLAMwAzQDVAMwA1gDVAM0A6AD8AOQAXgCiACcAowChAKIA6ACjAKIA5wDpAOgAZADnAGEAZADpAOcAZABpAO4AaADwAGkA8ADuAGkAawDzAGgAaADzAPAA8QDyAPAA9ADyAPEA+QD2APQA9AD3AAcB+ABvAIsA+AD5AG8AbwD5APUA+QD0APUAfADTAA0BDQHTANIA1AANAdIADgENAdQA1gAOAdQAFAGAAHwAFQF8AA0BFgEUARUBFgEVAQ4BFgEOAQ8BGQEUARYB9gAtAfcALQEbAR4BHAEbASABHAEdARsBHQEeARsBiQAfARwBHwEdARwBIAH4AIoA6ADpAPwA1wCrANoAjgCRAJAAkwCQAJsAjwCYAJEAmQCaAJgAnQCaAJkAnwCgAKYAoACeAK8ApQCkAJwApwC3AKgAqAC3AL0AqQCmAKcArQCbAKwArgCtALgAqwCUALIAswCyAK0AsQCyALMAtQCsALQAtgC4ALcAuAC2AK4ArwCwAKAAugCkAKUAuQC9ALwAuwC1ALQAvAC9ALsAvAC7ALQAvQC1ALsAvQC3ALUAwwDBAMQAxADBAMIAxQBGAMMA3gDFAMQAnwDHAJ4AxwDbAJ4AxwDIANsAyQDFAN4AxgDFAMkAzgDQAM8AyADHAM8AyADPANAA0QDfAMgA1wDCAMAA2gCrALIA2gDYANcA3QDcANoA2ADEAMIA3wDgANsA3ADdAOAA4gDhAOAA4wDWAOEA5QCqAKgAqAC9APsAqgCpAKcA/wDrAOUA5gDlAOsA7QAQAeYAZADuAOkA7wDpAO4A8ADvAO4A7wACAeoA8gABAQIB9AAHAQEB+gC6AKUAugC5ALwA/AD6AOQA+gD+ALoA/gD9ALoA/QDlAPsA/QD/AOUAAAH/AP0AAAHsAP8AAQEEAQIBAgEAAf4AAwHsAAABBAEDAQABAwHtAOwABQEXAe0ABgEFAQMBBwEGAQQBBwH3AAYBCAHOAM8ADAEJAQoBEQHOABABEAEIAeYAEQEQARcBEgERARgBEwEqARoBHwGDABkBIgEhAQwBDwEhASIBIwEkASIBJAEjASoBGAEnASYBFwEFAScBKgEoASkBGAErASkBGAEpARIBKwEYASYBJgEsASsBJwEFAQYBjgAYAJEAmACaAJEAmwCQAJEAkQCaAJsAnACdAJkApACdAJwAnwCeAKAApgCgALYApwCmALcApgC2ALcAqQCfAKYArQCUAJMAlACrAJYArACbAJoArACaAJ0ArQCTAJsAuACtAKwAsACxALMAsACvALEAsACzAK4AsgCUAK0ArgCzAK0ApACsAJ0AtACsAKQArAC1ALgAtgCwAK4AuAC1ALcAoACwALYAugC0AKQAugC8ALQAxQDDAMQAxQDGAEYAyADfANsACAHPAKkAzwDHAJ8AqQDPAJ8A0ADRAMgAlgDXAMAA1wDYAMIA2QCxAK8AsQDZANoA3QDaANkAsQDaALIA2wDdANkA2gDcANgA2ADeAMQA3ADeANgArwCeANkAngDbANkA2wDgAN0A4QDJAN4A4ADeANwA4ADhAN4A3wDiAOAA0QALAeMA0QDiAN8A4wDiANEA4gDjAOEA4QDNAMkA1gDNAOEA+wDlAKgA5gCpAKoA5gAIAakAqgCnAKgA0AALAdEA6QDqAPwA7ADrAP8A5QDmAKoA6wDtAOYA7wDqAOkA7ADtAOsA8ADyAO8A7wDyAAIB8gD0AAEB5AD6AKUAuQD7AL0A/ADqAPoAuQD9APsA6gD+APoA6gACAf4AugD9ALkAAgEEAQAB/gAAAf0AAwEFAe0ABgEDAQQBAQEHAQQBzgAJAdAACgESAQwBDAELAQkBEAHOAAgBCgEJAc4ACgHOABEBIQHWAOMA7QAXARABGAERARcBGgEfARkBGQETARoBGQGDABQBFgETARkBHQEsAR4BHwEaAR0BHQEaASwBDAEhAQsBCwEhAeMAIwEiAQwBJQEjAQwBJQEMARIBKAElARIBKgETASQBJAEPASIBJQEqASMBEwEPASQBGAEXAScBKQEoARIBKQEsASoBLAEpASsBGgEqASwBJQEoASoBLQEnAQYBLQEmAScB9wAtAQYBHgEsASYBHgEmAS0B1wCWAKsA0AAJAQsBCgERARIBIQEPAdYA", "g": [[0, 1119, "ear"], [1119, 681, "earIn"]]}, "body": {"s": 1.1285573856203463e-05, "p": "Y55qwMDt5JyFwM8F4JdgzhrvZ5vU0KPcHqEmw6/de5YtzwgAs5RK4HzjkZvq43jNtpPu71Xd2o4f76H/9Y9w73DukJF83+X6Q5jH/9nN8Jl48SzMS5Hz/4TiVI4BANv0b7MXiY38MagPoYzbdq+xlm7ZnbYol7PQ7K8noX7QbKIvoszpmat9kHbvTaggm/Xg6Ky/kUTm3KRHmYzwiKWElxj+B6tAkFj7SasVqJnTVKZSraTarq8hq/rN/aAIq5Pp6aARsr/qe6SGqU3fS6Hdn/H39aAmpUUFD5/Cqqn4zaAHuakAv63jyrK9f6ZouZzd2aSvxCDSxqjex4zHgawHt8TS87FMvuTB/6ITupDoHaEiut3y2KI51bjHHqvp2NC4Y55q0yLSVKgk84K0q7By7b2rNKSN5Na92aEG8sm9u6ps5lS0DKzD//KuMKHW/4i9qscMi2zUjrR+imzpxL4ciMjfbLwqheLtjcl5gmfobrv9hFf+/sW2gdnxdsn0gEkBXbisjmzZTLkJnUPKhcKkkfDNu8Pjm13F4rpfsFLE/MMsq/u/SbNXtHfKc7r/pAXG0LnNw2+0z74UuYm3hbOEzly0qreN2Cyr2b/xyKurZb742y+kFMkly5ej18Gi9hKc3sZD4OWc1LkF8cGidbfwBN+jj8zxhPfe5dE6gCHyGNYogyLjJduAgKn+A8xPl93FKdhgm5LCR9HlinDS6dVDkI/LI9w6ryarjc7io+C+Yctnu3Crts5Nr+OyY9PJ3o+WxtDB0Jqc6tt206CWasvi8M+W7srHC6+W09YA8IeRIdymiNbX1t6wgQTw5d5thDzjVujtg+Pwmueuhy3g2uYxg6r/5d0io/W1rufwl0y/5t4ulFPJ4ePyjRTSqvIYkMbHROhBs6+j1O8pp5irRenOoNuzLvAvuhydW9iUvC+jjtyLxOWcQ+gJyQaXAeC73qSRP+b2572N6OkQ+uqK8t4k+tSNzvGvhHXj+v9bgSfusv+zhencEPL3gCT6AAABgAAALADJmDG5mfNilt69LPS6nY20VwC1i/nN9PHPilnSevZnr8uj5wTxpS2rWwbSruGjQ/afxLWWGANuuW6cxwSiw9OWG+3T0vKRfv4Gz6iRPfZq6puKAPno2smN2vVo+SGJ5AcS+PGIafs7BsGI6J5ywS8XzJcEzwUSGZNi3vURcpZr4KMivY/W74IQiJMg8CEi6Jmm8K0zGpr04FMt8o3q/1sHXJG0/8QdPpgFACkynKXgma8HeqXCn78Pxa0kkLwJfK0ils0UZag1pZAZwbBOm9ceh6GfrIMLJqSjtRcRNahUsX8ala5foykhPqzvt18tFKLguCoNgqGxwtIi56oysZ4flqYhxiozCq6dyodCSpxH0r4n6aKM1Ps3QagP1xZCDaF04+U8gqVu8tJHka8s24FNIq195rBODqEFAEZCg6g/B4tMr7DDAN5VE7BI9IRUmbfNi20S9LuBhlwJPsRlhqgSz8C6jSUemstajT8i+baykv4cNLfenbgmKb0Vl24mxMRvlNonJsNHoHsvh7Q+qkcpWLzdpJwtqrhNsDU4/sM3qYY9AL3MtHxC469nuwQ4yrbTwERGUsSyvQVRkL6NyyFV1MPQwNFTAcPgwxld78etwWBlwLOYzu1LALs+17lXXbwJ3VBhF8BCzFZffb8O2XVldMMH1XhpN7kO4tBZ27ik7SJcAb1x7Vxlvb8C6TppRbrj+Qlf8b73+HBnF8LwAa9pic0Pg5oNDNjGgvQMVM9Nh30Z/c0gl+8s6s0ankA4HdUgkh4qbtmYlwQ49c2lsuhPbdDjo0dChtWJqTBMp86zsFVYz9R7qlFbEdV7q9xPMdREr+NjwcgVubVclMlDuBhSb8oMyExrRdD6uQ1p/dRYwwVxZ8ye0Odv/tFM2QZ19scB4dpvV8hX9uRwvdHW7ZB2Vdys9qh63dH2AFR1t99Oh5YWBeRuhB4L7dl1jXkjkeQyjCsqi9uynT9CAef5lDc8IOPDoS5LB+14nm5MFe1tnHxeMd3fpRFOZd1Go55X8uC1octdjeN5omdN5ugZnSxVud0+r2NrxuIHpU5lB/FcsSVzyu4pqrhuleC3tYRwJeZovhl2xd3vzzR41O4Vyjd7Dums3Ch9P96x4dl6d+hH8NR9Nem4Aup8KPHLgT4M7vDBhHgcyf9LgVkR5PGwilstKwCnhQQj6f+siXstwfI7kHc4k/+DkX48evapnBRLq/OYlm5Ct//nm95KkfZbmd5bjfacmfdTWff3m6BiDwXGmrRhqfAxocRnA/twnyBo2f4GqD9vrvYavCh4WQGHw9d6e/kq3Td/RAdn0/Z9CPfA8d1/JPoIB3t+eZfrDh/SUZ61D8LDD5D1D4Ptr5NdEJXd1o6mEEr//ZmOHp3SjZ7DLPbRvJRkIBPkq5HTIBEATZIVIVD0zZdXMcfuOJvpLvPc7p7IPj3pYaFOPXfdeJbLMBAAhZ2LP4T0E53hPxgA+q/QC5erPKiaDJa0z6qgGT60eKE6HEbCRqRHKsDEOq4RJp+02ar5NVjCkbN1MUa0qrTRQL+9oqTyOi3SYqlTSrzcNa89RtvKZbXXU8XSQKb3TAnuYaXZTQAAtbKKVlDdwrC8WOPogK/fWU30Rq+DWiMApsG4DbqcAbuRGcmjsLPlHYurDcMALK2jNr4jNeKr6rlGPGO0ncEJRla0d7izTxXI8byCS+a9mcKSWeTHMcZdVKW9vr/5Xa/SNc2tYofJdr01YY/dLbzbY57oqLrlZFH0/8aEbTPvebqAZSAA38bPbt7/2dQ+BYCRBdlIFYmRQMeaIOGcPtFrL2uc59JbIcSWhuC9ItOR39zCOm6c0cseRNCqMtBbPDqjfsqRTjG0N9yYUPaq89FnWTm5ydXtce7f0Ng0ayLNw8lUak/dRdSBdejzL9QvdhkA+uSdCS6Mq+rdHKyNVN3oLZyWCu1rLMuR++iANqmW5d3iR9Kjwer1Qzmd0+rFVD+pFt56W2+0PempY7+4qttmYs69g+UQbfjHfOQJdQnZ3eIreYHoYOKdexoAxOITe0j0F/Hkfkv6mvSUFdWKrPxMJciNo/m3O4GWufsDMbeRRPv7Rr6cLvkcUdujh/MPZv24g/s3WlCrJPPRb4rHpv8aZw25HgBsdDXOwvEudWTSLgB+emDdovGhe5rkAAD/fwAAuY+PEPoPpZMEEHci85moD7oz9KHrDWBC/JIrIfgRJpfHMKUMspejHoIntZ5DHSk4Yp7jLJwt956xPioXx53pPwcMiJr5L5gfe6EmPf0iNrBgDJlUYqSTG2hC6628GMNPcaVlKjo9xKRAO8Mt3qiLOEU42K1CNVRCmLN1Mb5LoqUETAkSBqtASsQnFLDwROw3ibajPnhGpq/1WVEMnrLuWCMdP7iYEJ9b7sYKEGVqG7+LDaFhc66vJcVLVb87JINcurewJ8JUIcAPN5RU77wkS3ZCpcHJReJL/bosZawLKrVDU74tTr0YYWQi5bjKT2Y4ur/6XUstw8LiWds33buWY2oXBMjObPMWkc+0D0hx7sj/HtBkV9DEHMJsTsdfMEtdFNF3PaZcmtCDKAJmf9bwNsZiRtpsMelmocrBTsJLu8rkQ6xUJMaTVBNCyNtCWsZLtdD7W6hCbNvIUHNUZsdsbqQLJ8nFaQQjONYvcZ8ifc3vY880ptl1aB04j9c3baotA9S9dGsRv9sPCit4n+JXFd93tdweHg9zatgtJkpt0OJ6LOBu4ulLOtpnbfLbNbdtfuGNSWhc5OwiTmFcFuTLQM5iAPeSRkdj3OpbV2VUueXgb1QzuttfYkJCC+gEZFpGuuIPe7IL/uIpeZwXP/FUfMwXw+MudgUjK/J8Fu96Du3EJUJ1JP5nIjt4GAW0NJhvnPvGLvhyAvj0PR9oQQSvPv1no/kwUR1cGfsPWtNU7/Lhb1E4TfRVYmVLTvOMaTVC1P81Z9JGLPE3fikMBgClftkRWPGxd7InTgBNehcjqf9HdBAyJg7nhH7ikw4egWsG2w7HgerzVQ0gkLnHsgx0lsu9swurnZu0Mg7jij7StBKqtgWgqRSoyG2WaBCO0zuR7Qnc6O6K/gs03cKNzCVfiJrXCBhohADtvRj7h2/ftSLLgAr0aSE5hajgRBktg6b/5xitl9m/SB+/kU/MXyckm5PCuxstjYTToyrTjZXOlCQ4r42rCBUmpbGuyyFnpH20URqGv5Wcfx6Dtouj5SWYxuucLyAs35CRIyNZ0q6WMRis5rONhRlT9PeLtRYXBAWLfx/UB0KNoTR7ia3VVSnYgjnkIzFYgeDqeDMbhZDe8zqjghDsfzALgBb5NTZzgccEWS8wljXGZzk/kL7NwDhbltXHeDDDokq/NyxKqmC03TV0sXa0HjuSqq6/7C6JwlqjGTE/uImrlEDruB230Cwy332WTjAQ0QGdVjvO0XejOirF8N+RRjj133qcECoxCSORJTb+/8uWfz49h8DfYkNphdPsPk20i3fpmj/kgtn4JUMthWEFgEuOiNH0LztgnxrDEj/IjGPVZEUrmgrLIUiskmnUWUpajQ3fekQjsM/DpUespWjHRFHgqAvP8U1vtN7LHz1RxSerfElmwYm5D1JOtqfQMkgY17iraEyLzkK0jVFR2ju0KFK+yqy9OjhB7WmZOkMN4fCj5kYw8H+jQED//xKdwEj9/wGkClJZjbT38U/ll0bXkE0an/7OVVXgoejWvlYYlkfmqVcLnL7fS1bMksrusF1BoBntG1j/k3v8qlt3mX/zJF9OofD8OFtIpOrgH1kwrf/Z2F26sRjmJ14VqlHmA2Eir4z2imA+p932RVeix8/HKVd+txrZlVyAwsXXvllfuXze4VwUuijosF7cuWfyUF9EuT8Aj1qb1cbCnmEd02TSeGUH0Gjgyk+g82erFVJE5z2wfVfB+HWznltt5Ji9DF4V8qC9TWG/4tvH8l77/7q9SWHKwQLpZGMUwVAAkmhRzp/zoWiL4DLaEma48EDMBG3V3gjuW2z874ndJXD27pXvVW4t3+//MnF771UAwmcNANrNpG5MADviDHIoAKH4VA5fhGgbFQ7aisAt+gwZk3E9vwmYnO1KhRXFnphKtQWdmGNV5wm2mdRcuxJTm7pZORBZnvJjKBIynalPygPUtOJ1TAxgo8Nq8Q24r5xyBhJsw2Z5XwhE6M5/cgw2+k5/xRt/hKEL8x4Lh50WhCfigDgEcyIuiakbmig3g6QOfhoCi8MnfRrwkgg4dSZGlUE0ShgtmVtCYySNnRdC8RrCniFWWRpZoE1g1hkroVhNoyCzpNVMQycnp3pUBSfJpvFbthiFpU9oCCfOqtdj+Bx4rDZsoyX+s45sQR0gulRzqyfAzcp1YRwJ1NN6mBWv5Q9+4CLx6et6PBxN/Uh8ICyf+il3iTTnhPsSejFOjIYhnDksip4bjCk/kAYnbjR4mWwuOzJbnoE47jsyqYc9oii6qQ9Ogy/ho1BCBzRns/hOMTHBsYlQ6TB/s39hwjQItelaPTYZuFNS/TU3vKBj8z6Swn1R+TyHwy1cyintwftwkyyRtxNqJDT+w+ZqDTvPxPBi7DPN05ZwuCrr5e93MTJl5jN0ijco+15wXkLUiKMSXUzkiosImENFjzUdcTvKkTglBUO6mIQnIUpIk78c9UvRnzEl8z61oQ0vjU+urRgmvkizqIwrsUdksM83KUKHti5FIlCSuyg4SkrPwdFFOz3nwr5UcEx/zrFLBUE+z51eaURF1PhWN1Cn2+pN+z/+011kxTxW1U5pSEQt4dxg9EYq495ZIkeM72BcwjpD6pxuj0Iu6z1m8UV7+pte+j/a/SxoAlCLkbkRZ1SFkd0GWFp7mjsJ/liHojgV5lxqpBIN+1JCmL0WaFKyoXcf61o+teYTW11Ut7ELil9Sq/UGSFjBqUEZ21V2sdkdL1T5t6UsoV7CwpkiJ1UHyqg9YlsaxdYtyGQX0Q0jgl8e1DQzzldU1zFCEmG94pM4QFmi5w5HJlAH7nxTxFdm82pL+1t6APNGW2Glv5MRZ2euz+sWgWkTz0YEs23r3rALR2un3/Ab8W8L8H0SUmyd72QiA2Zy4WMtr2FL8D48h2gV8eEtrHH7/yYLtW4NAHwdvWc5ACcyVgULCxuJ7AMiGMuKchQMFi2MYQzlItKN+grXOw+XgAymLouR0xriM2OWfAuFRWecYQ23T4WjPxBnWD6rJgubZSS4QQ3Db4XHWRj5Y7y5YA4edUXSPwCwfnvukg6te9Tkww45ftHzQg/TfgEA4xi7KNiREyOxHcWR8xwiQBWdLy4cN4SfbShNQvqisBz9Sguk/h+eWICwXyRNYrG9LxuXb6jM3yfGatTMJRwwdvHczCk0cXHdGB0weZPoAh57e3L6FTMEE7CWZjzMFbWc1SpjJI6WqDRgJ4mcwDt0QX6uYywiSxWrzDWSTm+05SvZVVK0qi8CXKq9RjL2YQDIzjl2VL+9fTU/Z93UbivzdEPuDzhtbMHnKznFbtz/mCtLdhoA40Z8D3CjcFAjBVCryDy9LVekiEJ3H4yjnExVHGqrsUMlMtSrLUnzPaS4AEMzS4S9Nz2vWdjHUEfCT9THEEAHXnrScEIlYTTdh05DWHjkJkSRY4notzhZbjH0DkUiZVP0sEVgZQEAflqSDS64eFloGtm5olAdKCm0vlfxKOq9F110KwXI9lFjNXm9YlmFOmHNHVCZRPzHg1OcSOrSfl5PPS7dtlfTS77iEWGnPuXofVoGTrH/IFpoTY3zvEqzU73SslCJWvH/c1DpWTT0FWayD1rMeGzgD9/dhGl9HyLdGnDAEPDuLXG6ECEAhGPyHt7M52yeIQvucG6EIBsFtmO5LULYaGKlP130NGj8MPvth2nOMPP/82LZPxMA6waeGPt6URA7DK98SwyEJ5J1/ROcMQRvIQdKRnxjkhKvO+Bn5hMgRPVidhbUYlFI8Q0RUCpcLBDXWGhUpwwEbVE91AtGYnNLqw5yfaoScg5kea8ikRxOdmEiBw4wdaot6BcRGKl4BCXgD8p2UCcqH7pw6Bw8IuFzCyP3MmlnsCBBScZb3SPGUNpUmikVb6UoPBrMbJQ4WBs7cp0tmSZpaAU4fSOmXnhHTB0leVwXXB0Le5sLfS9gDWxyeTlDBvxs9Tj3EBZqNC+EHkpsMjI0JdVlXjYaNiFc6yG7Kyxt3SRCOcxjMSypQA9cnzSZRJBUVj2pWQw4yDDNXhE+wzC0UZpMyTlxVExCfziFbncLITi2bNoWqTYIaqwipjRcZt4tnivOdBoSKENOBqxggExWF/FVQT0XFQNjbkEVI05cVkhzJ9RUMEYzPJFLJ0APN1VUWj4RRq1LL0NASztCYEvrQBhCFkfFT3E4qEE3X9sosEqHU6gtJEUKZfELIkR/Y8sXrFfcDH5LRVWUGaxLJ176DTdCGVB5BRhV4lQXJzBHzFtzGypCtljYOpUzKF3HKkg4e0x8MaRLQVIdNU5Cu1k0TcoQr1aoSnAizVPIR68toF5JPX0i7k/KRBM4TFAIWnAMSk4/V2YeC3CQEJARSmwSEKsiEGaHDtQzTGu2H4QcnWGWLN4tb2QWHIgyIGigMeUQmWQsL1wjXGEdQFAS", "n": "j8nujsgFitPvjtbcksrdidQAiOPjj+fNh/LcgvEAg/HuhOP7jADNjfPLhQDhgQD1uZcGltnGqbnEuriyp9evid3jpajxmMbUp6zck8LvlL0JpKkEmvC2kADEpfeohfjjhA3mi/PQiNj+huYWgfv/hOYFodC7jOfSmMrPnM3Fl+W/psO+h+zhhOb2l9nFn922kdjRnPWypu6ol+e9lfO9oOewof+slQC85Zi9u5nl05LTzo3u64bkz4sI5IX27IMOwaLGv8mi2Kit1seWrtaow8aho9yxvuOXrsmwtL6yqdKvrNyntc2ntd+fwM+eufiXvuOXr/KfrQSg8ovR/oH1BofaDoIJ7rSc6Kqm/Je5BKOq1rOk1LmgwsClxrSszOKQydSW1taPw/ORwwqR0fGLEZHFFoTxGIncA4LvAojXAYEF16iu45u4+Jyy/ZLB8JPA47ic7auj5KWs7b+V0sGc18iW5MyQ2+GL4+qG5/uE2fqH74bgAIPsAIjY74L5AIEAAJyy8pm386KsAY7H743O9rObBaqjCLOb9ciOA72UB8eP6teK/9OJ9eyD+N6G9PqCCfmC+QaBkcgZitQThuISieQig/ERh/EjjvI1jeUvgQAIhQAejAAzlMMbkdYtq6cepbg0lOQ9qsVIhv0jieQhjwg5o95Qn74wkMUMlMklldc3mcs1oc9Fj9Yoltg5nNxGledAmfRKo99QouhSlP9DnQZPpQBYpPZXwJwtzI8c344t1p1D7ZxMvK1Dt8xayLdX3K1awrJOpspItMFPrLU8ua9DsrpIpME8q8VKrr1GmM01lcIckcodoc1Dp9NPltw8jewykNcsl+dDo+RSlOtAl/VHkv4/n/lSmwRNmwtMpBRV9IYiCYYh94852KJMxaM+y5Us0Zs9qKwlx6hJw6M+n64Eq6QTraELsbM+mbobnrEPr9latMZUxthpueRmx+9wtPRltAdmyP5y2AZ4xg9w+Igo/oMW6JA4348w06JJ4ZhD1Zg83Y7U2I4nvpMFuJf7wpciyY4F0IvyyrxdzKdK7cpx5bpm08tq39h01+d27uV76PN82fd56AF96A987oMO7ocgAIMU740zAIcnAIw08JI+AJRC7IQU8JpK/4MV7oQV7YTq75I9CI4346VT+aNX/rpq9dd4AeB7+fN+COx99wJ/+xF+iw3Rkg7Cgw7uhw7dgg//jRvRkijQiB3jhB0BhR30iizujirckTnnlDjciSwAkDv1jzoApgyonAyznheylRrAmCbCoiOynjG/qC2wqDy6mDbPnEXbokHIqE7QmEftl0gApVHbo1PnolT0oVUAuAyYsRefqRyouSmftDGmrziwt0GvrErEsUa5t1TDvFC5tFnPw17FsVzbr1/mrWD0vGrtrWAAu2v/zgSL0xOLvx2XySyWyx6Q2yCL1zeVw0Clxzidwkqt1UykyVWzzG7d0GjIv2bZy3Lxy3MB4gmF5xuG2CuP6imK5jOP2EOc50GW51Gh2Fes5WCx1F+54GrC3nLU3Hfm23oB3Hny7n358xOD/CKG+DiO+y6K+0OU+E2b8WKx+1ek8WzAAGSyAHLH7nPOAHnY7nrhAX8Bgw8Rhw4jjQ41lg1Ehh4TiSsNixwokho5kSkwkTkZkDoMjSsglDgkpQxYmRhGoxdTmSZAlzYwnDQ7ojFFqC1QmEYUnUQpo0A7qzpKolQOpVIfrRFfqiFXpxZXoiJOtSFhrSRZtjNasUZHt0FRrmANqE4xsVwmrUo9tFkxuFU9r18ZvGgavx1ptCdeui1gvi1jyjpjvzFhzzRpzjpmwktSwkBbvFBH1VVTx1dJ1Excu2oMvmUnzW4mw1860mQ/z2oyy3IT1Rd13R920SlvxjZj1z1o4kJo7Edo20Vk6Upl3j1q9UNr5lRc4G061F9I42BN3HkM3Hcb7nsc3nQn8B566DBz/Sp4CEVq+jpx9kRrBkVq+k1l+1Zd8W0/8V5U8WdIAGRO7X0MAX0U7nYsAXknAHI5EIfeEYIIEYPzEJPBD5m3D6GtEIzOFbqYGMyPE9eJCuuDDd+G8pHE/YPq/ojV7IP36IrXAIEEHZy4BZm2GKinAZHD+56wK7SkGqqmJ6iuH8SUJbqdK8qWJeKKKNWPHeiHHvWFGASDJQeHEJPA94bdCIPqDorSHYbrCIH/FIQUB7OcH6SuH7WeKLegNa+tP7euPcegN8adOr2lS76xNOKQONWXRdWeMPOLQeKXMQiLPQCRKJDUM47qSpzkKIcAMIwVQ5T6J86SLJy/PcClQay6RKDRT9SnR+SaXvGsXuGxR8qmVsa2Z+m5U9unV9KwXt6xXs+7Qe+UTuSgUfGfSQCYVAChVKH/VrvAU9GsZty9YrjcaMrQX67udtjoZrUHb8P3eNkJcuPRb//DeQzdevbdfwb6fe37ZMvGaCO/asnVdOjTeuvife3xfOcGZ9rAb9jQc9XgW/WoXemtY/mxZ+i6avO8b+bHbAG9cMnocskAdtTzduTZc/LLeuLuefLdffHve+L+fvEBdADNewDifwD4EoYfEY00EJZDEoQWKI8qCoL0EoUcJ4gJH5hCI4nnBM91E61eFMZvFt54CPx/DAh+A4MWCock9oMSDosw+IclII4uIJY9Lpk6HpxJLKFHOY/3NpcvOI/yO5IaUJ70T58WK6tUR61BLbthOcNgJtJwMeVyH+x5F/l9Jf15Hwt7NQlzEIotC5lJHpU+HJZAMKVLPKM/R69DSZ0eOalISrJDWKYTWLU1ZbQQZLUTX8Q8V8RHcMkZOddqSMVWUNVZZtA6RuhnMvh0QPltSwpmMpQtR5obNaFCI6dUObxaR69DT89XQ7ZPYs5AVMRKVLY8TbtKXcE8VsdKa8MgWNJPc9omadk8XN9RbOM9XOdTc+4zaulCaPhJUvxhafxHZQJNYw5PUKgtXKwZbcUebdw2duYnXb85X9hLdd4leuQWfPoab/Q9bdo1Yr4wbMgkYs9AaMsxctYlbNg1ZNtFbeY7ZelJXPFWY/ZOaABIcMgTddQXd9QEe+MNeOMdffISefIjc+UubvM+dfMvfwALewAfdAAzBwqCBBaDGBSFDiCGDTiPDiyKITCPDkKUEEybFFSjDWKwEGy/HmGzEnPOAH3sEnrhE33xEn4BHiWKKRuLITyVNjOZMT6dIUidJlSoK1+4ImzGMGfHI3PYM27ZI3fnJXn5OxKRRRSXMSKQPSSXRT2oNEakQEmvNFKuOVi4PF3DRFC4QGPSNXLsQ2jkRWsANXMAUQ6gXAapRiufTB6fWBmoTy6oVTm1T0a5SVXDVErETFnOT1zaXFLiUV7nRWrzUmDzU2AAZgy2Zhi4WyWwZSW8aifGXjG6ZzXLXD/EYkPSbDjbZUbhbznnaUgAaEfyWE7QX1UAXlTzcg7KeQ7ddxzdfQ/vfg8AcBvLeh7ufB0FcSrYcDr0diztdyz/cToBBx97EhV8EDF0HUJpCENrGUJpGUFrHF9QEExkFFVcD2pEDV5UEnwVEngmJHQmEXM0HCF4LBt0Ni1qJS5wMDpmJkVkKk1cMmwsIGlAIW8zL2U+KlpPJXcbJHkMPxxrUxddViNXRi9fRC9gPzFiMzxjLDZqND1jPkBbSVU8OltEOk1TRU9IRGoMQ2gaQmYlP2E0NXIVXhFUVxVaVR5aSyFhVCVYUTdQSzJaSUFRT0ZHWDxGU0o8TlosWE4xUmANUV4bYw1PYBdQawxDWwVYYSRKaRlDZjU2aSc8Vy5RYDBEaEcSZUUkYkIvbDgkXD88XlQOXFIgfQ8SeQ4kcg02eB0dbygvcRkzdiwSciskbzoT", "i": "AQAAAC0ABgADAAIAAgADAAQABQACAAEAAgAAAAEACAAHAAYAMAADAAYABgALAAoACQAKAAsANwANAAwADAANAAgAmgAPAAkAEgAUABMAFQAXABkAGAAXABIAEQASABcAIgAZABoAGQAYABYAFgAYADkAHAAUABEAIQAVAB8AHQAhAB8AIAAdAB8AIQARABUAHQAcACEAFQAiACQAJAAiACMAIAAfACQAJwAqAB0ABAAnACwABAAsAAAALAAgAC0ALQAgACUAAAAsAC0AJgApAC8ANQAyAC8AMgBLAC8AMwAvAC4AMQAyADUANAAzAAcANgAxADcANwAxADQAOgBAADgAPwA9AD4APgA7ADwAEwAUAEEAQAASABMAQAATAEIAQwBCAEEAGABAADkARQBHAEQAXABDAEcARwBBABQARgBHAB4ARABHAEYASAArACYARABGAEkATABIAEsASgAvAEsATwBQAFEANgBRADIATwBRAFIAVAA8AFUAPABTAFUAVQBTAFkAPgA8AFQAPwBUAFYAWQBCAFcAWQA4AEIAWgBZAFcAXgBdAFsAWABcAGsAXgBJAF0AWwBdAHQAUABOAE0AUABgAE4AdQB0AE4AYgBQAE8AXwBgAFAAYwBiAE8AXgFiAGMAXgFkAGIAZwBVAGUAZwBlAGkAaQBlAG4AZgBnAGgAaABnAGkAVgBUAGYAagBWAGgAbABrAHIAbQBuAFoAWwB0AHAAcQByAFsAdwBhAF8AegBkAF4BaQBuAIQAaABpAHsAewBpAIQAfQB8AHsAaAB7AH4AfgB8AH8AggBsAHIAgQBsAIIAgQCCAIAAbwCAAIMAgABvAIEAhQBxAHAAggByAHEAgACCAIYAhgCCAHEAhwCGAIUAigCJAIgAeACOAIsAeQCPAI0AkACNAI8ACwAFAJQAlAAFAJMABQABAJMAkwCtAJUAkgCpAK0ACwCWAAkAlwCUAJUAlQCZAJgAlQCtAJkAmQCuALAAmgCWAJsAnACbAJcAlwCVAJgAnQAaAJ8AngCgAKEAIwAiAJ0AIwCeAKMApQCjAKEAoQCiAKYAoQCmAKoAqACkAJIAkgCqAKkAqQCnAKsAxwCrAKcApwDEAMcAqwDHAKwArADHAMgArwCuAKwAmACxALQAsQC3ALYAtQCxALYAtwCxALMAuAAQALkAPQC5ABAAvQCgALgAvQC7AL8AxADCAMUAxADFAMYAyADGAMkAyQDGAOIAygDIAMkAygDOAMgAzwDOAMoA1ACyAM8AtgC3ANUA2wDcAN0APwBWANwA3QC6ANsAvADdAPcAwAC7ALwAvAD3AN4A3wDgAOEA3gD3AOAA+QDfAOEAxQDBAN8A4wDfAPkA4gDkAOcAyQDqAMsA3ABWAPYA9wDdAPUA+AD1ABAB4AD4AOEA+wD5APoA5AD7AP4A/gD7AAEBAQH7APwA5wDkAP4A9gB+AA8BEgETARQBEgEUARYB+wD6ABcBJwEOACoBDwCaACsBOwEoASwBLgEqASkBKQErATABMAErAS8BMAEuASkBLAEuATIBMgEuATEBMQEuATABMQE1ATYBNgE1ATcBMwExATYBOAE5AToBOQE3ACgBOQE2ADcATQE4AToBOgE5ATsBPQE7ATwBLQE8ATsBPgE9ATwBPAEtAUEBQwE+AUEBQAE+AUMBQwFCAUQBNAEzAUUBQgE0AUUBRQE3AUYBRAFCAUcBRwFFAUgBSAFFAUkBSQFFAUYBOAFSADYATAFgAUsBQAFQAT8BUgFTAUABVQFRAVMBVAFEAVYBRwFIAVgBWQFYAUgBVgFHAVgBWgFJAUoBbAFYAVkBXAFaAUoBWwFZAVoBXAFdAVoBYAFjAEsBYQFiAWABYgFfAWMAYQFgAU4BZQFRAWcBbAFrAVcBagFrAWwBbAFWAVgBWwFsAVkBbAFbAWoBagFbAW0BbgFtAV0BbwF6AF4BXwFvAV4BbwF5AHoAZAFxAWEBZAFzAXEBdAF1AWQBdgFoAXcBaAF2AXQBeQF4AXcBegF4AXkBewFrAWoBiwF6AXsBjQF7AXwBfAFqAW0BbgF9AW0BfgF8AW0BjQF8AX4BfwGNAX4BjwB5AG8BgAH/ApEAgQGAAXABgQEAA4ABggGDAXIBgQFwAXIBdQGCAXMBhQGEAXUBhwF2AXgBdgGFAXUBiAGGAXoBiAGJAYYBigGIAYsBjAGLAY0BDQOMAY0BjwGaAJsAmwCcAJABLwErAY8BkwEvAY8BkAGTAY8BkwGQAZUBlQGQAZEBNQEvAZMBNQGTAZQBlAGTAZoBlQGaAZMBmwGYAZoBkgGRAbQAnAG1ALYAnwGWAZ0BrQGfAZ0BoAGaAZcBoAGbAZoBoQGXAZ8BowGiAa0BRgE3AZkBpAGZAZgBtAGlAaYBpwGhAaIBqQGkAaUBqQGoAaQBnAG2AKoBrwGeAaoBrwGqAa4BvAGuAawBowGnAaIBowGvAbABsAGvAa4BtAGmAbYBtgGmAacBsgHDAbEBSgGoAbMBuQGzAagBqQG1AbkBqQG5AagBtAG3AakBuAG3AbQBuAHMAbcBsQHDAcUBXQFcAbMBugHJAbMBygG6AbkBygG1AbcBsAG/AcQBwQG+AcABwQHAAcIByAHEAb8BzAG4AcUBxQHDAccBwwHGAccBxwHGAd0BbgFdAckBugHPAckBzwFuAckBywG6AcoBywHPAboBzgHLAcoBzQHOAcwBzAHHAd0BwQHZAdcB2QHYAdcByAHbAcYB2wHeAcYB2wHXAdgBzQHcAc4BfQFuAc8B4AHhAd8B3wF/AX0B4QHwAd8BywHgAc8B8gHhAeAB6gHYAdoB2QHVAdoB1QHWAegB1QHoAdoB6QHoAdYB6QHaAegB2wHqAesB7AH0AfIB3gHuAdwB7gHsAdwB8gHzAeEBgwD4AfsBhwANAoYAigD8AYkAjgD+AYwAjAD+AYoA/wGOAI0A/wEAAo4AFAIAAv8B/wGNAJAAFQL/AZAAIAAnAB0A9wECAgYC+wH4AQoC+AH5AQcC+AEHAgoCCgIHAggCEAINAvwBDQIMAg4C/QEPAvwB/AEPAhACEwL9Af4B/QERAg8CFAISAv4BEgIpAhMCFQIUAv8BLAIVAhcCAQILAhgCAQIYAhsCGgIbAhwCGwIYAjACHQIcAjMCHgIdAjMCNgIhAh8CCwIIAh8CCwIfAiACDAIjAg4CIwInAiQCIgI2AgkCJAIlAiMCNgIiAiUCJwIMAiYCJgIrAj8CLQIrAioCGwIwAhwCGAI3AjACMQIcAjACMQI6AjICNAIzAjUCMQIyAjUCOAIgAiECNgI4AiECTQJMAjgCKAI7AiUCJQI8AjYCPAI4AjYCOwI9AjwCPAJNAjgCJAIoAiUCPgI7AkACQgI/AisCQgJDAj8CQAJDAkUCZwJHAkgCSgJmAkgCTgJMAk0CTAI6AjkCOgJMAk8CTwJRAjICVAJRAk8CUgJPAlACVAJPAlICMgJLAjUCvwI1AksCSwJRAlMC3AJTAlQCVQJUAlICVQLcAlQCVwJOAj0CQQJXAj0CWQJSAlYCWAJaAlkCWwJSAlkCWwJVAlICXAJAAkUCPgJBAj0CXwJdAkECXgI+AlwCXgJfAkECXwJYAlcCXwJXAl0CYAJfAl4CbQJgAl4CYgJaAmECRQJDAkQCZAJcAmMCZQJeAmQCYwJEAmkCawJjAmkCaAJmAjADbwJhAm0CbgJhAm8CbQJeAmUCcgJvAmUCZQJwAnICcgL0Am8CdQL0AnICcwJwAnECcwJyAnACcgJzAnQCdQJyAnQCdgJ1AnQCcQJqAmwCdwJ4AnMCeQJ2AnQCeQJ0AngCEwERAXoCewITAXoCFgEUAXsCfQIZAXwCfQJ8An4CBgIEAowCiwKMAo4CiwKOAo0CjwJ6AosCiwJ6AooCkAJ7Ao8CqAKPAo0CkQKPAqgCfgJ8ApICkgKQApMCfgKSApMCpQKOAh4CjAIdAh4CjQKlAqYCqQKRAqgCqAKmAqkCkQKpAqoClwKtAqwCrgKvAqwCpQI0Ar4C2gLDAr8CwgLDAsQCqQLCAsUCxwLEAsYCyQLIAssCtALJAssC1ALQAu8C2ALVAqEDSwLbAr8C4ALDAt8CxgLgAuQC5ALgAt0C5QLkAuECYgLjAloC8gLnAuECygLIAuYC6QLKAuYC6ALKAukC6ALLAsoC8QLwAvoC+gLuAu0C1QLvAqED8ALvAu4C8QKhA/AC8gJiAm4C9ALyAm4C9ALzAvIC9gLzAvUC9gLqAvMC9gL1AvcCdgL1AnUCdgL3AvUC+AL2AvcC+gLtAvkC9gL5AuoCeQL8AnYC/QL7AvgCAAMBA/8CFgKQAP8CAQMWAv8CAgMAA4EBBAOBAYMBBQMEAwMDBwOEAYUBiQEJA4cBCgOJAYoBjAEMA4oBDgMbAwwDFwIWAgEDEgMBAxEDFAMFAxMDBwMTAwYDFwMHAwgDDAMbAxkDHQMcAxsDEAMeAw8DIgMfAyEDIgMhAxQDMQMiAxQDMQMUAyMDIwMUAyQDJgMkAxcDJQMkAyYDJwMmAxgDKQMlAycDKAMnAxgDKAMYAxoDHAMqAxoDKAMqAzcDLAMqAxwDPQMrAy4DMANKAi8DIgMyAyADNAMxAyMDNANCAzMDNQNCAzQDNQM0AyMDNgMjAyUDNgM1AyMDNwM5AzgDTgM4AzkDOgNOAzkDPAM7AzoDPwNQAz4DOgM5AyoDLAM6AyoDPQM8AywDPwM+Ay0DQAMwAzMDQANoAjADRANWA0EDRANDA0UDRwNFAzUDRwNGA0UDOANIA0cDRgNHA0gDSANKA0YDSgNLA0kDSgNNA0sDTQNMA1oDTANdA1oDSgNIA04DOwNNA0oDTANNA1ADQANRA2wCeAJ3AlIDUwNSA1EDVAN5AngCVQN5AlQDUwNRA1YDVwNSA1MDVANYA1UDSQNLA1kDWQNTA1YDWQNbA1MDWgNcA1sDXANXA1sDXANYA1cDZgNiA2QDYgPpAWMDYwPpAWED6wHqAWYDaQPvAesBaQPrAWcDZQNpA2cD7wFoA/QBaQNoA+8BZQNoA2kD8QFrA2oD8QHzAWsDZQNnA3QDdgNtA2gDeAN3A3YDZQN5A3YDewMQA2oDewMeAxADbAN6A2sDgwNyA4ADcwODA4QDcwOEA3QDhQN0A4QDlgOIA4UDiAOJA4cDhQOIA3QDigMtAy4DigMuA44DjAOOA3UDeAONA3UDhwONA3gDjQOHA4YDhwN4A3kDegNsA3UDkgORA5ADkAORA48DlAOVA5MDrAObA5kDmQOXA5gDmAOUA6cDPwOtA08DrQM/A5wDrgOdA5oDrQOcA50DhgObA5oDmQObA4YDLQOKA5wDnAM/Ay0DnAOKA4sDmgOdA4wDmgOMA40DngPxAqADoQPxAp4DoQOeA58DogOjA6UDowOgA7QDkwOQA6IDkAOhA58DkAOfA6IDpAOnA6IDogOmA5MDqANdA0wDtwOoA6kDqwO3A6kDqgOkA6kDmAOkA6wDrgOtA50DrgOoA60DqQOoA64DmwOpA64DqgOpA5sD/AJ5AlUDsQP+ArADsQPxAv4CrwNVA1gDWAOyA68DtgOzA7IDtAOwA7IDtQNcA10DtgO1A6sDtgOyA7UDtwO1A10DAQAtACUAAgAEAAAAMAAGAAcAMAAHAC4ABgAKAAgACwACAAUACwAGAAIACAANAAcADQA0AAcACgAOAAgADAAIAA4ADwAOAAoADwAKAAkAEQAUABIAGQAXABgAIgAaAJ0AGgAZABsAGwAZABYAEAAbABYAFgA5ABAAHQAeABwAHAAeABQAFQARABcAIQAcABEAHwAVACQAFQAZACIAKQAmACsAJwAoACoAKAArACoAKAApACsAKgAeAB0AKgBGAB4AKgArAEYAhQCJAIcAJwAEACgAJQAgACQALgAvACkAJgAvAEoABAADACgAMAAoAAMAMAApACgAMAAuACkAMwAxADUANQAvADMABwAzAC4AMQA2ADIADQA3ADQANAAxADMAOwA5ADoAPAA7ADoAOwAQADkAEAA7AD0APgA9ADsAQQBCABMAOABAAEIAQAAYABIAOgA5AEAARQBEAEkARwBFAFwAHgBHABQARwBDAEEATABJAEgATABdAEkASQBGACsAKwBIAEkASABKAEsATQBMAEsATQBOAEwATgBdAEwAJgBKAEgAMgBNAEsAUQBNADIAUQBQAE0AUQA2AFIAWQBTADgAUwA8ADoAUwA6ADgAVQBZAGUAPwA+AFQAWABaAFcAVwBcAFgAVwBCAEMAXABXAEMAXgBcAEUAXgBrAFwATgB0AF0ASQBeAEUAYAB1AE4AXwBhAGAAYgBfAFAAZABfAGIAXwBkAHcAWQBaAGUAZgBVAGcAVABVAGYAVgBmAGgAbABYAGsAWgBYAG0AZQBaAG4AbQBYAGwAbgBtAGwAbwBuAGwAhABuAG8AawBeAFsAcgBrAFsAcQBbAHAAdgBzAHUAcwBwAHQAcwB0AHUAYQB1AGAAYQB2AHUAdwCLAGEAiwB2AGEAeAB3AGQAeACLAHcAegB4AGQAegB5AHgAeQCNAHgAfQCEAIMAfQB7AIQAfgBqAGgAfAB+AHsAgQBvAGwAgwCEAG8AhgBxAIUAiABzAHYAiACJAHMAcwCFAHAAfwAPAX4AiwCIAHYAiwCMAIgAiwCOAIwAjACKAIgAjQCOAHgAjwCRAJAAkwABAJIAlQCUAJMAkwCSAK0AlgALAJQAlwCWAJQAmACZALAAmQCtAK4AlgCaAAkAlwCbAJYAmACcAJcAtACcAJgAGgAbAJ8AngCdAKAAoACdAJ8AnwAbABAAoACfALgAoQCgAKIAogCgAL0AowAkACMAJQAkAKMAIwCdAJ4AowCeAKEApQChAKoAwgCqAKYAqAABACUAkgABAKgApAAlAKMAqAAlAKQAkgCkAKoApACjAKUApAClAKoAqQCqAKcArQCpAKsArgCtAKsArACuAKsAsgCvAKwAsgCsAM4AsACuAK8AsQCwALMAsgCwAK8AswCwALIAsQCYALAAtQC0ALEAuQA9AD8AuAC5ALoAugC5AD8AuwC4ALoAnwAQALgAvgCiAL0AvwC+AL0AuwC9ALgAvwC7AMAAwQC/AMAApgCiAL4ApwCqAMIAwgCmAL4AwwDCAL4AwQC+AL8AwwC+AMEAwgDDAMUAxACnAMIAyADHAMQAyADEAMYAywDKAMkAzgCsAMgAzwCyAM4A1QCzALIA1ADVALIA1QC3ALMA2AC2ANUA2wC6AD8A2wA/ANwAuwC6AN0AvAC7AN0AwQDAAN4A3wDBAN4A3gDAALwA3wDeAOAAxQDDAMEAxQDfAOMA4gDFAOMA4gDjAOQA+wDjAPkA5ADjAPsA4gDGAMUAyQDiAOoA9gD1ANwA9gBWAGoAEAH2AA8B9QDdANwA+AD3APUA9QD2ABABEgH4ABAB4AD3APgA+gDhAPgA+QDhAPoA9gBqAH4AlAE3ATUBEAEPAREBEwEQAREBEgEQARMB+gD4ABUBFQH4ABIBFQESARYB+gAVARgB/AD7ABcBFwH6ABgBFwEYARkBFgEYARUBGQEYARYBKAE3AAwAKAEMACcBKgEOACkBDgAnAQwAKQEOAA8AKwEpAQ8ALAEnASoBLAEoAScBLQE7ASwBLAEqAS4BLQEsATIBNAEyATEBNQExATABNQEwAS8BMwE0ATEBOAE2ADkBPQFNAToBOwE5ASgBOwE9AToBPgE/AT0BQAE/AT4BQQEtATIBPgE8AUEBNAFBATIBQgFBATQBQwFBAUIBNwFFATYBNgFFATMBRwFCAUUBSgFJAUYBSwFjAE8ATQFMATgBOAFMAVIAUgBLAU8ATAFLAVIATQFOAUwBTgFgAUwBPQE/AU0BPwFPAU0BTwFOAU0BUAFPAT8BUAFRAU8BUQFlAU8BUgFAAUMBQAFRAVABUwFRAUABVAFVAVMBRAFSAUMBRAFUAVIBVAFTAVIBVgFXAVQBRwFWAUQBSQFaAUgBWgFZAUgBWgFdAVsBYwBfAV4BYAFiAWMAYgFjAV8BYQFxAWIBZgFkAWEBTwFmAU4BZQFmAU8BTgFmAWEBZQF0AWYBaAF0AWUBZwFoAWUBZwFpAWgBVQFnAVEBVAFpAVUBVwFpAVQBVQFpAWcBaQF5AXcBVwF5AWkBVwFWAWwBawF5AVcBbQFbAV0BcAGAAW8BYgFxAWMBXwFwAW8BXwFjAXABYwFyAXABcQFzAWMBcwFyAWMBZgF0AWQBZAF1AXMBdAF2AXUBaQF3AWgBdwF4AXYBegF5AWsBewF6AWsBfAF7AWoBfQF+AW0BfQF/AX4BbwGRAI8AgAGRAG8BAAP/AoABcwGCAXIBcgGDAYEBdQGEAYIBeAGGAYcBdgGHAYUBiQGHAYYBegGGAXgBiAGKAYkBiwGIAXoBjAGKAYsBjQGLAXsBfwENA40BfwGOAQ0DKwGaAI8BkAGPAZsAkAGcAJEBkQGcALQAlgGVAZEBlgGXAZUBkgGWAZEBmgGYAZQBmgGVAZcBmAGZAZQBtQCSAbQAngG1AJwBkgGeAZ0BmwGkAZgBrQGdAZ4BnwGXAZYBoAGXAaEBnwGiAaEBrQGiAZ8BpAFGAZkBqAFGAaQBpQGbAaABpgGgAaEBpgGlAaABpgGhAacB2ACqAbYA4gHOAdwBngGvAa0BngGcAaoBrgGqAawBrwGjAa0BpwGjAbABsAGuAb4BtgGnAbEBsQGnAbIBsgGnAbABsgGwAcQBqQGlAbQBqQG3AbUBuAG0AbYBtgGxAcUBuAG2AcUBXAFKAbMBuQG6AbMByQFdAbMBtQHKAbkBsAG+Ab8BvgGuAbwBvAHAAb4BwQG/Ab4BsgHEAcMBxwHMAcUBxAHIAcMBxgHDAcgBzAHKAbcBzAHOAcoBzAHdAc0B1wG/AcEByAG/AdcB2QHBAcIB2QHCAdUByAHXAdsB8AGOAX8B3QHGAd4B3QHeAc0B3gHcAc0BzwHfAX0BzwHgAd8BywHiAeAB4gHyAeAB8gHiAdwB2QHaAdgB2wHYAeoB2wHrAe0B3gHbAe0B6wHvAe0B3AHsAfIB3gHtAe4B7wHuAe0B7wH0AewB7AHuAe8B3wHwAX8B4QHxAfAB9wF/AHwA8QHhAfMB9AHzAfIB9QF9AIMA9QGDAPsBfQD1AXwA9QH7AQMCBwL6AQ0C9wF8APUB+AGDAIAAgAD5AfgB+gH5AYAA+gGGAA0ChwD8AQ0C+gGAAIYAigD9AfwBiQD8AYcAjgAAAv4B/gH9AYoACgIDAvsB9QEDAgICAgIDAgUCBAICAgUCAQIDAgoCBQIDAgECGQIEAgUC9wH1AQIC9gH3AQYCBAIGAgICZwJqAmkCCAIHAgkCBwIOAgkCAQIKAggCCwIBAggCDQIQAgwCBwINAg4CDwIRAhAC/gESAhMC/QETAhECAAIUAv4BFQISAhQCFQIsAhICFgIXAhUCFwIuAiwCGQIFAgECGwIaAhkCGQIBAhsCGgIEAhkCHQIEAhoCHQKMAgQCHAIdAhoCCQI2Ah8CHwIIAgkCGAILAiACIAIfAiECIwIMAicCCQIOAiICDgIjAiICIwIlAiICEAImAgwCEQImAhACJgI/AicCJAInAigCJwI/AigCEwIqAhECEwIpAioCKgImAhECKwImAioCEgIsAikCLAJGAikCKQItAioCKQJGAi0CLgIvAiwCLAIvAkYCMQIwAjoCMAI3AjoCMwIcAjECNAIeAjMCMwIxAjUCvwI0AjUCGAIgAjcCNwIgAjkCOAI5AiACOgI3AjkCOQI4AkwCJQI7AjwCOwI+Aj0CPwJAAigCOwIoAkACPwJDAkACRAJDAkICLQJHAisCRgJHAi0CKwJHAkICRgJIAkcCRwJnAkICSAJmAmcCLwJJAkYCRgJJAkgCSQJKAkgCTwIyAjoCTAJQAk8CTgJQAkwCSwIyAlEC2wJLAlMCUQJUAlMCPAI9Ak0CPQJOAk0CVgJQAk4CVwJWAk4CVgJSAlACWQJWAlcCVwJYAlkCWgJbAlkCQAJcAj4CXgJBAj4CQQJdAlcCXwJgAlgCWAJgAloCYAJhAloCbQJhAmACYwJFAkQCXAJFAmMCXAJkAl4CRAJCAmcCZwJpAkQCawJkAmMCZgJKAjADZgJoAmcCagJrAmkCbAJqAmgCbgJiAmECbwJtAmUCZAJwAmUC9AJuAm8CcAJkAmsCcQJwAmsCbAJ3AnECcQJ3AnMCeAJ0AnMCEQF/APYBegIRAfYBjwJ7AnoCewIUARMBfAIWAXsCfAIZARYBigL2AQYCigJ6AvYBjAKKAgYCiwKKAowCjQKPAosCkAJ8AnsCkQKQAo8CkgJ8ApACkQKTApAClwKWAn4ClwJ+ApMCHgKOAowCjQKOAqUCpwKmAqUCqAKNAqYCqQKmAsECxQKqAqkCqgKTApECxQKrAqoCrQKXApMCrQKTAqoCqwKuAq0CrAKtAq4CqwKtAqoCrgKyAq8CtAKyAq4CNAKlAh4CvwK+AjQCvgKnAqUCwAKnAr4CwQKmAqcCwALBAqcCwALCAsECwwLAAr4CwwLCAsACwwK+Ar8CqQLBAsICxALFAsICyAKrAsUCxwLFAsQCyALFAscC5gLIAscCyALJAqsCyQKuAqsCygLLAsgCzAKyArQCtALNAs8CtAKuAskCtALPAswCgwEDAwQD0ALPAs0C1ALPAtAC7wLVAtQC2wLaAr8C2wLcAtoC3ALfAtoCUwLcAtsC4ALEAsMC3wLDAtoC3QLgAt8C3QLfAtwC3gLdAtwCVQLeAtwC4wLhAt4C4QLkAt4C4gLhAuMC4wJVAlsC4wLeAlUCWgLjAlsCxgLEAuAC5QLGAuQC5ALdAt4C5gLHAsYCYgLiAuMC8gLiAmIC5QLmAsYC5QLnAuYC5wLlAuEC4gLyAuEC5wLpAuYC6QLrAugC6gLrAukC6ALNAssC7ALNAugC0ALNAuwC6wLsAugC7gLQAuwC7gLsAu0C7QLsAusC7gLvAtAC+gLwAu4C8AKhA+8C8wLnAvIC9AL1AvMC8wLqAucC6gLpAucC6gL5AusCdQL1AvQC9gL4AvkC+QLtAusC/AL3AnYC9wL9AvgC/AL9AvcC+wL6AvkC+wL+AvoC+AL7AvkC/gL7Av0C/gLxAvoC/wKQAJEAFgIVApAAAgMBAwADBAMCA4EBhAEDA4IBjgEPAw0DBwMGA4QBhwEHA4UBhwEIAwcDhwEJAwgDCwMIAwkDCgMJA4kBCQMKAwsDigEMAwoDDQMOA4wBjAEOAwwDDQMPAw4DHwMSAyEDBAMRAwIDAgMRAwEDAQMSAxcCEgMuAhcCBQMRAwQDIQMSAxEDBQMhAxEDFAMhAwUDAwMTAwUDBgMTAwMDFgMTAwcDFgMVAxMDFgMkAxUDFwMWAwcDCwMXAwgDFwMkAxYDCgMZAwsDGAMXAwsDCwMaAxgDGQMaAwsDCgMMAxkDGwMcAxkDGQMcAxoDDgMdAxsDDgMeAx0DDwMeAw4DHgMrAx0DHgMuAysDHwMvAi4CHwMgAy8CMgM0AzMDIgMgAx8DFQMUAxMDJAMUAxUDJQMjAyQDGAMmAxcDJgMnAyUDJwM3AykDJwMoAzcDGgMqAygDKwMsAxwDLgMtAz0DKwM9AywDHQMrAxwDIANJAi8CLwNKAkkCLwNJAiADMQMyAyIDMgMvAyADMwMvAzIDOAMpAzcDNQNFA0IDNgM4AzUDOANHAzUDKQM2AyUDYgPqAdoBKgM5AzcDOgM7A04DPAM+AzsDPgNQAzsDPwNPA1ADLAM8AzoDLQM+Az0DPQM+AzwDQANsAmgCMwMwAy8DMwNCA0EDMwNBA0ADQwNBA0IDQwNEA0EDQQNRA0ADQQNWA1EDRQNDA0IDRgNEA0UDRgNZA0QDRgNKA0kDRgNJA1kDTQNaA0sDTgNIAzgDTgM7A0oDUANNAzsDTwNMA1ADUQN3AmwCUgN3AlEDVAN4AlIDVwNUA1IDVwNYA1QDRANZA1YDWQNLA1sDWwNXA1MDSwNaA1sDWgNdA1wDEAPxAWoDYgPaAekBYgNjA2QDZgNnA+sBaANtA/QBZgN0A2cD9AFtA/MBbQNrA/MBcwNmA2QDgwNjA3IDgwNkA2MDgwNzA2QDewMuAx4DdAN5A2UDdgN3A20DdQN3A3gDdQNsA3cDdgNoA2UDeQN4A3YDegN7A2oDmQOJA5cDawN6A2oDbQN3A2sDdwNsA2sDgQODA4ADgQOEA4MDhQOEA4EDeQOIA4cDhwOJA4YDdAOIA3kDjAOLA44DiwOKA44DjQOMA3UDjgN7A3oDegN1A44DoQOQA48D2AKhA48DkwOSA5ADgAORA5IDkgOBA4ADlQOBA5IDkwOVA5IDkwOmA5QDlwOUA5gDlwOWA5QDmQOYA6wDlAOmA6cDlQOFA4EDlgOFA5UDlAOWA5UDrgOaA5sDhgOaA40DiQOIA5YDiQOWA5cDnQOcA4sDjAOdA4sDnwOeA6MDowOiA58DowOeA6ADpQOjA7QDpAOlA7MDtgOkA7MDpgOiA6cDpAOiA6UDqAO3A10DmwOsA6oDqgOsA6QDqQOkA6sDpAO2A6sDmAOnA6QDTwOtA0wDrQOoA0wDVQOvA/wCsAP9Aq8DrwP9AvwC/QKwA/4CoAPxArEDtQOyA1gDsAOvA7IDpQO0A7MDtAOyA7MDtAOxA7ADtAOgA7EDXAO1A1gDtwOrA7UDIAAsACcAhQBzAIkAfwARAQ8BlAGZATcBkgGdAZYBkgG1AJ4BmwGlAaQBqAFKAUYB2ACsAaoB4gHLAc4B8AHxAY4B9wH2AX8ABwL5AfoBZwJoAmoCagJxAmsCtALLAs0CgwGCAQMDhAEGAwMDjgEQAw8DHwMuAhIDMgMxAzQDOAM2AykDYgNmA+oBEAOOAfEBZgNzA3QDewOOAy4DmQOGA4kDzwDKANEAygDMANEA0ADRANIAzADNANEA1QDQANYA0ADSANcA1wDTAPAA2QDxANoA6QDlAOYA5gDlAOcA5gAAAegA7QDrAOwAzQDoAOwA7ADoAAMB7wDuAO0A8ADTAO4A7wDwAO4A8gDvAAwB8gAMAfMA8QDyAPQA9ADyAPMA5gD/AAAB/wD+AAIBAAH/AAIBAwEEAQYBBAEAAf0ABQEHAQYBBAH9AB4BBgEEAR4BCAHtAAcBCQEKAQsBAgH8ABsB/QACARoBGgECARsBGwH8ABcBHQEaAX8C/QAaARwBBQEGASABCAEFASEBIgEhAYQCCgEiASQBIwEKASQBCwEjASUBDgElASYBvAGsAasB2gDxALsBvQG8AasBuwG9AasBwAG8Ab0B0gHkAdQBuwHQAdEB0gHRAeQB0QHjAeQBwgHUAdUB1AHkAdYB4wEOASYB5AHlAecB1gHmAekBgAJ/AoECgQJ/AoMChQIfAR0BggKFAh0BIwEkAYgCJQEjAYgCJAGgAqECiQKIAqEClQKBApQCmQKUApgCmgKFAoIChgKFApwChQKaApwCmgKVApsCmwKVApkCngK2Ap8CngKdArYChwKeAp8CoQKgAqICowKhAqICpAKjAqICmAKsAq8CmQKYArECsQKYAq8CsAKZArECsQKvArICtQKxAswCnQK3ArYCtgK3ArgCuAK3ArMCnwK2AroCuwKfArwCpAK8AtYCpAK7ArwCtQLMAs8CuAK5AtIC0wLOAs8C0wLUAtUC0QLOAtMCfQO9AtkC1gLXAtkC2QLXAtgC1wLVAtgCbgNeA18DYANeA24D5gHnAWAD5wHlAWADbgNfA28DbwOjAqQCcANxA28DYQNgA3EDggNhA3EDYQOCA3IDfQN8A70CfgN8A30DggNwA38DfgOAA38DfgPZApED0ADPANEAygDLAMwA0wDSANEA0wDRAM0A0ADUAM8A1QDUANAA1gDQANcA1wDSANMA2ADVANYA2ADWANkArAHYANkArAHZANoA1wDZANYA2QDXAPEA6ADpAOYA4gDnAOUAywDqAOkAzADLAOkA6QDqAOIA5QDpAOIAzADpAM0A6wDNAOwAzQDpAOgA7QDsAAMB0wDNAOsA7gDTAOsA7gDrAO0ACQHvAO0A8QDXAPAA8gDxAPAA8gDwAO8A/QAAAQIBAgEBAfwA/wDnAP4A5gDnAP8AAgH+AAEBBAHoAAABAwHoAAQBBgEHAQMBBwHtAAMBCAEHAQUBCAEJAe0ACQEIAQoBDAHvAAkBCwEMAQkBDQHzAAwBDQEMAQsBDgHzAA0BGQEbARcBfwIbARkBGgEbAX8CHAEaAR0BHgH9ABwBHwEcAR0BHgEcAR8BBgEeAR8BIAEGAR8BhAIFASABCgEIASEBIQEFAYQCIgEKASEBDQELASUBIwELAQoBDgENASUBqwGsAdoAqwHaALsBuwHxAPQAuwH0ANAB0AH0APMAwAG9AdMBvQG7AdIB0wG9AdIBwgHAAdMB0AHzAA4B0QHQAQ4B4wHRAQ4B0gG7AdEB1AHCAdMB0wHSAdQB1QHUAdYB5QHkAeMBXgPjASYB5QHjAV4D1gHkAecB5wHmAdYBsAK3ApsCHQF/AoACfwIZAX0CfwJ9AoMCgwJ9An4CggKAAoECggIdAYACIAEfAYUChgIgAYUChAIgAYYChwIiAYQChwKEAoYCJAEiAYcCoQKIAiQBJgElAYkCiQIlAYgClQKCAoECgQKDApQCgwJ+ApYClAKDApYCmQKVApQClAKWApcCmAKUApcCrAKYApcCmgKCApUCnAKaApsCmwKdApwCngKGApwCngKcAp0ChwKGAp4CJAGHAqACoAKHAp8CuwKiAqACowKJAqECmQKwApsCsQKzArACzAKxArICtwKdApsCtQKzArECuAKzArkCugK2ArgCugK4AtICvAKfAroC1gK8AroCuwKgAp8CvQKkAtYCuwKkAqICzgK5ArUCzwLOArUC0QLSArkC0QK5As4C1ALTAs8C1gK6AtIC1wLWAtIC0wLXAtEC1wLSAtEC1QLXAtMC2QK9AtYCjwPZAtgCXwMmAYkCXgMmAV8DYAPlAV4DYQPpAeYBYQPmAWADXwOJAqMCbwNfA6MCcAOCA3EDcQNgA24DbwNxA24DcgNjA2EDfAOkAr0CfANvA6QCfANwA28DfwNwA3wDfgN/A3wDkQOAA34DgAOCA38DgANyA4IDfgN9A9kCkQPZAo8DsAKzArcCtQK5ArMC", "g": [[0, 4851, "body"], [4851, 849, "belly"]]}, "hand": {"s": 3.7897724847999932e-06, "p": "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", "n": "g/7o3Yfyj/zGoLTdufSXpNO12JnB18iWhubol9/AsNWnluPBs7+zjc/qnMjKr9inqPqlxfqQg+v0jvvHCpyy/dmHKciWA8SQybCt3LSh08mX3aauzuOPzMma5f2E0p2//LaZCovPO6q398SR88yNy9CX37yaAuGF85+v+LuW/7Ob7M2N8eaFlr8aiQTVgf8Ihu0flx5BtpoPhPgYg/HtksIQoNNGkQQ+uqxAsfpjhO8YlO1AseRf84IMk9gzitURtqzEheL/m7P/upYGkdHZqKT7w5clzY7p8YvQkeI1rfdgvrdRy99v7pdF88Zw6hB8j/g5iAongw0QudifizH/ok8ivjhd70Rq74kqF4T1Ho0t7pM/75DH7IMI96FUHLpn3slt6PR8JOl39L5s0NZt89h4HoX1K5Et8IMN8qFTMo0SSpkCW7s4KrRdF+p7P/luXv5WaN9BHzByIFZXSjFa0Iv31ZEsEIQVEplICLFj/Ol9zLJWyuxx69R15NR0ANd4APZ/+9p56bRj+cVwD8FtWb8/CeF7OAxxQOdqAAx+ggoHhxvkoB2zsxCckRbHkjfhnDPElkX4q07KpljwumjrvSeb1BmLtT2u0TuZzFCswl/H5WGz4W7JuGgO0nbz8hKD6S2MASaHBUOU5kea+VmmBm7A6nvoC3na/3//iSkPkxk7oyROkC8lrlkmwVBMwmI0mjA7l0AgpFUWsDNU6WVK41BeIGw6Eztvv0lSrEw6yjZl60RpvmAzznAh0VJV4SxzYj40+i92DCV54mo/6nob+2tFD3Qy6ldaLLWkMY7jRK28MduRILqbDcOSFIvSE5+wA7mXIqunBcCTEMOSB9eIG+KIBfmBI/yG+onV5ceS3Jm/B6amCOKFObaqULy5K8iWOOKSK8mWP/qSO5jUNcacQu6VY77Se+3mZ/K3I/aGV9SvSc+kWNysZsfObdzKdOPWdtTvU/+gZPizdfPSeAnXfvH7OaNCRZcRE4gjDK5gHNV0MOBxB9x5BOp9BLpqGrhlAdJ3GNF0Jux3EP5+5oQL5plGEppKFoMH3ddzBfl/G8NsHd93O+huMMloONtsOwhwPJYlYrAOTcJQdNokXPxYdQcyfgULNPl0cPE6feoKWe9ZbuA3dtUTUtVXYedObQhBewAfR/BoWQZbeesgEhKEGC2LJUadF1+vKnj5LBuMRxuaNzabRkq0MVy4QWDNJ3HURGnpYhSybybOVDCuXjzEVVHQXVXvaz7idTD8fRb3HBB7Mh9wMUFiHTVwClBiHV1SHXoVSjVZNGstPVRKS2YLZCpCbzQiVB1bWUo0aEgKUVomeBof", "i": "AgAEAAUABgAFAAcACQAKAAQACwAPAA4ADQAOAAkADQAJAAgADgAMAAoAEAAPAAsAEQAPABAAEwALABIAFQAHAAQAFQAWABQAFgAiABQADAAYABoAGwAYABkACgAMABoAGgAXABUAGgAYABsAGwAXABoAKwAdABwAGQAMAB0AHgAcABEAIgAjAFwAFwAjABYAJAAjABcAHwBcACUAJgAlACQAIAAfACUAJwAlACYAKAAZACoAJgAkABcAJgAbACkA1AArACwAKwAqABkAHgDWACwARAAtAC8ALgBEAC8AigASADAALwBJADEAVAAvADEANAA1ADMABQADADQAMwA2ADcANQADADIANQA4ADYAYQA5AGAANAAzADoACAA0ADoAOgA3ADsAOwA3ADkAPAA7ADkAOQBhADwADQA6AD8APwA7AD4AUwBAAEQAOwA8AEIAPgA7AEIAQgA8AEMALQBEAEUARgBHAD0ASABAAEMARQBGAC0ATQBGAD0ARgBNAEsATgBLAE0ATwBMAE4AUABBAFIArABSAFQAMQBJAEoASgBMAE8AVgBXALQAMgABAFgAAQBZAFgABgAUAFkAWQABAAYAWABZAFoAWgBZAFsAWQBcAF0AWwBZAF0AYQBgAF8AYABeAF8AYwBfAFsAegBiAGMAYQBiAGUAZQBiAIEAPQBmAGcAQwA8AGQAQwBkAGgAaABkAGkAZABlAGkAaABpAGoAZQCCAGkAZgBIAGgAZwBmAGsAaABqAGYAZgBqAGsATgBNAG0ATwBOAG4AbQBNAGcATgBtAG4AbwBsAHAAcgBXAE8ATwBuAHIAcgBuAG8AcwByAHQAcwB0ALcAdABwAIcAdACHAMAAXQB2AFsAdQBcAB8AdQAhAHcAewB2AHkAdgB4AHkAYwBbAHsAegBjAHwAgAB8AH0AfACAAH4AfQB7AHkAgQB6AH4AfwCCAH4A/gCCAH8AgwCCAP4AagBpAIQAcQBsAIUAiABxAIUAhQCEAIgAiQCHAIYAEwAAAIsAigCLAAAAjgATAIsAlQCMAJcAlwCQAJIAkACPAJIAkgCPAJMAkgCTAJQAlQCWAI0AlgAeABEAmACWAJUAnQCUAJMAngCaAJQAnACaAJ4AlgCfAB4A1gAeAJ8AmwCjAJkApACiAKMApgCcAJ4ApQCbAJwAqQCKAFEAqgBRAFAAqwCqAKwArQCvAK4AkQCxALIAqwCuALMAuQCyALEAvACyALkAtAC1AK4AtAC2ALUAvwC1ALcAswCuALoArgC1ALoAuACzALoAugC/ALsAugC1AL8AvQCdALwAvADDAL0AuQC4ALwAvgC8ALgAvgDDALwAtgC3ALUAtwDAAIcAPgG7AMEAxACeAL0AxQDGAMQAwwDHAMUAxgCoAMQAJwDLACAAKQDMACcAzADLACcAywDNAMgAygDNAM4A0wDRACoAKQDPAMwAzADQANIAKwDTACoA1QDhANMA1gDVANQA2gDNANkA2gDOAM0A2QDNANIA3ADkANkA2ADbAOMA0QDfANAA0QDdAN8A3wDcANAA5QDcAN8A3wDeAOoA6wDdAOEA4ADrAOEA1wDgANUA3QDrAN4A7QDeAOwA7QDvAOoA4gDsAOAA8QDyAOwA7gDsAPIA9QAcAfAA9QDwAPMA9AD1APMAdwAhAMkA9gB3APcAyQDKAM4A9wDJAM4A9gD3APgAfQB5APsAgAB9APsA+wD2APkA+wD5AP0A/gB/AP8A/AD6AP0AAAH6APwAgwD+AIYACQEKARcBAAH9AAgBDAEJARcBDgENAR0BAgENAQ4BIQECAQ4BEAEHAeMAEwESAREB5wARAeYAFQEUARMBFwESARQBFAESARMBGQEVARYBGgEUARgBFAEVARgBHAEYARkBHQEMARoBGwEeARgBDgEdASEBIQEdAR4BIwH1ACABIAEbASMBJAHXANYAJQEkAaEAKQEkASUBpQAnAaQAJwEmAaIApwAvAaUAqAAoAacAJAEpAdcA4gDXACkBKgHiACkBJwEtASYBLAEmAS0BKAEwAS8BMAEuAS8BMQHxACoBMwExASoBSQE3ATYBNwE4ATIBOAE5ATIBOQH1APQAiQADAToBOgEDAQIBPQE+AcEAPQHCADsBxgDFAD8BxgBAAagAOgECAQ8BOwE6AQ8BRAEoAUABSgFEAUIBQwFCAT8BPAFDAT8BHwEgAUsBRwEPASIBRwEiAUUBRQEiAR8BRgFJAUgBRQFLAUYBRQFIAUEBSQE2AUQBAAATABIAAgAFADQABgADAAUABAAHAAUAAgAJAAQACAAJAAIADgAPAAwADQALAA4ACQAOAAoAEwAQAAsAEgALAA0AEgANAD8ABwAUAAYAFQAUAAcAFQAXABYAXAAUACIAFgAjACIABAAaABUACgAaAAQADwAdAAwAHAAdAA8AGQAYAAwAEQAcAA8AIwAlAFwAJAAlACMAJwAgACUAKQAnACYAGwAZACgAGwAoACkAJgAXABsAHQArABkALAArABwAHgAsABwALwAtAEkAEgA/ADAAUQCKADAAVAAuAC8ANAADADUAMwA1ADYANQAyADgAAQAyAAMAAQADAAYAOAAyAFgAOQA3ADYAYAA2ADgAOQA2AGAAOgAzADcACAACADQAPQBHAEgAOgANAAgAPwA6ADsAUwBEAEEAQABTAEIAQQA+AEIAUwBBAEIAQgBDAEAARQBEAEAARwBFAEAARgBFAEcASABHAEAASQAtAEsASgBJAEsASwAtAEYATABKAEsATgBMAEsAPgAwAD8AUAAwAD4AUQAwAFAALgBBAEQAUgBBAC4AUAA+AEEAUgAuAFQAVQBUADEAVgBVADEAVQBWAK8AMQBKAFYAVgBKAE8AVwBWAE8ArwBWALQAXABZABQAXgBYAFoAWwBfAFoAXgA4AFgAYAA4AF4AYgBhAF8AXwBeAFoAYgBfAGMAPABhAGQAZABhAGUAPQBIAGYASABDAGgAawBsAGcATQA9AGcAbgBtAG8AbABtAGcAbABvAG0AcQBwAGwAcgBzAFcAcwC0AFcAdAByAG8AbwBwAHQAdADAALcAdQBdAFwAdgBdAHUAIQB1AB8AdgB1AHcAewBbAHYAfABjAHsAfQB8AHsAfwB+AIAAgQBiAHoAggBlAIEAfgB6AHwAggCBAH4ABgEEAQcBhACFAGoAaQCCAIMAgwCEAGkAhgCEAIMAiABwAHEAhwBwAIgAhgCIAIQAhwCIAIYAigAAABIAqQCLAIoAjgCMABMAjAAQABMAjACNABAAlQCNAIwAjQARABAAkACXAIwAjwCLAKkAkACOAIsAkACLAI8AkQCPAKkAkACMAI4AkwCPAJEAjQCWABEAmACgAJYAmACVAJcAlwCZAJgAkgCaAJcAmgCZAJcAmwCZAJoAmACZAKMAmgCcAJsAlACaAJIAlgCgAJ8AoAChAJ8AogChAKAAowCiAKAAowCgAJgApACjAJsApQCkAJsApwClAJwAngCoAKYApgCnAJwApgCoAKcAqQBRAKoAUgCqAFAArACqAFIAqgCrALAAqwCsAK0ArABUAFUAVQCtAKwArwCtAFUArwC0AK4AsACpAKoAsACxAKkAsQCRAKkAsAC5ALEAqwCzALAAswC5ALAAuAC5ALMAsgCTAJEAsgCdAJMArQCuAKsAcwC2ALQAtgBzALcAuAC6AL4AvgC6ALsAsgC8AJ0AngCUAJ0AnQC9AJ4AvwC3AMEAiQC3AIcAiQDBALcAwQCJAMIAwQC7AL8AvQDDAMQAwwDFAMQAxwC+ALsAvgDHAMMAPgHFAMcAPgHHALsAxACoAJ4AHwAgACEAIADIACEAIQDIAMoAyQAhAMoAIADLAMgAzADNAMsAyADNAMoAzADSAM0AzwAoACoAzwApACgAKgDRAM8A0ADPANEAzADPANAAKwDUANMA1QDTANQA0wDhANEA1gDUACwA1wDVANYA0gDQANkA2QDbANoA0ADcANkA2gDbANgA2QDkANsA3gDfAN0A3wDpAOUA3wDqAOkA1QDgAOEA4QDdANEA1wDiAOAA4wDbAOQA3ADlAOQA5gDjAOQA5ADlAOgA5ADoAOYA6ADnAOYA5QDqAOgA6gDlAOkA6gDvAOgA6ADvAOcA3gDrAOwA7gDtAOwA7QDqAN4A8ADvAO0A8AAZAe8A8ADtAO4A4ADsAOsA4gDxAOwA8wDuAPIA7gDzAPAAeAB2AHcA9gB4AHcA9wB3AMkAzgD4APcA+AD5APYA+gCAAPsA9gB5AHgA+wB5APYA+gD7AP0AfwCAAPoA/wB/APoAAAH/APoAAAH8AP0AAQGGAP4A/wABAf4ADQEBAf8AAwGJAIYAAwGGAAIBhgABAQIB+ADOAAQBBAHOANoA2AAEAdoABwEEAdgABQEKAQgBBwHYAOMA+AAEAQUB+QD4AAUBCAH5AAUBCAH9APkACQEAAQgBCQEIAQoB/wAAAQsB8gD0APMADAELAQkBDQH/AAsBDQELAQwBDQEMAR0BAgEBAQ0BDwECASEBEAEGAQcB4wARARABEgEQAREBEQHjAOYA5wATAREBFgETAecAFgEVARMBCgEGARABFwEKARIBCgEQARIB7wAZAecAGQEWAecAGgEMARcBFAEaARcBGAEVARkB8AAcARkBGwEYARwBHQEaARgBHgEdARgBHAEjARsBIAEfARsBHgEiASEBHwEiAR4BHwEeARsB9QAjARwBnwAkAdYAnwChACQBogAlAaEAJgElAaIAJgErASUBpAAnAaIApQAvAScBpwAoAS8BKwEpASUBKwEqASkBLAErASYBLAEzASsBLgEsAS0BJwEvAS0BLwEuAS0BKAFEATABLgE1ASwBKgHxAOIAMQHyAPEAMwEyATEBNQEwATYBMgH0ADEBMgE5AfQAKwEzASoBLAE0ATMBNAEyATMBNQE0ASwBNQE3ATQBNQE2ATcBNAE3ATIBNwFJATgBSQFKAUgBRAE2ATABwgCJADoBPAE+AT0BwQDCAD0BOwHCADoBxQA+AT8BPAE/AT4BPwFCAcYAQAEoAagAPAE9ATsBQQE8ATsBQQFDATwBQgFAAcYAQgFEAUABSgFCAUMBhQBrAGoARQEfAUsBIgEPASEBRwE7AQ8BSAFFAUYBSQFGATgBOAFGAUsBRwFBATsBQQFIAUMBQQFHAUUBSgFDAUgBOQE4AUsBOQEgAfUAOQFLASABBgEFAQQBBQEGAQoBCQELAQAB8gAxAfQANQEuATABSQFEAUoBhQBsAGsA", "g": [[0, 1980, "hand"]]}, "foot": {"s": 6.413796846855038e-06, "p": "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", "n": "ktzNp7HUjA7OjRXOpVPhiSPkm0DVtGDf2Ivk14nrqse2uPKYltHLn/iutaXSw5fcltLLravTti2jkArGmUDZqDa3z5LY44jkxJbc6IXp0N6PvrWx05rD0SiR74zQB4zO9IPs/oLu94Pu8Z+w3K2n9cSR/fCC4vqF9iSHgxP6idMBhu8egxEKjisjvZbrwJMOy436uJ0hiN3ooa/qqaT8lr0TrKIPjgM4k9IupbEoidwahOUGhBn2hRIbj/A3kCksmEj/nk3plkUQlTMtnzY+tlswmksI44T91YkI2YkVr58A0Y4ej9HfoK33wpjbyJEZ6oMC8Ibfl7wWs8RR3ahUughq5jttnkgjxmootmIhsUBN33Uk4mRI7G4984L86oQO7Ich2of6+oEHHIX0+4ktIIokAZNCF6VW8OV7Jf96I8ptGjFy/rNlFWNNAlhc/IEI+YMWA4Ug94IQ/YIS7YMK4YX864cf3KJNCpVE/Mly/+d8/jJ13xB619dxHRB77FZb60lmtmXtsVjTxlq7xmrYtWXwwG3yy3Ls1nj71lGn3mzH7Gm84njky3P58H4A5XwE7kycBl6r/3/2Cn8Cq174wm/8smQIv2wRqFYewmog1nj54Xry03cH6H0D1nYVzmsv33Yi3G03515S73736nwT93goBXse8XA7B28+/2FR/H/6/H8H+30VCaGsHaGwF4bmK43fC4PtF86NDUCTGRCELRGKKUOcJZTIIojnPZfbG4boNtiUM7GqRyeeTUS2Mo/hSvWaR6TNVcuya93FXLnMS6PVYhKxYEnYbyHMcffHY8PNbu3DT6LiaL3jd+3YajjWbCjMVlbcBIH6DYIGD4QUD4IKFogiFoMBKZEvAoISJ8BnAeZ8Aj9uEVhaGmBOCGROH05gHYT6CoLwH4UHI4gXMIr+3Ib6BYEHBoTkD4MP/5tN6ooq6KVV1c9t2Bd2CBp86ltWDHUxKonxMowJNY39NY8WOZQiM5HdOo8IXK7jIp1JP50wZrYSCM91PNZoW6cCc8sOYMY8ZPlOQRtqMG0sNW4jXk0mLVBYW1IhQ5XxSpkLT6IiXKn0csn5X6wHaLoWcdIlc/g1YsEyfPsZfOP8dCkge/khZCpCYFHpdCbebD8WaUgBajkoaCc9dTAFffTteuAKdynxfRYGewwbCnDFHme8/HnaGXniB34NJXoCMVWwM2vSMXPqJ3n8RlzMSmbySWXrPm3sGnghEnQyDn77DX4OHnsDLWo2GnsOJnn1LnQUQWwNTGAiMm8kS1c2UGL5NnMAVV0P", "i": "EAABAAAAEAARAAEADwAuAAEAAwAMABAAEwAMAAMAFAADAAQAAwACAAYABAADAAYACAAPABgACwAbAAoADQAKAAwADAAKAA4AGwAOAAoACwAKAA0AEQAPAAEADwARABgAEQAOABgAEgALAA0AFwAWABwAGgAbAAsAGgAkABsAJAAcABsAHQAaAAsACAAXACAAFwAeACEAIQAeAB8AGQAgACIA4gAiALEAJQAkABoAJAAlACMAIwAlAK0AKAAnAB0AJwAmABoAKAAmACcAKQAyACoAKQAFADIABQApAEAALAApACsALAArAC0ANAAuADAAMgAzADQAMgA0ACoANAA1ACoANQA0ADYAOAA1ADkAOgA5AEoAPABMADsAPQA6AEwAPwA7AD4APgA7AE0AAgAAADIABQACADIAQwArADcANwA6AD0ARAA3AD0AQwBFAJgARQBDAEQAVwA8AEYARAA9AFcARgA8AD8ARwAwAAkAMQAvAEsALwBIAEkASgBLAGEATgBNAEwATgBKAGEATwBOAFAAUABOAFEAUgBPAFMAVABPAGQATwBQAGQAOQAxAEoAUgBTAD4AVQA+AFMAVQBTAGgAWQBGAD8AVwBGAFkAWgBcAFkAWwBdAFgAWgA/AFUAWgBVAFYAXABaAFYARwAJABkAXgBHABkAXwBHAF4ASQBIAF8AYABLAEkASQBfAGAAYQBLAGAAYgBRAGEAYwBiAHMAZABQAGMAZABlAGcAZQBjAHMAZwBlAGYAZgBlAHMAaABUAGcAagBoAGcAaQBqAHoAXABtAFsAbQBuAF0AVgBtAFwAVgBrAG0AbwBeANIAIgDiANIAXwBeAG8AXwBvAHAAcwBiAHQAYgBgAHQAdQB0AHIA1wB1AHIAdgB1ANcAeQB3AHgAewB6AHwAfAB6AH0AfAB5AH4AbgCiAF0AbgB/AKIAqQCiAH8AewB8AIAAFQAUAIIAhQAUAAQAhQCCABQAhwCGAAcAiQASAIMAiwCJAIoAigCJAIMAjACKAIQAjQCEAIUAiACPAI0AjwCMAI0AiwCQAIkAJgGKAIwAkgCMAI8AkgAmAYwAKAGPAI4AjgCTACgBQABCAJYAlABAAJYAmACXAJYAmACZAJcAhwAHAIEAmgCbAIcAnQCaAJwAlwCcAJUAWAChAJ8AjgCIAJsApACcAJ4AoACkAJ4AoQClAKAAowCbAJ0AoAClAKQAqQCnAKIAowCqAI4AnQCqAKMAIwCtAB8AHwCuALcAsQAgACEAugDiALEAJgCyACUArgCtALIAtAAmACgAHwC3ALAAuACvALAAuQC4ALAAuAC5AL8AtwCuALwAtwC8AMEAtQC7ALIAtgC9ALUAvgC9ALYAsADBALkAvwC5AMUAvwDFAMwAwADCALsAxAC5AMEAxADFALkAygDFAMQAyQDEAMMAvQDGAMAAywDKAMQAywDEAMkAxQDKAM0AzgDKAMsAyADJAMMA0ADLAMkA0ADOAMsAbwDSANMA1ABwANMAeADYANoA2ADXANkA6gDYANkAfgB5ANoAfgDaANsA3AB+ANsA2gDqANsAgADdAH8A4QDiALoA0wDiAOEA0wDhAOMA1ADTAOMA1ADjAOQA5QDWAOQA1QDnANkA1QDWAOcA6QDmAOgA6gDrAOwA7ADrAPoA6gDsAO0A3ADbAO4A7gDbAO0A/QDtAOwA7gD9AO8A8ADxAN8A8QAEAd8A8ADcAO4A8gC/AAkB9QDkAPMA9gD1AAsB5AD2AOUA9gDkAPUA+QD4APcA+gDrAOkA/AD7APgA7AD6AP0A/QD6AP4A7wD9AP4A7wD+AAMBAwH+AAIB/gABAQIBPgE3AQQBBQEEAfEABwHwAO8ABwHvAAMB9AAJAQoB8wD0AAoBCQHMAAwBCwEKAQ8BDwEKAQ4BEgELARABEQESARABFwECARYBFwEWAR4BHgEWARQBGAEZAdEAGAEbASEBEQEQASMBFQERAR0BPgEdARwBHAEdAREBBgEVAR0BCAEXAR4BHwEgAQ0BGQEfAc4AIgEgAR8BIQEiAR8BGgEjASIBGgEiARsBtgCzAJEAJwEkASYBJQGRACQBJwEmAZIALAErAScBkwAtASgBLQEpASgBLwEsASkBKwEvAS4BKQEtAS8BMAEvAS0BMQEwAS0BMwGmAKUAMwEyAaYANAEtAZMANAGqAKsAOgE2ATgBPQEyATcBNQE2ATQBNgE5ATQBNgE1ATgBOQExAS0BOwFAAToBPQE6ATIBMQEYAdEAPwEYATEBPwFBARsBPwEbARgBOwE/AUABQQE/ATsBQQE7ATwBHAFBATwBQQEcARoBPAE+ARwBEQAMAA4AAgADAAAAAAADABAAFAATAAMABgACAAUABwAEAAYAFgAYAA4ACQAPAAgAZwBsAGoAEwANAAwAFQANABMAFAAVABMAFQASAA0AHgAXABwAHgAcACQAGAAWAAgACAAWABcAGQAJAAgAIAAZAAgAFgAOABsAHAAWABsAEgAdAAsAHQAnABoAHwAeACMAIQAgABcAsQAiACAAIwAeACQAGgAmACUAKwAqADUAKwApACoAQgApACwAQgAsAC0AQAApAEIANAAzAC4ALwA0ADAALwA2ADQALgAzAAEAKwA1ADgANwArADgAOQA1ADYAOQA2ADEAMQA2AC8ANwA4ADoAOAA5ADoAPQBMADwATABNADsAPAA7AD8APgBNAFIAQQAFAEAABQBBAAYAKwBDAC0ALQCYAEIAQwCYAC0ARABDADcAVwA9ADwACQAuAA8AMAAuAAkARwBIADAALwAwAEgASwAvAEkASgAxAEsATQBOAE8ATgBhAFEATwBSAE0AUwBPAFQAOgBKAEwATABKAE4AVQA/AD4AaABTAFQAVgBVAGgAWABEAFcARQBEAFgAWQA/AFoAWQBYAFcAWQBbAFgAWQBcAFsAXwBIAEcAYABfAHAAYwBQAFEAYwBRAGIAYgBhAGAAZQBkAGMAZwBUAGQAVgBoAGsAawBoAGkAaQBoAGoAawBpAHsAewBtAGsAegBqAGwAewBpAHoAWwBtAF0A9ADjAOEAXgAZACIA0gBeACIAYABwAHEAcgBgAHEAcgB0AGAAdAB1AHMAcwB1AHYAdwBsAGYAZgBzAHYAdwBmAHYAeAB3AHYAfQB6AGwAfQBsAHcAeQB9AHcAfAB9AHkAbgB7AH8AewCAAH8ABwAGAEEAgQAHAEEAggCDABUAgwASABUAhACDAIIAhgCFAAQAhQCEAIIAhgAEAAcAhgCNAIUAhgCIAI0AEgCJAB0AigCDAIQAjACEAI0AiACOAI8AkAAoAB0AiQCQAB0AiwCRAJAAkACzACgAkACRALMAJgGLAIoAJAGRAIsAJgEkAYsAKAGSAI8AQACUAEEAlACBAEEAlgCVAJQAlQCBAJQAlgCXAJUAQgCYAJYAmABFAJkAiACGAIcAhwCbAIgAlQCHAIEAmgCHAJUAnACaAJUAmQCeAJcAngCcAJcARQCfAJkAnwCgAJkAmQCgAJ4ARQBYAJ8AnACkAJ0AnwChAKAAWABdAKEAXQCiAKEAoQCiAKcAmwCjAI4AnQCbAJoApAClAKwArAClAKYAoQCnAKUApwCoAKUApwCpAKgAqgCTAI4AqwCdAKQAqwCqAJ0ApACsAKsArgAfAK0ArwAfALAArwAhAB8AsQAhAK8AJQCyAK0AKACzALQAJgC0ALIAtAC1ALIAtgC0ALMAsAC3AMEAuACxAK8AugCxALgAugC4AL8AsgC8AK4AsgC7ALwAvAC7AMIAtgC1ALQAtQDAALsAvQDAALUAwQC8AMIAwwDBAMIAwwDEAMEAvgDGAL0AwADGAMIAxgDDAMIAvgDHAMYAxwDIAMYAxgDIAMMAzADFAM0AzQDKAM4AyADPAMkAyADHAM8AzwDRANAAzwDQAMkAzwAwAdEA0AAZAc4A0QAZAdAA0wDSAOIAcABvANMAcQBwANQA1gDVAHEA1gBxANQA1QByAHEA1wByANUA1QDZANcA1wB4AHYA2AB4ANcA6gDaANgAeQB4ANoAgAB8AH4A3QCpAH8A3QDeAKkA3ADdAOAA3wDdANwA3wDeAN0A4ACAAH4AgADgAN0A3ADgAH4A4QC6APIA5ADWANQA5QDnANYA5gDZAOcA6ADmAOcA6ADnAOUA6wDZAOYA6gDZAOsA6wDmAOkA7QDbAOoA7gDtAP0A3wDcAPAA3wAEAd4A7wDwAO4A8gC6AL8A9ADyAAkB9ADhAPIAEgETAQAB8wDkAOMA6QDoAPgA6ADlAPcA6AD3APgA9wDlAPkA+QDlAP8A+wD6AOkA+AD7AOkAAQH6APsA+QD8APgA9gD/AOUACwH/APYA/wAAAfkAAQH7APwAAQH+APoAFwEDAQIBBQEGAQQBBAEGAT4BFQEIAR4BCAEVAQYBBwEFAfEABwEIAQUBBwEXAQgBBQEIAQYB8AAHAfEAFwEHAQMBCQG/AMwACgEJAQwBMwAAAAEA9QDzAAoBCwH1AAoBzQAMAcwADQEMAc0AzgANAc0ADAEOAQoBDQEOAQwBDwEQAQsBEgEAAf8AEgH/AAsB+QAUAfwAFAH5AAABEwEUAQABHgEUARMBFAEBAfwAFAEWAQEBFgECAQEBGQEYASEBGgEbAUEBIwEcAREBGgEcASMBFQEeARMBHQE+AQYBFQETAREBHwENAc4ADQEPAQ4BIAEPAQ0BIAEQAQ8BIQEfARkBGwEiASEBIgEjASABIwEQASABKgG2AJEAkQAlASoBJAEnASUBKQEnAZIAKAEpAZIAKgG+ALYAJwErASUBJQErASoBKwEuASoBKQEsAScBLgG+ACoBLgHHAL4AKwEsAS8BLgEvAccAxwAwAc8ALwEwAccAMQHRADABqAAzAaUAqADeADMBqQDeAKgANAGTAKoAqwA1ATQBrAA1AasArACmADUBNQGmADIBMgE4ATUBMgE6ATgB3gA3ATMBMwE3ATIBBAE3Ad4ANAE5AS0BNgFAATkBQAExATkBOgFAATYBPAE6AT0BPgE8AT0BPgE9ATcBQAE/ATEBPAE7AToBEQAQAAwAZwBmAGwAewBuAG0A9ADzAOMAEgERARMBMwAyAAAA", "g": [[0, 1920, "foot"]]}, "hood": {"s": 2.1813160790971293e-05, "p": "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", "n": "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", "i": "3AADAAAAAwC2AAEABAADAAIABAAJAAsAAwABAAIACQAHAAgADAD8ABoBDQD9AAYADgANAAYADAATABEAEwAMAEEBDQAaAC4BDwASAA4AEQATABYAEwAeABYAFAARABYAEgAXAA4AHgATABgAHQAVABwAKAAYAFQBIQAZABoAIwAcACQAKADXAh4AJAAeANcCJgAlAB8AJgAfACAAJwAmACAAKABUAXYB3AAAACoAKgAAAAUAKgArADoCLQAwACsAKgAFAC0ALQAFAAsAWwIQAAABEAAPAAABMwALADIALQAzADQANAAzADUALgA3ABAALwA4AC4AegI4AC8AMQA2ADsAegI6ADgAOAA6ADcAOQAXABIAOgA/ADcAQAA/ADoANgA+AEEAPAA7AEgAOwBBAEgAPQAVAB0AOQBGABcARgAgABcAPwBGADkAPgBFAEcAQQBHAEgAQABOAD8ASABHAFAARwBRAFAAUgBPAEAACANIAFAASAAIA1MAYQBeAFQAVABaAMQBcgBWAFcAWwB1AFcAWQB4AFsAXABaAFgAXwDdAV0AYACCAFkAYgDdAV8AYwBgAGEAYwBhAFQAZABiAF8AXwCAAGUAZgBiAGQAZwBgAGkAYwBUAGoAaQBjAGoAaABnAGkAaABpAGsAawBpAGoAbQBrAG4AbgBrAGwAcACUAHEAcwCUAHAAdQB0AHYAdgCYAHMAdgB0AJgAnQCcAHcAeQDAAHQAXQB7AHcAewCdAHcAeAB5AHUAegCeAH4AfgCeAH0A3QF7AF0AXwB+AIAApgCjAIEAgQCCAIUApwCDAKQAhgBlAIMAhACFAGcAiABkAGUAZgBkAI0AqQCEAIcAqgCLAIoAZACIAIwAiQCHAI8AbQCPAGgAiwCMAIoAkQCPAG0ArwCQAIwAmAC3AJUAmACXALcAmgC4AJkAnACZAJ8AmQC+AJ8AnwC+AKAAnwCgAJ4AwAB8AKEAngDBAKIAwwCiAMEAfQCeAKIAfAB/AKEApACiAMMAyQCkAMMApwCkAKUAqACnAKUApQCkAMkAqgCGAKgAzACpAKsAqwCpAIcAqwCHAIkAqwCJAM4ArQCLAKoArgCOALIArwCLALAA0QCLAK0AsQCQAK8ArgCyANMA2QCxANYAswDTALIAswCyAJIAkwCJAbQA3AC1ANsAugDeAOAAlgCVALUA4QC7ALgAlgC1AB0ClwC5ALoAtwCXALoAuwC9AL4AuAC7AJkAvQDmAKAA5ADmAL0AvQCgAL4AvADAAL8AvADnAOUA5gDBAJ4AxADBAOoAxQDCAKEAwwDEAMYA7QDFAMcAxwDFAKEAyQDDAMgA7wDtAMcAygDvAMcAywDJAMgAywDIAPAAzADKAKYAzgDMAKsA9ADyAMwA9ADOAM8AzwDOAK4A0gDPAK4A0gCuANMA1QCwANEA1gCwANUA1gCxALAA2ADTALMAswC0AIkB/wDhAN0AtQDcAB0CAgG9AOIA4QD+AOIA4QD/AP4ABAHlAOcA3gC5AAQB5gAHAegAvwDpAOcA6gDsAMQA6wDCAMUAxgDEAOwAxgDsAO4ADQHIAO4ADwHxAPIA8wDLAPAA8wDwAA4B9QDzABIBEwH0APcA9gDQAPUA1wD3ANIA+ADUANAA+gDVANQA/AABARkB3wDeAAEBBAEbAQEBBQEbAQQBBAHnAAUBBwEeAQYB6QAIAecA6wAKAekACgEIAekA7wAMAe0AJAEMAe8AJwENASIBDQEnAQ4BJgHvAPEADwEmAfEAJgEkAe8AKQEPAREBEQEPAfQAEwERAfQA+AD2ABgB/AAZARoBBgD9AP8AAgEcAQMBHAECAf0ANAEzAQoBIQEJASABIwEhATYBNwEMASQBJQEiASMBJgE4ASQBEAEnASgBDgEnARABKwEpAREBKwERASwBFQEsARMBFgH2AC0BLgEcAf0AGgEZARsBLwEaARsBHQEwATIBNAEKAQsBNgEgATUBRgELAQwBOgE4ASYBOgFgATgBOwE6ASkBPAE+ASoBLQEqAT4BPwFOASwBFQE/ASwBUAEWAS0BQAEWAVABQQEvAVMBMAEcAUMBUwEvAVEBUQExAVUBSgEjAUgBJQEjAUoBOAFdATcBOwFNAToBPAFMAWIBPgE8AU8BUgFTAVEBUwFUAUEBQwEZAEIBaQFXATABVQExAVYBVwFFATIBWgFFAVgBWQFWAUQBNQFFAVoBWwE1AVoBSAFcAW4BYAFeATgBTAFLAV8BYgFMAV8BTQFhAWABOwF0AU0BPAFiAWMBZQF1AU4BUAFPAWQBZgFQAWQBZwEZACEAUgFRAVUBagFVAVYBWAFXAWkBaQFrAVgBawFpAWgBVgFZAWoBSQFsAUcBSQF9AWwBXQFvAUkBSwFuAXABYQFyAV4BcgFhAU0BYwFiAXMBdgFSAXgBeAFSAWoBeQFqAVkBWQF7AXkBbQFaAXoBewFZAWwBfgF7AWwBbgF8AX8BfwF8AYABbwErA30BXgFvAV0BgQEuA14BXgEuA28BcQFfAXABgQFeAXIBggFfAXEBdQGDAXQBhAGDAYUBZAGGAYcBiQGKAdgAiAGJAZsCiwHXANMA2gDVAIwBjgGNAYoBFQH5AJABkQGQAfkAkgH7ABcBjAH7AJMBjQGOAZoBlQGNAZoBmgGOAY8BkAGbARUBFwEWAUABkgEXAZcBmAGbAZABkwGSAZcBmQGUAZMBogGaAZYBPwEVAZsBpQGbAZgBpQGYAZ0BnwGXAZ4BoAGZAZMBnQGYAZUBnQGVAaEBoQGoAZ0BpgGcAaQBpwGeAaYBqQGfAacBoAGfAaoBqwGoAaEBsgGoAasBogGrAaEBqwGiAawBZQFOAT8BQAFmAaQBrwGtAaUBrgGdAagBpwGmAbABqQGnAbABwgKqAbEBsgGuAagBugKrAawBZQGFAXUBvgFmAYcBswFmAb4BowG9AWUBtAGjAa0BpgGzAbUBtgGvAa4BtwGwAbUBwgKxAbkBuwG6AbIBugK8AasBvwG0Aa0BwAG/AbYBwAG2AboBuwHAAboBwgG7AbwBxAFaAMMBxAHDAcUBVQDEAcYBVgDXAdkBWADZAcgBxwHZAdoByAHHAckByAHJAcoBwwFaAFwAwwFcAMgBwwHIAcoByQHjAcwBxQHDAcoB5QHLAc0BxQHKAc4B0AHOAesB7gHQAesBagBVANEB0QFVAMYB0gHRAcYB0gHGAdAB0wHQAe4B0QHSAdQB1AFsANEB+wEhAtgB1wHYAdoBAAKdANwB2wF7AN0BewDbAZ0A3gEEAtsB2wEEAtwB4AEFAgYC3wEEAuEBzAHjAeQB4QHLAeUBzwHlAc0B5gHlAc8B6wHOAcwB6wHMAegB7wHtAWYA6QHmAe0B7wFmAI0A1QHTAe4B8AEQAukB7wGNAJAA8AHxAfIB9AHUAdUB+QH4AfQB+QH0AfUBkwBvAPYB+gH2AfgB/AEeAiIClgD8AfsBcQCWAPsBIQL+AdgBAgL+Af8BAgL/AQMC3AH9AQACAgIDAgUC3wEBAgQC3wEnAgECBQIDAgYCBgIpAggC4gEHAt8BCAItAgoC5AEIAgwCDAIIAgoC6AHkAQwC6AEMAg4CDwLqARAC8wHrAewBEQLzAewBDwINAuoBMwLsAQ4CMQIQAhIC8gHxARcCFwLxAfcBFALyARcC+QH1ARUCGAL5ARUCFgKQALEAFgKxANkAGQL4AfkBGAIZAvkBGwKTAPoBmwKTABsCHAIbAvoBHAL4ARkClgAdAvwBHgL8AR0CHQIpAB4CHgIpADoCIAI9AuMAIgIeAh8CJQIfAj8CmgD9ASACJAIjAv0BIwI+Aj0CJAJAAiMC/wElAiYCQAIkAigCCQJHAiwCLgIJAg0CLgJHAgkCMAIuAg8CTwIzAi8CMgIwAjECMwJSAhMCGAIVAhMCGgIZAhgCNQIYAlYCWALZANoANgLZAFgCWQI2AlgCngIcAhoCHQLcACkAPAI6AisAPQI5AuMAPgI7Aj0CJgIlAj8CJgI/Al4CKAJBAkACQgJDAkECRQIrAl8CLQJGAkkCSQJjAkgCSwIKAkkCSAJjAkcCSgJHAi4CMAJMAi4CTwIvAk0CTwJNAk4CTwJOAlECUAIwAjICMQJUAlUCUwJXAlYCVwJaAjUCpQI4AloCOwJbAjkCPAIrACwAbgI7Aj4CQQJdAm4CcAJdAkECcAJBAkMCQwJgAnACYgJfAnMCYAJiAnMCYQJgAkMCRQJfAmICYgJgAmECTgJMAmQCZQJOAmQCUQJOAmYCZQJQAjICZgJlAnUCUgJRAlMCUwJRAmgCUQJmAmgCMgJVAmcCVQJpAmcCVAJqAlUCUwJ5AlcCVwJsAloCXgJvAnICcgKAAnMCgAJ0AnMCdAJwAmACcwJ0AmACZQJnAnUCaAJmAncCZwKDAnYCaAJ3AngCeQJtAlcCawJqAqsCbwIxADwAMQA7ADwAgAJ9An4CfwKCAn4CggJxAnACgAJ+AoICgwKFAoQCeAKMAnkCbQKMArMCegJDAEIAfAJDAHoCfAJ7AnECbwI8AH0CiAJ9Ao4CfgJ9AogChQKDAooCiwKGAoUChgJ3AoUCjgKJAogCkAKLAo8CkAKPApECkwKRAooCvAKTAooCtAKMApQClAKMAosCjQJJAEMAjQKVAkkAmAKOAkoAkAKRApYCkgKQApYCmAKXApUCmQKTApoCcwSWApkClAKWAnMEiAGbApwCnQKcApsCWALaAKICoAKcAp0CngKgAp0CnwKgAp4CNwJZAqMCOAKfAp4CpQKfAjgCnAKPAYgBoAKmApwCWQKhAqQCowKkAqsCagKjAqsCbAKlAloCqQKlAmwClAGhAowBnwKmAqAClgGPAaYCqwKtAmsCmQGhApQBqgKhApkBpAKhAqoCrgKvAqUCogGWAbACqAKWAaYCqAKwApYBpwKoAqYCqgKZAaABqgKgAbECrwKsAqcCrQK1AocCtQK/AocCtQK4Ar8CuQKyAq4CswLBAq4CqgG2AqABsQKgAbYCtwK7AqwCsgK3AqwCsAKsAaIBuwKsAbACvwK8AocCtAK+AsECsQK2AsMCuALDAsACuwK6AqwBuwLFAroCtwLFArsCtAKUAr4ClAJzBL4CwALOAr8CwQLIAsQCyQK2ArkBtgLJAsMCwwLJAsoCxALLAsYCxQLNAroCzQLFAsYCvQJKBccCxwKaApMCyAK+Ak0FzwK5AcEByQLQAsoCygLQAtECzgLKAtECxALSAssCyALSAsQCzQLTAswCywLTAs0C1ALTAssCJADcAtUC4QIjANUCSwAjAOEC1gJLAOEC2QLXAigAJQDYAtsC3gImACcA2wLaAiEA1QLcAuIC1wLgAtwC3QIlAN4CdgFEA9kC2QJEA+AC2gLnAjQD2wLnAtoC2wLYAucC1QLiAuEC5ALhAuMC4ALpAuUC5gLoAt0C8ALnAtgC5ALjAgsDCwPjAusC4wLiAuoC8ALuAucC6QJhA+0C7wLtAvQC8ALxAvUC7AL1AvEC6gL0AvIC9AL4AvkC9wJ4A/UC8gL0AvoC9AL5AvoC8wLyAvsC+gL5AvwC+QKmA/wC+wL6AvwC+wL8Av0CTABLANYCTADWAv4CTQD+AlEAAwMnAE4ACANQAP8C/gLWAgIDAgPWAuQCUQD+Ag0DDQP+AgIDAwPfAicABAMDA08ABgNPAAADBANPAAYDCgMIAwkDDgPfAgMDEgMOAwMDBQMNAw8DFAMFAw8DEAMGAwcDEQMLA+sC7ALmAg4DGAMMAwsDAgMMAw8DHAMOAxIDFgMEAxADFwMUAxsDFwMJAxQDEQPrAvMCGAMZAxoDEwMPAxgDGwMPAxMDHQPsAhwDHQMcAxUDHgMbAxMDHwMeAyEDGQPzAiAD+wIgA/MCIAMaAxkDIQMaAyADIQMgAyMDHgMaAyEDJAN3AdoCJAMmA2gBJgNrAWgBJwN6AWsBegEnAzYDewF+ASkDfAEqA4ABKgN8ASgDgQE8Ay4DgwEvA3IB2gI0AyQDJQMzA3gBJQNDAzMDJgMkA0YDeQE1AyUDbQE2AygDLAMpA34BKgMoA0oDgAEqAzoDgAE6AzsDPAM5Ay4DSwM8Ay8DTANxAT0DNANGAyQDNANFA0YDRgNXAyYDJQNVA0MDRwMnAyYDJgNXA0cDNgNHA0gDOANYAzUDSgMoAzcDSQM4AykDNwNZA0oDLANaA0kDKgNKA1wDXQM5AzwDTQNLAy8DTQMvAz4DTgM/A0wDUAM/A04DQQMxA1ADQgNOBEADUQNBA18DQwNSA0QDRQNXA0YDRQNUA1cDVQNTA0MDVgNTA1UDNwNIA2QDOQNaAywDOwM6A1wDXgM7A1wDbQNdA0sDTAM9A14DbgNLA00DRQNiA1QDUgNTA3kDegNjA1QDVANiA3oDVANjA1cDgQNnA1gDWQNmA4IDWgOBA0kDXANbA2gDWwOCA2gDagNaA10DbgNtA0sDcwNOA4YDdANyA08DdANOBHUD7gJ7A2IDeAN3A+4CUwNWA3wDZgN/A5IDaQOUA4EDaAOCA4ADagOUA2kDbwNsA4QDhANsA2sDhQODA20DmgODA4UDcQNvA4QDnANxA4QDhwNzA58DowOhA3UDXgSjA3UDYAOkA18EdgOIA2ED+AKIA6YD+QL4AqYDeAOoA3cDeAOJA6gDiwN2A40DeQN8A40DjgOuA30DjwN8A34DfQN/A2UDfAOPA5EDrgOQA30DaAOAA5YDtwOVA5QDmQO3A5cDhANrA5gDmQOXA4MDmgO4A5kDnQOaA4UDoAOfA7wDpAOHA6ADoAO/A6QDwwP9AvwCiAOLA6kDqgOvA4wDqAOJA6oDqwOqA4kDjQORA6wDxgOLA6wDrQOOA4wDrwOtA4wDkQOwA6wDrgOyA5ADywOuA60DsQOPA5MDkAOyA38DswOyA8sDkgOyA7UDtQOyA7MDtAOTA5UDgAOSA7YDlgOAA7YDlgO2A9ID1AOYA9IDuQO6A7gDugPXA7gDmwPYA7sDuQOaA50DuQO9A7oDvAO+A6ADvwPAA8EDpQPbA6ID4APBA8ADwQPgA8IDwwP8AqcDwwOnA+QDpwOpA8UDyAOvA6oDygPoA6oDyQPoA8oDxwOsA7ADrwPLA60DzAPLA68DsQPPA7ADywPOA7MDtQPOA9ADtgO1A9MD0QPPA7QD0wO1A9ADtwPRA5UD0gPTA9UD0gPVA9YD1APSA9gD2APSA9YD2APWA9kDuwPYA9kDvQP3A7oD2wP5A70DwAO+A9wD3APeA8AD4APAA94D4APeA/wD4QPgA/wD/AP9A+EDpQPfA90D4gPfA6UD4gP/A98DwgPgA+EDwgPhA+MDxQMCBOQDxQPEA+UDAgTFA+UD5QPGA+cD5gOwA80D6wPmA80D6gPLA8wD7APqA8wD7APMA+gD7QPrA80D7gPOA+oD8APPA+8D8APtA88D9APRA/MDFAT0A/MD9QPVA/YD1wMUBPMD9wP4AxQEHQT4A/cD2gMaBBkE3AMZBPoDGQT7A/oD3gP6A/wD+gP7A/wD/QP8Ax8E3wMiBP4DJAQiBP8DAgTlAwQEBATlA+cDBQQEBOcDAwQEBCUEBQTnA+sDBgTsA+gDCQTsAwYECgQJBAYECwQKBOkDDwTtA/ADDATuA+oD6gMJBBEEDgTwA+8DDwTwAw4E9AMOBO8DEgQPBA4EEQQNBBMEFAQSBPQD9gMQBBYEFgQTBBUEFwQrBPgDGgT1AxYEGAQVBDIE+wMYBDIEHgQ0BBsE/AP7AyAEIAT7AzIEMgQcBCAEIQQbBB0EIQQiBBsEIgQjBB4E/AMgBB8EAQQ2BCME/gMiBCEEJAQjBCIEIwQkBAEEJQQFBAgEAwQlBCYEJwQIBA8EJwQlBAgENAUlBCgEJwQPBCoEKAQnBCkEKQQnBCoEDQQKBDkFLAQpBCoELgQSBCsEFQQTBC0ELwQsBC4EMAQXBDQEMwQxBDAEHgQzBDQENgQ1BDMENwRIBSkENwQpBCwELwQ3BCwEOAQ3BC8EMgOFAb0BvgGHAT8EvwE7BLQBSAS1AToEtwFIBEkEwQG4ATwETgXBATwEPgTCAcwCMgNABEIDOQRABDIDOwRABDkEQAQ7BEEEQQQ7BEIERQRDBEQEPQRMBEQEOgQ/BFEDOgRRA0YEQQRHBEAESAQ6BEYESARGBFEEQwRKBEEESgRHBEEESQRRBFIEPARJBFIEPARSBFMESwQ8BFMEVARMBE0ETgRCA0AEVQROBEAEUQNfA08ETwRfA2ADRwRVBEAERwRQBFUESgRQBEcEWQRKBEUEUwRSBFgERQRKBEMERQRMBFQEVARbBEUEVQR1A04ERgRfBFEEWARhBF0EWQRQBEoEWQRaBFAEWQRFBFsEYwRbBFwEUwRYBF0EVQReBHUDXwRnBGAEWgRoBFYEYARnBGYEWgRWBFAEWwRaBFkEWwRpBFoEXgRkBKMDZASlA6MDXwSkA78DZwRfBL8DYgRmBG0EZwRtBGYEaQRoBFoEaARpBGUEZwTBA8IDcATiA2wEwgPjA20EbwRsBGoEawRvBGoEcAT/A+IDAAT/A3AEcQRwBG8EUwCYAkoAmQJyBHQEcwSZAnQEdQRzBHQEBwMBA5cCAQMHAwADegQHA3YEUwB6BHYEegRTAHwEdQR0BHkEeQR0BHcEewQQAwcDfAQKA4IEcgR+BHcEdwR+BIYEhgR+BH8EeQR3BIYECgMJAxcDggQKAxcDgQR7BH0EfASDBHoEfASCBIMEiwSBBH0EkQR/BIUEhgR/BJEEeQSGBJEEgwSCBIQEhASWBIwEiwSKBIEEjQSEBIwEiwSEBI0EjwSFBI4EkgSRBI8EkASRBJIEiASkBFcFmQSWBJgEmwSLBI0EjASZBJwEngScBJ0EmwSaBIoEoASOBKEEogSjBKEEuASgBKEEjgSiBKEEjwSgBLgEkgSPBLgEkgS4BKUEpgS6BKQE1QSnBJAEZQW7BKYEigP3Ah0DqASKAx0DqASTBKkEqwQfA6oErATCBJcElgSVBJgEnASZBJ0ErQSZBJgEngSvBJ8EngSdBLAEsASdBMUErwSaBJ8ErwSuBJoEsQSwBMgEtASzBM8EtwS0BM8EtAS3BLUEoQSjBLcEowS1BLcEoQS3BLgEtgTPBNIEpQS2BNMEogSkBLkEuQSjBKIE1QSSBKUEpAS6BLkEpgS7BLoEIgMjA9sEqgQiA74EmASrBKoEmASqBMEEwwSYBMEEwwStBJgExATCBKwExASaBK4EmgTEBKwE4gTEBK4ErgSvBMYEsATFBMcEyQTIBMcEywSyBMkEyQTHBOUEywTMBM0EzQTMBM4E5wTmBLMEzgSzBM0E0ATOBOgEtQTnBLME0gTPBNAE6wTRBLUEugTuBO0E1QTvBNQE1QTUBLwE2ARyBdcE/QLDA70E3QS/BMAE3wTcBN0E4ATdBMIE5ATFBOME5QTkBAMFAgXKBOYE5wQGBeYEBgUCBeYE6ATlBAMF0AToBAoF6QQFBdEE0wTQBAoF6wTpBNEE6QTrBA4F6gTvBNME7QTuBOwE7wQSBdQE1gTxBOwEbgT9A/AE8QTXBPAE2QTyBPME9ATkA/UE9gS+BPQE3ATJA8oD9QT2BPQE9gT3BL4E6QPcBPgE+QTfBOAE+gT3BPYE+wTBBPcE/QT4BPkE/QT5BP4EIQX+BAEFAwXkBB8FBAUBBQIFBAUCBQYFBwXoBAMFJQUEBQYFJQUGBQgF6AQHBQoFCAUGBQUF6QQIBQUFKwUIBekE6gQnBQsFCgUJBScFKwUNBS0F6QQOBSsF7AQNBQ4FMwUSBQ8FEAUfBBEFDAURBS0FMwUyBRUF/QMQBfAE8QQQBREF8QQRBQwFFQUyBRQFFgUABHEEFwUTBRYF8wQUBRcFGAX1BAME6QP4BPwE6QP8BAsEHAX8BB0FHgX/BBsFHgUfBf8ECgQLBBwFHAUdBSAFAwUfBSMFIwUfBTsFPAUgBSQFJAUhBSUFMgQpBRwELAUpBSoFLQUqBSsFKAVBBUMFJwUJBSgFLQUsBSoFCwUoBS4FLQUvBSwFLwUcBCwFRwUwBUQFDwUuBTAFLgVEBTAFAQQxBUYFRwUyBTAFMwUwBTIFFAUxBRMFGQUmBDQF+gQZBTYFNgUeBfoEKAQ1BTQFSAU1BSgESAU4BTUFNwU2BTUFOQUKBBwFOgUiBTcFPgU7BToFQAU4BUkFQQU9BUAFKQU/BTwFQAVJBUIFQAVCBUQFQwVBBUQFRAVBBUAFRQVCBTUEQwVEBS4FNQQ2BEYFRQVGBUcFRgU2BAEEOAVIBTcEQgVJBTgEUwVNBXUETAXIAk0FTwXPAk4F0QLQAk8FPgTMAtMCUAXUAtICmgJKBVEFUwV1BHkEUQVLBVQFUQVKBUsFTAVNBVIFTwVOBUsEVAXRAlsFTQQ+BFUFVgVVBdQCUgVTBV4FXgVTBXkEWAVMBVIFWQVQBUwFWQVcBVAFXwVbBWAFXQVRBVQFXwVdBVQFWAVnBVkFagVjBVwFYQVqBVwFYQVcBVkFYQVZBWcFYgVUBE0EaQVUBGIFXQVfBWUFpgSIBF0FaAVYBV4FaAVeBWQFbQVdBGEEZgVaBW0FZwVYBWgFaQVcBFQEbAVoBWQFbAVxBWcFaAVsBWcFbwVcBGkFcAVvBWkFcgVzBW4EawVyBdgEuwRlBdgEdgVuBWwFYgRuBHMFbgV0BXEFdwVjBG8FYwR3BWsEdwVvBXAFdQV5BXgFeAVrBHcFeQUWBXEE8wQXBXkF8wR5BdkE3ADbAAMABwAEAAIABAAAAAMABQAAAAQACwAFAAQAAgABAPwAAAEGAP8ADwAGAAABEQAHAAwABAAHAAkACQAKAAsAQQEMABoBDAACAPwABwACAAwADQAuAf0ADwAOAAYAEQAIAAcACAAKAAkAEAASAA8AFQAKAAgAFQAIABQAFAAIABEADgAfAA0ADQAfACIAFwAfAA4AGABBAVQBGAATAEEBGQBDARoADQAiABoAGwAUABYAGwAcABQAHAAVABQAGwAWAB4AFwAgAB8AKAAeABgAIgAhABoAJAAcABsAIgAlANsCJAAbAB4ATABFAEQA2wIhACIAKQDcACoAOgIpACoAKwAqAC0ALQALADMAWwIuABAALwAuAFsCLAArADAAMQAsADAAMAAtADQALgA4ADcANgAwADQAMQAwADYAMgALAAoAMgAKABUANQAyAD0AOQASABAANQAzADIANgA0ADUAEAA3ADkAQgA6AHoCPQAyABUARAA1AD0ANwA/ADkAPgA1AEQAPgA2ADUAOgBCAEAAOwA2AEEARAA9AB0ARQA+AEQARwBBAD4AQgBSAEAAQwBJAEIAQgBJAFIATAAdAEsATABEAB0AcgB1AHYARgAnACAATgAnAEYAPwBOAEYAUQBFAE0AQABPAE4ARwBFAFEASQABA1IASgBIAFMAVABeAFoAVQBUAMQBYgDLAd0BWABaAFcAWABXAFYAWwB4AHUAWgBbAFcAWQCCAHgAXgBZAFsAWgBeAFsAYQBZAF4AYQBgAFkAYACFAIIAZQBkAF8AZwCFAGAAaQBgAGMAVQBqAFQAbABrAGoAbQBoAGsAlABzAJgAcgB2AHMAcgBzAHAAmAB0AJsAVgByAHAAdQB5AHQAfgB3AHoAnwB6AHcAeQB8AMAAeAB8AHkAXQB3AH4AggB/AHwAggB8AHgAgAB+AH0AXwBdAH4AgQCjAH8AggCBAH8AgwB9AKQAgwCAAH0AhACBAIUAgwBlAIAAhACmAIEAZwCHAIQAhgCDAKcAhgCIAGUAaACHAGcAqgCKAIYAigCMAIgAigCIAIYAjACNAGQAjwCHAGgArwCMAIsAjACQAI0AjgCJAI8AkQCOAI8AbgCRAG0AbwCRAG4AsgCOAJEAsgCRAJIAkgCRAG8AbwCTAJIAcQCUAJYAlQCWAJQAmACVAJQAvAC5AJsAmACbAJcAnQCZAJwAnQCaAJkAvACbAHQAwAC8AHQAngCgAOYAnACfAHcAegCfAJ4AoQDCAMAAfwCjAKEApAB9AKIAowDHAKEApgDHAKMAqQDMAKYAhACpAKYAqACGAKcAzQCsAKgArACqAKgArQCqAKwArgCJAI4A0QCwAIsAsACxAK8AswCSALQAkwC0AJIA2wC1ALYA4AC3ALoAlQC3AOAAtgCVAOAAtQCVALYAuADjAOEAmQC7AL4AvQC7AOIAuQC8AOUAuQCXAJsA5wC8AL8AwQDmAOgAwADCAL8AwwDBAMQAyADDAMYAygDHAKYAywClAMkAywCoAKUAzADyAMoA8wDNAMsAzQCoAMsA9ADMAM4A9QCsAM0ArgDOAIkA0ACsAPUArADRAK0A0ADRAKwA0ADUANEA1ADVANEA0wDXANIA1QDaANYA1gDaANkA3wC2AOAAAwDbALYA4QDjAN0A3wDgAN4A4gC7AOEABAG5AOUAuQDeALoAAgHkAL0A5gDkAAcBBgHqAOgAwgDpAL8A6gDBAOgA6wDpAMIA7QDrAMUA7gDIAMYA8ADIAA0BygDxAO8ADgHwAA0BygDyAPEA9AAPAfIA9QDNAPMA9wD0AM8AFAH1ABIB0gD3AM8A+ADQAPYA+gDUAPgA+wD6APgA/ADfAAEBAQDfAPwAAQC2AN8A/gD9AAIB/gD/AP0A3QAAAf8A3gAEAQEB5AACAQMB/gACAeIABwHkAAMBBQHnAAgBBgHoAAcB6gAGAQkBCQEhAewA7ADqAAkB6wALAQoBIQHuAOwA7QAMAesADAELAesAIgENAe4AEAHzAA4BKgESARAB8wAQARIB9gD1ABQBFQETAfcA+QD3ANcA+QAVAfcAFgEYAfYA+wD4ABgBAQEbARkBHAEdAQMBHQEeAQcBGwEFAS8BHQEHAQMBMQEIATMBCAExAQUBHwEGAR4BCgEzAQgBHwEgAQkBHwEJAQYBIgHuACEBIwEiASEBJwEiASUBJwElATkBKAEnATkBDwEpASYBKgEQASgBFAESAS0BLQESASoBEwEsAREBLQH2ABQBFgEXARgBQQEaAS8BLgFDARwBHAEwAR0BLwEFATEBHQEyAR4BMgEfAR4BMwFEATEBNAFEATMBNQEgAR8BCwFGATQBNgEhASABNwFGAQwBOAE3ASQBKQE6ASYBKwE7ASkBPAEoAUwBKgEoATwBPQE7ASsBPQErASwBUAEtAT4BQgEwAUMBLgEaAEMBUQEvATEBMgEwAVcBRAFWATEBRQEfATIBNQEfAUUBRgFHATQBNAFHAUQBSAE2ATUBSAEjATYBNwFHAUYBXQFJATcBNwFJAUcBSwElAUoBOQElAUsBTAE5AUsBTAEoATkBOgFNAWABLAFOAT0BTwFQAT4BVAFTAVIBGQBpAUIBQgFpATABVwFYAUUBRwFZAUQBWwFcAUgBWwFIATUBSgFIAW4BbgFLAUoBOAFeAV0BYAFhAV4BPQF0ATsBPQF1AXQBTwE8AWMBZAFPAWMBdQE9AU4BhwFmAWQBZwFpARkAbAFZAUcBbQFcAVsBbwF9AUkBcAFfAUsBcAFuAX8BYgFfAYIBdAGDAU0BTQGDAXIBhgFkAWMBVAFSAXYBZwEhAHcBagFSAVUBZwFoAWkBawF6AVgBegFaAVgBbQFbAVoBfQF+AWwBXAFtAXwBfAFuAVwBLQNwAX8BcQFwAS0DcwFiAYIBdQGFAYMBhgFjAXMBiQHYALMAiAGKAYkBkwCbAokBiwHTANgAiwH5ANcAigGLAdgA+wDVAPoAjAHVAPsAjQGLAYoBiAGOAYoBiAGPAY4BkQH5AIsBFwH7ABgBkgGTAfsAkwGUAYwBjQGRAYsBjQGVAZEBlgGaAY8BmAGQAZEBlQGYAZEBmgGhAZUBnAEXAUABnAGeARcBngGXARcBnwGTAZcBoAGTAZ8BmgGiAaEBowFlAT8BnAFAAaQBmwGjAT8BmwGlAaMBpgGeAZwBpwGfAZ4BqQGqAZ8BZgFAAVABrQGjAaUBnQGvAaUBrgGvAZ0BsQGqAakBsQGpAbABvQGFAWUBswGkAWYBowG0Ab0BpgGkAbMBrwG2Aa0BtQGwAaYBuAGwAbcBsQGwAbgBugG2Aa4BsgG6Aa4BqwG7AbIBvAG7AasBtAE5BL0BtgG/Aa0BwQGxAbgBuQGxAcEBvAHMAsIBxQHGAcQB2QFYAFYAyAFcAFgAyAHZAccB4wHHAeAB4wHJAccBzAHKAckBbgD2AW8AzgHKAcwBYgBmAM0BZgDPAc0BxgHFAc4B0AHGAc4B0gHQAdMBbABqANEB1AHSAdMB1QHUAdMBbADWAW4A1gFsANQB9AHWAdQBUgJWAhMC1wFwAHEA+wHXAXEA1wH7AdgBVgBwANcB2wHcAZ0A2gHZAdcB3AEEAv0BBQLaAdgBBQLYAQICxwHaAeAB4AHaAQUC3QHeAdsB3gHhAQQC4QHiAd8B4wHgAQYCCALjAQYC3QHLAd4BywHhAd4B5AHjAQgC5QHiAeEB5QHmAeIB5gHnAeIB6AHMAeQB7QHmAc8B6gHnAeYB7AHrAegB7QHPAWYA6QHtAfAB6QHqAeYB7gHrAfMB8AHtAe8B8QHwAe8B8wHVAe4BEQL1AfMBkADxAe8B9AHVAfUB9QHVAfMB+AH2AdYB9wHxAZAA9AH4AdYB+gGTAPYBIgL7AfwBuACaACAC+wEiAiECAAKaAJ0AAAL9AZoAAQIkAv0B2AH+AQIC/QEEAgEC3wEHAicCKQIGAgMC4gELAgcCCwIJAgcC5wELAuIB5wENAgsCCwINAgkCDgLsAegB6gENAucB6QEQAuoBMwIRAuwB8AESAhACEwIRAjMCEgLwAfIB8gEUAhICFQL1ARECEwIVAhECFgL3AZAAFwL3ARYCGgIcAhkCHAL6AfgBHgI6Ah8CIALjALgAIAIjAj0CIQIiAh8CJQIhAh8CIAL9ASMCJQL+ASEC/wH+ASUCAQIoAiQCAQInAigCAwL/ASkCKgIpAv8BKgL/ASYCLAJCAicCJwJCAigCLQIpAisCKwIpAioCBwIsAicCLQIIAikCCQIsAgcCSQIKAi0CDgIMAi8CLwIMAgoCSwIvAgoCDwIuAg0CMwIOAi8CMQIPAhACMQIwAg8CUgIzAk8CMQISAhQCVAIxAhQCEwJWAhgCFwI2AjcCFwIWAjYCFAIXAjcCFAI3AjQCNAJUAhQCNQIaAhgC2QA2AhYCGwIcAp0CNwI2AlkCngIaAjgC4wA5At0AHwI6AjwCXAIfAjwCPwIfAlwCPQI7AjkCQAI+AiMCQAJBAj4CKAJCAkECXwIrAioCRAJhAkICLAJEAkICRgItAisCRgIrAkUCRwJEAiwCRwJjAkQCSQJGAmMCSgJIAkcCSAJKAkkCSgJLAkkCTQIvAksCLgJMAkoCSgJMAksCTgJLAkwCTQJLAk4CUAJMAjACUgJPAlECMgIxAlUC3QBbAgABagJUAjQCNQJWAlcCagI0AjcCNQJaAhoCWgI4AhoCuAKqArECOwIvAFsCLwA7Am4CXAI8AiwAXAIsAG8CQQJuAj4CXgI/AlwCXgJcAm8CKgImAl4CcwJeAnICXwIqAl4CXwJeAnMCYQJDAkICRAJFAmICYgJhAkQCRgJFAkQCYwJGAkQCUAJkAkwCZQJkAlACZgJOAmUCMgJnAmUCagJpAlUCNwKjAmoCagJrAmkCbQJsAlcCbgJ6Ai8AbwIsADEAbgJ7AnoCXQJ7Am4CXQJxAnsCcAJxAl0CcAJ0AoICSwAcACMAZwJ2AnUCdwJ1AnYCdwJmAnUCeQJTAngCeAJTAmgCaQKDAmcCaQJrAoMCbAJtAqkCbQJ5AowCewJ8AnoCcgJvAn0CgAJyAn0CgAKBAnQCdAKBAoICgAKCAoECcQKCAn8CdgKDAoQChAJ3AnYChgJ4AncCeAKGAowCawKHAoMChwJrAq0ChwKKAoMCfQI8AI4CcQJ/AnwCfwKJAnwCfwJ+AogCiQJ/AogChQJ3AoQCiwKFAo8ChQKKAo8CjAKGAosCfAKNAkMAjgI8AEgAjQKJAo4CjgJIAEoAfAKJAo0CigKRAo8CkAKSAosCigKHArwClAKLApICjgKVAo0CmAKVAo4CkQKTApkClAKSApYClQKXAkkASQCXAgEDmQKWApECnQKbAhsCngKdAhwCjAGiAtoAWQJYAqICoQKiAowBoQJZAqICpAKjAlkCnwKlAqcCnAKmAo8BnwKnAqYCqQKuAqUCpwKlAq8CqAKnAqwCqwK1Aq0CswKpAm0CqQKzAq4CuQLGArcCqwKkArgCtQKrArgCrwKuArICrAKwAqgCrwKyAqwCswKMArQCrgLBArkCrAK7ArACsgK5ArcCvAK/Ar0CswK0AsECvQKTArwCvwK4AsACuQLBAsQCtgKqAcICwwK4ArECEgMWAxUDtwLGAsUCkwK9AscCwALKAs4CvQK/As4CwQK+AsgCwgK5AbYCwALDAsoCzAK8AboCugLNAswCxgLLAs0CvgJzBE0FzgJKBb0CyQK5Ac8CzwLQAskCywLSAtQCIwAkANUCJADXAtwC3gIlACYAKAB2AdkCIQDaAncB1wLZAuAC3QLYAiUA3gLfAt0C4QLiAuMC5ALWAuEC3ALgAuUC3QLoAtgC2ALoAvAC3wLmAt0C6QLgAkQDNAPnAkUD5QLpAu8C4gLcAuUC4gLlAu8C5gLxAugC7ALxAuYC6QJEA1IDYgPnAu4C6ALxAvAC6gLvAvQC4gLvAuoC6wLjAuoC8gLrAuoC7wLpAu0C8AL1Au4C8wLrAvIC7QL4AvQC+ALtAmED9QJ4A+4C7AL2AvUC9gL3AvUC+wLyAvoCTQBMAP4CTwADA04A/wJQAFEAUgAAA08AAQMAA1IAJwDfAt4CDQP/AlEABQP/Ag0DBQMIA/8CBwMGAwADCQMIAwUDCgNTAAgD5AIMAwIDDAPkAgsD3wIOA+YCBAMSAwMDEAMEAwYDFAMJAwUDGAMLAxEDGAMPAwwDDwMNAwIDGwMUAw8D7AIOAxwDFQMcAxID/QIgA/sCGQMYAxEDGgMTAxgDHgMTAxoD9gLsAh0DlQQXAxsDGQMRA/MC9gIdA/cCFQOoBB0DHwMbAx4DdgEzA0QDIgMhAyMDZwF3ASQDeAFqASUDZwEkA2gBagF5ASUDbQF6ATYDbQEoA3wBfQErA34BfgErAywDLQN/AYABLgMrA28BPQNxAS0DLwOBAXIBMAOCAXEBMANzAYIBcwEwAz8DMQOGAXMBMgOEAYUBPwSHAYYBTwNOBHQDJgMnA2sBewE4A3kBeQE4AzUDKAM2AzcDewEpAzgDKwM5AywDOwMtA4ABLgM5AysDPQMtAzsDgQEvAzwDMANxAUwDgwE+Ay8DhAE+A4MBPwMxA3MBhAFAAz4DQgOEATIDQgNAA4QBQQOGATEDPwSGAUEDRAMzA0MDJQM1A1UDNwM2A0gDNgMnA0cDNQNYA1UDKQMsA0kDOgMqA1wDSwNdAzwDXgM9AzsDTAM/AzADPgNPA00DQANPAz4DMQM/A1ADXwNBA1AD5wJiA0UDQwNTA1IDYwNHA1cDVQNYA1YDWQM3A2QDOANJA1gDWwNKA1kDXANKA1sDXQNaAzkDbwNMA14DcANOA0wDcANMA28DcgNuA00DTwNyA00DcwNQA04DXwNQA3MD6QJSA2EDYwNlA0cDVgNYA34DSANHA2QDRwNlA2QDWANnA34DSQOBA1gDWQNkA2YDggNbA1kDaQOBA1oDWgNqA2kDawNcA2gDawNsA14DXgNcA2sDbQNqA10DbwNeA2wDcQNOA3AD+QP+AyEEhwNfA3MDYANfA4cDUgN5A2EDeQN2A2EDYgN7A3oD7gJ3A3sDUwN8A3kDYwN9A2UDYwN6A30DVgN+A3wDZgNkA2UDZgNlA38DggNmA4ADZwOTA34DgANmA5IDgQOUA2cDagOXA5QDbQODA2oDagODA5cDhQNtA24DcQNwA28DcgOFA24DcgOdA4UDhgNOA3EDngOdA3IDvAOGA3EDcgN0A54DnwNzA4YDdQOhA3QDYAOHA6QD+AJhA4gDqAOMA3cDeAP3AokD9wKKA4kDdgN5A40DjgN6A3sDdgOLA4gDewN3A4wDjAOOA3sDfQN6A44DfQOQA38DfAORA40DfgOTA48DlAOTA2cDlAOVA5MDlwO3A5QDmANoA5YDawNoA5gDmgOZA4MDmwOEA5gDmwOcA4QDvANxA5wDngO5A50DnwOGA7wDdAOhA54DoQOiA54DhwOfA6ADowOiA6EDiAOpA6YDpgOnA/wCqwOJA4oDjAOoA6oDjQOsA4sDrgOOA60DsgOuA8sDsgOSA38DjwOxA5EDkwO0A7EDtQO2A5IDmAOWA9IDuAPXA5kDmwOYA9QDmwPUA9gDuQO4A5oDnAObA7sDvAOcA7sDvAO7A74DuQOeA70D2wO9A54DngOiA9sDvwOgA8ADwAOgA74DpQOiA6MDZwS/A8EDpwOmA6kDqQOLA8YDxAOpA8YDxAPFA6kDygOqA6sDxgOsA8cDsAPmA8cDkQOxA7ADzQOwA88DsQO0A88DzgO1A7MDlQPRA7QDtgPTA9IDmQPzA7cDtwPzA9ED1wPzA5kD2gPZA/UD2QO+A7sDvgPZA9oDvgPaA9wD2wPdA/kD3wP+A90DpQPdA9sD4wPhA/0D5AOnA8UD5QPEA8YDyAOqA+gD5AMCBPUE5wPGA8cD5wPHA+YDzAOvA8gD6APMA8gDyQPpA+gDywPqA84D6wPnA+YD6QMGBOgD7QPNA88D7gPQA84D7wPPA9ED8QPTA9AD0APuA/EDDATxA+4D8gPTA/ED8gPxAxAE9APvA9ED8gPVA9MD9QPWA9UD9gPVA/ID1wP3AxQE2QPWA/UD9wPXA7oD2gP1AxoE+QP3A70D+QMdBPcD3APaAxkEPQRNBEwE3gPcA/oD/wMiBN8D/wMABCQEAAQBBCQEAgQDBPUEBAQDBAIEBQQlBAQE6QMKBAYEBwTrA+0DCAQFBOsDBwQIBOsDCQTqA+wDDQQJBAoEDwQHBO0DDwQIBAcEDATqAxEEDQQRBAkEEATxAwwEEQQQBAwE9AMSBA4EEwQQBBEEFAQrBBIE9gPyAxAEFgQQBBMEFAT4AysE9QP2AxYEGAQaBBYEGAQWBBUE+AMdBBcE+wMaBBgE+QMhBB0EHQQbBDQEGQQaBPsDGwQiBB4EJQQ0BSYEJwQoBCUEEgQqBA8ELQQTBA0ELQQNBDkFLgQqBBIELgQsBCoEOQU/BS0EPwUVBC0EFwQuBCsEMAQuBBcELgQwBC8EMAQxBC8ELwQxBDgEMgQVBD8FHQQ0BBcENAQzBDAENQQxBDMEHgQ2BDMEHgQjBDYESAUoBCkEvQE5BDIDOgSzAb4BOgS+AT8EtAE7BDkEtQGzAToEtwG1AUgEvwFCBDsEwAFCBL8BuAG3AUkEPAS4AUkEwAFDBEIEwAFEBEMEuwFEBMABwgFEBLsBwgE9BEQEPgQ9BMIBQgRDBEEESwROBTwERARMBEUEPwRBA1EDSQRIBFEEmgSXBIoERgRRA08EUgRRBFcEWARSBFcERgRPBGADXwRGBGADUARWBFUEYARRBF8EVwRRBGAEWARXBGAEVARcBFsEVQRkBF4EVQRWBGQEVgRoBGQEYARmBFgEWARmBGEEYgRhBGYEWwRqBGkEYwRqBFsEaARlBGQEbgRiBG0EagRsBGkEYwRrBGoEZARlBKUDbATiA2UEZQTiA6UDbQRnBMIDbgRtBOMDaQRsBGUEbARvBHAEcQQABHAElwKYAlMAdQRNBXMEmQKaAngElwJ2BAcDdgSXAlMAfARTAAoDeARyBJkCdARyBHcEegR7BAcDegR9BHsEcgR/BH4EVwV/BHgEeAR/BHIEXgV5BIAEEAN7BBYDfQR6BIMEgwSEBH0EVwWHBH8EfwSHBIUEgASRBJAEgAR5BJEEewSJBBYDgQSJBHsElQSCBBcDigSJBIEEfQSEBIsElgSEBIIEkQSFBI8EjgSHBKIEjgSFBIcEjgSgBI8EiASmBKQEpASHBFcFgASQBGQFkwSoBBUDkwQVAxYDlASTBBYDiQSUBBYDHwOVBBsDlgSCBJUElwSUBIkEmQSMBJYEigSXBIkEIgMfAyEDiwSbBIoEjAScBI0EnASeBI0EngSbBI0EhwSkBKIE1QSQBJIEpwRkBZAEvARkBacEPgUoBSYFqwSVBB8DlASpBJMElATABKkEwgTABJQEwgSUBJcEqwSYBJUEnwSaBJsEnwSbBJ4ErQSdBJkEsASvBJ4EsQSvBLAEsQTGBK8EyASyBLEEtwTPBLYEuAS3BLYE7wSlBNMEtgSlBLgE1QSlBO8E1QS8BKcEvQQjA/0CqAS/BIoDvwSrA4oDwAS/BKgEwASoBKkEwgTdBMAExAThBMIExQStBMMExQSdBK0ExgTiBK4EyASwBMcEygTGBLEEyQSyBMgEzATLBMkEsgTKBLEEzATJBOUEzQTKBMsEzQTmBMoEywTKBLIEswTmBM0EzwSzBM4EzwTOBNAEtQSzBLQEtQSjBOsE0wS2BNIE6wS5BO0EuQTrBKMEugTtBLkEuwTWBLoEugTWBO4E1ATyBLwE2ATWBLsE8QTWBNgE8gTaBLwEwwPkA70EvQTbBCMD2wS9BPQEvgQiA9sE3ASrA78EygOrA9wE3QTcBL8EvgTeBKoE3gTBBKoE4ATfBN0E4QTgBMIE9wTBBN4EwQTjBMME4gThBMQE4gT+BOEE4wTFBMMEygTiBMYEygQABeIE5ATHBMUE5QTHBOQEAgUABcoEzgTMBOUE5wQFBQYF6ATOBOUE0QQFBecEtQTRBOcE6gTTBAoF0wTSBNAE7AQOBe0EDgXrBO0EEgXvBOoE6gQLBRIF7ATxBAwFEAXxBPAE7gTWBOwE8gQVBfME1AQVBfIE/QNuBOMD1wRuBPAE8QTYBNcE2QTaBPIE9AS9BOQDvgTbBPQE9wTeBL4E6QPJA9wE3wT4BNwE+QT4BN8E+QTgBOEE+gT7BPcE+wTjBMEE/gT5BOEE/wTjBPsEGwX/BPsE5ATjBP8EHQX9BP4EAAX+BOIEHwXkBP8EAQX+BAAFAgUBBQAFIwUHBQMFCgUHBQkFCAUrBSUFCgUnBeoEDQUrBQ4FDwULBS4F7AQMBQ0FEgULBQ8FEAX9Ax8EDAUtBQ0F1AQSBTMFMwUVBdQE8wQVBRQFFgUBBAAEFgUTBQEEFgV5BRcFEwUXBRQF9QQYBfYEAwQZBRgFGAUaBfYEGgX6BPYEGQUaBRgF/AT4BP0EGQX6BBoFHgUbBfoE+gQbBfsEHAULBPwE/QQdBfwEIQUdBf4EIgUfBR4FIAUdBSEFOwUfBSIFJAUgBSEFJQUhBQEFJQUBBQQFJgUjBTsFJgU7BT4FJgUHBSMFKgUkBSUFCQUmBSgFLwUfBCAECQUHBSYFKgUpBSQFJAUpBTwFKwUqBSUFCwUnBSgFLAUcBCkFLgUoBUMFLwUgBBwELQURBS8FMwUPBTAF0gJMBVAFMQVHBUYFMgVHBTEFMQUBBBMFFAUyBTEFJgQZBQMENAU2BRkFNAU1BTYFIAU5BRwFNgUiBR4FNwUiBTYFOAU6BTUFOgU3BTUFOgU7BSIFPAU5BSAFPQU6BTgFPQU+BToFPwU5BTwFQAU9BTgFQQU+BT0FMgQ/BSkFMQRCBTgENQRCBTEERQVEBUIFNQRGBUUFRwVEBUUFNwRJBTgFOARJBTcEmgLHAkoFSwXOAtECzgJLBUoFzwLBAU4F0ALPAk8FZgVfBWAFVQU+BNMC1AJVBdMCUwVSBU0FSwXRAlQF0QJPBVsFVgVNBFUFUAVcBdQCXAVWBdQCVwV4BJoCmgJRBVcFWQVMBVgFWgVPBUsEWwVPBVoFXQVXBVEFiARXBV0FXgVYBVIFVAVbBV8FSwRTBFoFXQRaBVMEYAVbBVoFVgViBU0EYwViBVYFXAVjBVYFgARkBV4FbQVaBV0EZgVgBVoFYwVpBWIFZwVxBWEFcQVqBWEFawVlBWYFZQWmBF0FZAW8BGwFcwVtBWEEYQRiBHMFcwVmBW0FawVmBXMFbAVuBXEFbwVjBFwEaQVqBXAFcQVwBWoFcQV0BXAFcwVyBWsFawXYBGUFvAR2BWwFdAV3BXAFdAV1BXcFbgV1BXQFbgV2BXUF1wRyBW4EdgXZBHUF2QR2BdoEvATaBHYFeAVvBGsEdQV4BXcFeAVxBG8EeQVxBHgF2QR5BXUFIgAfACUATABNAEUAcgBXAHUAYgDNAcsBbgDWAfYBUgJTAlYC3QA5AlsCuAKkAqoCSwAdABwAuQLEAsYCEgMEAxYD/QIjAyADdgF4ATMDTwNAA04E+QPdA/4DPQQ+BE0EmgSsBJcEIgOqBB8DPgVBBSgFLwURBR8E0gLIAkwFZgVlBV8FYwVqBWkF", "g": [[0, 8400, "hood"]]}, "tricorn": {"s": 2.0445153518734036e-05, "p": "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", "n": "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", "i": "BgAEAAUABQAEAAcABQAHAAkACAAFAAoADQAOAAUBDgABAAIAEQCRAEoAFQASAAMAFAAVABgAAwASABEAFQAGABgAFAAYABYAaAAtABYAGAAGAAgAGQAYAAgAGQBoABgACAAGAAUAHAAbAB4ATwAcAB4AHQAKAAwAHQALACAAHQAgAB8AHQAMAAsAHgAdAB8AJwAqACYAKgAPABUALAAqACsAJgAqACwALAAnACYALwAuADAAHgAfAC4AMAAuADIAMQAfACEAMgAxADMANQA2ADQAIgA0ADcANAAjADgANQA0ADgAOQA4ADwAOgA1ADgAOgA+ADUAWQA+ADoAAABJAEIAAABIAEkAQwBCAEEAQgBJAEEAQwBfAEUAAwBKAAQAZQBmAEcASABGAEcARgBlAEcARwBAAD8AEQAQAGcATABoABkASwBNAEwATgBMAE0ATQBLABwATwBNABwAUgAkACIAIgBRAFIAUQBwAFIAEABwAGcAdAA7ACkAdAApACgAmgB0ACgAawBNAE8AUwBrAE8AeABrAFMAVQBTAFQAdwBTAFUAVAAvADAAVABPAC8AVAAwAFYAUAAiADcAewBbAFkAewBxAFsAOwBZADwAXABWAFcAXQBcAFcAfwBcAF0AXwBhAGAAZACFAGEAYgCPAI0APwBAAGIAZABBAGMAhQBjAI4AXwBDAGQAQQBkAEMAZgBAAEcAZgCPAEAAZgBlAI8AjwBlAJAAlgAtAGgAagBsAGgAbgBvAGsAbQBqAG8AbgBtAG8AbABpAGgAaQBsAG0AZwBwAHIAcQB1AHAAbgBrAHgAnABuAHgAdwB4AFMAdwCcAHgAnAB3AHkAewB6AHEAewBzAHoAcwBxAHoAeQB8AH0AoAB9AH4AfgB8AFwAfwBdAIEAjgCEAIYAYQCFAIgAhQCGAIgAhwCIAKkAiACGAKcAiwCMAI4AjACLAIkAiwCNAIkASgCRAJMAkABKALEAZQBKAJAAjwCKAI0AjwCQALEAkgCRAGcAkQCSAJMAlACTAJIAbQCYAGkAdgCSAHIAmgB2AHQAdgCaAJIAmwCVAJoAnACeAG4AnQCeAJwAnQCcAHkAoAB5AH0AnwB5AKAAnwCdAHkAxACfAKAAoQDEAKAAogChAKAAogCgAIAApACjAIMAyQCjAKQAhACOAIwAqACEAKYAhgCEAKgAhgCoAKcAiACnAKkArACpAKsAiQCKAM0ArQCJAM8AjACJAK0ApgCMAK0AsQCvALAAzQCKALEAlQCzAJQAtgCyALMAtAC3ALMAtQCWALgAKgAoADgAmAC6AJcAmQC6AJgAvAC5ALoAuwC8ALoAmwC9AJUAvgC0AL0AlgC1AL8AwAC7AJkAwQDAAJ4AwgCdAJ8AwgDBAJ0AwwDCAJ8AxQDEAKEAxgChAKIAowDJAMcApQDJAKQAywCmANAAqACmAMsApwCoAMwAzACoAMsAzADmAOkAqwCqAOkArQDPANAA0QCyALYAtgDSANEArgDRANMA0QDSANQA0QDUANMArwDVALAAzgDNALAAvwC3ALQAtwDSALYAtQDSALcA1gDUANIA2AC8ALsA2QC5ALwA9QDZANgA2gDYALsAwwDbAMIA3ADbAMMA+ADaANsAxgD9AN0A3gD9AMYAAAHeAMgA4QDfAKUAygD1AeIA5ADQAOMA5gDLAOQA6QDmAOgA5gDnAOgA7ADPAOsA7QDTANQA7gDVAPwB7QDvAPwB8ADOALAAsADVAPAA8ADqAM4AuADxANYA8QDUANYA8gDxALgA8gDzAPEA8gABAvMA/gEBAvIA9QDXANkA9wD2APUA+QD1ANgA+QD3APUA+AD6APkA+gD3APkA/AD7ANwA+wD4ANsA/ADcAN0A/QD8AN0A3gD+AP0AAAH/AN4A4AABAQABDQAFAQQBAwEGAQIAAwFFAQoBCgFFAQsBCAEMAQ0BDgEIAQkBCQEKAQsBDgEJAQsBEAEMAQ4BEwEgAAQBIQAgABMBIQATARIBIQASARQBEgEEAQcBFQEHARYBFgEHAQ0BFgEXARgBGQEVARgBFgENARoBFwEWARoBTQEXARoBDQEPARsBGwEPAR8BGgEbARwBHAEbASUBHgEcAR0BHwEPAREBGwEfASUBJQEfASMBHQElASABIAElASEBHwERASIBHwEiASMBJQEjAS8BLwEjASYBIwEkAVQBJAEiAVQBJwFUASgBKwEhABQBKQEzADEAKgEpASsBKgEzACkBKgE9ADMAGQEtARUBLQEsASsBIQElAS4BLgElATABMAEvATEBMQEvATIBNQEmAScBMgEzATYBNgEzATcBNgE7AVgBMwE1ATcBNQE4ATkBXAE9ACoBNgE3ATsBOwE3ATwBPAE3AT0BPgE3ATkBQAE+ATkBPwFaAUEBQwE9AT4BQgFDAUABQgFAAUEBRAFFAF8ARAFfAGQBRQFHAQsBRwFIAUkBCwFHAUoBSwEOAQsBSwELAUoBSgFHAUkBSwFKAWsBEQEQAUwBTQEaARwBTwEYAU4BGQEYAU8BUAFOAU0BTwFOAVABUgFNARwBVwFQAVMBUgFTAVABUQFSARwBHgEhAVEBHgFRARwBIgFMAVQBLAFcASoBVgEsAVUBVgFeASwBVQEZAU8BcwFVAU8BcwFPAVcBKAFUAVkBWwEoAVkBXAFdAT0AXQFeAD0AeAFeAF0BXwFdAVwBPQFhATwBWgFbAWABYQFgAWIBYwFiAWABZAFgAGUBZgFkAWcBZwGEAWYBRgFmAUgBawFKAUkBbAFLAWsBbAFrAWoBagGJAWwBbQFSAVEBbQFTAVIBVwFTAW4BbwFuAXABVAGMAXIBVQFzAVYBcwF+AVYBVwFuAW8BdAFXAW8BcwF0AX4BfwFYATwBcQFyAXYBdQF/AXcBWQFxAXYBWwFZAXYBYwFbAYABeQF4AV0BewF6AV8BegGiAXkBfAF9AXoBdwF/AYABeAGCAIEAeQGBAXgBgwGCAawAZwGDAYUBhAFnAYUBhAGFAagBaAGGAYcBhgGoAYgBigGHAYgBbAGJAYsBcAFtAY0BbwFwAY8BjwFwAY4BcAGNAY4BjwGOAZABVAFMAYwBmAGSAZEBdAGfAX4BlwFvAY8BlwGPAZABmAFRAVgBdQF2AZoBmgGbAVgBmgGcAZsBnAFYAZsBWAGcAZgBmAGcAZQBfgGfAZ0BlwGgAZ8BnwGgAaEBogGjAYEBgQGkAIIApACBAaMBpAGjAaIBfQGkAaIBpQGsAL4BpQHBAaYBqAGmAakBigGIAaoBiAGrAaoBiwGJAawBiwGsAa0BTAGuAZMBkwGuAcYBsQGwAY4BsgGxAZEBlAGWAbMBtAGzAcgBlwGQAbYBoAGXAbYBkgGYAZkBtAGSAZkBtAG1AbgBtQGSAbgBoQGeAZ0BoAHPAaEBngGhAb0BuQGlAKMBuQHhAKUAugHhALkB1AG6AbkBwQG+Ab8BpwHBAdoBwgGnAdoBpwGpAaYBqQGnAcMBqwHDAdsBrAHEAa0B5QHGAa8BxwHIAcYBsgHJAbABsgHnAckB5wG3AckBzQGRAcwBtQHIAccBkgHLAcwBywG1Ac0BzQHMAcsBoAG2AdABtwGQAckBzgG3Ae4BzwHWAb0B0QH0Ac8B1AG7AbwB0wHVAdQB1QHwAdQBwwHCAdsB2wHcAd0B3gHbAd8B4wGvAeIB4gGtAeAB4wHiAeQB5gHjAeQB6QHKAZEBygHqAecB3ALKAekB6wGRAc0B7AHHAeUB6wHsAekB7QHlAeYB7AHtAdwC4wLQAc4BzgHgAuMC0QHQAeMC7wH0AdEB4wLvAdEBAgHgANIB8gHxAdUB1gHXAdMB9AHzAdYB+QHoAPgB6wDqAPsB/QH8Ae8A/AH9ARECAALwAO4AAQLvAPMAAgIDAv4B9gACAvQABAIFAvYABAL2APcABgIEAvcABgIVAgQC+wD6APgA+wAYAvoABwIYAvsA/gAIAvwACQL+AP8AAQEKAv8A+QEPAgsC9gH5AQsC5QAQAgwC+AH3AQ0CDQL3AQwCDQIMAiAC+QH4AQ8C+wH6ASYC+wEmAhACJgL6ASkCAwISAv8B/wESAhECAAIpAvoBEwIUAhICEwIDAgUCFQIWAgUCAwITAhICGQIYAgcCCQIbAv4AHgIKAh0CCgIeAhwCHwIeAh0CIgIOAiECCwIPAiMCIwIPAiICJAILAiMCJAIjAjkCEAIlAiACIAIlAigCKAIlAjwCEwIqAhQCKwJAAioCKQInAiYCKgIsAicCLQITAhYCLQIrAhMCRAItAhYCLQJAAisCLgIWAhUCGgIxAhkCMgIxAhoCMgJJAjECMwIyAhwCMwJOAksCNAIcAh4CHwI0Ah4CNAIzAhwCNAJOAjMCNQJPAjQCIQI8AjYCIQI2AjgCIwIiAjcCOQIjAjcCUQI5AjcCUQI3AjgCJwI/AiUCQAJBAiwCLwJGAi4CRgJEAi4CRwJGAi8CRgJFAkQCRwIwAjECSQJKAjECTwJkAk4CUAJPAjUCUAJlAk8CUwJRAlICNgI+AlUCVQI+AmYCVAI2AlUCZwJUAlUCVAJnAlICQgJWAlgCPgI/AkMCWAJZAlcCQwJZAloCPgJDAmYCWwJcAkUCXAJWAkUCXQJcAlsCRgJeAlsCXgJdAlsCSAJeAkcCegJfAkgCSgJgAkgCYAJ6AkgCfQJhAmICZQJiAmQCZwJVAmgCVQJmAmgCWgJZAmwCbAJZAm4CbwJZAlgCbwJwAm4CcQJmAloCcwJ0Al0CdAJ2Am8CdQJ2AnQCeAJ5AnUCeQJ3AnUCeAJ0AnMCegJ4AnMCewKZAnwCfgJ7AmACgAJ9An8CgAKZAn4CgQKAAn8CawJqAogCaAJyAogCggJrAogChAKDAnACbQKDAoUChQKDApwChgJyAnECcQJtAocCcQKHAoYChQKHAm0CiAJyAoYCiQKIAoYCiAKJAoICiwKEAnYCjAJ3AnkCjgJ3AowCkAKRAowCkwKUApEClAKSApECkgKUApUClgKSApUCmAJ5AngCfAKZApgCmAKTApECmQKbApMCmwKVApMCmgKXApsCgAKaApkCgQKaAoAChQKdAp8CngKFAp8CoAKNAo8CjQKdAoQCjgKgAo8CjgKhAqACoQKiAp0CjgKMApICjgKlAqECpQKjAqECpAKlAo4CqAKfAqICowKmAqICqAKiAqcCpgKnAqICpAKpAqUCqQKmAqUCqwKmAqkCqwKpAqQCpgKqAqcCqwKsAqoCngKoAq4CpAKsAqsCtAKsArACdgO1AqQCrgKxArICrgKyArMCswKyArsCswK7AsACrAK0Aq0CtAK+Aq8CtwK4ArQCuwKyAr4CugK3ArYCuQK6ArYCwQK+ArgCwAK7AsECwALBAsICwwK9ArwCxQLBAr8CxALGAsUCxgLHAsUCwALJAsoCxwLCAsECwgLJAsACzALCAscCzALNAsICzgLNAswCygLNAtACzgLQAs0CzwLKAtACywLOAswC2AHiANEC4gD2AdEC2AHRAtIC2QHYAdIC2QHSAtMC2QHTAtQC1QLcAdQC3QHcAdUC7ALfAd0B4QHfAdYC1wLgAdYC5AHiAdgC5gHkAdkC2QLkAdgC1wLWAu0C6gHbAugBygHaAtsC3ALaAsoB7QHmAd8C4ALoAeEC4gLzAe8B+ALvAeMC+ALiAu8B5wLXAfMB5gLyAdcB6QLTAugC6QL+AgAD6gLUAukC6wLVAuoC3QHVAuwC7QLuAu8C7gLsAusC2QLwAvIC3wLZAvEC1wLtAu8C8ALXAu8C8QLZAvIC8ALvAvIC3QLeAtsC9QL0AvYC9gINA/UC4QLzAvQCEgPnAuICDQP4AvUCDQP3AvgC+QIfAuQC5gL7AvoCEgP7AuYC/AILAiQC/AIkAv0C6AL8Av4C6gLpAgADFQPqAgAD6wLqAhUDAQPrAhUDFQMWAwED7wIDAwYDBQMEAwYDBQMGAwcD8gLvAgQDBQPyAgQD9ALzAgoDCgPzAgkDCwMSA/cCDwMLAwwDNQIfAvkC+wIgAxEDIAP7AhIDCwMgAxIDIQP9AjoCFAMAAxMDFQMAAxQDGAMBAxYDBwMGAwMDAwMYAxkDAwMZAxoDCAMHAxwDCQMIAxwDHAMHAxsDHAMbAx0DCgMJAx0DHgMKAysDCgMdAysDDwMgAwsDDgMMAw0DDgMPAwwDMgMOAzUDEAMfAzUCNgNQAh8DNgNlAlACHwMQAxEDIQM6AlMCIgMhA1MCFAMTAyMDFAMjAzoDJQMXAyYDJgMUAzoDJQMmAzwDJgM6AzwDGQMYAycDGAMlAycDKQMnAyoDQQMpAyoDJwNAAyoDLAMaAygDLQMaAywDHQMtAysDHQMaAy0DSwM0AzUDHgMrAy4DNQMeAy4DLgMrAy0DLgMtA0kDLgNJA0sDMQM3AzADMgMzAw8DNQM0AzIDNAMzAzIDSAMxAzQDNgNjAmUCNwMvAzYDOQM4A2sCOwM4AzkDJAMiAzgDPQMkAzsDPgM9A08DUQM+A08DPwM+A1IDJwM8Az8DQAMnAz8DPwM8Az4DQQNAA1MDVQNBA1MDRQNDA0IDQgNDA1oDSgNCA0QDKANBA0YDLANGA0UDZANNA0gDSAM0A0cDSQMtA0UDTANjAi8DTANNA4ECgQJ/AkwDTQNMA04DTQNOAzEDOwM5A4ICOQNrAoICUQOCAlADUgNRA1ADUgM+A1EDUwM/A1IDVQNTA1QDUwNSA1QDVwOWApcCWAOWAlYDXANWA1cDWANWA1wDWQNYA1wDWgNZA1sDWQNcA1sDYANZA1oDXwNhA2ADXwNVA2sDYgOaAoECYgOBAk0DYgNjA5oCZANjA2IDZQNcA2MDXANXA2MDZQNEA1sDZQNbA1wDigKeAlIDZgNnA2gDVQNUA2YDVQNmA2gDWAOkApICawNoA28DZwNtA2gDbANrA24DcQOkAmkDbgNxA2kDngKuAnkDcANtA3MDcwNtA54CbgNwA3QDcANzA3QDcwOeAnkDcwN5A3QDbgNvA3ADdwN4A3EDdwNyA3UDdQN4A3cDewN2A3UDswJ5A64CfwN0A3kDfwN5A7MCtgK1AnYDfQN/A4ADfgO8ArkCegPAAsgCgAN6A8gCfQOAA4EDgQOAA8gCfgN9A4IDggO8An4DgwPEArwCfQOBA4IDhQPEAoMDgQPIAoQDhAPIAsoCggOEA8oCgwPKAoUDAQAAAEIAAgABAEQARAABAEIABgADAAQARgAJAAcAAAAFAAkAAAAMAAUACgAFAAwASAAAAAkASAAJAEYADgALAAAACwAMAAAADQALAA4ADgAAAAEADwAQABMAEAARABMAFQATABIAFQAPABMAEgATABEABgAVAAMAFwAWABgAaAAXABgAFwBoABYAGgBMABkAGgAZAAgAGwBLAAgAGgAIAEsAGgBLAEwAGwAcAEsACgAbAAgAHQAeAAoAHgAbAAoAIAALAA0AIQAfACAAIwAkACUAIgAkADQADwAlABAAIwAlAA8AOAAjAA8AOAAPACoAJwArAC0AKAApADgAKgAVABQAKwAqABQAUABxAFEALQArABQAFgAtABQALwAeAC4ALwBPAB4AMQAuAB8AMgAuADEAMwBXADIANgA3ADQANgBYADcAIwA0ACQAOQA6ADgAOQBZADoAKQA7ADgAOwA8ADgAOQA8AFkAPQBXADMANQA+ADYAPgBYADYAWQBYAD4AQQBJAD8ARABCAEMARQBEAEMASgADABEAZQAHAAQARgAHAGUASQBHAD8ASQBIAEcATABqAGgATQBrAE4ATgBqAEwAawBvAE4AcAAkAFIAIgBQAFEAcAAQACUAcAAlACQAdAB7ADsAJwCaACgAVABTAE8AVgBVAFQAMgBWADAAWABaADcAWQBaAFgANwBaAFAAWgBZAFsAVwBeAF0AWwBxAFoAewBZADsAXAB8AFUAXABVAFYAVwBWADIAhwBhAIgAXgCBAF0AhQBkAGMAXwBkAGEAYwBBAD8AYwA/AIsAiwA/AGIAZQAEAEoAjwBiAEAAkQARAGcAlgAnAC0AbQBsAGoAaABpAJYATgBvAGoAUQBxAHAAcQBzAHUAcAB1AHIAcwB0AHUAdQB2AHIAdQB0AHYAJwCWAJoAdABzAHsAVQB8AHcAfAB5AHcAfgB9AHwAfwB+AFwAfwCAAH4AgACgAH4AgQCDAH8AggCDAIEAfwCDAIAAhgCFAI4AwwDdANwAjQCLAGIAjQCKAIkAjgBjAIsArgBKAJMAigCPALEAkgCVAJQAkwCUALIAaQC5AJYAbgCZAG0AmACXAGkAbQCZAJgAcgCSAGcAmgCVAJIAmgCWAJsAngCZAG4AowCiAIAAgACDAKMAggCkAIMApgCEAIwAqwCpAKoAqQCnAKoAqgCnAMwAhwCpAKwAkwCyANEArwBKAK4ArwCxAEoA1QCvAK4AsgCUALMAlQC0ALMAswC3ALYAlwC5AGkAlwC6ALkAlgC5ALgAmQC7ALoAvQC0AJUAvQCbAL4AvwC+AJsAlgC/AJsAvgC/ALQAwADaALsAngDAAJkAnQDBAJ4AwQDaAMAAxADDAJ8AxQDDAMQAxgDFAKEAowDHAKIAxwDGAKIAxwDIAMYApQDfAMkAygCrAOkA0ACmAK0A5ADLANAAzADLAOYAqgDMAOkAzwCJAM0A6wDPAM0A6wDNAM4ArgCTANEA1QCuANMAsADNALEAtQC3AL8AtQDWANIAuADWALUAuQDXALgAvADYANkAuQDZANcAwgDbAMEA2wDaAMEAxwDfAMgAxgDdAMUAyADeAMYA1ADzAO8A3wAAAcgA4AAAAd8A4QDgAN8AygDpAPUB5wDkAOUA5QDkAOMA5wDmAOQA6QDoAPUB0ADPAOwAzgDqAOsA4wDQAOwA1QDTAO0A1QDtAPwBuADXAPIA1wD+AfIA1ADvAO0APQFCAWEB1wD0AP4B9QD2ANcA9gD0ANcA2gD5ANgA2gD4APkA3AD7ANsA/gD8AP0A3gD/AP4AAQH/AAAB4AACAQEBAwECAEQADgACAAUBBQECAAYBBAEFAQYBBwEGAQgBBwEEAQYBCAEGAQoBCQEIAQoBBgEDAQoBDQEHAQgBDAEIAQ4BDQEMAQ8BDwEMARABEQEPARABBAEgAA0AEwEEARIBFAESAQcBFQEUAQcBFgEYARUBGgENARsBHQEcASUBIAEeAR0BIAEhAR4BIwEiASQBJgEjAVQBJwEmAVQBKQExACEAKQEhACsBFQErARQBKwEsASoBFQEtASsBMAElAS8BLgFRASEBMAFRAS4BNQEvASYBMwEyAS8BNQEnATQBMwEvATUBMgE2AVgBNQE0ATgBNAEnASgBOAE0ASgBOQE3ATUBPgE9ATcBOQE4AToBQAE5AT8BPwE5AToBQAE/AUEBPwE6AVoBYAFBAVoB/QEDAv8BQwE+AUABRAFEAEUAAwFEAEQBAwFEAUYBRQEDAUYBRwFFAUYBRwFGAUgBSwEQAQ4BTQEYARcBTQFOARgBUgFQAU0BIgERAUwBXgFcASwBVQEtARkBVQEsAS0BVwFPAVABMAExAVEBMQEyAVEBMgFYAVEBOwE8AVgBOgE4ASgBWgE6ASgBWwFaASgBXgB4AYEAXwFcAV4BXwF5AV0BXgF7AV8BVgF7AV4BPAFhAWIBQQFhAUIBYQFBAWABYwFgAVsBYgFjAX8BZAFfAGAAZwFkAWUBZgFGAUQBZgFEAWQBSAFmAWgBaAFmAYQBSQFIAWgBSQFoAYcBaQFJAYcBagFpAYcBawFJAWkBbAEQAUsBawFpAWoBTAEQAWwBbQFuAVMBUQGNAW0BbQFwAW4BcQFUAXIBVwF0AXMBWQFUAXEBgAFbAXUBdgFyAZUBfwF1AVgBdQFbAXYBXwF6AXkBewF8AXoBegF9AaIBfgF7AVYBewF+AXwBYgF/ATwBfwFjAYABdwGAAXUBgQGCAHgBgQF5AaIBZQFgAIIBggFgAIcAgwFlAYIBggGHAKwAZwFlAYMBqAGGAYQBhgFoAYQBhwGGAYgBiQGHAYoBiQFqAYcBiwFMAWwBUQGxAY0BjAFMAZMBUQGYAZEBlQFyAYwBlgGVAYwBlgGcAZUBlgGMAZMBdAFvAZcBlwGfAXQBdQGaAVgBnAF2AZUBmgF2AZwBlAGcAZYBfgGdAXwBfAGdAX0BfQGdAZ4BnQGfAaEBowGlAKQAvAGkAX0BfQGeAbwBpQGDAawAvgGsAKsApgGDAaUBwQGlAb4BhQGDAaYBpgHBAacBqAGFAaYBqwGoAakBqwGIAagBrAGJAYoBrAGKAaoBTAGLAa0BrwGuAUwBrQGvAUwByAGTAcYBkAGOAbABkQGxAVEBsQGOAY0BsgGwAbEByQGQAbABswGWAZMBtAGUAbMByAGzAZMBtAHIAbUBtgGQAbcBlAGZAZgBmQGUAbQBtAG4AZIBoQHPAb0B0AHPAaABpAG7AaMBuwG5AaMBuwHUAbkBpAG8AbsBvAGeAb0BvAG9AdMBwAGrAMoAwAG+AasAvwG+AcAB2gHBAb8BwwGnAcIBqwGpAcMB3gGrAdsBrAGqAcQBqgGrAcUBxQHEAaoB3gHFAasB4AGtAcQB4gGvAa0BxgGuAa8B5QHHAcYBsgHKAecBzAGRAZIBzQG1AccBtQHLAZIB0AG2AbcBtwHOAdABzwH0AdYB0AHRAc8BugHSAeEAugHwAdIB4QDSAeAA1AHwAboB0wHUAbwBvQHWAdMB1wHVAdMB4gDAAcoA2AG/AcAB2AHAAeIA2QG/AdgB2gG/AdkB2QHCAdoB2wHCAdwB3wHbAd0B4QHEAcUBxQHeAd8B4QHFAd8B4AHEAeEB5QGvAeMB5gHlAeMB6AG3AecB6AHnAeoBkQHKAbIBzQHHAewB6wHNAewB6wHpAZEB7QHsAeUB7AHcAukB7gG3AegB7gHgAs4B9AHvAfMB8AHxAdIB8QECAdIB8QHwAdUB1wHyAdUB1gHzAdcB9QHoAPkB9gH1AfkB9gHiAPUB9wHnAOUA+AHoAOcA+AHnAPcB6gAAAvoB+wHsAOsA+wHqAPoB4wDsAPsBEALjAPsBEQL9Af8BTgJMAksC8ADVAO4A8AAAAuoAEQLuAPwBAgL+AfQAAQL+Ae8A7wD+Af0B9gAFAgIC+gAGAvcAFQIFAgQC/AAHAvsACAIHAvwACgIJAv8AAQEdAgoCAgEdAgEB5QDjABACDAIQAiACDAL3AeUAIAIOAg0CDwL4AQ0CEAImAiUC7gARAhICAALuABICAAISAikCKQISAhQCAgIFAgMCFgITAgUC+gAXAgYCFwIVAgYC+gAYAhcCCAIZAgcCGAIwAhcCCAIaAhkC/gAaAggC/gAbAhoCGwIyAhoCHAIbAgkCCgIcAgkCDgIgAigCDgIoAiECDgIPAg0CIgIPAg4CJQImAicCKQIUAioCKQIqAicCKgJAAiwCEwIrAioCFwIuAhUCLgJEAhYCLwIuAhcCGAIZAjACFwIwAi8CGQIxAjACLwIwAkcCHAIyAhsCMwJLAjICHwI1AjQCKAI8AiECIgIhAjcCNwIhAjgCOgI5AlECJwI7Aj8CPAIlAj8CPAI/Aj0CPwI+Aj0CPAI9AjYCOwInAiwCLAJBAjsCQQJCAjsCPwI7AkMCOwJCAkMCRAJAAi0CRQJBAkACRAJFAkACWwJFAkYCRwJeAkYCMQJKAkcCSgJIAkcCMgJLAkkCSwJMAkkCSQJMAk0CSQJNAkoCzwLOAssCNAJPAk4CTwJlAmQCOAI2AlQCUQI4AlICUgI4AlQCUQJTAjoCNgI9Aj4CQQJWAkICQwJCAlcCQgJYAlcCQwJXAlkCRQJWAkECVgJcAlgCXQJYAlwCXQJ0AlgCSAJfAl4CXgJzAl0CXwJzAl4CTQJgAkoCTAJkAmECYQJNAkwCTQJhAmACZAJiAmECZQJjAmICZgJyAmgCaQJSAmcCagJnAmgCawJpAmcCawJnAmoCUwJSAmkCQwJaAmYCWQJvAm4CbQJaAmwCgwJtAmwCbAJuAnACgwJsAnACcQJaAm0CZgJxAnICWAJ0Am8CdgJwAm8CdQJ3AnYCdgKEAnACiwJ2AncCeAJ1AnQCXwJ6AnMCegJ7AnwCfAJ4AnoCfgKZAnsCYAJ7AnoCYQJ9AmACYAJ9An4CfwJ9AmICfQKAAn4CYwJ/AmICagJoAogCgwKEApwChAKdApwCngKHAoUChgKHAokChwKKAokCdwKPAosCiwKNAoQCjwKNAosCjgKPAncCeQKQAowCkQKSAowCkwKVApQClwKWApUCeQKYApACeAJ8ApgCmAKRApACmAKZApMCmQKaApsCmwKXApUChQKcAp0CnQKiAp8CngKKAocCoAKdAo0CoAKhAp0CpAKOApICoQKjAqICpQKmAqMCngKfAqgCpwKqAqgCpgKrAqoCrAKtAqoCrQKoAqoCrgKoAq0CrgKtAq8CsAKsAqQCpAK1ArACrwKxAq4CrQK0Aq8CtQK0ArACtgK3ArUCtQK3ArQCrwK+ArECtAK4Ar4CtwK6ArgCsQK+ArICvAK6ArkCvAK9AroCugK9ArgCuAK/AsECwQK7Ar4CvQK/ArgCwwK/Ar0CvALEAsMCxQK/AsMCxALFAsMCxQLHAsECyALAAsoCywLHAsYCxALLAsYCzALHAssCzQLKAskCwgLNAskCEAP6AhED1ALCAdkB1ALcAcIB4AHhAdYC7ALWAt8B4gHgAdcC3wLmAdkC4gHXAtgCygHbAuoB3ALtAd8C3ALfAtoC4QLoAdsC3QLbAtoC3wLdAtoC4QLbAt4C9QLjAuAC4ALuAegB+ALjAvUC8QHkAgIBAgHkAh0C5QLkAvEB8gHlAvEB5gLlAvIB5wLmAtcB4gLnAvMB0QL2AQsC6ALSAtEC6ALTAtIC6QLUAtMC/gLpAugC6gLVAtQC7ALVAusC7QLWAuwC7gLtAuwC2ALXAvAC2QLYAvAC3QLfAvEC8wLhAt4C3gLdAvEC8wLeAvEC9QLgAvQC9ALgAuEC9wISA+IC+AL3AuIC5AIfAh0C5QL6AuQC+gL5AuQC5QLmAvoC5wISA+YC/ALoAtEC0QILAvwC/wL+AvwC/wL8Av0CAAP+Av8CAgPrAgEDGAMCAwEDAgPuAusCAgMDA+4CAwPvAu4CBgMEA+8C8QLyAgUDCAMFAwcDCQPzAggDCAPxAgUD8wLxAggDCgP2AvQCDQMMA/cCDAMLA/cCDgMNA/YCEAM1AvkCIQP/Av0C+gL7AhED/QIkAjkC/QI5AjoCIgMTAyEDEwMAA/8CFgMVAxQDFwMWAxQDFwMYAxYDJQMYAxcDGAMDAwIDBwMDAxsDGwMDAxoDHQMJAxwDCgMOA/YCHgMOAwoDDwMwAyADDwMzAzADMgMPAw4DHgM1Aw4DNQIfA1ACNwM2Ax8DIAMfAxEDIAM3Ax8DMAM3AyADZQNHA0QDJAMjAyIDJgMXAxQDPAMnAyUDKAMaAxkDKQMZAycDKAMZAykDQQMoAykDGgMdAxsDLgNLAzUDTgMvAzcDMQMwAzMDMQNOAzcDNAMxAzMDLwNjAjYDOAMiA1MCOANTAmkCOANpAmsCOwMkAzgDOgMjAyQDPQM8AzoDPQM6AyQDPQM7A08DPQM+AzwDQAM/A1MDQQMqA0ADRgNBA1UDSgNFA0IDYANaA0MDRgNgA0MDRQMtAywDRgMsAygDRgNDA0UDZANIA0cDSgNHA0sDSQNKA0sDSwNHAzQDSQNFA0oDfQO2AnwDTAN/AmMCTgNMAy8DSANNAzEDUQNPA4ICiQJQA4ICigJQA4kCUgNQA4oCggJPAzsDVwNWA5YClgJYA5ICWgNbA0IDRANCA1sDXgNdA1kDWQNdA1gDXwNGA1UDXwNgA0YDYANhA1kDWQNhA14DYQNfA2sDXgNhA2sDmgJjA5cCYwNXA5cCZANiA00DYwNkA2UDZwNmA54CVANSA2YDUgOeAmYDWANdA6QCaQOkAl0DXgNqA10DXQNqA2sDbANdA2sDbANpA10DagNeA2sDawNVA2gDZwOeAm0DbANuA2kDbwNoA20DbgNrA28DcANvA20DbgNyA3EDcgNuA3QDdQNyA3QDcQN4A6QCeAN2A6QCdQN2A3gDdQN0A38DdwNxA3IDswLAAnoDfAO2AnYDewN8A3YDewN1A38DfAN7A38DfQN8A38DfwOzAnoDfwN6A4ADfgO5An0DgwO8AoIDggOBA4QDhQPLAsQCgwOCA8oChQPPAssCzwKFA8oCKgAnACgAJwAsACsAUABaAHEAVwA9AF4AhwBgAGEAwwDFAN0AxwDJAN8A1ADxAPMAPQFDAUIB/QH+AQMCTgJkAkwCzwLQAs4CEAP5AvoCIQMTA/8CIgMjAxMDZQNkA0cDSgNEA0cDfQO5ArYC", "g": [[0, 5400, "hat"]]}, "wizard": {"s": 3.782348826067832e-05, "p": "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", "n": "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", "i": "AgAGAAcACQACAAcACgAGAAUADAAHAAoADAAKAA0ABAADAA8ADgAEAA8AEQAQAAkACQAIABMAEQATABQAGAAXABUAFgAYAB4AKQAZABcAHQAaABsAGgAcAC8AGAAVAB4AFgAdACMAIwAbAAEADgAjAAEAJgAnACUANgAnACYALQAqACkAKwAtACkAKwBFAC0ARQAmAC0ARQAoACYAKQAqABkAKwApABgALwAZAC4AGgAvADkAIAAiAFkAMAAgAFkACgAFAA0AMQAOABAANAA1ADMAQQA0ADIAQQBCADUANwA4ADMALgA3AFgALwAuADkAMABZAEcABQAwAEcAOgBBADIAOgAyADYAOgA2ADsAKAA6ADsAPwBCAEMAQAA+AEIAQABQAD4AQwBCAEEAlAJFACsAIgBGAFkASgA/AEMAUgBIAD8ASgBSAD8ASQBBADoASgBDAEkATgBQAE0ATABLAFAARABYALIAWgBMAFEATwBQAEgATwBIAFIAUQBPAFIATABQAE8ASgBRAFIAPABxABYATQCUAE4AWACDAHAABQBHAA0CDQAFAKMCXABaAFEAWgBWAFUAXQBWAFoAXQBaAFsAcwBdAFsAOgBTAEoAYwBkAGIAZQBmAGMAYgBpAGcAawBkAGYAZwBoAGoAawBoAGkAaABrAGwAYABfAGUAcQArABYAcgBuAF0AUQBTAFwAeAB2AHcADgA9ACMAZgB4AJAAawCQAGoCewBjAH0ARwCFAA0CigCGAIcAmQCBAIgAqgCJAIcAjQCOAJAAdwCNAHgAogCOAJEAegB7AHwAgAB9AH4AwgBvAKkAiwCZAIgAmwCLAIgAiACKAJsAiwCaAJkAggCZAJcAmgCXAJkAKgKKAIcApgCYAJoAmgCbAKYAkACdAJ4AkACeAJ8AoACfAJ4AnwCgAKsAkACfAKsAkACPAJwAkACcAJ0AnACPAKIAngCdAJwAVwD+AZMAhACDALMAswCDAJQAOQAYAkYApQCkAJcAqQCkAKUApwCoAKUAmwCKACoCqwCsAK0AoACsAKsArwCtAKwArwC6AK0AoQCvAKAAsACeAKIAsQCwAKIAhACzALIAOQCyABgClgC0AIUAtQCpAKUAqAC2ALUAxgC1ALYArgC6ALsAlQARAjoAbABrAL0ArwC/ALoAvAC6AL8AwADMAK8AwQDMAMAAsQDAALAAwQDAALEAhQC0AA0CwgCpAMQAqQC1AMUAxgDFALUAxACpAMUAuwC8AMkAyADKAMkAywC/AMwADAHLAMwADAEMAssAfACAAM4AzQB/AM8A0gHPAH8AzQDPANYA1wDTANIA2ADWANUA1wDSANYA2gD2APcA9AD2ANoA3gDfANoA3gDgAN8A4gDdAOEA4QDkAOYA4QDlAOIA4ADeAOMA/ADcAOMA5wD8AOMA/gDoAOUA0ACjAJEAowDQAOkA6gDRANQA0ACSAOoA6QDQAOsA6QDrAO0A7ADUAO4A7ADtAOsA7QDsAPIA8ADvANcA8gDsAPEA9AD1APEA9ADxAPAA3wD4APUA+ADzAPUA+AD5APMABQHzAPkA3wD1APQA+gD5ANwA/AD6ANwACAH7AAkB5wAIAfwA6AD7AOcA/gD7AOgA/wDBALEAAAH/ALEAAQHtAAMBBQEEAfMA+QAHAQUBBwEPAQUBCAEGAfoABgEPAQcBEgEIAQkBzADBAAwBDAHBAP8ADQH/AAIBDQELAQwBDgELAQ8BCwENAQQBEAG2AgYBEQEQAQYBtwIRARIBEwG4AgkBFAEVAQoBFQG5AgoBuQLCArgCCAALABYBFgELAA0ACAAXARgBEwAYARoBEgATABsBGwEUABIAHAEYARkBHQEaARwBHAEZAR8BJAEgASIBIQElASYBIAEmAScBJgElASgBKAElASoBJwEoASwBLAEoASsBKAEqAS0BLAErAS4BLwErAS0BLgEvATQBLwEtATABNAEvATABLgE0ATEBLAEyASkBLgEyASwBMQEyAS4BXQEbAR4BMwEeASQBIgEzASQBcgE1ATQBNwE2ATUBNQE4ATkBNQE5AT0BOAFyATsBPQE5ATwBMQE+ATIBPwEyAT4BNgE+ATEBNwE+ATYBNwE6AUABJAAUABsBIwFfAyUBQgE7AUcBSAFEAUcBRwFJAUoBVAFHAUoBVAFRAUUBVAFFAUgBQQE+AUABRgFAAT0BQwFGAT0BTwFBAUYBUAFPAUYBUAFRAVIBSgFJAVMBUwFJAVUBVgFSAVEBVAFTAVYBUwFVAVgBWQFWAVMBUwFYAVkBWAFLAV8BQQFPAT8BSwGPAV8BXwGPAVoBWwFaAVwBGwFdASQAhAEpAU4BTwF7AT8BVQFJAbYBWAFfAWABWQFYAWABYAFfAVsBWwFfAVoBYQFjAWIBXAFkAWUBZQFkAWYBXQFpASQAaABoAWkBaABpAWwBbQFqAW4BMwFqAV0BbwFqATMBcAFvATMBbwFwAYEBcwFSAVcBYQFbAVwBYQF2AWMBdgF1AWMBdgFlAXcBdQGIAWIBegFtAW8BeQFqAG0BGQEXAV8DZgFkAXwBkAFkAVoBZwF8AX0BfQF8AZQBfQGUAX4BfgGUAYABggGDAXEBdAFzAWIBeAF9AYkBeAGJAYcBiQF+AX8BigGJAX8BiwFvAYEBgwGLAYEBeQF6AY4BjgF6AYsBkAGPAfUCfAGQAaMBfgGAAZIBfwF+AZIBgAGUAZUBlAF8AaMBhAGXAYMBmQGEAU4BmgFSAXMBmgGGAVIBigGIAYcBfwGSAZwBrwGMAZcBnwGOAYsB0gF/AI0B0gGNAY4BoAHSAY4BoQGTAZUBoQGVAaIBlgGhAaQBOwFyAQIDqwGFAXsBSwG2ASwDmgFzAZsBrAGIAYoBlgGkAZ0BiAG3AZsBtwGaAZsBmAGoAa0BngGYAa4BpQGmAbEBpwGyAbMBowGyAbEBwQG1AU4BSQE7AbYBxAG3AawBxAGsAbMBmAGtAbgBrQG0AcUBmAG4Aa4BrQHFAccBuQGeAa4BugGuAbgBowGQAcoBswG8Ab0BvAG7Ab4BygG7AaMBcgEtAUwBwAFOAU0BxAGaAbcBxQHGAc8BuAHHAcgBvAG+AdYCyQG8AdYCvgHKAcsB1gK+AcsBwgHBAdoCzQFNAYUBvwHzApoBxgHCAc8BwgHMAdwCzwHcAtAB1AGfAbAB1AHTAZ8B1QCgAdYB1wHWAaAB1QHTAdQB1wGgAdMB2ADWAdgB2wDiAeUB5ADdAOUBngG5Aa8B2QHUAa8B2gGvAbkB2gHZAa8B2wHYAdcB1QHcAdsB3QHVAdkB2gHeAd0B2ADYAeEB3AHdAeAB3gHgAd0B2QDYAOEB4QHYAdsB3wHgAeMB4AHfAdwB4gH3AOEB4QHfAeMB5AHjAeAB5QHjAeQB5QHkAecB5wHkAeYB5wHwAekB5wHmAfAB8gHzAf4A/QDoAekB6QHyAf0A2gG6AeoBugHrAeoB3gHtAewB3gHqAe0B6gHrAe0B4AHeAewB7AHtAe4B7QHvAe4B5gHgAewB5gHsAe4B+AHwAe8B8QHwAfgB8gH7AfwB8gH8AfMB8wEUAQoB9AH1AdEB9QHIAdEB6wH1Ae8B9gHvAfUB9QH0AfYB6wHvAe0B9wH4AfYB+QH4AfcBbwP5AfcB/AH7AfoB/AFwA/0B+wHxAfkB+gFwA/wB/AH9AfMB/QEUAfMB/wGTACMCsgCzAMMADgLFAMYABQIGAgcCBgIFAgQCBQIHAggCawBqAm0CvgAAArgAywAEAsoADAILAssADQK0ACYCGgIOAgAC/gHCAMQAHQICAscAEgIHAgYCFAIIAhICFAISAiACFQIKAgsCFgIVAgsCFwL/ASMCJgJGABgCGgIZAg4CHALEABkCDwIbAhoCGwIoAhkCKgIPAqYACAIfAi8CLwIfAh4CNALEAiICsgAXAkoCDQImAlwCGQInAhwCKAInAhkCDwIoAhsCKwInAigCJwIsAiMCOwIqAgECKgIrAigCTQIdAgMCMAIyAj0CggKlAjwAQgI9AiICIwI2AjcCJQKyAEoCKgIuAisCLQIkAiwCLQI2AiQCKgItAi4CLQIqAjoCOwI6AioCPAI2Ai0COgI8Ai0CTQIQAh0COAK5ABMCMAI9Aj4CQAIwAj4CPACUAnEAQgI/Aj0CSQIXAjcCGAIlAjkCEQKKAhMCXAImAjkCRwI2AjwCOwI8AjoCOwJLAjwCAQJeAjsCXgJMAjsCuQBOAgMCQQJPAkACQAJPAlACQAJQAlECUgJRAlACUQJTAlQCUAJPAkECQwJSAlACYwJUAlMCVgJmAmMCRQJYAlYCWgJbAlkCWgJwAlsCTAJdAkgCXgJdAkwCXwJeAgECXQJaAlkCXgJgAl0CYQJaAmACXwJhAmACEAJiAgECdwJNAgMCOAJOArkAVAJjAmQCVAJkAmUCVAJlAmcCVAJnAmgCZgJnAmUCagJUAmgCaAJpAmoCagJrAmwCZAJmAmUCYwJmAmQCZgJvAmcCbwJuAmsCVgJvAmYCSgJJAnMCcgJ0AnECSgJzAnoCYQJyAloCfwJfAgECXwJ2AnICfwJ2Al8CdwIQAk0CegJzAnUCegJ1AnkCeQJ8AnoCfgJ5AnsCJQJKAoUCYgJ4An8CYgJ7AngCgQJ7AmICgQJ+AnsCiwKAAhACdwKLAhACSgJ9AoMChQJKAoMChwKGAoUChQKMAogCXAKFAogCgAJ+AoECgAKEAn4CiwKEAoACTgKKAncCjAKGAocCiQKMAocCkQKMAokCigKPAo4CkAKIApEClgKRApMClAKPAooClAKTAo8CggKnAqUCkAKSApYClwKWApMCkAKWApgCmAKWApoClwKbApYCmQKbApcCmwKaApYCmAKaApwCMAACACAAngKdApsClQKgAqECogKVAqECnwKVAqICpAKbApQCpAKeApsCpgKoAp4CqAKhAqACqAKiAqECqAKpAqICqwKpAqoCrQKjAqkCowKtAqwCqwKtAqkCrgKjAqwCpQKmAqQCpQKqAqYCpwKrAqUCqwKxAqwCsgKxAqcCsgKnAjEAZQOxArICtQKzArQCtAIMAgsBtQK0Ag4BvQK2AhABtwK9AhABwQK3ArgCwALDArkCugILArMCuwIiAsQCuwK1Ar0CvAK7Ar4CvgLGArwCxgK+Ar8CvwK+ArcCyAK/AsECyALGAr8CywLMAsACwQLCAskCwQK/ArcCxQIiArwCxgLFArwCNQLFAsYCxgLIAscC0wLSAskCzQLUAtMCzQLMAtUCzALQAtUCxQI1AkMCNQJEAkMCxwJEAjUC0gLOAkQCzwLRAkYC1ALPAs4C0ALRAtUCzQLVAtQCRAJFAlUC1wLKAeAC1gLKAdgCyQHYAtkC3QLMAeMC3gLQAd0CIwEZAV8D3wKPAQcDkAH1AuAC2ALXAuEC1wLgAuEC4gJoAWsBwAHbAtoC3QLjAuYC3gLmAucCcgPeAucC4AL1AugC2QLqAukC6gLgAugC5ALvAu4C8ALvAuQC2wLwAuQC8QJNAc0BzgEDA80B2QLpAvMC7ALzAukC9ALmAu4C9gLsAvcC6wLoAvUC9wLrAvUC+QLvAvAC+QL4Au8CEAPwAsABtgE7AS8DAwPOAfIC8wLsAuUCAQMEA/oC+wL6AgQDBAMVAwYDBAP8AvsC9gL3Av0C/QKRAf4C9gL+Av8C/wL+AgAD/gKRAQAD+QIBA/gC8AIQA/kCOwECAy8DAwPxAs0B/wIDA/ICAQP6AvgCFQMEAwEDgAMFAxcDgAMXA4QDAQMNAwwDDgMNAw8DDAMNAyUDDQMBAw8DPgO2AS8DEwMSAwMDCwMDA/8CEwMLAwkDEwMDAwsDEwMJAwgDAQMMAxUDFAMgAxcDIAMjAxcDFgMXAyMDFgMjAykDBQMVAxQDCAPfAhgDBwMYA98CGQMIAxgDGAMHAy0DGQMYAy0DIgMhAxsD4gIcA+0CHAMaAyEDvQBsAuICHAMzAu0CHQMcAyQDJAMfAx4DJAMhAx8DJgMkAx4DDgMmAyUDMAMQA8ABAwMRA/ECAwMnAxEDEwMIAxkDEgMTAygDKAMnAxIDVwIpA24CIgMbAykDBwMsAyoDKwMqAywDBwMqAy0DMQAzAh0DTwMxAB0DTwMdAyQDTwMkAxADMwMrAzIDMgMRAzMDNwMwAxEDMwMoAy4DLgMqAysDOgNPAxADNQMxAz4DNgMQAzQDPwM2AzQDLAMxAzgDOQM4AzUDTgMxAE8DQwNPAzoDPAMvA0wDTQM9A0wDQAMvAzwDTAEqAUIDAgNMAUUDAgNFA0kDRwNNA0wDRwNIA0QDTwNDA0QDawNnA1EDWQNQA1IDbQNrA1EDVQNtA1EDUgNCA1QDVQNSA1QDbQNVA1QDUQNPA0QDTAFQA1kDWANMAVkDUwNZA1IDRgNFA1sDXQNMAVgDXQNYA1cDXANWA0gDVwNWA14DYAOvArACYgNfA68CXwNiA2MDZANmA2UDZANOA2cDbANmA2gDaQNCA2EDbANhA2YDawNqA2wDZgNhA2MDVANCA2kDbgP0Ad4CcwPeAnID9wH2AW4DbwP3AW4DbwNuA3MD+gFvA3cDcQPAAhUBcQMVARQBdANyA/QCdQNzA3QDdQN0A30DdwN5A3gDeQN+A3YDegN8A3EDeAN2A3ADegNxA3ADfAN7A3EDewPLAsACfQP0AvsCgQN+A/wCfwOBA4IDgwPQAnsDfgN/A3oDegOCA3wDggN6A38DewPQAssChAOFA9ACggOBA4ADgAOEA4MDgAODA4IDIQAAAAMABQAGAAIAAwAgAAIABAAhAAMALQAlACwABAABACEACQAHAAgACgAHAAYACQADAAIACAAHAAwACAAMAAsADQALAAwADgABAAQAEAAPAAkAEAAOAA8ACQAPAAMAEwARAAkAEgAUABMAEQAUABAALwAVABcAGAApABcAHQAcABoAHgAVABwAHQAeABwALwAcABUAIgAaAEYAIAADAAAAIQAfAAAAAQAfACEAGwAfAAEAHwAaACIAIgAAAB8AHwAbABoAIAAAACIAIwAdABsAFgAeAB0ANwAlACcALQAsACoALgAqACwAGQAqAC4AJQAuACwATgA1AEIALwAXABkAGAAWACsARgAaADkANABBADUANgA4ACcAKAA2ACYANwAnADgANgAyADgAOAA0ADMAMgA0ADgAOwA2ACgAKABFADoAIwA8ABYAIwA9ADwAPwBAAEIAPwBQAEAATABUAEsATgBCAD4ARAAuAFgAOQAuAEQASABQAD8ASQBDAEEASQA6AEoATgA+AFAAUABLAE0AgwA3ADMAgwAzAE4AlAKVAEUARwBZAJYAcgCHAIYAUQBMAE8AEAAUADEATQBLAFQATQBUAFcAVQBXAFQAVwBVAFYAWAA3AIMAsgBYAHAAWQBGAJYARwCWAIUAWgBVAFQAXABbAFoAXABzAFsASgBTAFEAZgBfAGAAZgBkAGMAZgBlAF8AaQBoAGcAZABpAGIAawBpAGQAewBhAGAAewBgAGUAewBlAGMAYwBiAGcAZwBtAGMAbQBnAGoAVgBuAMIAbwDCAG4AwgBXAFYATQBXAJMAgwBOAJQAcQCUAisAcgCBAG4AeABgAGEAbgCBAG8AXQBuAFYAUwBzAFwAcwByAF0AeAB5AHUAeAB1AHYAdgB0AHcAjQB0AIwAeABhAHkAawBmAJAAegB1AHkAegB2AHUAegB0AHYAegB5AGEAYQB7AHoAfQBjAG0AbQB+AH0AgAB7AH0AfwBtAGoAfgBtAH8AbwCBAIIAlABNAJMAhABwAIMAsgBwAIQAcgCGAIEAhgCIAIEAhgCKAIgAgQCZAIIAqgCHAHMAUwCqAHMA5wDiAOUAjACOAI0AkACOAI8AeACNAJAAjgCMAJEAkQCMAHQAkgB0AHoAkgCRAHQAfAB7AIAAbwCCAKQAbwCkAKkAOQBEALIAmACXAJoAmwCaAIsApACCAJcAlQA6AEUAMQA9AA4AagKQAEACoQCgAJ4AjgCiAI8AogCeAJwAkQCjAKIAkgB6AHwAVwDCAP4BlACTAP8BpgCnAJgAmAClAJcAmACnAKUAhwCJACoCXgBTADoAkACrAK4ArQC6AK4AQAKQAK4AJAAzAhQAoACvAKwAngCwAKEAwACvAKEAsADAAKEAowCxAKIAtACWAEYAtwCoAKcApgC3AKcAqAC1AKUAtgC4AMYAmwAqAqYAxwCqAFMAqgDHAAICUwC5AMcAugC8ALsArgCrAK0AtgCoALcArwDMAL8AwwCzAJQAyADJALwAEQJeADoAXgC5AFMABQK7AMkABQLJAMoAMQCCAj0AvQBrAG0CvgC4ALYAvwDIALwAvwDLAMgAyADLAMoAfgDNAIAAfwDNAH4A0ACRAJIA0QCSAHwA0QB8AM4AzgCAAM0AzQDSAM4A0wDRAM4A0gDTAM4A1ADRANMA1QDPANIB1gDSAM0A1gDPANUA7gDUANMA1wDWANgA7wDTANcA2wDaAPcA4gHbAPcA3QDaANsA3gDaAN0A2gDfAPQA3QDiAN4A4wDeAOIA5ADhAN0A5QD9AP4A3ADgAOMA4QDmAOUA5QDoAOcAowAAAbEA6gCSANEA6gDrANAA7ADqANQA7ADrAOoA7wDuANMA8QDuAO8A8ADxAO8A8QDsAO4A2ADZANcA2QDwANcA9QDyAPEA8wDyAPUA8wADAfIA9wD2ANkA9gDwANkA9gD0APAA4AD4AN8A+QD4AOAA3AD5AOAA+gAHAfkA5wD7AAgB/AAIAfoAAAECAf8AIwEhAR8B6QABAQAB7QABAekAAwECAQEBAwENAQIB8gADAe0ABAENAQMB8wAEAQMBBQEPAQQB+gAGAQcB+wAKARMB/gAKAfsA+wATAQkBDAELAQwCDQEMAf8ABAEPAQsBDwG2Ag4BBgG2Ag8BEAERAbcCEgG4ArcCBgEIAREBCAESAREBCgG5AhMBCQG4AhIBEwG5ArgCCAAWARcBGQEYARcBEwAIABgBGwETABoBGgEYARwBGgEeARsBHQEeARoBHQEcASABJAEdASABIwEfARkBHQEkAR4BIQEcAR8BIAEcASEBNAE2ATEBJgEgASEBIgEgAScBJwEpASIBKAEnASYBLAEpAScBKwEoAS0BLgErAS8BMwFdAR4BcgE0ATABXQFsAWkBOAE1AXIBNwE1AToBOgE1AT0BOQE4ATsBPAE5ATsBNwFAAT4BPQFAAToBKQFwASIBcgEwAS0BPQE8AUIBQwE9AUIBQgE8ATsBRAFDAUIBRQFRAUYBRwFEAUIBSQFHATsBRAFIAUUBVAFIAUcBQQE/AT4BRgFBAUABQwFFAUYBQwFEAUUBMgFOASkBRgFRAVABVAFKAVMBVgFRAVQBVgFXAVIBVgFZAVcBSwFYAVUBIgFwATMBKgElAV8DKQGCAXABTAEtASoBhAGCASkBTQFOATIBtgFLAVUBUAFeAU8BWQFgAVcBYAFiAVcBYQFgAVsBYAFhAWIBPwFNATIBZAFcAVoBZwFlAWYBaQFoASQAaABsAW0BaABrAWgBZwF3AWUBbQFsAWoBbwFuAWoBcAGCAXEBXgF7AU8BYgFzAVcBZQFhAVwBdgFhAWUBYwF1AWIBdgF3AXUBpwGsAaQBbQFqAGgAbwFtAW4BewFNAT8BeQF/AGoAegF5AW0BFwEWAQ0AZwFmAXwBkAFaAY8BfAFkAZABfQF4AWcBcAFxAYEBhAGDAYIBhQFNAXsBhgFeAVABUgGGAVABdwGHAXUBdwF4AYcBiAF0AWIBhwGIAXUBiQF9AX4BiQGKAYcBgQFxAYMBlwGMAYMBgwGMAYsBjQF/AHkBbwGLAXoBjgGNAXkB9QKPAZEBkwGSAYABnAGSAZMBlgGcAZMBkwGAAZUBmQGXAYQBmQGYAZcBhgGrAV4BXgGrAXsBiAGbAXQBdAGbAXMBfwGcAYoBnAGdAYoBnQGcAZYBngGXAZgBngGvAZcBjAGfAYsBjAGwAZ8BoAGOAZ8BjwFLASwDlgGTAaEBowGVAZQBpAGhAaIBogGVAaMBpQGkAaIBpwGkAaUBpQGiAaYBmQGoAZgBqQGoAZkBTgGpAZkBqwGqAYUBnQGsAYoBpAGsAZ0BrAG3AYgBjAGvAbABpgGiAaMBsgGnAaUBsQGmAaMBsgGlAbEBqQG0AagBTgG1AakBtQG0AakBmgHDAYYBhgGqAasBhgHDAaoBzgGaAfMCrQGoAbQBuAGtAccBuQGuAboBswGyAbwBowG7AbIBvAGyAbsBvQG/AcQBwQG0AbUBwQHCAbQBwAHBAU4BqgHNAYUBxAG/AZoBxAGzAb0BxQG0AcIBxgHFAcIBxwHFAc8BugG4AcgBFwENAF8DyQG9AbwBvgG7AcoBvQHJAb8BwAHaAsEB2gLMAcIB5AD9AOYAzgGqAcMBzwHCAdwC0QHHAc8B0QHPAdAB0wGgAZ8BoAHVANIB2ADVANYB1wHYAdYB3QDbAOUB6AHlAecB1AGwAa8B1wHTAdUB1QHUAdkB1QHbAdcB3QHcAdUB2gHdAdkB3AHfAdsB3wHhAdsB4QH3ANkA4wHiAeEB5AHgAeYB5QHiAeMB6QHoAecB8AH7AekB/gD9APIB0QHIAccB2gG5AboB6wG6AcgB2gHqAd4B7gHwAeYB7gHvAfABvgAJAgAC8gHpAfsB8wEKAf4A0QHQAfQB6wHIAfUB+AHvAfYBcAMUAf0B8QH4AfkB+gH7AfkB/gEjApMAwwCUAP8BJgK0AEYAuAAOAsYApgAJArcAAQIqAokAqgACAokAuQADAscAygAEAgUCuwAFAggCrgC7AAgCtgC3AAkCQAI/AkECBAIKAgYCCgIEAssACwIKAssAFwLDAP8BXAIFAA0CxADFAA4CAAIOArgACQIaAgACCQIPAhoCDwIJAqYAEAIBAokAAgIQAokAAwIdAscAEQITAl4ACAIHAhICQAKuAAgCPQCCAjwAIAISAgYCIAIGAgoCFQIgAgoCFgIhAhUCxAIhAhYCsgDDABcCGAKyACUCDgIZAsQAGgIbAhkCIwL+AcQAAgIdAhACEwK5AF4ACAIUAh4CCAIeAh8CIQIUAiACIQIeAhQCLwIeAiECFQIhAiACxAI0AiECDwIpAigCxAAcAicCIwLEACcCKgIpAg8CKgIoAikCKwIsAicCLAIkAiMCKwItAiwCLgItAisCMAIIAi8CMAIxAjICQAIIAjACFAAzAjEAMQIvAiECLwIxAjACNAIyAjECIQI0AjECIgI9AjQCQgJDAkECQwJEAlUCIwIkAjYCFwIjAjcCSgIXAkkCOQImAhgCEwKKAjgCPQI/Aj4CRwJLAkwCNAI9AjICPwJCAkECQQJDAlACQwJVAlICVQJFAlYCRgJYAkUCNwI2AkcCNwJHAkgCSAJJAjcCWQJJAkgChQJcAjkClQIFAFwCJADtAjMCSwI7AkwCTAJIAkcCVAJAAlECUQJSAlMCUgJjAlMCUgJVAmMCVgJjAlUCbwJYAm4CVgJYAm8CWAJXAm4CWAJGAlcCSQJZAlsCcAJJAlsCXQJZAkgCXQJgAloCXwJgAl4CEAKBAmICTgJ3AgMCPAClApQCZwJpAmgCagJAAlQCaQJrAmoCbQJqAmwCbAK9AG0CawJuAmwCZwJvAmkCbwJrAmkCWgJyAnACcgJxAnACcwJJAnACcwJwAnECcwJxAnQCcwJ0AnUCOQIlAoUClAIRApUAXwJyAmECfwIBAmICcgJ2AnQCdAJ5AnUCdgJ4AnQCeAJ5AnQCeAJ7AnkCSgJ6AnwCeQJ+AnwCSgJ8An0CfAJ+An0ClAKKAhECdgJ/AngCEAKAAoECfQKHAoMChAJ9An4CgwKHAoUChAKHAn0CiwKHAoQCjAKFAoYCiwKJAocCOAKKAk4CmAJcApACdwKKAosCigKJAosCjgKJAooCiAKMAo0CjAKRAo0CjwKRAokCjgKPAokCiAKNApECjwKTApECkAKRApICkAJcAogCkQKWApICpQKkApQClAKXApMClAKZApcCmAKVAlwCmgKdApwCmwKdApoCnQKeAqAClQKcAp0ClQKYApwCnwIFAJUCnQKgApUCngKoAqACowIFAJ8CmwKZApQCpAKmAp4CogKpAp8CowKfAqkCqAKqAqkCrwKuArACrAKwAq4CrAKxArACpgKqAqgCpQKrAqoCqwKsAq0CMQCnAoICpwKxAqsCswILAgwCtAKzAgwCtQK6ArMCCwEOAbQCtgK1Ag4BvQK1ArYCtwK+Ar0CwQK4AsICFQHAArkCuQLDAsICugIWAgsCugLEAhYCuwLEAroCtQK7AroCuwK8AiICvQK+ArsCwQLJAsgCwwLMAs0CygLCAs0CwALMAsMCyQLCAsoCwgLDAs0CIgLFAkICxgLHAjUCyALJAscCyQLSAscCyQLKAtMCywLQAswCygLNAtMCQgLFAkMCRALOAkUCzgLPAkUCRQLPAkYC0QKFA1cC0gJEAscC0gLTAs4C0wLUAs4C1ALVAs8CzwLVAtEC0QJXAkYChQMWA1cC1gLLAcoB4ALKAZAByQHZAr8ByQHWAtgC2ALKAdcC2gLjAswB4wLaAtsCqgHOAc0BvwHZAvMC3QLcAswB0AHcAt0C9AHQAd4CBwOPASwDjwHfApEB2QLYAuoCbAC9AGsBvQDiAmsB2wLkAuMC8wLlAs4B4wLkAuYC3gLdAuYC9AJyA+cC6gLYAuEC4ALqAuEC7ALqAusC6QLqAuwC6wLqAugCCQP/AgAD4gLtAmgBwAHwAtsC5QLyAs4B5gLkAu4C9ALnAuYC+wL0AvoCfQP7AvwC7ALrAvcC+ALuAu8C8QLAAU0B5QLsAvYC5QL2AvIC+AL0Au4C+gL0AvgC/AIEAwYD/QL1ApEB/QL3AvUC/gL2Av0C+QIPAwED+QIQAw8DMQO2AT4DLAO2ATED8gL2Av8CBgMVAwUDhAMXAxYDCQMAA5EBCgORAd8CCgMJA5EBCAMKA98CCQMKAwgDDgMlAw0DEAMOAw8DAgNyAUwBAwMSAycDHwMiAyMDDAMlAxQDFQMMAxQDBQMUAxcDFgMpA1cCLgMZAy0DGgMbAyEDJAMcAyEDbAIcA+ICbAIaAxwDbAIbAxoDbgIbA2wCHwMgAx4DIwMgAx8DKAMZAy4DJQMmAyADHgMgAyYDEAMkAyYDEAMmAw4DQAM7A0EDJwMoAzMDKQMbA24CIwMiAykDFAMlAyADLgMtAyoDHQMzAhwD8QIwA8ABEQMwA/ECOAMyAysDEQMyAzcDJwMzAxEDMwMuAysDMAM0AxADPwM0AzUDPwM1Az4DOAMrAywDOQMyAzgDNwMyAzkDNwM5AzADNQM4AzEDOQM0AzADNAM5AzUDNgM6AxADNgM7A0QDNgNEAzoDPQM7AzwDPQNEAzsDTAMvAwIDPQM8A0wDPwM+A0ADQAM+Ay8DQQM/A0ADPwNBAzYDQQM7AzYDWwNeA1wDPQNNA0QDXwMNAKMCQgMqAV8DOgNEA0MDSANWA0QDSgNHA0wDSgNMA0kDSwNKA0kDRgNJA0UDSwNJA0YDXANLA0YDSQNMAwIDRwNKA0gDSgNLA0gDSwNcA0gDTQNHA0QDXwOjAq8CUQNnA08DUANMAUIDUgNQA0IDVQNTA1IDVgNRA0QDWgNXA1gDUwNYA1kDUwNaA1gDUwNRA1oDUwNVA1EDWwNFA0wBXANGA1sDXQNbA0wBVwNeA10DWgNRA1YDVwNaA1YDXANeA1YDrwKjAq4CYQNCA18DYwNhA18DYgOvAmADTgOyAjEAZAOyAk4DsQJgA7ACsQJjA2ADZQNmA7ECZgNjA7ECsgJkA2UDZwNOA08DaANmA2cDYwNiA2ADZgNkA2cDawNoA2cDYQNqA2kDbANqA2EDaANrA2wDagNUA2kDagNtA1QDawNtA2oDcwNuA94CbgP2AfQBdwNvA3MD+gF3A3gD+gH5AW8D+gF4A3ADcANxAxQBcgN0A3MDeQN1A30DdgN4A3kDdwNzA3UDeQN3A3UDegNwA3YDcQN7A8ACfQN0A/QCgQN/A34DeQP8An4D/AJ5A30DewOCA4MDfgN6A3YDggN7A3wDBgOAA4EDBgMFA4AD/AIGA4ED0AKFA9ECgwOEA9ACFgOFA4QDMAAFAAIALQAmACUAJQA3AC4ATgAzADUATABaAFQAcgBzAIcAeABmAGAAjQB3AHQA5wDjAOIA5QDmAP0AowDpAAABAAEBAQIBIwElASEBNAE1ATYBXQFqAWwBaABsAGsBZwF4AXcBpwGzAawBzgHDAZoB5ADoAf0A6AHkAOUB8AHxAfsBvgC2AAkCQAI+Aj8CRwI8AksCJABoAe0CCQMLA/8CHwMhAyIDKAMTAxkDQAM8AzsDWwNdA14D", "g": [[0, 5400, "hat"]]}, "bunnyEar": {"s": 3.344323537818796e-05, "p": "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", "n": "hO3rkPXFjvM2gvgLhvvek/6/k/tBgwTpgggPhAEbiAnXgg/5hQwej8f7n8Q4s5v/ycGh0KC7y6VH6eKHh+IaitrjqNeuuuaZo8PDptZQ1NSRmetHs+Jg08Rn1t5z8c901+uKmee7p/KntvWZye1xrfRf4/p8yvaO4/KFqf5cwfhu1f53Dgp+vP+V1/qIpv+mkQU9rQigxgWP2f6HmQi2lgpFqwRe0AN2/wF/Uf9iqA6liRDXrAlfOP1yuwqWhxQighIBhBfzlxC7lg9ElhVCrQ5fzgh1Ifl6rhGhjBjShRzvhhsVmha4khk7qhVbhiH0iSAfkh/KpRqriSbpiScTlCA79oEACJ2x/pxOAb+TK5MxLI3hJ72cSpkAV6nhU6goCbppL7FYSr9QL9mR/dqHF9aKQKq7OMqb99x55+h6AuV8HcpvFdh3NM5p9u2DCueEIOKJ8/d+G994CvB+Ee2EIQZ6BhJ9Lg91+h57CRR98g99A/p/yyBv7veDBfSCRQBr+g5+5Bh58fyCKQl4HAZ8AgV/3wOFS/lmLP53Ff59zQmM3weG8gSCTvJjMvl1txKayBGP4AuG4gh7O/ZwM/V0SO5nKvp47wZ+NvVzuhyazxSNpiCtpx5WwRNt8AZ+NvBywSCW1RuLlyjFiivtjCseqSqtmiZBBgJ/vB1nCwN/GPx9izAFkDLhkjApmjjOuSZioypL1hl1Y7IQV7rDTs6pZcDWa7wILN1yP9VlY8U2ccb7Zs7HR9meU9RVaswvLOWMROKZ1xl2Juh3Lep1P+BqR+RmI+2IMu6N6Qh9sxth3wh6HPZ7CPiBHfOF7Ax90hV1vRNqzg90/QCBD/uC1Q13qRhZBgOB6gZ9zgl0F/l9//9/5AF88wuCDAiCD/F9/fp//RGCJvF4Netx5fp85hOFFuh79fB+xyiW6h2GDvl+6xZ7dc8DW9lQXNizb9DZWOKqbdfOd9nud9kVb9UrWt9UbN06ReqYbd7JXeZTd+Diet4NbeTFHfh7RetpcOM1JPiGPPKRVeqlyw5yHPl8QfVtVu9cG/6EOviPtQtmyQ1yGf58KQOIqBJaxAtvrgdhGAODxgNxwwtvAQd/LgV2GguE0Ph1sgJk4QZ72f95DBSDBh+FKhCJHBiH8fR+6gF98gV+HxB6eeXnZ+u4e+QNdOvRZ+lHdOgtU/Kha/G9fekEfe7wUfZiaO9HPPuQVPehd+8oava7fvEJe/ThaPhJVvldePcpQgCUcPzEfvjxffwXSQBoNgiOUgSfWv2nfADlJgZ5bQJBZQuzbgXAegUjSwpmWgFZSA6ZOhaRYBOvfgn2NgtyWg5Zcg42jzoFnDk0rDm0lUQH6yiJyTabszFZ0CdvyTVlBPd/6it1nU7vslLHqFcctmf+0U2nqUY9wVZF2URkKSKNByh4AhJ+32i/4jeS+UeXDjGMKzuYUEm9/0JtLCxv03YJ9mROCX8AIGO4MGBFTWUBTh6gcB/NbB48eCoEeRPfexcWJB12RxlmWSywXzw7bj3wNz9fWClS", "i": "AAAUAAMAAQAAAAQABAAAAAMABAAFAAEABgADAAIABwAEAAMACQAHAAMABwAJAAgABwAFAAQADQAYAA8ADwAYABEADgAPABIAFQAWABgAGgAWABcAFAAZABsAAAAhABUAIgAhAAEAJwAXACMABQAiAAEAIwAiAC8ALwAFADQAMQAvADQAOwAKAAsAigAyAD4ACwAMAD8AQAA7AAsAQQA7AEAAQgA6ADEASAA+ADoAQgA7AEkASgBJAEEASgBBAEsASQBMAEIATAA6AEIASAA6AEwATABJAFEAUQBKAE8ATwBLAFAAUgBIAEwATQBLAEQAUABLAE0AUQBPAFMAUwBPAFQAVgARAFcAEgBWAFgAVgBbAFoAZgBXAFwAWwBmAF0AHQASAFgAYABaAGEAYQBaAF8AZABZABoAZQBcAFkAZQBnAFwAbgAgACgAbwBkAG4AbwBlAGQAcABlAG8AggB9ADMAhgCCADMAigCLADIAhgCMAIIAjACGAIsAjADSAIIAkACRAIoAmQCaAJAAmQBSAJsAmQChAJoAowCiAFMApABUAFUAqwCjAKQAogCjAKwArACjAKsAqwCkAK0ArACuAKIApQCgAJkAsgBeALMAZwCzAGYAtgCyALUAtQCzALQAsgBiAF8AYgCyALkAYwC0AGcAugC5ALYAugC1ALsAuwC0ALwAzQDGAHQAxgDHAL8AggDMAH4AzADNAH4AzQDHAMYA0gDTAMwA/wDNANMA1gAGAdMAjACLAJEA3ACMAJEAjADWANIA1gCMANwA5ADcAJEAoQDkAJoA4ADcAOQA5wChAKAA4ADkAOgApQDnAKAA6wC+ALoA6wC7AO4A7gDtAPAA8ADtAO8A6wDuAPAA8QDrAPAA8gDrAPEA8wDrAPIA8wC+AOsA9wDwAO8A8QDwAPcA9QDzAPIAAQH2AAAB7wABAfsA+gD1APIAAAHHAP8ABgH/ANMABwEnAQAB3QAPAdYADwELAQYBGQEbARQBIQH6APkAIQH5APsAIQH7ACQBIwH+APoAAQEnASIBKAEkASIBJgEjASkBLQEuAQcBMAEoAS4BLwEpASoBKgEkASgBLwEqATEBMgExASoBNQEvATEBMAEuAT0BMgEoATABNwEwAT0BNgEtAQsBOQE4AT4BPAE2ATsBPAFCAT0BQgE8AUEBQgE+ATcBOQE+AUkBQwE5AUkBQAE5AUMBRgE7ARsBRgE8ATsBQQE8AUYBSAFBAUYBSQFCAXUBTQGrAK0A5wDoAKEArgBNAVABTwHnAKUAUgFRAecATwGuAFgBWAFZAU8BWgFYAV0BWQFkAVIBXQFQAU4BUQEaAegAYAEcARoBYwFcAVkBXAFlAWQBZAFmAVEBawFjAVsBXgFrAVsBYwFlAVwBbQFuAWMBbwFtAWwBbAFeAV8BRwEbARwBRwEcAWABcQFHAWABSAFGAXEBcQFyAUgBcwF2AXQBdgFJAXUBdgFMAUkBZwFgAWYBZwF5AXEBegF7AXABegFwAW8BegF0AXsBewF0AXIBfQFzAXoBcAFoAW4BAgADABQACQADAAYACgAFAAcACwAKAAcAGgAYABYAMAAIAAkADAAIADAADQAPAA4AEAARABgAVgAPABEAEgAPAFYAFQANABQADgAUAA0AFQAYAA0AIQAWABUAFwAWACEALgAtADMAIAAaABcAIAATABoAGQAUAA4AHQAOABIAJwAgABcAFAAAABUAAAABACEAGwACABQAFwAhACIAIwAXACIAJwAoACAABQAvACIALQAnACMAMgA6AD4ALgAoACcAIwAvAC0ALwAxAC0AMQAyAC0AMgAzAC0ACgA0AAUAOwA0AAoAEQBZAFcAQAALAD8AQgA0ADsAQgAxADQASACPAD4AQQBAAD8AQQBJADsASwBBAD8ASwA/AEQASgBRAEkATwBKAEsAUQBSAEwAUgCPAEgAVABPAFAAVQBUAFAAVACjAFMAWwBWAFcAWABWAFoAVwBmAFsAWQBcAFcAWgBbAF0AXQBmAF4AXwBaAF0AXgBfAF0AWgBgAFgAYgBhAF8AWQAQABoAEwBkABoAZABlAFkAXABnAGYAZQBjAGcAbgATACAAbgBkABMAcABjAGUAbgB0AG8ALgB9ACgAKAB9AG4AfQB+AG4AfgB0AG4AMwB9AC4AggB+AH0AMgCGADMAMgCLAIYAjwCKAD4AjwCQAIoAigCRAIsAUgCZAI8AjwCZAJAAkACaAJEAmQCgAKEAUwCiAFEAUQCbAFIAogCbAFEAogClAJsApQCZAJsArgClAKIAsgBfAF4AXgBmALMAtQCyALMAZwC0ALMAtgC5ALIAcAC/AGMAvwC8AGMAYwC8ALQAugC2ALUAtQC0ALsAugC+ALkAdABwAG8AdAC/AHAAvwDAALwAdADGAL8AfgDNAHQAvwDHAMAA0gDMAIIA0wDNAMwA0gDWANMA3ADdANYA4ADdANwAmgDkAJEAoQDoAOQA6wC6ALsAuwC8AO0AvADAAO0A7QDuALsA7QDAAO8AxwD2AMAAwAD2AO8A9gABAe8A+QDxAPcA+QD3APsA+QD6APEA+gDyAPEA9wDvAPsA+gD+APUAzQD/AMcAxwAAAfYA/wAHAQABAAEnAQEB/wALAQcB1gAPAQYBBgELAf8ACwEtAQcBDwEUAQsB4AAUAd0A3QAUAQ8BOwELARQB6AAaAeAAGQEUAeAA4AAaARkBGwE7ARQBMQE4ATkBAQEiAfsAIwH6ACEBIgEkAfsAJgH+ACMBKAEiAScBIQEpASMBJAEpASEBCAALAAcAJAEqASkBLwEmASkBBwEuAScBLgEoAScBKAEyASoBNgEuAS0BNgE9AS4BMgEwATcBNwE4ATIBOQE1ATEBCwE7ATYBNgE8AT0BPgE4ATcBOQFAATUBQgE3AT0BQgFJAT4BRwFGARsBQQF1AUIBSQFMAUMBTQGsAKsArgCsAE0BrgBPAaUATgFQAU0BTgFNAa0A5wBRAegAWAGuAFABXQFYAVABTwFSAecATwFZAVIBWgFZAVgBWwFZAVoBUgFkAVEBWQFcAWQBXQFeAVoBHAEZARoBHAEbARkBWwFjAVkBWgFeAVsBUQFmARoBZQFmAWQBZwFmAWUBZgFgARoBawFeAWwBbgFlAWMBawFtAWMBbAFtAWsBbgFnAWUBbgFoAWcBbQFwAW4BbwFwAW0BRwFxAUYBeQFyAXEBSAF1AUEBcgF1AUgBcgF0AXUBdAF2AXUBcwFMAXYBZwFxAWABZwFoAXkBaAFwAXsBegFvAXwBaAF7AXkBewFyAXkBdAF6AXMBGgAQABgALgAnAC0AMgAxADoAEQAQAFkAVACkAKMAMQEyATgBCAAMAAsACQAGADAAGQAdABwAHgAdAB8AJQAbABwAJAAcAB4AaQAkAB4AAgAbACUAKQAGACUAKgAlACQAKwAqACYAJgAsAHUAKwApACoAKQArADYAKQA2ADAANgArADcANwAmADgAOQAmAHUAQwAMADUANQAwADYAPAA1ADYAOAA5AD0AQwA1ADwAPAA3AEYANwA4AEYARgA9AEcARQBOAEQARQBGAJIAVQBQAE0ATgCcAFUAaQAeAGgAHwBrAGwAagBoAGwAYABhAGsAawBiAG0AaQBqAHEAcQBqAHMAagBsAHIALABxAHYAdwB1ACwALAB2AHcAdgBzAHoAegBzAHsAeAB6AHwAfwB1AHcAdwB4AHkAgQB5AHgAfwB3AIMAgwB5AIQAhQCEAIAAhwA9AH8AiAB/AIQARwA9AIcAjgCHAIgAjgCIAIQARgBHAJIAlACNAI4AjQCUAJUATgCSAJ0AkgCTAJYAkgCWAJ0AnQCWAJcAlwCWAJgAlgCVAJgAnQCXAJ4ApgCkAFUApgBVAJwAnQCeAKgAnACdAKgAqQCoAKcAqACpALEAsACmAJwAsACkAKYAbABtALcAYgC5AL0AtwC4AMQAegB7AMEAcwByAMIAwgDEAMMAuAC9AMQAxAC9AMUAwQB7AMgAgQB8AM8AfADIAMkAwwDIAMIAygDDAMsAzwCAAIEAzwDJANAA1ADOAM8A0ADJANUAhQDOANcA1wDOANQA2ADUANAA2gCJAIUAhQDXANoA2wDXANgA4QCUANkA2QDaAN8A3gDZAN8A3wDaANsAlQCUAOIA3wDbAOMAqgCpAOIA4gDhAOUArwCxAFQB6QCqAOIAsQDpAOoAwwDFAP0A9QD0AOwA0QDLAPwAywD9APwA+ADFAPQAyQDRAAIBAgH8AAMB/AD9AAMB0ADVAAwB0AAMAQgBDAECAQkBCQEDAQoBDQEMAQkBCAEMAQ4BEgEKAQQBEAHbANgA2AAIARABDgENAREBDgERARIBFwEOARIBEAEOARYB3wDjAOYA5gDjABUBHQHmABUBHgEVAR8BBQH4ACUBJgElAf4ABAEFASsBBQElASwBJQEmASwBLwEsASYBEgEEASsBKwEsATQBOgETARIBEwE6AT8BRQE0ATMBQAFFATMBPwEYARMBPwE6AUoBSwFEAUUBeAFKAUQBSwFAAUwBQAFDAUwBUwGwAK8AUwFUAVUB6gDpAFYBXQFOAVMBXQFVAV4BVQFXAV8BYgEdAR4BYgEgAXcBXwFXAWkBagFhAXcBaQFhAWoBdwEgAXgBfQFqAXgBHAAbABkAGQAOAB0AHgAcAB0AJQAcACQAJgAkAGkABgACACUAKgApACUAJgAqACQAKQAwAAYAMAA1AAwAJgA3ACsAOAAmADkANwA8ADYAPwAMAEMAPwBDAEQARQBDADwARQA8AEYAPQBGADgARQBEAEMATQBEAE4ATgBFAJIAVQBNAE4AYAAdAFgAYAAfAB0AaAAeAB8AawAfAGAAaAAfAGwAawBhAGIAbABrAG0AcQAmAGkAaQBoAGoAcwBqAHIAcQAsACYAeAB3AHYAdgBxAHMAeAB2AHoAeQCDAHcAgAB5AIEAgQB4AHwAfwA5AHUAhAB/AIMAgACEAHkAfwA9ADkAiACHAH8AiQCEAIUAjQBHAIcAjQCHAI4AiQCOAIQAjQCTAEcAkgBHAJMAlgCTAI0AlQCWAI0AnABOAJ0AlwCYAJ8AnwCYAJUAngCXAJ8AnwCVAOIApwDiAKkAnACoALAApwCoAJ4ApwCeAJ8AiQCUAI4AqgCxAKkAsACtAKQAsACoAK8ArwCoALEAuABtAGIAcgBsALcAtwBtALgAvQC4AGIAvgC9ALkAfAB6AMEAwgByALcAewBzAMIAyAB7AMIAwgC3AMQAwQDIAHwAyQDIAMoAygDIAMMAzgCFAIAAzgCAAM8AzwB8AMkA0QDKAMsAyQDKANEA1ADPANAA1wDUANgAvgDsAL0A2QCJANoA2gDXANsA4gCUAOEA3gDhANkA5QDhAN4A3gDfAOYAsQCqAOkA5QDpAOIAVgHpAOUA5QDeAOYAxQC9AOwAFwEWAQ4B9ADFAOwA9QDsAPMAwwDEAMUAywDDAP0A+AD0APUA/QDFAPgA/gD4APUAyQACAdUAAgHRAPwAAwH9AAQBBQEEAf0ABQH9APgA2ADQAAgBDAHVAAIBCQECAQMBCgEDAQQBDQEOAQwBDQEJAQoBDgEQAQgBCgERAQ0BEgERAQoBFwESARMB4wDbABAB5QAdAVYBEwEYARcBFQHjABABFgEVARABGAEVARYBHQEVAR4BHwEVARgBIAEeAR8BJQH4AP4ALAErAQUBMwE0ASwBLwEzASwBaQFvAWwBOgESASsBOgErATQBNQEzAS8BOgE0AUUBQAEzATUBPwEfARgBRAFKAToBOgFFAUQBSgEfAT8BIAEfAUoBeAEgAUoBSwF4AUQBSwFFAUABsABOAa0AsABTAU4BUwGvAFQBVAGxAOoAVwFUAeoAXQFTAVUBVQFUAVcBXgFVAV8B6gBWAR0BVwHqAGIBYgHqAB0BYQFXAWIBYQFiAXcBIAFiAR4BaQFXAWEBagF8AWkBbAFfAWkBagF6AXwBeAFqAXcBSwFzAXgBcwF9AXgBTAFzAUsBpwCfAOIAiQDZAJQAvgDzAOwAFwEYARYB5QDmAB0BaQF8AW8BagF9AXoB", "g": [[0, 1263, "fur"], [1263, 1017, "inner"]]}, "roundEar": {"s": 3.054078868337192e-06, "p": "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", "n": "gfsBiOzciAzYrKXkidbymt29lroAm8HTrcywws+cu/uVsumfmfu23rCj4ciSraQbtrO7wJTvzZ7C2YjzzuKP4OGJy7uj2fiH8Ibf/4H++c6L97KdC8OR6Jm5BZW77t2HAuiD4weF7vGD/v2BiOoiigkuu79Uj88fnN5HoLwxr9VYl/lHrPpfwfNt6vp9GAJ9yJMhw6dD3ZpC0bdd6a5eViJXPkRXOStpyd1tHQx73tBxFwx8GBN7SwhmJ/95KBZ2Lvt2X/NTQO5s6Icg+5A7B0Zq9Vhb+uF7GDRyHEhlFih3A0RrACZ5Dfd+Cw1+iynmmxm4mzPGsRKeuCyhjC8UmUr5qzy3plHbw0WouVjGumr6yAuPyyGS3hqI2DaU8CmJ3Uyhz2PC2Xjy9hGC9z6S7lOi6Wi77nriBH8EhRkQmRdHtxJnrSZY4RB6njI/nEQmtkFQwipnrlknU9dXOOhvRMJYIshtNOBv0D9kI9Zz6B55xV8913As31lU5kRoFN55/cpzLKpSCK9iCZNBD8py8yR5BBB+73kh+Upn/WRODHE4FIbkKYgAKLmeEa6hIJq7DNmIIs+QHOKIFfqDOau0M5TVRZX/TqLeVrLNIPKGOtaYR8KrOAKOWqgOabrwU+ClccYCYs3Cd97lMeqNR/OYXgSra+2/f/v6dQrQE4chBK5hFJ5OLJItJ6xXCNx57jdx7CN45y9z0UZfyxpw7g59+O194/F70wB3PpstPLpXJ8ttuDNb5w58pDFI8gt+7gR+uvFpqRNbn+9Q4f976gZ9Sqw8X782RM9fT99eZdA8ZupJd9kYefUmaAVISfhoBCCFEA2DCjaOFh6HGzOPBVajF06eBXHGGXrmH2e9Jw2IKCSNKkCbOx2TOzugM126N3HvWBWnYzXEbyrTczYATUu9UCynZEsXT2LsYU7lfBv25NFz66hZ1a5X+bdo69N1EEtlHWZGI0hjI3gYytpsrMtPzutzwblUFiR43NdzIRZ5MjdnMF9FP2oeQElSVBFeZSFGJwh5RyhhVTpLbDItUVgreBUl", "i": "AAABAAQAFAAJAAsABAAFAAcACwAIAAUABwAIABAACgAUAAsAAQAFAAQAAgAMAAEACgALAAwAAwASABEAFgASABAAFgANABIAFQAOABQAEAAJABYAFQAXACIAGwANAA4AGgAbAA4AEwASAB0AEgANAB0ADQAbAB0AHwAaAA4AIgAfABUAIAAfACIAAAAEACQAJQAAACQABgApACcAJwApACgABgADAA8AKQAGAA8AKgApACYAOAAqACYABAAnACQAKwAkACgAKAAtACwALQAoACoALQAqADgADwAxACYAOgAzADQAQwATABkAMgBDAEQANABEAKoARwA0AKoASAA6AEcAaQACAAAATwACAGkAUAAMAAIATwBQAAIAUgAKAAwAUwBSAFAATwBUAFUAUQBPAFUAUwBQAFEAUwBRAFYAVgBRAFcAWABTAFYAIQBbAF0AXQBcAF4AXgBfAF0AYQBYAFkAYQBZAFoAYQBgAFgAYgBhAFoAYwAhAF0AzwBjAF8AYABkAF4AZQBgAGYAZwDWAGYA1ABlAGYA1gDUAGYAaADWAGcAAAAlAGkAaQAlAGoAagBrAGwAawAtAC4AawAuAG0AbgBUAGoAbABuAGoAbABwAG4AcAByAG8AcgBVAG8AcAB7AHIAewB8AFoAfABiAFoAhACDAO0AhwBnAGIAaABnAIcAhwCJAIoAGQAYAIsAHACOABsAjgAeABsAiwCPAJUAkAAcABoAkgCQACAAkwAgACMAjQCUAI8AjACVAJYAlgCVAJcAlQCUAJcAlwCUAJgAlACbAJgAkgCaAJEAkwCcAJkAlgCXAJ0AngCXAJgAmwCfAKEAmAChAJ4AoACeAKIApACaAKMApACfAJoAoQCfAKYAnwCkAKYAogChAKYApgCnAKIAqACmAKUAqACnAKYARAAZAKkAGQCLAKkAqQCLAIwAqgBEAKsARACpAKsArQCrAKwAqgCtAK4ArACMAJYArACWALgArQC4AMUAuQCtAMUAuACWAJ0AsACuALoAsAC6ALwAvAC6AL4AxwC5AMYAoADGAJ4AyQDIAMYAywDJAMYAvwDHAMgAyADJAMoAzgDKAM0AygDLAMwAzQDKAMwAywCiAKcAzADLAKcAYwDQACMA0ACTACMA0QDPAF8AZADRAF8A0wDSANEA1QBkANQA1wDYANYA2ADVANQA2QCTANAA2gDZANIA0wDaANIA2wDTANUA3gDVANgA3wDeANgA3gDbANUA3gDdANsA4ACcANwA4ADcAOUA5QDcAN0A5ADoAOEA4QDlAOQA5wDoAOQApwCoAOkA6QCoAOIAiQDwAIoA8ADyAIoA8ADvAPEAiADvAIkA8gBoAIoA+wDyAPAA3wDXAPIA/ADfAPIA+wAEAfwA/wAFAQMB/QACAQQBAgHmAAQBAgEDAeYAAgEBAf8A4wADAekA5wDmAOgABAHmAOcAzQDMAAUBAgABAAAAAwAHABAABgAEAAcABwAFAAgABwADAAYACAALAAkAEAAIAAkAAQAMAAUABQAMAAsAEQAPAAMAEgADABAAEwARABIADgAWAAkAFAAOAAkADgANABYAFQAfAA4AFwAUAAoAFAAXABUAEwAYABkAGwAaABwAGAATAB0AGAAdAB4AGwAeAB0AIAAaAB8AIQAiABcAIQAjACIAIgAjACAAJgApAA8ABAAGACcAKAApACoAJAAnACgAJQAkACsALAArACgALQA4AC8AMwAmADEAMAAPABEADwAwADEAMAARABMAMQAwADIAMwAxADIAMwAyADQAOgA0AEcAOgA4ACYAOwA4ADoAOgAmADMARABDABkAQwAwABMAMgAwAEMAMgBEADQArgBHAKoA4ACoAKUAUgBbAAoAUgBcAFsAUgAMAFAATwBRAFAAUwBcAFIAVwBRAFUAWQBYAFYAWQBWAFcAWgBXAFUAWwAXAAoAXABdAFsAWwAhABcAUwBeAFwAWABeAFMAWgBZAFcAWABgAF4AYwAjACEAXQBfAGMAZABfAF4AZQDUAGQAYQBmAGAAZgBhAGIAZQBkAGAAYgBnAGYAagAlACsAagBUAGkAagArACwAawBqACwAawAsAC0AaQBUAE8AbgBvAFQAbwBVAFQAcABvAG4AcQBwAGwAawBxAGwAWgBVAHIAcABxAHgAcQBrAG0AeABxAG0AeABtAHoAeAB7AHAAcgB7AFoAeAB9AHsAfQB8AHsAfgB9AHgAfACHAGIAfQB+AIgAiACJAH0AfAB9AIkAeAB6AIUAfgB4AIUAfgCFAIgAhwB8AIkAHACNAI4AkQCNABwAHgCLABgAHgCPAIsAjwAeAI4AjACLAJUAjQCPAI4AIACQABoAkQAcAJAAkgCRAJAAIACTAJIAkwCZAJIAlQCPAJQAmwCUAI0AkQCaAI0AowCaAJIAmgCbAI0AmQCjAJIAnACjAJkAnACkAKMAngCdAJcAnwCbAJoAoQCYAJsAogCeAKEApQCmAKQAqwCpAKwArQCqAKsArACpAIwARQBHAK4AuACtAKwAugCtALkAugCuAK0AxwC6ALkAvgC6AMcAxQC4AJ0AnQDGAMUAxgC5AMUAxgCdAJ4AyADHAMYAywDGAKAAvwC+AMcAygDOAMgAogDLAKAAygDJAMsAzgDEAL8AzgC/AMgAzgDDAMQAAAHDAM4AzwDQAGMA0gDQAM8A0QDSAM8A1QDRAGQA0QDVANMA1ADWANgA1wDfANgAaADXANYA0gDZANAAkwDZAJwA3ACcANkA2wDaANMA2wDdANoA2gDcANkA3QDcANoA3gDkAN0A3gDfAOcA3gDnAOQAnAClAKQA4AClAJwA4QDiAOAA4wDoAOYA4gDjAOkA3QDkAOUA4QDgAOUA6ADiAOEA8ACJAO8A8ADxAPsAiACGAO8A7wD3APEAhwCKAGgA8gDXAGgA/ADnAN8A+gDxAPcA+gD3APkAAQH6APkA+wD8APIA8QD9APsA/QDxAPoA/QAEAfsApwAFAcwA/gD/AAEB/gDOAM0A/gDNAP8A/wDNAAUBAwEFAekAAQEAAf4A/gAAAc4AAQH9APoAAQECAf0AAgH/AAMB5gADAeMAAQH5AAAB4ADiAKgA4wDiAOgA/AAEAecApwDpAAUBQAAtAC8ALgAtAEAANQA2ADcAOwA2ADkAOQA2ADUAPAA6AEgAQAA9AEEAPQA1ADcAQgAuAEAAPQBAADUASgA3AEkARgBJAEUASwBJAEYANgA8AEgARQBJAEgAPwA3AEoAcwB0AHUAbQB5AHoAegB5AIQAfwA+AE0AggCBAHYAdgCAAIIAgQCCAIMAgwCEAIEAhQCEAIYArwBGAEUARQCuAK8ArwCuALAAswCxALIArwCyAEYATQC0ALUAtABMALEAwQC7AL0AvwDBAL0AxADBAL8AwwDBAMQAfwC1AIAAtQC2AOoAgwCCAOsA6wCCAIAA6wCAAOoA7QDrAOwA9wDtAO4AhgD3AO8A8wC3AMAAwADCAPQA+AD0APUAwgD1APQAwgDDAPUA7ADzAPYA9wDuAPgA9wD4APkA+QD4APUA+QD1AAABSwBKAEkAOwA5ADgAPAA7ADoAOwA8ADYAPQA3AD8APgA9AD8AOQAvADgALwA5ADUANQBAAC8ARQBIAEcANwA2AEkANgBIAEkAPgA/AE4ATgA/AEoATQA+AE4ATgBKAEwAdABBAD0AcwBBAHQAdAA9AD4AQQBCAEAAbQAuAEIAcwBCAEEAbQBCAHcAdwBCAHMAdQB3AHMAbQB3AHkAeQB3AHUAgQB5AHUAdgB0AH8AdQB0AHYAfwB0AD4AtQB/AE0AgQB1AHYAdgB/AIAAhAB5AIEAhQB6AIQAhgCEAO0AhgCIAIUAsQBLAEYATABLALEAsQBGALIArwCwALIATgBMALQAtABNAE4AtQC0ALYAtACxALMAtgC0ALcAswCyALsAsgCwALwAvAC7ALIAvgC7ALwAvgC9ALsAvwC9AL4AtwC0ALMAwAC3ALMAwACzAMEAswC7AMEAwgDAAMEAwwDCAMEA9gDuAOwA6gCAALUA6gC2APMA7ADrAOoA9wCGAO0A7QCDAOsA7QDsAO4A8wC2ALcA9AD2APMA9ADzAMAA7ADqAPMA+AD2APQAAAH1AMMASwBMAEoA9gD4AO4A", "g": [[0, 1176, "fur"], [1176, 384, "inner"]]}, "horn": {"s": 8.521854348129853e-06, "p": "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", "n": "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", "i": "AgADAAQACgEAAAEACgEBAAIABQAGAAoBCgEGAAcACgEHAAgADAALAA0ACwAKAQ0ADgAKARAADwAOABAAEQAQABIAEAAKARIAHAATABcAFgAUABUAFAAXABoAGgAXABsAAQAAABoAHwAcACEAHwAhAB0AIAAZABYAIQAcABgAIQAYABYAGQAhABYAGQAdACEAJAACAAEAJgAkABMAJAAmAAIAAwACACYAJwADACYABAADACcAKAAnACYALABbACsAKQAlAB4AKwAmACkALQAiADIAHQAtADMAMwAtADQANgA0ADIANwAzADQAMAAzADcAOAA5AD4AZwA5ADgAOgA9ACMAIwA2ADUAOwA/AD0APgA3ADQAOAA+AD8AOQAwADcAQAA4AD8ARABAAD8AQwA7ADwAQgA7AEMAQABEAEIAQABCAEYAQwBFAEgARgBCAEkASwBIAEoASwBJAEgASgBMAEsATgBNAEcAUQDEAE8AUABOAFEAVAAGAAUAVwAGAFQAVwAHAAYAGgFXAFQAWQAJAAQAJwBZAAQAWQAFAAkAWgBUAFkAWgBVAFQAUwBVAFoAVgBYAFMAWwBdACsAXABeAFsAXgBdAFsAUwBdACEBXwAhAV0ALgBcACwAYABcAC4AYABhAFwAYgBfAF4AYQBiAF4AYAAuADEAaQBoAGcAYwBkADEAaABkAGYAaQBqAGgAaABqAGQAagBlAGQAawBlAGoAQQBnADgAbQBnAEEAbgBvAG0AbwBwAGkAcABsAGkARgBxAEAAcQBGAHMAcwByAHEAcgB0AG4AdQB2AHIARgBJAEsASwB4AEYAcwB1AHIAfAB1AHMAfAB5AHUAegB4AHcAegBzAHgAfQB7AIMAfQB5AHwAgwB7AFAAhACAAH8AgAB+AH8AhQBPAIIAhQCBAE8AhQCCAIcAhACBAIkAiQCBAIUAiQCKAIQAigBHAYQAiwCNAIcAjgCPAI0AjwCKAIkAjgCNAIwAkACOAIwAkACMAJEAkACRAJIAkACTAI4ATAGPAJMAlACQAJUAFQCYAJYAmQAVAJYAFgAVAJcACgCWAJgAmQCWAAsAmgALAAwAmwCZAJoAmwCXAJkAmwCaAJwAmgAMAJwAnAAMAA0AnAANAA4AIAAWAJcApACdAJsAIgAgAJ0AnACfAJsApACbAJ8AoACfAKEAnAAQAKIAogAQABEAogARABIAnwCiAKEApgClAKcApACfAKAApACgAKgAMgAiAKMArAA1AK0ANQCsACMAMgCjAK0ArQCmAKcANQAyAK0ArACtAKcArACnAK4ArgCnAKkAtQCwAK8ArwCwALEAswCsAK4AswAjAKwAngCzALQAtACzALUAuQCeALQAswCuALUAtQCvALIAtgC0ALIAsgC4ALYAtwC2ANoAPACeALkAuQC0ALsARQA8ALkAvQC6ALwAuwC3ALwAwQC6AL0AwQC9AMIAvgDBAMIAvgDCAL8AvwDCAMMAwgDgAMMAxQC+AL8AxAC+AMUAxgC/AMMAxQDHAMgATwDFAFIAoQDQAMkAyQDQAMoAygDQAJQBoQDNANAAlAHQAM8AyQDKANIA1ACxANEAsgDUANUA1gDUANEA1ADWANUA1wDWANgA2wDVANkA0QCWAdgA2QDXANgAtgC4ANoA2wC4ANUAuADbANoA2gDbANwA3QDeANwA4gC3ANoAtwDiAN8A4QDjAOUA4wDiAOQA5ADiANwA5QDjAOQA5QDkAKABwwDhAOcA6QDnAOUA5wDpAOgA7QDHAMYAxgDwAO0A5wDwAMYA5wDoAPAA8ADxAO0A8QDqAO8A7wDqAOwAxwDtAPIAyADHAPIA7QDxAO4A7gDyAO0A8gDzAMgA9ADzAPIA9gD0APUA9wCGAPMA+QD3APgA9gD4APQA+gD5APYA+QD6AP4A9gD1ALQB+gD2ALQB/gD6APsAhwCGAIsA/ACLAPcAiwD8AAEB+QD+AP0A/QD+AP8A/gD7AAABAwH/AAAB/QACAQEBBAGRAAEBlQCSAAUBCwEMAQ0BCgENAQ4BDQGEAQ8BDgEPAREBEgEKARMBFgEKARUBFwHOABIBGAEVARkBGgEbAVcAWAAbARoBVwAcAQgAHAEHAQgAVgAeAVgAHQEbAR8BXwAiASEBJAElASABIwEkASIBIwElASQBYQAnAWIAIgFfAGIAKQEmASgBawArAWUALAErAS0BKwEqASgBLgEtAWwALgEvAS0BMQEwAS0BLwExAS0BMgExAS8BcgEsATABdgA1AXQANwE4ATYBOQEvATYBeQA6AXUAPAE3ATsBOgF+AD4BPwFBAT4BQgFBAT8BPAE7AUABPAFAAUMBPwF+AIAARwE/AYAARwFJAT8BSAFHAYoASQFHAUgBSgFCAUkBRAFBAUIBSgFLAUIBwQFFAUQBSwHBAUQBSAGKAEwBSgFJAUgBTwFIAU0BTwFNAU4BTwFTAUoBUgFTAVEBUwFSAUsBTgFNAVQBVQGTAJQAVwGUAJUAVwFVAZQAVwFWAVUBWAEJAQgBWAELAQoBWwFaAVkBWgGDAVkBIAFbAR0BXAEgASUBIwFcASUBXgFcASMBXgFdAVwBWQEdAVsBXwFdAV4BYAFiAVoBYgGOAVoBXgEjAWQBZQFkASMBXwFeAWgBagFgAV8BawFgAWoBawFpAWABagFfAWgBYwFiAWABaQFjAWABawFqAd8BZgEpASoBLAFtASoBcgFtASwBcgF1AW0BdQFuAW0BbAFoAWcBbwFxAW4BbAHfAWoBbgFsAWcBcAFsAW4BcgEwATIBNAF0AXMBdQFyAXMBcwF0AXUBdQFvAW4BdgFxAW8BdwF0ATQBdwE0AXkBewF5ATkBfQF6AXwBOAF7ATkBfgF7ATgBPQF7AX4BfAF5AXsBfwF8AXsBgAF9AXwBgAF8AX8BfwE9AYEBRgF/AYEBgAF/AUYBgwGCAVkBggEMAQsBggENAQwBggGEAQ0BhQGEAYIBhQEPAYQBgwGGAYUBhwGKAQ8BigGMAYgBjQGMAYYBiwGNAYYBjwGOAWMBjwGLAYYBcAHfAWwBkAGUAZIBkQHLAJABEgHPABcBlAHPAJUBzwATAZUBzwASARMBlQETARQBkwEUARYBlgHTAJEBlgGRAZcBlwGRAZABngGXAZgBlwHMAZgBmQHdANkAnQHYAJ4B2ACWAZ4B2QCdAZkBnQGeAZgBmgGdAdQB3gDdAKEBnwHdAJkBogGhAZ8BpAGhAaIBogGfAaMBpgGgAaEBpwHmAKYBpwGlAakBqwGqAa4BqwHnAaoBqgHnAegB7ACtAawBrQHrAKgBrwHvALABqgGsAa4BsQGyAbMBqgHoAbIBsgHoAbMBsAHsAKwB9QCvAbQBtAGvAbUBtgG0AbUBtQGvAbEBuAG6AbkBuQHtAcABugG4AbMBtgH6ALQBtgG3AbwBvAG5Ab4BvgHAAb0BuAG5AbwBwAG+AbkBwQHAAUYBwgEAAfsAuwHCAfsAwgG7Ab4BwgHEAcMBUgHEAb8BvwHBAVIBAwEAAcUBxgHFAcMBxgFRAVYBxgHEAccBUQHGAccBxAFSAccBBAHFAQYBBQEGAcgByAFWAVcByAHJAVYByAEGAckBxgFWAckBGQEOAcoBkwEWARUBywGTARUBywEYAc0BzQHOAcwBzQEYAc4BzgEYARkBGQHKAc4BzAHOAfUB1AHSAdMB9QHOAe8B0gHRAdMB1AGYAcwB1gHZAdoB0AHPAdkB2gHZAWkBzwFjAWkBmwHbAZwBmwHTAdsB0wGbAZoB1QGcAdYB0wHRAdsB0QHQAdsB3wHXAWsB4gHhAeABcQHiAd8B3AGcAdUBpAHcAeMB3AHYAd0B5QF2AXgB5wHkAeUB5QFxAXYB5AHiAeUBqQGlAeMB5gHjAd4B6gF6AX0BqwHkAecB5wHlAekBgAHsAX0BugHrAewBugHsAe0B7AGAAe0BygEOAe4B7wHuAfEB7gEOAREB8AHxAe4BjQHwAYwB8gHvAfEB9AFjAc8BjwH0AY0B8wH1Ae8B0QH0AdAB9AHRAfMBCgECAAQACgEEAAkACgEJAAUACwAKAAAACwAAAAoBDgANAAoBzgASAAoBAAAUABoAAAAVABQAFAAYABcAFgAYABQAGAAcABcAAQAaABsAGwAXABMAEwAkABsAHAAlABMAHAAeACUAHwAeABwAIAAiABkAIgAtABkAJQAmABMAJAABABsAKgAeAB8AKQAmACUAKgApAB4AKQAsACsAKgAsACkAKwAoACYAGQAtAB0AHwAvACoAHQAvAB8AKgAuACwAMQAuACoALwAxACoAMAAvADMAMgA0AC0ANQA2ADIAMwAvAB0AOgA7AD0AIwA9ADYAPQA+ADYAPQA/AD4ANgA+ADQAOQA3AD4AQABBADgAPAA7ADoARAA/ADsAQgBEADsAQwBIAEIASABJAEIAxABOAEcAdwBOAHsATQB3AEwA3ACgAeQAxABRAE4AUAB7AE4AWQBUAAUAVQAaAVQAVwAIAAcAJwBaAFkAKABaACcAUwBaACgAUwBYAFUAVQBYABoBKwBdACgALABcAFsAXQBTACgAXgBfAF0AIQFWAFMAXABhAF4AYwAxAC8AMABjAC8AZABgADEAZABhAGAAZABlAGEAZgBjADAAOQBmADAAaABmADkAZwBoADkAZgBkAGMAbABqAGkAbABrAGoAbgBtAEEAZwBtAGkAbwBpAG0AcQBBAEAAcQByAEEAQQByAG4AbgB0AG8AcgB2AHQAdwBLAEwAdwB4AEsAeABzAEYAewB6AHcAewB8AHoAfQB8AHsAfABzAHoAfgB5AH0AgQBQAFEAgQBRAE8AUgCCAE8AUACEAIMAgwB/AH0AhAB/AIMAfwB+AH0AhwCCAIYAgQCEAFAAiACFAIcAiACJAIUAhABHAYAAhwCNAIgAiwCMAI0AjQCJAIgAjQCPAIkAjgCTAI8AkACUAJMAkwBUAUwBlQCQAJIAFQAAAJgAlwAVAJkAmAAAAAoACwCWAAoAmgCZAAsAmwCdAJcADgAPAJwAIACXAJ0AswA6ACMAngA8ALMAnwCcAKIADwAQAJwAzQCiABIAzQChAKIAowAiAJ0ApACjAJ0ApgCjAKQApQCmAKQApQCkAKgApwClAKgAqQCnAKgAqACgAKoAqQCoAKsAoQDJAKAAqgCgAMkAqwCoAKoAsQCpAKsArQCjAKYAtQCuALAAsACuAKkAsACpALEA1ACyAK8A1ACvALEAswA8ADoAuwC0ALYAtQCyALQAtgC3ALsAuwC6ALkARQC5ALoAPABFAEMAugC7ALwA3wC8ALcAwABIAEUAvgBHAMEARQC6AMAAwQDAALoAwQBIAMAASgBIAMEAwQBHAEoAwgC9AOAAxABHAL4AxgDFAL8AxgDHAMUAxQBPAMQAyABSAMUAywDKAJQBzAASAM4AzQASAMwAzQDMAM4AzwDNAM4AzwDQAM0AzwDOABcBqwCqAMkAsQCrANIA0gCrAMkA0QCxANIAywDSAMoA0wDSAMsA0QDSANMAlgHRANMA1QDWANcA2ADWANEA2QDVANcAuACyANUA3ADbAN0A3QDbANkAvQC8AN8A4AC9AN8A4ADfAOMA4wDfAOIA4QDgAOMA2gDcAOIAGwEeAR8B5gDlAKABxgDDAOcA4QDDAOAA5wDhAOUA5gDpAOUA6gDwAOgA6wDoAOkA6gDoAOsA6gDxAPAA8gDuAPQA9QDuAPEA9ADuAPUAyACCAFIAggDIAPMAhgCCAPMA9wDzAPQA+AD3APQA9gD5APgA9wCLAIYA+QD8APcA+QD9APwA/QABAfwAAwH9AP8A/wD+AAABAQGMAIsAkQCMAAEBAgH9AAMBBAEBAQIBkgCRAAQBBAECAQMBBAEFAZIABQEEAQYBBwEKAQgACgEHAQgBCgEIAQkBCgELAQ0BDgENAQ8BEQEPARABFAETAQoBFgEUAQoBEgHOAAoBGQEKAQ4BGQEVAQoBGwEcAVcAHQEcARsBbQFnAWYBIQEeAVYAIQEkAR4BJAEfAR4BJAEhASIBHwEkASABIAEdAR8BJgEiAWIAYgAnASYBYQAoAScBKAEmAScBKQEiASYBIwEiASkBZQArAWEAKwEoAWEAawAtASsBLAEqASsBKgEpASgBbAAtAWsAcAAuAWwAMAEsAS0BMgEwATEBLwEzATIBMwE0ATIBbwA1AXAAbwB0ADUBcAA1AS4BdgA3ATUBNgEvAS4BNQE2AS4BNwE2ATUBLwE5ATMBOAE5ATYBOgF2AHUAOwF2ADoBOwE3AXYAfgE4ATcBPAF+ATcBfgA6AXkAQAE7AToBPQF+ATwBfgA/AT4BPgFAAToBPgFBAUABQQFDAUABRAFDAUEBRAFFAUMBRQGBAUMBRQFGAYEBPAFDAT0BPwFJAUIBQgFLAUQBTAGKAI8ATQFIAUwBSAFPAUoBTgFQAU8BTwFQAVMBUAFRAVMBSwFSAcEBSgFTAUsBVQFUAZMAVAFNAUwBVQFOAVQBVQFQAU4BVQFRAVABVgFRAVUBHAEIAQcBHAFYAQgBHQFYARwBHQFZAVgBWAEKAQkBggELAVgBggFYAVkBXAFbASABXQFbAVwBXQFaAVsBXwFhAV0BXQFhAVoBYQFgAVoBYgFjAY4BKQFlASMBZgFlASkBTABHAE0AZgFkAWUBaAFeAWQBZwFoAWQBXwFgAWEBbAFqAWgBKgFtAWYBZwFkAWYBAAHDAcUBbgFxAXABMgFzAXIBNAFzATIBdQF0AW8BdAF2AW8BOQF5ATMBdwF4AXQBeQE0ATMBeQF6AXcBegF4AXcBfAF6AXkBeAF2AXQBPQF/AXsBgQE9AUMBgwGFAYIBhQGHAQ8BhgGHAYUBjgGGAYMBDwGIARABiAGJARABiQERARABDwGKAYgBjAGJAYgBhwGMAYoBhgGMAYcBWgGOAYMBjwGGAY4BjwGNAYsBcQHfAXABywCUAZABkAGSAc0BywGSAZMBzQGSAcsBkgGUAZUBkgGVAZMBkwGVARQBkQHTAMsAngGWAZcBlwGQAc0BmwGfAZkBmwGZAZoBowGbAZwBnQHZANgAmgGZAZ0BnQGYAdQBoQHdAJ8BoAHeAKEBpAGmAaEBowGfAZsB5gCgAaYBpQGmAaQBpwGmAaUBqAGnAakBpwHpAOYApwHrAOkA7ADqAOsArQHsAOsArgGsAa0BqAHrAKcBqQGtAagBrgGtAakBrgHmAasBrwHxAO8AsQGvAbABsgGsAaoBsAGsAbIBsQGwAbIBtwGxAbMBsAHvAOwArwH1APEAtgG1AbcBtwG1AbEBuAG8AbcBuAG3AbMBuQG6Ae0BRgHAAe0B+wD6ALYBuwG2AbwBuwH7ALYBuwG8Ab4BvQHAAb8BvwHAAcEBwQFGAUUBwgG+Ab0BvwHEAb0BxAHCAb0BBAEDAcUBlQDIAVcBxgHJAcUBxAHGAcMBUQHHAVIB5wHqAegByQEGAcUBGAHLARUB9QHUAcwB0gHUAfUBlwHNAcwB1QHWAdoB1gHQAdkB1wHYAdoB2AHVAdoBaQHZAc8BawHaAWkBawHXAdoB2wHWAZwB0wGaAdQB0AHWAdsB3AHVAdgB4AHdAdcB3QHYAdcB4AHeAd0B3wHgAdcB4QHeAeAB3wHiAeAB3AGiAaMBpAGiAdwB3AGjAZwBpQGkAeMB4wHcAd0B3gHjAd0B5AHhAeIB5AHeAeEB4gFxAeUBqQHmAa4B5gGpAeMB5gHkAasB5gHeAeQB9AHyAY0BegHpAXgB6gHpAXoB6QHlAXgB6wGzAegBfQHsAeoB6wHoAeoB6wHqAewBugGzAesBRgHtAYAB7wHKAe4BEQHwAe4B8AERAYkB8AHyAfEBjQHyAfABjAHwAYkB7wHOAcoB0AH0Ac8BjwFjAfQB8wHSAfUB0QHSAfMB8gHzAe8BdwBNAE4A3ADeAKABGwFYAB4BbQFuAWcBTABKAEcAAAHCAcMBlQAFAcgB5wHpAeoB9AHzAfIB", "g": [[0, 3000, "horn"]]}, "spike": {"s": 3.896398758522253e-06, "p": "RPl06er81QDx5qgFjwK/6Pzx8vIj81LxEvAiA1DhW/mX8i3i0fqt68bsTwCU/CTUHwB88vneze1+/L/7mey4BYkSKvNL8WEJGvSW96AbOftu68ISxf2x8RAg6PqC/3ss4+TjLzniHOcdIRn90eYgNhv4P99fMw7nsfAXX2PfedlwORH0mthlPLv5NtlHP87/gNuDNrftEPLmaJjia+R3PvEA0e84ZxbriPQIIeTKw/2MGQPGwe7fGFDX0/czBmbRD+qRDFj1pOnUGuforfFCNpvOb/hfMS7G0f+OLsLDj+v2LQLbS+l9LDjkHfrFTxPNmvDqVJPc3/GAR2PTW/otYFLY5wIFYTLXsO6UYSL5Wf//f8rZMf+8eY/jwP/Vf2PY8/RUbHgGRvgMbuzwx/yMcvL4KwNQcazvGNvXQpMFW+VXSVgTdN8bR7ENYujVFvUL3uurGE8gHfIjCDAnWvMGFOovF/ufDD804f+yGMI59OviMUAlGvasJZE3OehKQUkONu+1QNkp1vcMSy4z1fanOYg3K/+DPY06oOsTT80XRPC3XnIUj/LgV3ojk/kFWsQrWwG1XWMrrf9VTgI1BfcOZxkbT/yubUgWgv//cogIgf13ZiAiXAYC9SPftgqH7XP5KAuG8Trt4BMeBIjySASN60cT7gqS7kMI5w2X+U0Y2xEM/e4MfQTVAKEt5gZC9KYf6AyJBYwnRAJFDLvKfwmVBxHS6w3GAfrd/xN7EorinA/8G4PS0xhIHqD6IQfsHzzHUAfFMUfGFA8AMdfPGBWPLGjcAxpmML/geBcIL0boiv/URBTHLwPhTq3LxAlpSBzNGBOARm/d+AvDWUXa8QMSe9zcPAZicVX+dgoDbcYIcg7gZuHz7iCWMzTnFxmBN0X7eRt1PcH++BrxM6zrdCc+PE35uCZvP9D/VCaxOBjyLAw+Zz3e+RRRXinsNSK5RwgGyxbxDyMKogHMC/40SBQrF/weigsgF/AyShihLYMQPxNTJr4mnP/PK0k8MgdCJY85eQ0cNNwyBxh7QTsLrRazRHwTeQ1jTIorGhQsPDgi0gUdP9k4QgaWTWIzlRTeSzwZshQAWA4GpA1FYMYa0gMBa/0aywYiX2wnyh3QSG0QECPxQ44I", "n": "u5b6DIIMHIjhlb/qkNbWuavCypXWA6+eA5q0iNb8h94Vl7sOnMAuzJMp6JxLzbhbncDRgfn+h90Pm8HTnB23ksAHjs4ZhvAglMDxkS/Xw583l0cFovCs6eKHjezNtMuphOf1hPHplgy7uwiWA/+Bj/bGjczyxjScoR2xlhm/ziGQHyaLmEgQ5nwIAWxCBGCtoVMMsmMS23n1I3YflOI7u+BmnuxOgvEMh/Ekldc4m+ZIydBoAOF7iAIqq/dei+ImjxM3sihcrQ5f8xl8jyMtjjIZly42v0FXC09j+jZzqU4y2G8w+n0X5l9QRq2+YK74YrbfedzyMZMsYa8ObMgkd9UOLrlfRKtBZ9Q7FcyOVs+wbNHQeergbe7BfvX6QvGURgaWawS8dPPPXsbBb8IE/CGGITmUViCoYxOyViOqY1ABP279W1YUZkwKaL/feuAQPJ42PJwzccsWbtQubsH/YSG0bzvvbD8WfeoLGctxee0iXOVTfv8Qd/ss+v9/RPZrZwhJaMYsceMzaSE/eAsoPRlsQS9jch4waUMbaTspL2c6R0lMZQRNZNlD", "i": "AQAAAAIABQAfAAcABgAFAAgACQADAAsAAwAGAAAAAwAFAAYACQALAAoACwANAAwACwAAAA0ADQAAAAEADwAMAA4AFQAYABAAFAATABgAGAAVABkAFQAQABoAEAAmABIAEAASABoAFgAXADQANAAbABYAFAAYABkAHwAcAB0AWQAfAB0AHgAEACEAHgAfAAQABAAfAAUAWQAHAB8AEQAgADcAIAAEAAkAEAAlACYAJgAeACEAHAAeACIAIQAgABEAEQAmACEAIwAcACIAZQAkACMAJQAQACgAKAAQABMAIgAlACkAKQAlACgAKgArACcAGQAbAC0AFAAvACgALQAvABkAGwAsADEAMAAyADEAMQAzAC4ANAAXABoANgAaADUAGgA/ADUAIAAJADcAOAA5ADoADwA7ADoAPQA6AD4APgA6ADsAPgA7ADwAPwA9AEQAQgA9AD4ASQBBAEMANQBEADYARgBEAEAAQQBAAEIARwBGAEEARwBJAEgAMAAsAEUAMABFAEoASgBLADAAMABMADIASgBHAE0ABgAIAAIACAAHAE4ABwBaAE4AAgBQAE8AAgBOAFAAVQBPAFEADQABAFIAUwBSAAEAVwBSAFMAVABXAFMAVABTAFUADgANAFIAVgAPAA4AWABXAFQAXwBaAFkAWQBaAAcAXABbAF0AUQBbAFwAXgBRAFwAYAAdACQAXQBaAF8AXQBfAGAAYgBeAFwAZwBgAGUAZwBlAGYAYwBiAGgAJwBmAGUAaQBuAGgAagB2AHUAbQB3AHYAiAB3AG0ALwBqAHUAawAzADIATABrADIAMwBrAG0AagAtAC4AZABjAG4AXgBkAG8AbwBkAHEAdQB0AG4AcQBuAHQAcgBwAHQAdQByAHQAdgBzAHIAeABVAFEADwBWAHkAewBWAFgAWABUAHoAegBVAHgAeQBWAHsAfQB7AHoAegB4AHwAfAB9AHoAfgA8AH8AgAB/AHsAggCEAHwAgAB9AIQAhwCEAIIAfQB8AIQASQBDAIUASQCFAIYAhQB/AIAAhQCAAIMAiQBsAIoAbACJAIgATQBIAIoAigBLAE0AbwB8AF4AgQB8AG8AcACBAG8AgQBwAI0AjACBAI0AjQBwAHMAjQBzAHcAAwAEAAUABwAIAAUABAADAAkAAgAAAAYACgALAAwACwADAAAADAANAA4AKAATABQAFgAZABUAEAAYABMAFgAVABoAFgAbABkAHgAcAB8AIAAhAAQAHQAcACMAIwAkAB0AJgAlAB4AJQAiAB4AEQASACYAJwAjACIAJwBlACMAKQAnACIAKAAnACkAKAAqACcALwAUABkALwAqACgAKgAvACsAMAAxACwAMQAtABsAMQAuAC0AMQAyADMAZgBpAGcAFwAWABoANgA0ABoAPwAaABIANgAbADQANwAKADgANwAJAAoAOQAKAAwAOAAKADkAOQAMAA8AOgA5AA8APAA7AHkAPwA3AD0AOAA9ADcAPQA4ADoAQgA+AH4AfgA+ADwARAA9AEAAQAA9AEIAQQBCAEMAQwBCAH4ALAAbADYARAAsADYARQAsAEQARAA1AD8ARgBFAEQAQQBGAEAARwBKAEYARwBIAE0ARwBBAEkAMABLAEwARgBKAEUATQBLAEoAAgAIAE4AWwBQAE4AWwBOAFoAUQBPAFAAUQBQAFsAAQACAE8AUwABAE8ATwBVAFMAVwAOAFIAVgAOAFcAWABWAFcAXQBbAFoAXgB4AFEAHQBfAFkAYABfAB0AYQBdAGAAYgBdAGEAYgBcAF0AYwBkAGIAYgBkAF4AZQBgACQAZwBhAGAAZwBoAGEAaABiAGEAKwBmACcAagAzAG0AKwB1AGkAZwBpAGgAdQBuAGkALwB1ACsAhQB+AH8AbACIAG0AagBtAHYAawBsAG0ALQBqAC8AaABuAGMAcQBwAG8AcQBkAG4AcABxAHQAcwBwAHIAdQB2AHIAdwBzAHYAVQB6AFQAegB7AFgAOwAPAHkAPAB5AHsAfQCAAHsAfwA8AHsAgQCCAHwAgwCAAIQAhQCDAIYAiwBIAIYAhgCDAIsAiwCDAIkAgwCEAIcAiQCDAIcAEQA/ABIAiACJAIcAhgBIAEkAigBMAEsAbABrAEwATACKAGwAiwCKAEgAiQCKAIsAfAB4AF4AjACCAIEAhwCMAIgAjACHAIIAiACMAHcAjACNAHcAZgArAGkAagAuADMAhQBDAH4AEQA3AD8A", "g": [[0, 840, "spike"]]}, "cape": {"s": 1.5564439541711383e-05, "p": "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", "n": "AMOQAGm4Lb2eDGi4KLSiF2e5F7iaIWe+MsKdKmnFW8HCM2jNYLfYPGfUVLTHQ2feW77FRWjpb8PzR2n1SMZXPVdFuMZXw1dFkcPzuWn1pb7Fu2jprLTHvWfeoLfYxGfUpcHCzWjNzsKd1mnF6bia32e+2LSi6We5072e9Gi4AByEAByEAByEAByEAByEAByEAByEAByEGRqGHxqHIxqJJxqKKhmLLRmMMBmNMxmOKBeKKheKKxeLLBeLLReMLheMLxeMMBeNNBmPMBiNLBiLKBiKJRiJIhiIIBiHHRiHRhuZQxuYQRuWPxuVPRuUOxuTOhuSORuSWxusXhuuYBuxYRuzYxu1ZBu3Zhu5Zxu6Zxi6ahi+bBjBbRjEbxjHcBjJcRjLchfNbhjFbRfDbBfBaxfAahe+aRe9aRe8aBe7dBrUchrPcRrLbxrIbRrFbBrCahq/aRq9exzuexzuexzvexzwexzwexzxexzxexzyWxNXVxJaVBJeURFgThBjTBBlSQ9mRw9opRNXqRJarBJerxFgshBjtBBltw9muQ9ohRzuhRzuhRzvhRzwhRzwhRzxhRzxhRzyjBrUjhrPjxrLkRrIkxrFlBrClhq/lxq9khjFkxfDlBfBlRfAlhe+lxe9lxe8mBe7mRi6lhi+lBjBkxjEkRjHkBjJjxjLjhfNpRusohuuoBuxnxuznRu1nBu3mhu5mRu6uhuZvRuYvxuWwRuVwxuUxRuTxhuSxxuSzBmP0BiN1BiL2BiK2xiJ3hiI4BiH4xiH2BeK1heK1ReL1BeL0xeM0heM0ReM0BeN5xqG4RqH3RqJ2RqK1hmL0xmM0BmNzRmOAIw0AEdq5ZM870hn4ptH4Epi8JhH0Uld544yw0dW0I8gtUdKvJkdrEk9wJsrpEovy5IinUghzIwGmEcQuqg7rjlORqg7UjlONIwGaEcQNZIiY0ghQJsrXEovRJkdVEk9MI8gS0dKGY4yPUdWEJhHL0ldHptHIEpiG5M8EUhnAOR8AOR8AOR8AOR8AOR8AOR8AOR8AOR85uZ64eZ43eZ32eZ21ed10ud0z+dzzedy2Ol21ul21el11Ol10+l00ul00el00OlzzOdx0ehz1eh12Oh22+h33uh44eh54+h5uuVnveVov+VqwuVrw+VsxeVtx+VuyOVvpeVUouVRoOVPnuVNneVLm+VJmuVHmeVGmehGluhClOg+kug8keg5kOg2j+g0jukykug7k+k9lOk/lelBlulCl+lDl+lEmOlFjOYsjuYxkOY1keY5k+Y8leY/luZBl+dDheQSheQRheQRheQQheQPheQPheQPheQOq+5dp+1ZpOxVoexSn+tPnetNm+tKmupIVe5dWe1ZXOxVX+xSYetPY+tNZetKZupIe+QSe+QRe+QRe+QQe+QPe+QPe+QPe+QOdOYscuYxcOY1b+Y5beY8a+Y/auZBaedDbug7bek9bOk/a+lBaulCaelDaelEaOlFZ+hGauhCbOg+bug8b+g5cOg2ceg0cukyW+VUXuVRYOVPYuVNY+VLZeVJZuVHZ+VGRuVnQ+VoQeVqPuVrPeVsO+VtOeVuOOVvNOdxL+hzK+h1KOh2Jeh3Iuh4H+h5Heh5KOl2Kul2K+l1LOl1Lel0Lul0L+l0MOlzGuZ6H+Z4I+Z3J+Z2K+d1Lud0MedzM+dy", "i": "AQAyADEAAwA6ADIAOgAHAEIAQgAJAEoACQBSAEoACwBaAFIADQBiAFoAYgARAGoAagATAHIAEwB6AHIAggAZAIoAGQCSAIoAGwCaAJIAmgAfAKIAogAhAKoAqgAjALIAIwC6ALIAJQDCALoAwgApAMoAygABADEAKAAqAAAA0QArACoA0AAsACsAzwAtACwAzgAuAC0AzQAvAC4AzAAwAC8AywAxADAAJgDRACgAyQDQANEAyADPANAAxwDOAM8AxgDNAM4AxQDMAM0AxADLAMwAwwDKAMsAwQAmACQAwADJAMEAvwDIAMAAvgDHAL8AvQDGAL4AvADFAL0AuwDEALwAugDDALsAuQAkACIAuADBALkAtwDAALgAtgC/ALcAtQC+ALYAtAC9ALUAswC8ALQAsgC7ALMAIAC5ACIAsQC4ALkAsAC3ALgArwC2ALcArgC1ALYArQC0ALUArACzALQAqwCyALMAHgCxACAAqQCwALEAqACvALAApwCuAK8ApgCtAK4ApQCsAK0ApACrAKwAowCqAKsAHACpAB4AoQCoAKkAoACnAKgAnwCmAKcAngClAKYAnQCkAKUAnACjAKQAmwCiAKMAmQAcABoAmAChAJkAlwCgAJgAlgCfAJcAlQCeAJYAlACdAJUAkwCcAJQAkgCbAJMAkQAaABgAkACZAJEAjwCYAJAAjgCXAI8AjQCWAI4AjACVAI0AiwCUAIwAigCTAIsAFgCRABgAiQCQAJEAiACPAJAAhwCOAI8AhgCNAI4AhQCMAI0AhACLAIwAgwCKAIsAeQAUABIAeACBAHkAdwCAAHgAdgB/AHcAdQB+AHYAdAB9AHUAcwB8AHQAcgB7AHMAEAB5ABIAcQB4AHkAcAB3AHgAbwB2AHcAbgB1AHYAbQB0AHUAbABzAHQAawByAHMADgBxABAAaQBwAHEAaABvAHAAZwBuAG8AZgBtAG4AZQBsAG0AZABrAGwAYwBqAGsAYQAOAAwAYABpAGEAXwBoAGAAXgBnAF8AXQBmAF4AXABlAF0AWwBkAFwAWgBjAFsAWQAMAAoAWABhAFkAVwBgAFgAVgBfAFcAVQBeAFYAVABdAFUAUwBcAFQAUgBbAFMAUQAKAAgAUABZAFEATwBYAFAATgBXAE8ATQBWAE4ATABVAE0ASwBUAEwASgBTAEsABgBRAAgASQBQAFEASABPAFAARwBOAE8ARgBNAE4ARQBMAE0ARABLAEwAQwBKAEsABABJAAYAQQBIAEkAQABHAEgAPwBGAEcAPgBFAEYAPQBEAEUAPABDAEQAOwBCAEMAOQAEAAIAOABBADkANwBAADgANgA/ADcANQA+ADYANAA9ADUAMwA8ADQAMgA7ADMAKgACAAAAKwA5ACoALAA4ACsALQA3ACwALgA2AC0ALwA1AC4AMAA0AC8AMQAzADAABAHTAAMBDAHVAAQBDAHZANcAFAHbANkAJAHbABwBLAHdACQBNAHfACwBNAHjAOEAPAHlAOMATAHlAEQBVAHrAOkAZAHrAFwBbAHtAGQBbAHxAO8AdAHzAPEAfAH1APMAjAH1AIQBlAH3AIwBlAH7APkAnAHTAPsA+gD8AKMBowH9AKIBogH+AKEBoQH/AKABoAEAAZ8BnwEBAZ4BngECAZ0BnQEDAZwB+ACjAZsBmwGiAZoBmgGhAZkBmQGgAZgBmAGfAZcBlwGeAZYBlgGdAZUBlQGcAZQB+ACTAfYAmwGSAZMBmgGRAZIBmQGQAZEBmAGPAZABlwGOAY8BlgGNAY4BlQGMAY0B9gCLAfQAkwGKAYsBkgGJAYoBkQGIAYkBkAGHAYgBjwGGAYcBjgGFAYYBjQGEAYUB8gCLAYMBgwGKAYIBggGJAYEBgQGIAYABgAGHAX8BfwGGAX4BfgGFAX0BfQGEAXwB8ACDAXsBewGCAXoBegGBAXkBeQGAAXgBeAF/AXcBdwF+AXYBdgF9AXUBdQF8AXQB7gB7AXMBcwF6AXIBcgF5AXEBcQF4AXABcAF3AW8BbwF2AW4BbgF1AW0BbQF0AWwB7gBrAewAcwFqAWsBcgFpAWoBcQFoAWkBcAFnAWgBbwFmAWcBbgFlAWYBbQFkAWUB7ABjAeoAawFiAWMBagFhAWIBaQFgAWEBaAFfAWABZwFeAV8BZgFdAV4BZQFcAV0B6ABjAVsBWwFiAVoBWgFhAVkBWQFgAVgBWAFfAVcBVwFeAVYBVgFdAVUBVQFcAVQB5gBLAeQAUwFKAUsBUgFJAUoBUQFIAUkBUAFHAUgBTwFGAUcBTgFFAUYBTQFEAUUB4gBLAUMBQwFKAUIBQgFJAUEBQQFIAUABQAFHAT8BPwFGAT4BPgFFAT0BPQFEATwB4ABDATsBOwFCAToBOgFBATkBOQFAATgBOAE/ATcBNwE+ATYBNgE9ATUBNQE8ATQB4AAzAd4AOwEyATMBOgExATIBOQEwATEBOAEvATABNwEuAS8BNgEtAS4BNQEsAS0B3gArAdwAMwEqASsBMgEpASoBMQEoASkBMAEnASgBLwEmAScBLgElASYBLQEkASUB3AAjAdoAKwEiASMBKgEhASIBKQEgASEBKAEfASABJwEeAR8BJgEdAR4BJQEcAR0B2AAjARsBGwEiARoBGgEhARkBGQEgARgBGAEfARcBFwEeARYBFgEdARUBFQEcARQB1gAbARMBEwEaARIBEgEZAREBEQEYARABEAEXAQ8BDwEWAQ4BDgEVAQ0BDQEUAQwB1gALAdQAEwEKAQsBEgEJAQoBEQEIAQkBEAEHAQgBDwEGAQcBDgEFAQYBDQEEAQUB1AD8ANIACwH9APwACgH+AP0ACQH/AP4ACAEAAf8ABwEBAQABBgECAQEBBQEDAQIBAgDSAAAAAQDVAAMABADUAAIAAwDXAAUABADYANYABwDXANkABgDaANgACQDZANsACgDaAAgACQDdAAsADADcAAoACwDfAA0ADgDeAAwADQDhAA8ADgDiAOAAEQDhAOMAEADkAOIAEwDjAOUAFADkABIAFQDlAOcAFABTAeYAFgBbAYkAFgDqAOgAFwDrABkAGgDqABgAGQDtABsAHADsABoAGwDvAB0AHADwAO4AHwDvAPEAHgDyAPAAIQDxAPMAIAD0APIAIwDzAPUAJAD0ACIAIwD3ACUAJgD2ACQAJQD5ACcAJgD6APgAKQD5APsAKADSAPoAAQD7ANMAegDnAEwBewBMAU0BfABNAU4BfQBOAU8BfgBPAVABfwBQAVEBgABRAVIBgQBSAVMBggDpABcAgwBUAYIAhABVAYMAhQBWAYQAhgBXAYUAhwBYAYYAiABZAYcAiQBaAYgAAQADADIAAwAFADoAOgAFAAcAQgAHAAkACQALAFIACwANAFoADQAPAGIAYgAPABEAagARABMAEwAVAHoAggAXABkAGQAbAJIAGwAdAJoAmgAdAB8AogAfACEAqgAhACMAIwAlALoAJQAnAMIAwgAnACkAygApAAEAKADRACoA0QDQACsA0ADPACwAzwDOAC0AzgDNAC4AzQDMAC8AzADLADAAywDKADEAJgDJANEAyQDIANAAyADHAM8AxwDGAM4AxgDFAM0AxQDEAMwAxADDAMsAwwDCAMoAwQDJACYAwADIAMkAvwDHAMgAvgDGAMcAvQDFAMYAvADEAMUAuwDDAMQAugDCAMMAuQDBACQAuADAAMEAtwC/AMAAtgC+AL8AtQC9AL4AtAC8AL0AswC7ALwAsgC6ALsAIACxALkAsQCwALgAsACvALcArwCuALYArgCtALUArQCsALQArACrALMAqwCqALIAHgCpALEAqQCoALAAqACnAK8ApwCmAK4ApgClAK0ApQCkAKwApACjAKsAowCiAKoAHAChAKkAoQCgAKgAoACfAKcAnwCeAKYAngCdAKUAnQCcAKQAnACbAKMAmwCaAKIAmQChABwAmACgAKEAlwCfAKAAlgCeAJ8AlQCdAJ4AlACcAJ0AkwCbAJwAkgCaAJsAkQCZABoAkACYAJkAjwCXAJgAjgCWAJcAjQCVAJYAjACUAJUAiwCTAJQAigCSAJMAFgCJAJEAiQCIAJAAiACHAI8AhwCGAI4AhgCFAI0AhQCEAIwAhACDAIsAgwCCAIoAeQCBABQAeACAAIEAdwB/AIAAdgB+AH8AdQB9AH4AdAB8AH0AcwB7AHwAcgB6AHsAEABxAHkAcQBwAHgAcABvAHcAbwBuAHYAbgBtAHUAbQBsAHQAbABrAHMAawBqAHIADgBpAHEAaQBoAHAAaABnAG8AZwBmAG4AZgBlAG0AZQBkAGwAZABjAGsAYwBiAGoAYQBpAA4AYABoAGkAXwBnAGgAXgBmAGcAXQBlAGYAXABkAGUAWwBjAGQAWgBiAGMAWQBhAAwAWABgAGEAVwBfAGAAVgBeAF8AVQBdAF4AVABcAF0AUwBbAFwAUgBaAFsAUQBZAAoAUABYAFkATwBXAFgATgBWAFcATQBVAFYATABUAFUASwBTAFQASgBSAFMABgBJAFEASQBIAFAASABHAE8ARwBGAE4ARgBFAE0ARQBEAEwARABDAEsAQwBCAEoABABBAEkAQQBAAEgAQAA/AEcAPwA+AEYAPgA9AEUAPQA8AEQAPAA7AEMAOwA6AEIAOQBBAAQAOABAAEEANwA/AEAANgA+AD8ANQA9AD4ANAA8AD0AMwA7ADwAMgA6ADsAKgA5AAIAKwA4ADkALAA3ADgALQA2ADcALgA1ADYALwA0ADUAMAAzADQAMQAyADMABAHVANMADAHXANUADAEUAdkAFAEcAdsAJAHdANsALAHfAN0ANAHhAN8ANAE8AeMAPAFEAeUATAHnAOUAVAFcAesAZAHtAOsAbAHvAO0AbAF0AfEAdAF8AfMAfAGEAfUAjAH3APUAlAH5APcAlAGcAfsAnAEDAdMA+gDSAPwAowH8AP0AogH9AP4AoQH+AP8AoAH/AAABnwEAAQEBngEBAQIBnQECAQMB+AD6AKMBmwGjAaIBmgGiAaEBmQGhAaABmAGgAZ8BlwGfAZ4BlgGeAZ0BlQGdAZwB+ACbAZMBmwGaAZIBmgGZAZEBmQGYAZABmAGXAY8BlwGWAY4BlgGVAY0BlQGUAYwB9gCTAYsBkwGSAYoBkgGRAYkBkQGQAYgBkAGPAYcBjwGOAYYBjgGNAYUBjQGMAYQB8gD0AIsBgwGLAYoBggGKAYkBgQGJAYgBgAGIAYcBfwGHAYYBfgGGAYUBfQGFAYQB8ADyAIMBewGDAYIBegGCAYEBeQGBAYABeAGAAX8BdwF/AX4BdgF+AX0BdQF9AXwB7gDwAHsBcwF7AXoBcgF6AXkBcQF5AXgBcAF4AXcBbwF3AXYBbgF2AXUBbQF1AXQB7gBzAWsBcwFyAWoBcgFxAWkBcQFwAWgBcAFvAWcBbwFuAWYBbgFtAWUBbQFsAWQB7ABrAWMBawFqAWIBagFpAWEBaQFoAWABaAFnAV8BZwFmAV4BZgFlAV0BZQFkAVwB6ADqAGMBWwFjAWIBWgFiAWEBWQFhAWABWAFgAV8BVwFfAV4BVgFeAV0BVQFdAVwB5gBTAUsBUwFSAUoBUgFRAUkBUQFQAUgBUAFPAUcBTwFOAUYBTgFNAUUBTQFMAUQB4gDkAEsBQwFLAUoBQgFKAUkBQQFJAUgBQAFIAUcBPwFHAUYBPgFGAUUBPQFFAUQB4ADiAEMBOwFDAUIBOgFCAUEBOQFBAUABOAFAAT8BNwE/AT4BNgE+AT0BNQE9ATwB4AA7ATMBOwE6ATIBOgE5ATEBOQE4ATABOAE3AS8BNwE2AS4BNgE1AS0BNQE0ASwB3gAzASsBMwEyASoBMgExASkBMQEwASgBMAEvAScBLwEuASYBLgEtASUBLQEsASQB3AArASMBKwEqASIBKgEpASEBKQEoASABKAEnAR8BJwEmAR4BJgElAR0BJQEkARwB2ADaACMBGwEjASIBGgEiASEBGQEhASABGAEgAR8BFwEfAR4BFgEeAR0BFQEdARwB1gDYABsBEwEbARoBEgEaARkBEQEZARgBEAEYARcBDwEXARYBDgEWARUBDQEVARQB1gATAQsBEwESAQoBEgERAQkBEQEQAQgBEAEPAQcBDwEOAQYBDgENAQUBDQEMAQQB1AALAfwACwEKAf0ACgEJAf4ACQEIAf8ACAEHAQABBwEGAQEBBgEFAQIBBQEEAQMBAgDUANIAAQDTANUABADWANQAAwDVANcABAAGANgABwAFANcABgAIANoACQAHANkACgDcANoACQDbAN0ADADeANwACwDdAN8ADgDgAN4ADQDfAOEADgAQAOIAEQAPAOEAEAASAOQAEwARAOMAFADmAOQAFQATAOUAFACBAFMBFgDoAFsBFgAYAOoAFwDpAOsAGgDsAOoAGQDrAO0AHADuAOwAGwDtAO8AHAAeAPAAHwAdAO8AHgAgAPIAIQAfAPEAIAAiAPQAIwAhAPMAJAD2APQAIwD1APcAJgD4APYAJQD3APkAJgAoAPoAKQAnAPkAKAAAANIAAQApAPsAegAVAOcAewB6AEwBfAB7AE0BfQB8AE4BfgB9AE8BfwB+AFABgAB/AFEBgQCAAFIBggBUAekAgwBVAVQBhABWAVUBhQBXAVYBhgBYAVcBhwBZAVgBiABaAVkBiQBbAVoB", "g": [[0, 2508, "cape"]]}, "bananaTop": {"s": 3.3721793002414614e-05, "p": "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", "n": "jczxn7fbn9y28YQVk9DVnLrdmS/GkMT2xJQckDXmjRfQkc3bo6vw5oYY5YUOmz7Tht/5lsgphuLwtpn6rKYg4Igbl0HiiSrwnrUgkT379YUevLC4osi/p9ivoAytuaHStbS8zIwF6oMInSy9qji1rKfdsB+ivKHOwM+extCawTSeysOe9YILtTapt6rF9YL8zM+X2saW8YL9vNCgziyU3zGQ4xKG6Y3O4NaN4K+j4xWG2tiN+4XjALObARCCAoPsfwAA7zCMADCKlkTzl0cDoTvDoTvDl0HilkTzm0sTl0cDtTapmz7ToTvDlkTzl0Hkm0oT0DKW0DKWqjm2mUHdnT7PoU0ilkXx3zGQwjSe4DGP0DKVuDamnDPEmUoNqlAwwVVHx1VLrimojjLmlEERl0f+n00c7zCM8TCL2zGR7DCMyTOa9B6F4FhWw1hE7kZoyt2SyhuQ7uuEgfcFhubqiesmm/6zg/3sk+LFvvKVqOSpnRpLjfM1p/xbzCRuy/50AQZ//Px/p+ipAd+F/t+Fjgg2gf76hQgdpxhXyB5u6Rp6ASJ6ivXSkAbFz+GPzeGQ/N6GjxA5qBhY0h5yjCviufKYqSet0AuL9OOF/QeBgg0Dli01qylVyCdrASF77Ddxs1XKzXQF1j2Z13DU8VupEDmQGGe6AH/7kTsOplkKzFBTy2c0ElZbAnUxheUTiyocp7k5osQ8jDAU74YfncEx9oUgCY01j9orodRI8IgnEYcjm0sTlTwgntZFlTUrmOBBqcRGoU0i64ornfBOmvFKoxhTpEgxxMdgqDpG9YkqzaJFmuZGpSJSoU4iyKdGrghhtVM9zL1eud9kveJoukZQ7Z1OxNhpqlAwwlVHtVM8qlAw9YkryMZizk9Wyz5iw+xtzN9v1Ule0FZQtVM9zN1u75E83Pl66Uhm7KNUv+Zq31hW31hW0FZQ0VdQC4gn/0NsAwd/POVs71haAFlb8Fha4FhWfwAAfwAADa+fEQyDHtqKEI3NKNeOIS+PDoPsC4UdK9iPMDKWO621ORySXM+3DYIHLqmwPjSeN8OfPpfdRd2bRq69TxyhS7K+SzapDIIOSaLUWBKmEoMPPZnWXOmsO48DX7XbVji1ZRu3EoQTYMTGE4QVWK/VaCjEbsngZT7SXrHecSLSEIUZZbfoQZQLd9/hdiTiaUHiczUAT539SpoQDoMRcsoJe+fvYrUfbz34YrwqfPUXETCMETCMADCLETCMITGQDzCLIDGPHDGPIlhVX0ooL1dQIASFFNyIOSaVQt6ZUvKgdfvPZi/EfhIBdQ8ubeHGfu/+cvU4PzhfNfVzGBN7Mvx0SVFCYeBMVv5dNOOQWumpdPLOdQwvffrpfwIGMB9yWRhYKe2JL+GOWeiocwLKdigZfwn7AyF7Mh9xMRiNVwWkcTDgFTRyNSpsWCNUbiA3TD2uMnT2UVraMWozT0RJW1YUITGQMDKWMTKWSzapViqtXjvDZj/VakPrYkwbPVVIUlI1bjjhaUgEPzSfVji1XzvEaUHjaUgFWFAtX00iZUsTZT7TZUsTaUcDakTzakTzXzvDaUHiakTzEoYeehcYUq40SKQydwAte+UREYciYcs+degsZMU0FKVWEVhaIVhWEFhaIFhWEkhnMFZQF0plEpM+JPl6KLBaMupzMUddIVhWMFZQMFZQPlVHaAZJK+Z1MUddS1M9NM9pOsdiSjlWMLVaTtlcVzlJL1ZQSeplVlAwS1M9P1VHX04iX00iEYkpVUVASMVXF4ooV9NRXu1Tav1HXUgxVM1RWOBWZUsTaUMZbOA7Xd1PZz0rWdBN", "i": "AwABACIABgACAAEAIwACAEUACAAHAA0ACQAHAAgACwAMAAoACQAKAAcACgAJABYADQAHAA4ABgALAA8ADgAFAAMAFQASABQACQAUABIAEQAIAA0ACQASABYAEgATABcAGAAAABMAGAAZABcAGAATABoAIQAdAB4AIQAeAB8AHwAgACwAIQAfACwAHAAhAAQAIgAEACEAAwAiABkBIgAhABkBJAAdABwADgADABkBLAAlACcAKAAnACYAJgAnACUAJwAoACkAJwApADIAMgApACsALAAnADIAKgAoACYAKgApACgALQAmAB4ANAAwAC4ANAAxADAALwAwADEAMgArADMANAAzACsAKQA0ACsALwAzAC4AMgAzAC8ANAAuADMAUgA0ACkANgA3ADEALwAxADcANwA4ADkAOgA5ADgANgA6ADgANQA2ADEAOwA5ADoAPAA7AD0APgA9ADsALwA8AD8AFgASAEMARABDABcAJABFAEYADwAWAEcASABDAEoASwAqAC0AJABLAC0ATABGAA8ASABHAEMATABHAE8ASgBOAEgARwBIAE4ATwBHAE4AUABKAEkAzQBQAEkAUwBLACQAzQBWAFAATQBMAFUAXgBKAFAAVwBPAE4ASgBXAE4AVABPAFcAUgA1ADQANQBBADYAWABBADUAWwBaAFEAXABZAEsAUwBcAEsAWQBbAFEAXABrAFkAVQBTAE0AXQBTAFUAXgBXAEoAYABhAOMAYADtAGEAYwBXAGUAXQBVAGMAZgBeAFYAZgBWAF8AXwDjAG4AWgBnAFgAWwBpAFoAbABpAHEAYgBxAFwAbQD1AO0A9QD0AG8AZABjAGUAdAB3AHUAcwB0AHUAdwBjAGQAdwBkAHwAdQB3AHwAeQBiAHYAegB5AHYAcAB5AHoAeQBxAGIAeQBwAHIAZABmAHsAXwBuAHsAfABkAHsAYQB+AG4AfQB7AH4AfwB9AH4A9QBvAH4AgQB/AIAAcwB1AIUAhQB1AH0ArgAaALAArwCxALIAtACxALMAtQC0ALMAsAAaALMAtwC1ALgAswAaAIoBtgCzALoArwBEAK4AuwBEAK8AsgC3ALwAvgC8AL0AvwC5AMIAwQC+AMYAxADCAMcAyADEAMUAyADFAMcAywDMAMgAxADXAMYAzwDOANEAzADPANQA0QDUAM8AzADUANAA0QDJANIA3QDUANMA0wDVANYA0ADXAMgA1ADYANAA1wDQANkA2gDNANcA1gDVANwA3QDWANwA3gDdANwA4QDeAOAA3gDhAN0A4gDYAN0A2QDYAGAAzQDaAFYA4ADbAOQA4ADkAOEA5ADmAOEA4QDmAOoA5ADlAOYA5gDlAOgA5gDoAOcA3QDhAOoA3QDqAOIA5wDyAOoA6gDyAOsA4gDqAOsAYADiAOwAYADsAO0A7gC2ALoA6QDoAPEA8gDvAPMA8gDzAPQA6wDyAPQAQAD2APcA+QD4AD4AQgD5AD4A+gD4APkA/QD6APkA/AD7APoAPwD7AP4AAAH+APwAAQH8AP0AAwEAAfwA/gAAAQIBMgACAQUBBQECAQQBAwEGAQQBCgEDAQcB/wAaABkBCAEGAQMBDAENAQkBDAEKAQ4BDwENARABEQEQAQ0BDwEQARIBEQETARABEgETARQBEgEUARYBGQEPARUBDwESARUBAgAiAAEAEQEUARMBGAEVARYBGQEiAf8AFQEaARsBGwEaARwBGAEaARUBHQEaARgBGwEcAR4BHQEeARwBIQEgAR4BHwEnASEBGQEgASMBJAEZASMBIQEjASABIgEkASkBJgEpASQBKwEiASoBLAEpASYBLAEmASoB/wAiASsB/wArAS4BLwEuASgBKAExATABKAEuATEBMgH5AEIAaAA0AUIAMwFCADQBNgEzATUBNgE1ATgBNQE0ATcBOAE1ATcBOAFvAW4BNwE0AWwAOAE3ATkBbwE4ATkBegFvAT8BmQFvAPMAPwE5AT0BPQFsAHIAcgA+AT0BQAFBAT0BQQFxAT8BQgFDAXEBQgF4AUMBQgFEAXgBRwFFAUQBgABJAUoBSwGBAEwBTQFJAToBSAFOAUUBTQF3ATsBeQFEATsBgwA+AXIAgwBQAT4BUQFGAUABigCBAEsBAQH9AG0BbgEBAW0BbQEzATYBbgFtATYBcQF7AXABcgF7AXEBeQF+AYUBdQF+AXkBdQGBAX4BdgGoAU0BcQF6AT8BeAFzAUMBeAF0AXMBBwEBAW4BDgEHAXoBggF8AXMBfQGCAXMBfwGxAYABgAGDAYEBcwF8AXIBcwF0AX0BhQF9AXQBfwGAAXUBggGIAR8BwAGEAYMBhQGEAYYBhQGGAYgBhAGFAX4BhwEYARcBHwEdAYcBiAGJAScBLwGJAYQBiQEoAScBiQEvASgBjAGKAf8AigGMAY0BjwH/AC4BLwGPAS4BjgGMAY8BjgGNAYwBugCKAZABkgGQAZMBkwGKAY0BmwHwAPEAlwHzAJUBlgGYAZUBmAE6AZcBPAGYAZoBnAGUAbYAnAG2AJ4B8QCUAZsBlgGVAaEBowGWAaEBogGjAaEBmgGWAaMBmgGkAXYBpAGaAaMBpQGeAaABpwGhAaABpgGeAbYApwGmAakBoQGnAaIBswGyAagBpAGjAbMBpwGrAbMBtgDuAKkBqgHuAKwBqwGqAawBrwGnAakBsAGnAa8BsAGpAe4AsAHuAKoBsAGqAasBqAGyAbEBtAGAAbEBgAHAAYMBtQHBAcAB7gC6ALYBuAG2AbkBvAG6AbsBvAG7Ab0BvQHEAbUBvgGtAbYBvgGuAa0BtwG/AbgBwAGPAYQBwQGPAcABjwEvAYQBjgHBAYsBkQHEAcMBxAGSAcEBwQGSAZMBxQG6AMIBxQHCAbsBwgHDAcQBCQARABQABgABAAUACwAGAAUAAwAFAAEARQACAAYAIwAEAAIACgAMAAcADAALAA4ABwAMAA4AFgAPAAoADgALAAUACgAPAAsACQAIABAAVwBVAFQAFQATABIAEQAQAAgAFQAUABEAFQARAA0AAAAXABMAFwAAABgAGgATABUADQAaABUAIQAcAB0AHgAgAB8AHgAmACAAJgAbACAAHQAtAB4AJAAtAB0AIwAcAAQAIwBFABwAJAAcAEUADQAOABkBGwAmACUALAAgABsALAAbACUAMgAhACwAGQEhADIALQAqACYALgAwAC8APwAyAC8ANAA1ADEAGgANABkBNgA4ADcANgBBADoAPAA3ADkAPAAvADcAPAA5ADsAPwA8AD0AOgBBADsAOwBBAD4AQQBCAD4AQwASABcAGQBEABcARQAGAA8ARgBFAA8ARwAWAEMAuwBJAEQASgBDAEQATQAkAEYAUwAkAE0ARwBMAA8ATQBGAEwARABJAEoAUQBSACkAKgBRACkASwBZACoAVABMAE8AVQBMAFQA2gBfAFYAVgBeAFAAUgBYADUAWQBRACoAUgBRAFgAUQBaAFgA4wBfANoAZQBmAGQAYgBcAFMAXQBiAFMAZQBXAF4AaQBoAFoAYQBuAOMAZwBCAEEAWABnAEEAaABCAGcAWgBoAGcAdwBdAGMAagA0AWgAWQBrAFsAawBpAFsAagBsADQBXABxAGsAcQBpAGsAbABqAGkAYQDtAPUA9ADzAG8AdgBiAF0AcQByAGwAdwB0AHgAdgB3AHgAegB2AHgAcACDAHIAXwB7AGYAdQB8AHsAdQB7AH0AYQD1AH4AfgB7AG4AfwB+AIAAfgBvAIAAigB/AIEAvADBALIAGQAYAK4ArwCuALAArgAYABoArwCwALEAswCxALAAtACyALEAtwC0ALUAuAC1ALkAtgC1ALMAugCzAIoBtgC5ALUARAAZAK4AsgC7AK8AsgC0ALcAuAC8ALcAuAC9ALwAvQC4ALkAzgDLAMoAvwC+AL0AvwC9ALkAsgDBALsAwAC/AMIAwADDAL8AwwDGAL8AvwDGAL4AwwDAAMIAxADGAMMAxADDAMIAxQDEAMcAyADXAMQAwgC5ALYAygDHAMIAyADHAMoAywDIAMoAzADQAMgA2wDfANUAxgDXAMEAwQDNALsAyQDKAMIAzgDPAMwAyQDOAMoA0QDOAMkA1ADRANIA0gDTANQA1QDJAMIA3QDYANQA0wDSAMkA0wDJANUA0wDWAN0AwQDXAM0AzQBJALsA1QDCALYA2wDVALYA3gDcANUA3wDeANUA+wD4APoA3wDgAN4A0ADYANkA2gDXANkA2QBgAOMA2ADiAGAA2QDjANoA5QDkANsA5QDbAOgA5gDnAOoA6QDnAOgA4gDrAOwA6ADbALYA5wDpAO8A8ADvAOkA8ADpAPEA8gDnAO8A7ADrAG0AbQDrAPQA7QDsAG0AbQD0APUA9wD2AEAAPwA9APgAPgD4AD0ACwEIAQoB+gD9APwA/gD7APwAMgA/AP4AGQEyAA8BMgH9APkAAwECAQABAgEyAP4AAQEDAfwAAwEEAQIBBQEEAQYBBQEGAQgBMgAFAQkBHgEZARsBCQEFAQsBCgEMAQsBDAEJAQsBMgAJAQ8BDwEJAQ0BCgEIAQMBDAERAQ0BEgEQARMBFQESARYBDgERAQwBFwEUAREBGAEWARQBFwEYARQBGQEVARsBGgEdARwBHQEhAR4BIwElASQBIgEZASQBIQEnASYBSgGBAIAAJgElASEBJgEkASUBJgEoAS0BJgEtASoBLAEiASkBLAEqASIBKwEqAS0BLQEwASsBKAEwAS0BLgErATEBMAExASsBQgAzATIBMgEzAW0BNQEzATQBOAFuATYBbAA5ATcBPwFvATkBOgGZAZcBPAFNAToBPAE6AZgBdgFNATwBPQE5AWwAPQFBAT8BPgFAAT0BQQFCAXEBRgFBAUABQQFGAUIBRAF5AXgBRAFCAUYBRwFEAUYBSAFFAUcBgABvAJkBmQFJAYAARQFNATsBOgFJAZkBTgFJAUUBTgFKAUkBTwFKAU4BTAFKAU8BRQE7AUQBSAFPAU4BPgFQAUABUwFIAUcBtgGsAe4AbQH9ADIBbwF6AW4BegFwAQ4BcQFwAXoBdQE7AX8BeQGFAXQBeAF5AXQBQwFyAXEBQwFzAXIBOwF1AXkBTQGoAXcBdwF/ATsBAQEHAQMBBwEOAQoBegEHAW4BcAF7AQ4BDgF7ARcBewF8ARcBcgF8AXsBdQGAAYEBfgGBAYMBDgEXAREBFwF8AYcBggEfAYcBhAF+AYMBhwF8AYIBggF9AYgBfQGFAYgBGAGHAR0BHQEfASEBHwGIAScBhgGJAYgBhAGJAYYBKAEmAScBigEaAP8AjgGLAY0BjwGMAf8AkQG6AJABkgGRAZABkwGQAYoBiwGTAY0BmwGVAe8AlAHoALYA8QDoAJQB8ACbAe8AlQHzAO8AmAGXAZUBlwGZAfMAnQGUAZwBnQGbAZQBnwGdAZwBnwGcAZ4BnwGgAZ0BnQGgAaEBoQGVAZsBoQGbAZ0BpAGoAXYBlgGaAZgBmgF2ATwBpQGfAZ4BpQGgAZ8BpgGgAZ4BpgGnAaABqQGmAbYApwGzAaIBogGzAaMBswGoAaQBqAGxAXcBdwGxAX8BqwGsAa0BrQGuAasBugG3AbgBsAGrAacBsAGvAakBsQG9AbUBswGuAbIBsQGyAbcBsgGuAbcBrgGzAasBsQG1AbQBgAG0AcABvAGxAbcBtgG6ALkBugG4AbkBuwG6AbkBuwHCAb0BvQHCAcQBvwG+AbYBvwG3Aa4BvwGuAb4BuAG/AbYBtAG1AcABvQGxAbwBwQGOAY8BwwHCAboAxAHBAbUBkQGSAcQBkQHDAboAwQGTAYsBxQG5AboAxQG7AbkBAgAEACIACQAQABEAVwBjAFUAZQBeAGYAaQBqAGgAdwB2AF0AcQB5AHIAcACOAIMAvAC+AMEAzgDMAMsA2wDgAN8A+wA/APgACwEFAQgBHgEgARkBIwEhASUBSgFMAYEARQFJAU0BtgGtAawBugG8AbcBhgBzAIcAfQCJAIgAkACOAI8AhwCFAJEAjAB0AIYAiACJAJMAiQCKAJMAkwCLAF4BjQCMAJQAlwCYAJUAjACGAJoAnACRAJIAkwCeAJ8AngCTAF4BlgCNAJQAlgCUAKAAogCZAJcAowCkAKAApAClAKIApgCkAKMAoQCnAKMAlACaAKgAqQCoAJsAqgCbAJwAqQCbAKsAqgCfAKwAWQGDAIQAUAGDAFkBUgFGAVEBUgFUAUYBVQFTAUcBigBLAYsAiwBLAVYBkABZAYQAUAFaAVEBWQFaAVABWQFhAVoBXAFTAVUBXQFVAVQBXgGLAFYBXwFeAVYBWAGQAJgAWwFdAVIBXQFbAWIBXAFdAWIBpgClAKQAaAGmAKcAaAFpAaYAYQFgAWcBYwGsAJ8ArQBoAacArABjAWQBawFqAawAbAFoAWoBbAFqAWsBbAFiAWkBXAFiAWwBggCOAHAAggBwAHoAkgCTAJ0AjgCEAIMAhgB0AHMAhwBzAIUAjAB6AHgAggB6AIwAiACFAH0AiQB9AH8AigCJAH8AjQCCAIwAggCPAI4AkACEAI4AdACMAHgAiACRAIUAiACSAJEAqQCUAKgAiwCTAIoAmgCUAIwAlQCCAI0AjQCWAJUAlQCPAIIAlgCXAJUAlQCYAI8AmACQAI8AlwCZAJgAhwCaAIYAkQCbAIcAmgCHAJsAnACbAJEAnQCcAJIAnQCTAJ8AqQCjAKAAoACiAJYArQCqAKwAlgCiAJcApACiAKAAogClAJkApwCmAKMAmwCoAJoAqgCrAJsAqQCrAKEAqgCcAJ0AqgCdAJ8AoQCtAKcAngBkAWMBUQFAAVABRgFUAUcBVQFHAVQBVgFMAU8BVgFLAUwBVwFWAU8BSAFXAU8BUwFXAUgBWAFZAZAAUgFRAVoBWwFSAVoBZgFTAVwBUgFdAVQBXwFWAVcBmQBYAZgAmQBgAVgBWAFhAVkBYAFhAVgBYQFbAVoBYgFbAWEBYwGfAJ4AZAFfAVcBZQFkAVcBUwFlAVcBZgFlAVMBXQFcAVUBngBeAV8BmQClAGABpQBnAWABpgBnAaUApgBpAWcBYQFnAWIBZwFpAWIBrABqAa0ArQBqAWgBawGsAGQBZQFrAWQBaAFsAWkBawFmAVwBawFlAWYBbAFrAVwBkgCIAJMAqQCgAJQAqQChAKMArQCrAKoAoQCrAK0AngBfAWQB", "g": [[0, 2247, "peel"], [2247, 453, "stem"]]}, "peel": {"s": 6.0940005648513405e-06, "p": "6b/Mu/052b+Husg0nr+7waws4Ley1sgk3rm5zKcuk7qT1ecv9bPS700dMLYx30gn0rvo18seaMHE6uEQYLml90kkl7rz99IONbNqAKsXprXa8JIi98h8p9A/HNM5rcAxUsYbruxBU9DWnGxFKc9ZnnpKAM5kpjlK9M45tnpGe9TWn909SsZSwXonjtKZu5cmcsnFrLI3QcPcvl09NMqD1B0ZX8Q41x02/M1Y4o81AMol7uILb9xq4qgM2drJ8yQFPc2PEQ8k2+9Ng55WjvHGgkBcTNlzkT9PiN+zkUNIQuSgiDhVguulko1DV9jWmYhS7dtHkANUSefDi+had+4SkQlcWeAcqi0wGvf0mQA7ot35pJ5RIfDun/RWc+BEx0QbCd6g30k6OewP9uQBaPDI/EsxL9/PAlQtVvlUioBKyPd9hBBfUwVrgI1ZrQIxgmBfiAZom3NZpvUEq7Ms7AK3uEki2/ZxzvND5/K8zs8UQQDt4pIJQAGM6tE45ADV+aT/nQhUHLImENlqIJz3y9BKK6f3Rb+YMtn+OcXrLa77M9X5Rmf0pMbSRdv618fEVNn9ttJ9USz21NZ+Ygj4ZNm+bvX/zN26D9P65e7jJkDzCOWrPIzx5OOrVtXxyuona0P0iePMdq/+Rt7Ibun5tu7kei/7M/cxCvv5kfaSQ2DvNQjqNKvwm/t/XQTwZ/q0cBn0RABBfV/6lvTHfikABQD/fwUAkrSl90IVj7nMD+4HnsfICRcC5LVfIR8OSrbuF2UJU7USE2sVGLr3I+wTq7gbLsAGCcHMHDkARMDXEIQfwLr9NtQJxL5OQxEEH8IzRsf+AsVMRpINicPeTfsF3NViUUwR9s07W+8INM6CYR4A/tKkZQMFY+icJA4jHOSAXw4QsOCibdEIV+CMcsUEn+sKe9oBRfHqeVEG3Pt/JFckR/XLYbkRJvKEcWQLwwaSdu0JHQVyfVsFvxFV/zT+6A1Pg9pcMhUphQ1ZeQ5QhtBQ7w03n7M2EwXqiR9fWRIhmV5ZHhgEjDdbsBFi1XVA7Q7rztgUsxLD4wcKkRuR9eIypBlxk6dDVR0uitlSYyD8kf1HqidQkgVQOSyWnXVP2x5HjAJXzxdVs+snDCb2rKgvxiV8o/NQyCUxyh5Coil72aESyiay8NMGjyPZAjb/PSqGEvclfCtf4PY30S1Mp2c3oTbLp609pSnrlexI9zCEnQ1JoDfVqLhD5zpluFRAQCUNxHkelzjQwF4nWj59tdU4Zz1auwgv+Dda07MabTCFuP1FXToi7/QMt0A+2uEaBzKxBY0BeTv54gUywELtwFoySkFDwgE4skYIzgsttEan1RQuekbA994P/EZt2ZcgeEYL6W0pbkoq4V8jPUsN75YZuT7qBRIGm0u+ChAP4koA7m4it0z9/8IX2wVPHOT0vhmKKOPz0QK8TyTv1RGRZonyYxtrVpbxIA15coL1Lw4Qerr5MAyffhYAsxvOFIX4LTC9MCX3LRurQhXx8x+2aZ32SSFGcZn7Jhuwd0gBrS8NGVX7Ez3uIGz+xS8kRkf2Vy8TWCz4cThDSwz7RzgYVaj+Di+/Yqn8zkHiO9QAYhWUH98kKgnTYAQS8Rl6XtcQqxSIewEAbh1baBsMNxn0dH4GmSnoZ+MGbiYEb8kAiC0YUSIQKjpcEBEiTz1vNskSEz+cR1YHVjZeVdoIbDULXHQCSkbSE7wGNUSNEYkchkkXErYXCEAVMzj+JUguKFYHyUqUHacOmkJ4NmUOTkZOMw0KdEE9QgkE", "n": "je4zksXnqb+9j9bZhegUoBFSgvQAhfwhtMmqys2ZsiFeuNmfgQUIlBJAmbjr2bGlkOg3rKjcltAysgpkzyRv0qixybul4LidurG5shZh2MOYySZs3itz28+R7MeQ6dKM3Shz4Yrd1ZxCqaT415+5upcL7aSqvQZsqMlJxuhu6x166rCg+6qj3SZ09C127b2W7C119tCL+Ct37Sp2+p2w7OB5CoLzBrVmAyx3+rKcAriX+zB1+cCS/8iOAi52AdKKBCd55ueG3fCHrQOgyvaO2gGHvAyVnS/AzRONxCuZpln2692I9umD7feD6A2E5yaKu2joxEKl212y+9uH+vuBBfKC/BCC+SyJAFyo5nwG/X8BkuXHsuag1d2OhBcRkvrAkRo4qCZTihHVw+ySyCdrjSkhiSjtnRu1tC9akzkf2CtxsjxQmUfrrEo88yd45Sx00z5lwVhCzHAf51Vb/iZ5+Cl48DdxCj1vCWFRCdWJKq1XPZUfFJW+CayhChF9FSZ3MfR1Ci92CMCTC8mODyx2FqWqPpTpKJ+4YLIfT/1jU8NKDrWaHLKgKCNzGS50GsWTF86NFdeKGyl1Hi1zLa2rWbHTRqLOa8EZcdsuVA9eGLuYMruidMz8Trq5KsKaLiZwLc+UPsigItqMMidudtPya/9Eet4AbAlDT9qkYc2/Uh1cfez/dOTUNt2Tc/XMdgsufgMLA+OEEeuEBAOBERuFGQ2EEDCMHVOkIXsBEOCGJvSIFPuDLCuRQVG3RGkTIeSJOe2QLQSJOx2UTRWdaDDIWEC+aBS7DSd4Byl4Fyp2NHQAIjVuK09aSEZOV1wHLi1tLShwQCplbTUlUzlNakYKVO2iRSZkZR5GTP+bcwrLfRUMXCtMeSQRdinp", "i": "bQBwAHEAAwAIAAIAFgACAAgABAABAAAABAADAAEABQAEAAAAAQADAAIABgBbAAMACAADAFsACQAIAAsABwAEAAUABQAZAAoACgAbAGQADQAGAAcADABbAAYACgANAAUACwAIAFsAEgAjACgADgASABAAEgAOABEAEgARACMAEwAnAC0AAQAOAAAAAgAWABgADgABABgAGQATABQALwAXABoAGwAUABwAHgAaAB0AGgAJAB0AHAAwACAACQALAF0AHQAJAF0AHwAdAF0AJwASACgAIwARACQANAAkACYAJQAiACkAKwAVAA8AKwAXAC8AKwAPABcAOwAwAC4AHAAtADAAMQAeAB8APAAvAB4AIAAwADMAMgAzADAAIgAhADYANQA3AH4AKgB+ADgALwA6ADkALwA8ADoAPQA8AB4APQAeADEAOwA+ADIAQgBdAGMAQQBdAEIARQBEAEYASABFAEYARwBIAEYASQBsAFEASwAxAB8ATABLAEEARQBNAEIASQBOAEgASQBPAE4AUQBPAEkAUgBRAFAAsQBTAEwAVABMAE0AVABVAEwATwBWAE4AVgBUAE4AswBUAFYAVwBWAE8AUgBPAFEAUgBXAE8AWQBYAFIAWgBYAFkAXwBbAAwAXwBcAFsACgBgAA0AYgBfAF4AXwBjAFwAYQAKAGQAZQBeAGEAYgBDAF8AZgBiAGUAYQBoAGUAZABoAGEAZwBmAEcAZAAbACAAIAAzAGoAaABkAGoARwBmAGkAbABHAGkAawBtAGwAawBqAHAAagAzAG4AbwBuAHUAcQBQAEoAcQByAFAAcQBwAHMAdgBvAHUAcABvAHYAcAB2AHMAcwByAHEAbgAyAHQAMgBAAHQAdQBuAHQAWQBSAHIAeABaAFkAegA2AHsANAB8ADYANAB9AIUAfgA3AHoAfwB+AIAAOgCLAH0AOgA8AIIAPwB5AD0AeQCDAD0AhgCWAIgAgAB7AIoAigCGAIgAjACUAIUAfwCNAI4AhQCUAIcAfwCAAI0AjQCAAIkAggCaADoAjwCaAIIAkwCEAI4AkgCEAJMAlACdAJUAlwCJAIgAnwCNAIkAiQCXAJgAiQCYAJkAmgCbAIwAmwCUAIwAmwCdAJQAjgCfAJMAnACYAJUAmQCYAKUAngChAJsAowCfAJkAkACgAI8AoACeAI8AowCTAJ8AogCgAJAAogCtAKAAowCSAJMApQCcAKQAqQCdAJsAoQCpAJsAqgCjAJkApQCkAKYApgCdAKkAqwCmAKkArACrAKkApwCmAKsApwCrAK8AoACtAKgA1gCjAKoArwCsALAArgCwAKwArwCwANcArwDXAKoAsgCxAFUAuwBUALMAVgC1ALMAVwC0AFYAtgBXAFgAtwC2AFgAuABYAFoAuAC3AFgAygC3ALgAsgC5ALEAsgC/ALkAuwC6ALIAvAC1ALQAwgC1ALwAvQC8ALcAygC+AL0AvwCiAJEA2ADAALoAwQC6ALsA2ADBAMMAxQDCALwAxQC8AL0AzgDFAL0AxgDYAMMAdQBAAMgAyADHAMkAeAB3AMwAkgDHAIQAyQDHAJIAyQDPAMsAzQDLAM8AzAB3AMsAzADNAL4ArQCiAL8AvwDAAK0AowDQAJIAxQDUAMQA0gDUANMAzgDUAMUAwADVAK0AqADVAK4A0ACjANYAsACuANoA1wCwANoA1QDAANgA2ADZANUA2QDaAK4A1wDaANwA0QDXANsA2wDSANMAxADdAMYA0gDdANQA2wDcANIAUwA/ADEAGQAFAAAABwAGAAMABwADAAQABQANAAcAGwAKABkADQAMAAYADwAVABgAEwAQABIAGAARAA4AEQAYABUAEwASACcALQAUABMAEQAVACQAAgAYAAEAGAAWAA8AFgAXAA8AEAAAAA4AGQAAABAAEwAZABAAGgAWAAgAGgAXABYAHgAvABoAFAAbABkAHAAUAC0AHwAeAB0ACQAaAAgAGwAcACAAJAAlACMAJAAhACUAKAAjACUAJwAoACkAJwApACoAKQAoACUAIgAlACEAKwAkABUAJAArACYAJgArACwALQAnACoALQAqAC4ALwA5ACsALQAuADAAMgAwADsANQAiADcANwAiADYANgAhADQAJAA0ACEALAA0ACYANQApACIAKgApADUANQB+ACoAOAAuACoAOQAsACsAOwAuADgAPwA9ADEAMgA+AEAARABjAEMAZwBGAEMAQQBLAF0ARABCAGMARQBCAEQAQwBGAEQAZwBHAEYARwBJAEgAbABJAEcASgBRAGwAUwAxAEsATQBBAEIAQQBNAEwARQBOAE0ATgBUAE0ASABOAEUAUABRAEoATABTAEsATABVALEAUgBYAFcACwBbAFwAXABdAAsAYwBdAFwADQBgAAwAYQBgAAoADABeAF8AYABeAAwAYQBeAGAAXwBDAGMAZQBiAF4AZwBDAGIAZwBiAGYAZQBpAGYAZQBoAGkASwAfAF0AagBkACAAawBoAGoAaABrAGkAawBsAGkAbQBKAGwAbwBqAG4AcABqAG8ASgBtAHEAcgBSAFAAbgAzADIAcwB2AHcAdwB2AHUAcgBzAFkAWQBzAHgAeABzAHcAegA3ADYANgB8AHsALAB9ADQAhQB8ADQAfwA4AH4AgAB+AHoAfQAsADkAfQA5ADoAgQA7ADgAfwCBADgAPAA9AIIAPQCDAIIAgQCEAD4APgA7AIEAhABAAD4AfACFAIcAhgB8AIcAhgCHAJYAgAB6AHsAewB8AIYAigB7AIYAiQCAAIoAiQCKAIgAiwCMAH0AhQB9AIwAOgCaAIsAiwCaAIwAjgCBAH8AgwCPAIIAgwCQAI8AjgCEAIEAeQCQAIMAeQCRAJAAhwCUAJYAlwCIAJYAlACVAJYAlQCXAJYAmACXAJUAnACVAJ0AnwCOAI0AmQCfAIkAnAClAJgAmgCPAJ4AmgCeAJsAoAChAJ4AkQCiAJAApACcAJ0AqgCZAKUApgCkAJ0AqgClAKcApwClAKYAqQChAKgArwCrAKwAqgCnAK8AqAChAKAArACoAK4ArACpAKgAUwB5AD8AUwCxAHkAsQC5AHkAuwBVAFQAtAC1AFYAswC1ALsAtgC0AFcAuQCRAHkAuQC/AJEAsgC6AL8AuwCyAFUAtQDBALsAtwC8ALYAtwDKAL0AvAC0ALYAvgDOAL0AugDAAL8AwQDYALoAwgDDAMEAwgDBALUAxQDEAMIAxADDAMIAxADGAMMAdABAAHUAyABAAMcAdwB1AMgAyQB3AMgAzADKAHgAeAC4AFoAygC4AHgAhADHAEAAdwDJAMsAvgDKAMwAzQDMAMsAzgC+AM0AzwDJAJIA0ADPAJIAzwDQANEA0wDPANEAzQDTANQA0wDNAM8AzQDUAM4A1QCoAK0A1wDWAKoA2QCuANUA3ADaANkA3ADbANcA0QDQANYA1wDRANYA3QDcAMYA3QDSANwAxgDZANgAxgDcANkA2wDTANEAxADUAN0AbQBrAHAA", "g": [[0, 1320, "peel"]]}};
const PART_CACHE = {};
function partGeo(name) {
  if (PART_CACHE[name]) return PART_CACHE[name];
  const d = FOFO_PARTS[name];
  if (!d) return null;
  const bin = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  const p16 = new Int16Array(bin(d.p).buffer);
  const pos = new Float32Array(p16.length);
  for (let i = 0; i < p16.length; i++) pos[i] = p16[i] * d.s;
  const idx = new Uint16Array(bin(d.i).buffer);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.userData.zones = d.g.map((x) => x[2]);
  d.g.forEach(([start, count], k) => g.addGroup(start, count, k));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  PART_CACHE[name] = g;
  return g;
}
// mats: { zona: material } (zona que faltar usa a primeira)
function partMesh(name, mats, mirror = false) {
  const g = partGeo(name);
  if (!g) return null;
  const list = g.userData.zones.map((z) => mats[z] || Object.values(mats)[0]);
  const o = fmesh(g, list.length === 1 ? list[0] : list);
  if (mirror) o.scale.x = -1;
  return o;
}

// Barriga lisinha: em vez da região "belly" recortada nos triângulos do
// modelo (borda serrilhada, com um dente marrom entrando na barriga), o corpo
// inteiro usa um material só e um oval suave é pintado no shader. A cor vem
// de Z.belly (muda com a skin); skin sem barriga desliga o oval.
const BELLY_FIT = new WeakMap();
function smoothBelly(mesh, Z) {
  const g = mesh.geometry, zones = g.userData.zones || [];
  const zi = zones.indexOf('belly');
  if (zi < 0) return;
  let fit = BELLY_FIT.get(g);
  if (!fit) {
    const P = g.attributes.position, I = g.index;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity;
    for (const gr of g.groups) {
      if (gr.materialIndex !== zi) continue;
      for (let k = gr.start; k < gr.start + gr.count; k++) {
        const v = I ? I.getX(k) : k;
        const x = P.getX(v), y = P.getY(v), z = P.getZ(v);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z;
      }
    }
    if (!Number.isFinite(x0)) return;
    fit = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rx: ((x1 - x0) / 2) * 0.93, ry: ((y1 - y0) / 2) * 0.93, z0 };
    BELLY_FIT.set(g, fit);
  }
  mesh.material = Z.body;
  const mt = Z.body;
  mt.userData.bellyOn = mt.userData.bellyOn || { value: 1 };
  mt.onBeforeCompile = (sh) => {
    sh.uniforms.uBelly = { value: Z.belly.color };
    sh.uniforms.uBellyOn = mt.userData.bellyOn;
    sh.uniforms.uEll = { value: new THREE.Vector4(fit.cx, fit.cy, fit.rx, fit.ry) };
    sh.uniforms.uBZ = { value: fit.z0 };
    sh.vertexShader = 'varying vec3 vBP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vBP = position;');
    sh.fragmentShader = 'varying vec3 vBP;\nuniform vec3 uBelly;\nuniform float uBellyOn;\nuniform vec4 uEll;\nuniform float uBZ;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  { vec2 q = (vBP.xy - uEll.xy) / uEll.zw; float e = dot(q, q); float aa = fwidth(e) * 1.2 + 0.002;
    float inside = (1.0 - smoothstep(1.0 - aa, 1.0 + aa, e)) * smoothstep(uBZ - 0.04, uBZ + 0.02, vBP.z) * uBellyOn;
    diffuseColor.rgb = mix(diffuseColor.rgb, uBelly, inside); }`);
  };
  mt.customProgramCacheKey = () => 'fofo-belly-v1';
  mt.needsUpdate = true;
}

// Esfera com um buraco oval na frente (capuz das fantasias, deixa o rosto à mostra)
let HOOD_GEO = null;
function hoodGeo() {
  if (HOOD_GEO) return HOOD_GEO;
  const src = new THREE.SphereGeometry(0.405, 36, 24).toNonIndexed();
  const P = src.attributes.position, N = src.attributes.normal, U = src.attributes.uv;
  const pos = [], nor = [], uv = [];
  for (let i = 0; i < P.count; i += 3) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 3; k++) { cx += P.getX(i + k); cy += P.getY(i + k); cz += P.getZ(i + k); }
    const l = Math.hypot(cx, cy, cz) || 1;
    const nx = cx / l, ny = cy / l, nz = cz / l;
    if (nz > 0.15 && (nx / 0.7) ** 2 + ((ny + 0.12) / 0.78) ** 2 < 1) continue; // buraco do rosto
    for (let k = 0; k < 3; k++) {
      pos.push(P.getX(i + k), P.getY(i + k), P.getZ(i + k));
      nor.push(N.getX(i + k), N.getY(i + k), N.getZ(i + k));
      uv.push(U.getX(i + k), U.getY(i + k));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  HOOD_GEO = g;
  return g;
}
// ponto na borda do buraco do capuz (φ = 0 é o topo)
function hoodEdge(phi) {
  const nx = 0.7 * Math.sin(phi), ny = -0.12 + 0.78 * Math.cos(phi);
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  return new THREE.Vector3(nx * 0.405 * 1.08, 0.31 + ny * 0.405, nz * 0.405 * 1.04);
}
function hood(color, extra = {}) {
  const g = new THREE.Group();
  const m = color.isMaterial ? color : fmat(color, 0.85, { side: THREE.DoubleSide, ...extra });
  m.side = THREE.DoubleSide;
  const bh = partMesh('hood', { hood: m });
  g.userData.isHood = true;
  if (bh) { m.side = THREE.FrontSide; g.add(bh); g.userData.mat = m; return g; }
  const h = fmesh(hoodGeo(), m);
  h.position.y = 0.31;
  h.scale.set(1.08, 1, 1.04);
  // bordinha arredondada em volta do rosto
  const pts = [];
  for (let i = 0; i <= 40; i++) pts.push(hoodEdge(-Math.PI + (i / 40) * Math.PI * 2));
  const rim = fmesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 60, 0.022, 8, true), m);
  g.add(h, rim);
  g.userData.mat = m;
  return g;
}
function canvasMap(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
let TEX_F = null;
function fofoTex() {
  if (TEX_F) return TEX_F;
  TEX_F = {
    tiger: canvasMap(256, 256, (g, w, h) => {
      g.fillStyle = '#f28c28'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#2a1a12';
      for (let i = 0; i < 9; i++) { const x = (i / 9) * w; g.beginPath(); g.moveTo(x, 0); g.quadraticCurveTo(x + 18, h * 0.25, x + 4, h * 0.42); g.lineTo(x + 12, h * 0.42); g.quadraticCurveTo(x + 26, h * 0.2, x + 14, 0); g.fill(); }
    }),
    confetti: canvasMap(256, 256, (g, w, h) => {
      g.fillStyle = '#fbf7f2'; g.fillRect(0, 0, w, h);
      const cs = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#ec4899', '#8b5cf6'];
      let s = 7; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 70; i++) { g.fillStyle = cs[i % cs.length]; g.save(); g.translate(r() * w, r() * h); g.rotate(r() * 3); g.fillRect(-6, -2.5, 12, 5); g.restore(); }
    }),
    zombie: canvasMap(256, 256, (g, w, h) => {
      g.fillStyle = '#7d8c63'; g.fillRect(0, 0, w, h);
      let s = 3; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 14; i++) { g.fillStyle = i % 3 ? 'rgba(70,52,34,.55)' : 'rgba(40,46,30,.6)'; g.beginPath(); g.ellipse(r() * w, r() * h, 10 + r() * 22, 8 + r() * 16, r() * 3, 0, 7); g.fill(); }
      g.strokeStyle = 'rgba(30,26,20,.7)'; g.lineWidth = 2;
      for (let i = 0; i < 8; i++) { const x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 8, y + 6); g.lineTo(x + 2, y + 13); g.stroke(); }
    }),
    num10: canvasMap(256, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#fff'; g.font = '900 170px Inter, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('10', w / 2, h / 2 + 8);
    }),
    party: canvasMap(128, 256, (g, w, h) => {
      const cs = ['#ec4899', '#facc15', '#3b82f6', '#22c55e', '#f97316'];
      for (let i = 0; i < 12; i++) { g.fillStyle = cs[i % cs.length]; g.save(); g.translate(0, i * 26 - 20); g.rotate(-0.35); g.fillRect(-20, 0, w + 60, 13); g.restore(); }
    }),
  };
  return TEX_F;
}

// Partes que se repetem
function cone(r, h, material, seg = 12) { return fmesh(new THREE.ConeGeometry(r, h, seg), material); }
function star5(size, material, depth = 0.02) {
  const sh = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? size * 0.45 : size;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (i) sh.lineTo(x, y); else sh.moveTo(x, y);
  }
  return fmesh(new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 }), material);
}
function belt(m, color, buckle = '#d4a017', y = 0.08) {
  const g = new THREE.Group();
  const b = fmesh(new THREE.TorusGeometry(0.312, 0.034, 8, 40), fmat(color, 0.6));
  b.rotation.x = Math.PI / 2; b.position.y = y; b.scale.set(1, 0.96, 1); b.userData.belt = true;
  const k = fmesh(new THREE.BoxGeometry(0.1, 0.075, 0.03), fmat(buckle, 0.3, { metalness: 0.6 }));
  k.position.set(0, y, 0.305); k.userData.snapOut = 0.03;
  g.add(b, k);
  return g;
}
// espinhos ao longo do capuz e das costas (dinossauros)
function spikes(color, add) {
  const sm = fmat(color, 0.7);
  const hg = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const a = -0.25 + i * 0.42; // do alto da testa pra trás
    const c = partMesh('spike', { spike: sm }) || cone(0.06 - i * 0.004, 0.13, sm, 8);
    c.position.set(0, 0.31 + Math.cos(a) * 0.42, Math.sin(-a) * 0.42 + 0.02);
    c.rotation.x = -a;
    c.scale.setScalar(1.15 - i * 0.06);
    hg.add(c);
  }
  add('head', hg);
  const bg = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const c = partMesh('spike', { spike: sm }) || cone(0.05, 0.11, sm, 8);
    c.position.set(0, 0.46 - i * 0.12, -0.3 + i * 0.012);
    c.rotation.x = -Math.PI / 2 + 0.25;
    bg.add(c);
  }
  const tail = cone(0.12, 0.34, fmat(color === '#2d8a3e' ? '#3fa34d' : '#9b59b6', 0.8), 12);
  tail.position.set(0, -0.02, -0.38); tail.rotation.x = -Math.PI / 2 - 0.5;
  bg.add(tail);
  add('torso', bg);
}
function teeth(add) {
  const g = new THREE.Group();
  const tm = fmat('#ffffff', 0.4);
  for (let i = 0; i < 7; i++) {
    const p = hoodEdge(-0.75 + i * 0.25);
    const c = cone(0.025, 0.06, tm, 6);
    c.position.copy(p); c.position.y -= 0.025; c.rotation.x = Math.PI;
    g.add(c);
  }
  add('head', g);
}

// ---------- Catálogo de skins do mamaco novo ----------
const FOFO_SKINS = {};
function registerFofoSkin(id, def) { FOFO_SKINS[id] = { label: id, colors: {}, belly: true, ...def }; }

registerFofoSkin('base', { label: 'Sem roupa' });

registerFofoSkin('pirata', {
  label: 'Pirata', belly: false, coversHead: true,
  colors: { body: '#b8322a', arm: '#b8322a', fore: '#b8322a', leg: '#3a2418', foot: '#2a1c14' },
  shorts: '#3a2418',
  build(m, add) {
    const h = new THREE.Group();
    const hm = fmat('#1d1a1f', 0.7);
    let crown = partMesh('tricorn', { hat: hm, trim: fmat('#d9a93a', 0.4) }), brim = new THREE.Group();
    if (!crown) {
      crown = fmesh(new THREE.SphereGeometry(0.4, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), hm);
      crown.position.y = 0.43; crown.scale.set(1.04, 0.62, 1.0);
      brim = fmesh(new THREE.CylinderGeometry(0.56, 0.56, 0.04, 3), hm);
      brim.position.y = 0.46; brim.rotation.y = Math.PI; brim.scale.set(1, 1, 0.85);
    }
    const skull = fmesh(SPH(0.055, 12, 10), fmat('#f5f0e8', 0.5));
    skull.position.set(0, 0.58, 0.31); skull.scale.z = 0.4; skull.rotation.x = -0.4;
    for (const s of [-1, 1]) { const b = fmesh(new THREE.BoxGeometry(0.14, 0.022, 0.01), fmat('#f5f0e8', 0.5)); b.position.set(0, 0.575, 0.315); b.rotation.set(-0.4, 0, 0.7 * s); h.add(b); }
    // tapa-olho
    const patch = fmesh(SPH(0.07, 14, 10), fmat('#111', 0.5));
    patch.position.set(-0.105, 0.33, 0.385); patch.scale.set(1, 1.15, 0.35);
    const strap = fmesh(new THREE.TorusGeometry(0.4, 0.01, 6, 40), fmat('#111', 0.5));
    strap.position.set(0, 0.38, 0); strap.rotation.set(Math.PI / 2 + 0.12, 0, 0.32);
    h.add(crown, brim, skull, patch, strap);
    add('head', h);
    add('torso', belt(m, '#4a2c1a'));
    // colete escuro + botões dourados
    const t = new THREE.Group();
    const vest = fmesh(SPH(0.21, 20, 14), fmat('#1f1b20', 0.7));
    vest.position.set(0, 0.25, 0.235); vest.scale.set(0.55, 1.15, 0.36);
    t.add(vest);
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) { const b = fmesh(SPH(0.018, 8, 6), fmat('#e0b33a', 0.3, { metalness: 0.6 })); b.position.set(0.15 * s, 0.38 - i * 0.1, 0.27 - i * 0.004); t.add(b); }
    add('torso', t);
    for (const e of ['elbowL', 'elbowR']) { const c = fmesh(new THREE.TorusGeometry(0.088, 0.025, 6, 16), fmat('#e0b33a', 0.4)); c.rotation.x = Math.PI / 2; c.position.y = -0.11; add(e, c); }
  },
});

registerFofoSkin('astronauta', {
  label: 'Astronauta', belly: false,
  colors: { body: '#eef1f5', arm: '#eef1f5', fore: '#eef1f5', leg: '#eef1f5', hand: '#e9edf2', foot: '#e53935' },
  build(m, add) {
    const h = new THREE.Group();
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
    const bubble = new THREE.Mesh(SPH(0.5, 32, 20), glass);
    bubble.position.set(0, 0.31, 0.03);
    const ring = fmesh(new THREE.TorusGeometry(0.33, 0.06, 10, 36), fmat('#e8ecf2', 0.5));
    ring.rotation.x = Math.PI / 2; ring.position.y = -0.1;
    h.add(bubble, ring);
    for (const s of [-1, 1]) {
      const cup = fmesh(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 20), fmat('#5b7fb8', 0.45));
      cup.rotation.z = Math.PI / 2; cup.position.set(0.5 * s, 0.31, 0.02);
      const rim = fmesh(new THREE.TorusGeometry(0.1, 0.02, 6, 20), fmat('#e8ecf2', 0.5));
      rim.rotation.y = Math.PI / 2; rim.position.set(0.53 * s, 0.31, 0.02);
      h.add(cup, rim);
    }
    add('head', h);
    const t = new THREE.Group();
    const emb = fmesh(new THREE.CylinderGeometry(0.085, 0.085, 0.03, 24), fmat('#3b82f6', 0.4));
    emb.rotation.x = Math.PI / 2; emb.position.set(0, 0.3, 0.3);
    const embIn = fmesh(new THREE.CylinderGeometry(0.05, 0.05, 0.035, 20), fmat('#dbeafe', 0.3));
    embIn.rotation.x = Math.PI / 2; embIn.position.set(0, 0.3, 0.305);
    const pack = fmesh(new THREE.BoxGeometry(0.4, 0.42, 0.16), fmat('#dfe4ea', 0.5));
    pack.position.set(0, 0.28, -0.33);
    t.add(emb, embIn, pack, belt(m, '#9aa6b2', '#5b7fb8', 0.05));
    add('torso', t);
  },
});

function onesie({ label, color, belly, hoodColor, extras, mapKey, hideEars = true, foot }) {
  return {
    label, belly: true, coversHead: true, hideEars,
    colors: { body: color, arm: color, fore: color, leg: color, belly, foot: foot || FOFO_PEACH },
    mapKey,
    build(m, add) {
      const hm = fmat(hoodColor || color, 0.85, { side: THREE.DoubleSide });
      if (mapKey) { hm.map = fofoTex()[mapKey]; hm.color.set('#ffffff'); hm.map.repeat.set(3, 2); }
      add('head', hood(hm));
      extras?.(m, add);
    },
  };
}
registerFofoSkin('dinossauro', onesie({ label: 'Dinossauro', color: '#3fa34d', belly: '#e9dd7c', extras(m, add) { spikes('#2d8a3e', add); teeth(add); } }));
registerFofoSkin('dinoroxo', onesie({ label: 'Dino roxo', color: '#a463c9', belly: FOFO_PEACH, extras(m, add) { spikes('#2fb7a8', add); } }));

registerFofoSkin('ninja', {
  label: 'Ninja', belly: false,
  colors: { body: '#232026', arm: '#232026', fore: '#232026', leg: '#232026', foot: '#1a181c' },
  shorts: '#232026',
  build(m, add) {
    const h = new THREE.Group();
    const red = fmat('#d32f2f', 0.6);
    const band = fmesh(new THREE.TorusGeometry(0.345, 0.035, 8, 40), red);
    band.rotation.x = Math.PI / 2 - 0.12; band.position.set(0, 0.47, -0.01); band.scale.set(1.05, 1.02, 1);
    h.add(band);
    for (const s of [-1, 1]) { const tl = fmesh(CAP(0.025, 0.2), red); tl.position.set(0.06 * s, 0.38, -0.42); tl.rotation.set(0.5, 0, 0.35 * s); h.add(tl); }
    const mask = fmesh(SPH(0.215, 20, 14, ), fmat('#1d1a1f', 0.7));
    mask.position.set(0, 0.17, 0.262); mask.scale.set(1.36, 0.62, 0.8);
    h.add(mask);
    add('head', h);
    add('torso', belt(m, '#c62828', '#c62828'));
    const sash = fmesh(new THREE.BoxGeometry(0.06, 0.62, 0.02), fmat('#c62828', 0.6));
    sash.position.set(0, 0.28, 0.3); sash.rotation.z = 0.6;
    add('torso', sash);
  },
});

registerFofoSkin('heroi', {
  label: 'Super-herói', belly: false, coversHead: true, hideEars: true,
  colors: { body: '#2c5fd6', arm: '#2c5fd6', fore: '#2c5fd6', leg: '#2c5fd6', foot: '#c62828', hand: FOFO_HAND },
  shorts: '#c62828',
  build(m, add) {
    add('head', hood('#2c5fd6'));
    const t = new THREE.Group();
    const st = star5(0.1, fmat('#facc15', 0.35, { metalness: 0.2 }));
    st.position.set(0, 0.31, 0.28); st.rotation.x = -0.2;
    const capeM = fmat('#c62828', 0.7, { side: THREE.DoubleSide });
    let cape = partMesh('cape', { cape: capeM });
    if (cape) { cape.position.set(0, 0, 0); }
    else { cape = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 0.72, 20, 1, true, Math.PI / 2, Math.PI), capeM); cape.position.set(0, 0.12, -0.04); }
    cape.castShadow = true;
    t.add(st, cape, belt(m, '#facc15', '#c62828', 0.06));
    add('torso', t);
    m.cape = cape;
  },
});

registerFofoSkin('unicornio', onesie({
  label: 'Unicórnio', color: '#f7f4fa', belly: '#f9c6dd', extras(m, add) {
    const g = new THREE.Group();
    let horn = partMesh('horn', { horn: fmat('#f6c94b', 0.35, { metalness: 0.3 }) });
    if (horn) { horn.position.set(0, 0.62, 0.2); horn.rotation.x = 0.45; }
    else { horn = cone(0.055, 0.24, fmat('#f6c94b', 0.35, { metalness: 0.3 }), 14); horn.position.set(0, 0.74, 0.16); horn.rotation.x = 0.4; }
    g.add(horn);
    for (const s of [-1, 1]) {
      const e = cone(0.07, 0.15, fmat('#f7f4fa', 0.8), 10); e.position.set(0.25 * s, 0.66, 0.0); e.rotation.z = -0.5 * s;
      const ei = cone(0.04, 0.09, fmat('#f9a8c8', 0.8), 8); ei.position.set(0.25 * s, 0.665, 0.03); ei.rotation.z = -0.5 * s;
      g.add(e, ei);
    }
    ['#f472b6', '#a78bfa', '#60a5fa', '#fde047', '#f472b6'].forEach((c, i) => {
      const b = fmesh(SPH(0.075, 12, 10), fmat(c, 0.7));
      const a = 0.1 + i * 0.32;
      b.position.set(0, 0.31 + Math.cos(a) * 0.43, -Math.sin(a) * 0.43);
      g.add(b);
    });
    add('head', g);
  },
}));

registerFofoSkin('tigre', onesie({
  label: 'Tigre', color: '#f28c28', belly: '#f6e2c4', mapKey: 'tiger', extras(m, add) {
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      const re = partMesh('roundEar', { fur: fmat('#f28c28', 0.85), inner: fmat('#f6e2c4', 0.85) });
      if (re) { re.position.set(0.29 * s, 0.63, 0.0); re.rotation.set(-0.15, 0.35 * s, -0.5 * s); g.add(re); continue; }
      const e = fmesh(SPH(0.1, 14, 10), fmat('#f28c28', 0.85)); e.position.set(0.3 * s, 0.62, -0.02); e.scale.set(1, 1, 0.55);
      const ei = fmesh(SPH(0.06, 12, 8), fmat('#f6e2c4', 0.85)); ei.position.set(0.3 * s, 0.62, 0.025); ei.scale.set(1, 1, 0.3);
      g.add(e, ei);
    }
    add('head', g);
  },
}));

registerFofoSkin('coelho', onesie({
  label: 'Coelho', color: '#f6f5f7', belly: '#ffffff', extras(m, add) {
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      const be = partMesh('bunnyEar', { fur: fmat('#f6f5f7', 0.85), inner: fmat('#f9a8c8', 0.85) }, s < 0);
      if (be) { g.add(be); continue; }
      const e = fmesh(CAP(0.065, 0.32), fmat('#f6f5f7', 0.85)); e.position.set(0.14 * s, 0.86, -0.04); e.rotation.z = -0.18 * s; e.scale.z = 0.6;
      const ei = fmesh(CAP(0.035, 0.26), fmat('#f9a8c8', 0.85)); ei.position.set(0.14 * s, 0.86, 0.0); ei.rotation.z = -0.18 * s; ei.scale.z = 0.3;
      g.add(e, ei);
    }
    add('head', g);
  },
}));

registerFofoSkin('festa', {
  label: 'Festa', belly: false, coversHead: true,
  colors: { body: '#ffffff', arm: '#ffffff' },
  mapKey: 'confetti', mapZones: ['body', 'arm'],
  shorts: '#e53935',
  build(m, add) {
    const h = new THREE.Group();
    const pm = fmat('#ffffff', 0.6); pm.map = fofoTex().party;
    const hat = cone(0.14, 0.34, pm, 18);
    hat.position.set(0.07, 0.8, 0.0); hat.rotation.z = -0.22;
    const pom = fmesh(SPH(0.045, 10, 8), fmat('#facc15', 0.6)); pom.position.set(0.11, 0.97, 0);
    h.add(hat, pom);
    // óculos de sol azuis
    const fr = fmat('#1d4ed8', 0.35), lens = fmat('#0f172a', 0.15, { metalness: 0.4 });
    for (const s of [-1, 1]) {
      const r = fmesh(new THREE.TorusGeometry(0.075, 0.016, 8, 24), fr); r.position.set(0.11 * s, 0.33, 0.42); r.scale.set(1.15, 0.95, 1);
      const l = fmesh(new THREE.CircleGeometry(0.07, 20), lens); l.position.set(0.11 * s, 0.33, 0.415); l.scale.set(1.15, 0.95, 1);
      h.add(r, l);
    }
    const br = fmesh(new THREE.BoxGeometry(0.06, 0.016, 0.016), fr); br.position.set(0, 0.35, 0.43); h.add(br);
    add('head', h);
  },
});

registerFofoSkin('esportes', {
  label: 'Esportes', belly: false,
  colors: { body: '#2357c9', arm: '#2357c9', foot: '#f5f5f5' },
  shorts: '#1b3f94',
  build(m, add) {
    const h = new THREE.Group();
    const band = fmesh(new THREE.TorusGeometry(0.335, 0.035, 8, 40), fmat('#f5f5f5', 0.6));
    band.rotation.x = Math.PI / 2 - 0.1; band.position.set(0, 0.49, -0.01); band.scale.set(1.05, 1.02, 1);
    h.add(band);
    add('head', h);
    const t = new THREE.Group();
    const nm = new THREE.MeshStandardMaterial({ map: fofoTex().num10, transparent: true, roughness: 0.7 });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.26), nm); front.position.set(0, 0.26, 0.318); front.rotation.x = -0.1;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), nm); back.position.set(0, 0.28, -0.318); back.rotation.y = Math.PI;
    const stripe = fmesh(new THREE.TorusGeometry(0.2, 0.018, 6, 30), fmat('#f5f5f5', 0.6)); stripe.rotation.x = Math.PI / 2; stripe.position.y = 0.58;
    t.add(front, back, stripe);
    add('torso', t);
    for (const k of ['ankleL', 'ankleR']) { const sole = fmesh(SPH(0.103, 14, 8), fmat('#e53935', 0.6)); sole.scale.set(1.2, 0.2, 1.48); sole.position.set(0, -0.06, 0.05); add(k, sole); }
  },
});

registerFofoSkin('inverno', {
  label: 'Inverno', belly: false, coversHead: true,
  colors: { body: '#5fa8d3', arm: '#5fa8d3', fore: '#5fa8d3', leg: '#2d3e66', foot: '#5a3a24' },
  shorts: '#2d3e66',
  build(m, add) {
    const h = new THREE.Group();
    const bm = fmat('#5b3f9c', 0.9);
    const dome = fmesh(new THREE.SphereGeometry(0.41, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), bm);
    dome.position.y = 0.38; dome.scale.set(1.05, 0.95, 1.03);
    const cuff = fmesh(new THREE.TorusGeometry(0.405, 0.065, 10, 36), bm);
    cuff.rotation.x = Math.PI / 2; cuff.position.y = 0.42; cuff.scale.set(1.04, 1.02, 1);
    const pom = fmesh(SPH(0.08, 12, 10), fmat('#7c5cc4', 0.95)); pom.position.y = 0.78;
    h.add(dome, cuff, pom);
    add('head', h);
    const t = new THREE.Group();
    const sm = fmat('#4c3a8a', 0.9);
    const sc = fmesh(new THREE.TorusGeometry(0.22, 0.075, 10, 30), sm); sc.rotation.x = Math.PI / 2; sc.position.y = 0.6;
    const tail = fmesh(new THREE.BoxGeometry(0.1, 0.28, 0.05), sm); tail.position.set(0.12, 0.45, 0.27); tail.rotation.z = 0.15;
    t.add(sc, tail);
    for (let i = 0; i < 3; i++) { const b = fmesh(SPH(0.02, 8, 6), fmat('#f5f5f5', 0.5)); b.position.set(0, 0.36 - i * 0.11, 0.315 - i * 0.004); t.add(b); }
    add('torso', t);
  },
});

registerFofoSkin('banana', {
  label: 'Banana', belly: false, coversHead: true, hideEars: true,
  colors: { body: '#f7d23c', leg: FOFO_BROWN },
  build(m, add) {
    const y = fmat('#f7d23c', 0.75, { side: THREE.DoubleSide });
    const h = hood(y);
    let top = partMesh('bananaTop', { peel: y, stem: fmat('#5b3a1e', 0.8) }), tip = new THREE.Group();
    if (!top) { top = cone(0.2, 0.36, y, 18); top.position.set(0, 0.86, -0.04); top.rotation.x = -0.15; tip = fmesh(CAP(0.04, 0.06), fmat('#5b3a1e', 0.8)); tip.position.set(0, 1.06, -0.07); }
    h.add(top, tip);
    add('head', h);
    // cascas abertas caindo na cintura
    const t = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + 0.5;
      const p = partMesh('peel', { peel: y }) || fmesh(SPH(0.16, 14, 10), y);
      p.position.set(Math.sin(a) * 0.31, -0.08, Math.cos(a) * 0.31); p.rotation.y = a;
      t.add(p);
    }
    add('torso', t);
  },
});

registerFofoSkin('robo', {
  label: 'Robô', belly: false, coversHead: true, hideEars: true,
  colors: { body: '#9aa6b2', arm: '#9aa6b2', fore: '#8793a0', leg: '#8793a0', hand: '#b8c2cc', foot: '#6b7682' },
  metal: true,
  build(m, add) {
    const metal = fmat('#9aa6b2', 0.35, { metalness: 0.6, side: THREE.DoubleSide });
    const h = hood(metal);
    const ant = fmesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 6), fmat('#4b5563', 0.4, { metalness: 0.6 })); ant.position.set(0.08, 0.8, 0);
    const ball = fmesh(SPH(0.04, 10, 8), fmat('#ef4444', 0.3, { emissive: 0xef4444, emissiveIntensity: 0.6 })); ball.position.set(0.08, 0.92, 0);
    h.add(ant, ball);
    for (const s of [-1, 1]) {
      const bolt = fmesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 18), fmat('#6b7682', 0.35, { metalness: 0.7 }));
      bolt.rotation.z = Math.PI / 2; bolt.position.set(0.45 * s, 0.31, 0);
      h.add(bolt);
    }
    add('head', h);
    const t = new THREE.Group();
    const panel = fmesh(new THREE.BoxGeometry(0.26, 0.22, 0.05), fmat('#c4ccd4', 0.3, { metalness: 0.5 }));
    panel.position.set(0, 0.25, 0.29);
    const light = fmesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 20), fmat('#38bdf8', 0.2, { emissive: 0x38bdf8, emissiveIntensity: 0.9 }));
    light.rotation.x = Math.PI / 2; light.position.set(0, 0.27, 0.32);
    t.add(panel, light);
    for (let i = 0; i < 3; i++) { const r = fmesh(new THREE.TorusGeometry(0.31 - Math.abs(i - 1) * 0.02, 0.012, 6, 36), fmat('#6b7682', 0.4, { metalness: 0.6 })); r.rotation.x = Math.PI / 2; r.position.y = 0.05 + i * 0.2; t.add(r); }
    add('torso', t);
    m.robotLight = light;
  },
});

registerFofoSkin('mago', {
  label: 'Mago', belly: true, coversHead: true,
  colors: { body: '#3c3c9e', arm: '#3c3c9e', fore: '#3c3c9e', leg: '#3c3c9e' },
  build(m, add) {
    const h = new THREE.Group();
    const hm = fmat('#3b3b98', 0.85);
    let brim = partMesh('wizard', { hat: hm }), tall = new THREE.Group();
    if (!brim) {
      brim = fmesh(new THREE.CylinderGeometry(0.58, 0.6, 0.03, 32), hm); brim.position.y = 0.52;
      tall = cone(0.33, 0.62, hm, 24); tall.position.set(0, 0.84, -0.03); tall.rotation.x = -0.18;
    }
    const band = fmesh(new THREE.TorusGeometry(0.33, 0.025, 6, 30), fmat('#e0b33a', 0.4, { metalness: 0.4 })); band.rotation.x = Math.PI / 2; band.position.y = 0.56;
    h.add(brim, tall, band);
    for (const [x, yy, z] of [[0.15, 0.78, 0.2], [-0.1, 0.95, 0.12], [0.2, 0.6, 0.27]]) { const st = star5(0.04, fmat('#facc15', 0.4), 0.01); st.position.set(x, yy, z); h.add(st); }
    add('head', h);
    const t = new THREE.Group();
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.42, 0.3, 28, 1, true), fmat('#2f2f86', 0.85, { side: THREE.DoubleSide }));
    skirt.position.y = -0.1; skirt.castShadow = true;
    const trim = fmesh(new THREE.TorusGeometry(0.42, 0.02, 6, 36), fmat('#e0b33a', 0.4, { metalness: 0.4 })); trim.rotation.x = Math.PI / 2; trim.position.y = -0.25;
    const collar = fmesh(new THREE.TorusGeometry(0.22, 0.04, 8, 28), fmat('#e0b33a', 0.4, { metalness: 0.4 })); collar.rotation.x = Math.PI / 2; collar.position.y = 0.58;
    t.add(skirt, trim, collar);
    add('torso', t);
  },
});

registerFofoSkin('zumbi', {
  label: 'Zumbi', belly: false,
  colors: { skull: '#7f9460', ear: '#7f9460', face: '#b6c48f', earIn: '#9fb07a', body: '#ffffff', arm: '#7f9460', fore: '#7f9460', leg: '#3d5a8a', hand: '#b6c48f', foot: '#b6c48f' },
  mapKey: 'zombie', mapZones: ['body'],
  shorts: '#3d5a8a',
  build(m, add) {
    const g = new THREE.Group();
    const scar = fmat('#5b3a2a', 0.7);
    for (let i = 0; i < 3; i++) { const s = fmesh(new THREE.BoxGeometry(0.012, 0.05, 0.01), scar); s.position.set(0.2 + i * 0.03, 0.5, 0.29); g.add(s); }
    const line = fmesh(new THREE.BoxGeometry(0.11, 0.01, 0.01), scar); line.position.set(0.23, 0.5, 0.292); line.rotation.z = 0.2; g.add(line);
    add('head', g);
  },
});

// Segurança (porta das salas privadas) — não aparece na lista de skins
registerFofoSkin('seguranca', {
  label: 'Segurança', belly: false, hidden: true,
  colors: { body: '#1b1a20', arm: '#1b1a20', fore: '#1b1a20', leg: '#1b1a20', foot: '#111014' },
  shorts: '#1b1a20',
  build(m, add) {
    const t = new THREE.Group();
    const shirt = fmesh(SPH(0.16, 18, 12), fmat('#f5f3ef', 0.6)); shirt.scale.set(0.55, 1.25, 0.3); shirt.position.set(0, 0.4, 0.255);
    const tie = fmesh(new THREE.BoxGeometry(0.05, 0.22, 0.02), fmat('#111014', 0.5)); tie.position.set(0, 0.36, 0.3); tie.rotation.x = -0.25;
    const earpiece = fmesh(new THREE.TorusGeometry(0.05, 0.008, 6, 12, Math.PI * 1.2), fmat('#222', 0.4));
    earpiece.position.set(-0.45, 0.31, 0.03);
    t.add(shirt, tie);
    add('torso', t);
    add('head', earpiece);
  },
});

// Acessórios extras (servem pros dois estilos)
HATS.coroa = (m) => {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xf5c518, roughness: 0.3, metalness: 0.7 });
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.24, 0.12, 24, 1, true), gold);
  ring.material.side = THREE.DoubleSide;
  ring.position.y = 0.72;
  g.add(ring);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 6), gold);
    c.position.set(Math.sin(a) * 0.25, 0.83, Math.cos(a) * 0.25);
    const gem = new THREE.Mesh(SPH(0.025, 8, 6), new THREE.MeshStandardMaterial({ color: [0xef4444, 0x3b82f6, 0x22c55e][i % 3], roughness: 0.2, metalness: 0.2 }));
    gem.position.set(Math.sin(a) * 0.255, 0.72, Math.cos(a) * 0.255);
    g.add(c, gem);
  }
  return g;
};
HATS.chapeu = (m) => {
  const g = new THREE.Group();
  const hm = new THREE.MeshStandardMaterial({ color: 0x7a4a2b, roughness: 0.8 });
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.03, 32), hm); brim.position.y = 0.55; brim.scale.z = 0.9;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.33, 0.24, 28), hm); crown.position.y = 0.68;
  const dent = new THREE.Mesh(SPH(0.28, 20, 10), hm); dent.position.y = 0.76; dent.scale.set(1, 0.3, 0.95);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.335, 0.335, 0.05, 28, 1, true), new THREE.MeshStandardMaterial({ color: 0x3b2314, roughness: 0.6, side: THREE.DoubleSide })); band.position.y = 0.6;
  for (const o of [brim, crown, dent, band]) { o.castShadow = true; g.add(o); }
  return g;
};
Object.assign(HAT_LABELS, { coroa: 'Coroa', chapeu: 'Chapéu' });

// Nas costas / pescoço
const BACKWEAR = {
  mochila(m) {
    const g = new THREE.Group();
    const bm = new THREE.MeshStandardMaterial({ color: 0x2f6fd6, roughness: 0.7 });
    const bag = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.46, 0.2, 3, 0.07), bm);
    bag.position.set(0, m.backY, m.backZ - 0.08);
    const pocket = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.18, 0.06, 2, 0.04), new THREE.MeshStandardMaterial({ color: 0x2559b0, roughness: 0.7 }));
    pocket.position.set(0, m.backY - 0.1, m.backZ - 0.2);
    g.add(bag, pocket);
    for (const s of [-1, 1]) { const st = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 6, 20, Math.PI), bm); st.rotation.set(0, Math.PI / 2, Math.PI / 2); st.position.set(0.15 * s, m.backY + 0.05, 0.0); st.scale.set(1, 1.6, 1); g.add(st); }
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  },
  asas(m) {
    const g = new THREE.Group();
    const wm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide });
    m.wings = [];
    for (const s of [-1, 1]) {
      const piv = new THREE.Group();
      piv.position.set(0.08 * s, m.backY + 0.08, m.backZ - 0.02);
      for (let i = 0; i < 4; i++) {
        const f = new THREE.Mesh(SPH(0.16 - i * 0.02, 12, 8), wm);
        f.scale.set(1.5, 0.45, 0.12);
        f.position.set(s * (0.16 + i * 0.07), 0.06 - i * 0.07, -0.02);
        f.rotation.z = s * (0.4 + i * 0.12);
        f.castShadow = true;
        piv.add(f);
      }
      piv.userData.side = s;
      m.wings.push(piv);
      g.add(piv);
    }
    return g;
  },
  cachecol(m) {
    const g = new THREE.Group();
    const sm = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.9 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(m.fofo ? 0.22 : 0.19, 0.07, 10, 30), sm);
    ring.rotation.x = Math.PI / 2; ring.position.y = m.neck.position.y - 0.02;
    const tail = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.3, 0.05, 2, 0.02), sm);
    tail.position.set(0.1, m.neck.position.y - 0.17, m.fofo ? 0.26 : 0.22); tail.rotation.z = 0.12;
    for (const o of [ring, tail]) { o.castShadow = true; g.add(o); }
    return g;
  },
};
const BACK_LABELS = { mochila: 'Mochila', asas: 'Asas', cachecol: 'Cachecol' };

// ---------- Monta o mamaco novo em cima do esqueleto do clássico ----------
function buildFofo(m) {
  m.fofo = true;
  m.backY = 0.3; m.backZ = -0.3;
  m.landT = 0;
  m.land = () => { m.landT = 0.16; };
  m.anticipate = () => {};
  const keep = new Set();
  for (const g of [m.headset, m.tuft, m.mug]) g.traverse((o) => keep.add(o));
  m.rig.traverse((o) => { if (o.isMesh && !keep.has(o)) o.visible = false; });

  const Z = (m.fz = {
    skull: fmat(FOFO_BROWN), ear: fmat(FOFO_BROWN), earIn: fmat(FOFO_EAR_IN), face: fmat(FOFO_PEACH, 0.75),
    body: fmat(FOFO_BROWN), belly: fmat(FOFO_PEACH, 0.78), arm: fmat(FOFO_BROWN), fore: fmat(FOFO_BROWN),
    hand: fmat(FOFO_HAND, 0.75), leg: fmat(FOFO_BROWN), foot: fmat(FOFO_HAND, 0.75), shorts: fmat('#333', 0.8),
  });
  m.furColor = FOFO_BROWN;
  m.setFur = (c) => { m.furColor = c; setFofoSkin(m, m.state.outfit); };
  m.setTop = (c) => { m.top.color.set(c); };

  // proporções: baixinho, cabeção
  m.H = 0.3; m.hips.position.y = 0.3;
  m.sitLift = 0.15; m.lieY = 0.38; m.stepScale = 0.62; m.armSpread = 0.3; m.waddle = 1.8;
  // topete: três cachinhos arredondados (como na ficha)
  for (const t of m.tuft.children) t.visible = false;
  [[-0.06, 0.5], [0, 0], [0.06, -0.5]].forEach(([x, rz], i) => {
    const c = fmesh(CAP(0.032, 0.05), Z.skull);
    c.position.set(x, 0.035 + (i === 1 ? 0.012 : 0), 0); c.rotation.z = rz;
    m.tuft.add(c);
  });

  // pernas
  m.legs.forEach((l, i) => {
    const side = i === 0 ? -1 : 1;
    l.hip.position.set(0.13 * side, 0, 0);
    l.knee.position.y = -0.1;
    l.ankle.position.y = -0.13;
    const th = fmesh(CAP(0.1, 0.03), Z.leg); th.position.y = -0.05; l.hip.add(th);
    const sh = fmesh(CAP(0.095, 0.02), Z.leg); sh.position.y = -0.06; l.knee.add(sh);
    const foot = partMesh('foot', { foot: Z.foot }, side < 0);
    if (foot) l.ankle.add(foot);
    else {
      const f = fmesh(SPH(0.1, 18, 12), Z.foot); f.scale.set(1.2, 0.55, 1.45); f.position.set(0, -0.025, 0.05); l.ankle.add(f);
      for (const x of [-0.05, 0, 0.05]) { const t = fmesh(SPH(0.036, 10, 8), Z.foot); t.position.set(x, -0.035, 0.17); t.scale.set(1, 0.85, 1); l.ankle.add(t); }
    }
    l.fofoThigh = th; l.fofoShin = sh;
  });

  // corpo em pera + barriga (num grupo, pra "respirar")
  const bodyG = new THREE.Group();
  bodyG.position.y = 0.25;
  // corpo + barriga fundidos (Blender); a barriga muda de cor com a skin
  let body = partMesh('body', { body: Z.body, belly: Z.belly });
  let belly = new THREE.Group();
  if (!body) {
    body = fmesh(SPH(0.33, 30, 22), Z.body); body.scale.set(1, 1.12, 1.045);
    belly = fmesh(SPH(0.25, 24, 16), Z.belly); belly.scale.set(0.8, 0.98, 0.42); belly.position.set(0, -0.05, 0.262);
  }
  else smoothBelly(body, Z);
  const shorts = fmesh(new THREE.SphereGeometry(0.334, 30, 12, 0, Math.PI * 2, Math.PI * 0.64, Math.PI * 0.36), Z.shorts);
  shorts.scale.set(1.01, 1.13, 1.055); shorts.visible = false;
  bodyG.add(body, belly, shorts);
  m.torso.add(bodyG);
  m.body = bodyG; m.fofoBelly = belly; m.fofoShorts = shorts; m.fofoBodyMesh = body;

  // braços curtinhos com mão de luva (3 dedos + polegar)
  m.arms.forEach((a, i) => {
    const side = i === 0 ? -1 : 1;
    a.shoulder.position.set(0.29 * side, 0.44, 0);
    a.elbow.position.y = -0.16;
    const up = fmesh(CAP(0.092, 0.07), Z.arm); up.position.y = -0.085; a.shoulder.add(up);
    const fo = fmesh(CAP(0.088, 0.05), Z.fore); fo.position.y = -0.07; a.elbow.add(fo);
    const hand = new THREE.Group(); hand.position.y = -0.19;
    const bh = partMesh('hand', { hand: Z.hand }, side < 0);
    if (bh) hand.add(bh);
    else {
      const palm = fmesh(SPH(0.085, 16, 12), Z.hand); palm.scale.set(1.05, 1, 0.8);
      hand.add(palm);
      for (const x of [-0.045, 0, 0.045]) { const f = fmesh(SPH(0.034, 10, 8), Z.hand); f.position.set(x, -0.07, 0.005); hand.add(f); }
      const th = fmesh(SPH(0.036, 10, 8), Z.hand); th.position.set(-0.04 * side, -0.01, 0.06); hand.add(th);
    }
    a.elbow.add(hand);
  });
  m.mug.position.set(0, -0.22, 0.08);

  // cabeça: mesmo "quadro" do clássico (chapéus/óculos/fone servem), só maior
  m.neck.position.y = 0.62;
  m.head.scale.setScalar(1.22);
  // cabeça com o rosto "coração" fundido (Blender)
  const bhead = partMesh('head', { skull: Z.skull, face: Z.face });
  if (bhead) m.head.add(bhead);
  else {
    const skull = fmesh(SPH(0.37, 32, 24), Z.skull); skull.position.y = 0.31; skull.scale.set(1.05, 0.97, 1.0);
    m.head.add(skull);
    for (const s of [-1, 1]) {
      const lobe = fmesh(SPH(0.165, 22, 16), Z.face); lobe.position.set(0.1 * s, 0.355, 0.235); lobe.scale.set(1, 1.12, 0.72);
      m.head.add(lobe);
    }
    const muzzle = fmesh(SPH(0.2, 24, 16), Z.face); muzzle.position.set(0, 0.215, 0.245); muzzle.scale.set(1.32, 0.86, 0.72);
    m.head.add(muzzle);
  }
  const eyeM = new THREE.MeshStandardMaterial({ color: 0x14100f, roughness: 0.12, metalness: 0.1 });
  m.eyes.forEach((e, i) => {
    const s = i === 0 ? -1 : 1;
    e.position.set(0.1 * s, 0.335, 0.362);
    const ball = fmesh(SPH(0.05, 16, 12), eyeM, false); ball.scale.set(0.8, 1.45, 0.45);
    const spark = new THREE.Mesh(SPH(0.011, 8, 6), m.white); spark.position.set(0.012, 0.035, 0.022);
    e.add(ball); e.userData.pupil.add(spark);
  });
  // boca: só aparece falando / bocejando / surpreso; sorriso no "feliz"
  // boca de verdade: interior escuro + língua (abre falando, bebendo, bocejando)
  const mouth = new THREE.Group(); mouth.position.set(0, 0.186, 0.392); mouth.scale.set(1, 0.15, 0.5); mouth.visible = false;
  const inside = fmesh(SPH(0.055, 18, 12), fmat('#3a1416', 0.6), false);
  const tongue = fmesh(SPH(0.034, 14, 10), fmat('#e8707e', 0.6), false); tongue.position.set(0, -0.026, 0.022); tongue.scale.set(1.2, 0.7, 0.8);
  const teethTop = fmesh(new THREE.BoxGeometry(0.05, 0.012, 0.01), fmat('#fffaf2', 0.4), false); teethTop.position.set(0, 0.044, 0.04);
  mouth.add(inside, tongue, teethTop);
  mouth.userData.tongue = tongue; mouth.userData.teeth = teethTop;
  const smile = fmesh(new THREE.TorusGeometry(0.05, 0.012, 6, 16, Math.PI), m.dark, false); smile.rotation.set(-0.3, 0, Math.PI); smile.position.set(0, 0.2, 0.398); smile.visible = false;
  m.head.add(mouth, smile);
  m.mouth = mouth; m.smile = smile;
  // olhos fechados: "◡ ◡" dormindo/piscando, "^ ^" feliz; bochecha rosada
  const arcs = (down) => {
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      const a = fmesh(new THREE.TorusGeometry(0.042, 0.011, 6, 14, Math.PI), m.dark, false);
      a.position.set(0.105 * s, 0.33 + (down ? 0.01 : -0.02), 0.398);
      a.rotation.set(-0.15, 0, down ? Math.PI : 0);
      g.add(a);
    }
    g.visible = false;
    m.head.add(g);
    return g;
  };
  m.faceArcs = { closed: arcs(true), happy: arcs(false) };
  // sobrancelhas (expressão) e boquinha reta
  m.brows2 = [-1, 1].map((s) => {
    const b = fmesh(CAP(0.012, 0.05), m.dark, false);
    b.rotation.z = Math.PI / 2; b.position.set(0.105 * s, 0.45, 0.375);
    m.head.add(b);
    return b;
  });
  m.flatMouth = fmesh(CAP(0.008, 0.045), m.dark, false);
  m.flatMouth.rotation.z = Math.PI / 2; m.flatMouth.position.set(0, 0.19, 0.4); m.flatMouth.visible = false;
  m.head.add(m.flatMouth);
  const blushM = new THREE.MeshBasicMaterial({ color: 0xf28b8b, transparent: true, opacity: 0.55, depthWrite: false });
  m.blush = new THREE.Group();
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.CircleGeometry(0.045, 16), blushM);
    b.position.set(0.2 * s, 0.245, 0.358); b.rotation.y = 0.5 * s; b.scale.y = 0.6;
    m.blush.add(b);
  }
  m.blush.visible = false;
  m.head.add(m.blush);
  // orelhonas
  m.ears.forEach((e, i) => {
    const s = i === 0 ? -1 : 1;
    e.position.set(0.39 * s, 0.31, 0.0);
    const be = partMesh('ear', { ear: Z.ear, earIn: Z.earIn }, s < 0);
    if (be) e.add(be);
    else {
      const out = fmesh(SPH(0.135, 18, 14), Z.ear); out.scale.set(0.42, 1, 0.95);
      const inn = fmesh(SPH(0.09, 14, 10), Z.earIn, false); inn.scale.set(0.3, 1, 0.9); inn.position.set(0.03 * s, 0, 0.01);
      e.add(out, inn);
    }
  });
  m.fofoParts = {};
}

// Enfeites pequenos do peito (estrela, botões, emblema, painel…) ficam
// "colados" na superfície do corpo: acha a pele com um raio, encosta a
// peça nela e prende no grupo que respira. Antes ficavam presos no tronco e
// o corpo (que respira e é mais gordinho que o desenho) engolia metade delas.
const _ray = new THREE.Raycaster(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _box = new THREE.Box3();
function snapToBody(m, obj, layer) {
  const body = m.fofoBodyMesh;
  if (!body) return;
  m.root.updateMatrixWorld(true);
  const small = [], belts = [];
  obj.traverse((o) => {
    if (!o.isMesh || o.userData.noSnap) return;
    if (o.userData.belt) { belts.push(o); return; }
    _box.setFromObject(o);
    const size = _box.getSize(_v1);
    if (Math.max(size.x, size.y, size.z) > 0.24) return; // capa, mochila, cinto: ficam como estão
    small.push(o);
  });
  const center = new THREE.Vector3(), axis = new THREE.Vector3(), dir = new THREE.Vector3();
  // cinto: abraça o corpo na altura dele (raio medido nos 4 lados)
  const radius = (yLocal, x, z) => {
    const o = m.body.localToWorld(new THREE.Vector3(0, yLocal, 0));
    const d = new THREE.Vector3(x, 0, z).transformDirection(m.body.matrixWorld);
    _ray.set(o.clone().addScaledVector(d, 2), d.clone().negate());
    const h = _ray.intersectObject(body, false)[0];
    return h ? h.point.distanceTo(o) / m.body.scale.x : null;
  };
  for (const b of belts) {
    const wp = b.getWorldPosition(new THREE.Vector3());
    const yl = m.body.worldToLocal(wp.clone()).y;
    const rx = Math.max(radius(yl, 1, 0) || 0.31, radius(yl, -1, 0) || 0.31);
    const rf = radius(yl, 0, 1) || 0.31, rb = radius(yl, 0, -1) || 0.31;
    b.updateMatrixWorld(true);
    layer.attach(b);
    const sc = m.body.scale;
    b.scale.set((rx + 0.012) / 0.312, ((rf + rb) / 2 + 0.012) / 0.312 * (sc.x / sc.z), 1);
    b.position.z = ((rf - rb) / 2) * (sc.x / sc.z);
  }
  for (const o of small) {
    _box.setFromObject(o);
    _box.getCenter(center);
    // eixo do corpo na altura da peça
    axis.set(0, 0, 0); m.body.localToWorld(axis);
    const up = _v2.set(0, 1, 0).transformDirection(m.body.matrixWorld);
    axis.addScaledVector(up, center.clone().sub(axis).dot(up));
    dir.copy(center).sub(axis);
    if (dir.lengthSq() < 1e-6) continue;
    dir.normalize();
    _ray.set(axis.clone().addScaledVector(dir, 2), dir.clone().negate());
    const hit = _ray.intersectObject(body, false)[0];
    if (!hit) continue;
    const surf = hit.point.clone().sub(axis).dot(dir);
    // ponto da peça mais pra dentro (ao longo do raio)
    let minP = Infinity;
    for (const x of [_box.min.x, _box.max.x]) for (const y of [_box.min.y, _box.max.y]) for (const z of [_box.min.z, _box.max.z]) minP = Math.min(minP, _v1.set(x, y, z).sub(axis).dot(dir));
    const shift = surf - 0.012 + (o.userData.snapOut || 0) - minP;
    if (shift > 0) {
      const wp = o.getWorldPosition(_v1).addScaledVector(dir, shift);
      o.parent.worldToLocal(wp); o.position.copy(wp);
    }
    o.updateMatrixWorld(true);
    layer.attach(o);
  }
}
function setFofoSkin(m, id) {
  const skin = FOFO_SKINS[id] || FOFO_SKINS.base;
  const prev = m.state.outfit;
  m.state.outfit = FOFO_SKINS[id] ? id : 'base';
  for (const k in m.fofoParts) for (const o of m.fofoParts[k]) o.visible = k === m.state.outfit;
  if (!m.fofoParts[m.state.outfit]) {
    const list = (m.fofoParts[m.state.outfit] = []);
    const T = {
      head: m.head, torso: m.torso, pelvis: m.pelvis,
      shoulderL: m.arms[1].shoulder, shoulderR: m.arms[0].shoulder, elbowL: m.arms[1].elbow, elbowR: m.arms[0].elbow,
      kneeL: m.legs[1].knee, kneeR: m.legs[0].knee, ankleL: m.legs[1].ankle, ankleR: m.legs[0].ankle,
    };
    m.cape = null; m.robotLight = null;
    const layer = new THREE.Group(); m.body.add(layer); list.push(layer);
    skin.build?.(m, (target, obj) => {
      obj.traverse?.((o) => { if (o.isMesh && o.castShadow === undefined) o.castShadow = true; });
      T[target].add(obj); list.push(obj);
      if (target === 'torso') snapToBody(m, obj, layer);
    });
    m.fofoParts[m.state.outfit].cape = m.cape; m.fofoParts[m.state.outfit].robotLight = m.robotLight;
    for (const o of list) o.traverse?.((x) => { if (x.userData?.isHood) list.hoodMat = x.userData.mat; });
  }
  m.cape = m.fofoParts[m.state.outfit].cape || null;
  // cores por região
  const base = { skull: m.furColor, ear: m.furColor, earIn: FOFO_EAR_IN, face: FOFO_PEACH, body: m.furColor, belly: FOFO_PEACH, arm: m.furColor, fore: m.furColor, hand: FOFO_HAND, leg: m.furColor, foot: FOFO_HAND };
  const Z = m.fz;
  for (const k in base) {
    const mt = Z[k];
    mt.color.set(skin.colors[k] || base[k]);
    mt.map = null; mt.metalness = 0; mt.roughness = k === 'face' || k === 'hand' || k === 'foot' ? 0.75 : 0.82;
    mt.needsUpdate = true;
  }
  if (skin.metal) for (const k of ['body', 'arm', 'fore', 'leg', 'hand', 'foot']) Z[k].color.offsetHSL(0, -0.04, 0.06);
  // capuz: o pelo da cabeça por baixo fica da cor do capuz (se encostar nele
  // num movimento, não aparecem pintinhas marrons atravessando o tecido)
  const hm = m.fofoParts[m.state.outfit].hoodMat;
  if (hm) for (const k of ['skull', 'ear']) { Z[k].color.copy(hm.color); Z[k].map = hm.map || null; Z[k].needsUpdate = true; }
  if (skin.mapKey) {
    const tex = fofoTex()[skin.mapKey];
    for (const k of skin.mapZones || ['body', 'arm', 'fore', 'leg']) { Z[k].map = tex; Z[k].color.set('#ffffff'); Z[k].needsUpdate = true; }
  }
  m.fofoBelly.visible = skin.belly !== false;
  if (skin.belly === false) Z.belly.color.copy(Z.body.color), Z.belly.map = Z.body.map;
  if (Z.body.userData.bellyOn) Z.body.userData.bellyOn.value = skin.belly === false ? 0 : 1;
  m.fofoShorts.visible = !!skin.shorts;
  if (skin.shorts) Z.shorts.color.set(skin.shorts);
  for (const e of m.ears) e.visible = !skin.hideEars;
  m.coversHead = !!skin.coversHead;
  m.top.color.set(skin.colors.body || m.furColor); // cor do "chip" com o nome
  if (prev !== m.state.outfit) m.applyAccessories();
}

// Expressões: piscadinha feliz ao acenar, "o" de susto no pulo
function fofoFace(m, dt, air, talking) {
  if (m.waveT > 0) { m.expr = 'feliz'; m.exprT = 0.4; }
  else if (air) { m.expr = 'surpreso'; m.exprT = 0.35; }
  else if (m.exprT > 0) m.exprT -= dt;
  else m.expr = 'normal';
  if (m.expr === 'feliz') m.eyes[1].scale.y = Math.min(m.eyes[1].scale.y, 0.16);
  if (m.expr === 'surpreso' && !talking) { m.mouth.visible = true; m.mouth.scale.set(0.6, 0.62, 0.5); }
  else m.mouth.scale.set(1, m.mouth.scale.y, 0.5);
  m.smile.visible = m.expr === 'feliz' && !talking;
  // capa balança, luz do robô pisca, asas batem
  const t = performance.now() / 1000;
  if (m.cape) m.cape.rotation.x = -0.12 - Math.min(0.5, m.gaitW * 0.35 + m.runW * 0.3) + Math.sin(t * 3) * 0.03;
}

// =====================================================================
// ANIMAÇÃO ESTILO RPG (quadro a quadro)
// Cada animação é uma sequência de POSES desenhadas; o boneco troca de
// pose em "quadros" (8–24 por segundo), como sprite de RPG. Nada de mola
// nem física mole: pose limpa, contorno nítido. Troca de animação passa
// por 2 quadros intermediários (fica suave sem ficar "pastoso").
// =====================================================================
const RPG_STAND = {
  hipsX: 0, hipsY: 0.3, pelvisYaw: 0, pelvisRoll: 0,
  thighL: 0, thighR: 0, hipZL: 0.04, hipZR: -0.04, kneeL: 0.04, kneeR: 0.04, ankleL: -0.04, ankleR: -0.04,
  lean: 0, torsoYaw: 0, torsoRoll: 0, breathe: 0,
  shL: 0.05, shR: 0.05, shZL: 0.1, shZR: -0.1, elL: -0.2, elR: -0.2, elZR: 0,
  headPitch: 0, headYaw: 0, headRoll: 0, earWig: 0,
  lie: 0, lieRoll: 0,
};
const lerpPose = (a, b, k) => { const o = {}; for (const key in RPG_STAND) o[key] = a[key] + (b[key] - a[key]) * k; return o; };
const pose = (over) => ({ ...RPG_STAND, ...over });

// Marcha paramétrica amostrada em quadros (8 por ciclo = 2 passos)
function gaitPose(i, n, run) {
  const ph = (i / n) * Math.PI * 2;
  const s = Math.sin(ph), c = Math.cos(ph);
  const A = run ? 0.95 : 0.62;
  const leg = (sp, cp) => {
    const thigh = -A * sp - (run ? 0.12 : 0);
    const swing = Math.max(0, cp);           // perna indo pra frente
    const knee = 0.08 + swing * (run ? 1.55 : 0.95) + (run ? 0.25 : 0.05);
    const ankle = -(thigh + knee) * 0.75 + (sp < 0 ? 0.25 * -sp : 0);
    return { thigh, knee, ankle };
  };
  const L = leg(s, c), R = leg(-s, -c);
  const bob = run ? 0.055 * Math.abs(Math.sin(ph * 1)) : 0.03 * Math.abs(c);
  const armA = run ? 1.0 : 0.55;
  return pose({
    hipsY: (run ? 0.27 : 0.285) + bob,
    hipsX: (run ? 0.01 : 0.025) * s,
    pelvisRoll: (run ? 0.05 : 0.09) * s, pelvisYaw: 0.12 * s,
    thighL: L.thigh, kneeL: L.knee, ankleL: L.ankle,
    thighR: R.thigh, kneeR: R.knee, ankleR: R.ankle,
    lean: run ? 0.28 : 0.08, torsoYaw: -0.14 * s, torsoRoll: -(run ? 0.03 : 0.06) * s,
    shL: armA * s - (run ? 0.25 : 0), shR: -armA * s - (run ? 0.25 : 0), shZL: 0.12, shZR: -0.12,
    elL: -(run ? 1.25 : 0.35) - 0.3 * Math.max(0, -s), elR: -(run ? 1.25 : 0.35) - 0.3 * Math.max(0, s),
    headPitch: run ? -0.12 : -0.03, headRoll: -0.04 * s, earWig: 0.4 * c,
  });
}
const CLIPS = {
  idle: { fps: 4, loop: true, frames: [0, 1, 2, 2, 1, 0, 0, 0].map((k, i) => pose({
    breathe: k * 0.016, hipsY: 0.3 - k * 0.004, shL: 0.05 + k * 0.025, shR: 0.05 + k * 0.025, elL: -0.2 - k * 0.04, elR: -0.2 - k * 0.04,
    headPitch: -k * 0.015, hipsX: i < 4 ? 0.006 : -0.006, pelvisRoll: i < 4 ? 0.02 : -0.02, torsoRoll: i < 4 ? -0.015 : 0.015, earWig: k === 2 ? 0.4 : 0,
  })) },
  walk: { fps: 12, loop: true, frames: Array.from({ length: 8 }, (_, i) => gaitPose(i, 8, false)) },
  run: { fps: 16, loop: true, frames: Array.from({ length: 8 }, (_, i) => gaitPose(i, 8, true)) },
  // pulo: braços pra cima (estilo jogo de festa), pernas encolhidas
  crouch: { fps: 14, loop: false, frames: [pose({ hipsY: 0.24, thighL: -0.6, thighR: -0.6, kneeL: 1.1, kneeR: 1.1, ankleL: -0.5, ankleR: -0.5, lean: 0.25, shL: 0.5, shR: 0.5, elL: -0.5, elR: -0.5 })] },
  air: { fps: 8, loop: true, frames: [
    pose({ hipsY: 0.32, thighL: -0.7, thighR: -0.35, kneeL: 1.2, kneeR: 0.7, ankleL: 0.3, ankleR: 0.2, shL: -2.5, shR: -2.5, shZL: 0.55, shZR: -0.55, elL: -0.25, elR: -0.25, headPitch: -0.15, earWig: 1 }),
    pose({ hipsY: 0.32, thighL: -0.4, thighR: -0.7, kneeL: 0.75, kneeR: 1.2, ankleL: 0.2, ankleR: 0.3, shL: -2.65, shR: -2.65, shZL: 0.65, shZR: -0.65, elL: -0.15, elR: -0.15, headPitch: -0.15, earWig: -1 }),
  ] },
  land: { fps: 14, loop: false, frames: [
    pose({ hipsY: 0.22, thighL: -0.75, thighR: -0.75, kneeL: 1.35, kneeR: 1.35, ankleL: -0.6, ankleR: -0.6, lean: 0.3, shL: -0.6, shR: -0.6, shZL: 0.5, shZR: -0.5, elL: -0.4, elR: -0.4 }),
    pose({ hipsY: 0.27, thighL: -0.3, thighR: -0.3, kneeL: 0.55, kneeR: 0.55, ankleL: -0.25, ankleR: -0.25, lean: 0.1, shL: -0.2, shR: -0.2, shZL: 0.25, shZR: -0.25 }),
  ] },
  // sentado: pés balançando (perninha curta não alcança o chão)
  sit: { fps: 3, loop: true, frames: [0, 1, 2, 1].map((k) => pose({
    hipsY: 0, thighL: -1.5, thighR: -1.5, kneeL: 1.25 + (k === 0 ? 0.3 : k === 2 ? -0.1 : 0.1), kneeR: 1.25 + (k === 2 ? 0.3 : k === 0 ? -0.1 : 0.1), ankleL: 0.15, ankleR: 0.15,
    hipZL: 0.12, hipZR: -0.12, shL: -0.55, shR: -0.55, shZL: 0.16, shZR: -0.16, elL: -0.55, elR: -0.55, breathe: k * 0.012, lean: -0.04,
  })) },
  type: { fps: 8, loop: true, frames: [0, 1, 2, 3].map((k) => pose({
    hipsY: 0, thighL: -1.5, thighR: -1.5, kneeL: 1.35, kneeR: 1.35, ankleL: 0.1, ankleR: 0.1, hipZL: 0.1, hipZR: -0.1,
    shL: -1.1 + (k === 0 ? 0.12 : 0), shR: -1.1 + (k === 2 ? 0.12 : 0), shZL: 0.0, shZR: 0.0, elL: -0.75, elR: -0.75,
    lean: 0.12, headPitch: 0.2 + (k % 2) * 0.02,
  })) },
  slouch: { fps: 2, loop: true, frames: [0, 1].map((k) => pose({
    hipsY: 0, thighL: -1.2, thighR: -1.1, kneeL: 0.7, kneeR: 0.85, ankleL: 0.3, ankleR: 0.2, hipZL: 0.2, hipZR: -0.2,
    lean: -0.35, shL: -0.35, shR: -0.35, shZL: 0.25, shZR: -0.25, elL: -1.45, elR: -1.45, headPitch: -0.1, headRoll: 0.22, breathe: k * 0.02,
  })) },
  // deitado de barriga pra cima (lie = 1 gira o corpo inteiro)
  sleep: { fps: 1.2, loop: true, frames: [0, 1].map((k) => pose({
    lie: 1, thighL: 0.02, thighR: -0.02, kneeL: 0.1, kneeR: 0.18, ankleL: 0.5, ankleR: 0.45, hipZL: 0.08, hipZR: -0.08,
    shL: 0.04, shR: 0.04, shZL: 0.2, shZR: -0.2, elL: -0.12, elR: -0.12, headPitch: 0.28, headRoll: 0.12, breathe: k * 0.035,
  })) },
  nap: { fps: 1.5, loop: true, frames: [0, 1, 0, 2].map((k) => pose({
    lie: 1, thighL: 0.02, thighR: -0.85, kneeL: 0.1, kneeR: 1.5, ankleL: 0.5, ankleR: k === 2 ? 0.0 : 0.2, hipZL: 0.08, hipZR: -0.12,
    shL: 0.02, shR: -0.32, shZL: 0.16, shZR: 0.34, elL: -0.2, elR: -0.55, headPitch: 0.3, headRoll: -0.1, breathe: k === 1 ? 0.03 : 0,
  })) },
  guard: { fps: 1.5, loop: true, frames: [0, 1].map((k) => pose({
    hipZL: 0.12, hipZR: -0.12, shL: -0.85, shR: -0.8, shZL: -0.42, shZR: 0.42, elL: -1.95, elR: -2.05, breathe: k * 0.02, headPitch: -0.04,
  })) },
};
// Camadas por cima (só braço/cabeça)
const OVERLAYS = {
  wave: { fps: 7, len: 12, f: (i) => ({ shR: -2.25, shZR: -0.75, elR: i % 2 ? -1.05 : -0.4, elZR: i % 2 ? 0.3 : -0.2, headRoll: 0.14, headPitch: -0.06 }) },
  press: { fps: 6, len: 6, f: (i) => ({ shR: i < 2 ? -1.15 : i < 4 ? -1.3 : -1.0, shZR: 0.12, elR: i < 2 ? -0.6 : -0.25, headPitch: 0.12, lean: 0.06 }) },
  drink: { fps: 4, len: 0, f: (i) => (i % 8 >= 5 ? { shR: -1.3, shZR: 0.78, elR: -0.1, elZR: 0, headPitch: 0.28 } : { shR: -0.75, shZR: -0.05, elR: -1.75 }) },
  yawn: { fps: 4, len: 8, f: (i) => { const k = [0.3, 0.8, 1, 1, 1, 0.8, 0.4, 0.1][i] || 0; return { _yawn: k, headPitch: -0.3 * k, shL: -2.5 * k, shR: -2.5 * k, shZL: 0.5 * k, shZR: -0.5 * k, elL: -0.6 * k, elR: -0.6 * k }; } },
};

function rpgState(m, speed, air) {
  if (m.lying) return m.mood === 'rest' ? 'nap' : 'sleep';
  if (m.sitting) return m.typing ? 'type' : m.mood === 'rest' ? 'slouch' : 'sit';
  if (air) return 'air';
  if (m.landT > 0) return 'land';
  if (speed > 4.2) return 'run';
  if (speed > 0.25) return 'walk';
  if (m.guard) return 'guard';
  return 'idle';
}

function rpgUpdate(m, dt, t, { speed = 0, air = false } = {}) {
  if (!m.rpg) m.rpg = { state: 'idle', frame: 0, acc: 0, from: CLIPS.idle.frames[0], blend: 1, cur: CLIPS.idle.frames[0], ov: null, ovFrame: 0, ovAcc: 0, blinkT: 2, blink: 0, lookT: 3, look: 0, yawnT: 6 };
  const R = m.rpg;
  if (m.landT > 0) m.landT -= dt;
  const st = rpgState(m, speed, air);
  m.sitK = damp(m.sitK, m.sitting || m.lying ? 1 : 0, 10, dt);
  if (st !== R.state) {
    // troca: congela a pose atual e passa por 2 quadros intermediários
    R.from = R.out || R.cur; R.blend = 0; R.state = st; R.frame = 0; R.acc = 0;
  }
  const clip = CLIPS[st];
  let fps = clip.fps;
  if (st === 'walk') fps = clamp(7 + speed * 2.4, 8, 18);
  if (st === 'run') fps = clamp(10 + speed * 1.6, 14, 24);
  R.acc += dt;
  const step = 1 / fps;
  let ticked = false;
  while (R.acc >= step) {
    R.acc -= step; ticked = true;
    R.frame = clip.loop ? (R.frame + 1) % clip.frames.length : Math.min(R.frame + 1, clip.frames.length - 1);
    if (R.blend < 1) R.blend = Math.min(1, R.blend + 0.34);
  }
  // transições curtinhas andam no ritmo de 12 qps mesmo em clips lentos
  if (R.blend < 1 && !ticked) { R.tb = (R.tb || 0) + dt; if (R.tb > 0.07) { R.tb = 0; R.blend = Math.min(1, R.blend + 0.34); } }
  R.cur = clip.frames[R.frame];
  let P = R.blend < 1 ? lerpPose(R.from, R.cur, R.blend) : { ...R.cur };

  // olhar em volta de vez em quando (parado / sentado)
  R.lookT -= dt;
  if (R.lookT <= 0) { R.look = Math.random() < 0.5 ? 0 : (Math.random() - 0.5) * 1.1; R.lookT = 2 + Math.random() * 4; }
  if (st === 'idle' || st === 'sit') P.headYaw += R.look * 0.6;
  if (m.guard && m.guardLook != null) P.headYaw = m.guardLook;

  // camadas: acenar / café / bocejo
  let ov = null;
  if (m.pressT > 0) { m.pressT -= dt; ov = 'press'; }
  else if (m.waveT > 0) { m.waveT -= dt; ov = 'wave'; }
  else if (m.drinkT > 0 && !m.lying) { m.drinkT -= dt; ov = 'drink'; }
  else if (m.yawn > 0) ov = 'yawn';
  if ((m.mood === 'rest') && m.yawn <= 0) { R.yawnT -= dt; if (R.yawnT <= 0) { m.yawn = 2.2; R.yawnT = 8 + Math.random() * 8; } }
  if (m.yawn > 0) m.yawn -= dt;
  if (ov !== R.ov) { R.ov = ov; R.ovFrame = 0; R.ovAcc = 0; }
  let yawnK = 0;
  if (ov) {
    const O = OVERLAYS[ov];
    R.ovAcc += dt;
    while (R.ovAcc >= 1 / O.fps) { R.ovAcc -= 1 / O.fps; R.ovFrame++; }
    const o = O.f(R.ovFrame);
    yawnK = o._yawn || 0;
    for (const k in o) {
      if (!(k in P)) continue;
      if (ov === 'yawn') {
        // bocejo: espreguiça por cima da pose (deitado só mexe a cabeça)
        if (m.lying && (k.startsWith('sh') || k.startsWith('el'))) continue;
        P[k] = k === 'headPitch' ? P[k] + o[k] : P[k] + (o[k] / Math.max(yawnK, 0.01) - P[k]) * yawnK;
      } else P[k] = o[k];
    }
  }
  // falando: cabeça acompanha (2 quadros)
  if (m.talking && !m.lying) P.headPitch += (Math.floor(t * 5) % 2) * 0.05;

  // altura do quadril sentado: em cima do assento
  if (st === 'sit' || st === 'type' || st === 'slouch') P.hipsY = m.seatH + m.sitLift;
  else if (R.blend < 1 && (R.from.hipsY < 0.2 || P.hipsY < 0.2)) {
    // levantando/sentando: interpola até a altura certa do assento
    const fromY = R.from.hipsY < 0.2 ? m.seatH + m.sitLift : R.from.hipsY;
    const toY = R.cur.hipsY < 0.2 ? m.seatH + m.sitLift : R.cur.hipsY;
    P.hipsY = fromY + (toY - fromY) * R.blend;
  }
  R.out = P;
  applyRpgPose(m, P, t, air);
  rpgFace(m, dt, t, st, yawnK, air);
}

function applyRpgPose(m, p, t, air) {
  m.hips.position.set(p.hipsX, p.hipsY, 0);
  m.pelvis.rotation.set(0, p.pelvisYaw, p.pelvisRoll);
  const [legR, legL] = m.legs;
  legL.hip.rotation.set(p.thighL, 0, p.hipZL);
  legR.hip.rotation.set(p.thighR, 0, p.hipZR);
  legL.knee.rotation.x = p.kneeL; legR.knee.rotation.x = p.kneeR;
  legL.ankle.rotation.x = p.ankleL; legR.ankle.rotation.x = p.ankleR;
  m.torso.rotation.set(p.lean, p.torsoYaw, p.torsoRoll);
  m.body.scale.set(1 + p.breathe * 0.5, 1 + p.breathe, 0.88 + p.breathe * 0.6);
  const [armR, armL] = m.arms;
  armL.shoulder.rotation.set(p.shL, 0, p.shZL + m.armSpread);
  armR.shoulder.rotation.set(p.shR, 0, p.shZR - m.armSpread);
  armL.elbow.rotation.set(p.elL, 0, 0);
  armR.elbow.rotation.set(p.elR, 0, p.elZR);
  m.neck.rotation.set(p.headPitch, p.headYaw, p.headRoll);
  m.ears[0].rotation.z = p.earWig * 0.25;
  m.ears[1].rotation.z = -p.earWig * 0.25;
  // deitado: corpo inteiro gira e encosta as costas no colchão (sem flutuar)
  const L = p.lie;
  m.rig.rotation.set(-Math.PI / 2 * L, 0, m.sway ? Math.sin(t * 0.9) * 0.08 * L : 0);
  // costas do tronco ≈ 0.30 atrás da linha do quadril; afunda 3 cm no colchão
  const bedTop = (m.bedH ?? 0.5) + 0.03;
  m.rig.position.set(0, L * (bedTop + 0.27), L * 0.86);
  if (L > 0) m.hips.position.y = p.hipsY * (1 - L) + 0.3 * L;
  m.mug.visible = m.drinkT > 0 && !m.lying;
  if (m.can) { const en = m.drinkKind === 'energy'; m.can.visible = en; for (const c of m.mug.children) if (c !== m.can) c.visible = !en; }
  // gole: braço esticado (um pouco mais comprido, é desenho), caneca na frente
  // da mão e inclinada pra boca; segurando: caneca em pé na altura do peito
  const sip = m.mug.visible && m.rpg?.ov === 'drink' && m.rpg.ovFrame % 8 >= 5;
  armR.shoulder.scale.set(1, sip ? 1.18 : 1, 1);
  m.mug.position.set(0, -0.22, sip ? 0.2 : 0.08);
  if (m.mug.visible) m.mug.rotation.x = -(p.shR + p.elR + p.lean) - (sip ? 0.55 : 0);
  m.rig.scale.set(1, 1, 1);
}

// Rosto: olhos fechados em "arquinho" (dormindo / feliz), meio fechados com
// sono, piscada de 1 quadro, boca aberta falando em 2 quadros, bochecha rosada.
function rpgFace(m, dt, t, st, yawnK, air) {
  const R = m.rpg;
  R.blinkT -= dt;
  if (R.blinkT <= 0) { R.blink = 0.12; R.blinkT = 2.5 + Math.random() * 3.5; }
  if (R.blink > 0) R.blink -= dt;
  // expressão escolhida pela ação
  const sip = m.drinkT > 0 && R.ov === 'drink' && R.ovFrame % 8 >= 5;
  let ex = 'calmo';
  if (st === 'sleep' || yawnK > 0.5) ex = 'dormindo';
  else if (m.waveT > 0) ex = 'feliz';
  else if (sip) ex = 'gostoso';
  else if (air) ex = 'susto';
  else if (m.mood === 'rest') ex = 'sono';
  else if (st === 'type') ex = 'foco';
  else if (st === 'run') ex = 'garra';
  else if (m.guard) ex = 'serio';
  else if (m.talking) ex = 'falando';
  if (m.emoteT > 0) { m.emoteT -= dt; if (!(st === 'sleep')) ex = m.emoteExpr || 'feliz'; }
  if (m.pressT > 0) ex = 'foco';
  m.expr = ex;
  const closedArc = ex === 'dormindo' || ex === 'gostoso' || (R.blink > 0 && ex !== 'feliz');
  for (const e of m.eyes) {
    e.visible = !closedArc && ex !== 'feliz';
    e.scale.y = ex === 'sono' ? 0.45 : ex === 'foco' || ex === 'serio' ? 0.72 : ex === 'susto' ? 1.15 : 1;
    e.scale.x = ex === 'susto' ? 1.12 : 1;
  }
  m.faceArcs.closed.visible = closedArc;
  m.faceArcs.happy.visible = ex === 'feliz';
  m.blush.visible = ex === 'feliz' || ex === 'gostoso' || ex === 'dormindo' || (m.talking && Math.floor(t * 0.5) % 2 === 0);
  // sobrancelhas: ângulo (lado de dentro pra baixo = bravo/foco) e altura
  const B = { calmo: [0, 0], feliz: [-0.15, 0.02], gostoso: [-0.2, 0.015], susto: [-0.25, 0.04], sono: [0.35, -0.012], foco: [0.3, -0.012], garra: [0.4, -0.01], serio: [0.45, -0.015], dormindo: [0.15, -0.01], falando: [-0.1, 0.01 + (Math.floor(t * 4) % 2) * 0.012] }[ex];
  m.brows2.forEach((b, i) => { const s = i === 0 ? -1 : 1; b.rotation.z = Math.PI / 2 + B[0] * s; b.position.y = 0.45 + B[1]; });
  let mouthOpen = 0, mouthW = 1;
  // falando: sílabas em quadros (8 por segundo), formas variadas
  if (m.talking) { const SY = [0.25, 0.85, 0.5, 0.1, 0.7, 0.35, 0.9, 0.2]; mouthOpen = SY[(Math.floor(t * 8) + (m.name || '').length) % SY.length]; mouthW = mouthOpen > 0.6 ? 0.9 : 1.05; }
  if (yawnK > 0) { mouthOpen = 1.4 * yawnK; mouthW = 0.85; }
  if (ex === 'susto' && !m.talking) { mouthOpen = 0.6; mouthW = 0.6; }
  if (ex === 'garra' && !m.talking) mouthOpen = 0.3;
  // bebendo: boca em "o" encostando na caneca
  if (m.drinkT > 0 && R.ov === 'drink' && R.ovFrame % 8 >= 5) { mouthOpen = 0.45; mouthW = 0.55; }
  m.mouth.visible = mouthOpen > 0.05;
  m.mouth.scale.set(mouthW, 0.12 + mouthOpen * 0.95, 0.5);
  m.mouth.userData.tongue.visible = mouthOpen > 0.3;
  m.mouth.userData.teeth.visible = mouthOpen > 0.45;
  // olhos mexem: olhadinhas rápidas pros lados (sacadas), olhando pra onde anda
  R.eyeT = (R.eyeT ?? 1) - dt;
  if (R.eyeT <= 0) {
    R.eyeT = 0.6 + Math.random() * 2.2;
    const r = Math.random();
    R.eyeX = r < 0.45 ? 0 : (Math.random() - 0.5) * 2;
    R.eyeY = r < 0.45 ? 0 : (Math.random() - 0.6) * 1.2;
  }
  let ex2 = R.eyeX || 0, ey2 = R.eyeY || 0;
  if (st === 'type') { ex2 = Math.sin(t * 1.7) * 0.6; ey2 = -0.7; }
  if (st === 'walk' || st === 'run') { ex2 *= 0.3; ey2 = 0; }
  if (m.drinkT > 0 && R.ovFrame % 8 >= 5) { ex2 = 0; ey2 = -0.5; }
  m.eyes.forEach((e, i) => { const s = i === 0 ? -1 : 1; e.position.x = 0.1 * s + ex2 * 0.014; e.position.y = 0.335 + ey2 * 0.012; });
  m.flatMouth.visible = !m.mouth.visible && (ex === 'foco' || ex === 'serio');
  m.smile.visible = !m.mouth.visible && !m.flatMouth.visible && ex !== 'dormindo' && ex !== 'sono';
  m.smile.scale.set(ex === 'feliz' || ex === 'gostoso' ? 1.25 : 1, ex === 'feliz' ? 1.3 : 1, 1);
}

// =====================================================================
// ESCRITÓRIO GERADO PELOS CANAIS
// =====================================================================
// O prédio é montado a partir da lista de categorias/canais do servidor:
//   categoria  → setor (área aberta com mesas, tema pelo nome do setor)
//   canal de voz → sala de vidro (tema pelo nome do canal: "Sala de Games",
//                  "Cinema", "Copa", "Estúdio de Podcast", "Sala Zen"...)
//   canal de texto → chat do setor
// Criou canal/categoria → o prédio é remontado com as salas novas.
// Coordenadas em metros: x cresce pro leste (o prédio cresce pra lá),
// z = norte(-)/sul(+). Entrada no oeste, corredor central no eixo x.

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function hasKey(n, k) {
  if (k.length <= 3) return new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&')}([^a-z0-9]|$)`).test(n);
  return n.includes(k);
}
const ROOM_THEMES = [
  ['games', 'Games', ['game', 'jogo', 'gamer', 'play', 'valorant', 'lol', 'league', 'cs', 'fortnite', 'minecraft', 'arcade', 'fliperama', 'console', 'esport']],
  ['cinema', 'Cinema', ['cinema', 'filme', 'movie', 'netflix', 'anime', 'serie', 'sessao', 'telao']],
  ['studio', 'Estúdio', ['podcast', 'estudio', 'studio', 'musica', 'som', 'radio', 'live', 'gravacao', 'audio', 'banda']],
  ['arcade', 'Minigames', ['minigame', 'mini game', 'fliperama', 'arcade', 'jogos rapidos']],
  ['descanso', 'Descanso', ['afk', 'ausente', 'descanso', 'soneca', 'cochilo', 'away']],
  ['dorm', 'Offline', ['offline', 'dormitorio', 'dormir']],
  ['zen', 'Zen', ['zen', 'relax', 'medita', 'chill', 'lounge', 'descompress', 'calma', 'yoga']],
  ['cafe', 'Café', ['copa', 'cafe', 'cozinha', 'almoco', 'lanche', 'coffee', 'refeitorio', 'happy', 'bar']],
  ['auditorio', 'Auditório', ['auditorio', 'palestra', 'all hands', 'allhands', 'evento', 'apresenta', 'treinamento', 'workshop', 'town hall', 'aula']],
  ['biblioteca', 'Biblioteca', ['biblioteca', 'estudo', 'leitura', 'foco', 'livro', 'pesquisa', 'silencio']],
  ['oneonone', '1:1', ['1:1', 'rh', 'entrevista', 'conversa', 'feedback', 'particular', 'privad', 'mentoria']],
  ['meeting', 'Reunião', []],
];
function detectRoomTheme(name) {
  const n = norm(name);
  for (const [id, label, keys] of ROOM_THEMES) if (keys.some((k) => hasKey(n, k))) return { id, label };
  return { id: 'meeting', label: 'Reunião' };
}
const AREA_THEMES = [
  ['dev', 'Tecnologia', ['ti', 'dev', 'tecnolog', 'engenharia', 'tech', 'produto', 'dados', 'infra', 'sistema', 'programa'], 'code'],
  ['sales', 'Vendas', ['comercial', 'venda', 'sales', 'negocio', 'parceri', 'cliente'], 'dash'],
  ['finance', 'Finanças', ['financ', 'contab', 'fiscal', 'compras', 'tesour', 'juridico'], 'sheet'],
  ['people', 'Pessoas', ['rh', 'pessoas', 'people', 'gente', 'recrut', 'cultura'], 'doc'],
  ['creative', 'Criação', ['marketing', 'design', 'criacao', 'criativ', 'conteudo', 'social', 'arte', 'video', 'midia'], 'art'],
  ['support', 'Suporte', ['suporte', 'atendimento', 'sac', 'help', 'sucesso'], 'ticket'],
  ['lounge', 'Convivência', ['geral', 'convivencia', 'comunidade', 'off', 'aleatorio', 'random'], 'doc'],
  ['office', 'Escritório', [], 'doc'],
];
function detectAreaTheme(name) {
  const n = norm(name);
  for (const [id, label, keys, screen] of AREA_THEMES) if (keys.some((k) => hasKey(n, k))) return { id, label, screen };
  return { id: 'office', label: 'Escritório', screen: 'doc' };
}

// ---------- Texturas ----------
function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  return t;
}
function seeded(seed) { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); }
function planks(hue, sat, light, seed) {
  return canvasTex(512, 512, (g) => {
    const r = seeded(seed);
    for (let y = 0; y < 512; y += 32) {
      let x = -Math.floor(r() * 256);
      while (x < 512) {
        const len = 180 + r() * 200;
        g.fillStyle = `hsl(${hue + r() * 6}, ${sat + r() * 8}%, ${light + r() * 8}%)`;
        g.fillRect(x, y, len, 32);
        g.strokeStyle = 'rgba(70,40,20,0.09)';
        for (let i = 0; i < 4; i++) {
          g.beginPath();
          const yy = y + 4 + r() * 24;
          g.moveTo(x, yy);
          g.bezierCurveTo(x + len * 0.3, yy + r() * 4 - 2, x + len * 0.6, yy + r() * 4 - 2, x + len, yy);
          g.stroke();
        }
        g.fillStyle = 'rgba(40,20,10,0.25)';
        g.fillRect(x, y, 2, 32);
        x += len;
      }
      g.fillStyle = 'rgba(40,20,10,0.22)';
      g.fillRect(0, y, 512, 1.5);
    }
  });
}
function speckle(base, seed, amt = 0.05) {
  return canvasTex(256, 256, (g) => {
    const r = seeded(seed);
    g.fillStyle = base; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + r() * amt})`;
      g.fillRect(r() * 256, r() * 256, 1.5, 1.5);
    }
  });
}
const TEX = {
  wood: planks(28, 32, 50, 7),
  woodLight: planks(34, 30, 66, 9),
  woodDark: planks(22, 30, 30, 13),
  carpet: speckle('#5b5f6b', 3),
  carpetDark: speckle('#25222c', 4, 0.07),
  carpetRed: speckle('#5a1f24', 6, 0.06),
  concrete: speckle('#a7a39d', 5, 0.04),
  tile: canvasTex(512, 512, (g) => {
    const r = seeded(11);
    for (let y = 0; y < 512; y += 128) for (let x = 0; x < 512; x += 128) {
      g.fillStyle = `hsl(35, 12%, ${86 + r() * 4}%)`;
      g.fillRect(x, y, 128, 128);
      for (let i = 0; i < 3; i++) {
        g.strokeStyle = `rgba(120,110,100,${0.05 + r() * 0.05})`;
        g.beginPath(); g.moveTo(x + r() * 128, y); g.quadraticCurveTo(x + r() * 128, y + 64, x + r() * 128, y + 128); g.stroke();
      }
      g.fillStyle = 'rgba(90,80,70,0.35)';
      g.fillRect(x, y, 128, 2); g.fillRect(x, y, 2, 128);
    }
  }),
  checker: canvasTex(256, 256, (g) => {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = (x + y) % 2 ? '#2b2d33' : '#e9e6e1'; g.fillRect(x * 64, y * 64, 64, 64); }
  }),
  keys: canvasTex(256, 80, (g) => {
    g.fillStyle = '#26252b'; g.fillRect(0, 0, 256, 80);
    g.fillStyle = '#3a3940';
    for (let row = 0; row < 4; row++) for (let i = 0; i < 14; i++) g.fillRect(4 + i * 18 + row * 3, 5 + row * 18, 14, 14);
    g.fillRect(60, 77 - 14, 120, 12);
  }),
};

function screenTex(kind) {
  return canvasTex(256, 160, (g, w, h) => {
    const r = seeded(kind.length * 13 + kind.charCodeAt(0));
    const grad = (a, b) => { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, a); gr.addColorStop(1, b); return gr; };
    if (kind === 'code') {
      g.fillStyle = '#16141c'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1f1c27'; g.fillRect(0, 0, 40, h);
      const cols = ['#f4511e', '#60a5fa', '#a78bfa', '#34d399', '#e5e7eb', '#fbbf24'];
      for (let y = 8; y < h - 4; y += 9) {
        let x = 48 + Math.floor(r() * 4) * 12;
        const n = 1 + Math.floor(r() * 4);
        for (let i = 0; i < n; i++) { const len = 12 + r() * 40; g.fillStyle = cols[Math.floor(r() * cols.length)]; g.globalAlpha = 0.85; g.fillRect(x, y, len, 4); x += len + 6; }
        g.globalAlpha = 0.4; g.fillStyle = '#9ca3af'; g.fillRect(10, y, 18, 4);
      }
      g.globalAlpha = 1;
    } else if (kind === 'sheet') {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#16a34a'; g.fillRect(0, 0, w, 14);
      g.strokeStyle = '#e5e7eb';
      for (let x = 0; x < w; x += 36) { g.beginPath(); g.moveTo(x, 14); g.lineTo(x, h); g.stroke(); }
      for (let y = 14; y < h; y += 10) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      g.fillStyle = '#374151';
      for (let y = 17; y < h; y += 10) for (let x = 4; x < w; x += 36) if (r() < 0.7) g.fillRect(x, y, 10 + r() * 18, 3);
    } else if (kind === 'dash') {
      g.fillStyle = '#121019'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1e1b27';
      [[8, 8, 76, 40], [90, 8, 76, 40], [172, 8, 76, 40], [8, 56, 158, 96], [172, 56, 76, 96]].forEach(([x, y, ww, hh]) => g.fillRect(x, y, ww, hh));
      g.font = 'bold 16px sans-serif';
      g.fillStyle = '#22c55e'; g.fillText('R$ 84k', 14, 36);
      g.fillStyle = '#f4511e'; g.fillText('+12%', 98, 36);
      g.fillStyle = '#60a5fa'; g.fillText('327', 180, 36);
      g.strokeStyle = '#f4511e'; g.lineWidth = 3; g.beginPath();
      for (let i = 0; i <= 10; i++) g.lineTo(14 + i * 14.5, 140 - (20 + i * 6 + r() * 20));
      g.stroke();
      for (let i = 0; i < 5; i++) { g.fillStyle = i % 2 ? '#60a5fa' : '#a78bfa'; const bh = 20 + r() * 60; g.fillRect(180 + i * 13, 146 - bh, 9, bh); }
    } else if (kind === 'doc') {
      g.fillStyle = '#f3f4f6'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff'; g.fillRect(40, 6, 176, h - 6);
      g.fillStyle = '#111827'; g.fillRect(56, 16, 90, 7);
      g.fillStyle = '#9ca3af';
      for (let y = 32; y < h - 6; y += 8) g.fillRect(56, y, 120 + r() * 24, 3);
    } else if (kind === 'art') {
      g.fillStyle = '#2a2730'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1d1b22'; g.fillRect(0, 0, 30, h); g.fillRect(w - 50, 0, 50, h);
      g.fillStyle = '#fff'; g.fillRect(48, 18, 150, 124);
      g.fillStyle = '#f4511e'; g.beginPath(); g.arc(100, 70, 30, 0, 7); g.fill();
      g.fillStyle = '#3b82f6'; g.fillRect(120, 80, 60, 40);
      g.fillStyle = '#fbbf24'; g.beginPath(); g.moveTo(70, 130); g.lineTo(110, 100); g.lineTo(150, 130); g.fill();
    } else if (kind === 'ticket') {
      g.fillStyle = '#f8fafc'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#0ea5e9'; g.fillRect(0, 0, w, 16);
      for (let i = 0; i < 9; i++) {
        g.fillStyle = i % 2 ? '#fff' : '#f1f5f9'; g.fillRect(0, 16 + i * 16, w, 16);
        g.fillStyle = ['#22c55e', '#f59e0b', '#ef4444'][Math.floor(r() * 3)]; g.fillRect(6, 21 + i * 16, 8, 6);
        g.fillStyle = '#475569'; g.fillRect(22, 22 + i * 16, 80 + r() * 90, 4);
      }
    } else if (kind === 'slide') {
      g.fillStyle = '#16131c'; g.fillRect(0, 0, w, h);
      g.fillStyle = grad('#ef4444', '#f4511e'); g.fillRect(0, 0, w, 6);
      g.fillStyle = '#fff'; g.font = 'bold 20px sans-serif'; g.fillText('Planejamento Q1', 16, 42);
      g.fillStyle = '#a19ab0'; g.font = '11px sans-serif'; g.fillText('Metas • Sprint 47 • Próximos passos', 16, 62);
      for (let i = 0; i < 6; i++) { g.fillStyle = i === 5 ? '#f4511e' : '#3f3a4a'; const bh = 14 + i * 12; g.fillRect(24 + i * 34, 148 - bh, 22, bh); }
    } else if (kind === 'welcome') {
      g.fillStyle = grad('#1b1622', '#2a1a1c'); g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff'; g.font = 'bold 22px sans-serif'; g.fillText('Bem-vindo!', 16, 60);
      g.fillStyle = '#f4511e'; g.font = 'bold 14px sans-serif'; g.fillText('Mamacos Corp', 16, 84);
      g.fillStyle = '#a19ab0'; g.font = '11px sans-serif'; g.fillText('Wi-Fi: Mamacos-Visitantes', 16, 130);
    } else if (kind === 'game') {
      g.fillStyle = grad('#3b0764', '#0c4a6e'); g.fillRect(0, 0, w, h);
      g.fillStyle = '#22c55e'; g.fillRect(0, 120, w, 40);
      g.fillStyle = '#fbbf24'; for (let i = 0; i < 6; i++) g.fillRect(20 + i * 40, 60 + (i % 2) * 20, 18, 18);
      g.fillStyle = '#ef4444'; g.fillRect(120, 96, 16, 24);
      g.fillStyle = '#fff'; g.font = 'bold 12px monospace'; g.fillText('SCORE 004250', 10, 18);
    } else if (kind === 'movie') {
      g.fillStyle = grad('#f97316', '#1e1b4b'); g.fillRect(0, 0, w, h);
      g.fillStyle = '#0f0a1a';
      g.beginPath(); g.moveTo(0, h); g.lineTo(60, 90); g.lineTo(110, 120); g.lineTo(170, 70); g.lineTo(256, 130); g.lineTo(256, h); g.fill();
      g.fillStyle = '#fde68a'; g.beginPath(); g.arc(190, 50, 18, 0, 7); g.fill();
    } else if (kind === 'onair') {
      g.fillStyle = '#1a0606'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ef4444'; g.font = 'bold 64px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ON AIR', w / 2, h / 2);
    } else if (kind === 'menu') {
      g.fillStyle = '#1f2a24'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#f5f0e8'; g.font = 'bold 18px serif'; g.fillText('Cardápio', 16, 28);
      g.font = '12px serif';
      ['Espresso ......... 5', 'Cappuccino ...... 8', 'Pão de queijo ... 6', 'Bolo do dia ..... 7', 'Suco natural .... 9'].forEach((t, i) => g.fillText(t, 16, 54 + i * 20));
    } else if (kind === 'neon') {
      g.fillStyle = '#0b0614'; g.fillRect(0, 0, w, h);
      g.shadowColor = '#e879f9'; g.shadowBlur = 18;
      g.fillStyle = '#f0abfc'; g.font = 'bold 46px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('GAME ON', w / 2, h / 2);
    }
  });
}
const SCREEN = Object.fromEntries(['code', 'sheet', 'dash', 'doc', 'art', 'ticket', 'slide', 'welcome', 'game', 'movie', 'onair', 'menu', 'neon'].map((k) => [k, new THREE.MeshBasicMaterial({ map: screenTex(k), toneMapped: false })]));

// ---------- Materiais ----------
const M = {
  deskWhite: mat(0xeeece8, 0.45),
  deskWood: new THREE.MeshStandardMaterial({ map: TEX.woodLight, roughness: 0.55 }),
  wood: mat(0xb88a5c, 0.55),
  woodDark: mat(0x5e4130, 0.55),
  metal: mat(0x9aa0a8, 0.3, { metalness: 0.75 }),
  chrome: mat(0xd6d9de, 0.15, { metalness: 0.95 }),
  dark: mat(0x26252b, 0.45),
  black: mat(0x141317, 0.4),
  chair: mat(0x2e3542, 0.85, { bumpMap: CLOTH_BUMP, bumpScale: 0.35 }),
  chairMesh: mat(0x1f232c, 0.9),
  white: mat(0xf2f0ec, 0.5),
  wall: mat(0xe7e2da, 0.85, { bumpMap: CLOTH_BUMP, bumpScale: 0.15 }),
  wallCap: mat(0xcfc8bd, 0.6),
  leaf: mat(0x4a8a47, 0.65),
  leaf2: mat(0x2f6b3a, 0.65),
  leaf3: mat(0x6aa84f, 0.65),
  trunk: mat(0x6b4a32, 0.8),
  pot: mat(0xe8e2d6, 0.5),
  potT: mat(0xb56a45, 0.7),
  potD: mat(0x2c2a2e, 0.4),
  soil: mat(0x3b2a20, 1),
  glass: new THREE.MeshStandardMaterial({ color: 0xcfe3ee, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.16, depthWrite: false }),
  frosted: new THREE.MeshStandardMaterial({ color: 0xeef2f4, roughness: 0.55, transparent: true, opacity: 0.6, depthWrite: false }),
  frame: mat(0x34363d, 0.35, { metalness: 0.6 }),
  fabricBlue: mat(0x52627a, 0.95, { bumpMap: CLOTH_BUMP, bumpScale: 0.35 }),
  fabricOrange: mat(0xc9733f, 0.95, { bumpMap: CLOTH_BUMP, bumpScale: 0.35 }),
  fabricGreen: mat(0x5b7a5a, 0.95, { bumpMap: CLOTH_BUMP, bumpScale: 0.35 }),
  fabricGray: mat(0x8d8a86, 0.95, { bumpMap: CLOTH_BUMP, bumpScale: 0.35 }),
  fabricRed: mat(0x9b2230, 0.9, { bumpMap: CLOTH_BUMP, bumpScale: 0.35 }),
  fabricCream: mat(0xe6dccb, 0.95, { bumpMap: CLOTH_BUMP, bumpScale: 0.35 }),
  leather: mat(0x6b3f2a, 0.5),
  steel: mat(0xc9ccd1, 0.2, { metalness: 0.85 }),
  stone: mat(0xdedbd5, 0.3),
  cabinet: mat(0x8a6a4c, 0.5),
  fridge: mat(0xdfe2e6, 0.25, { metalness: 0.4 }),
  accent: mat(0xf4511e, 0.45),
  paper: mat(0xffffff, 0.8),
  book: [mat(0xb33a3a, 0.7), mat(0x3a6ab3, 0.7), mat(0xd9b44a, 0.7), mat(0x3f8a5a, 0.7), mat(0x6b4aa0, 0.7), mat(0x2b2b2b, 0.7)],
  mug: [mat(0xffffff, 0.3), mat(0xf4511e, 0.3), mat(0x2b2b2b, 0.3), mat(0x3b82f6, 0.3)],
  whiteboard: mat(0xfbfbfa, 0.15),
  water: new THREE.MeshStandardMaterial({ color: 0x7fb8e6, roughness: 0.05, transparent: true, opacity: 0.55 }),
  stage: mat(0x2f2622, 0.6),
  lampGlow: new THREE.MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffd9a0, emissiveIntensity: 1.2, roughness: 0.6 }),
  ledPink: new THREE.MeshStandardMaterial({ color: 0xff5fd2, emissive: 0xff3fc8, emissiveIntensity: 2.2 }),
  ledBlue: new THREE.MeshStandardMaterial({ color: 0x5fb8ff, emissive: 0x3fa0ff, emissiveIntensity: 2.2 }),
  foam: mat(0x2b2733, 0.98),
  foam2: mat(0x4a2b5c, 0.98),
  bean: [mat(0xf4511e, 0.9), mat(0x8b5cf6, 0.9), mat(0x22c55e, 0.9), mat(0x3b82f6, 0.9)],
  pebble: mat(0x8f8a84, 0.8),
  gold: mat(0xd4a93a, 0.25, { metalness: 0.9 }),
};
const FLOOR_MATS = new Map();
function floorMat(tex, tint, tile, w, d) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(w / tile, d / tile);
  return new THREE.MeshStandardMaterial({ map: t, color: tint, roughness: 0.8 });
}

// ---------- Estado do mundo ----------
let worldGroup = new THREE.Group();
let statics = new THREE.Group();
let dynamic = new THREE.Group();
let colliders = [];
let seats = [];
let doors = [];
let ZONES = [];
let ROOMS = {};
let AREAS = {};
let BUILDING = [0, 40, -15.5, 15.5];
let SPOTS = {};
let INTERACT = []; // TV, computador, fliperama — o que dá pra usar com F/clique
let GUARDS = [];    // onde ficam os seguranças (porta das salas privadas)
let BOARD = null;   // telão da recepção

function addCollider(x0, x1, z0, z1) { colliders.push([Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1)]); }
function box(w, h, d, material, x = 0, y = 0, z = 0, parent) {
  const m = mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  if (parent) parent.add(m);
  return m;
}
// caixa arredondada (cantos macios — dá muito mais cara de móvel de verdade)
const RB_CACHE = new Map();
function rbox(w, h, d, r, material, x = 0, y = 0, z = 0, parent) {
  const rr = Math.max(0.002, Math.min(r, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002));
  // peças pequenas: caixa simples (ninguém vê o arredondado e economiza muito triângulo)
  const small = Math.min(w, h, d) < 0.05 || rr < 0.008;
  const big = Math.max(w, h, d) > 1.2 && rr >= 0.03;
  const key = small ? `b${w},${h},${d}` : `r${w},${h},${d},${rr},${big ? 2 : 1}`;
  let geo = RB_CACHE.get(key);
  if (!geo) { geo = small ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, big ? 2 : 1, rr); RB_CACHE.set(key, geo); }
  const m = mesh(geo, material);
  m.position.set(x, y, z);
  if (parent) parent.add(m);
  return m;
}
function cyl(rt, rb, h, material, x = 0, y = 0, z = 0, parent, seg = 18) {
  if (Math.max(rt, rb) < 0.03) seg = Math.min(seg, 6);
  const m = mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.position.set(x, y, z);
  if (parent) parent.add(m);
  return m;
}
function ball(r, material, x, y, z, parent, sx = 1, sy = 1, sz = 1) {
  const m = mesh(r < 0.05 ? SPH(r, 8, 6) : r < 0.15 ? SPH(r, 12, 8) : SPH(r, 16, 12), material);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  if (parent) parent.add(m);
  return m;
}
function place(obj, x, z, rot = 0, y = 0, parent = statics) {
  obj.position.set(x, y, z);
  obj.rotation.y = rot;
  parent.add(obj);
  return obj;
}
function footprint(x, z, w, d, rot = 0, pad = 0) {
  const q = Math.abs(Math.round(rot / (Math.PI / 2))) % 2 === 1;
  const hw = (q ? d : w) / 2 + pad, hd = (q ? w : d) / 2 + pad;
  addCollider(x - hw, x + hw, z - hd, z + hd);
}
function rotXZ(lx, lz, rot) { return [lx * Math.cos(rot) + lz * Math.sin(rot), -lx * Math.sin(rot) + lz * Math.cos(rot)]; }
function addSeat(x, z, yaw, h, extra) { const s = { x, z, yaw, h, occupant: null, kind: 'meet', ...extra }; seats.push(s); return s; }

// Moldura local de uma sala/área: u = de lado a lado, v = da porta pro fundo.
function frameFor(rect, side) {
  const [x0, x1, z0, z1] = rect;
  const s = side === 'n' ? -1 : 1;
  const cx = (x0 + x1) / 2;
  const doorZ = side === 'n' ? z1 : z0;
  return {
    s, cx, doorZ, w: x1 - x0, d: z1 - z0, rect,
    p: (u, v) => [cx + u * s, doorZ + v * s],
    yaw: (t = 0) => (s < 0 ? Math.PI : 0) + t,
  };
}
function putF(F, obj, u, v, t = 0, fw = 0, fd = 0) {
  const [x, z] = F.p(u, v);
  place(obj, x, z, F.yaw(t));
  if (fw && fd) footprint(x, z, fw, fd, F.yaw(t));
  return [x, z];
}

// ---------- Móveis ----------
function plant(x, z, size = 1, kind = null) {
  kind = kind || pick(['bush', 'snake', 'monstera', 'ficus']);
  const g = new THREE.Group();
  const pm = pick([M.pot, M.potT, M.potD]);
  cyl(0.2 * size, 0.15 * size, 0.38 * size, pm, 0, 0.19 * size, 0, g, 18);
  const rim = mesh(new THREE.TorusGeometry(0.2 * size, 0.018 * size, 6, 20), pm);
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.38 * size; g.add(rim);
  cyl(0.19 * size, 0.19 * size, 0.02, M.soil, 0, 0.37 * size, 0, g, 16);
  if (kind === 'ficus') {
    cyl(0.025 * size, 0.035 * size, 1.1 * size, M.trunk, 0, 0.9 * size, 0, g, 6);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      ball(0.2 * size, pick([M.leaf, M.leaf2, M.leaf3]), Math.cos(a) * 0.2 * size, (1.15 + (i % 3) * 0.2) * size, Math.sin(a) * 0.2 * size, g, 1, 0.8, 1);
    }
    ball(0.24 * size, M.leaf, 0, 1.6 * size, 0, g);
  } else if (kind === 'snake') {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + Math.random();
      const h = (0.55 + Math.random() * 0.45) * size;
      const b = mesh(new THREE.ConeGeometry(0.045 * size, h, 4), i % 2 ? M.leaf2 : M.leaf3);
      b.scale.set(1, 1, 0.25);
      b.position.set(Math.cos(a) * 0.07 * size, 0.38 * size + h / 2, Math.sin(a) * 0.07 * size);
      b.rotation.set(Math.sin(a) * 0.15, a, -Math.cos(a) * 0.15);
      g.add(b);
    }
  } else if (kind === 'monstera') {
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const len = (0.35 + Math.random() * 0.25) * size;
      const stem = cyl(0.008 * size, 0.01 * size, len, M.leaf2, Math.cos(a) * len * 0.3, 0.38 * size + len * 0.45, Math.sin(a) * len * 0.3, g, 5);
      stem.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
      const leaf = ball(0.17 * size, i % 2 ? M.leaf : M.leaf2, Math.cos(a) * len * 0.62, 0.38 * size + len * 0.85, Math.sin(a) * len * 0.62, g, 1.1, 0.12, 0.8);
      leaf.rotation.set(Math.sin(a) * 0.5, -a, -Math.cos(a) * 0.5);
    }
  } else {
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      const leaf = ball(0.1 * size, pick([M.leaf, M.leaf2, M.leaf3]), Math.cos(a) * 0.12 * size, 0.55 * size + (i % 3) * 0.05, Math.sin(a) * 0.12 * size, g, 0.55, 2.4, 0.25);
      const tilt = 0.5 + (i % 3) * 0.25;
      leaf.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt);
    }
  }
  place(g, x, z);
  footprint(x, z, 0.45 * size, 0.45 * size);
  return g;
}

function officeChair(x, z, yaw, extra = {}) {
  const g = new THREE.Group();
  const fab = extra.color || M.chair;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = rbox(0.3, 0.035, 0.05, 0.015, M.chrome, Math.cos(a) * 0.15, 0.07, Math.sin(a) * 0.15, g);
    leg.rotation.y = -a;
    ball(0.032, M.black, Math.cos(a) * 0.29, 0.032, Math.sin(a) * 0.29, g);
  }
  cyl(0.06, 0.06, 0.06, M.black, 0, 0.1, 0, g, 12);
  cyl(0.024, 0.024, 0.3, M.chrome, 0, 0.26, 0, g, 10);
  rbox(0.5, 0.09, 0.48, 0.04, fab, 0, 0.44, 0.02, g);
  const back = new THREE.Group();
  rbox(0.46, 0.56, 0.07, 0.035, fab, 0, 0, 0, back);
  rbox(0.38, 0.44, 0.02, 0.01, M.chairMesh, 0, 0, -0.04, back);
  back.position.set(0, 0.79, -0.23); back.rotation.x = -0.12;
  g.add(back);
  rbox(0.06, 0.08, 0.06, 0.02, M.black, 0, 0.5, -0.2, g);
  for (const s of [-1, 1]) {
    rbox(0.035, 0.2, 0.035, 0.012, M.black, 0.25 * s, 0.56, 0, g);
    rbox(0.07, 0.035, 0.26, 0.015, M.black, 0.25 * s, 0.67, 0.02, g);
  }
  place(g, x, z, yaw);
  return addSeat(x + Math.sin(yaw) * 0.04, z + Math.cos(yaw) * 0.04, yaw, 0.48, { kind: 'meet', ...extra });
}
function gamingChair(x, z, yaw, extra = {}) {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    rbox(0.32, 0.035, 0.06, 0.015, M.black, Math.cos(a) * 0.16, 0.07, Math.sin(a) * 0.16, g).rotation.y = -a;
    ball(0.033, M.black, Math.cos(a) * 0.3, 0.033, Math.sin(a) * 0.3, g);
  }
  cyl(0.026, 0.026, 0.32, M.chrome, 0, 0.26, 0, g, 10);
  const acc = extra.accent || M.accent;
  rbox(0.52, 0.1, 0.5, 0.04, M.black, 0, 0.45, 0.02, g);
  rbox(0.2, 0.105, 0.5, 0.04, acc, 0, 0.455, 0.02, g);
  const back = new THREE.Group();
  rbox(0.5, 0.82, 0.09, 0.04, M.black, 0, 0, 0, back);
  rbox(0.18, 0.82, 0.095, 0.04, acc, 0, 0, 0.002, back);
  for (const s of [-1, 1]) rbox(0.08, 0.5, 0.12, 0.03, M.black, 0.24 * s, -0.08, 0.04, back);
  rbox(0.26, 0.12, 0.09, 0.04, acc, 0, 0.38, 0.06, back);
  back.position.set(0, 0.92, -0.24); back.rotation.x = -0.15;
  g.add(back);
  place(g, x, z, yaw);
  return addSeat(x + Math.sin(yaw) * 0.04, z + Math.cos(yaw) * 0.04, yaw, 0.5, { kind: 'meet', ...extra });
}
function simpleChair(x, z, yaw, extra = {}) {
  const g = new THREE.Group();
  const c = extra.color || M.fabricOrange;
  for (const [lx, lz] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.18], [0.19, 0.18]]) cyl(0.014, 0.012, 0.45, M.black, lx, 0.225, lz, g, 6);
  rbox(0.46, 0.07, 0.44, 0.03, c, 0, 0.47, 0, g);
  rbox(0.46, 0.38, 0.05, 0.025, c, 0, 0.72, -0.2, g).rotation.x = -0.08;
  place(g, x, z, yaw);
  return addSeat(x, z, yaw, 0.49, { kind: 'meet', ...extra });
}
function armchair(x, z, yaw, extra = {}) {
  const g = new THREE.Group();
  const c = extra.color || M.fabricRed;
  rbox(0.78, 0.3, 0.72, 0.08, c, 0, 0.3, 0, g);
  rbox(0.78, 0.6, 0.18, 0.08, c, 0, 0.62, -0.29, g);
  for (const s of [-1, 1]) rbox(0.14, 0.42, 0.72, 0.06, c, 0.34 * s, 0.48, 0, g);
  rbox(0.5, 0.1, 0.5, 0.05, extra.cushion || c, 0, 0.49, 0.06, g);
  for (const [lx, lz] of [[-0.32, -0.3], [0.32, -0.3], [-0.32, 0.3], [0.32, 0.3]]) cyl(0.025, 0.02, 0.15, M.woodDark, lx, 0.075, lz, g, 8);
  place(g, x, z, yaw);
  footprint(x, z, 0.5, 0.5, yaw);
  return addSeat(x + Math.sin(yaw) * 0.06, z + Math.cos(yaw) * 0.06, yaw, 0.52, { kind: 'meet', from: 'front', ...extra });
}
function stool(x, z, yaw, extra = {}) {
  const g = new THREE.Group();
  rbox(0.38, 0.07, 0.38, 0.034, M.leather, 0, 0.66, 0, g);
  cyl(0.025, 0.025, 0.62, M.chrome, 0, 0.32, 0, g, 10);
  cyl(0.2, 0.22, 0.025, M.chrome, 0, 0.012, 0, g, 22);
  const ring = mesh(new THREE.TorusGeometry(0.15, 0.012, 6, 20), M.chrome);
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.3; g.add(ring);
  place(g, x, z, yaw);
  return addSeat(x, z, yaw, 0.7, { kind: 'stool', ...extra });
}
function beanbag(x, z, yaw, extra = {}) {
  const g = new THREE.Group();
  ball(0.42, extra.color || pick(M.bean), 0, 0.24, 0, g, 1, 0.55, 1);
  ball(0.3, extra.color || pick(M.bean), 0, 0.42, -0.22, g, 1.15, 0.7, 0.6);
  place(g, x, z, yaw);
  footprint(x, z, 0.4, 0.4);
  return addSeat(x, z, yaw, 0.3, { kind: 'meet', from: 'front', ...extra });
}
function floorCushion(x, z, yaw, extra = {}) {
  const g = new THREE.Group();
  rbox(0.6, 0.14, 0.6, 0.06, extra.color || M.fabricCream, 0, 0.07, 0, g);
  rbox(0.55, 0.06, 0.55, 0.03, M.fabricGreen, 0, 0.15, 0, g);
  place(g, x, z, yaw);
  return addSeat(x, z, yaw, 0.2, { kind: 'meet', from: 'front', ...extra });
}
function sofa(x, z, yaw, len = 2, mat1 = M.fabricBlue, extra = {}) {
  const g = new THREE.Group();
  rbox(len, 0.3, 0.86, 0.06, mat1, 0, 0.24, 0, g);
  rbox(len, 0.48, 0.2, 0.07, mat1, 0, 0.6, -0.33, g);
  for (const s of [-1, 1]) rbox(0.18, 0.52, 0.86, 0.07, mat1, (len / 2 - 0.09) * s, 0.36, 0, g);
  const n = Math.max(1, Math.round((len - 0.36) / 0.62));
  const out = [];
  if (extra.lie) {
    // descanso: uma pessoa deitada ao comprido, cabeça no braço do sofá
    // deitado bem na frente do encosto (o corpo tem ~35 cm de cada lado)
    const [sx, sz] = rotXZ(-0.2, 0.2, yaw);
    out.push(addSeat(x + sx, z + sz, yaw + Math.PI / 2, 0.5, { kind: 'rest', ...extra, lie: true, bedH: 0.47 }));
  }
  for (let i = 0; i < n; i++) {
    const cx = -len / 2 + 0.18 + (i + 0.5) * ((len - 0.36) / n);
    rbox((len - 0.36) / n - 0.03, 0.13, 0.64, 0.05, mat1, cx, 0.45, 0.08, g);
    const bc = rbox((len - 0.36) / n - 0.05, 0.38, 0.14, 0.06, mat1, cx, 0.67, -0.2, g);
    bc.rotation.x = -0.15;
    const [sx, sz] = rotXZ(cx, 0.14, yaw);
    if (!extra.lie) out.push(addSeat(x + sx, z + sz, yaw, 0.5, { kind: 'sofa', ...extra }));
  }
  for (const s of [-1, 1]) { const p = rbox(0.32, 0.3, 0.1, 0.05, M.fabricOrange, (len / 2 - 0.36) * s, 0.62, -0.12, g); p.rotation.set(-0.3, 0.3 * s, 0.15 * s); }
  for (const [lx, lz] of [[-len / 2 + 0.1, -0.35], [len / 2 - 0.1, -0.35], [-len / 2 + 0.1, 0.35], [len / 2 - 0.1, 0.35]]) cyl(0.025, 0.02, 0.09, M.woodDark, lx, 0.045, lz, g, 8);
  place(g, x, z, yaw);
  footprint(x, z, len, 0.9, yaw);
  return out;
}
// Rede de verdade: dois postes, cordas até as pontas, travessas de madeira
// e o pano curvado (afunda no meio e levanta nas bordas), listrado.
const HAMMOCK_TEX = {};
function hammockTex(hex) {
  if (!HAMMOCK_TEX[hex]) HAMMOCK_TEX[hex] = canvasTex(256, 64, (c, w, h) => {
    const base = '#' + new THREE.Color(hex).getHexString();
    for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#f3e6cf' : base; c.fillRect(0, (i * h) / 8, w, h / 8 + 1); }
    c.fillStyle = 'rgba(0,0,0,.08)'; for (let x = 0; x < w; x += 6) c.fillRect(x, 0, 2, h);
  });
  return HAMMOCK_TEX[hex];
}
function hammock(x, z, yaw, color = M.fabricOrange, extra = {}) {
  const g = new THREE.Group();
  const L = 2.9, HL = 1.05, HW = 0.4, Y0 = 0.5, SAG = 0.36, POST = 1.55;
  for (const s of [-1, 1]) {
    cyl(0.065, 0.075, POST, M.woodDark, s * L / 2, POST / 2, 0, g, 10);
    cyl(0.12, 0.12, 0.05, M.woodDark, s * L / 2, 0.025, 0, g, 12);
    // travessa na ponta do pano
    const bar = cyl(0.025, 0.025, HW * 2 + 0.08, M.woodDark, s * HL, Y0 + SAG, 0, g, 8);
    bar.rotation.x = Math.PI / 2;
    // cordas: do topo do poste até as duas pontas da travessa
    const top = new THREE.Vector3(s * L / 2, POST - 0.1, 0);
    for (const zz of [-HW, 0, HW]) {
      const end = new THREE.Vector3(s * HL, Y0 + SAG, zz);
      const len = top.distanceTo(end);
      const r = cyl(0.01, 0.01, len, M.fabricCream, (top.x + end.x) / 2, (top.y + end.y) / 2, (top.z + end.z) / 2, g, 5);
      r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(top).normalize());
    }
  }
  // pano: superfície curva (afunda no meio, bordas sobem)
  const NX = 24, NZ = 8, pos = [], uv = [], idx = [];
  for (let i = 0; i <= NX; i++) for (let j = 0; j <= NZ; j++) {
    const u = i / NX, v = j / NZ, px = (u * 2 - 1) * HL, pz = (v * 2 - 1) * HW;
    const py = Y0 + SAG * (px / HL) ** 2 + 0.16 * (pz / HW) ** 2 * (1 - 0.6 * (px / HL) ** 2);
    pos.push(px, py, pz); uv.push(u, v);
  }
  for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) { const a = i * (NZ + 1) + j, b = a + NZ + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const clothM = new THREE.MeshStandardMaterial({ map: hammockTex(color.color ? color.color.getHex() : 0xc9733f), roughness: 0.95, side: THREE.DoubleSide });
  const cloth = new THREE.Mesh(geo, clothM);
  cloth.castShadow = true; cloth.receiveShadow = true;
  g.add(cloth);
  place(g, x, z, yaw);
  footprint(x, z, L + 0.2, 0.9, yaw);
  const [sx, sz] = rotXZ(-0.2, 0, yaw);
  return addSeat(x + sx, z + sz, yaw + Math.PI / 2, 0.52, { kind: 'rest', ...extra, lie: true, hammock: true, bedH: 0.42 });
}
// Máquina de café (F = pega um café e sai bebendo)
function coffeeBar(x, z, rot) {
  const g = new THREE.Group();
  rbox(2.2, 0.92, 0.6, 0.02, M.cabinet, 0, 0.46, 0, g);
  rbox(2.3, 0.05, 0.66, 0.015, M.stone, 0, 0.945, 0.02, g);
  // máquina de espresso
  rbox(0.5, 0.55, 0.42, 0.04, M.steel, -0.45, 1.25, -0.04, g);
  rbox(0.46, 0.1, 0.38, 0.03, M.black, -0.45, 1.56, -0.04, g);
  rbox(0.3, 0.06, 0.05, 0.02, M.accent, -0.45, 1.4, 0.18, g);
  rbox(0.3, 0.02, 0.2, 0.005, M.chrome, -0.45, 0.98, 0.1, g);
  cyl(0.03, 0.03, 0.08, M.chrome, -0.52, 1.07, 0.12, g, 8);
  cyl(0.03, 0.03, 0.08, M.chrome, -0.38, 1.07, 0.12, g, 8);
  // canecas e açucareiro
  for (let i = 0; i < 4; i++) cyl(0.045, 0.04, 0.1, M.mug[i % M.mug.length], 0.2 + i * 0.13, 1.02, 0.1, g, 12);
  cyl(0.06, 0.06, 0.12, M.white, 0.85, 1.03, -0.05, g, 14);
  // plaquinha
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.3), new THREE.MeshBasicMaterial({ map: canvasTex(360, 120, (c, w, h) => { c.fillStyle = '#2b1d14'; c.fillRect(0, 0, w, h); c.fillStyle = '#f5d9b8'; c.font = '700 54px Sora, Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('☕ Café', w / 2, h / 2 + 3); }), toneMapped: false }));
  sign.position.set(0.3, 1.75, -0.25);
  g.add(sign);
  rbox(0.94, 0.34, 0.03, 0.01, M.woodDark, 0.3, 1.75, -0.27, g);
  // galão de energético (bebedouro preto com faixa verde neon e raio)
  rbox(0.62, 0.9, 0.55, 0.03, M.black, 1.55, 0.45, 0, g);
  const jugM = new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.25, metalness: 0.4, transparent: true, opacity: 0.92 });
  const neonM = new THREE.MeshStandardMaterial({ color: 0x7cff3a, emissive: 0x3fbf00, emissiveIntensity: 0.9, roughness: 0.4 });
  cyl(0.24, 0.24, 0.62, jugM, 1.55, 1.25, 0, g, 22);
  cyl(0.245, 0.245, 0.09, neonM, 1.55, 1.3, 0, g, 22);
  cyl(0.1, 0.24, 0.12, jugM, 1.55, 1.62, 0, g, 22);
  cyl(0.06, 0.06, 0.08, neonM, 1.55, 1.72, 0, g, 12);
  rbox(0.08, 0.08, 0.1, 0.02, M.chrome, 1.55, 0.98, 0.3, g);
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.26), new THREE.MeshBasicMaterial({ toneMapped: false, map: canvasTex(220, 130, (c, w, h) => {
    c.fillStyle = '#0d0f11'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#7cff3a'; c.beginPath(); c.moveTo(118, 8); c.lineTo(70, 72); c.lineTo(104, 72); c.lineTo(92, 122); c.lineTo(150, 50); c.lineTo(114, 50); c.closePath(); c.fill();
    c.font = '900 22px Inter, sans-serif'; c.textAlign = 'center'; c.fillStyle = '#e8ffe0'; c.fillText('ENERGÉTICO', w / 2, 116);
  }) }));
  lab.position.set(1.55, 0.6, 0.281); g.add(lab);
  place(g, x, z, rot);
  footprint(x, z, 2.3, 0.66, rot);
  { const [ex, ez] = rotXZ(1.55, 0, rot); footprint(x + ex, z + ez, 0.66, 0.6, rot);
    INTERACT.push({ kind: 'energy', x: x + ex, z: z + ez, yaw: rot, h: 1.35, front: [x + ex + Math.sin(rot) * 0.9, z + ez + Math.cos(rot) * 0.9] }); }
  const [mx, mz] = rotXZ(-0.45, 0, rot);
  INTERACT.push({ kind: 'coffee', x: x + mx, z: z + mz, yaw: rot, h: 1.25, front: [x + mx + Math.sin(rot) * 0.9, z + mz + Math.cos(rot) * 0.9] });
}
// Banheiro: só a porta (ninguém vê dentro). Entra, fica "OCUPADO" uns segundos.
const WC_SIGN = {};
function wcSignMat(busy) {
  if (!WC_SIGN[busy]) WC_SIGN[busy] = new THREE.MeshBasicMaterial({ toneMapped: false, map: canvasTex(256, 96, (c, w, h) => {
    c.fillStyle = busy ? '#7f1d1d' : '#14532d'; c.fillRect(0, 0, w, h);
    c.fillStyle = busy ? '#fecaca' : '#bbf7d0'; c.font = '800 40px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(busy ? 'OCUPADO' : 'LIVRE', w / 2, h / 2 + 2);
  }) });
  return WC_SIGN[busy];
}
function wcDoor(x, z, rot, label) {
  const fr = new THREE.Group();
  rbox(1.2, 2.45, 0.22, 0.02, M.white, 0, 1.225, -0.06, fr); // parede/moldura
  rbox(0.96, 2.18, 0.04, 0.01, M.dark, 0, 1.09, 0.05, fr);   // vão escuro
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshBasicMaterial({ toneMapped: false, map: canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#1f1b24'; c.beginPath(); c.arc(64, 64, 62, 0, 7); c.fill();
    c.fillStyle = '#fff'; c.font = '800 46px Inter, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, 64, 68);
  }) }));
  plate.position.set(0, 2.62, 0.06);
  fr.add(plate);
  place(fr, x, z, rot);
  // porta que abre (gira na dobradiça) + placa LIVRE/OCUPADO
  const pivot = new THREE.Group();
  const panel = rbox(0.92, 2.14, 0.05, 0.015, M.deskWood, 0.46, 1.08, 0, pivot);
  rbox(0.04, 0.16, 0.04, 0.01, M.chrome, 0.82, 1.05, 0.05, pivot);
  void panel;
  const [px, pz] = rotXZ(-0.46, 0.09, rot);
  place(pivot, x + px, z + pz, rot, 0, dynamic);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.15), wcSignMat(false));
  const sg = new THREE.Group(); sign.position.set(0.46, 1.62, 0.03); sg.add(sign);
  pivot.add(sg);
  footprint(x, z, 1.2, 0.3, rot);
  INTERACT.push({ kind: 'wc', x, z, yaw: rot, h: 1.2, door: pivot, sign, busy: 0, open: 0, front: [x + Math.sin(rot) * 0.95, z + Math.cos(rot) * 0.95], label });
}
// Telão da recepção (ranking de tempo no app entre amigos)
function bigBoard(x, z, rot) {
  const g = new THREE.Group();
  const W = 3.2, H = 1.8;
  rbox(W + 0.14, H + 0.14, 0.12, 0.03, M.black, 0, 1.75, 0, g);
  for (const s of [-1, 1]) rbox(0.1, 1.0, 0.1, 0.02, M.black, s * (W / 2 - 0.4), 0.5, -0.02, g);
  rbox(W - 0.4, 0.06, 0.5, 0.02, M.black, 0, 0.03, -0.02, g);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ color: 0x111018, toneMapped: false }));
  scr.position.set(0, 1.75, 0.065);
  scr.userData.keep = true;
  g.add(scr);
  place(g, x, z, rot);
  footprint(x, z, W, 0.5, rot);
  BOARD = { mesh: scr, x, z, yaw: rot };
}
function coffeeTable(x, z, yaw, w = 1.1, d = 0.6) {
  const g = new THREE.Group();
  rbox(w, 0.05, d, 0.02, M.deskWood, 0, 0.42, 0, g);
  rbox(w - 0.1, 0.03, d - 0.1, 0.01, M.woodDark, 0, 0.14, 0, g);
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) cyl(0.022, 0.018, 0.4, M.black, lx * (w / 2 - 0.08), 0.2, lz * (d / 2 - 0.08), g, 8);
  if (Math.random() < 0.7) cyl(0.04, 0.035, 0.09, pick(M.mug), 0.15, 0.49, 0.05, g, 14);
  rbox(0.24, 0.03, 0.18, 0.01, pick(M.book), -0.2, 0.46, -0.03, g).rotation.y = 0.3;
  place(g, x, z, yaw);
  footprint(x, z, w, d, yaw);
}
function rug(x, z, yaw, w, d, colors) {
  const t = canvasTex(256, 256, (g) => {
    g.fillStyle = colors[0]; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = colors[1]; g.lineWidth = 10; g.strokeRect(14, 14, 228, 228);
    g.lineWidth = 3; g.strokeRect(30, 30, 196, 196);
    g.fillStyle = colors[1];
    for (let i = 0; i < 5; i++) { g.save(); g.translate(128, 128); g.rotate((i / 5) * Math.PI * 2); g.fillRect(-6, 30, 12, 40); g.restore(); }
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
  m.rotation.set(-Math.PI / 2, 0, yaw);
  m.position.set(x, 0.012, z);
  m.receiveShadow = true;
  worldGroup.add(m);
}
function floorLamp(x, z) {
  const g = new THREE.Group();
  cyl(0.16, 0.18, 0.03, M.black, 0, 0.015, 0, g, 20);
  cyl(0.012, 0.012, 1.5, M.black, 0, 0.76, 0, g, 6);
  cyl(0.16, 0.22, 0.3, M.lampGlow, 0, 1.5, 0, g, 20);
  place(g, x, z);
  footprint(x, z, 0.3, 0.3);
}
function deskLamp(g, x, z) {
  cyl(0.06, 0.07, 0.02, M.black, x, 0.77, z, g, 14);
  const arm = cyl(0.008, 0.008, 0.36, M.black, x, 0.94, z - 0.03, g, 6);
  arm.rotation.x = 0.25;
  const head = mesh(new THREE.ConeGeometry(0.07, 0.1, 16, 1, true), M.black);
  head.position.set(x, 1.11, z + 0.05); head.rotation.x = Math.PI * 0.8; g.add(head);
  ball(0.025, M.lampGlow, x, 1.09, z + 0.06, g);
}
function monitor(g, mx, mz, ang, screen, w = 0.56, h = 0.33) {
  const mon = new THREE.Group();
  rbox(0.22, 0.015, 0.16, 0.007, M.dark, 0, 0.765, 0, mon);
  rbox(0.04, 0.25, 0.025, 0.01, M.dark, 0, 0.89, -0.03, mon);
  rbox(w + 0.02, h + 0.02, 0.025, 0.01, M.black, 0, 1.08, 0, mon);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(w, h), SCREEN[screen]);
  scr.position.set(0, 1.08, 0.0135);
  mon.add(scr);
  mon.position.set(mx, 0, mz);
  mon.rotation.y = ang;
  g.add(mon);
}
function desk(x, z, rot, { screen, sector, wood = false, rgb = false }) {
  const g = new THREE.Group();
  rbox(1.4, 0.035, 0.72, 0.012, wood ? M.deskWood : M.deskWhite, 0, 0.74, 0, g);
  for (const s of [-1, 1]) {
    rbox(0.04, 0.7, 0.04, 0.008, M.metal, 0.62 * s, 0.37, -0.3, g);
    rbox(0.04, 0.7, 0.04, 0.008, M.metal, 0.62 * s, 0.37, 0.3, g);
    rbox(0.04, 0.03, 0.64, 0.008, M.metal, 0.62 * s, 0.015, 0, g);
    rbox(0.04, 0.03, 0.64, 0.008, M.metal, 0.62 * s, 0.71, 0, g);
  }
  rbox(1.2, 0.08, 0.12, 0.02, M.dark, 0, 0.62, -0.26, g);
  const dual = screen === 'code' || screen === 'sheet' || screen === 'art';
  if (dual) { monitor(g, -0.29, -0.18, 0.2, screen); monitor(g, 0.29, -0.18, -0.2, screen === 'art' ? 'doc' : screen); }
  else monitor(g, 0, -0.18, 0, screen);
  const kb = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.018, 0.13, 1, 0.006), new THREE.MeshStandardMaterial({ map: TEX.keys, roughness: 0.6 }));
  kb.position.set(0, 0.768, 0.12); kb.castShadow = true; g.add(kb);
  ball(0.03, M.dark, 0.32, 0.77, 0.13, g, 1, 0.5, 1.5);
  if (rgb) rbox(1.3, 0.01, 0.01, 0.003, M.ledPink, 0, 0.72, 0.36, g);
  if (Math.random() < 0.6) {
    const mx = -0.52, mz = 0.1;
    cyl(0.04, 0.036, 0.09, pick(M.mug), mx, 0.805, mz, g, 14);
    const h = mesh(new THREE.TorusGeometry(0.025, 0.008, 6, 12), M.mug[0]);
    h.position.set(mx + 0.045, 0.805, mz); g.add(h);
  }
  if (Math.random() < 0.35) rbox(0.22, 0.012, 0.3, 0.004, M.paper, 0.48, 0.765, 0.05, g).rotation.y = 0.2;
  if (Math.random() < 0.3) deskLamp(g, 0.55, -0.22);
  else if (Math.random() < 0.3) {
    cyl(0.05, 0.04, 0.08, M.pot, -0.55, 0.8, -0.22, g, 12);
    ball(0.07, M.leaf, -0.55, 0.88, -0.22, g);
  }
  place(g, x, z, rot);
  const [cx, cz] = rotXZ(0, 0.62, rot);
  const seat = officeChair(x + cx, z + cz, rot + Math.PI, { kind: 'desk', sector });
  INTERACT.push({ kind: 'pc', x, z, seat, screen });
  return seat;
}
function deskCluster(cx, cz, rot, opts) {
  const out = [];
  const pts = [[-0.7, 0.36, 0], [0.7, 0.36, 0], [-0.7, -0.36, Math.PI], [0.7, -0.36, Math.PI]];
  for (const [lx, lz, r] of pts) {
    const [dx, dz] = rotXZ(lx, lz, rot);
    out.push(desk(cx + dx, cz + dz, rot + r, opts));
  }
  const div = rbox(2.8, 0.42, 0.04, 0.015, M.frosted, 0, 0.97, 0, null);
  div.castShadow = false;
  place(div, cx, cz, rot);
  footprint(cx, cz, 2.84, 1.48, rot);
  return out;
}
function bookshelf(x, z, rot, w = 1.6, h = 1.8) {
  const g = new THREE.Group();
  rbox(w, h, 0.04, 0.01, M.woodDark, 0, h / 2, -0.17, g);
  for (const s of [-1, 1]) rbox(0.04, h, 0.36, 0.01, M.woodDark, (w / 2) * s, h / 2, 0, g);
  const rows = Math.round(h / 0.44);
  for (let i = 0; i <= rows; i++) {
    rbox(w, 0.03, 0.36, 0.008, M.woodDark, 0, 0.02 + i * (h / rows), 0, g);
    if (i === rows) continue;
    let bx = -w / 2 + 0.06;
    while (bx < w / 2 - 0.12) {
      const bw = 0.035 + Math.random() * 0.05;
      const bh = 0.24 + Math.random() * 0.1;
      if (Math.random() < 0.82) {
        const b = box(bw, bh, 0.24, pick(M.book), bx, 0.04 + i * (h / rows) + bh / 2, 0.02, g);
        if (Math.random() < 0.08) b.rotation.z = 0.25;
      } else if (Math.random() < 0.3) {
        ball(0.06, pick([M.pot, M.leaf]), bx + 0.06, 0.1 + i * (h / rows), 0.02, g);
        bx += 0.1;
      }
      bx += bw + 0.008;
    }
  }
  place(g, x, z, rot);
  footprint(x, z, w, 0.4, rot);
}
function whiteboard(x, z, rot) {
  const g = new THREE.Group();
  rbox(1.6, 0.95, 0.04, 0.01, M.whiteboard, 0, 1.45, 0, g);
  rbox(1.66, 0.04, 0.09, 0.01, M.frame, 0, 0.96, 0.02, g);
  for (const s of [-1, 1]) {
    rbox(0.04, 1.9, 0.04, 0.01, M.frame, 0.78 * s, 0.95, -0.03, g);
    rbox(0.05, 0.04, 0.5, 0.01, M.frame, 0.78 * s, 0.03, -0.03, g);
  }
  const ink = [M.accent, M.book[1], M.dark];
  for (let i = 0; i < 6; i++) box(0.3 + Math.random() * 0.5, 0.02, 0.005, pick(ink), -0.3 + Math.random() * 0.4, 1.7 - i * 0.12, 0.025, g);
  box(0.25, 0.25, 0.005, M.book[2], 0.55, 1.6, 0.025, g);
  place(g, x, z, rot);
  footprint(x, z, 1.7, 0.5, rot);
}
let CUR_ROOM = null; // sala sendo montada agora (as TVs ficam sabendo de qual sala são)
function tvStand(x, z, rot, screen = 'slide', w = 1.5) {
  const it = { kind: 'tv', x, z, yaw: rot, screen, room: CUR_ROOM, h: 1.3, front: [x + Math.sin(rot) * 1.5, z + Math.cos(rot) * 1.5] };
  INTERACT.push(it);
  const g = new THREE.Group();
  rbox(0.7, 0.05, 0.5, 0.02, M.black, 0, 0.025, 0, g);
  rbox(0.08, 1.3, 0.08, 0.02, M.black, 0, 0.67, 0, g);
  const h = w * 0.58;
  rbox(w + 0.04, h + 0.04, 0.05, 0.015, M.black, 0, 1.25 + (w > 2 ? 0.3 : 0), 0.04, g);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(w, h), SCREEN[screen]);
  scr.position.set(0, 1.25 + (w > 2 ? 0.3 : 0), 0.066);
  scr.userData.keep = true; // fica fora do "merge" pra poder trocar a imagem (transmissão)
  it.mesh = scr; it.baseMat = SCREEN[screen]; it.aspect = w / h;
  g.add(scr);
  place(g, x, z, rot);
  footprint(x, z, Math.max(0.7, w * 0.4), 0.5, rot);
}
// TV de parede (salas que não têm TV no tema): presa no fundo ou na lateral
// direita, virada pra dentro, acima da cabeça — não ocupa chão.
const WALL_TV_SPOT = {
  oneonone: ['back', -0.6], zen: ['back', 0.15], descanso: ['back', 0],
  studio: ['right', 0.8], cafe: ['right', 0], biblioteca: ['right', 0.6], arcade: ['right', 0.9], dorm: ['right', 0],
};
function wallTv(F, theme, screen = 'slide') {
  const [side, off] = WALL_TV_SPOT[theme] || ['right', 0];
  let x, z, rot, w;
  if (side === 'back') { [x, z] = F.p(off, F.d - 0.09); rot = F.yaw(Math.PI); w = Math.min(1.6, F.w - 2.4); }
  else { [x, z] = F.p(F.w / 2 - 0.09, F.d / 2 + off); rot = F.yaw(-Math.PI / 2); w = Math.min(1.5, F.d - 2.6); }
  w = Math.max(0.9, w);
  const h = w * 0.58, y = 1.85;
  const it = { kind: 'tv', x, z, yaw: rot, screen, room: CUR_ROOM, h: y, front: [x + Math.sin(rot) * 1.6, z + Math.cos(rot) * 1.6] };
  INTERACT.push(it);
  const g = new THREE.Group();
  rbox(w + 0.06, h + 0.06, 0.05, 0.015, M.black, 0, y, 0.0, g);
  rbox(0.3, 0.2, 0.04, 0.01, M.black, 0, y, -0.04, g);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(w, h), SCREEN[screen]);
  scr.position.set(0, y, 0.027);
  scr.userData.keep = true;
  it.mesh = scr; it.baseMat = SCREEN[screen]; it.aspect = w / h;
  g.add(scr);
  place(g, x, z, rot);
}
function credenza(x, z, rot, w = 1.6) {
  const g = new THREE.Group();
  rbox(w, 0.6, 0.45, 0.02, M.deskWood, 0, 0.32, 0, g);
  for (let i = 0; i < 3; i++) rbox(0.015, 0.4, 0.01, 0.004, M.black, -w / 3 + i * (w / 3) + 0.25, 0.32, 0.23, g);
  for (const s of [-1, 1]) cyl(0.02, 0.015, 0.04, M.black, (w / 2 - 0.08) * s, 0.02, 0, g, 6);
  ball(0.09, M.pot, w / 2 - 0.25, 0.72, 0, g, 1, 1.4, 1);
  place(g, x, z, rot);
  footprint(x, z, w, 0.46, rot);
}
function waterCooler(x, z, rot) {
  const g = new THREE.Group();
  rbox(0.34, 0.95, 0.34, 0.03, M.white, 0, 0.475, 0, g);
  rbox(0.2, 0.08, 0.06, 0.01, M.dark, 0, 0.75, 0.18, g);
  cyl(0.15, 0.15, 0.42, M.water, 0, 1.17, 0, g, 18);
  place(g, x, z, rot);
  footprint(x, z, 0.4, 0.4, rot);
}
function printer(x, z, rot) {
  const g = new THREE.Group();
  rbox(0.7, 0.6, 0.6, 0.03, M.white, 0, 0.3, 0, g);
  rbox(0.66, 0.35, 0.56, 0.03, M.dark, 0, 0.78, 0, g);
  rbox(0.4, 0.02, 0.25, 0.005, M.paper, 0, 0.97, 0.05, g);
  rbox(0.15, 0.04, 0.1, 0.01, M.accent, 0.22, 0.97, 0.22, g);
  place(g, x, z, rot);
  footprint(x, z, 0.72, 0.62, rot);
}
function roundTable(x, z, r = 0.45, h = 0.75, top = M.deskWhite) {
  const g = new THREE.Group();
  cyl(r, r, 0.04, top, 0, h, 0, g, 32);
  cyl(0.04, 0.05, h, M.chrome, 0, h / 2, 0, g, 12);
  cyl(0.26, 0.28, 0.03, M.chrome, 0, 0.015, 0, g, 24);
  if (Math.random() < 0.7) cyl(0.04, 0.035, 0.09, pick(M.mug), 0.1, h + 0.065, 0.05, g, 14);
  place(g, x, z);
  footprint(x, z, r * 1.5, r * 1.5);
}

// Parede de vidro com porta de correr
function glassWall(x0, z0, x1, z1, door) {
  const alongX = Math.abs(z0 - z1) < 1e-6;
  const a0 = alongX ? Math.min(x0, x1) : Math.min(z0, z1);
  const a1 = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
  const segs = door ? [[a0, door[0]], [door[1], a1]] : [[a0, a1]];
  const fixed = alongX ? z0 : x0;
  for (const [a, b] of segs) {
    const L = b - a;
    if (L < 0.05) continue;
    const mid = (a + b) / 2;
    const g = new THREE.Group();
    const gl = box(alongX ? L : 0.03, 2.25, alongX ? 0.03 : L, M.glass, 0, 1.2, 0, g); gl.castShadow = false;
    box(alongX ? L : 0.07, 0.08, alongX ? 0.07 : L, M.frame, 0, 0.04, 0, g);
    box(alongX ? L : 0.07, 0.06, alongX ? 0.07 : L, M.frame, 0, 2.35, 0, g);
    const fr = box(alongX ? L : 0.032, 0.14, alongX ? 0.032 : L, M.frosted, 0, 1.1, 0, g); fr.castShadow = false;
    const posts = Math.max(1, Math.round(L / 1.6));
    for (let i = 0; i <= posts; i++) {
      const t = -L / 2 + (i * L) / posts;
      rbox(0.06, 2.38, 0.06, 0.01, M.frame, alongX ? t : 0, 1.19, alongX ? 0 : t, g);
    }
    place(g, alongX ? mid : fixed, alongX ? fixed : mid);
    if (alongX) addCollider(a, b, fixed - 0.06, fixed + 0.06);
    else addCollider(fixed - 0.06, fixed + 0.06, a, b);
  }
  if (door) {
    const [d0, d1] = door;
    const w = (d1 - d0) / 2;
    const center = (d0 + d1) / 2;
    const panels = [-1, 1].map((s) => {
      const p = new THREE.Group();
      const gl = box(alongX ? w : 0.04, 2.2, alongX ? 0.04 : w, M.glass, 0, 1.15, 0, p); gl.castShadow = false;
      box(alongX ? w : 0.05, 0.05, alongX ? 0.05 : w, M.frame, 0, 0.06, 0, p);
      box(alongX ? w : 0.05, 0.05, alongX ? 0.05 : w, M.frame, 0, 2.24, 0, p);
      rbox(alongX ? 0.03 : 0.07, 0.5, alongX ? 0.07 : 0.03, 0.01, M.chrome, alongX ? -s * (w / 2 - 0.06) : 0, 1.05, alongX ? 0 : -s * (w / 2 - 0.06), p);
      dynamic.add(p);
      return p;
    });
    box(alongX ? d1 - d0 + 0.1 : 0.1, 0.1, alongX ? 0.1 : d1 - d0 + 0.1, M.frame, alongX ? center : fixed, 2.36, alongX ? fixed : center, statics);
    doors.push({ panels, alongX, center, fixed, w, open: 0 });
  }
}

// ---------- Temas das salas ----------
// Cada função recebe a moldura F da sala (u: -w/2..w/2, v: 0 na porta → d no fundo)
const THEME_BUILD = {
  meeting(F, room) {
    const len = Math.min(F.d - 2.8, 3.8);
    const vC = F.d / 2 + 0.2;
    const g = new THREE.Group();
    rbox(1.2, 0.05, len, 0.05, M.deskWood, 0, 0.75, 0, g);
    for (const s of [-1, 1]) {
      rbox(0.12, 0.7, 0.12, 0.02, M.metal, 0, 0.37, s * (len / 2 - 0.45), g);
      rbox(0.55, 0.03, 0.85, 0.01, M.metal, 0, 0.02, s * (len / 2 - 0.45), g);
    }
    for (let i = 0; i < 3; i++) {
      const lz = -len / 2 + 0.6 + i * ((len - 1.2) / 2);
      const lap = new THREE.Group();
      rbox(0.34, 0.015, 0.24, 0.006, M.steel, 0, 0.785, 0, lap);
      const sc = rbox(0.34, 0.22, 0.012, 0.006, M.steel, 0, 0.89, -0.12, lap);
      sc.rotation.x = -0.3;
      lap.position.set(i % 2 ? 0.27 : -0.27, 0, lz);
      lap.rotation.y = i % 2 ? -Math.PI / 2 : Math.PI / 2;
      g.add(lap);
    }
    cyl(0.035, 0.035, 0.22, M.water, 0.05, 0.88, 0.1, g, 12);
    putF(F, g, 0, vC, 0, 1.2, len);
    const n = Math.max(2, Math.round((len - 0.6) / 0.95));
    for (let i = 0; i < n; i++) {
      const t = -len / 2 + 0.5 + (i * (len - 1)) / Math.max(1, n - 1);
      for (const s of [-1, 1]) {
        const [x, z] = F.p(s * 0.98, vC + t);
        officeChair(x, z, F.yaw(s < 0 ? Math.PI / 2 : -Math.PI / 2), { room: room.id, sector: room.sector });
      }
    }
    const [ex, ez] = F.p(0, vC - len / 2 - 0.58);
    officeChair(ex, ez, F.yaw(0), { room: room.id, sector: room.sector });
    const [tx, tz] = F.p(0, F.d - 0.45);
    tvStand(tx, tz, F.yaw(Math.PI), room.sector === 'comercial' ? 'dash' : 'slide', 1.7);
    const [wx, wz] = F.p(-F.w / 2 + 0.35, F.d / 2);
    whiteboard(wx, wz, F.yaw(Math.PI / 2));
    const [cx2, cz2] = F.p(F.w / 2 - 0.35, F.d / 2 + 0.6);
    credenza(cx2, cz2, F.yaw(-Math.PI / 2), 1.5);
    plant(...F.p(F.w / 2 - 0.5, F.d - 0.5), 1.1, 'ficus');
  },
  oneonone(F, room) {
    const vC = F.d / 2 + 0.6;
    roundTable(...F.p(-0.6, vC), 0.5, 0.75, M.deskWood);
    for (const [du, dv] of [[0, -0.95], [-0.85, 0.5], [0.85, 0.5]]) {
      const [x, z] = F.p(-0.6 + du, vC + dv);
      const yaw = Math.atan2(F.p(-0.6, vC)[0] - x, F.p(-0.6, vC)[1] - z);
      officeChair(x, z, yaw, { room: room.id, sector: room.sector, color: M.fabricGray });
    }
    sofa(...F.p(F.w / 2 - 0.55, vC), F.yaw(-Math.PI / 2), 1.6, M.fabricOrange, { room: room.id, sector: room.sector });
    rug(...F.p(0, vC), F.yaw(), F.w - 1, 3, ['#d9cbb8', '#b7926d']);
    floorLamp(...F.p(F.w / 2 - 0.5, F.d - 0.5));
    plant(...F.p(-F.w / 2 + 0.5, F.d - 0.5), 1.2, 'monstera');
    plant(...F.p(-F.w / 2 + 0.5, 0.8), 0.9, 'snake');
  },
  games(F, room) {
    // fita de LED no fundo + placa neon
    const led = new THREE.Group();
    rbox(F.w - 0.6, 0.04, 0.04, 0.01, M.ledPink, 0, 1.05, 0, led);
    rbox(F.w - 0.6, 0.04, 0.04, 0.01, M.ledBlue, 0, 0.25, 0, led);
    putF(F, led, 0, F.d - 0.2);
    const neon = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.75), SCREEN.neon);
    neon.position.y = 1.9;
    const nb = new THREE.Group(); nb.add(neon); rbox(0.06, 1.6, 0.06, 0.01, M.black, 0, 0.8, -0.03, nb);
    putF(F, nb, -F.w / 4, F.d - 0.4, Math.PI);
    // TV grande + console + sofá
    tvStand(...F.p(F.w / 4, F.d - 0.45), F.yaw(Math.PI), 'game', 1.9);
    const con = new THREE.Group();
    rbox(1.2, 0.4, 0.4, 0.03, M.black, 0, 0.2, 0, con);
    rbox(0.3, 0.06, 0.25, 0.02, M.white, -0.2, 0.43, 0, con);
    ball(0.06, M.black, 0.25, 0.44, 0.05, con, 1.4, 0.5, 1);
    putF(F, con, F.w / 4, F.d - 1.05, Math.PI, 1.2, 0.4);
    sofa(...F.p(F.w / 4, F.d / 2 - 0.4), F.yaw(0), 2.2, M.fabricBlue, { room: room.id, sector: room.sector });
    beanbag(...F.p(F.w / 4 - 1.5, F.d / 2 + 0.7), F.yaw(0.5), { room: room.id, sector: room.sector });
    beanbag(...F.p(F.w / 4 + 1.5, F.d / 2 + 0.7), F.yaw(-0.5), { room: room.id, sector: room.sector });
    // mesas gamer na lateral
    for (let i = 0; i < 2; i++) {
      const v = 1.4 + i * 1.6;
      const g = new THREE.Group();
      rbox(1.3, 0.04, 0.7, 0.015, M.black, 0, 0.74, 0, g);
      for (const s of [-1, 1]) rbox(0.06, 0.72, 0.6, 0.02, M.black, 0.6 * s, 0.36, 0, g);
      rbox(1.2, 0.01, 0.01, 0.003, M.ledPink, 0, 0.72, 0.35, g);
      monitor(g, 0, -0.15, 0, 'game', 0.7, 0.38);
      rbox(0.22, 0.45, 0.45, 0.02, M.black, 0.5, 0.97, -0.05, g);
      rbox(0.01, 0.4, 0.38, 0.003, M.ledBlue, 0.39, 0.97, -0.05, g);
      const kb = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.02, 0.13, 1, 0.006), new THREE.MeshStandardMaterial({ map: TEX.keys, emissive: 0x3fa0ff, emissiveIntensity: 0.3 }));
      kb.position.set(0, 0.77, 0.14); g.add(kb);
      putF(F, g, -F.w / 2 + 0.5, v, Math.PI / 2, 1.3, 0.7);
      const [cx, cz] = F.p(-F.w / 2 + 1.15, v);
      gamingChair(cx, cz, F.yaw(-Math.PI / 2), { room: room.id, sector: room.sector, accent: i ? M.ledBlue : M.accent });
    }
    // fliperama
    const arc = new THREE.Group();
    rbox(0.7, 1.75, 0.7, 0.03, M.foam2, 0, 0.875, 0, arc);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.4), SCREEN.game);
    scr.position.set(0, 1.35, 0.36); scr.rotation.x = -0.15; arc.add(scr);
    rbox(0.66, 0.1, 0.3, 0.02, M.black, 0, 1.0, 0.42, arc);
    cyl(0.012, 0.012, 0.08, M.black, -0.12, 1.08, 0.45, arc, 6);
    ball(0.025, M.accent, -0.12, 1.13, 0.45, arc);
    ball(0.025, M.ledBlue, 0.08, 1.06, 0.45, arc); ball(0.025, M.ledPink, 0.16, 1.06, 0.45, arc);
    rbox(0.7, 0.18, 0.05, 0.02, M.ledPink, 0, 1.68, 0.34, arc);
    putF(F, arc, F.w / 2 - 0.55, 1.0, -Math.PI / 2, 0.75, 0.75);
    rug(...F.p(F.w / 4, F.d / 2 + 0.5), F.yaw(), 3.6, 2.4, ['#2a1b3d', '#ff5fd2']);
  },
  cinema(F, room) {
    tvStand(...F.p(0, F.d - 0.35), F.yaw(Math.PI), 'movie', Math.min(F.w - 1.4, 4.4));
    const rows = 3, per = Math.max(3, Math.floor((F.w - 1.2) / 0.95));
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < per; i++) {
        const u = -((per - 1) * 0.95) / 2 + i * 0.95;
        const [x, z] = F.p(u, F.d - 2.7 - r * 1.25);
        armchair(x, z, F.yaw(0), { room: room.id, sector: room.sector, color: M.fabricRed });
      }
    }
    // pipoqueira
    const pop = new THREE.Group();
    rbox(0.6, 0.7, 0.5, 0.03, M.fabricRed, 0, 0.35, 0, pop);
    rbox(0.56, 0.55, 0.46, 0.02, M.glass, 0, 0.98, 0, pop);
    for (let i = 0; i < 18; i++) ball(0.03, M.fabricCream, -0.2 + Math.random() * 0.4, 0.75 + Math.random() * 0.15, -0.15 + Math.random() * 0.3, pop);
    rbox(0.64, 0.12, 0.54, 0.03, M.fabricRed, 0, 1.31, 0, pop);
    putF(F, pop, F.w / 2 - 0.5, 0.8, -Math.PI / 2, 0.6, 0.5);
    for (const u of [-F.w / 2 + 0.3, F.w / 2 - 0.3]) {
      const sc = new THREE.Group();
      rbox(0.12, 0.25, 0.08, 0.02, M.lampGlow, 0, 1.6, 0, sc);
      cyl(0.015, 0.015, 1.5, M.black, 0, 0.75, 0, sc, 6);
      putF(F, sc, u, F.d / 2);
    }
  },
  studio(F, room) {
    // painéis acústicos no fundo
    const panel = new THREE.Group();
    const cols = Math.floor((F.w - 1) / 0.5);
    for (let i = 0; i < cols; i++) for (let j = 0; j < 3; j++) rbox(0.44, 0.44, 0.08, 0.04, (i + j) % 2 ? M.foam : M.foam2, -((cols - 1) * 0.5) / 2 + i * 0.5, 0.6 + j * 0.5, 0, panel);
    putF(F, panel, 0, F.d - 0.15, Math.PI);
    const onair = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.56), SCREEN.onair);
    onair.position.y = 2.15;
    const oa = new THREE.Group(); oa.add(onair);
    putF(F, oa, 0, F.d - 0.12, Math.PI);
    // mesa redonda com microfones
    const vC = F.d / 2 + 0.3;
    roundTable(...F.p(0, vC), 0.7, 0.75, M.black);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const [x, z] = F.p(Math.cos(a) * 1.15, vC + Math.sin(a) * 1.15);
      const [tx, tz] = F.p(0, vC);
      officeChair(x, z, Math.atan2(tx - x, tz - z), { room: room.id, sector: room.sector, color: M.dark });
      const mic = new THREE.Group();
      cyl(0.05, 0.06, 0.02, M.black, 0, 0.77, 0, mic, 12);
      const pole = cyl(0.008, 0.008, 0.3, M.black, 0, 0.92, 0, mic, 6);
      pole.rotation.x = 0.4;
      ball(0.035, M.chrome, 0, 1.03, 0.14, mic, 1, 1.6, 1);
      const [mx, mz] = F.p(Math.cos(a) * 0.45, vC + Math.sin(a) * 0.45);
      place(mic, mx, mz, Math.atan2(x - mx, z - mz));
    }
    // violão e teclado
    const gtr = new THREE.Group();
    ball(0.2, M.wood, 0, 0.42, 0, gtr, 1, 1, 0.35);
    ball(0.15, M.wood, 0, 0.7, 0, gtr, 1, 1, 0.35);
    rbox(0.06, 0.62, 0.03, 0.01, M.woodDark, 0, 1.1, 0.02, gtr);
    cyl(0.05, 0.05, 0.02, M.black, 0, 0.55, 0.07, gtr, 14).rotation.x = Math.PI / 2;
    gtr.rotation.x = -0.15;
    putF(F, gtr, -F.w / 2 + 0.5, 1.0, Math.PI / 2, 0.4, 0.4);
    const kbd = new THREE.Group();
    rbox(1.1, 0.1, 0.32, 0.02, M.black, 0, 0.8, 0, kbd);
    const keys = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.16), new THREE.MeshStandardMaterial({ map: canvasTex(256, 40, (g) => { g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 40); g.fillStyle = '#111'; for (let i = 0; i < 36; i++) { if ([1, 2, 4, 5, 6].includes(i % 7)) g.fillRect(i * 7.1 + 4, 0, 4, 24); g.fillRect(i * 7.1, 0, 0.8, 40); } }) }));
    keys.rotation.x = -Math.PI / 2; keys.position.set(0, 0.852, 0.06); kbd.add(keys);
    for (const s of [-1, 1]) { const l = rbox(0.04, 0.8, 0.04, 0.01, M.black, 0.4 * s, 0.4, 0, kbd); l.rotation.z = 0.35 * s; }
    putF(F, kbd, F.w / 2 - 0.5, F.d / 2 - 0.4, -Math.PI / 2, 1.1, 0.4);
    sofa(...F.p(-F.w / 2 + 0.55, F.d / 2 + 0.6), F.yaw(Math.PI / 2), 1.8, M.fabricGray, { room: room.id, sector: room.sector });
    rug(...F.p(0, vC), F.yaw(), 3.4, 3.4, ['#3a2f45', '#f4511e']);
  },
  zen(F, room) {
    rug(...F.p(0, F.d / 2 + 0.3), F.yaw(), F.w - 1.2, F.d - 1.8, ['#e8dfcf', '#a3b18a']);
    const vC = F.d / 2 + 0.3;
    const low = new THREE.Group();
    rbox(1.0, 0.06, 1.0, 0.04, M.deskWood, 0, 0.3, 0, low);
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) rbox(0.06, 0.28, 0.06, 0.01, M.woodDark, lx * 0.42, 0.14, lz * 0.42, low);
    cyl(0.07, 0.08, 0.12, M.fabricGreen, 0, 0.39, 0, low, 16);
    ball(0.05, M.fabricGreen, 0, 0.46, 0, low);
    putF(F, low, 0, vC, 0, 1.0, 1.0);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const [x, z] = F.p(Math.cos(a) * 1.15, vC + Math.sin(a) * 1.15);
      const [tx, tz] = F.p(0, vC);
      floorCushion(x, z, Math.atan2(tx - x, tz - z), { room: room.id, sector: room.sector, color: pick([M.fabricCream, M.fabricGray, M.fabricOrange]) });
    }
    // fonte de pedras
    const f = new THREE.Group();
    cyl(0.5, 0.55, 0.18, M.stone, 0, 0.09, 0, f, 24);
    cyl(0.44, 0.44, 0.02, M.water, 0, 0.17, 0, f, 24);
    for (let i = 0; i < 4; i++) ball(0.2 - i * 0.04, M.pebble, 0, 0.24 + i * 0.15, 0, f, 1.2, 0.5, 1);
    putF(F, f, -F.w / 2 + 0.9, F.d - 0.9, 0, 1.1, 1.1);
    for (const [i, u] of [-0.6, 0.9, 2.0].entries()) plant(...F.p(u, F.d - 0.4), 1 + (i % 2) * 0.2, i % 2 ? 'snake' : 'monstera');
    plant(...F.p(F.w / 2 - 0.5, 0.8), 1.2, 'ficus');
    // luminária de papel
    const pl = new THREE.Group();
    ball(0.25, M.lampGlow, 0, 0.3, 0, pl, 1, 1.25, 1);
    putF(F, pl, F.w / 2 - 0.6, F.d - 0.6, 0, 0.5, 0.5);
  },
  cafe(F, room) {
    const g = new THREE.Group();
    const cw = Math.min(F.w - 1.6, 5.2);
    rbox(cw, 0.86, 0.62, 0.02, M.cabinet, 0, 0.43, 0, g);
    rbox(cw + 0.1, 0.05, 0.68, 0.015, M.stone, 0, 0.885, 0.02, g);
    for (let i = 0; i < Math.floor(cw / 0.6); i++) rbox(0.03, 0.36, 0.015, 0.007, M.chrome, -cw / 2 + 0.3 + i * 0.6, 0.62, 0.315, g);
    rbox(0.42, 0.52, 0.42, 0.04, M.black, -cw / 2 + 0.5, 1.17, -0.05, g);
    rbox(0.3, 0.1, 0.05, 0.02, M.accent, -cw / 2 + 0.5, 1.32, 0.17, g);
    rbox(0.28, 0.02, 0.18, 0.005, M.chrome, -cw / 2 + 0.5, 0.92, 0.14, g);
    cyl(0.04, 0.035, 0.09, M.mug[0], -cw / 2 + 0.5, 0.97, 0.14, g, 12);
    rbox(0.6, 0.02, 0.4, 0.008, M.steel, 0.1, 0.915, 0, g);
    cyl(0.015, 0.015, 0.3, M.chrome, 0.1, 1.05, -0.18, g, 8);
    rbox(0.5, 0.3, 0.38, 0.03, M.dark, cw / 2 - 0.6, 1.06, -0.04, g);
    for (let i = 0; i < 5; i++) ball(0.05, pick([M.accent, M.leaf3, M.book[2]]), cw / 2 - 1.3 + (i % 3) * 0.1, 0.95 + Math.floor(i / 3) * 0.07, (i % 2) * 0.06, g);
    putF(F, g, -0.4, F.d - 0.48, Math.PI, cw, 0.66);
    SPOTS.coffee = F.p(-0.4 + (cw / 2 - 0.5), F.d - 1.2); // em frente da máquina (girado)
    { const [mx, mz] = F.p(-0.4 + (cw / 2 - 0.5), F.d - 0.5); INTERACT.push({ kind: 'coffee', x: mx, z: mz, h: 1.2, yaw: F.yaw(Math.PI), front: SPOTS.coffee }); }
    const fr = new THREE.Group();
    rbox(0.8, 1.9, 0.7, 0.05, M.fridge, 0, 0.95, 0, fr);
    rbox(0.03, 0.5, 0.04, 0.01, M.chrome, -0.3, 1.25, 0.36, fr);
    putF(F, fr, F.w / 2 - 0.55, F.d - 0.52, Math.PI, 0.8, 0.7);
    const menu = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), SCREEN.menu);
    menu.position.y = 1.75;
    const mb = new THREE.Group(); mb.add(menu); rbox(1.16, 0.76, 0.03, 0.01, M.woodDark, 0, 1.75, -0.02, mb); rbox(0.05, 1.4, 0.05, 0.01, M.woodDark, 0, 0.7, -0.04, mb);
    putF(F, mb, -F.w / 2 + 0.3, F.d / 2, Math.PI / 2, 1.2, 0.3);
    const tables = [[-F.w / 4, 1.9], [F.w / 4, 1.9], [0, F.d / 2 + 0.4]];
    for (const [u, v] of tables) {
      const [tx, tz] = F.p(u, v);
      roundTable(tx, tz, 0.48, 1.0, M.stone);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.4;
        const sx = tx + Math.cos(a) * 0.8, sz = tz + Math.sin(a) * 0.8;
        stool(sx, sz, Math.atan2(tx - sx, tz - sz), { room: room.id, sector: room.sector });
      }
    }
    plant(...F.p(F.w / 2 - 0.5, 0.7), 1.0, 'monstera');
  },
  auditorio(F, room) {
    const st = new THREE.Group();
    rbox(F.w - 0.6, 0.25, 1.8, 0.03, M.stage, 0, 0.125, 0, st);
    rbox(0.5, 1.1, 0.4, 0.04, M.woodDark, -F.w / 4, 0.8, 0.2, st);
    putF(F, st, 0, F.d - 1.0, 0, F.w - 0.6, 1.8);
    tvStand(...F.p(0, F.d - 0.4), F.yaw(Math.PI), 'slide', Math.min(F.w - 2, 3.4));
    const per = Math.max(3, Math.floor((F.w - 1.4) / 0.85));
    const rows = Math.max(2, Math.floor((F.d - 3.6) / 1.1));
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < per; i++) {
        if (per >= 5 && i === Math.floor(per / 2)) continue; // corredor
        const u = -((per - 1) * 0.85) / 2 + i * 0.85;
        const [x, z] = F.p(u, 1.1 + r * 1.1);
        simpleChair(x, z, F.yaw(0), { room: room.id, sector: room.sector, color: r % 2 ? M.fabricBlue : M.fabricGray });
      }
    }
    plant(...F.p(-F.w / 2 + 0.5, F.d - 0.4), 1.1, 'ficus');
    plant(...F.p(F.w / 2 - 0.5, F.d - 0.4), 1.1, 'ficus');
  },
  biblioteca(F, room) {
    const shelves = Math.floor((F.w - 0.6) / 1.7);
    for (let i = 0; i < shelves; i++) bookshelf(...F.p(-((shelves - 1) * 1.7) / 2 + i * 1.7, F.d - 0.36), F.yaw(Math.PI), 1.6, 2.0);
    bookshelf(...F.p(-F.w / 2 + 0.32, F.d / 2), F.yaw(Math.PI / 2), 1.8, 2.0);
    const g = new THREE.Group();
    rbox(2.4, 0.05, 1.0, 0.02, M.deskWood, 0, 0.75, 0, g);
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) rbox(0.06, 0.72, 0.06, 0.01, M.woodDark, lx * 1.1, 0.36, lz * 0.42, g);
    for (const s of [-1, 1]) {
      cyl(0.08, 0.09, 0.02, M.gold, 0.6 * s, 0.785, 0, g, 14);
      cyl(0.01, 0.01, 0.3, M.gold, 0.6 * s, 0.94, 0, g, 6);
      const sh = rbox(0.3, 0.1, 0.14, 0.04, mat(0x2f6b3a, 0.4), 0.6 * s, 1.1, 0, g);
      sh.castShadow = false;
      ball(0.03, M.lampGlow, 0.6 * s, 1.05, 0, g);
      rbox(0.25, 0.03, 0.18, 0.005, pick(M.book), 0.25 * s, 0.79, 0.2, g);
    }
    const vC = F.d / 2 + 0.2;
    putF(F, g, 0.4, vC, Math.PI / 2, 2.4, 1.0);
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) {
      const [x, z] = F.p(0.4 + s * 0.85, vC - 0.8 + i * 0.8);
      simpleChair(x, z, F.yaw(s < 0 ? Math.PI / 2 : -Math.PI / 2), { room: room.id, sector: room.sector, color: M.leather });
    }
    armchair(...F.p(F.w / 2 - 0.7, 1.2), F.yaw(Math.PI + 0.6), { room: room.id, sector: room.sector, color: M.fabricGreen });
    floorLamp(...F.p(F.w / 2 - 0.4, 0.5));
    rug(...F.p(0.4, vC), F.yaw(), 3.6, 2.8, ['#5b2a2a', '#d4a93a']);
  },
};

function arcadeCabinet(x, z, rot, game, color) {
  const arc = new THREE.Group();
  rbox(0.72, 1.75, 0.72, 0.04, color, 0, 0.875, 0, arc);
  rbox(0.74, 0.12, 0.74, 0.03, M.black, 0, 0.06, 0, arc);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.42), SCREEN.game);
  scr.position.set(0, 1.36, 0.365); scr.rotation.x = -0.15; arc.add(scr);
  rbox(0.68, 0.1, 0.32, 0.02, M.black, 0, 1.0, 0.44, arc);
  cyl(0.012, 0.012, 0.08, M.black, -0.14, 1.08, 0.47, arc, 6);
  ball(0.028, M.accent, -0.14, 1.13, 0.47, arc);
  ball(0.025, M.ledBlue, 0.06, 1.065, 0.47, arc); ball(0.025, M.ledPink, 0.15, 1.065, 0.47, arc);
  rbox(0.72, 0.2, 0.06, 0.02, M.ledPink, 0, 1.7, 0.33, arc);
  place(arc, x, z, rot);
  footprint(x, z, 0.75, 0.75, rot);
  INTERACT.push({ kind: 'arcade', x, z, game, front: [x + Math.sin(rot) * 0.95, z + Math.cos(rot) * 0.95], yaw: rot });
}
function bed(x, z, rot, extra = {}) {
  const g = new THREE.Group();
  rbox(0.95, 0.3, 2.0, 0.04, M.woodDark, 0, 0.18, 0, g);
  rbox(0.9, 0.2, 1.92, 0.08, M.white, 0, 0.42, 0, g);
  rbox(0.92, 0.07, 1.3, 0.04, extra.color || M.fabricBlue, 0, 0.53, 0.3, g);
  rbox(0.6, 0.13, 0.32, 0.07, M.fabricCream, 0, 0.58, -0.75, g);
  rbox(1.0, 0.8, 0.08, 0.03, M.woodDark, 0, 0.5, -1.0, g);
  for (const [lx, lz] of [[-0.42, -0.92], [0.42, -0.92], [-0.42, 0.92], [0.42, 0.92]]) cyl(0.03, 0.025, 0.06, M.black, lx, 0.03, lz, g, 8);
  place(g, x, z, rot);
  footprint(x, z, 1.0, 2.1, rot);
  // deita com a cabeça no travesseiro (pro lado -z da cama)
  return addSeat(x, z, rot, 0.52, { kind: 'bed', ...extra, h: 0.52, bedH: 0.5 });
}
// Beliche: cama de baixo + cama de cima (dois lugares pra dormir no mesmo
// espaço), com colunas, grade de proteção e escadinha no pé.
function bunkBed(x, z, rot, extra = {}) {
  const g = new THREE.Group();
  const UP = 1.3; // altura do estrado de cima
  // de baixo
  rbox(0.95, 0.3, 2.0, 0.04, M.woodDark, 0, 0.18, 0, g);
  rbox(0.9, 0.2, 1.92, 0.08, M.white, 0, 0.42, 0, g);
  rbox(0.92, 0.07, 1.3, 0.04, extra.color || M.fabricBlue, 0, 0.53, 0.3, g);
  rbox(0.6, 0.13, 0.32, 0.07, M.fabricCream, 0, 0.58, -0.75, g);
  // de cima
  rbox(0.95, 0.12, 2.0, 0.03, M.woodDark, 0, UP, 0, g);
  rbox(0.9, 0.18, 1.92, 0.08, M.white, 0, UP + 0.15, 0, g);
  rbox(0.92, 0.07, 1.3, 0.04, extra.color2 || M.fabricGray, 0, UP + 0.26, 0.3, g);
  rbox(0.6, 0.13, 0.32, 0.07, M.fabricCream, 0, UP + 0.31, -0.75, g);
  // colunas, cabeceiras e grade
  for (const [lx, lz] of [[-0.46, -0.98], [0.46, -0.98], [-0.46, 0.98], [0.46, 0.98]]) rbox(0.07, UP + 0.75, 0.07, 0.02, M.woodDark, lx, (UP + 0.75) / 2, lz, g);
  rbox(1.0, 0.55, 0.05, 0.02, M.woodDark, 0, 0.45, -1.0, g);
  rbox(1.0, 0.5, 0.05, 0.02, M.woodDark, 0, UP + 0.4, -1.0, g);
  rbox(1.0, 0.3, 0.05, 0.02, M.woodDark, 0, UP + 0.35, 1.0, g);
  rbox(0.05, 0.06, 1.3, 0.02, M.woodDark, 0.47, UP + 0.5, -0.25, g); // grade lateral
  // escadinha no pé
  for (const lx of [0.18, 0.4]) rbox(0.04, UP + 0.4, 0.04, 0.01, M.woodDark, lx, (UP + 0.4) / 2, 1.06, g);
  for (let i = 1; i <= 4; i++) rbox(0.26, 0.035, 0.04, 0.01, M.woodDark, 0.29, (i * (UP + 0.2)) / 5, 1.06, g);
  place(g, x, z, rot);
  footprint(x, z, 1.0, 2.2, rot);
  addSeat(x, z, rot, 0.52, { kind: 'bed', ...extra, h: 0.52, bedH: 0.5 });
  return addSeat(x, z, rot, 0.52, { kind: 'bed', ...extra, h: 0.52, bedH: UP + 0.24, upper: true });
}
function nightstand(x, z) {
  const g = new THREE.Group();
  rbox(0.45, 0.5, 0.4, 0.03, M.deskWood, 0, 0.25, 0, g);
  cyl(0.07, 0.09, 0.03, M.black, 0, 0.515, 0, g, 14);
  cyl(0.012, 0.012, 0.2, M.black, 0, 0.62, 0, g, 6);
  cyl(0.1, 0.13, 0.15, M.lampGlow, 0, 0.75, 0, g, 16);
  place(g, x, z);
  footprint(x, z, 0.45, 0.4);
}
Object.assign(THEME_BUILD, {
  arcade(F, room) {
    rug(...F.p(0, F.d / 2 + 0.3), F.yaw(), F.w - 1.2, F.d - 2.2, ['#1e1530', '#ff5fd2']);
    const games = ['banana', 'memoria', 'reflexo', 'cobra'];
    const cols = [M.foam2, mat(0x1d4ed8, 0.5), mat(0xb91c1c, 0.5), mat(0x15803d, 0.5)];
    const n = Math.min(4, Math.floor((F.w - 1.2) / 1.25));
    for (let i = 0; i < n; i++) arcadeCabinet(...F.p(-((n - 1) * 1.25) / 2 + i * 1.25, F.d - 0.55), F.yaw(Math.PI), games[i], cols[i]);
    const neon = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.75), SCREEN.neon);
    neon.position.y = 2.35;
    const nb = new THREE.Group(); nb.add(neon);
    putF(F, nb, 0, F.d - 0.2, Math.PI);
    // simulador de kart (corrida contra o tempo / bots; dá pra desafiar no chat)
    const kt = new THREE.Group();
    rbox(1.0, 0.25, 1.6, 0.08, M.accent, 0, 0.2, 0, kt);
    rbox(0.6, 0.5, 0.55, 0.12, M.black, 0, 0.55, -0.35, kt);
    for (const [lx, lz] of [[-0.52, -0.55], [0.52, -0.55], [-0.52, 0.55], [0.52, 0.55]]) { const w = cyl(0.17, 0.17, 0.16, M.black, lx, 0.17, lz, kt, 16); w.rotation.z = Math.PI / 2; }
    const wh = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 8, 20), M.black); wh.position.set(0, 0.72, 0.25); wh.rotation.x = -0.9; kt.add(wh);
    cyl(0.02, 0.02, 0.4, M.black, 0, 0.55, 0.35, kt, 6).rotation.x = -0.9;
    const kscr = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.75), SCREEN.game);
    kscr.position.set(0, 1.35, 1.05); kscr.rotation.y = Math.PI; kt.add(kscr);
    rbox(1.4, 0.85, 0.06, 0.02, M.black, 0, 1.35, 1.1, kt);
    rbox(0.08, 0.95, 0.08, 0.02, M.black, 0, 0.47, 1.12, kt);
    const [kx, kz] = putF(F, kt, -F.w / 2 + 1.3, F.d / 2 - 0.4, Math.PI / 2, 1.0, 2.0);
    INTERACT.push({ kind: 'arcade', game: 'kart', x: kx, z: kz, h: 0.8, yaw: F.yaw(Math.PI / 2), front: F.p(-F.w / 2 + 1.3, F.d / 2 - 1.75) });
    sofa(...F.p(F.w / 2 - 0.55, F.d / 2 - 0.2), F.yaw(-Math.PI / 2), 2.0, M.fabricBlue, { room: room.id, sector: room.sector });
    beanbag(...F.p(0.3, 1.6), F.yaw(Math.PI), { room: room.id, sector: room.sector });
    beanbag(...F.p(1.3, 1.6), F.yaw(Math.PI), { room: room.id, sector: room.sector });
    plant(...F.p(-F.w / 2 + 0.45, 0.6), 1, 'snake');
  },
  descanso(F, room) {
    rug(...F.p(0, F.d / 2 + 0.2), F.yaw(), F.w - 1.4, F.d - 2.4, ['#d8cbb5', '#8a9a7b']);
    const extra = { room: room.id, sector: room.sector, kind: 'rest' };
    sofa(...F.p(0, F.d - 0.6), F.yaw(Math.PI), Math.min(F.w - 1.6, 3.0), M.fabricGreen, { ...extra, lie: true });
    if (F.d >= 5.2) {
      hammock(...F.p(-F.w / 2 + 0.65, F.d / 2 + 0.2), F.yaw(Math.PI / 2), M.fabricOrange, extra);
      hammock(...F.p(F.w / 2 - 0.65, F.d / 2 + 0.2), F.yaw(-Math.PI / 2), M.fabricBlue, extra);
    } else {
      sofa(...F.p(-F.w / 2 + 0.55, F.d / 2), F.yaw(Math.PI / 2), 2.2, M.fabricCream, { ...extra, lie: true });
      sofa(...F.p(F.w / 2 - 0.55, F.d / 2), F.yaw(-Math.PI / 2), 2.2, M.fabricCream, { ...extra, lie: true });
    }
    coffeeTable(...F.p(0, F.d / 2 + 0.3), F.yaw(), 1.2, 0.7);
    beanbag(...F.p(-0.9, 1.4), F.yaw(Math.PI), extra);
    beanbag(...F.p(0.9, 1.4), F.yaw(Math.PI), extra);
    floorLamp(...F.p(-F.w / 2 + 0.45, F.d - 0.45));
    floorLamp(...F.p(F.w / 2 - 0.45, F.d - 0.45));
    plant(...F.p(-F.w / 2 + 0.5, 0.7), 1.1, 'monstera');
    plant(...F.p(F.w / 2 - 0.5, 0.7), 1.1, 'ficus');
  },
  dorm(F, room) {
    rug(...F.p(0, F.d / 2), F.yaw(), F.w - 1.2, 2.2, ['#2b2d42', '#8d99ae']);
    const n = Math.max(2, Math.floor((F.w - 0.8) / 1.45));
    for (let i = 0; i < n; i++) {
      const u = -((n - 1) * 1.45) / 2 + i * 1.45;
      // cabeceira encostada no fundo da sala
      bunkBed(...F.p(u, F.d - 1.2), F.yaw(Math.PI), { room: room.id, sector: room.sector, color: pick([M.fabricBlue, M.fabricGray, M.fabricGreen]), color2: pick([M.fabricBlue, M.fabricGray, M.fabricGreen]) });
    }
    for (let i = 0; i < n - 1; i++) nightstand(...F.p(-((n - 1) * 1.45) / 2 + i * 1.45 + 0.725, F.d - 0.35));
    plant(...F.p(-F.w / 2 + 0.45, 0.6), 1, 'snake');
    floorLamp(...F.p(F.w / 2 - 0.45, 0.6));
  },
});

// ---------- Áreas abertas dos setores ----------
function buildArea(F, area, deep) {
  const th = area.theme;
  const rowsV = deep ? [3.0, 8.4] : [3.1];
  const n = Math.max(1, Math.floor((F.w - 1.2) / 4.4));
  const span = F.w - 1.4;
  const out = [];
  for (const v of rowsV) {
    for (let i = 0; i < n; i++) {
      const u = -span / 2 + (span * (i + 0.5)) / n;
      const [x, z] = F.p(u, v);
      out.push(...deskCluster(x, z, F.yaw(), { screen: th.screen, sector: area.sector, wood: th.id === 'creative' || th.id === 'people', rgb: th.id === 'dev' && i % 2 === 0 }));
    }
  }
  // decoração temática no fundo da área (encostada nas salas)
  const vb = deep ? 12.3 : 5.45;
  const L = -F.w / 2 + 0.7, R = F.w / 2 - 0.7;
  if (th.id === 'dev') {
    const rack = new THREE.Group();
    rbox(0.7, 1.9, 0.8, 0.02, M.black, 0, 0.95, 0, rack);
    for (let i = 0; i < 9; i++) {
      rbox(0.6, 0.12, 0.02, 0.005, M.dark, 0, 0.3 + i * 0.17, 0.41, rack);
      ball(0.012, i % 3 ? M.leaf3 : M.accent, 0.24, 0.3 + i * 0.17, 0.43, rack);
    }
    putF(F, rack, L, vb - 0.1, Math.PI, 0.7, 0.8);
    whiteboard(...F.p(R - 0.4, vb), F.yaw(Math.PI));
  } else if (th.id === 'sales') {
    tvStand(...F.p(L + 0.3, vb), F.yaw(Math.PI), 'dash', 1.6);
    const tro = new THREE.Group();
    rbox(1.2, 1.2, 0.36, 0.02, M.woodDark, 0, 0.6, 0, tro);
    for (let i = 0; i < 3; i++) { cyl(0.06, 0.03, 0.18, M.gold, -0.35 + i * 0.35, 1.29, 0, tro, 12); ball(0.07, M.gold, -0.35 + i * 0.35, 1.42, 0, tro, 1, 0.8, 1); }
    putF(F, tro, R - 0.3, vb, Math.PI, 1.2, 0.4);
  } else if (th.id === 'finance') {
    for (let i = 0; i < 3; i++) {
      const c = new THREE.Group();
      rbox(0.5, 1.3, 0.6, 0.02, M.fabricGray, 0, 0.65, 0, c);
      for (let j = 0; j < 4; j++) rbox(0.2, 0.025, 0.02, 0.008, M.chrome, 0, 0.25 + j * 0.3, 0.31, c);
      putF(F, c, L + i * 0.55, vb, Math.PI, 0.5, 0.6);
    }
    const safe = new THREE.Group();
    rbox(0.7, 0.8, 0.6, 0.04, M.dark, 0, 0.4, 0, safe);
    cyl(0.1, 0.1, 0.03, M.chrome, 0, 0.45, 0.31, safe, 18).rotation.x = Math.PI / 2;
    putF(F, safe, R, vb, Math.PI, 0.7, 0.6);
  } else if (th.id === 'people') {
    sofa(...F.p(R - 0.6, vb - 0.2), F.yaw(Math.PI), 1.8, M.fabricOrange, { sector: area.sector });
    plant(...F.p(L, vb), 1.2, 'monstera');
    bookshelf(...F.p(L + 1.2, vb + 0.2), F.yaw(Math.PI), 1.4, 1.4);
  } else if (th.id === 'creative') {
    const easel = new THREE.Group();
    for (const s of [-1, 1]) { const l = rbox(0.04, 1.7, 0.04, 0.01, M.wood, 0.3 * s, 0.85, 0, easel); l.rotation.z = 0.12 * s; }
    const art = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7), SCREEN.art);
    art.position.set(0, 1.25, 0.03); easel.add(art);
    putF(F, easel, L + 0.3, vb, Math.PI, 0.8, 0.5);
    beanbag(...F.p(R - 0.4, vb - 0.3), F.yaw(Math.PI), { sector: area.sector });
    beanbag(...F.p(R - 1.4, vb - 0.3), F.yaw(Math.PI), { sector: area.sector });
  } else if (th.id === 'support') {
    tvStand(...F.p(0, vb), F.yaw(Math.PI), 'ticket', 2.0);
    waterCooler(...F.p(L, vb), F.yaw(Math.PI));
  } else if (th.id === 'lounge') {
    sofa(...F.p(L + 1.1, vb - 0.2), F.yaw(Math.PI), 2, M.fabricBlue, { sector: area.sector });
    coffeeTable(...F.p(L + 1.1, vb - 1.2), F.yaw());
    plant(...F.p(R, vb), 1.2, 'ficus');
  } else {
    printer(...F.p(L, vb), F.yaw(Math.PI));
    bookshelf(...F.p(R - 0.5, vb + 0.2), F.yaw(Math.PI), 1.6, 1.6);
  }
  for (let i = 1; i < n; i++) plant(...F.p(-span / 2 + (span * i) / n, rowsV[0]), 0.9, i % 2 ? 'snake' : 'bush');
  return out;
}

// ---------- Recepção ----------
function buildLobby(X, Z) {
  const lob = [0, 12, -Z, Z];
  // balcão (de frente pra entrada, no oeste)
  const g = new THREE.Group();
  rbox(0.55, 1.05, 3.4, 0.05, M.white, 0, 0.525, 0, g);
  rbox(0.68, 0.04, 3.5, 0.02, M.deskWood, 0.05, 1.07, 0, g);
  rbox(0.02, 0.25, 3.3, 0.01, M.accent, -0.28, 0.8, 0, g);
  rbox(0.55, 0.02, 1.0, 0.01, M.deskWhite, 0.55, 0.76, -0.4, g);
  place(g, 4.6, 0);
  addCollider(4.3, 4.95, -1.75, 1.75);
  const mon = new THREE.Group();
  monitor(mon, 0, 0, Math.PI, 'welcome', 0.46, 0.28);
  place(mon, 5.0, -0.4, Math.PI / 2);
  const recSeat = officeChair(5.6, -0.4, -Math.PI / 2, { kind: 'desk', sector: 'recepcao' });
  // painel com o logo
  const t = canvasTex(1024, 384, (c, w, h) => {
    c.fillStyle = '#1b1720'; c.fillRect(0, 0, w, h);
    const gr = c.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#ef4444'); gr.addColorStop(1, '#f4511e');
    c.fillStyle = gr; c.font = '800 150px Sora, "Segoe UI", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('MAMACOS', w / 2, h / 2 - 20);
    c.fillStyle = '#d6d0de'; c.font = '600 46px Inter, "Segoe UI", sans-serif'; c.fillText('C O R P', w / 2, h / 2 + 100);
  });
  const p = new THREE.Group();
  rbox(4.6, 2.3, 0.2, 0.04, M.black, 0, 1.15, 0, p);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.65), new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
  face.position.set(0, 1.25, 0.101); p.add(face);
  place(p, 7.0, 0, -Math.PI / 2);
  addCollider(6.9, 7.1, -2.3, 2.3);
  // espera ao norte
  sofa(2.2, -9, Math.PI / 2, 2.2, M.fabricBlue, { sector: 'recepcao' });
  sofa(4.6, -11.6, 0, 2.0, M.fabricOrange, { sector: 'recepcao' });
  coffeeTable(4.0, -9.2, 0, 1.1, 0.7);
  rug(4.0, -9.4, 0, 3.6, 3.4, ['#c9b9a6', '#8c6f56']);
  tvStand(7.4, -9, -Math.PI / 2, 'welcome', 1.4);
  floorLamp(1.2, -11.8);
  plant(1.0, -14.6, 1.2, 'ficus'); plant(11.4, -14.6, 1.2, 'monstera'); plant(6, -14.6, 1, 'snake');
  coffeeBar(9.0, -14.95, 0);
  wcDoor(2.6, -15.25, 0, 'WC');
  wcDoor(4.0, -15.25, 0, 'WC');
  bigBoard(6.4, 9.0, -Math.PI / 2);
  // lounge ao sul
  armchair(2.4, 8.4, Math.PI / 2, { sector: 'recepcao', color: M.fabricGreen });
  armchair(2.4, 9.6, Math.PI / 2, { sector: 'recepcao', color: M.fabricGreen });
  coffeeTable(3.5, 9.0, Math.PI / 2, 1.0, 0.6);
  bookshelf(6.5, 14.9, Math.PI, 2.2, 1.6);
  waterCooler(10.8, 14.7, Math.PI);
  plant(1.0, 14.6, 1.2, 'monstera'); plant(4.0, 14.6, 1, 'snake'); plant(9.2, 14.6, 1.1, 'ficus');
  plant(1.0, 3.2, 0.9, 'bush'); plant(1.0, -3.2, 0.9, 'bush');
  return { recSeat, rect: lob };
}

// ---------- Monta o prédio a partir do servidor ----------
const BLOCK = { corridor: 2.5, area: 6, roomDepth: 7, minW: 11, roomW: 7.2 };
function buildWorld(server) {
  INTERACT = [];
  // limpa o que existia
  scene.remove(worldGroup);
  worldGroup.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  worldGroup = new THREE.Group();
  statics = new THREE.Group();
  dynamic = new THREE.Group();
  colliders = []; seats = []; doors = []; ZONES = []; ROOMS = {}; AREAS = {}; SPOTS = {}; GUARDS = []; BOARD = null;

  const C = BLOCK.corridor, A = BLOCK.area, RD = BLOCK.roomDepth;
  const Z = C + A + RD; // meia profundidade do prédio
  // distribui os setores nos dois lados do corredor (o mais curto recebe o próximo)
  let curN = 12, curS = 12;
  const blocks = [];
  // canal de voz pode vir como texto (protótipo) ou { id, name, voice } (app)
  const cats = server.categories.map((c) => ({
    ...c,
    voice: c.voice.map((v) => (typeof v === 'string' ? { id: `${c.id}::${norm(v).replace(/[^a-z0-9]+/g, '-')}`, name: v, voice: true } : { voice: true, ...v })),
  }));
  for (const cat of cats) {
    const nRooms = cat.voice.length;
    const w = Math.max(BLOCK.minW, nRooms * BLOCK.roomW);
    const side = curN <= curS ? 'n' : 's';
    const x0 = side === 'n' ? curN : curS;
    blocks.push({ cat, side, x0, x1: x0 + w, w, nRooms });
    if (side === 'n') curN += w; else curS += w;
  }
  const X1 = Math.max(curN, curS, 30);
  if (curN < X1) blocks.push({ filler: true, side: 'n', x0: curN, x1: X1, w: X1 - curN });
  if (curS < X1) blocks.push({ filler: true, side: 's', x0: curS, x1: X1, w: X1 - curS });
  BUILDING = [0, X1, -Z, Z];

  // pisos
  const floor = (rect, tex, tint, tile, y) => {
    const [x0, x1, z0, z1] = rect;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), floorMat(tex, tint, tile, x1 - x0, z1 - z0));
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    m.receiveShadow = true;
    worldGroup.add(m);
  };
  floor([0, X1, -Z, Z], TEX.concrete, 0xd9d4cc, 3, 0);
  floor([0, 12, -Z, Z], TEX.tile, 0xffffff, 2.4, 0.003);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x3f4c34, roughness: 1 }));
  grass.rotation.x = -Math.PI / 2; grass.position.set(X1 / 2, -0.02, 0); grass.receiveShadow = true;
  worldGroup.add(grass);
  const walk = new THREE.Mesh(new THREE.PlaneGeometry(14, 5), new THREE.MeshStandardMaterial({ color: 0x9b958c, roughness: 0.9 }));
  walk.rotation.x = -Math.PI / 2; walk.position.set(-7, -0.01, 0); walk.receiveShadow = true;
  worldGroup.add(walk);

  // paredes externas baixas (vista de maquete), entrada no oeste
  const WH = 1.1, T = 0.22;
  const outer = (x0, z0, x1, z1) => {
    const alongX = z0 === z1;
    const L = alongX ? x1 - x0 : z1 - z0;
    rbox(alongX ? L : T, WH, alongX ? T : L, 0.03, M.wall, (x0 + x1) / 2, WH / 2, (z0 + z1) / 2, statics);
    rbox(alongX ? L + T : T + 0.08, 0.05, alongX ? T + 0.08 : L + T, 0.02, M.wallCap, (x0 + x1) / 2, WH + 0.025, (z0 + z1) / 2, statics);
    if (alongX) addCollider(x0, x1, z0 - T / 2, z0 + T / 2); else addCollider(x0 - T / 2, x0 + T / 2, z0, z1);
  };
  outer(0, -Z, X1, -Z);
  outer(0, Z, X1, Z);
  outer(X1, -Z, X1, Z);
  outer(0, -Z, 0, -2);
  outer(0, 2, 0, Z);
  for (const s of [-1, 1]) rbox(0.4, 2.7, 0.3, 0.04, M.frame, 0, 1.35, 2.1 * s, statics);
  rbox(0.5, 0.3, 4.6, 0.05, M.frame, 0, 2.7, 0, statics);
  rbox(1.2, 0.01, 3.2, 0.005, M.dark, 0.7, 0.012, 0, statics).receiveShadow = true;

  const lobby = buildLobby(X1, Z);
  ZONES.push({ id: 'recepcao', kind: 'lobby', rect: lobby.rect, sector: 'recepcao', name: 'Recepção' });
  AREAS.recepcao = { id: 'recepcao', name: 'Recepção', sector: 'recepcao', rect: lobby.rect, label: [3.2, 0], theme: { id: 'lobby', label: 'Recepção' } };
  const homeSeats = { recepcao: [lobby.recSeat] };

  for (const b of blocks) {
    const sideZ = b.side === 'n' ? -1 : 1;
    const zA0 = sideZ * C, zA1 = sideZ * (C + A), zR1 = sideZ * Z;
    if (b.filler) {
      // jardim interno pra fechar o retângulo
      const rect = [b.x0, b.x1, Math.min(sideZ * C, zR1), Math.max(sideZ * C, zR1)];
      floor(rect, TEX.woodLight, 0xffffff, 3, 0.004);
      const F = frameFor(rect, b.side);
      for (let u = -F.w / 2 + 1; u < F.w / 2 - 0.5; u += 2.2) for (let v = 2.5; v < F.d - 0.5; v += 3.2) plant(...F.p(u + rand(-0.3, 0.3), v + rand(-0.3, 0.3)), rand(0.9, 1.3));
      if (F.w > 4) sofa(...F.p(0, 1.2), F.yaw(Math.PI), 2, M.fabricGreen, { sector: 'geral' });
      ZONES.push({ id: 'jardim-' + b.side, kind: 'area', rect, sector: 'geral', name: 'Jardim' });
      continue;
    }
    const cat = b.cat;
    const theme = detectAreaTheme(cat.name);
    const deep = b.nRooms === 0;
    const areaRect = [b.x0, b.x1, Math.min(zA0, deep ? zR1 : zA1), Math.max(zA0, deep ? zR1 : zA1)];
    floor(areaRect, theme.id === 'dev' ? TEX.woodDark : theme.id === 'creative' ? TEX.woodLight : TEX.wood, 0xffffff, 3.2, 0.004);
    const F = frameFor(areaRect, b.side);
    const area = { id: 'area-' + cat.id, name: cat.name, sector: cat.id, rect: areaRect, theme, label: F.p(0, 1.2) };
    AREAS[cat.id] = area;
    ZONES.push({ id: area.id, kind: 'area', rect: areaRect, sector: cat.id, name: cat.name });
    homeSeats[cat.id] = buildArea(F, area, deep);
    // divisória baixa com plantas entre um setor e o próximo
    const div = new THREE.Group();
    rbox(0.4, 0.5, 3.2, 0.04, M.deskWood, 0, 0.25, 0, div);
    for (let i = 0; i < 5; i++) ball(0.2, pick([M.leaf, M.leaf2, M.leaf3]), 0, 0.6, -1.3 + i * 0.65, div);
    const [dx, dz] = [b.x1, sideZ * (C + 1.8)];
    if (b.x1 < X1 - 0.5) { place(div, dx, dz); addCollider(dx - 0.2, dx + 0.2, dz - 1.6, dz + 1.6); }

    // salas
    if (!deep) {
      const rw = b.w / b.nRooms;
      cat.voice.forEach((v, i) => {
        const { id, name } = v;
        const rx0 = b.x0 + i * rw, rx1 = rx0 + rw;
        const rect = [rx0, rx1, Math.min(zA1, zR1), Math.max(zA1, zR1)];
        const th = v.theme ? { id: v.theme, label: ROOM_THEMES.find((t) => t[0] === v.theme)?.[1] || v.theme } : detectRoomTheme(name);
        const RF = frameFor(rect, b.side);
        const room = { id, name, sector: cat.id, rect, theme: th, voice: v.voice !== false, private: !!v.private, door: RF.p(0, -0.9), label: RF.p(0, 0.15), center: RF.p(0, RF.d / 2) };
        if (room.private && GUARDS.length < 16) for (const su of [-1, 1]) {
          const [gx, gz] = RF.p(su * 1.25, -0.4);
          GUARDS.push({ x: gx, z: gz, yaw: RF.yaw(Math.PI), room: id });
          footprint(gx, gz, 0.5, 0.5);
        }
        ROOMS[id] = room;
        ZONES.push({ id, kind: 'room', rect, sector: cat.id, name, room });
        const ft = { meeting: [TEX.carpet, 0x9aa3b8], oneonone: [TEX.carpet, 0xc8a0b0], games: [TEX.carpetDark, 0xffffff], cinema: [TEX.carpetRed, 0xffffff], studio: [TEX.carpetDark, 0xc9b6e0], zen: [TEX.woodLight, 0xffffff], cafe: [TEX.checker, 0xffffff], auditorio: [TEX.carpet, 0x9c8f86], biblioteca: [TEX.woodDark, 0xffffff], arcade: [TEX.carpetDark, 0xd0b8ff], descanso: [TEX.woodLight, 0xf0e6d8], dorm: [TEX.carpet, 0x7d86a6] }[th.id] || [TEX.carpet, 0x9aa3b8];
        floor(rect, ft[0], ft[1], th.id === 'cafe' ? 1.4 : 3, 0.006);
        // paredes de vidro: frente (com porta) e laterais
        const fz = sideZ * (C + A);
        const dc = (rx0 + rx1) / 2;
        glassWall(rx0, fz, rx1, fz, [dc - 0.8, dc + 0.8]);
        glassWall(rx0, fz, rx0, zR1);
        if (i === b.nRooms - 1) glassWall(rx1, fz, rx1, zR1);
        CUR_ROOM = id;
        const nTv = INTERACT.length;
        (THEME_BUILD[th.id] || THEME_BUILD.meeting)(RF, room);
        // toda sala de call tem uma TV (é nela que passa a transmissão de tela)
        if (room.voice && !INTERACT.slice(nTv).some((it) => it.kind === 'tv')) wallTv(RF, th.id, th.id === 'arcade' ? 'game' : 'slide');
        CUR_ROOM = null;
      });
    }
  }
  // divisórias entre a recepção e o corredor/salas
  for (const s of [-1, 1]) glassWall(12, s * C, 12, s * (C + A + RD) * 0.999 + 0);

  if (!SPOTS.coffee) SPOTS.coffee = [9.5, 12.5];
  worldGroup.add(mergeStatics(statics));
  worldGroup.add(dynamic);
  scene.add(worldGroup);
  buildGrid();
  return { homeSeats, recSeat: lobby.recSeat };
}

// Confere móveis encavalados (usado nos testes): devolve pares que se sobrepõem.
function auditOverlaps() {
  const out = [];
  const items = colliders.filter(([x0, x1, z0, z1]) => x1 - x0 < 6 && z1 - z0 < 6 && x1 - x0 > 0.15 && z1 - z0 > 0.15);
  const walls = colliders.filter(([x0, x1, z0, z1]) => (x1 - x0 <= 0.15) !== (z1 - z0 <= 0.15) || x1 - x0 >= 6 || z1 - z0 >= 6);
  for (const a of items) for (const b of walls) {
    const ox = Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
    const oz = Math.min(a[3], b[3]) - Math.max(a[2], b[2]);
    if (ox > 0.02 && oz > 0.02) out.push(['parede', a.map((v) => +v.toFixed(2)), b.map((v) => +v.toFixed(2))]);
  }
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    const ox = Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
    const oz = Math.min(a[3], b[3]) - Math.max(a[2], b[2]);
    if (ox > 0.05 && oz > 0.05) out.push([a.map((v) => +v.toFixed(2)), b.map((v) => +v.toFixed(2))]);
  }
  // móvel atravessando parede de vidro de sala
  return out;
}

function zoneAt(x, z) {
  for (const zn of ZONES) {
    if (zn.kind !== 'room') continue;
    const [x0, x1, z0, z1] = zn.rect;
    if (x > x0 + 0.12 && x < x1 - 0.12 && z > z0 + 0.12 && z < z1 - 0.12) return zn;
  }
  for (const zn of ZONES) {
    if (zn.kind === 'room') continue;
    const [x0, x1, z0, z1] = zn.rect;
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return zn;
  }
  if (x > 12 && x < BUILDING[1] && Math.abs(z) <= BLOCK.corridor) return { id: 'corredor', kind: 'corridor', sector: 'geral', name: 'Corredor' };
  return null;
}

// Junta tudo que não se mexe em poucas malhas (1 por material) — bem mais leve
function mergeStatics(group) {
  group.updateMatrixWorld(true);
  const byMat = new Map();
  const keep = [];
  group.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.keep) { keep.push(o); return; }
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.clearGroups();
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g);
  });
  const out = new THREE.Group();
  for (const [material, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const m = new THREE.Mesh(merged, material);
    m.castShadow = !material.transparent && !material.isMeshBasicMaterial;
    m.receiveShadow = true;
    out.add(m);
    geos.forEach((g) => g.dispose());
  }
  for (const o of keep) out.attach(o);
  return out;
}

// ---------- Grade de caminhos (A*) ----------
const CELL = 0.2;
const AGENT_R = 0.34; // mamaco gordinho: ninguém encosta/atravessa móvel
let G0X = -14, G0Z = -18, GW = 1, GH = 1, grid = new Uint8Array(1);
function cellOf(x, z) { return [Math.floor((x - G0X) / CELL), Math.floor((z - G0Z) / CELL)]; }
function cellCenter(i, j) { return [G0X + (i + 0.5) * CELL, G0Z + (j + 0.5) * CELL]; }
function buildGrid() {
  G0X = -14; G0Z = BUILDING[2] - 2;
  GW = Math.ceil((BUILDING[1] + 2 - G0X) / CELL);
  GH = Math.ceil((BUILDING[3] + 2 - G0Z) / CELL);
  grid = new Uint8Array(GW * GH);
  for (const [x0, x1, z0, z1] of colliders) {
    const [i0, j0] = cellOf(x0 - AGENT_R, z0 - AGENT_R);
    const [i1, j1] = cellOf(x1 + AGENT_R, z1 + AGENT_R);
    for (let j = Math.max(0, j0); j <= Math.min(GH - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(GW - 1, i1); i++) grid[j * GW + i] = 1;
  }
  // lá fora só a calçada (e o gramado em frente) é andável
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const [x, z] = cellCenter(i, j);
    if (x < 0 && Math.abs(z) > 4) grid[j * GW + i] = 1;
    if (x > BUILDING[1] || z < BUILDING[2] || z > BUILDING[3]) grid[j * GW + i] = 1;
  }
  for (let i = 0; i < GW; i++) { grid[i] = 1; grid[(GH - 1) * GW + i] = 1; }
  for (let j = 0; j < GH; j++) { grid[j * GW] = 1; grid[j * GW + GW - 1] = 1; }
}
function blocked(x, z) {
  const [i, j] = cellOf(x, z);
  if (i < 0 || j < 0 || i >= GW || j >= GH) return true;
  return grid[j * GW + i] === 1;
}
function nearestFree(x, z) {
  if (!blocked(x, z)) return [x, z];
  for (let r = 1; r < 40; r++) {
    for (let a = 0; a < 16; a++) {
      const px = x + Math.cos((a / 16) * Math.PI * 2) * r * CELL;
      const pz = z + Math.sin((a / 16) * Math.PI * 2) * r * CELL;
      if (!blocked(px, pz)) return [px, pz];
    }
  }
  return [x, z];
}
function lineFree(ax, az, bx, bz) {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.ceil(d / (CELL * 0.5));
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    if (blocked(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
  }
  return true;
}
function findPath(ax, az, bx, bz) {
  [bx, bz] = nearestFree(bx, bz);
  const [sx, sz] = nearestFree(ax, az);
  if (lineFree(sx, sz, bx, bz)) return [[bx, bz]];
  const [si, sj] = cellOf(sx, sz), [ti, tj] = cellOf(bx, bz);
  const N = GW * GH;
  const gScore = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap = [];
  const push = (f, idx) => {
    heap.push([f, idx]);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  const h = (i, j) => { const dx = Math.abs(i - ti), dz = Math.abs(j - tj); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  const start = sj * GW + si, goal = tj * GW + ti;
  gScore[start] = 0;
  push(h(si, sj), start);
  const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  let found = false, iter = 0;
  while (heap.length && iter++ < 120000) {
    const [, cur] = pop();
    if (cur === goal) { found = true; break; }
    if (closed[cur]) continue;
    closed[cur] = 1;
    const ci = cur % GW, cj = (cur / GW) | 0;
    for (const [di, dj, c] of D) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
      const n = nj * GW + ni;
      if (grid[n] || closed[n]) continue;
      if (di && dj && (grid[cj * GW + ni] || grid[nj * GW + ci])) continue;
      const g2 = gScore[cur] + c;
      if (g2 < gScore[n]) { gScore[n] = g2; came[n] = cur; push(g2 + h(ni, nj), n); }
    }
  }
  if (!found) return [[bx, bz]];
  const cells = [];
  for (let c = goal; c !== -1 && c !== start; c = came[c]) cells.push(c);
  cells.reverse();
  const pts = cells.map((c) => cellCenter(c % GW, (c / GW) | 0));
  pts[pts.length - 1] = [bx, bz];
  const out = [];
  let ax2 = sx, az2 = sz, k = 0;
  while (k < pts.length) {
    let far = k;
    for (let m = pts.length - 1; m > k; m--) if (lineFree(ax2, az2, pts[m][0], pts[m][1])) { far = m; break; }
    out.push(pts[far]);
    [ax2, az2] = pts[far];
    k = far + 1;
  }
  return out;
}

// =====================================================================
// MOTOR DO MODO 3D — recebe os dados do servidor e desenha o escritório
// =====================================================================
// Uso (o app e o protótipo usam igual):
//   const office = createOffice({ container, me: { id, name }, onRoomChange, onUseTv, onUsePc, onArcade, onZoneChange })
//   office.setData({ serverName, categories, members })   // sempre que algo mudar
//   office.setSpeaking(new Set([...ids]))                  // quem está falando
//   office.bubble(userId, 'texto')                         // balão de mensagem
//   office.dispose()
// Nada aqui fala com servidor nenhum: é tudo desenhado no aparelho com os
// dados que o app já tem (custo zero no Oracle/Supabase).

let scene = null;

const SKIN_FUR = ['#7a4a2b', '#b9773d', '#5d5a63', '#2f2724', '#d6a548', '#e6ddd2'];
const SKIN_TOP = ['#f4511e', '#ef4444', '#3b82f6', '#22c55e', '#8b5cf6', '#1f1b24', '#f5f0e8', '#8a8f99', '#ec4899', '#06b6d4'];
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
/** Visual padrão de cada pessoa (sempre o mesmo pra mesma conta). */
const FOFO_FURS = ['#7a4529', '#7a4529', '#a8683f', '#8a5a3c', '#5d5a63', '#2f2724', '#c99a45'];
const SKIN_POOL = ['base', 'base', 'base', 'base', 'base', 'esportes', 'inverno', 'festa', 'pirata', 'ninja', 'astronauta', 'dinossauro', 'tigre', 'coelho', 'unicornio', 'heroi', 'mago', 'robo', 'banana', 'dinoroxo', 'zumbi'];
function defaultSkin(id) {
  const h = hashStr(id || 'x');
  const outfit = SKIN_POOL[h % SKIN_POOL.length];
  const covers = !!FOFO_SKINS[outfit]?.coversHead;
  const hats = [null, null, null, null, 'cap', 'beanie', 'chapeu', 'coroa'];
  const backs = [null, null, null, 'mochila', 'cachecol'];
  return {
    fur: FOFO_FURS[(h >>> 3) % FOFO_FURS.length],
    top: SKIN_TOP[(h >>> 7) % SKIN_TOP.length],
    outfit,
    headset: false,
    glasses: (h >>> 13) % 6 === 0,
    hat: covers ? null : hats[(h >>> 15) % hats.length],
    back: backs[(h >>> 19) % backs.length],
    hatColor: SKIN_TOP[(h >>> 17) % SKIN_TOP.length],
  };
}
function makeMamaco(name, skin) {
  const m = new Mamaco({ fur: skin.fur, top: skin.top, name, outfit: FOFO_SKINS[skin.outfit] ? skin.outfit : 'base', headset: false, glasses: !!skin.glasses, hat: skin.hat || null, hatColor: skin.hatColor || '#1f1b24', style: 'fofo' });
  if (skin.back) { m.state.back = skin.back; m.applyAccessories(); }
  if (skin.headset) { m.state.headset = true; m.applyAccessories(); }
  toonify(m.root);
  return m;
}
function applySkin(m, skin) {
  m.setFur(skin.fur);
  m.setOutfit(FOFO_SKINS[skin.outfit] ? skin.outfit : 'base');
  m.state.headset = !!skin.headset;
  m.state.glasses = !!skin.glasses;
  m.state.hat = skin.hat || null;
  m.state.back = skin.back || null;
  if (skin.hatColor) m.capM.color.set(skin.hatColor);
  m.applyAccessories();
  toonify(m.root);
}

// ---------- Sons (baixinhos, só pra imersão) ----------
// Tudo sintetizado na hora (sem arquivo de áudio): passos, sentar, café,
// gole, porta, pulo. Só os do SEU boneco. Liga/desliga no botão 🔊.
const SFX = (() => {
  let ctx = null, master = null;
  let on = true;
  try { on = localStorage.getItem('mv-office-sound') !== '0'; } catch { /* sem storage */ }
  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.2; master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  let noiseBuf = null;
  function nbuf() {
    if (noiseBuf) return noiseBuf;
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }
  function env(g, t0, a, d, peak) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); }
  function noise({ dur = 0.08, freq = 900, q = 1.2, type = 'bandpass', gain = 0.3, attack = 0.004, sweep = null, delay = 0 }) {
    if (!on || !ctx) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = nbuf(); src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t0); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t0 + dur);
    const g = ctx.createGain(); env(g, t0, attack, dur, gain);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0, Math.random()); src.stop(t0 + attack + dur + 0.05);
  }
  function tone({ freq = 440, dur = 0.12, type = 'sine', gain = 0.15, slide = null, attack = 0.005, delay = 0 }) {
    if (!on || !ctx) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    const g = ctx.createGain(); env(g, t0, attack, dur, gain);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + attack + dur + 0.05);
  }
  let stepAlt = false;
  return {
    unlock: ensure,
    ctx() { return ensure(); },
    get on() { return on; },
    toggle() { on = !on; try { localStorage.setItem('mv-office-sound', on ? '1' : '0'); } catch { /* ok */ } if (on) ensure(); return on; },
    step(run) { stepAlt = !stepAlt; noise({ dur: run ? 0.05 : 0.065, freq: (stepAlt ? 520 : 610) * (0.92 + Math.random() * 0.16), q: 0.9, type: 'lowpass', gain: run ? 0.16 : 0.11 }); },
    jump() { tone({ freq: 330, slide: 620, dur: 0.14, type: 'triangle', gain: 0.07 }); },
    land() { noise({ dur: 0.09, freq: 260, type: 'lowpass', gain: 0.22 }); },
    sit() { noise({ dur: 0.18, freq: 380, sweep: 160, type: 'lowpass', gain: 0.2, attack: 0.01 }); },
    stand() { noise({ dur: 0.12, freq: 300, sweep: 600, type: 'lowpass', gain: 0.12, attack: 0.01 }); },
    press() { tone({ freq: 1200, dur: 0.035, type: 'square', gain: 0.03 }); tone({ freq: 900, dur: 0.03, type: 'square', gain: 0.025, delay: 0.05 }); },
    brew() { noise({ dur: 1.6, freq: 2600, q: 0.7, gain: 0.05, attack: 0.25 }); tone({ freq: 95, dur: 1.5, type: 'sawtooth', gain: 0.018, attack: 0.2 }); noise({ dur: 0.5, freq: 900, q: 3, gain: 0.04, attack: 0.1, delay: 1.1, sweep: 1500 }); },
    clink() { tone({ freq: 2400, dur: 0.18, type: 'sine', gain: 0.04 }); tone({ freq: 3150, dur: 0.12, type: 'sine', gain: 0.025 }); },
    sip() { noise({ dur: 0.22, freq: 1400, q: 2.5, gain: 0.07, attack: 0.03, sweep: 700 }); tone({ freq: 210, slide: 180, dur: 0.25, type: 'sine', gain: 0.03, delay: 0.24, attack: 0.04 }); },
    door() { noise({ dur: 0.25, freq: 700, q: 6, gain: 0.05, attack: 0.03, sweep: 1100 }); noise({ dur: 0.08, freq: 220, type: 'lowpass', gain: 0.15, delay: 0.28 }); },
    flush() { noise({ dur: 1.4, freq: 1800, q: 0.6, gain: 0.07, attack: 0.15, sweep: 400 }); },
    type() { noise({ dur: 0.02, freq: 3200 + Math.random() * 800, q: 4, gain: 0.04 }); },
    pop() { tone({ freq: 660, slide: 990, dur: 0.07, type: 'sine', gain: 0.05 }); },
  };
})();

// ---------- Música ambiente (procedural, opcional, bem baixinha) ----------
// Gerada na hora pelo WebAudio: nenhum arquivo, nada de servidor. Muda o
// clima conforme a sala onde você está (games mais animado, zen/descanso
// calminho, café jazzístico). Desligada por padrão (botão 🎵).
const MUSIC = (() => {
  let on = false;
  try { on = localStorage.getItem('mv-office-music') === '1'; } catch { /* sem storage */ }
  let out = null, timer = 0, next = 0, step = 0, mood = 'office', hold = false;
  const MOODS = {
    office: { bpm: 76, lead: 'triangle', prog: [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65], [52, 55, 59, 62]], arp: [0, 2, 1, 3, 2, 1, 3, 2], gain: 0.05 },
    games: { bpm: 116, lead: 'square', prog: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], arp: [0, 1, 2, 1, 0, 2, 1, 2], gain: 0.028 },
    zen: { bpm: 50, lead: 'sine', prog: [[50, 57, 62, 66], [47, 54, 59, 62], [43, 50, 55, 59], [45, 52, 57, 61]], arp: null, gain: 0.06 },
    cafe: { bpm: 88, lead: 'triangle', prog: [[50, 53, 57, 60], [55, 59, 62, 65], [48, 52, 55, 59], [57, 61, 64, 67]], arp: [0, 3, 2, 1, 0, 2, 3, 1], gain: 0.045 },
    cinema: { bpm: 60, lead: 'sawtooth', prog: [[45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59], [40, 47, 52, 56]], arp: null, gain: 0.03 },
  };
  const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
  function note(ctx, f, t0, dur, type, gain, cutoff = 1800) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.25, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(lp); lp.connect(g); g.connect(out);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function tick() {
    const ctx = SFX.ctx();
    if (!ctx || !out) return;
    const M = MOODS[mood] || MOODS.office;
    const spb = 60 / M.bpm / 2;
    if (next < ctx.currentTime) next = ctx.currentTime + 0.05;
    while (next < ctx.currentTime + 0.5) {
      if (!hold) {
        const ch = M.prog[Math.floor(step / 8) % M.prog.length];
        if (step % 8 === 0) for (const n of ch) note(ctx, hz(n - 12), next, spb * 8.4, 'sine', M.gain * 0.45, 900);
        if (step % 8 === 0) note(ctx, hz(ch[0] - 24), next, spb * 4, 'triangle', M.gain * 0.6, 500);
        if (M.arp) { if (step % 2 === 0 || Math.random() < 0.18) note(ctx, hz(ch[M.arp[step % 8] % ch.length] + 12), next, spb * 1.7, M.lead, M.gain * 0.5); }
        else if (step % 4 === 2 && Math.random() < 0.55) note(ctx, hz(ch[Math.floor(Math.random() * ch.length)] + 24), next, spb * 6, 'sine', M.gain * 0.35, 3000);
      }
      next += spb; step++;
    }
  }
  function start() {
    const ctx = SFX.ctx();
    if (!ctx || out) return;
    out = ctx.createGain(); out.gain.value = 0.0001; out.connect(ctx.destination);
    out.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 1.5);
    next = ctx.currentTime + 0.1; step = 0;
    timer = setInterval(tick, 160);
  }
  function stop() {
    clearInterval(timer); timer = 0;
    if (!out) return;
    const o = out; out = null;
    try { const ctx = SFX.ctx(); o.gain.cancelScheduledValues(ctx.currentTime); o.gain.setValueAtTime(o.gain.value, ctx.currentTime); o.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6); setTimeout(() => o.disconnect(), 900); } catch { /* ok */ }
  }
  return {
    get on() { return on; },
    toggle() { on = !on; try { localStorage.setItem('mv-office-music', on ? '1' : '0'); } catch { /* ok */ } if (on) start(); else stop(); return on; },
    resume() { if (on) start(); },
    setMood(m) { mood = MOODS[m] ? m : 'office'; },
    get mood() { return mood; },
    hold(h) { hold = !!h; },
    stop,
  };
})();
const MOOD_OF = { games: 'games', arcade: 'games', zen: 'zen', descanso: 'zen', dorm: 'zen', biblioteca: 'zen', cafe: 'cafe', cinema: 'cinema', auditorio: 'cinema' };

// ---------- Prévia do personagem (tela "Meu mamaco") ----------
// Um palco pequeno com o seu mamaco girando (arrasta pra girar), e
// miniaturas de cada skin (desenhadas uma vez e guardadas).
function previewStage(canvas, { alpha = true } = {}) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha, preserveDrawingBuffer: !!canvas.__thumb });
  r.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
  const sc = new THREE.Scene();
  sc.add(new THREE.HemisphereLight(0xfff4e8, 0x6d6880, 1.2));
  const key = new THREE.DirectionalLight(0xfff0dc, 1.8);
  key.position.set(-2.5, 5, 4); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2 });
  key.shadow.normalBias = 0.03; key.shadow.radius = 4;
  sc.add(key);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.9, 0.06, 48), new THREE.MeshToonMaterial({ color: 0x4a4258, gradientMap: toonGrad() }));
  disc.position.y = -0.03; disc.receiveShadow = true; sc.add(disc);
  const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
  cam.position.set(0, 1.55, 4.4); cam.lookAt(0, 0.82, 0);
  return { r, sc, cam, disc };
}
function createSkinPreview(container, skin) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:grab';
  container.appendChild(canvas);
  const S = previewStage(canvas);
  let m = makeMamaco('', skin);
  m.root.rotation.y = 0.5;
  S.sc.add(m.root);
  let raf = 0, last = performance.now(), t = 0, spin = 0.5, drag = null, vel = 0.35, actT = 2.5, act = 0, jumpY = 0, jumpV = 0;
  canvas.addEventListener('pointerdown', (e) => { drag = e.clientX; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing'; });
  canvas.addEventListener('pointermove', (e) => { if (drag == null) return; const dx = e.clientX - drag; drag = e.clientX; spin += dx * 0.012; vel = dx * 0.6; });
  canvas.addEventListener('pointerup', () => { drag = null; canvas.style.cursor = 'grab'; });
  const size = () => {
    const w = container.clientWidth || 200, h = container.clientHeight || 200;
    S.r.setSize(w, h, false); S.cam.aspect = w / h;
    // enquadra o boneco inteiro (2,1 m de altura, 1,5 m de largura com folga)
    const tf = Math.tan((S.cam.fov * Math.PI) / 360);
    const dist = Math.max(1.05 / tf, 0.8 / (tf * S.cam.aspect));
    S.cam.position.set(0, 0.95 + dist * 0.16, dist); S.cam.lookAt(0, 0.82, 0);
    S.cam.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(size); ro.observe(container); size();
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    if (drag == null) { vel += (0.35 - vel) * Math.min(1, dt * 2); spin += vel * dt; }
    m.root.rotation.y = spin;
    // de vez em quando acena ou dá um pulinho
    actT -= dt;
    if (actT <= 0) { act = (act + 1) % 3; actT = 4 + Math.random() * 2; if (act === 1) m.wave(); if (act === 2) jumpV = 3.6; }
    let air = false;
    if (jumpV > 0 || jumpY > 0) { jumpV -= 12 * dt; jumpY = Math.max(0, jumpY + jumpV * dt); air = jumpY > 0.01; if (jumpY === 0) { jumpV = 0; m.land(0.1); } }
    m.root.position.y = jumpY;
    m.update(dt, t, { speed: 0, air });
    S.r.render(S.sc, S.cam);
  }
  raf = requestAnimationFrame(loop);
  return {
    set(next) { applySkin(m, next); },
    dispose() { cancelAnimationFrame(raf); ro.disconnect(); S.r.dispose(); canvas.remove(); },
  };
}
const THUMBS = new Map();
let THUMB_STAGE = null;
function skinThumb(skin, size = 112) {
  const key = JSON.stringify([skin.outfit, skin.fur, skin.hat, skin.back, !!skin.glasses, !!skin.headset, size]);
  if (THUMBS.has(key)) return THUMBS.get(key);
  if (!THUMB_STAGE) {
    const c = document.createElement('canvas'); c.__thumb = true;
    THUMB_STAGE = previewStage(c);
    THUMB_STAGE.disc.visible = false;
    THUMB_STAGE.cam.position.set(0, 1.25, 3.2); THUMB_STAGE.cam.lookAt(0, 0.95, 0); THUMB_STAGE.cam.fov = 30;
  }
  const S = THUMB_STAGE;
  S.r.setPixelRatio(1); S.r.setSize(size, size, false); S.cam.aspect = 1; S.cam.updateProjectionMatrix();
  const m = makeMamaco('', skin);
  m.root.rotation.y = 0.45;
  S.sc.add(m.root);
  for (let i = 0; i < 3; i++) m.update(0.05, i * 0.05, { speed: 0 });
  S.r.render(S.sc, S.cam);
  const url = S.r.domElement.toDataURL('image/png');
  S.sc.remove(m.root);
  m.root.traverse((o) => { if (o.isMesh && o.geometry && !o.geometry.userData.zones) o.geometry.dispose(); });
  THUMBS.set(key, url);
  return url;
}

// ---------- Visual de RPG: sombra em faixas (toon) ----------
let TOON_GRAD = null;
function toonGrad() {
  if (TOON_GRAD) return TOON_GRAD;
  const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255, 178, 178, 178, 255, 222, 222, 222, 255, 255, 255, 255, 255]), 4, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  TOON_GRAD = t;
  return t;
}
const TOON_CACHE = new WeakMap();
function toToon(mt) {
  if (!mt || mt.isMeshToonMaterial || mt.isMeshBasicMaterial || mt.isShaderMaterial || mt.isShadowMaterial || mt.isMeshPhysicalMaterial || mt.isPointsMaterial || mt.isLineBasicMaterial) return mt;
  if (!mt.isMeshStandardMaterial && !mt.isMeshLambertMaterial && !mt.isMeshPhongMaterial) return mt;
  let tm = TOON_CACHE.get(mt);
  if (tm) return tm;
  tm = new THREE.MeshToonMaterial({
    color: mt.color, map: mt.map || null, gradientMap: toonGrad(),
    emissive: mt.emissive || new THREE.Color(0), emissiveIntensity: mt.emissiveIntensity ?? 1, emissiveMap: mt.emissiveMap || null,
    transparent: mt.transparent, opacity: mt.opacity, side: mt.side, depthWrite: mt.depthWrite, alphaTest: mt.alphaTest,
  });
  // metal fica um tico mais claro (brilho chapado)
  if (mt.metalness > 0.5) tm.color = mt.color.clone().offsetHSL(0, -0.05, 0.06);
  tm.name = mt.name;
  TOON_CACHE.set(mt, tm);
  return tm;
}
function toonify(obj) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    if (Array.isArray(o.material)) o.material = o.material.map(toToon);
    else o.material = toToon(o.material);
  });
}

const CSS = `
.o3d{position:absolute;inset:0;overflow:hidden;background:#b8c4cc;font-family:Inter,"Segoe UI",system-ui,sans-serif;color:#ece8f1}
.o3d canvas.view{display:block;width:100%;height:100%;outline:none;touch-action:none}
.o3d .labels{position:absolute;inset:0;pointer-events:none}
.o3d .tag{position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;gap:5px;transform-origin:50% 100%;will-change:transform}
.o3d .bubble{max-width:210px;padding:7px 11px;border-radius:13px;background:#fff;color:#1b1620;font-size:12.5px;font-weight:500;line-height:1.35;text-align:center;overflow-wrap:anywhere;box-shadow:0 6px 18px rgba(0,0,0,.28);position:relative;opacity:0;transform:translateY(6px) scale(.85);transition:opacity .18s ease,transform .22s cubic-bezier(.3,1.6,.5,1)}
.o3d .bubble::after{content:"";position:absolute;left:50%;bottom:-5px;width:10px;height:10px;background:#fff;transform:translateX(-50%) rotate(45deg);border-radius:2px}
.o3d .bubble.show{opacity:1;transform:none}
.o3d .zzz{font:800 15px Sora,Inter,sans-serif;color:#c7d2fe;text-shadow:0 1px 3px rgba(0,0,0,.5);letter-spacing:2px;animation:o3dz 2.4s ease-in-out infinite}
@keyframes o3dz{0%{opacity:0;transform:translateY(6px)}40%{opacity:1}100%{opacity:0;transform:translateY(-10px)}}
.o3d .name{font-size:11.5px;font-weight:600;color:#fff;padding:2px 8px;border-radius:999px;background:rgba(12,10,16,.66);display:flex;align-items:center;gap:5px;white-space:nowrap}
.o3d .name i{width:7px;height:7px;border-radius:50%;display:inline-block}
.o3d .name img{width:20px;height:20px;border-radius:50%;object-fit:cover;margin-left:-6px;border:1.5px solid rgba(255,255,255,.85);flex:none}
.o3d .name img:not([hidden])+i{width:8px;height:8px;margin-left:-11px;margin-top:12px;border:1.5px solid #0c0a10}
.o3d .name.talking{box-shadow:0 0 0 2px #34d399}
.o3d .cam{width:76px;height:76px;border-radius:50%;overflow:hidden;border:2.5px solid #fff;box-shadow:0 6px 16px rgba(0,0,0,.35);background:#0c0a10}
.o3d .cam.talking{border-color:#34d399;box-shadow:0 0 0 3px rgba(52,211,153,.45),0 6px 16px rgba(0,0,0,.35)}
.o3d .cam video{width:100%;height:100%;object-fit:cover;display:block}
.o3d .cam.mirror video{transform:scaleX(-1)}
.o3d .emote{position:absolute;bottom:100%;left:50%;font-size:30px;line-height:1;pointer-events:none;opacity:0;transform:translate(-50%,0)}
.o3d .emote.go{animation:o3de 2.2s ease-out forwards}
@keyframes o3de{0%{opacity:0;transform:translate(-50%,10px) scale(.4)}12%{opacity:1;transform:translate(-50%,-4px) scale(1.25)}25%{transform:translate(-50%,-8px) scale(1)}80%{opacity:1}100%{opacity:0;transform:translate(-50%,-46px) scale(.95)}}
.o3d .game{font-size:10.5px;font-weight:700;color:#d8ccff;background:rgba(40,24,72,.78);padding:1px 8px;border-radius:999px;white-space:nowrap;max-width:190px;overflow:hidden;text-overflow:ellipsis}
.o3d .game:empty{display:none}
.o3d .sign .badge{min-width:19px;height:19px;padding:0 5px;border-radius:10px;background:#ef4444;color:#fff;font:800 11px/19px Inter,sans-serif;text-align:center;box-shadow:0 0 0 2px rgba(12,10,16,.8)}
.o3d .toast{position:absolute;left:50%;top:64px;transform:translateX(-50%);z-index:8;background:rgba(18,15,24,.92);border:1px solid rgba(255,255,255,.14);padding:9px 14px;border-radius:12px;font-size:13.5px;font-weight:600;pointer-events:none;animation:o3dt 3.6s ease forwards;white-space:nowrap;max-width:calc(100% - 32px);overflow:hidden;text-overflow:ellipsis}
@keyframes o3dt{0%{opacity:0;transform:translate(-50%,-8px)}8%{opacity:1;transform:translate(-50%,0)}85%{opacity:1}100%{opacity:0}}
.o3d .sign{position:absolute;left:0;top:0;display:flex;align-items:center;gap:7px;padding:5px 10px;border-radius:9px;color:#fff;background:rgba(12,10,16,.62);border-left:3px solid var(--c,#f4511e);white-space:nowrap}
.o3d .sign.room{pointer-events:auto;cursor:pointer;border:1px solid rgba(255,255,255,.12);border-left:3px solid var(--c);background:rgba(12,10,16,.74)}
.o3d .sign.room:hover{background:rgba(12,10,16,.9)}
.o3d .sign svg{width:15px;height:15px;color:#9d97a8;flex:none}
.o3d .sign.live svg{color:#34d399}
.o3d .sign.mine{box-shadow:0 0 0 2px #34d399}
.o3d .sign .t{display:flex;flex-direction:column;line-height:1.15}
.o3d .sign .t b{font-size:12px;font-weight:700}
.o3d .sign .t small{font-size:10px;font-weight:600;color:#a19ab0}
.o3d .sign.area .t b{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--c)}
.o3d .who{display:flex;gap:2px}
.o3d .who:empty{display:none}
.o3d .mini{width:20px;height:20px;border-radius:50%;font-size:8px;font-weight:800;display:flex;align-items:center;justify-content:center;border:1.5px solid rgba(12,10,16,.9)}
.o3d .mini.speaking{border-color:#34d399;box-shadow:0 0 0 1.5px #34d399}
.o3d .mini.more{background:#3a3542;color:#fff}
.o3d .prompt{position:absolute;left:50%;bottom:92px;transform:translateX(-50%);display:flex;gap:8px;z-index:6;pointer-events:none}
.o3d .prompt span{background:rgba(18,15,24,.86);border:1px solid rgba(255,255,255,.12);padding:7px 11px;border-radius:10px;font-size:13px;font-weight:600}
.o3d .prompt kbd{font:800 12px Inter,sans-serif;background:#fff;color:#16131c;border-radius:5px;padding:1px 6px;margin-right:6px}
.o3d .map{position:absolute;top:12px;right:max(16px,env(safe-area-inset-right,0px));width:240px;border-radius:12px;border:1px solid rgba(255,240,230,.09);cursor:pointer;z-index:5}
.o3d .camctl{position:absolute;top:12px;right:calc(max(16px,env(safe-area-inset-right,0px)) + 252px);display:flex;gap:4px;z-index:5}
.o3d .camctl button{width:34px;height:30px;border-radius:9px;border:1px solid rgba(255,240,230,.12);background:rgba(18,15,22,.82);color:#f3eef8;font:700 16px/1 Inter,system-ui,sans-serif;cursor:pointer}
.o3d .camctl button:hover{background:rgba(244,81,30,.85)}
.o3d .bigmap{position:absolute;inset:0;z-index:40;background:rgba(8,6,12,.6);display:flex;align-items:center;justify-content:center;padding:16px}
.o3d .bigmap>div{width:min(1100px,100%);height:min(700px,100%);display:flex;flex-direction:column;background:#16131c;border:1px solid rgba(255,240,230,.09);border-radius:16px;overflow:hidden}
.o3d .bigmap header{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(255,240,230,.09)}
.o3d .bigmap header b{font:700 16px Sora,Inter,sans-serif}
.o3d .bigmap header small{color:#9d97a8;font-size:12.5px}
.o3d .bigmap header button{margin-left:auto;border:0;background:transparent;color:#9d97a8;font-size:22px;cursor:pointer}
.o3d .bigmap canvas{flex:1;width:100%;min-height:0;cursor:pointer;display:block}
.o3d [hidden]{display:none!important}
@media (max-width:760px){.o3d .camctl{top:60px;right:calc(max(16px,env(safe-area-inset-right,0px)) + 158px);flex-wrap:wrap;width:110px;justify-content:flex-end}.o3d .map{width:150px;top:60px}.o3d .prompt{bottom:230px}}
@media (prefers-reduced-motion:reduce){.o3d .bubble{transition:none}.o3d .zzz{animation:none}.o3d .emote.go{animation-duration:.01s}}
`;
const SVG_SPK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Zm4.5 3.5a5 5 0 0 1 0 7m2.5-10a9 9 0 0 1 0 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SECTOR_COLORS = ['#3b82f6', '#22c55e', '#ec4899', '#a78bfa', '#eab308', '#06b6d4', '#f97316', '#84cc16', '#e11d48'];
const SPECIALS = {
  id: '__convivencia', name: 'Convivência', color: '#14b8a6', text: [],
  voice: [
    { id: 'special:minigames', name: 'Minigames', theme: 'arcade', voice: false },
    { id: 'special:descanso', name: 'Descanso', theme: 'descanso', voice: false },
    { id: 'special:offline', name: 'Offline', theme: 'dorm', voice: false },
  ],
};

function createOffice(opts) {
  const stat = (name, n = 1) => { try { opts.onStat?.(name, n); } catch { /* conquistas são opcionais */ } };
  const container = opts.container;
  const root = document.createElement('div');
  root.className = 'o3d';
  if (!document.getElementById('o3d-css')) {
    const st = document.createElement('style'); st.id = 'o3d-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  root.innerHTML = `<canvas class="view" tabindex="0" aria-label="Escritório 3D. WASD ou setas para andar."></canvas><div class="labels"></div>
    <div class="prompt" hidden></div><canvas class="map" aria-label="Mapa do escritório. Clique para abrir."></canvas>
    <div class="bigmap" hidden><div><header><b>Mapa</b><small>Clique numa sala pra ir até lá</small><button aria-label="Fechar mapa">×</button></header><canvas></canvas></div></div>`;
  container.appendChild(root);
  const canvas = root.querySelector('canvas.view');
  const labelsEl = root.querySelector('.labels');
  const promptEl = root.querySelector('.prompt');
  const mini = root.querySelector('canvas.map');
  const bigBox = root.querySelector('.bigmap');
  const big = bigBox.querySelector('canvas');
  const mctx = mini.getContext('2d');
  const bctx = big.getContext('2d');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Visual isométrico de RPG (moderno, liso) ----
  // Câmera isométrica que segue você (gira de 90 em 90°), sombra em faixas
  // (cel shading), contorno escuro suave e antisserrilhado (FXAA) no fim.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  let pr = Math.min(devicePixelRatio || 1, opts.pixelRatio || 2);
  renderer.setPixelRatio(pr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a2735);
  const ISO_EL = Math.PI / 6;     // 30° de elevação
  let zoom = opts.zoom || clamp(innerHeight / 12, 46, 80); // px de tela por metro
  let camYaw = -Math.PI / 4, camYawGoal = camYaw;
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false; controls.enableDamping = false;
  const hemi = new THREE.HemisphereLight(0xfff4e8, 0x6d6880, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0dc, 1.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 80 });
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const SUN_OFF = new THREE.Vector3(-12, 24, 10);
  // passada 1: cena (cor + profundidade) → passada 2: contorno → passada 3: FXAA na tela
  const rt = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true });
  rt.depthTexture = new THREE.DepthTexture(4, 4);
  rt.depthTexture.type = THREE.UnsignedIntType;
  const rt2 = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false });
  const postScene = new THREE.Scene();
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  postScene.add(quad);
  const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const outlineMat = new THREE.ShaderMaterial({
    uniforms: { tColor: { value: rt.texture }, tDepth: { value: rt.depthTexture }, res: { value: new THREE.Vector2(4, 4) }, range: { value: 199.9 }, px: { value: 1.5 } },
    vertexShader: VS,
    fragmentShader: `
      uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 res; uniform float range; uniform float px;
      varying vec2 vUv;
      float D(vec2 o){ return texture2D(tDepth, vUv + o * px / res).x * range; }
      void main(){
        vec4 c = texture2D(tColor, vUv);
        float d = D(vec2(0.0));
        float eo = 0.0, ei = 0.0;
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.7853982;
          float n = D(vec2(cos(a), sin(a)));
          eo = max(eo, d - n);
          ei = max(ei, n - d);
        }
        float outer = smoothstep(0.14, 0.32, eo);
        float inner = smoothstep(0.1, 0.3, ei) * (1.0 - outer);
        c.rgb = mix(c.rgb, c.rgb * 0.6, inner * 0.7);
        c.rgb = mix(c.rgb, vec3(0.01, 0.008, 0.016), outer * 0.85);
        // linear → sRGB aqui (o FXAA trabalha na cor já "de tela")
        vec3 lo = c.rgb * 12.92, hi = 1.055 * pow(max(c.rgb, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
        gl_FragColor = vec4(mix(hi, lo, step(c.rgb, vec3(0.0031308))), 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  // FXAA (versão compacta): suaviza os degraus das bordas
  const fxaaMat = new THREE.ShaderMaterial({
    uniforms: { tColor: { value: rt2.texture }, res: { value: new THREE.Vector2(4, 4) } },
    vertexShader: VS,
    fragmentShader: `
      uniform sampler2D tColor; uniform vec2 res; varying vec2 vUv;
      float L(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
      void main(){
        vec2 p = 1.0 / res;
        vec3 rgbNW = texture2D(tColor, vUv + vec2(-1.0, -1.0) * p).rgb;
        vec3 rgbNE = texture2D(tColor, vUv + vec2( 1.0, -1.0) * p).rgb;
        vec3 rgbSW = texture2D(tColor, vUv + vec2(-1.0,  1.0) * p).rgb;
        vec3 rgbSE = texture2D(tColor, vUv + vec2( 1.0,  1.0) * p).rgb;
        vec4 cM = texture2D(tColor, vUv);
        float lNW = L(rgbNW), lNE = L(rgbNE), lSW = L(rgbSW), lSE = L(rgbSE), lM = L(cM.rgb);
        float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
        float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
        vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
        float red = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
        float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
        dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * p;
        vec3 A = 0.5 * (texture2D(tColor, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tColor, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
        vec3 B = A * 0.5 + 0.25 * (texture2D(tColor, vUv + dir * -0.5).rgb + texture2D(tColor, vUv + dir * 0.5).rgb);
        float lB = L(B);
        gl_FragColor = vec4((lB < lMin || lB > lMax) ? A : B, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });
  function placeCamera(target) {
    const dir = new THREE.Vector3(Math.sin(camYaw) * Math.cos(ISO_EL), Math.sin(ISO_EL), Math.cos(camYaw) * Math.cos(ISO_EL));
    camera.position.copy(target).addScaledVector(dir, 80);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }

  // ---------- Pessoas ----------
  const WALK = 3.1, RUN = 6.2, GRAV = 15, JUMP_V = 5.2;
  const agents = new Map(); // id -> Agent
  const angleDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  let sectorColors = {};
  const sectorColor = (id) => sectorColors[id] || '#a78bfa';

  // ponto onde o quadril fica: o mamaco é "gordinho" (costas 30 cm atrás do
  // quadril), então senta um pouco à frente do centro do assento pra não
  // entrar no encosto
  function seatPoint(s) {
    if (s.kind === 'bed' || s.lie) return [s.x, s.z];
    const f = s.kind === 'desk' ? 0.1 : s.kind === 'stool' ? 0.02 : 0.15;
    return [s.x + Math.sin(s.yaw) * f, s.z + Math.cos(s.yaw) * f];
  }
  function seatApproach(s) {
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
    let dirs;
    if (s.kind === 'bed' || s.lie) dirs = [[rx, rz], [-rx, -rz], [fx, fz], [-fx, -fz]];
    else if (s.from === 'front' || s.kind === 'sofa' || s.kind === 'rest') dirs = [[fx, fz], [rx, rz], [-rx, -rz], [-fx, -fz]];
    else dirs = [[-fx, -fz], [rx, rz], [-rx, -rz], [fx, fz]];
    for (const d of [0.7, 0.9, 1.15, 1.4]) for (const [dx, dz] of dirs) {
      const x = s.x + dx * d, z = s.z + dz * d;
      if (!blocked(x, z)) return [x, z];
    }
    return nearestFree(s.x, s.z);
  }

  class Agent {
    constructor(id, name, skin, isPlayer = false) {
      this.id = id; this.name = name; this.isPlayer = isPlayer;
      this.m = makeMamaco(name, skin);
      this.pos = this.m.root.position;
      this.vel = new THREE.Vector3();
      this.yaw = 0; this.prevYaw = 0; this.prevSpeed = 0;
      this.path = []; this.goal = null; this.seat = null; this.standFrom = null;
      this.y = 0; this.vy = 0; this.air = false; this.preJump = 0; this.jumpQueued = false;
      this.talkT = 0; this.zone = null; this.room = null; this.color = '#fff';
      scene.add(this.m.root);
      const el = document.createElement('div');
      el.className = 'tag';
      el.innerHTML = '<div class="emote"></div><div class="bubble"></div><div class="cam" hidden><video muted playsinline autoplay></video></div><div class="zzz" hidden>z z z</div><div class="name"><img alt="" hidden referrerpolicy="no-referrer"><i></i><span></span></div><div class="game"></div>';
      el.querySelector('.name span').textContent = isPlayer ? 'Você' : name;
      labelsEl.appendChild(el);
      this.tag = el; this.bubbleEl = el.querySelector('.bubble'); this.nameEl = el.querySelector('.name'); this.zzzEl = el.querySelector('.zzz');
      this.bubbleT = 0;
      this.avatarUrl = null;
      this.camEl = el.querySelector('.cam'); this.gameEl = el.querySelector('.game'); this.emoteEl = el.querySelector('.emote');
    }
    // Bolinha da câmera: só aparece com a câmera LIGADA de verdade. A
    // stream da call sempre existe (leva o áudio do microfone) — antes isso
    // mostrava uma bolinha preta em cima de quem estava sem câmera. Enquanto
    // o vídeo não chega, o fundo é a foto de perfil.
    setVideo(stream, mirror = false) {
      const v = this.camEl.querySelector('video');
      const track = stream?.getVideoTracks?.()[0] || null;
      if (track === this.camTrack) { this.camEl.classList.toggle('mirror', !!mirror); return; }
      this.camOff?.();
      this.camOff = null; this.camTrack = track;
      if (!track) { v.srcObject = null; this.camEl.hidden = true; return; }
      v.srcObject = new MediaStream([track]);
      v.muted = true;
      this.camEl.classList.toggle('mirror', !!mirror);
      this.camEl.style.background = this.avatarUrl ? `#0c0a10 center/cover url("${this.avatarUrl}")` : '';
      const upd = () => {
        const on = track.readyState === 'live' && track.enabled && !track.muted;
        this.camEl.hidden = !on;
        if (on) v.play().catch(() => {});
      };
      for (const ev of ['mute', 'unmute', 'ended']) track.addEventListener(ev, upd);
      this.camOff = () => { for (const ev of ['mute', 'unmute', 'ended']) track.removeEventListener(ev, upd); };
      upd();
    }
    setStatusLine(text) { const t = text ? String(text).slice(0, 60) : ''; if (this.gameEl.textContent !== t) this.gameEl.textContent = t; }
    emote(emoji) {
      const e = this.emoteEl;
      e.textContent = emoji;
      e.classList.remove('go'); void e.offsetWidth; e.classList.add('go');
      const m = this.m;
      const happy = { '😂': 'feliz', '🎉': 'feliz', '❤️': 'gostoso', '👍': 'feliz', '👋': 'feliz', '🔥': 'garra', '😮': 'susto', '😴': 'sono', '🤔': 'serio', '🎵': 'falando' };
      m.emoteExpr = happy[emoji] || 'feliz'; m.emoteT = 2.2;
      if (emoji === '👋') m.wave();
      if ((emoji === '🎉' || emoji === '🔥') && !this.seat) this.jumpQueued = true;
    }
    setAvatar(url) {
      if ((url || null) === this.avatarUrl) return;
      this.avatarUrl = url || null;
      const img = this.tag.querySelector('.name img');
      if (!url) { img.hidden = true; img.removeAttribute('src'); return; }
      img.onerror = () => { img.hidden = true; };
      img.onload = () => { img.hidden = false; };
      img.src = url;
    }
    destroy() {
      if (this.seat) this.seat.occupant = null;
      scene.remove(this.m.root);
      this.m.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      this.setVideo(null);
      this.tag.remove();
    }
    sitOn(seat, instant = false) {
      if (this.isPlayer) stat(seat.kind === 'bed' || seat.lie ? 'lie' : 'sit');
      if (this.seat && this.seat !== seat) this.seat.occupant = null;
      this.seat = seat;
      seat.occupant = this;
      this.m.seatH = seat.h;
      this.m.bedH = seat.bedH ?? 0.5;
      this.path = []; this.goal = null; this.standFrom = null;
      this.vel.set(0, 0, 0);
      this.m.drinkT = Math.min(this.m.drinkT, 0);
      if (instant) {
        const [sx, sz] = seatPoint(seat);
        this.pos.set(sx, 0, sz); this.yaw = seat.yaw;
        this.settling = false; this.applySeat();
        this.m.sitK = 1; if (this.m.lying) this.m.lie = 1;
      } else this.settling = true; // primeiro vira de costas pro assento, depois senta
    }
    applySeat() {
      const seat = this.seat;
      const lie = seat.kind === 'bed' || !!seat.lie;
      this.m.lying = lie; this.m.sitting = !lie; this.m.sway = !!seat.hammock;
      this.m.typing = !this.isPlayer && seat.kind === 'desk' && this.status !== 'idle';
      this.m.mood = seat.kind === 'bed' ? 'sleep' : seat.kind === 'rest' ? 'rest' : 'normal';
      if (this.isPlayer) SFX.sit();
    }
    standUp() {
      if (!this.seat) return;
      const s = this.seat;
      s.occupant = null;
      this.seat = null; this.settling = false;
      const wasLying = this.m.lying;
      if (this.isPlayer) SFX.stand();
      this.m.sitting = false; this.m.lying = false; this.m.typing = false; this.m.mood = 'normal'; this.m.sway = false;
      const [fx, fz] = seatApproach(s);
      // primeiro levanta (o corpo sobe), depois dá o passo pra fora
      this.standFrom = { x: this.pos.x, z: this.pos.z, tx: fx, tz: fz, t: 0, delay: wasLying ? 0.55 : 0.22, dur: wasLying ? 0.55 : 0.45 };
    }
    goTo(x, z, { seat = null, run = false, then = null } = {}) {
      this.standUp();
      this.faceTo = null;
      const [ax, az] = seat ? seatApproach(seat) : [x, z];
      const tx = ax, tz = az;
      const fx = this.standFrom ? this.standFrom.tx : this.pos.x, fz = this.standFrom ? this.standFrom.tz : this.pos.z;
      this.path = findPath(fx, fz, tx, tz);
      this.goal = { x: tx, z: tz, seat, run, then };
      if (seat) seat.occupant = this; // reserva
    }
    step(dt, input) {
      let speed = 0;
      if (this.standFrom) {
        const s = this.standFrom;
        s.t += dt;
        const k = smooth((s.t - s.delay) / s.dur);
        this.pos.x = s.x + (s.tx - s.x) * k; this.pos.z = s.z + (s.tz - s.z) * k;
        if (s.t >= s.delay + s.dur) this.standFrom = null;
      } else if (this.seat) {
        const err = angleDiff(this.yaw, this.seat.yaw);
        this.yaw += err * (1 - Math.exp(-7 * dt));
        if (this.settling && Math.abs(err) < 0.55) { this.settling = false; this.applySeat(); }
        if (Math.abs(err) < 1.1) {
          const k = 1 - Math.exp(-(this.m.lying ? 4 : 5.5) * dt);
          const [sx, sz] = seatPoint(this.seat);
          this.pos.x += (sx - this.pos.x) * k;
          this.pos.z += (sz - this.pos.z) * k;
        }
      } else {
        const want = new THREE.Vector3();
        let max = WALK;
        if (input && input.lengthSq() > 0) {
          want.copy(input).normalize();
          max = (input.run ? RUN : WALK) * (this.isPlayer && energyT > 0 ? 1.3 : 1);
          if (this.goal?.seat && this.goal.seat.occupant === this) this.goal.seat.occupant = null;
          this.path = []; this.goal = null;
        } else if (this.path.length) {
          const [tx, tz] = this.path[0];
          const dx = tx - this.pos.x, dz = tz - this.pos.z;
          const d = Math.hypot(dx, dz);
          const last = this.path.length === 1;
          if (d < (last ? 0.12 : 0.55)) {
            this.path.shift();
            if (!this.path.length) this.arrive();
          } else {
            want.set(dx / d, 0, dz / d);
            max = this.goal?.run ? RUN : WALK;
            if (last) max = Math.min(max, d * 2.4 + 0.35);
            if (!last && this.path[1]) {
              // olha à frente: perto da quina já vai curvando pro próximo ponto
              // (em vez de chegar no ponto e virar seco)
              const [nx, nz] = this.path[1];
              const ex = nx - tx, ez = nz - tz, el = Math.hypot(ex, ez) || 1;
              const ang = Math.abs(angleDiff(Math.atan2(dx, dz), Math.atan2(ex, ez)));
              const k = smooth(1 - d / 1.1) * 0.85;
              // só corta a quina se o caminho até lá estiver livre
              if (k > 0 && !blocked(this.pos.x + ((dx / d) * (1 - k) + (ex / el) * k) * 0.45, this.pos.z + ((dz / d) * (1 - k) + (ez / el) * k) * 0.45)) {
                want.x = want.x * (1 - k) + (ex / el) * k; want.z = want.z * (1 - k) + (ez / el) * k;
                const wl = Math.hypot(want.x, want.z) || 1; want.x /= wl; want.z /= wl;
              }
              if (d < 1.2 && ang > 1.2) max *= 0.85;
            }
          }
        }
        const targetVel = want.multiplyScalar(max);
        // velocidade: módulo e direção separados — curva em arco, sem "derrapar"
        const curSp = Math.hypot(this.vel.x, this.vel.z);
        const tgtSp = targetVel.length();
        const spRate = tgtSp > curSp ? (this.air ? 2.5 : 6) : (this.air ? 1.2 : 8);
        const newSp = damp(curSp, tgtSp, spRate, dt);
        let hd = curSp > 0.05 ? Math.atan2(this.vel.x, this.vel.z) : (tgtSp > 0 ? Math.atan2(targetVel.x, targetVel.z) : this.yaw);
        if (tgtSp > 0) {
          const diff = angleDiff(hd, Math.atan2(targetVel.x, targetVel.z));
          // meia-volta: freia antes de virar
          const turnRate = (this.air ? 4 : 10) - Math.min(4, curSp * 0.9);
          hd += diff * (1 - Math.exp(-turnRate * dt));
        }
        const brake = tgtSp > 0 ? 1 - 0.55 * smooth((Math.abs(angleDiff(hd, Math.atan2(targetVel.x, targetVel.z))) - 1.6) / 1.2) : 1;
        this.vel.x = Math.sin(hd) * newSp * brake; this.vel.z = Math.cos(hd) * newSp * brake;
        const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
        const stuck = blocked(this.pos.x, this.pos.z);
        if (stuck || !blocked(nx, this.pos.z)) this.pos.x = nx; else this.vel.x *= 0.2;
        if (stuck || !blocked(this.pos.x, nz)) this.pos.z = nz; else this.vel.z *= 0.2;
        speed = Math.hypot(this.vel.x, this.vel.z);
        // travou numa quina seguindo caminho? recalcula a rota daqui
        if (this.path.length && !(input && input.lengthSq() > 0)) {
          this.stuckT = speed < 0.25 && max > 0.6 ? (this.stuckT || 0) + dt : 0;
          if (this.stuckT > 0.5) {
            this.stuckT = 0;
            const [gx, gz] = this.path[this.path.length - 1];
            const np = findPath(this.pos.x, this.pos.z, gx, gz);
            if (np && np.length) this.path = np; else { this.path.shift(); if (!this.path.length) this.arrive(); }
          }
        }
        if (input && input.lengthSq() > 0) this.faceTo = null;
        const face = speed > 0.15 ? Math.atan2(this.vel.x, this.vel.z) : (want.lengthSq() > 0 ? Math.atan2(want.x, want.z) : (this.faceTo ?? null));
        if (face !== null) {
          // giro do corpo com mola (acelera e desacelera o giro, sem estalo)
          const err = angleDiff(this.yaw, face);
          this.yawVel = (this.yawVel || 0) + (err * 90 - (this.yawVel || 0) * 17) * Math.min(dt, 1 / 30);
          this.yaw += this.yawVel * dt;
        } else this.yawVel = (this.yawVel || 0) * Math.exp(-12 * dt);
      }
      const turn = clamp(angleDiff(this.prevYaw, this.yaw) / Math.max(dt, 1e-3), -6, 6);
      this.prevYaw = this.yaw;
      const accel = (speed - this.prevSpeed) / Math.max(dt, 1e-3);
      this.prevSpeed = speed;
      // RPG: corpo vira em 8 direções (sentado/deitado segue o assento)
      this.m.root.rotation.y = this.seat ? this.yaw : Math.round(this.yaw / (Math.PI / 4)) * (Math.PI / 4);
      if (this.jumpQueued && !this.air && this.preJump <= 0 && !this.seat) { this.preJump = 0.11; this.m.anticipate(); }
      this.jumpQueued = false;
      if (this.preJump > 0) { this.preJump -= dt; if (this.preJump <= 0) { this.vy = JUMP_V; this.air = true; if (this.isPlayer) SFX.jump(); } }
      if (this.air) {
        this.vy -= GRAV * dt; this.y += this.vy * dt;
        if (this.y <= 0) { this.y = 0; this.air = false; this.m.land(Math.min(0.26, Math.abs(this.vy) * 0.04)); this.vy = 0; if (this.isPlayer) SFX.land(); }
      }
      this.pos.y = this.y;
      if (this.talkT > 0) this.talkT -= dt;
      return { speed: Math.max(speed, this.scriptSpeed || 0), air: this.air, vy: this.vy, turn, accel };
    }
    arrive() {
      const g = this.goal;
      this.goal = null;
      if (!g) return;
      if (g.seat && (!g.seat.occupant || g.seat.occupant === this)) this.sitOn(g.seat);
      if (g.then) g.then(this);
    }
  }

  // ---------- Dados ----------
  let data = { serverName: 'Servidor', categories: [], members: [] };
  let mySkin = opts.mySkin || defaultSkin(opts.me.id);
  const player = new Agent(opts.me.id, opts.me.name, mySkin, true);
  agents.set(opts.me.id, player);
  let built = null;
  let worldSig = '';
  let speakingIds = new Set();
  let lastMyVoice = undefined;

  function specFrom(d) {
    const cats = d.categories.map((c, i) => ({ id: c.id, name: c.name, color: c.color || SECTOR_COLORS[i % SECTOR_COLORS.length], text: c.text || [], voice: c.voice || [] }));
    // sala de Minigames: vira call quando o servidor tem um canal de voz pra
    // ela (data.minigamesRoom = { id, name }); senão é só uma sala de jogar
    const mg = d.minigamesRoom;
    cats.push(mg ? { ...SPECIALS, voice: [{ id: mg.id, name: mg.name || 'Minigames', theme: 'arcade', voice: true, private: !!mg.private }, ...SPECIALS.voice.slice(1)] } : SPECIALS);
    sectorColors = { recepcao: '#f4511e' };
    for (const c of cats) sectorColors[c.id] = c.color;
    return { categories: cats };
  }
  function rebuildWorld() {
    for (const a of agents.values()) { a.seat = null; a.settling = false; a.m.sitting = false; a.m.lying = false; a.m.sway = false; a.m.mood = 'normal'; a.m.typing = false; a.path = []; a.goal = null; a.standFrom = null; a.placeKey = null; }
    const keep = { x: player.pos.x, z: player.pos.z };
    const prevZone = player.zone?.id || null;
    built = buildWorld(specFrom(data));
    const [fx, fz] = nearestFree(keep.x, keep.z);
    player.pos.set(fx, 0, fz);
    // As salas mudaram (canal criado/apagado): se o mesmo ponto agora cai
    // dentro de OUTRA sala de voz, não entra na call dela sozinho (antes
    // criar um canal te jogava, por exemplo, na call do Cinema). Exceção: a
    // sala de Minigames que acabou de virar call — aí entra, porque você
    // já estava nela.
    { const zn = zoneAt(fx, fz); const nr = zn && zn.kind === 'room' && ROOMS[zn.id]?.voice ? zn.id : null;
      const sameMg = prevZone === 'special:minigames' && nr && ROOMS[nr].theme.id === 'arcade';
      if (nr && nr !== prevZone && nr !== playerRoom && !sameMg) ignoreRoom = nr; }
    buildSigns();
    for (const id of roomScreens.keys()) applyRoomScreen(id);
    buildGuards();
    drawBoard();
    wcSeq = null; coffeeSeq = null; player.m.root.visible = true;
    toonify(scene);
  }

  // ---------- TV das salas (transmissão de tela) ----------
  // Nada aqui baixa vídeo: o app só entrega um <video> que ELE já está
  // recebendo (quando a pessoa pede pra assistir). Aqui é só desenhar.
  const roomScreens = new Map(); // roomId -> { src, mat, tex, cvs, ctx, acc }
  function liveCard(ctx, W, H, src) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1b1424'); g.addColorStop(1, '#0d0a12');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ef4444';
    ctx.beginPath(); ctx.arc(W / 2 - 92, H * 0.36, 13, 0, Math.PI * 2); ctx.fill();
    ctx.font = '800 40px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText('AO VIVO', W / 2 - 70, H * 0.36);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.font = '700 30px system-ui, sans-serif';
    ctx.fillText(String(src.label || 'Transmissão de tela').slice(0, 32), W / 2, H * 0.56);
    ctx.fillStyle = 'rgba(255,255,255,.65)'; ctx.font = '500 22px system-ui, sans-serif';
    ctx.fillText(src.hint || 'Aperte F ou clique na TV pra assistir', W / 2, H * 0.74);
  }
  function drawScreen(e) {
    const { ctx, cvs, src } = e;
    const W = cvs.width, H = cvs.height;
    const media = src.video || src.canvas;
    const mw = media ? (media.videoWidth || media.width || 0) : 0, mh = media ? (media.videoHeight || media.height || 0) : 0;
    if (!media || !mw || !mh) { liveCard(ctx, W, H, src); e.tex.needsUpdate = true; return; }
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const k = Math.min(W / mw, H / mh), dw = mw * k, dh = mh * k;
    try { ctx.drawImage(media, (W - dw) / 2, (H - dh) / 2, dw, dh); } catch { liveCard(ctx, W, H, src); }
    if (src.label) {
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(10, 10, 14 + ctx.measureText(src.label).width + 40, 34);
      ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(28, 27, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '600 18px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(src.label, 42, 27);
    }
    e.tex.needsUpdate = true;
  }
  function applyRoomScreen(roomId) {
    const e = roomScreens.get(roomId);
    for (const it of INTERACT) {
      if (it.kind !== 'tv' || it.room !== roomId || !it.mesh) continue;
      it.mesh.material = e ? e.mat : it.baseMat;
    }
  }
  function setRoomScreen(roomId, src) {
    let e = roomScreens.get(roomId);
    if (!src) {
      if (e) { e.tex.dispose(); e.mat.dispose(); roomScreens.delete(roomId); applyRoomScreen(roomId); }
      return;
    }
    if (!e) {
      const cvs = document.createElement('canvas'); cvs.width = 640; cvs.height = 360;
      const tex = new THREE.CanvasTexture(cvs); tex.colorSpace = THREE.SRGBColorSpace;
      e = { cvs, ctx: cvs.getContext('2d'), tex, mat: new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), acc: 0 };
      roomScreens.set(roomId, e);
    }
    e.src = src;
    drawScreen(e);
    applyRoomScreen(roomId);
  }
  function tickScreens(dt) {
    for (const e of roomScreens.values()) {
      if (!e.src.video && !e.src.canvas) continue;
      e.acc += dt;
      if (e.acc < 1 / 15) continue; // 15 quadros/s na TV já basta
      e.acc = 0;
      drawScreen(e);
    }
  }

  // Onde cada pessoa deve estar, a partir do estado real dela
  function placeKeyOf(m) {
    if (m.voiceChannelId && ROOMS[m.voiceChannelId]) return 'voice:' + m.voiceChannelId;
    if (m.status === 'offline') return 'offline';
    if (m.status === 'idle') return 'idle';
    return 'desk';
  }
  const deskAreaOf = (id) => {
    const areas = Object.keys(built.homeSeats).filter((k) => k !== 'recepcao' && k !== '__convivencia' && built.homeSeats[k].length);
    return areas.length ? areas[hashStr(id) % areas.length] : 'recepcao';
  };
  function seatFor(m, key) {
    const free = (s) => !s.occupant;
    if (key.startsWith('voice:')) {
      const id = key.slice(6);
      return seats.find((s) => s.room === id && free(s) && s.kind !== 'bed') || null;
    }
    if (key === 'offline') return seats.find((s) => s.kind === 'bed' && free(s)) || seats.find((s) => s.room === 'special:offline' && free(s)) || null;
    if (key === 'idle') return seats.find((s) => s.kind === 'rest' && free(s) && !ROOMS[s.room]?.voice) || seats.find((s) => s.room === 'special:descanso' && free(s)) || null;
    const list = built.homeSeats[deskAreaOf(m.id)] || [];
    const start = hashStr(m.id) % Math.max(1, list.length);
    for (let i = 0; i < list.length; i++) { const s = list[(start + i * 7) % list.length]; if (free(s)) return s; }
    return seats.find((s) => s.kind === 'desk' && free(s)) || null;
  }
  const MAX_AVATARS = opts.maxAvatars || 60;
  function syncMembers(first) {
    const rank = (m) => (m.voiceChannelId ? 0 : m.status === 'online' || m.status === 'dnd' ? 1 : m.status === 'idle' ? 2 : 3);
    const others = data.members.filter((m) => m.id !== opts.me.id).sort((a, b) => rank(a) - rank(b));
    const shown = others.slice(0, MAX_AVATARS);
    const keepIds = new Set(shown.map((m) => m.id));
    for (const [id, a] of agents) if (!a.isPlayer && !keepIds.has(id)) { a.destroy(); agents.delete(id); }
    for (const m of shown) {
      let a = agents.get(m.id);
      const fresh = !a;
      if (!a) { a = new Agent(m.id, m.name, m.skin || defaultSkin(m.id)); agents.set(m.id, a); }
      else if (m.skin && JSON.stringify(m.skin) !== a.skinSig) applySkin(a.m, m.skin);
      a.skinSig = m.skin ? JSON.stringify(m.skin) : a.skinSig;
      a.status = m.status;
      a.setAvatar(m.avatarUrl);
      a.home = deskAreaOf(m.id);
      a.color = m.voiceChannelId ? sectorColor(ROOMS[m.voiceChannelId]?.sector) : sectorColor(a.home);
      const key = placeKeyOf(m);
      if (key === a.placeKey) {
        if (a.seat?.kind === 'desk') a.m.typing = m.status !== 'idle';
        continue;
      }
      a.placeKey = key;
      const s = seatFor(m, key);
      if (fresh || first || !s) {
        if (s) a.sitOn(s, true);
        else { const z = key === 'offline' ? ROOMS['special:offline'] : null; const [x, zz] = nearestFree(...(z ? z.center : [3, 6])); a.pos.set(x, 0, zz); }
      } else {
        // Entrou numa call: aparece na porta da sala e entra (antes atravessava
        // o escritório inteiro andando e demorava pra "chegar" na sala).
        // Outras mudanças longe demais: já aparece sentado no lugar novo.
        const R = key.startsWith('voice:') ? ROOMS[key.slice(6)] : null;
        const [ax, az] = seatApproach(s);
        const far = Math.hypot(a.pos.x - ax, a.pos.z - az);
        if (R?.door && far > 5) {
          if (a.seat) { a.seat.occupant = null; a.seat = null; }
          a.settling = false; a.standFrom = null; a.path = []; a.goal = null;
          a.m.sitting = false; a.m.lying = false; a.m.typing = false; a.m.mood = 'normal'; a.m.sway = false; a.m.sitK = 0;
          a.pos.set(R.door[0], 0, R.door[1]);
          a.emote('✨');
          a.goTo(0, 0, { seat: s, run: true });
        } else if (far > 22) a.sitOn(s, true);
        else a.goTo(0, 0, { seat: s, run: !!R });
      }
    }
    // você: entrou numa call pelo modo clássico → aparece sentado na sala
    const me = data.members.find((m) => m.id === opts.me.id);
    player.setAvatar(me?.avatarUrl || opts.me.avatarUrl);
    const myVoice = me?.voiceChannelId && ROOMS[me.voiceChannelId] ? me.voiceChannelId : null;
    if (myVoice !== lastMyVoice) {
      if (myVoice && player.room !== myVoice) {
        const s = seats.find((st) => st.room === myVoice && !st.occupant);
        if (s) player.sitOn(s, true); else { const [x, z] = nearestFree(...ROOMS[myVoice].center); player.pos.set(x, 0, z); }
        playerRoom = myVoice;
      } else if (!myVoice && lastMyVoice && player.room === lastMyVoice && ROOMS[lastMyVoice]) {
        // saiu da call por fora (clássico/desconectou): sai andando da sala
        ignoreRoom = lastMyVoice;
        player.goTo(...ROOMS[lastMyVoice].door);
      }
      lastMyVoice = myVoice;
    }
  }

  // ---------- Placas ----------
  let signs = [];
  function chipColors(el, a) {
    const c = a.m.top.color;
    el.style.background = '#' + c.getHexString();
    el.style.color = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b > 0.45 ? '#1b1620' : '#fff';
  }
  const initials = (n) => (n || '?').slice(0, 2).toUpperCase();
  function buildSigns() {
    signs.forEach((s) => s.el.remove());
    signs = [];
    for (const r of Object.values(ROOMS)) {
      const el = document.createElement('button');
      el.className = 'sign room';
      el.innerHTML = (r.voice ? SVG_SPK : '') + '<span class="t"><b></b><small></small></span><span class="who"></span>';
      el.querySelector('b').textContent = r.name;
      el.querySelector('small').textContent = r.voice ? r.theme.label : r.theme.id === 'arcade' ? 'Jogue pra relaxar' : r.theme.id === 'dorm' ? 'Quem está offline' : 'Quem está ausente';
      el.style.setProperty('--c', sectorColor(r.sector));
      el.title = r.voice ? `Entrar na call: ${r.name}` : `Ir até ${r.name}`;
      el.onclick = () => api.goToRoom(r.id);
      labelsEl.appendChild(el);
      signs.push({ el, pos: new THREE.Vector3(r.label[0], 2.75, r.label[1]), room: r.id, who: el.querySelector('.who') });
    }
    for (const ar of Object.values(AREAS)) {
      const el = document.createElement('div');
      el.className = 'sign area';
      el.innerHTML = '<span class="t"><b></b><small></small></span><span class="who"></span><span class="badge" hidden></span>';
      el.querySelector('b').textContent = ar.name;
      el.querySelector('small').textContent = ar.theme.label;
      el.style.setProperty('--c', sectorColor(ar.sector));
      labelsEl.appendChild(el);
      signs.push({ el, pos: new THREE.Vector3(ar.label[0], 3.3, ar.label[1]), area: ar.id, sector: ar.sector, who: el.querySelector('.who'), badge: el.querySelector('.badge') });
    }
    paintUnread();
  }
  let unreadBySector = {};
  function paintUnread() {
    for (const s of signs) {
      if (!s.badge) continue;
      const n = unreadBySector[s.sector] || 0;
      s.badge.hidden = !n;
      s.badge.textContent = n > 9 ? '9+' : String(n);
      s.el.title = n ? `${n} canal(is) com mensagem nova` : '';
    }
  }
  function membersAt(sign) {
    const out = [];
    for (const a of agents.values()) if (a.zone && (sign.room ? a.zone.id === sign.room : a.zone.id === sign.area)) out.push(a);
    return out;
  }
  function fillWho(box, list, max = 5) {
    const sig = list.map((a) => a.id + (a.m.talking ? '*' : '')).join(',');
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.innerHTML = '';
    for (const a of list.slice(0, max)) {
      const d = document.createElement('span');
      d.className = 'mini' + (a.m.talking ? ' speaking' : '');
      d.title = a.isPlayer ? 'Você' : a.name;
      d.textContent = a.isPlayer ? 'EU' : initials(a.name);
      chipColors(d, a);
      box.appendChild(d);
    }
    if (list.length > max) { const m = document.createElement('span'); m.className = 'mini more'; m.textContent = '+' + (list.length - max); box.appendChild(m); }
  }

  // ---------- Entrada ----------
  const keys = new Set();
  let paused = false;
  const typing = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  function onKeyDown(e) {
    if (paused || typing()) return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'shift'].includes(k)) {
      if (k.startsWith('arrow') || k === ' ') e.preventDefault();
      keys.add(k);
      if (k === ' ') player.jumpQueued = true;
    }
    if (k === 'z') rotateCam(-1);
    if (k === 'c') rotateCam(1);
    if (wcSeq) return;
    if (k === 'e') primaryAction();
    if (k === 'f') useAction();
    if (k === 'q') { player.m.wave(); stat('wave'); }
    if (k === 'm') toggleBig();
    if (k === 'escape' && !bigBox.hidden) toggleBig(false);
  }
  const onKeyUp = (e) => keys.delete(e.key.toLowerCase());
  const onBlur = () => keys.clear();
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);
  addEventListener('blur', onBlur);

  // O que dá pra fazer perto de você (mostra "E Sentar", "F Ver TV"…)
  let near = { seat: null, use: null };
  function scanNear() {
    near = { seat: null, use: null };
    if (player.seat) {
      if (player.seat.kind === 'desk') near.use = INTERACT.find((i) => i.kind === 'pc' && i.seat === player.seat) || null;
      return;
    }
    let bd = 1.3;
    for (const s of seats) {
      if (s.occupant) continue;
      const d = Math.hypot(s.x - player.pos.x, s.z - player.pos.z);
      if (d < bd) { bd = d; near.seat = s; }
    }
    let bu = 1.7;
    for (const it of INTERACT) {
      if (it.kind === 'pc') continue;
      const [fx, fz] = it.front || [it.x, it.z];
      const d = Math.min(Math.hypot(fx - player.pos.x, fz - player.pos.z), Math.hypot(it.x - player.pos.x, it.z - player.pos.z));
      if (d < bu) { bu = d; near.use = it; }
    }
  }
  const SEAT_WORD = { bed: 'Deitar', rest: 'Descansar', sofa: 'Sentar no sofá', stool: 'Sentar', desk: 'Sentar', meet: 'Sentar' };
  const USE_WORD = { tv: 'Ver TV', arcade: 'Jogar', pc: 'Usar computador', coffee: 'Pegar café', energy: 'Pegar energético', wc: 'Usar banheiro' };
  let promptSig = '';
  function renderPrompt() {
    const parts = [];
    if (wcSeq) { promptEl.hidden = true; promptSig = ''; return; }
    if (player.seat) parts.push(['E', player.seat.kind === 'bed' ? 'Levantar da cama' : 'Levantar']);
    else if (near.seat) parts.push(['E', SEAT_WORD[near.seat.kind] || 'Sentar']);
    if (near.use) parts.push(['F', near.use.kind === 'wc' && near.use.busy ? 'Ocupado' : near.use.kind === 'arcade' && near.use.game === 'kart' ? 'Correr de kart' : USE_WORD[near.use.kind]]);
    const sig = parts.map((p) => p.join(':')).join('|');
    if (sig === promptSig) return;
    promptSig = sig;
    promptEl.hidden = !parts.length;
    promptEl.innerHTML = '';
    for (const [k, t] of parts) { const s = document.createElement('span'); const kb = document.createElement('kbd'); kb.textContent = k; s.append(kb, t); promptEl.appendChild(s); }
  }
  function primaryAction() {
    if (player.seat) { player.standUp(); return; }
    if (near.seat) sitPlayer(near.seat);
  }
  function sitPlayer(seat) {
    player.goTo(0, 0, { seat });
  }
  function useAction() { if (near.use) use(near.use); }
  let wcSeq = null, coffeeSeq = null, energyT = 0;
  function say(a, text, secs = 2.5) { a.bubbleEl.textContent = text; a.bubbleEl.classList.add('show'); a.bubbleT = secs; }
  function use(it) {
    if (wcSeq) return;
    if (it.kind === 'coffee' || it.kind === 'wc' || it.kind === 'energy') {
      const [fx, fz] = it.front;
      if (player.seat || Math.hypot(player.pos.x - fx, player.pos.z - fz) > 0.35) {
        player.goTo(fx, fz, { then: () => use(it) });
        return;
      }
      player.faceTo = Math.atan2(it.x - fx, it.z - fz);
      if (it.kind === 'coffee' || it.kind === 'energy') {
        if (coffeeSeq) return;
        const en = it.kind === 'energy';
        coffeeSeq = { t: 0, it, en }; stat(en ? 'energy' : 'coffee');
        say(player, en ? '⚡ Enchendo um energético…' : '☕ Passando um café…', 2);
      } else {
        if (it.busy) { say(player, 'Ocupado! 🚪', 1.6); return; }
        wcSeq = { it, t: 0, from: [fx, fz] }; stat('wc');
        it.busy = 1;
      }
      return;
    }
    if (it.kind === 'tv') {
      const rm = (it.room && ROOMS[it.room]) || zoneAt(it.x, it.z)?.room || null;
      opts.onUseTv?.({ screen: it.screen, image: SCREEN[it.screen]?.map?.image || null, room: rm ? { id: rm.id, name: rm.name, voice: rm.voice, theme: rm.theme.id } : null, live: !!(rm && roomScreens.has(rm.id)) });
    }
    else if (it.kind === 'arcade') opts.onArcade?.(it.game);
    else if (it.kind === 'pc') opts.onUsePc?.({ sector: it.seat.sector });
  }

  // clique: chão, cadeira, TV, computador, fliperama
  const ray = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.24, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
  marker.rotation.x = -Math.PI / 2; marker.position.y = 0.03;
  scene.add(marker);
  let downAt = null;
  canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!downAt || wcSeq) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    const quick = performance.now() - downAt.t < 350;
    downAt = null;
    if (moved > 6 || !quick || e.button !== 0) return;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    // clicou numa pessoa? (abre o cartão dela no app — volume, perfil)
    if (opts.onAvatarClick) {
      let hitA = null, hd = Infinity;
      const pt = new THREE.Vector3();
      for (const [id, a] of agents) {
        if (a.isPlayer || !a.m.root.visible) continue;
        const lying = a.m.lying && a.seat;
        pt.set(a.pos.x, (lying ? 0.65 : a.seat ? 0.75 : 0.9) + a.pos.y, a.pos.z);
        if (ray.ray.distanceToPoint(pt) > (lying ? 0.55 : 0.42)) continue;
        const d = pt.distanceTo(ray.ray.origin);
        if (d < hd) { hd = d; hitA = id; }
      }
      if (hitA) { opts.onAvatarClick(hitA, { x: e.clientX, y: e.clientY }); return; }
    }
    // objetos usáveis: testa a "altura" deles (TV ~1.3 m, fliperama ~1.2 m, monitor ~1 m)
    let best = null, bd = 0.9;
    for (const it of INTERACT) {
      const h = it.h || (it.kind === 'tv' ? 1.3 : it.kind === 'arcade' ? 1.2 : 1.0);
      const p = new THREE.Vector3(it.x, h, it.z);
      const d = ray.ray.distanceToPoint(p);
      if (d < bd) { bd = d; best = it; }
    }
    if (best) {
      if (best.kind === 'pc') { if (!best.seat.occupant || best.seat.occupant === player) player.goTo(0, 0, { seat: best.seat, then: () => use(best) }); }
      else if (best.kind === 'coffee' || best.kind === 'wc' || best.kind === 'energy') use(best);
      else { const [fx, fz] = best.front || [best.x, best.z]; player.goTo(fx, fz, { then: () => { player.faceTo = Math.atan2(best.x - player.pos.x, best.z - player.pos.z); use(best); } }); }
      return;
    }
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(groundPlane, hit)) return;
    let seat = null, sd = 0.6;
    for (const s of seats) { if (s.occupant) continue; const d = Math.hypot(s.x - hit.x, s.z - hit.z); if (d < sd) { sd = d; seat = s; } }
    if (seat) { sitPlayer(seat); marker.position.set(seat.x, 0.03, seat.z); }
    else { player.goTo(hit.x, hit.z, { run: Math.hypot(hit.x - player.pos.x, hit.z - player.pos.z) > 8 }); marker.position.set(hit.x, 0.03, hit.z); }
    marker.material.opacity = 0.9;
    marker.scale.setScalar(1.6);
  });
  const camFwd = new THREE.Vector3(), camRight = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  function playerInput() {
    camera.getWorldDirection(camFwd); camFwd.y = 0; camFwd.normalize();
    camRight.crossVectors(camFwd, UP);
    const ix = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    const iz = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
    const v = new THREE.Vector3().addScaledVector(camFwd, iz).addScaledVector(camRight, ix);
    v.run = keys.has('shift');
    if (v.lengthSq() > 0 && player.seat) player.standUp();
    return v;
  }

  // ---------- Café / banheiro (só o seu boneco; ninguém recebe nada) ----------
  const WC_TIME = 6;
  function tickActions(dt) {
    if (coffeeSeq) {
      // aperta o botão → espera a máquina (vapor) → pega a caneca → 1º gole "ahh"
      const c = coffeeSeq;
      if (c.t === 0) { player.m.pressT = 0.9; c.steam = c.en ? null : makeSteam(c.it); SFX.press(); setTimeout(() => SFX.brew(), 350); }
      c.t += dt;
      if (c.steam) tickSteam(c.steam, dt, c.t < 2.2);
      if (c.t > 2.3) {
        coffeeSeq = null;
        player.m.drinkT = 30;
        player.m.drinkKind = c.en ? 'energy' : 'coffee';
        player.m.rpg && (player.m.rpg.ovFrame = 5); // começa já no gole
        // energético: 25 s andando mais rápido e com cara de "bora"
        if (c.en) { energyT = 25; player.m.emoteExpr = 'garra'; player.m.emoteT = 2; }
        say(player, c.en ? '⚡ BORA!' : '☕ ahh…', 1.6);
        SFX.clink();
        if (c.steam) setTimeout(() => { scene.remove(c.steam.g); }, 800);
      }
    }
    if (wcSeq) {
      const w = wcSeq, it = w.it;
      w.t += dt;
      const t = w.t, yaw = it.yaw;
      const inX = it.x - Math.sin(yaw) * 0.35, inZ = it.z - Math.cos(yaw) * 0.35;
      const [fx, fz] = w.from;
      const tOut = 1.6 + WC_TIME;
      player.scriptSpeed = (t > 0.5 && t < 1.2) || (t > tOut + 0.5 && t < tOut + 1.25) ? 1.1 : 0;
      if (t < 0.5) { if (!w.s1) { w.s1 = true; SFX.door(); } it.openT = 1; }
      else if (t < 1.25) { const k = smooth((t - 0.5) / 0.7); player.pos.x = fx + (inX - fx) * k; player.pos.z = fz + (inZ - fz) * k; player.faceTo = Math.atan2(inX - fx, inZ - fz); }
      else if (t < tOut) {
        if (player.m.root.visible) { player.m.root.visible = false; it.sign.material = wcSignMat(true); }
        it.openT = 0;
      } else if (t < tOut + 0.5) { it.openT = 1; }
      else if (t < tOut + 1.3) {
        if (!player.m.root.visible) { player.m.root.visible = true; player.yaw = yaw; player.faceTo = yaw; it.sign.material = wcSignMat(false); SFX.flush(); setTimeout(() => SFX.door(), 500); }
        const k = smooth((t - tOut - 0.5) / 0.75); player.pos.x = inX + (fx - inX) * k; player.pos.z = inZ + (fz - inZ) * k;
      } else { it.openT = 0; it.busy = 0; wcSeq = null; player.faceTo = null; player.scriptSpeed = 0; }
    }
  }
  // vapor da máquina de café (bolinhas subindo)
  function makeSteam(it) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false });
    const puffs = [];
    for (let i = 0; i < 7; i++) { const p = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), mat.clone()); p.userData.t = i / 7; g.add(p); puffs.push(p); }
    g.position.set(it.x + Math.sin(it.yaw) * 0.12, (it.h || 1.2) + 0.1, it.z + Math.cos(it.yaw) * 0.12);
    scene.add(g);
    return { g, puffs };
  }
  function tickSteam(st, dt, on) {
    for (const p of st.puffs) {
      p.userData.t = (p.userData.t + dt * 0.7) % 1;
      const k = p.userData.t;
      p.position.set(Math.sin(k * 9 + p.id) * 0.03, k * 0.45, 0);
      p.scale.setScalar(0.6 + k * 1.4);
      p.material.opacity = on ? 0.55 * (1 - k) : Math.max(0, p.material.opacity - dt);
    }
  }
  function tickWcDoors(dt) {
    for (const it of INTERACT) {
      if (it.kind !== 'wc') continue;
      it.open = damp(it.open || 0, it.openT || 0, 5, dt);
      it.door.rotation.y = it.yaw + it.open * 1.45;
    }
  }

  // ---------- Seguranças nas salas privadas ----------
  let guards = [];
  function buildGuards() {
    for (const g of guards) { scene.remove(g.m.root); g.m.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); }
    guards = GUARDS.map((sp, i) => {
      const m = makeMamaco('Segurança', { fur: i % 2 ? '#2f2724' : '#5d5a63', top: '#15131a', outfit: 'seguranca', headset: false });
      m.state.shades = true; m.applyAccessories();
      m.guard = true;
      m.root.position.set(sp.x, 0, sp.z); m.root.rotation.y = sp.yaw;
      scene.add(m.root);
      return { m, sp, t: Math.random() * 10 };
    });
  }
  function tickGuards(dt) {
    for (const g of guards) {
      g.t += dt;
      const dx = player.pos.x - g.sp.x, dz = player.pos.z - g.sp.z;
      const d = Math.hypot(dx, dz);
      // segue você com a cabeça quando passa perto
      g.m.guardLook = d < 5 ? clamp(angleDiff(g.sp.yaw, Math.atan2(dx, dz)), -1.1, 1.1) : Math.sin(g.t * 0.3) * 0.5;
      g.m.update(dt, g.t, { speed: 0 });
    }
  }

  // ---------- Telão da recepção ----------
  let boardData = null, boardMat = null, boardTex = null, boardCvs = null, boardEvents = [];
  function fmtTime(sec) { const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return h ? `${h}h ${String(m).padStart(2, '0')}min` : `${m} min`; }
  let boardPage = 0, boardT = 9;
  function drawEvents(c, W, H, evs) {
    c.fillStyle = '#fff'; c.font = '800 46px Sora, Inter, sans-serif'; c.textAlign = 'left'; c.fillText('Próximos eventos', 48, 62);
    c.fillStyle = '#a19ab0'; c.font = '500 24px Inter, sans-serif'; c.fillText('Deste servidor · confirme presença no app', 48, 106);
    evs.slice(0, 5).forEach((e, i) => {
      const y = 175 + i * 78;
      const d = new Date(e.startsAt);
      c.fillStyle = '#2a2236'; c.beginPath(); c.roundRect(48, y - 32, 86, 64, 12); c.fill();
      c.fillStyle = '#f4511e'; c.font = '800 16px Inter, sans-serif'; c.textAlign = 'center';
      c.fillText(d.toLocaleDateString('pt-BR', { month: 'short', timeZone: 'America/Sao_Paulo' }).replace('.', '').toUpperCase(), 91, y - 14);
      c.fillStyle = '#fff'; c.font = '900 30px Sora, Inter, sans-serif'; c.fillText(d.toLocaleDateString('pt-BR', { day: '2-digit', timeZone: 'America/Sao_Paulo' }), 91, y + 14);
      c.textAlign = 'left'; c.fillStyle = '#fff'; c.font = '700 28px Inter, sans-serif'; c.fillText(String(e.name).slice(0, 34), 156, y - 10);
      c.fillStyle = '#b9b2c6'; c.font = '500 21px Inter, sans-serif';
      const when = d.toLocaleString('pt-BR', { weekday: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
      c.fillText(`${when}${e.where ? ' · ' + e.where : ''} · ${e.going || 0} vão`, 156, y + 22);
    });
  }
  function drawBoard() {
    if (!BOARD) return;
    if (!boardCvs) {
      boardCvs = document.createElement('canvas'); boardCvs.width = 1024; boardCvs.height = 576;
      boardTex = new THREE.CanvasTexture(boardCvs); boardTex.colorSpace = THREE.SRGBColorSpace; boardTex.anisotropy = 4;
      boardMat = new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false });
    }
    const c = boardCvs.getContext('2d'), W = 1024, H = 576;
    const gr = c.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#1a1422'); gr.addColorStop(1, '#0d0b12');
    c.fillStyle = gr; c.fillRect(0, 0, W, H);
    c.fillStyle = '#f4511e'; c.fillRect(0, 0, W, 8);
    const d = boardData || { title: 'Tempo no Mamacos', subtitle: 'Você e seus amigos · últimos 7 dias', rows: [] };
    c.textBaseline = 'middle'; c.textAlign = 'left';
    if (boardPage === 1 && boardEvents.length) {
      drawEvents(c, W, H, boardEvents);
      c.fillStyle = 'rgba(255,255,255,.35)'; c.beginPath(); c.arc(W / 2 - 10, H - 22, 5, 0, 7); c.fill(); c.fillStyle = '#f4511e'; c.beginPath(); c.arc(W / 2 + 10, H - 22, 5, 0, 7); c.fill();
      boardTex.needsUpdate = true; BOARD.mesh.material = boardMat;
      return;
    }
    if (boardEvents.length) { c.fillStyle = '#f4511e'; c.beginPath(); c.arc(W / 2 - 10, H - 22, 5, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,255,.35)'; c.beginPath(); c.arc(W / 2 + 10, H - 22, 5, 0, 7); c.fill(); }
    c.fillStyle = '#fff'; c.font = '800 46px Sora, Inter, sans-serif'; c.fillText(d.title || 'Tempo no Mamacos', 48, 62);
    c.fillStyle = '#a19ab0'; c.font = '500 24px Inter, sans-serif'; c.fillText(d.subtitle || '', 48, 106);
    const rows = (d.rows || []).slice(0, 8);
    if (!rows.length) {
      c.fillStyle = '#cfc9d8'; c.font = '600 30px Inter, sans-serif'; c.textAlign = 'center';
      c.fillText(d.empty || 'Ainda sem dados — o ranking enche conforme o pessoal usa o app.', W / 2, H / 2 + 20);
    }
    const max = Math.max(1, ...rows.map((r) => r.seconds));
    const medal = ['#f5c518', '#cbd5e1', '#d97706'];
    rows.forEach((r, i) => {
      const y = 160 + i * 52;
      if (r.me) { c.fillStyle = 'rgba(244,81,30,.16)'; c.fillRect(32, y - 24, W - 64, 48); }
      c.fillStyle = medal[i] || '#3a3542';
      c.beginPath(); c.arc(70, y, 18, 0, 7); c.fill();
      c.fillStyle = i < 3 ? '#1b1620' : '#fff'; c.font = '800 20px Inter, sans-serif'; c.textAlign = 'center'; c.fillText(String(i + 1), 70, y + 1);
      c.textAlign = 'left'; c.fillStyle = '#fff'; c.font = `${r.me ? 800 : 600} 26px Inter, sans-serif`;
      c.fillText(String(r.name).slice(0, 20) + (r.me ? ' (você)' : ''), 104, y);
      const bx = 470, bw = 360;
      c.fillStyle = 'rgba(255,255,255,.08)'; c.fillRect(bx, y - 9, bw, 18);
      c.fillStyle = r.me ? '#f4511e' : '#8b5cf6'; c.fillRect(bx, y - 9, Math.max(6, (bw * r.seconds) / max), 18);
      c.fillStyle = '#e9e4f0'; c.font = '700 24px Inter, sans-serif'; c.textAlign = 'right'; c.fillText(fmtTime(r.seconds), W - 48, y);
    });
    boardTex.needsUpdate = true;
    BOARD.mesh.material = boardMat;
  }

  // ---------- Salas / calls ----------
  let playerRoom = null;
  let ignoreRoom = null; // sala que você acabou de sair por fora (não reentra sozinho)
  function updateZones() {
    for (const a of agents.values()) {
      const z = zoneAt(a.pos.x, a.pos.z);
      a.zone = z;
      a.room = z && z.kind === 'room' ? z.id : null;
      a.m.talking = a.isPlayer ? a.talkT > 0 || speakingIds.has(a.id) : speakingIds.has(a.id) || a.talkT > 0;
      a.zzzEl.hidden = a.m.mood !== 'sleep';
    }
    const z = player.zone;
    if (z?.id !== lastZoneId) { lastZoneId = z?.id; opts.onZoneChange?.(z ? { id: z.id, kind: z.kind, name: z.name, sector: z.sector } : null); }
    const r = player.room && ROOMS[player.room]?.voice ? player.room : null;
    if (r !== playerRoom) {
      if (r && r === ignoreRoom) return; // (null === null travava a saída da call)
      ignoreRoom = null;
      playerRoom = r;
      opts.onRoomChange?.(r, r ? { id: r, name: ROOMS[r].name, theme: ROOMS[r].theme.label } : null);
      if (r) stat('room');
    } else if (!r) ignoreRoom = null;
  }
  let lastZoneId;

  // ---------- Portas ----------
  function updateDoors(dt) {
    for (const d of doors) {
      let isNear = false;
      for (const a of agents.values()) {
        const along = d.alongX ? a.pos.x - d.center : a.pos.z - d.center;
        const across = d.alongX ? a.pos.z - d.fixed : a.pos.x - d.fixed;
        if (Math.abs(along) < 1.6 && Math.abs(across) < 1.9) { isNear = true; break; }
      }
      d.open = damp(d.open, isNear ? 1 : 0, 6, dt);
      d.panels.forEach((p, i) => {
        const s = i === 0 ? -1 : 1;
        const off = d.center + s * (d.w / 2 + d.open * d.w * 0.92);
        if (d.alongX) p.position.set(off, 0, d.fixed); else p.position.set(d.fixed, 0, off);
      });
    }
  }

  // ---------- Mapa ----------
  function drawMap(ctx, W, H, detailed) {
    const [X0, X1, Z0, Z1] = BUILDING;
    const pad = detailed ? 18 : 6;
    const sc = Math.min((W - pad * 2) / (X1 - X0), (H - pad * 2) / (Z1 - Z0));
    const ox = (W - (X1 - X0) * sc) / 2, oz = (H - (Z1 - Z0) * sc) / 2;
    const tx = (x) => ox + (x - X0) * sc, tz = (z) => oz + (z - Z0) * sc;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(20,17,26,0.95)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(tx(X0), tz(Z0), (X1 - X0) * sc, (Z1 - Z0) * sc);
    const counts = {};
    for (const a of agents.values()) if (a.zone) counts[a.zone.id] = (counts[a.zone.id] || 0) + 1;
    for (const zn of ZONES) {
      const [x0, x1, z0, z1] = zn.rect;
      const col = zn.kind === 'lobby' ? '#f4511e' : sectorColor(zn.sector);
      ctx.fillStyle = col + (zn.kind === 'room' ? '55' : '22');
      ctx.fillRect(tx(x0), tz(z0), (x1 - x0) * sc, (z1 - z0) * sc);
      if (zn.kind === 'room') { ctx.strokeStyle = col + 'cc'; ctx.lineWidth = detailed ? 1.5 : 1; ctx.strokeRect(tx(x0) + 0.5, tz(z0) + 0.5, (x1 - x0) * sc - 1, (z1 - z0) * sc - 1); }
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const zn of ZONES) {
      const [x0, x1, z0, z1] = zn.rect;
      const cx = tx((x0 + x1) / 2), cz = tz((z0 + z1) / 2), wpx = (x1 - x0) * sc;
      const n = counts[zn.id] || 0;
      if (zn.kind === 'room') {
        let name = zn.name;
        ctx.font = `600 ${detailed ? 18 : 9}px Inter, sans-serif`;
        while (ctx.measureText(name).width > wpx - 6 && name.length > 3) name = name.slice(0, -2) + '…';
        ctx.fillStyle = '#fff';
        ctx.fillText(name, cx, cz - (detailed ? 10 : 0));
        if (detailed) {
          ctx.font = '500 15px Inter, sans-serif';
          ctx.fillStyle = n ? '#34d399' : '#a19ab0';
          const r = ROOMS[zn.id];
          ctx.fillText(`${r.theme.label} · ${n ? n + (r.voice ? ' na call' : ' aqui') : 'vazia'}`, cx, cz + 13);
        }
      } else if (detailed) {
        ctx.font = '700 18px Inter, sans-serif';
        ctx.fillStyle = zn.kind === 'lobby' ? '#f4511e' : sectorColor(zn.sector);
        ctx.fillText(zn.name.toUpperCase(), cx, cz - 10);
        ctx.font = '500 15px Inter, sans-serif';
        ctx.fillStyle = '#cfc9d8';
        ctx.fillText(`${n} ${n === 1 ? 'pessoa' : 'pessoas'}`, cx, cz + 13);
      }
    }
    for (const a of agents.values()) {
      if (a.isPlayer) continue;
      ctx.fillStyle = a.color;
      ctx.beginPath(); ctx.arc(tx(a.pos.x), tz(a.pos.z), detailed ? 5 : 2.2, 0, 7); ctx.fill();
    }
    ctx.save();
    ctx.translate(tx(player.pos.x), tz(player.pos.z));
    ctx.rotate(-player.yaw + Math.PI);
    const k = detailed ? 2.2 : 1;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(0, -6 * k); ctx.lineTo(4.5 * k, 4.5 * k); ctx.lineTo(0, 2 * k); ctx.lineTo(-4.5 * k, 4.5 * k); ctx.closePath(); ctx.fill();
    ctx.restore();
    return { sc, ox, oz };
  }
  let bigXf = null;
  function sizeBig() { const r = big.getBoundingClientRect(); big.width = Math.max(10, Math.round(r.width * 1.5)); big.height = Math.max(10, Math.round(r.height * 1.5)); }
  function toggleBig(force) {
    bigBox.hidden = force !== undefined ? !force : !bigBox.hidden;
    if (!bigBox.hidden) { sizeBig(); bigXf = drawMap(bctx, big.width, big.height, true); }
  }
  mini.addEventListener('click', () => toggleBig(true));
  bigBox.querySelector('button').onclick = () => toggleBig(false);
  big.addEventListener('click', (e) => {
    if (!bigXf) return;
    const r = big.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * big.width, pz = ((e.clientY - r.top) / r.height) * big.height;
    const x = BUILDING[0] + (px - bigXf.ox) / bigXf.sc, z = BUILDING[2] + (pz - bigXf.oz) / bigXf.sc;
    const zn = zoneAt(x, z);
    if (zn && zn.kind === 'room') api.goToRoom(zn.id); else player.goTo(x, z, { run: true });
    toggleBig(false);
  });

  // ---------- Etiquetas ----------
  const tmpV = new THREE.Vector3();
  let whoT = 0;
  function placeLabels(dt) {
    const w = root.clientWidth, h = root.clientHeight;
    const camT = controls.target;
    for (const a of agents.values()) {
      tmpV.copy(a.pos);
      tmpV.y += a.m.lying && a.seat ? (a.seat.bedH ?? 0.5) + 0.9 : 1.9 * a.m.rig.scale.y + (a.seat ? (a.seat.h - 0.44) * a.m.sitK : 0);
      const dist = camera.position.distanceTo(tmpV);
      const isNear = a.isPlayer || tmpV.distanceTo(camT) < 15;
      tmpV.project(camera);
      const vis = isNear && a.m.root.visible && tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1;
      if (a.bubbleT > 0) { a.bubbleT -= dt; if (a.bubbleT <= 0) a.bubbleEl.classList.remove('show'); }
      if (!vis) { if (a.tagVis !== false) { a.tag.style.visibility = 'hidden'; a.tagVis = false; } continue; }
      if (a.tagVis !== true) { a.tag.style.visibility = 'visible'; a.tagVis = true; }
      a.nameEl.querySelector('i').style.background = a.isPlayer ? '#fff' : a.color;
      const sc = clamp(zoom / 62, 0.82, 1.1);
      a.tag.style.transform = `translate(${((tmpV.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-tmpV.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -100%) scale(${sc.toFixed(3)})`;
      a.nameEl.classList.toggle('talking', a.m.talking && !!a.room);
      if (a.camTrack) { const on = a.camTrack.readyState === 'live' && a.camTrack.enabled && !a.camTrack.muted; if (a.camEl.hidden === on) a.camEl.hidden = !on; if (on) a.camEl.classList.toggle('talking', !!a.m.talking); }
    }
    whoT -= dt;
    const refresh = whoT <= 0;
    if (refresh) whoT = 0.4;
    for (const s of signs) {
      tmpV.copy(s.pos);
      const dist = camera.position.distanceTo(tmpV);
      tmpV.project(camera);
      const vis = tmpV.z < 1 && Math.abs(tmpV.x) < 1.05 && Math.abs(tmpV.y) < 1.05 && s.pos.distanceTo(follow) < 40;
      if (s.vis !== vis) { s.el.style.visibility = vis ? 'visible' : 'hidden'; s.vis = vis; }
      if (!vis) continue;
      const sc = clamp(zoom / 70, 0.72, 1);
      s.el.style.transform = `translate(${((tmpV.x * 0.5 + 0.5) * w).toFixed(1)}px, ${((-tmpV.y * 0.5 + 0.5) * h).toFixed(1)}px) translate(-50%, -50%) scale(${sc.toFixed(3)})`;
      if (refresh) {
        const list = membersAt(s);
        fillWho(s.who, list);
        if (s.room) { s.el.classList.toggle('live', list.length > 0 && ROOMS[s.room]?.voice); s.el.classList.toggle('mine', playerRoom === s.room); }
      }
    }
  }

  // ---------- Loop ----------
  function resize() {
    const w = root.clientWidth, h = root.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    const rw = Math.round(w * pr), rh = Math.round(h * pr);
    rt.setSize(rw, rh); rt2.setSize(rw, rh);
    outlineMat.uniforms.res.value.set(rw, rh);
    outlineMat.uniforms.px.value = Math.max(1, pr * 0.9);
    fxaaMat.uniforms.res.value.set(rw, rh);
    const hw = w / zoom / 2, hh = h / zoom / 2;
    Object.assign(camera, { left: -hw, right: hw, top: hh, bottom: -hh });
    camera.updateProjectionMatrix();
    const mw = mini.clientWidth || 240;
    mini.width = mw * 2; mini.height = Math.round(mw * 2 * 0.62);
    if (!bigBox.hidden) sizeBig();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(root);
  // volta de onde parou (opts.startAt); senão começa na recepção
  const st0 = opts.startAt && Number.isFinite(opts.startAt.x) && Number.isFinite(opts.startAt.z) ? opts.startAt : null;
  player.pos.set(st0 ? st0.x : -7, 0, st0 ? st0.z : 0);
  player.yaw = st0 && Number.isFinite(st0.yaw) ? st0.yaw : Math.PI / 2;
  controls.target.set(player.pos.x, 0.6, player.pos.z);
  const follow = new THREE.Vector3(player.pos.x, 0.6, player.pos.z);
  placeCamera(follow);
  // zoom (degraus inteiros pra manter o pixel nítido) e giro de 90°
  function setZoom(next) {
    const z = clamp(next, 28, 150);
    if (Math.abs(z - zoom) < 0.01) return;
    zoom = z; resize();
  }
  function rotateCam(dirn) { camYawGoal += dirn * Math.PI / 2; }
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); setZoom(zoom * (e.deltaY > 0 ? 0.9 : 1.1)); }, { passive: false });
  const camCtl = document.createElement('div');
  camCtl.className = 'camctl';
  camCtl.innerHTML = '<button data-a="l" aria-label="Girar câmera pra esquerda">⟲</button><button data-a="r" aria-label="Girar câmera pra direita">⟳</button><button data-a="o" aria-label="Afastar">−</button><button data-a="i" aria-label="Aproximar">+</button><button data-a="s" aria-label="Som ligado/desligado"></button><button data-a="m" aria-label="Música ambiente" title="Música ambiente">🎵</button>';
  const sndBtn = () => { const b = camCtl.querySelector('[data-a="s"]'); b.textContent = SFX.on ? '🔊' : '🔇'; b.setAttribute('aria-pressed', String(SFX.on)); };
  camCtl.addEventListener('click', (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 's') { SFX.toggle(); sndBtn(); return; }
    if (a === 'm') { MUSIC.toggle(); musBtn(); return; }
    if (a === 'l') rotateCam(-1); else if (a === 'r') rotateCam(1); else if (a === 'o') setZoom(zoom / 1.25); else if (a === 'i') setZoom(zoom * 1.25);
  });
  root.appendChild(camCtl);
  const musBtn = () => { const b = camCtl.querySelector('[data-a="m"]'); b.style.opacity = MUSIC.on ? '1' : '.45'; b.setAttribute('aria-pressed', String(MUSIC.on)); b.title = MUSIC.on ? 'Música ambiente: ligada' : 'Música ambiente: desligada'; };
  sndBtn(); musBtn();
  // dia/noite pelo horário de Brasília (só a luz muda; é um escritório coberto)
  let dayOverride = null, dayT = 0;
  const C_SUN = [new THREE.Color(0x9fb0ff), new THREE.Color(0xffb07a), new THREE.Color(0xfff0dc)];
  const C_SKY = [new THREE.Color(0x8d93c8), new THREE.Color(0xffd9c0), new THREE.Color(0xfff4e8)];
  const C_BG = [new THREE.Color(0x15131f), new THREE.Color(0x2e2333), new THREE.Color(0x2a2735)];
  function brasiliaHour() {
    try {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
      const h = +parts.find((p) => p.type === 'hour').value, m = +parts.find((p) => p.type === 'minute').value;
      return h + m / 60;
    } catch { return new Date().getHours(); }
  }
  function applyDaylight() {
    const h = dayOverride ?? brasiliaHour();
    // 0 = noite, 1 = nascer/pôr do sol, 2 = dia
    const k = h < 5 || h >= 19.5 ? 0 : h < 6.5 ? (h - 5) / 1.5 : h < 8 ? 1 + (h - 6.5) / 1.5 : h < 17 ? 2 : h < 18.25 ? 2 - (h - 17) / 1.25 : 1 - (h - 18.25) / 1.25;
    const lo = Math.min(1, Math.floor(k)), f = k - lo;
    sun.color.copy(C_SUN[lo]).lerp(C_SUN[Math.min(2, lo + 1)], f);
    hemi.color.copy(C_SKY[lo]).lerp(C_SKY[Math.min(2, lo + 1)], f);
    scene.background.copy(C_BG[lo]).lerp(C_BG[Math.min(2, lo + 1)], f);
    sun.intensity = 0.7 + (k / 2) * 1.2;
    hemi.intensity = 0.8 + (k / 2) * 0.35;
    dayPhase = k < 0.5 ? 'noite' : k < 1.6 ? (h < 12 ? 'amanhecer' : 'entardecer') : 'dia';
  }
  let dayPhase = 'dia';
  applyDaylight();
  const clock = new THREE.Clock();
  let musT = 0, walkAcc = 0;
  let miniT = 0, nearT = 0, raf = 0, disposed = false, t = 0, lastFrameKey = '', lastOvKey = '';
  // o navegador só deixa tocar som depois de um clique/tecla
  const unlockSound = () => { if (SFX.on) SFX.unlock(); if (MUSIC.on) MUSIC.resume(); };
  root.addEventListener('pointerdown', unlockSound);
  addEventListener('keydown', unlockSound);

  function frame() {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 1 / 20);
    if (paused) return;
    t += dt;
    dayT -= dt; if (dayT <= 0) { dayT = 60; applyDaylight(); }
    if (energyT > 0) energyT -= dt;
    if (boardEvents.length) { boardT -= dt; if (boardT <= 0) { boardT = 9; boardPage ^= 1; drawBoard(); } }
    musT -= dt; if (musT <= 0) { musT = 1; MUSIC.setMood(MOOD_OF[player.room && ROOMS[player.room]?.theme.id] || 'office'); }
    walkAcc += player.vel ? Math.hypot(player.vel.x, player.vel.z) * dt : 0;
    if (walkAcc >= 25) { walkAcc -= 25; stat('walk', 25); }
    const input = wcSeq ? null : playerInput();
    if (wcSeq || coffeeSeq) tickActions(dt);
    tickWcDoors(dt);
    if (guards.length) tickGuards(dt);
    for (const a of agents.values()) a.m.update(dt, t + (a.isPlayer ? 0 : a.name.length), a.step(dt, a.isPlayer ? input : null));
    // sons do seu boneco, no ritmo dos quadros da animação
    const R = player.m.rpg;
    if (R) {
      const fk = R.state + ':' + R.frame, ok = R.ov + ':' + R.ovFrame;
      if (fk !== lastFrameKey) {
        if ((R.state === 'walk' || R.state === 'run') && R.frame % 4 === 0) SFX.step(R.state === 'run');
        if (R.state === 'type' && Math.random() < 0.7) SFX.type();
        lastFrameKey = fk;
      }
      if (ok !== lastOvKey) { if (R.ov === 'drink' && R.ovFrame % 8 === 5) SFX.sip(); if (R.ov === 'wave' && R.ovFrame === 1) SFX.pop(); lastOvKey = ok; }
    }
    const list = [...agents.values()];
    for (const a of list) {
      if (a.seat) continue;
      for (const b of list) {
        if (a === b) continue;
        const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.62 && d > 1e-4) {
          const push = (0.62 - d) * (b.seat ? 1 : 0.5);
          const nx = a.pos.x + (dx / d) * push, nz = a.pos.z + (dz / d) * push;
          if (!blocked(nx, nz)) { a.pos.x = nx; a.pos.z = nz; }
        }
      }
    }
    updateZones();
    updateDoors(dt);
    if (roomScreens.size) tickScreens(dt);
    nearT -= dt;
    if (nearT <= 0) { nearT = 0.15; scanNear(); renderPrompt(); }
    const goal = tmpV.set(player.pos.x, 0.6 + player.pos.y * 0.4, player.pos.z);
    follow.lerp(goal, 1 - Math.exp(-(reduceMotion ? 20 : 6) * dt));
    controls.target.copy(follow);
    camYaw += (camYawGoal - camYaw) * (1 - Math.exp(-(reduceMotion ? 40 : 10) * dt));
    if (Math.abs(camYawGoal - camYaw) < 0.002) camYaw = camYawGoal;
    placeCamera(follow);
    sun.position.copy(follow).add(SUN_OFF);
    sun.target.position.copy(follow);
    if (marker.material.opacity > 0) {
      marker.material.opacity = player.path.length ? 0.75 + Math.sin(t * 6) * 0.15 : damp(marker.material.opacity, 0, 8, dt);
      marker.scale.setScalar(damp(marker.scale.x, 1, 10, dt));
    }
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    quad.material = outlineMat;
    renderer.setRenderTarget(rt2);
    renderer.render(postScene, postCam);
    quad.material = fxaaMat;
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
    placeLabels(dt);
    miniT -= dt;
    if (miniT <= 0) { miniT = 0.12; drawMap(mctx, mini.width, mini.height, false); if (!bigBox.hidden) bigXf = drawMap(bctx, big.width, big.height, true); }
  }

  const api = {
    setData(d) {
      data = d;
      const sig = JSON.stringify([d.minigamesRoom || null, d.categories.map((c) => [c.id, c.name, (c.voice || []).map((v) => (typeof v === 'string' ? v : [v.id, v.name, v.theme, !!v.private]))])]);
      const first = !built;
      if (sig !== worldSig) { worldSig = sig; rebuildWorld(); syncMembers(true); }
      else syncMembers(first);
    },
    setRoomScreen,
    /** telão da recepção: { title, subtitle, rows: [{ name, seconds, me }] } */
    setBoard(d) { boardData = d; drawBoard(); },
    setSpeaking(ids) { speakingIds = ids instanceof Set ? ids : new Set(ids); },
    bubble(userId, text, secs = 4.5) {
      const a = agents.get(userId);
      if (!a) return;
      a.bubbleEl.textContent = String(text).slice(0, 140);
      a.bubbleEl.classList.add('show');
      a.bubbleT = secs;
      a.talkT = Math.min(2.6, 0.6 + String(text).length * 0.05);
    },
    wave(targetId) {
      const b = targetId && agents.get(targetId);
      if (b && !player.seat) { player.faceTo = Math.atan2(b.pos.x - player.pos.x, b.pos.z - player.pos.z); setTimeout(() => { if (player.faceTo != null && !player.path.length) player.faceTo = null; }, 1500); }
      player.m.wave(); stat('wave');
    },
    /** reação rápida em cima do boneco (emoji) — de você ou de quem mandou */
    emote(userId, emoji) {
      const a = agents.get(userId);
      if (!a) return;
      a.emote(emoji);
      if (a.isPlayer || a.pos.distanceTo(player.pos) < 9) SFX.pop();
      if (a.isPlayer) stat('emote');
    },
    /** câmera da call numa bolinha em cima do boneco (null tira) */
    setAvatarVideo(userId, stream, mirror = false) { agents.get(userId)?.setVideo(stream, mirror); },
    /** linha embaixo do nome (jogo que a pessoa está jogando, som do soundboard…) */
    setStatusLine(userId, text) { agents.get(userId)?.setStatusLine(text); },
    /** { [categoriaId]: canais com mensagem nova } → bolinha vermelha na placa do setor */
    setUnread(map) { unreadBySector = map || {}; paintUnread(); },
    /** eventos no telão da recepção (alterna com o ranking): [{ name, startsAt, where, going }] */
    setEvents(list) { boardEvents = Array.isArray(list) ? list : []; if (!boardEvents.length) boardPage = 0; drawBoard(); },
    /** força uma hora (0–24) pro dia/noite; null volta pro horário de Brasília */
    setDayTime(h) { dayOverride = h == null ? null : +h; applyDaylight(); },
    get dayPhase() { return dayPhase; },
    toast(text) { const el = document.createElement('div'); el.className = 'toast'; el.textContent = text; root.appendChild(el); setTimeout(() => el.remove(), 3700); },
    music: { get on() { return MUSIC.on; }, toggle() { const v = MUSIC.toggle(); musBtn(); return v; }, get mood() { return MUSIC.mood; } },
    goToRoom(id) {
      const r = ROOMS[id];
      if (!r) return;
      ignoreRoom = null;
      const s = seats.find((st) => st.room === id && !st.occupant && st.kind !== 'bed');
      if (s) sitPlayer(s); else player.goTo(...r.center, { run: true });
    },
    leaveRoom() { if (playerRoom && ROOMS[playerRoom]) player.goTo(...ROOMS[playerRoom].door); },
    openMap() { toggleBig(true); },
    setMySkin(skin) { mySkin = skin; applySkin(player.m, skin); },
    getMySkin() { return { ...mySkin }; },
    get playerMamaco() { return player.m; },
    setPaused(p) { paused = !!p; MUSIC.hold(paused); if (p) keys.clear(); clock.getDelta(); },
    /** onde você está agora (pra voltar no mesmo lugar ao reabrir) */
    getPlayerState() { return { x: player.pos.x, z: player.pos.z, yaw: player.yaw }; },
    rooms() { return Object.values(ROOMS).map((r) => ({ id: r.id, name: r.name, voice: r.voice, theme: r.theme.label, sector: r.sector })); },
    audit() { return auditOverlaps(); },
    debug: { post: outlineMat, setZoom, rotateCam, player, agents, camera, controls, follow: () => follow, get seats() { return seats; }, get ROOMS() { return ROOMS; }, get interact() { return INTERACT; }, zoneAt, findPath, use: (it) => use(it) },
    dispose() {
      disposed = true;
      MUSIC.stop();
      for (const id of [...roomScreens.keys()]) setRoomScreen(id, null);
      cancelAnimationFrame(raf);
      ro.disconnect();
      removeEventListener('keydown', onKeyDown);
      removeEventListener('keydown', unlockSound);
      removeEventListener('keyup', onKeyUp);
      removeEventListener('blur', onBlur);
      controls.dispose();
      for (const a of agents.values()) a.destroy();
      scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
      RB_CACHE.clear();
      renderer.dispose();
      root.remove();
    },
  };
  resize();
  frame();
  return api;
}

// =====================================================================
// MINIGAMES — pra dar uma pausa (rodam só no aparelho, sem servidor)
// =====================================================================
const GAMES = {
  banana: { name: 'Chuva de Banana 3D', hint: 'Seu mamaco com a cesta na selva: banana +1, dourada +5, casca −3, coco deixa tonto. Combo a cada 5.' },
  memoria: { name: 'Memória da Selva', hint: 'Ache os pares com o menor número de jogadas.' },
  reflexo: { name: 'Reflexo de Mamaco', hint: 'Clique (ou Espaço) assim que ficar verde. 5 rodadas.' },
  cobra: { name: 'Cobra Faminta', hint: 'Setas ou WASD. Coma bananas, não bata em você mesma.' },
  kart: { name: 'Kart Mamaco 3D', hint: 'Corrida em 3D: 3 voltas contra 3 bots, drift com turbo, itens (banana, coco, turbo). Desafie a galera no chat.' },
};
const MG_CSS = `
.mg{position:absolute;inset:0;z-index:50;background:rgba(8,6,12,.7);display:flex;align-items:center;justify-content:center;padding:16px;font-family:Inter,"Segoe UI",system-ui,sans-serif;color:#ece8f1}
.mg .card{width:min(560px,100%);max-height:100%;overflow:auto;background:#16131c;border:1px solid rgba(255,240,230,.1);border-radius:18px;padding:16px;display:flex;flex-direction:column;gap:12px}
.mg header{display:flex;align-items:center;gap:10px}
.mg header b{font:800 18px Sora,Inter,sans-serif}
.mg header small{color:#9d97a8}
.mg header button{border:0;background:transparent;color:#9d97a8;font-size:24px;cursor:pointer;line-height:1}
.mg header .snd{margin-left:auto;font-size:17px;width:34px;height:34px;border-radius:10px;background:rgba(255,255,255,.06)}
.mg .menu{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.mg .rkbtn{width:100%;border:1px solid rgba(250,204,21,.35);background:linear-gradient(135deg,rgba(250,204,21,.14),rgba(244,81,30,.12));color:#fde68a;border-radius:14px;padding:11px 14px;font:700 14px Inter,sans-serif;cursor:pointer;margin-bottom:10px;text-align:left}
.mg .tabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px}
.mg .tabs button{flex:none;border:1px solid rgba(255,255,255,.1);background:#1f1b27;color:#cfc9d8;border-radius:999px;padding:6px 12px;font:600 12.5px Inter,sans-serif;cursor:pointer}
.mg .tabs button[aria-pressed=true]{background:#f4511e;border-color:#f4511e;color:#fff}
.mg .rank{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.mg .rank li{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;background:#1f1b27;font-variant-numeric:tabular-nums}
.mg .rank li.me{background:rgba(244,81,30,.18);outline:1px solid rgba(244,81,30,.55)}
.mg .rank .pos{width:28px;text-align:center;font:800 15px Sora,Inter,sans-serif;color:#9d97a8}
.mg .rank li:nth-child(1) .pos{color:#facc15}.mg .rank li:nth-child(2) .pos{color:#cbd5e1}.mg .rank li:nth-child(3) .pos{color:#f59e0b}
.mg .rank .av{width:28px;height:28px;border-radius:50%;object-fit:cover;background:#2a2533;flex:none;display:flex;align-items:center;justify-content:center;font:700 12px Inter,sans-serif}
.mg .rank .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.mg .rank .val{font-weight:800}
.mg .note{color:#9d97a8;font-size:12.5px;line-height:1.5;margin:0}
.mg .menu button{text-align:left;border:1px solid rgba(255,255,255,.1);background:#1f1b27;color:#ece8f1;border-radius:14px;padding:14px;cursor:pointer;display:flex;flex-direction:column;gap:4px}
.mg .menu button:hover{border-color:#f4511e}
.mg .menu b{font-size:15px}.mg .menu small{color:#9d97a8;font-size:12px;line-height:1.4}.mg .menu em{font-style:normal;font-size:11.5px;color:#34d399}
.mg canvas{width:100%;aspect-ratio:4/3;background:#0f0d14;border-radius:12px;display:block;touch-action:none}
.mg .bar{display:flex;align-items:center;gap:10px;font-size:13px;color:#cfc9d8}
.mg .bar .sp{flex:1}
.mg .btn{border:0;border-radius:10px;padding:8px 14px;font-weight:700;cursor:pointer;background:linear-gradient(135deg,#ef4444,#f4511e);color:#fff}
.mg .ghost{border:1px solid rgba(255,255,255,.14);background:transparent;color:#ece8f1;border-radius:10px;padding:8px 12px;font-weight:600;cursor:pointer}
.mg .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.mg .grid button{aspect-ratio:1;border:0;border-radius:14px;font-size:32px;cursor:pointer;background:radial-gradient(circle at 30% 25%,#3a2f4a,#221c2c 70%);box-shadow:inset 0 0 0 2px rgba(244,81,30,.35),0 4px 0 #120f17;transition:transform .25s cubic-bezier(.3,1.5,.5,1),background .2s;position:relative}
.mg .grid button:not(.open):not(.done)::after{content:'🐒';position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:22px;opacity:.35}
.mg .grid button:hover:not(.done){transform:translateY(-2px)}
.mg .grid button.open{background:linear-gradient(160deg,#fff8ec,#f1e4cf);transform:rotateY(180deg) scaleX(-1);box-shadow:0 4px 0 #b9a78a}
.mg .grid button.done{background:linear-gradient(160deg,#d1fae5,#a7f3d0);cursor:default;box-shadow:0 4px 0 #34d399;animation:mgok .4s ease}
@keyframes mgok{50%{transform:scale(1.08)}}
.mg .reflex{aspect-ratio:4/3;border-radius:16px;display:flex;align-items:center;justify-content:center;text-align:center;font:800 24px Sora,Inter,sans-serif;cursor:pointer;user-select:none;padding:12px;white-space:pre-line;transition:background .12s;box-shadow:inset 0 -40px 80px rgba(0,0,0,.25),inset 0 0 0 2px rgba(255,255,255,.08)}
@media (max-width:480px){.mg .menu{grid-template-columns:1fr}}
`;
let MG_RESULT = null; // conquistas: avisa o app quando uma partida termina
function best(key, val, lowerIsBetter = false) {
  if (val !== undefined) try { MG_RESULT?.({ game: key, score: val }); } catch { /* ok */ }
  try {
    const k = 'mamacos-mg-' + key;
    const prev = Number(localStorage.getItem(k));
    if (val !== undefined) {
      const better = !prev || (lowerIsBetter ? val < prev : val > prev);
      if (better) localStorage.setItem(k, String(val));
      return better ? val : prev;
    }
    return prev || null;
  } catch { return null; }
}

// ---------- Som dos minigames ----------
// Um AudioContext só (o mesmo do escritório), segue o botão 🔊 (a mesma
// escolha do escritório), fica mudo quando a janela some e cada jogo tem a
// sua "saída" que é desligada quando o jogo fecha — nada fica tocando sozinho.
const MG_AUDIO = (() => {
  const buses = new Set();
  const audible = () => SFX.on && !document.hidden;
  function apply(b) { try { b.out.gain.setTargetAtTime(audible() ? b.vol : 0, b.c.currentTime, 0.04); } catch { /* ok */ } }
  document.addEventListener('visibilitychange', () => { for (const b of buses) apply(b); });
  function bus(vol = 0.22) {
    const c = SFX.ctx();
    if (!c) return { beep() {}, noise() {}, close() {}, c: null, out: null };
    const out = c.createGain(); out.gain.value = audible() ? vol : 0; out.connect(c.destination);
    const b = {
      c, out, vol,
      beep(freq, dur, type = 'square', v = 0.1, slide = null, delay = 0) {
        if (!b.out || !audible()) return;
        const t0 = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, t0); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(v, t0 + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g); g.connect(b.out); o.start(t0); o.stop(t0 + dur + 0.05);
      },
      noise(dur = 0.12, freq = 800, v = 0.15, delay = 0) {
        if (!b.out || !audible()) return;
        const t0 = c.currentTime + delay, n = c.createBufferSource();
        const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
        n.buffer = buf;
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
        const g = c.createGain(); g.gain.value = v;
        n.connect(f); f.connect(g); g.connect(b.out); n.start(t0);
      },
      close() {
        if (!b.out) return;
        const o = b.out; b.out = null; buses.delete(b);
        try { o.gain.cancelScheduledValues(c.currentTime); o.gain.setTargetAtTime(0, c.currentTime, 0.03); } catch { /* ok */ }
        setTimeout(() => { try { o.disconnect(); } catch { /* ok */ } }, 400);
      },
    };
    buses.add(b);
    return b;
  }
  return {
    bus,
    get on() { return SFX.on; },
    toggle() { SFX.toggle(); for (const b of buses) apply(b); for (const el of document.querySelectorAll('[data-mg-snd]')) paint(el); return SFX.on; },
    button() { const el = document.createElement('button'); el.type = 'button'; el.dataset.mgSnd = '1'; el.onclick = (e) => { e.stopPropagation(); MG_AUDIO.toggle(); }; paint(el); return el; },
  };
  function paint(el) { el.textContent = SFX.on ? '🔊' : '🔇'; el.title = SFX.on ? 'Som ligado' : 'Som desligado'; el.setAttribute('aria-label', el.title); }
})();

function fmtRace(ms) { const s = ms / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`; }
function openMinigames(container, game = null, { onClose, onShare, onResult, ranking = null, skin = null, name = 'Você' } = {}) {
  MG_RESULT = onResult || null;
  if (!document.getElementById('mg-css')) { const st = document.createElement('style'); st.id = 'mg-css'; st.textContent = MG_CSS; document.head.appendChild(st); }
  const wrap = document.createElement('div');
  wrap.className = 'mg';
  wrap.innerHTML = '<div class="card" role="dialog" aria-label="Minigames"><header><b>Minigames</b><small>pausa rápida</small><button aria-label="Fechar">×</button></header><div class="body"></div></div>';
  container.appendChild(wrap);
  const body = wrap.querySelector('.body');
  let stopGame = null;
  const close = () => { stopGame?.(); removeEventListener('keydown', onEsc, true); wrap.remove(); onClose?.(); };
  let kartOpen = false;
  const onEsc = (e) => { if (e.key === 'Escape' && !kartOpen) { e.stopPropagation(); close(); } };
  addEventListener('keydown', onEsc, true);
  wrap.querySelector('header button').onclick = close;
  { const sb = MG_AUDIO.button(); sb.className = 'snd'; wrap.querySelector('header button').before(sb); }
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });

  // ---- Ranking dos amigos (vem do app; aqui só desenha) ----
  const RANK_GAMES = [['kart', 'Kart 3D'], ['banana3d', 'Chuva de Banana'], ['cobra', 'Cobra'], ['memoria', 'Memória'], ['reflexo', 'Reflexo']];
  const fmtVal = (g, v) => g === 'kart' ? fmtRace(v) : g === 'banana3d' ? `${v} pts` : g === 'cobra' ? `${v} banana${v === 1 ? '' : 's'}` : g === 'memoria' ? `${v} jogadas` : `${v} ms`;
  function rankingView(gameKey = 'kart') {
    stopGame?.(); stopGame = null;
    wrap.querySelector('header b').textContent = 'Ranking dos amigos';
    body.innerHTML = '<div style="display:flex;flex-direction:column;gap:10px"><div class="tabs" role="tablist"></div><div class="list"></div><div class="bar"><span class="note">Seu melhor resultado entra sozinho quando você bate o recorde.</span><span class="sp"></span><button class="ghost">Jogos</button></div></div>';
    body.querySelector('.bar button').onclick = menu;
    const tabs = body.querySelector('.tabs'), list = body.querySelector('.list');
    let reqId = 0;
    async function show(g) {
      for (const b of tabs.children) b.setAttribute('aria-pressed', String(b.dataset.g === g));
      const my = ++reqId;
      list.innerHTML = '<p class="note">Carregando…</p>';
      let res;
      try { res = await ranking.load(g); } catch { res = { error: true }; }
      if (my !== reqId || !wrap.isConnected) return;
      if (res.error) { list.innerHTML = '<p class="note">Ranking indisponível agora. Tente de novo daqui a pouco.</p>'; return; }
      if (!res.rows.length) { list.innerHTML = '<p class="note">Ninguém do seu círculo jogou ainda. Seja o primeiro e desafie a galera no chat!</p>'; return; }
      const ol = document.createElement('ol'); ol.className = 'rank';
      res.rows.forEach((r, i) => {
        const li = document.createElement('li'); if (r.me) li.className = 'me';
        const pos = document.createElement('span'); pos.className = 'pos'; pos.textContent = i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}º`;
        let av;
        if (r.avatarUrl) { av = document.createElement('img'); av.src = r.avatarUrl; av.alt = ''; av.referrerPolicy = 'no-referrer'; }
        else { av = document.createElement('span'); av.textContent = (r.name || '?').slice(0, 1).toUpperCase(); }
        av.className = 'av';
        const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = r.me ? `${r.name} (você)` : r.name;
        const val = document.createElement('span'); val.className = 'val'; val.textContent = fmtVal(g, r.value);
        li.append(pos, av, nm, val); ol.appendChild(li);
      });
      list.innerHTML = ''; list.appendChild(ol);
    }
    for (const [g, label] of RANK_GAMES) {
      const b = document.createElement('button'); b.dataset.g = g; b.textContent = label; b.setAttribute('role', 'tab');
      b.onclick = () => show(g); tabs.appendChild(b);
    }
    show(gameKey);
  }
  const RANK_KEY = { kart: 'kart', banana: 'banana3d', cobra: 'cobra', memoria: 'memoria', reflexo: 'reflexo' };

  function menu() {
    stopGame?.(); stopGame = null;
    wrap.querySelector('header b').textContent = 'Minigames';
    body.innerHTML = '<div class="menu"></div>';
    if (ranking) {
      const rb = document.createElement('button'); rb.className = 'rkbtn'; rb.textContent = '🏆 Ranking dos amigos — quem manda em cada jogo';
      rb.onclick = () => rankingView('kart');
      body.prepend(rb);
    }
    const m = body.querySelector('.menu');
    for (const [id, g] of Object.entries(GAMES)) {
      const b = document.createElement('button');
      const rec = best(id === 'banana' ? 'banana3d' : id);
      b.innerHTML = '<b></b><small></small><em></em>';
      b.querySelector('b').textContent = g.name;
      b.querySelector('small').textContent = g.hint;
      b.querySelector('em').textContent = rec ? `Seu recorde: ${id === 'reflexo' ? rec + ' ms' : id === 'memoria' ? rec + ' jogadas' : id === 'kart' ? fmtRace(rec) : rec + ' pts'}` : 'Ainda sem recorde';
      b.onclick = () => start(id);
      m.appendChild(b);
    }
  }
  function frameUI(id) {
    wrap.querySelector('header b').textContent = GAMES[id].name;
    body.innerHTML = '';
    const bar = document.createElement('div'); bar.className = 'bar';
    bar.innerHTML = '<span class="info"></span><span class="sp"></span><button class="ghost">Outros jogos</button>';
    bar.querySelector('button').onclick = menu;
    if (ranking) { const rb = document.createElement('button'); rb.className = 'ghost'; rb.textContent = '🏆 Ranking'; rb.onclick = () => rankingView(RANK_KEY[id]); bar.querySelector('button').before(rb); }
    return bar;
  }
  function start(id) {
    stopGame?.(); stopGame = null;
    if (id === 'kart' || id === 'banana') {
      // jogos 3D em tela cheia: esconde o cartão e volta pro menu ao sair
      wrap.style.display = 'none'; kartOpen = true;
      const onExit = () => { kartOpen = false; stopGame = null; if (game === id) close(); else { wrap.style.display = ''; menu(); } };
      const onRanking = ranking ? () => { kartOpen = false; stopGame = null; wrap.style.display = ''; rankingView(RANK_KEY[id]); } : null;
      stopGame = (id === 'kart' ? openKart3D : openBanana3D)(container, { skin, name, onShare, onExit, onResult, onRanking });
      return;
    }
    const bar = frameUI(id);
    const info = bar.querySelector('.info');
    if (id === 'memoria') stopGame = memoria(body, info);
    else if (id === 'reflexo') stopGame = reflexo(body, info);
    else stopGame = cobra(body, info);
    body.appendChild(bar);
  }

  // ---- Cobra Faminta (canvas) ----
  function cobra(host, info) {
    const cv = document.createElement('canvas');
    cv.width = 480; cv.height = 360;
    host.appendChild(cv);
    const g = cv.getContext('2d');
    const snd = MG_AUDIO.bus();
    const CELL = 20, CW = 24, CH = 18;
    const DIRS = { arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0], arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1] };
    let raf = 0, last = performance.now(), state = 'ready', score = 0, snake, dir, queue, food, acc = 0, eatT = 0;
    // fila de curvas: dá pra apertar duas setas rápido sem a segunda sumir
    function turn(m) {
      const ref = queue.length ? queue[queue.length - 1] : dir;
      if (queue.length >= 2 || (m[0] === -ref[0] && m[1] === -ref[1]) || (m[0] === ref[0] && m[1] === ref[1])) return;
      queue.push(m);
    }
    function reset() {
      state = 'ready'; score = 0; acc = 0;
      snake = [[12, 9], [11, 9], [10, 9]]; dir = [1, 0]; queue = []; placeFood();
    }
    function placeFood() { do { food = [Math.floor(Math.random() * CW), Math.floor(Math.random() * CH)]; } while (snake.some(([x, y]) => x === food[0] && y === food[1])); }
    function go(m) {
      if (state === 'over') { reset(); return; }
      if (state === 'ready') { state = 'play'; last = performance.now(); snd.beep(660, 0.08, 'triangle', 0.1); }
      if (m) turn(m);
    }
    const kd = (e) => {
      const k = e.key.toLowerCase();
      if (!(k in DIRS) && k !== ' ' && k !== 'enter') return;
      e.preventDefault(); e.stopPropagation();
      if (state === 'over' && (k === ' ' || k === 'enter')) { reset(); return; }
      go(DIRS[k]);
    };
    addEventListener('keydown', kd, true);
    cv.addEventListener('pointerdown', (e) => {
      const r = cv.getBoundingClientRect();
      const [hx, hy] = snake[0];
      // toque: vira pro lado onde você tocou, em relação à cabeça
      const px = (e.clientX - r.left) / r.width * 480 - (hx * CELL + 10), py = (e.clientY - r.top) / r.height * 360 - (hy * CELL + 10);
      go(Math.abs(px) > Math.abs(py) ? (px > 0 ? [1, 0] : [-1, 0]) : (py > 0 ? [0, 1] : [0, -1]));
    });
    function banana(x, y, s = 1) {
      g.save(); g.translate(x, y); g.scale(s, s);
      g.strokeStyle = '#f5c518'; g.lineWidth = 9; g.lineCap = 'round';
      g.beginPath(); g.arc(0, -10, 16, 0.4, 2.6); g.stroke();
      g.strokeStyle = '#5b4520'; g.lineWidth = 3; g.beginPath(); g.moveTo(14, -2); g.lineTo(18, -6); g.stroke();
      g.restore();
    }
    function tick(now) {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
      if (state === 'play') {
        acc += dt;
        const stepT = Math.max(0.065, 0.14 - score * 0.003);
        while (acc >= stepT && state === 'play') {
          acc -= stepT;
          if (queue.length) dir = queue.shift();
          const head = [snake[0][0] + dir[0], snake[0][1] + dir[1]];
          const eats = head[0] === food[0] && head[1] === food[1];
          // a ponta do rabo sai do lugar neste passo, então encostar nela não é batida
          const body = eats ? snake : snake.slice(0, -1);
          if (head[0] < 0 || head[1] < 0 || head[0] >= CW || head[1] >= CH || body.some(([x, y]) => x === head[0] && y === head[1])) {
            state = 'over'; best('cobra', score);
            snd.beep(300, 0.25, 'sawtooth', 0.09, 90); snd.noise(0.25, 500, 0.12, 0.05);
            break;
          }
          snake.unshift(head);
          if (eats) { score++; eatT = 0.25; placeFood(); snd.beep(700 + Math.min(10, score) * 40, 0.09, 'triangle', 0.11, 1100 + Math.min(10, score) * 40); }
          else snake.pop();
        }
      }
      if (eatT > 0) eatT -= dt;
      for (let x = 0; x < CW; x++) for (let y = 0; y < CH; y++) { g.fillStyle = (x + y) % 2 ? '#1d3a24' : '#21422a'; g.fillRect(x * CELL, y * CELL, CELL, CELL); }
      const bob = Math.sin(now / 180) * 1.5;
      banana(food[0] * CELL + 8, food[1] * CELL + 18 + bob, 0.45);
      snake.forEach(([x, y], i) => { g.fillStyle = i ? `hsl(${150 - i * 2}, 65%, ${52 - Math.min(22, i)}%)` : '#4ade80'; g.beginPath(); g.roundRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2, i ? 6 : 8); g.fill(); });
      { const [hx, hy] = snake[0]; const cx = hx * CELL + 10, cy = hy * CELL + 10, ox = dir[1] * 4, oy = dir[0] * 4; g.fillStyle = '#fff'; g.beginPath(); g.arc(cx + ox + dir[0] * 3, cy + oy + dir[1] * 3, 3, 0, 7); g.arc(cx - ox + dir[0] * 3, cy - oy + dir[1] * 3, 3, 0, 7); g.fill(); g.fillStyle = '#111'; g.beginPath(); g.arc(cx + ox + dir[0] * 4, cy + oy + dir[1] * 4, 1.5, 0, 7); g.arc(cx - ox + dir[0] * 4, cy - oy + dir[1] * 4, 1.5, 0, 7); g.fill();
        if (eatT > 0) { g.fillStyle = '#7f1d1d'; g.beginPath(); g.arc(cx + dir[0] * 7, cy + dir[1] * 7, 3, 0, 7); g.fill(); } }
      g.textAlign = 'center'; g.textBaseline = 'middle';
      if (state !== 'play') {
        g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 0, 480, 360);
        g.fillStyle = '#fff'; g.font = '800 30px Sora, Inter, sans-serif';
        g.fillText(state === 'ready' ? 'Cobra Faminta' : 'Fim de jogo!', 240, 150);
        g.font = '600 16px Inter, sans-serif';
        g.fillText(state === 'ready' ? 'Aperte uma seta (ou toque) pra começar' : `Você comeu ${score} banana${score === 1 ? '' : 's'} · Espaço ou toque pra jogar de novo`, 240, 190);
      }
      g.textAlign = 'left'; g.textBaseline = 'alphabetic';
      info.textContent = `Bananas: ${score} · Recorde: ${best('cobra') ?? 0}`;
    }
    reset();
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); removeEventListener('keydown', kd, true); snd.close(); };
  }

  // ---- Memória ----
  function memoria(host, info) {
    const icons = ['🍌', '🥥', '🍍', '🍉', '🍇', '🍓', '🥝', '🍒'];
    const snd = MG_AUDIO.bus();
    let cards, open, moves, found, lock, hideT = 0, again = null;
    const grid = document.createElement('div'); grid.className = 'grid';
    host.appendChild(grid);
    function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
    function reset() {
      clearTimeout(hideT); again?.remove(); again = null;
      cards = shuffle([...icons, ...icons]);
      open = []; moves = 0; found = new Set(); lock = false;
      grid.innerHTML = '';
      cards.forEach((ic, i) => {
        const b = document.createElement('button');
        b.setAttribute('aria-label', `Carta ${i + 1}`);
        b.onclick = () => flip(i, b);
        grid.appendChild(b);
      });
      upd();
    }
    function upd() { info.textContent = `Jogadas: ${moves} · Pares: ${found.size / 2}/8 · Recorde: ${best('memoria') ?? '—'}`; }
    function flip(i, b) {
      if (lock || found.has(i) || open.includes(i)) return;
      b.textContent = cards[i]; b.classList.add('open'); b.setAttribute('aria-label', `Carta ${i + 1}: ${cards[i]}`);
      snd.beep(520 + open.length * 140, 0.06, 'triangle', 0.08);
      open.push(i);
      if (open.length === 2) {
        moves++;
        const [a, c] = open;
        if (cards[a] === cards[c]) {
          found.add(a); found.add(c);
          grid.children[a].classList.add('done'); grid.children[c].classList.add('done');
          open = [];
          snd.beep(784, 0.1, 'triangle', 0.1, null, 0.08); snd.beep(1046, 0.16, 'triangle', 0.1, null, 0.18);
          if (found.size === 16) {
            const rec = best('memoria');
            best('memoria', moves, true);
            [523, 659, 784, 1046].forEach((f, k) => snd.beep(f, 0.18, 'triangle', 0.1, null, 0.35 + k * 0.12));
            info.textContent = `Você terminou em ${moves} jogadas!${!rec || moves < rec ? ' Novo recorde!' : ` Recorde: ${rec}`}`;
            again = document.createElement('button'); again.className = 'btn'; again.textContent = 'Jogar de novo'; again.onclick = reset;
            info.after(again);
            return;
          }
        } else {
          lock = true;
          snd.beep(220, 0.14, 'sine', 0.08, 180, 0.15);
          hideT = setTimeout(() => { for (const k of open) { const el = grid.children[k]; if (!el) continue; el.textContent = ''; el.classList.remove('open'); el.setAttribute('aria-label', `Carta ${k + 1}`); } open = []; lock = false; }, 800);
        }
      }
      upd();
    }
    reset();
    return () => { clearTimeout(hideT); again?.remove(); snd.close(); };
  }

  // ---- Reflexo ----
  function reflexo(host, info) {
    const box = document.createElement('div'); box.className = 'reflex'; box.tabIndex = 0; box.setAttribute('role', 'button');
    host.appendChild(box);
    const snd = MG_AUDIO.bus();
    let state = 'idle', t0 = 0, timer = 0, times = [];
    const set = (bg, txt) => { box.style.background = bg; box.textContent = txt; };
    const round = () => Math.min(times.length + 1, 5);
    const upd = () => { info.textContent = state === 'idle' || state === 'done' ? `Recorde: ${best('reflexo') ?? '—'} ms` : `Rodada ${round()}/5 · Recorde: ${best('reflexo') ?? '—'} ms`; };
    function next() {
      clearTimeout(timer);
      state = 'wait'; set('#7f1d1d', `Rodada ${round()}/5\nEspere ficar verde…`);
      timer = setTimeout(() => { state = 'go'; t0 = performance.now(); set('#15803d', 'AGORA!'); snd.beep(988, 0.12, 'square', 0.07); }, 900 + Math.random() * 2200);
      upd();
    }
    function hit() {
      if (state === 'idle' || state === 'done') { times = []; next(); return; }
      if (state === 'pause') return;
      if (state === 'wait') {
        // cedo demais: repete só esta rodada (não perde as anteriores)
        clearTimeout(timer); state = 'pause';
        set('#78350f', 'Cedo demais!\nEssa rodada vai de novo');
        snd.beep(160, 0.22, 'sawtooth', 0.08, 110);
        timer = setTimeout(next, 1100);
        return;
      }
      if (state === 'go') {
        const ms = Math.round(performance.now() - t0);
        times.push(ms);
        snd.beep(ms < 250 ? 1320 : ms < 350 ? 1046 : 784, 0.09, 'triangle', 0.09);
        if (times.length >= 5) {
          const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
          const rec = best('reflexo');
          best('reflexo', avg, true);
          state = 'done';
          set('#1e1b4b', `Média: ${avg} ms${!rec || avg < rec ? ' · novo recorde!' : ` · recorde ${rec} ms`}\n${times.join(' · ')} ms\nClique pra jogar de novo`);
          [659, 784, 1046].forEach((f, k) => snd.beep(f, 0.16, 'triangle', 0.09, null, 0.12 + k * 0.11));
        } else { set('#1f2937', `${ms} ms`); state = 'pause'; timer = setTimeout(next, 800); }
        upd();
      }
    }
    box.addEventListener('pointerdown', (e) => { e.preventDefault(); hit(); });
    const kd = (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); e.stopPropagation(); hit(); } };
    addEventListener('keydown', kd, true);
    set('#1f2937', 'Clique (ou Espaço) pra começar\n5 rodadas');
    upd();
    return () => { clearTimeout(timer); removeEventListener('keydown', kd, true); snd.close(); };
  }

  if (game === 'ranking' && ranking) rankingView('kart');
  else if (game && GAMES[game]) start(game); else menu();
  return { close };
}

// =====================================================================
// KART MAMACO 3D — corrida estilo kart de festa (roda só no aparelho)
// Pista com subidas e curvas, drift com mini-turbo, caixas de item
// (banana, turbo, coco), placas de turbo, 3 bots com personalidade,
// câmera atrás do kart, minimapa, sons e resultado pra desafiar no chat.
// =====================================================================
const KART_CSS = `
.k3d{position:absolute;inset:0;z-index:60;background:#87c6f0;font-family:Inter,"Segoe UI",system-ui,sans-serif;color:#fff;overflow:hidden;user-select:none}
.k3d canvas.view{position:absolute;inset:0;width:100%;height:100%;display:block}
.k3d .hud{position:absolute;inset:0;pointer-events:none}
.k3d .pos{position:absolute;left:max(18px,env(safe-area-inset-left,0px));top:14px;font:900 64px/1 Sora,Inter,sans-serif;text-shadow:0 3px 0 rgba(0,0,0,.35),0 0 18px rgba(0,0,0,.25)}
.k3d .pos small{font-size:26px;opacity:.85}
.k3d .lap{position:absolute;left:max(20px,env(safe-area-inset-left,0px));top:86px;font:800 18px Sora,Inter,sans-serif;text-shadow:0 2px 0 rgba(0,0,0,.35)}
.k3d .time{position:absolute;left:max(20px,env(safe-area-inset-left,0px));top:112px;font:700 15px Inter,sans-serif;text-shadow:0 2px 0 rgba(0,0,0,.35);font-variant-numeric:tabular-nums}
.k3d .item{position:absolute;right:max(18px,env(safe-area-inset-right,0px));top:14px;width:78px;height:78px;border-radius:18px;background:rgba(15,12,20,.55);border:3px solid rgba(255,255,255,.85);display:flex;align-items:center;justify-content:center;font-size:42px;box-shadow:0 4px 0 rgba(0,0,0,.25)}
.k3d .item.roll{animation:kroll .12s steps(2) infinite}
@keyframes kroll{50%{transform:scale(1.08)}}
.k3d .itemhint{position:absolute;right:max(18px,env(safe-area-inset-right,0px));top:98px;width:78px;text-align:center;font:700 11px Inter,sans-serif;text-shadow:0 1px 0 rgba(0,0,0,.4)}
.k3d .mini{position:absolute;left:max(16px,env(safe-area-inset-left,0px));bottom:16px;width:170px;height:170px;border-radius:16px;background:rgba(15,12,20,.45)}
.k3d .speed{position:absolute;right:max(20px,env(safe-area-inset-right,0px));bottom:18px;font:900 34px Sora,Inter,sans-serif;text-shadow:0 3px 0 rgba(0,0,0,.35);font-variant-numeric:tabular-nums}
.k3d .speed small{font-size:14px;opacity:.8}
.k3d .count{position:absolute;left:50%;top:36%;transform:translate(-50%,-50%);font:900 120px/1 Sora,Inter,sans-serif;text-shadow:0 6px 0 rgba(0,0,0,.3)}
.k3d .msg{position:absolute;left:50%;top:22%;transform:translateX(-50%);font:900 30px Sora,Inter,sans-serif;text-shadow:0 3px 0 rgba(0,0,0,.35);white-space:nowrap}
.k3d .keys{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;gap:6px;flex-wrap:wrap;justify-content:center;font-size:12px}
.k3d .keys span{background:rgba(15,12,20,.55);border-radius:8px;padding:4px 8px}
.k3d .keys kbd{font:700 11px Inter,sans-serif;background:#fff;color:#1b1622;border-radius:4px;padding:1px 5px;margin-right:4px}
.k3d .top{position:absolute;right:max(110px,env(safe-area-inset-right,0px));top:18px;display:flex;gap:6px;pointer-events:auto}
.k3d .top button,.k3d .end button{border:0;border-radius:12px;padding:9px 14px;font:700 13px Inter,sans-serif;cursor:pointer;background:rgba(15,12,20,.65);color:#fff}
.k3d .end{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(10,8,16,.55);pointer-events:auto}
.k3d .end .card{background:#16131c;border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:20px;width:min(420px,calc(100% - 32px));display:flex;flex-direction:column;gap:12px}
.k3d .end h2{margin:0;font:900 26px Sora,Inter,sans-serif}
.k3d .end ol{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.k3d .end li{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;background:#201c28;font-variant-numeric:tabular-nums}
.k3d .end li.me{background:rgba(244,81,30,.2);outline:1px solid rgba(244,81,30,.6)}
.k3d .end li b{width:28px;font:900 18px Sora,Inter,sans-serif}
.k3d .end li span{flex:1}
.k3d .end .row{display:flex;gap:8px;flex-wrap:wrap}
.k3d .end .primary{background:linear-gradient(135deg,#ef4444,#f4511e)!important}
.k3d .touch{position:absolute;inset:auto 0 0 0;height:150px;display:none;pointer-events:auto}
.k3d .touch button{position:absolute;bottom:18px;width:72px;height:72px;border-radius:50%;border:2px solid rgba(255,255,255,.6);background:rgba(15,12,20,.45);color:#fff;font:800 22px Inter,sans-serif;touch-action:none}
@media (pointer:coarse){.k3d .touch{display:block}.k3d .keys{display:none}.k3d .mini{bottom:170px;width:120px;height:120px}}
`;

function openKart3D(container, { skin = null, name = 'Você', onShare, onExit, onResult, onRanking } = {}) {
  if (!document.getElementById('k3d-css')) { const st = document.createElement('style'); st.id = 'k3d-css'; st.textContent = KART_CSS; document.head.appendChild(st); }
  const wrap = document.createElement('div');
  wrap.className = 'k3d';
  wrap.innerHTML = `<canvas class="view"></canvas><div class="hud">
    <div class="pos">1º<small>/4</small></div><div class="lap">Volta 1/3</div><div class="time">0:00.00</div>
    <div class="item" aria-label="Item"></div><div class="itemhint">E usa</div>
    <canvas class="mini" width="340" height="340"></canvas><div class="speed">0<small> km/h</small></div>
    <div class="count"></div><div class="msg"></div>
    <div class="keys"><span><kbd>W</kbd>acelera</span><span><kbd>A</kbd><kbd>D</kbd>vira</span><span><kbd>S</kbd>freia</span><span><kbd>Shift</kbd>drift (solta = turbo)</span><span><kbd>E</kbd>item</span><span><kbd>Esc</kbd>sair</span></div>
    <div class="top"><button data-a="restart">Recomeçar</button><button data-a="exit">Sair</button></div>
    <div class="touch"><button data-k="left" style="left:16px">◀</button><button data-k="right" style="left:100px">▶</button><button data-k="drift" style="right:186px">⤳</button><button data-k="item" style="right:102px">★</button><button data-k="gas" style="right:16px">▲</button></div>
  </div>`;
  container.appendChild(wrap);
  const $ = (s) => wrap.querySelector(s);
  const canvas = $('canvas.view');
  const mini = $('canvas.mini'), mctx = mini.getContext('2d');

  // ---------- Render ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8fd0f5);
  scene.fog = new THREE.Fog(0x8fd0f5, 90, 260);
  const camera = new THREE.PerspectiveCamera(68, 1, 0.1, 500);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6f8f55, 1.25));
  const sun = new THREE.DirectionalLight(0xfff2dc, 1.9);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 160 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);
  const grad = toonGrad();
  const T = (c, extra = {}) => new THREE.MeshToonMaterial({ color: c, gradientMap: grad, ...extra });

  // ---------- Pista ----------
  const CTRL = [[0, 0], [60, -6], [110, 20], [118, 70], [80, 98], [40, 78], [10, 110], [-40, 118], [-82, 80], [-70, 30], [-95, -10], [-60, -45]];
  const curve = new THREE.CatmullRomCurve3(CTRL.map(([x, z], i) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  const N = 600;
  const P = [], TG = [], SD = [];
  for (let i = 0; i < N; i++) {
    const u = i / N;
    const p = curve.getPointAt(u);
    p.y = 3.2 * Math.sin(u * Math.PI * 2 * 2) + 1.6 * Math.sin(u * Math.PI * 2 * 5 + 1); // morrinhos
    P.push(p);
  }
  // a pista nunca desce abaixo do chão (antes os vales ficavam embaixo da
  // grama e o kart "afundava na terra")
  { const minY = Math.min(...P.map((p) => p.y)); for (const p of P) p.y += -0.85 - minY; }
  for (let i = 0; i < N; i++) {
    const a = P[(i - 1 + N) % N], b = P[(i + 1) % N];
    const t = b.clone().sub(a); t.y = 0; t.normalize();
    TG.push(t); SD.push(new THREE.Vector3(t.z, 0, -t.x)); // lado esquerdo
  }
  let seg = []; let LEN = 0;
  for (let i = 0; i < N; i++) { const d = P[i].distanceTo(P[(i + 1) % N]); seg.push(LEN); LEN += d; }
  const W = 13; // largura da pista
  function ribbon(off0, off1, mat, yUp = 0.02, vScale = 6) {
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const k = i % N, p = P[k], s = SD[k];
      const a = p.clone().addScaledVector(s, off0), b = p.clone().addScaledVector(s, off1);
      pos.push(a.x, a.y + yUp, a.z, b.x, b.y + yUp, b.z);
      const v = (i === N ? LEN : seg[k]) / vScale;
      uv.push(0, v, 1, v);
      if (i < N) { const j = i * 2; idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  const tex = (w, h, draw, rep) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (rep) t.repeat.set(...rep); return t; };
  const asphalt = tex(256, 256, (g, w, h) => {
    g.fillStyle = '#5b5866'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},255,${0.04 + Math.random() * 0.05})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.fillStyle = 'rgba(255,255,255,.75)'; g.fillRect(w / 2 - 3, 0, 6, h * 0.5);
  });
  ribbon(W / 2, -W / 2, T(0xffffff, { map: asphalt }));
  const curb = tex(64, 64, (g, w, h) => { g.fillStyle = '#e53935'; g.fillRect(0, 0, w, h / 2); g.fillStyle = '#ffffff'; g.fillRect(0, h / 2, w, h / 2); });
  ribbon(W / 2 + 1.1, W / 2, T(0xffffff, { map: curb }), 0.06, 2);
  ribbon(-W / 2, -W / 2 - 1.1, T(0xffffff, { map: curb }), 0.06, 2);
  // grama + morrinhos ao redor
  const grass = new THREE.Mesh(new THREE.CircleGeometry(400, 64), T(0x7cc35a));
  grass.rotation.x = -Math.PI / 2; grass.position.y = -1.2; grass.receiveShadow = true; scene.add(grass);
  // aterro embaixo da pista (morrinhos)
  ribbon(W / 2 + 6, W / 2 + 1.1, T(0x6fb34e), -0.05, 8);
  ribbon(-W / 2 - 1.1, -W / 2 - 6, T(0x6fb34e), -0.05, 8);
  const skirtL = [], skirtGeo = (side) => {
    const pos = [], idx = [];
    for (let i = 0; i <= N; i++) { const k = i % N, p = P[k], s = SD[k]; const a = p.clone().addScaledVector(s, side * (W / 2 + 6)); pos.push(a.x, a.y - 0.05, a.z, a.x + s.x * side * 4, -1.2, a.z + s.z * side * 4); if (i < N) { const j = i * 2; idx.push(j, j + 1, j + 2, j + 1, j + 3, j + 2); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, T(0x66a948, { side: THREE.DoubleSide })); m.receiveShadow = true; scene.add(m); skirtL.push(m);
  };
  skirtGeo(1); skirtGeo(-1);
  // linha de largada + pórtico
  const startTex = tex(128, 32, (g, w, h) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 8, y * 8, 8, 8); } });
  {
    const p = P[0], s = SD[0];
    const line = new THREE.Mesh(new THREE.PlaneGeometry(W, 1.6), new THREE.MeshBasicMaterial({ map: startTex }));
    line.rotation.x = -Math.PI / 2; line.rotation.z = Math.atan2(TG[0].x, TG[0].z); line.position.set(p.x, p.y + 0.05, p.z); scene.add(line);
    const arch = new THREE.Group();
    for (const k of [-1, 1]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 7, 12), T(0xf4511e)); c.position.set(k * (W / 2 + 1.6), 3.5, 0); c.castShadow = true; arch.add(c); }
    const banTex = tex(512, 96, (g, w, h) => { g.fillStyle = '#1b1622'; g.fillRect(0, 0, w, h); g.fillStyle = '#f4511e'; g.font = '900 62px Sora, Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('MAMACOS GP', w / 2, h / 2 + 4); });
    const ban = new THREE.Mesh(new THREE.BoxGeometry(W + 4.5, 2, 0.5), [T(0x1b1622), T(0x1b1622), T(0x1b1622), T(0x1b1622), new THREE.MeshBasicMaterial({ map: banTex }), new THREE.MeshBasicMaterial({ map: banTex })]);
    ban.position.y = 7; ban.castShadow = true; arch.add(ban);
    arch.position.copy(p); arch.rotation.y = Math.atan2(TG[0].x, TG[0].z);
    scene.add(arch);
  }
  // árvores, cones e torcida (enfeite)
  const treeTop = T(0x3f9b46), trunk = T(0x7a5232), coneM = T(0xff7a1a);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 140; i++) {
    const k = Math.floor(rnd() * N), side = rnd() < 0.5 ? -1 : 1, off = W / 2 + 9 + rnd() * 40;
    const p = P[k].clone().addScaledVector(SD[k], side * off);
    // não pode cair em outro trecho da pista
    let ok = true; for (let j = 0; j < N; j += 6) if (P[j].distanceTo(p) < W / 2 + 7) { ok = false; break; }
    if (!ok) continue;
    const g = new THREE.Group();
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 2.4, 8), trunk); tr.position.y = 1.2;
    const s = 1.6 + rnd() * 1.4;
    const tp = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), treeTop); tp.position.y = 2.4 + s * 0.7;
    tr.castShadow = tp.castShadow = true; g.add(tr, tp);
    g.position.set(p.x, -1.2, p.z); scene.add(g);
  }
  for (let i = 0; i < N; i += 25) for (const side of [-1, 1]) {
    const p = P[i].clone().addScaledVector(SD[i], side * (W / 2 + 2));
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 10), coneM); c.position.set(p.x, P[i].y + 0.45, p.z); c.castShadow = true; scene.add(c);
  }
  // placas de turbo
  const boostTex = tex(64, 128, (g, w, h) => { g.fillStyle = '#ff9f1a'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff3c4'; for (let y = 0; y < 3; y++) { g.beginPath(); g.moveTo(8, 34 + y * 36); g.lineTo(w / 2, 10 + y * 36); g.lineTo(w - 8, 34 + y * 36); g.lineTo(w - 8, 46 + y * 36); g.lineTo(w / 2, 22 + y * 36); g.lineTo(8, 46 + y * 36); g.fill(); } });
  const PADS = [120, 330, 470].map((k) => {
    const p = P[k], m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 5), new THREE.MeshBasicMaterial({ map: boostTex, transparent: true }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.atan2(TG[k].x, TG[k].z) + Math.PI; m.position.set(p.x, p.y + 0.07, p.z); scene.add(m);
    return { k, lat: 0 };
  });
  // caixas de item (giram; somem ao pegar e voltam)
  const boxTex = tex(128, 128, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#ff5fd2'); gr.addColorStop(0.5, '#ffd54f'); gr.addColorStop(1, '#4fc3f7'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,.9)'; g.font = '900 84px Sora, Inter, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', w / 2, h / 2 + 6); });
  const boxMat = new THREE.MeshToonMaterial({ map: boxTex, gradientMap: grad, transparent: true, opacity: 0.9 });
  const BOXES = [];
  for (const k of [60, 250, 410, 540]) for (const lat of [-4.5, -1.5, 1.5, 4.5]) {
    const m = new THREE.Mesh(new RoundedBoxGeometry(1.3, 1.3, 1.3, 2, 0.18), boxMat);
    const p = P[k].clone().addScaledVector(SD[k], lat);
    m.position.set(p.x, p.y + 1.1, p.z); m.castShadow = true; scene.add(m);
    BOXES.push({ m, gone: 0 });
  }

  // ---------- Karts ----------
  const KART_COLORS = [0xf4511e, 0x3b82f6, 0x22c55e, 0xeab308];
  const BOT_NAMES = ['Bot Banana', 'Bot Cipó', 'Bot Coco'];
  const BOT_SKINS = ['heroi', 'dinossauro', 'astronauta', 'ninja', 'tigre', 'pirata', 'coelho', 'robo'];
  const pickBots = BOT_SKINS.sort(() => Math.random() - 0.5).slice(0, 3);
  function makeKart(color, driverSkin) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new RoundedBoxGeometry(1.7, 0.5, 2.5, 3, 0.18), T(color)); body.position.y = 0.55; body.castShadow = true;
    const nose = new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.35, 0.9, 3, 0.14), T(color)); nose.position.set(0, 0.62, 1.35); nose.castShadow = true;
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.95, 0.75, 0.45, 2, 0.12), T(0x1b1622)); seat.position.set(0, 0.95, -0.55);
    const bumper = new THREE.Mesh(new RoundedBoxGeometry(1.9, 0.25, 0.3, 2, 0.1), T(0x222226)); bumper.position.set(0, 0.4, -1.25);
    const wing = new THREE.Mesh(new RoundedBoxGeometry(1.8, 0.08, 0.5, 2, 0.04), T(color)); wing.position.set(0, 1.35, -1.15);
    for (const k of [-0.6, 0.6]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), T(0x222226)); st.position.set(k, 1.1, -1.1); g.add(st); }
    const wheelM = T(0x1a1a1e), hubM = T(0xd8d8de);
    const wheels = [];
    for (const [x, z, r] of [[-0.95, 0.85, 0.36], [0.95, 0.85, 0.36], [-0.95, -0.85, 0.42], [0.95, -0.85, 0.42]]) {
      const piv = new THREE.Group(); piv.position.set(x, r, z);
      const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.42, 18), wheelM); w.rotation.z = Math.PI / 2; w.castShadow = true;
      const h = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.45, 0.44, 12), hubM); h.rotation.z = Math.PI / 2;
      piv.add(w, h); g.add(piv); wheels.push({ piv, w, front: z > 0 });
    }
    const steer = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 8, 20), T(0x1b1622)); steer.position.set(0, 1.15, 0.25); steer.rotation.x = -0.9;
    g.add(body, nose, seat, bumper, wing, steer);
    // piloto: o mamaco sentado, mãos no volante
    const m = makeMamaco('', driverSkin);
    m.sitting = true; m.typing = true; m.seatH = 0;
    m.root.scale.setScalar(0.82); m.root.position.set(0, 0.62, -0.35);
    g.add(m.root);
    // faíscas do drift
    const sparkM = new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.9 });
    const sparks = [];
    for (const x of [-0.95, 0.95]) for (let i = 0; i < 4; i++) { const s = new THREE.Mesh(new THREE.TetrahedronGeometry(0.12), sparkM); s.position.set(x, 0.15, -1.1); s.visible = false; g.add(s); sparks.push(s); }
    // chama do turbo
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.1, 10), new THREE.MeshBasicMaterial({ color: 0xffb02e, transparent: true, opacity: 0.85 }));
    flame.rotation.x = -Math.PI / 2; flame.position.set(0, 0.55, -1.75); flame.visible = false; g.add(flame);
    scene.add(g);
    return { g, m, wheels, steer, sparks, sparkM, flame };
  }
  const meSkin = skin ? { ...skin } : defaultSkin('voce');
  const karts = [];
  function spawnKarts() {
    for (const k of karts) scene.remove(k.v.g);
    karts.length = 0;
    for (let i = 0; i < 4; i++) {
      const v = makeKart(KART_COLORS[i], i === 0 ? meSkin : { ...defaultSkin('bot' + i), outfit: pickBots[i - 1], hat: null });
      const row = Math.floor(i / 2), col = i % 2;
      const k0 = (N - 8 - row * 7) % N;
      const lat = (col ? -1 : 1) * 2.8;
      karts.push({
        i, me: i === 0, name: i === 0 ? name : BOT_NAMES[i - 1], v,
        pos: P[k0].clone().addScaledVector(SD[k0], lat), yaw: Math.atan2(TG[k0].x, TG[k0].z), velYaw: Math.atan2(TG[k0].x, TG[k0].z),
        speed: 0, k: k0, lap: 0, prog: 0, lastK: k0, done: false, time: 0, item: null, rolling: 0,
        drift: 0, driftCharge: 0, boostT: 0, spinT: 0, hopT: 0, lane: [0, 2.5, -2.5, 0.8][i], skill: [1, 0.97, 0.94, 0.99][i], itemT: 0, bestLap: null, lapStart: 0, steerVis: 0,
      });
    }
  }

  // ---------- Itens ----------
  const ITEM_ICON = { banana: '🍌', turbo: '⚡', coco: '🥥', triplo: '⚡⚡⚡' };
  const hazards = []; // bananas no chão
  const shots = [];   // cocos voando
  const bananaMat = T(0xf7d23c), cocoMat = T(0x6b4428);
  function dropBanana(k) {
    const back = new THREE.Vector3(Math.sin(k.yaw), 0, Math.cos(k.yaw)).multiplyScalar(-2.4);
    const m = new THREE.Group();
    const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.55, 4, 10), bananaMat); b.rotation.z = 1.2; b.castShadow = true;
    const b2 = b.clone(); b2.rotation.set(0.5, 0.8, 1.6); b2.position.set(0.1, 0, 0.12);
    m.add(b, b2);
    m.position.copy(k.pos).add(back); m.position.y += 0.25;
    scene.add(m);
    hazards.push({ m, t: 0 });
  }
  function throwCoco(k) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), cocoMat); m.castShadow = true;
    const f = new THREE.Vector3(Math.sin(k.yaw), 0, Math.cos(k.yaw));
    m.position.copy(k.pos).addScaledVector(f, 2.4); m.position.y += 0.6;
    scene.add(m);
    shots.push({ m, k: k.k, lat: lateral(k), speed: Math.max(42, k.speed + 18), t: 0, owner: k });
  }
  function useItem(k) {
    if (!k.item || k.rolling > 0) return;
    const it = k.item;
    if (it === 'banana') dropBanana(k);
    if (it === 'coco') throwCoco(k);
    if (it === 'turbo') { k.boostT = 1.3; if (k.me) sfx('boost'); }
    if (it === 'triplo') { k.boostT = 1.3; k.item = 'turbo2'; if (k.me) sfx('boost'); return; }
    if (it === 'turbo2') { k.boostT = 1.3; k.item = 'turbo1'; if (k.me) sfx('boost'); return; }
    if (it === 'turbo1') { k.boostT = 1.3; if (k.me) sfx('boost'); }
    k.item = null;
  }
  function giveItem(k) {
    if (k.item || k.rolling > 0) return;
    k.rolling = 1.1;
    const place = order().indexOf(k);
    const pool = place === 0 ? ['banana', 'banana', 'coco', 'turbo'] : place === 3 ? ['triplo', 'turbo', 'coco', 'triplo'] : ['coco', 'turbo', 'banana', 'coco'];
    k.nextItem = pool[Math.floor(Math.random() * pool.length)];
    if (k.me) sfx('box');
  }
  function spin(k) {
    if (k.spinT > 0 || k.done) return;
    k.spinT = 1.1; k.speed *= 0.35; k.drift = 0; k.driftCharge = 0;
    if (k.me) { sfx('spin'); flash('Escorregou!'); }
  }

  // ---------- Pista: posição lateral / mais próximo ----------
  function nearest(pos, hint) {
    let best = hint, bd = Infinity;
    for (let d = -20; d <= 20; d++) {
      const i = (hint + d + N) % N;
      const dd = (P[i].x - pos.x) ** 2 + (P[i].z - pos.z) ** 2;
      if (dd < bd) { bd = dd; best = i; }
    }
    return best;
  }
  function lateral(k) { const p = P[k.k]; return (k.pos.x - p.x) * SD[k.k].x + (k.pos.z - p.z) * SD[k.k].z; }
  function order() {
    return [...karts].sort((a, b) => (a.done && b.done ? a.time - b.time : a.done ? -1 : b.done ? 1 : b.prog - a.prog));
  }

  // ---------- Controles ----------
  const keys = new Set();
  const touch = new Set();
  const kd = (e) => {
    const k = e.key.toLowerCase();
    if (k === 'escape') { e.preventDefault(); e.stopPropagation(); exit(); return; }
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', ' ', 'e', 'x', 'control'].includes(k)) {
      e.preventDefault(); e.stopPropagation();
      if (!e.repeat && (k === 'e' || k === 'x' || k === 'control') && state === 'race') useItem(karts[0]);
      keys.add(k);
    }
  };
  const ku = (e) => { keys.delete(e.key.toLowerCase()); };
  // trocou de janela segurando uma tecla: solta tudo (senão o kart seguia acelerando sozinho)
  const onBlur = () => { for (const k of [...keys]) if (k !== '__auto') keys.delete(k); touch.clear(); };
  addEventListener('keydown', kd, true); addEventListener('keyup', ku, true); addEventListener('blur', onBlur);
  wrap.querySelectorAll('.touch button').forEach((b) => {
    const k = b.dataset.k;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); touch.add(k); if (k === 'item' && state === 'race') useItem(karts[0]); });
    const up = () => touch.delete(k);
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
  });
  wrap.querySelector('.top').prepend(MG_AUDIO.button());
  wrap.querySelector('.top').addEventListener('click', (e) => { const a = e.target.closest('button')?.dataset.a; if (a === 'exit') exit(); if (a === 'restart') reset(); });

  // ---------- Som (sintetizado, baixinho; segue o 🔊 e some com a janela) ----------
  const snd = MG_AUDIO.bus(0.2);
  let eng = null;
  function audio() {
    if (eng || !snd.out) return;
    // motor de brinquedo: um "ronronar" grave e macio (seno + vibração leve)
    // + vento suave que aparece com a velocidade. Bem baixinho.
    const c = snd.c;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 58;
    const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 116;
    const g2 = c.createGain(); g2.gain.value = 0.18;
    const trem = c.createGain(); trem.gain.value = 0.75;
    const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 9;
    const lfoG = c.createGain(); lfoG.gain.value = 0.22; lfo.connect(lfoG); lfoG.connect(trem.gain);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380; f.Q.value = 0.3;
    const g = c.createGain(); g.gain.value = 0;
    o.connect(trem); o2.connect(g2); g2.connect(trem); trem.connect(f); f.connect(g); g.connect(snd.out);
    // vento
    const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const ns = c.createBufferSource(); ns.buffer = nb; ns.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 700; nf.Q.value = 0.5;
    const ng = c.createGain(); ng.gain.value = 0;
    ns.connect(nf); nf.connect(ng); ng.connect(snd.out);
    o.start(); o2.start(); lfo.start(); ns.start();
    eng = {
      o, o2, lfo, f, g, ng,
      set(sp, boost, vol) {
        const now = c.currentTime, hz = 52 + sp * 2.2 + (boost ? 18 : 0);
        o.frequency.setTargetAtTime(hz, now, 0.12); o2.frequency.setTargetAtTime(hz * 2, now, 0.12);
        lfo.frequency.setTargetAtTime(7 + sp * 0.5, now, 0.12);
        f.frequency.setTargetAtTime(300 + sp * 12, now, 0.12);
        g.gain.setTargetAtTime(vol, now, 0.15);
        ng.gain.setTargetAtTime(vol ? Math.min(0.05, Math.max(0, sp - 8) * 0.0022) : 0, now, 0.2);
      },
      stop() { try { const t = c.currentTime; g.gain.setTargetAtTime(0, t, 0.05); ng.gain.setTargetAtTime(0, t, 0.05); for (const x of [o, o2, lfo, ns]) x.stop(t + 0.3); } catch { /* ok */ } },
    };
  }
  const beep = (freq, dur, type = 'square', vol = 0.12, slide) => snd.beep(freq, dur, type, vol, slide);
  function sfx(n) {
    if (n === 'count') beep(523, 0.16, 'triangle', 0.12);
    if (n === 'go') { beep(784, 0.3, 'triangle', 0.13); snd.beep(1046, 0.35, 'triangle', 0.1, null, 0.05); }
    if (n === 'box') { beep(660, 0.08, 'triangle', 0.1); snd.beep(990, 0.12, 'triangle', 0.1, null, 0.08); }
    if (n === 'boost') beep(330, 0.45, 'triangle', 0.1, 990);
    if (n === 'spin') beep(700, 0.6, 'triangle', 0.1, 140);
    if (n === 'lap') [523, 659, 784].forEach((f, i) => snd.beep(f, 0.14, 'triangle', 0.09, null, i * 0.11));
    if (n === 'finish') [523, 659, 784, 1046].forEach((f, i) => snd.beep(f, 0.22, 'triangle', 0.1, null, i * 0.14));
    if (n === 'mini') beep(500, 0.25, 'triangle', 0.08, 1200);
    if (n === 'bump') beep(120, 0.12, 'sine', 0.15, 70);
  }

  // ---------- Corrida ----------
  let state = 'count', countT = 3.6, raceT = 0, msgT = 0, finishOrder = [];
  const LAPS = 3;
  function flash(text, secs = 1.4) { $('.msg').textContent = text; msgT = secs; }
  function reset() {
    for (const h of hazards) scene.remove(h.m); hazards.length = 0;
    for (const s of shots) scene.remove(s.m); shots.length = 0;
    for (const b of BOXES) { b.gone = 0; b.m.visible = true; }
    spawnKarts();
    state = 'count'; countT = 3.59; raceT = 0; finishOrder = [];
    $('.end')?.remove();
    camPos.copy(karts[0].pos).add(new THREE.Vector3(-Math.sin(karts[0].yaw) * 9, 5, -Math.cos(karts[0].yaw) * 9));
    audio();
  }

  function driveInput(k) {
    if (k.me && !keys.has('__auto')) {
      const has = (...a) => a.some((x) => keys.has(x));
      return {
        gas: has('w', 'arrowup') || touch.has('gas'),
        brake: has('s', 'arrowdown'),
        steer: (has('a', 'arrowleft') || touch.has('left') ? 1 : 0) - (has('d', 'arrowright') || touch.has('right') ? 1 : 0),
        drift: has('shift', ' ') || touch.has('drift'),
      };
    }
    // bot: mira num ponto à frente na sua "faixa", freia em curva fechada
    const ahead = 12 + Math.floor(k.speed * 0.5);
    const tk = (k.k + ahead) % N;
    const tgt = P[tk].clone().addScaledVector(SD[tk], k.lane + Math.sin(raceT * 0.4 + k.i) * 1.2);
    const want = Math.atan2(tgt.x - k.pos.x, tgt.z - k.pos.z);
    let d = want - k.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
    const t1 = TG[k.k], t2 = TG[(k.k + 30) % N];
    const bend = Math.acos(Math.max(-1, Math.min(1, t1.x * t2.x + t1.z * t2.z)));
    // desvia de banana na frente
    for (const h of hazards) { const dx = h.m.position.x - k.pos.x, dz = h.m.position.z - k.pos.z; if (dx * dx + dz * dz < 140 && dx * Math.sin(k.yaw) + dz * Math.cos(k.yaw) > 0) d += (dx * Math.cos(k.yaw) - dz * Math.sin(k.yaw) > 0 ? -0.6 : 0.6); }
    // usa item às vezes
    if (k.item && (k.itemT -= 1 / 60) < 0) { useItem(k); k.itemT = 1 + Math.random() * 3; }
    return { gas: true, brake: bend > 0.9 && k.speed > 20, steer: Math.max(-1, Math.min(1, d * 2.4)), drift: false };
  }

  const fwd = new THREE.Vector3();
  function physics(k, dt) {
    let inp;
    if (state === 'count') inp = { gas: false, brake: false, steer: 0, drift: false };
    else if (k.done) { const ai = driveInput({ ...k, me: false, item: null }); inp = { gas: k.speed < 9, brake: false, steer: ai.steer, drift: false }; }
    else inp = driveInput(k);
    if (k.rolling > 0) { k.rolling -= dt; if (k.rolling <= 0) k.item = k.nextItem; }
    if (k.spinT > 0) { k.spinT -= dt; inp.gas = false; inp.steer = 0; inp.drift = false; }
    const off = Math.abs(lateral(k)) > W / 2 + 0.4;
    // rubber band leve pros bots
    let band = 1;
    if (!k.me) { const gap = karts[0].prog - k.prog; band = gap > 40 ? 1.1 : gap < -60 ? 0.93 : 1; }
    let max = (k.me ? 27 : 26.5 * k.skill * band) * (off ? 0.45 : 1);
    if (k.boostT > 0) { k.boostT -= dt; max = 36; k.speed = Math.max(k.speed, 31); }
    if (inp.gas) k.speed += (k.speed < max ? 15 : -20) * dt;
    else if (inp.brake) k.speed -= (k.speed > 0 ? 34 : 9) * dt;
    else k.speed -= Math.sign(k.speed) * 7 * dt;
    if (k.speed > max) k.speed += (max - k.speed) * Math.min(1, dt * (off ? 4 : 1.5));
    k.speed = Math.max(-9, k.speed);
    // drift: segura o botão virando → derrapa, carrega faísca (azul → laranja); soltou = mini-turbo
    if (inp.drift && !k.drift && Math.abs(inp.steer) > 0.2 && k.speed > 12 && !off) { k.drift = Math.sign(inp.steer); k.hopT = 0.18; k.driftCharge = 0; }
    if (k.drift && (!inp.drift || k.speed < 8)) {
      if (k.driftCharge > 1.6) { k.boostT = Math.max(k.boostT, 1.0); if (k.me) { sfx('mini'); flash('Super turbo!', 0.8); } }
      else if (k.driftCharge > 0.8) { k.boostT = Math.max(k.boostT, 0.55); if (k.me) sfx('mini'); }
      k.drift = 0; k.driftCharge = 0;
    }
    let yawRate;
    const grip = Math.min(1, Math.abs(k.speed) / 9);
    if (k.drift) { k.driftCharge += dt * (1 + Math.abs(inp.steer + k.drift) * 0.3); yawRate = (k.drift * 1.15 + inp.steer * 0.7) * 1.25 * grip; }
    else yawRate = inp.steer * 1.85 * grip * (k.speed < 0 ? -1 : 1);
    if (k.spinT > 0) k.yaw += 9 * dt;
    else k.yaw += yawRate * dt;
    // velocidade "atrasada" em relação ao bico (derrapagem)
    const g = k.drift ? 2.6 : 9;
    let dy = k.yaw - k.velYaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    k.velYaw += dy * Math.min(1, g * dt);
    fwd.set(Math.sin(k.velYaw), 0, Math.cos(k.velYaw));
    k.pos.addScaledVector(fwd, k.speed * dt);
    // empurrão de batida (vai sumindo)
    if (k.shoveX || k.shoveZ) {
      k.pos.x += k.shoveX * dt; k.pos.z += k.shoveZ * dt;
      const dec = Math.exp(-5 * dt); k.shoveX *= dec; k.shoveZ *= dec;
      if (Math.abs(k.shoveX) + Math.abs(k.shoveZ) < 0.05) k.shoveX = k.shoveZ = 0;
    }
    if (k.wobT > 0) { k.wobT -= dt; }
    k.k = nearest(k.pos, k.k);
    // muro invisível na beira (com pancadinha)
    const lat = lateral(k), lim = W / 2 + 4.5;
    if (Math.abs(lat) > lim) { k.pos.addScaledVector(SD[k.k], (Math.sign(lat) * lim - lat)); k.speed *= 0.7; if (k.me && !k.bumpT) { sfx('bump'); k.bumpT = 0.4; } }
    if (k.bumpT) k.bumpT = Math.max(0, k.bumpT - dt);
    // altura da pista (morrinhos) + inclinação
    k.pos.y = P[k.k].y;
    // placas de turbo
    for (const pd of PADS) { let dk = k.k - pd.k; if (dk > N / 2) dk -= N; if (dk < -N / 2) dk += N; if (Math.abs(dk) < 4 && Math.abs(lat) < 2) { if (k.boostT < 0.6) { k.boostT = 0.8; if (k.me) sfx('boost'); } } }
    // volta: cruzou a largada pra frente
    if (k.lastK > N - 40 && k.k < 40) {
      k.lap++;
      if (k.lap >= 2 && k.me) { const lt = raceT - k.lapStart; if (!k.bestLap || lt < k.bestLap) k.bestLap = lt; }
      k.lapStart = raceT;
      if (k.lap > LAPS && !k.done) { k.done = true; k.time = raceT; finishOrder.push(k); if (k.me) finish(); }
      else if (k.me && k.lap >= 2) { flash(k.lap === LAPS ? 'Última volta!' : `Volta ${k.lap}/${LAPS}`); sfx('lap'); }
    } else if (k.lastK < 40 && k.k > N - 40) k.lap--;
    k.lastK = k.k;
    k.prog = k.lap * N + k.k;
    // caixas de item
    for (const b of BOXES) if (b.gone <= 0 && b.m.position.distanceToSquared(k.pos) < 4.2) { b.gone = 2.5; b.m.visible = false; giveItem(k); }
    // bananas
    for (let i = hazards.length - 1; i >= 0; i--) { const h = hazards[i]; if (h.m.position.distanceToSquared(k.pos) < 2.2 && h.t > 0.25) { spin(k); scene.remove(h.m); hazards.splice(i, 1); } }
    return inp;
  }

  // ---------- Câmera ----------
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  function placeCam(dt) {
    const k = karts[0];
    const f = new THREE.Vector3(Math.sin(k.yaw), 0, Math.cos(k.yaw));
    const want = k.pos.clone().addScaledVector(f, -8.6).add(new THREE.Vector3(0, 3.9, 0));
    camPos.lerp(want, 1 - Math.exp(-6 * dt));
    // nunca abaixo da pista atrás do kart (subida/descida): senão o kart "entra na tela"
    const back = P[(k.k - 14 + N) % N].y;
    camPos.y = Math.max(camPos.y, Math.max(k.pos.y, back) + 2.8);
    if (camPos.distanceTo(k.pos) < 6.5) camPos.sub(k.pos).setLength(6.5).add(k.pos);
    camLook.copy(k.pos).addScaledVector(f, 6).add(new THREE.Vector3(0, 0.9, 0));
    camera.position.copy(camPos); camera.lookAt(camLook);
    const fov = 68 + (k.boostT > 0 ? 10 : 0) + Math.min(6, Math.max(0, k.speed - 20) * 0.6);
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 5); camera.updateProjectionMatrix();
    sun.position.copy(k.pos).add(new THREE.Vector3(-30, 60, 25)); sun.target.position.copy(k.pos);
  }

  // ---------- HUD ----------
  const ord = (n) => `${n}º`;
  function fmt(s) { return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`; }
  function drawMini() {
    const w = mini.width, h = mini.height;
    mctx.clearRect(0, 0, w, h);
    if (!drawMini.box) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of P) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); } drawMini.box = { x0, x1, z0, z1 }; }
    const B = drawMini.box, sc = Math.min((w - 40) / (B.x1 - B.x0), (h - 40) / (B.z1 - B.z0));
    const X = (x) => 20 + (x - B.x0) * sc, Y = (z) => 20 + (z - B.z0) * sc;
    mctx.lineJoin = 'round'; mctx.lineCap = 'round';
    mctx.beginPath(); P.forEach((p, i) => (i ? mctx.lineTo(X(p.x), Y(p.z)) : mctx.moveTo(X(p.x), Y(p.z)))); mctx.closePath();
    mctx.strokeStyle = 'rgba(255,255,255,.9)'; mctx.lineWidth = 12; mctx.stroke();
    mctx.strokeStyle = '#5b5866'; mctx.lineWidth = 7; mctx.stroke();
    for (const k of [...karts].reverse()) {
      mctx.fillStyle = '#' + KART_COLORS[k.i].toString(16).padStart(6, '0');
      mctx.beginPath(); mctx.arc(X(k.pos.x), Y(k.pos.z), k.me ? 9 : 7, 0, 7); mctx.fill();
      if (k.me) { mctx.strokeStyle = '#fff'; mctx.lineWidth = 3; mctx.stroke(); }
    }
  }
  function hud() {
    const me = karts[0];
    const o = order();
    $('.pos').innerHTML = `${ord(o.indexOf(me) + 1)}<small>/4</small>`;
    $('.lap').textContent = `Volta ${Math.min(LAPS, Math.max(1, me.lap))}/${LAPS}`;
    $('.time').textContent = fmt(raceT) + (me.bestLap ? `  ·  melhor ${fmt(me.bestLap)}` : '');
    $('.speed').innerHTML = `${Math.round(Math.abs(me.speed) * 3.6)}<small> km/h</small>`;
    const it = $('.item');
    if (me.rolling > 0) { it.textContent = ['🍌', '⚡', '🥥'][Math.floor(raceT * 14) % 3]; it.classList.add('roll'); }
    else { it.classList.remove('roll'); it.textContent = me.item ? (ITEM_ICON[me.item] || '⚡') : ''; if (me.item === 'turbo2') it.textContent = '⚡⚡'; if (me.item === 'turbo1') it.textContent = '⚡'; }
    drawMini();
  }
  function finish() {
    state = 'done';
    sfx('finish');
    const me = karts[0];
    const place = finishOrder.indexOf(me) + 1;
    try { onResult?.({ game: 'kart3d', place, time: me.time }); } catch { /* ok */ }
    const rec = best('kart');
    const better = !rec || me.time * 1000 < rec;
    best('kart', Math.round(me.time * 1000), true);
    setTimeout(() => showEnd(place, better), 1600);
    flash(place === 1 ? '1º lugar!' : `${place}º lugar`, 1.6);
  }
  function showEnd(place, better) {
    const me = karts[0];
    const end = document.createElement('div'); end.className = 'end';
    // bots que não terminaram: tempo estimado
    const rows = order().map((k) => ({ k, t: k.done ? k.time : raceT + (LAPS * N + N - k.prog) / N * 22 }));
    end.innerHTML = `<div class="card"><h2>${place === 1 ? 'Vitória! 🏆' : place + 'º lugar'}</h2><p style="margin:0;color:#cfc9d8">${fmt(me.time)}${me.bestLap ? ' · melhor volta ' + fmt(me.bestLap) : ''}${better ? ' · <b style="color:#34d399">novo recorde!</b>' : ''}</p><ol></ol><div class="row"><button class="primary" data-a="again">Correr de novo</button>${onShare ? '<button data-a="share">Desafiar no chat</button>' : ''}${onRanking ? '<button data-a="rank">🏆 Ranking</button>' : ''}<button data-a="exit">Sair</button></div></div>`;
    const ol = end.querySelector('ol');
    rows.forEach((r, i) => { const li = document.createElement('li'); if (r.k.me) li.className = 'me'; li.innerHTML = `<b>${i + 1}º</b><span></span><em style="font-style:normal">${fmt(r.t)}</em>`; li.querySelector('span').textContent = r.k.name; ol.appendChild(li); });
    end.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'again') reset();
      if (a === 'exit') exit();
      if (a === 'rank') { dispose(); onRanking?.(); return; }
      if (a === 'share') { onShare?.(`🏁 Kart Mamaco 3D: ${place}º lugar em ${fmt(me.time)}${me.bestLap ? ` (melhor volta ${fmt(me.bestLap)})` : ''}. Bate meu tempo! (Minigames → Kart)`); e.target.textContent = 'Enviado!'; e.target.disabled = true; }
    });
    $('.hud').appendChild(end);
  }

  // ---------- Loop ----------
  function resize() { const w = wrap.clientWidth, h = wrap.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  const ro = new ResizeObserver(resize); ro.observe(wrap); resize();
  let raf = 0, last = performance.now(), hudT = 0, t = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.033, (now - last) / 1000)); last = now; t += dt;
    if (state === 'count') {
      const before = Math.ceil(countT - 0.6);
      countT -= dt;
      const c = Math.ceil(countT - 0.6);
      $('.count').textContent = countT > 0.6 ? String(c) : 'VAI!';
      if (c !== before && c > 0) sfx('count');
      if (countT <= 0.6 && !frame.went) { frame.went = true; sfx('go'); }
      if (countT <= 0) { state = 'race'; frame.went = false; $('.count').textContent = ''; }
    } else if (state === 'race' || state === 'done') raceT += state === 'race' ? dt : 0;
    for (const k of karts) {
      const inp = physics(k, dt);
      // visual do kart
      const v = k.v;
      v.g.position.copy(k.pos);
      const hop = k.hopT > 0 ? Math.sin((k.hopT -= dt) / 0.18 * Math.PI) * 0.35 : 0;
      v.g.position.y += hop;
      const slope = Math.atan2(P[(k.k + 3) % N].y - P[(k.k - 3 + N) % N].y, 6 * (LEN / N));
      v.g.rotation.set(0, 0, 0);
      v.g.rotation.y = k.yaw + (k.drift ? k.drift * 0.35 : 0);
      v.g.rotateX(-slope);
      v.g.rotateZ((k.drift ? -k.drift * 0.08 : 0) - inp.steer * 0.04 * Math.min(1, k.speed / 20));
      k.steerVis += (inp.steer - k.steerVis) * Math.min(1, dt * 10);
      for (const w of v.wheels) { w.w.rotation.x += k.speed * dt / 0.4; if (w.front) w.piv.rotation.y = k.steerVis * 0.45; }
      v.steer.rotation.z = -k.steerVis * 0.9;
      const charged = k.driftCharge > 1.6 ? 0xff8a1a : k.driftCharge > 0.8 ? 0x5ad1ff : null;
      v.sparks.forEach((s, i) => { s.visible = !!(k.drift && charged); if (s.visible) { s.position.set((i < 4 ? -0.95 : 0.95) + (Math.random() - 0.5) * 0.3, 0.15 + Math.random() * 0.3, -1.1 - Math.random() * 0.5); s.rotation.set(Math.random() * 3, Math.random() * 3, 0); } });
      if (charged) v.sparkM.color.setHex(charged);
      v.flame.visible = k.boostT > 0; if (v.flame.visible) v.flame.scale.set(1, 0.8 + Math.random() * 0.5, 1);
      // piloto: inclina na curva, acena ao vencer
      v.m.update(dt, t + k.i, { speed: 0 });
      v.m.neck.rotation.z = -k.steerVis * 0.25;
      if (k.done && !k.waved) { k.waved = true; v.m.wave(); }
    }
    // empurrão entre karts
    // Batida entre karts com física de verdade (massas iguais): separa os
    // dois, troca o "tranco" na direção da batida, quem bate de lado é
    // empurrado pro lado e dá uma rodadinha; de frente/traseira perde ou
    // ganha velocidade. Antes eles só se afastavam como ímãs.
    for (let i = 0; i < karts.length; i++) for (let j = i + 1; j < karts.length; j++) {
      const a = karts[i], b = karts[j];
      if (Math.abs(a.pos.y - b.pos.y) > 1.5) continue;
      const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z, d = Math.hypot(dx, dz), R = 2.0;
      if (d >= R || d < 0.001) continue;
      const nx = dx / d, nz = dz / d, pen = (R - d) / 2;
      a.pos.x += nx * pen; a.pos.z += nz * pen; b.pos.x -= nx * pen; b.pos.z -= nz * pen;
      const fa = [Math.sin(a.velYaw), Math.cos(a.velYaw)], fb = [Math.sin(b.velYaw), Math.cos(b.velYaw)];
      const va = [fa[0] * a.speed + (a.shoveX || 0), fa[1] * a.speed + (a.shoveZ || 0)];
      const vb = [fb[0] * b.speed + (b.shoveX || 0), fb[1] * b.speed + (b.shoveZ || 0)];
      const rel = (va[0] - vb[0]) * nx + (va[1] - vb[1]) * nz;
      if (rel >= 0) continue; // já se afastando
      const J = (-(1 + 0.45) * rel) / 2; // impulso (restituição 0,45)
      for (const [k, sgn, f] of [[a, 1, fa], [b, -1, fb]]) {
        const ix = nx * J * sgn, iz = nz * J * sgn;
        const along = ix * f[0] + iz * f[1];          // parte na direção do kart → velocidade
        k.speed = Math.max(-6, k.speed + along * 0.9);
        k.shoveX = (k.shoveX || 0) + (ix - along * f[0]); // parte de lado → empurrão
        k.shoveZ = (k.shoveZ || 0) + (iz - along * f[1]);
        const side = f[0] * iz - f[1] * ix;            // batida de lado → gira um pouco
        k.yaw += Math.max(-0.35, Math.min(0.35, side * 0.03));
        k.drift = 0; k.driftCharge *= 0.5; k.wobT = 0.35;
      }
      const hard = Math.min(1, J / 10);
      if ((a.me || b.me) && hard > 0.08) { sfx('bump'); if (hard > 0.5) flash('Pancada!', 0.6); }
    }
    // cocos voando pela pista
    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      s.t += dt; s.k = (s.k + Math.round(s.speed * dt / (LEN / N))) % N;
      const p = P[s.k].clone().addScaledVector(SD[s.k], s.lat * 0.9);
      s.m.position.set(p.x, p.y + 0.6 + Math.abs(Math.sin(s.t * 9)) * 0.4, p.z); s.m.rotation.x += dt * 12;
      let hit = false;
      for (const k of karts) if (k !== s.owner && k.pos.distanceToSquared(s.m.position) < 3.2) { spin(k); hit = true; }
      if (hit || s.t > 3) { scene.remove(s.m); shots.splice(i, 1); }
    }
    for (const h of hazards) { h.t += dt; h.m.rotation.y += dt; }
    for (const b of BOXES) { b.m.rotation.y += dt * 1.6; b.m.rotation.x = Math.sin(t * 2) * 0.3; b.m.position.y += Math.sin(t * 3 + b.m.position.x) * 0.004; if (b.gone > 0) { b.gone -= dt; if (b.gone <= 0) { b.gone = 0; b.m.visible = true; } } }
    if (msgT > 0) { msgT -= dt; if (msgT <= 0) $('.msg').textContent = ''; }
    if (eng) {
      const me = karts[0], sp = Math.abs(me.speed);
      // terminou a corrida: motor desliga (antes ficava roncando na tela final)
      eng.set(sp, me.boostT > 0, state === 'done' || me.done ? 0 : state === 'count' ? 0.12 : 0.16 + Math.min(0.1, sp * 0.003));
    }
    placeCam(dt);
    hudT -= dt; if (hudT <= 0) { hudT = 0.08; hud(); }
    renderer.render(scene, camera);
  }
  reset();
  raf = requestAnimationFrame(frame);
  // teste: avança a simulação sem desenhar
  wrap.__dbg = () => ({ karts, hazards, BOXES, P, SD, dropBanana, giveItem, spin });
  wrap.__sim = (secs, hold = []) => {
    const rafSave = window.requestAnimationFrame, renSave = renderer.render;
    window.requestAnimationFrame = () => 0; renderer.render = () => {};
    for (const k of hold) keys.add(k);
    for (let i = 0; i < secs * 30; i++) { last -= 0; frame(last + 33.4); }
    for (const k of hold) keys.delete(k);
    window.requestAnimationFrame = rafSave; renderer.render = renSave; last = performance.now();
    const me = karts[0]; return { me: { k: me.k, x: +me.pos.x.toFixed(1), z: +me.pos.z.toFixed(1), lat: +lateral(me).toFixed(1), spin: +me.spinT.toFixed(2), sp: +me.speed.toFixed(1), drift: me.drift, keys: [...keys] }, shots: shots.map((x) => x.k), state, pos: order().map((k) => k.name), lap: karts.map((k) => k.lap), speed: karts.map((k) => Math.round(k.speed)), item: karts[0].item, time: raceT };
  };

  let closed = false;
  function dispose() {
    if (closed) return; closed = true;
    cancelAnimationFrame(raf); ro.disconnect();
    removeEventListener('keydown', kd, true); removeEventListener('keyup', ku, true);
    eng?.stop(); snd.close();
    removeEventListener('blur', onBlur);
    renderer.dispose();
    scene.traverse((o) => { if (o.isMesh && o.geometry && !o.geometry.userData.zones) o.geometry.dispose(); });
    wrap.remove();
  }
  function exit() { dispose(); onExit?.(); }
  return dispose;
}

// =====================================================================
// CHUVA DE BANANA 3D — o seu mamaco com uma cesta numa clareira da selva.
// Pegue bananas (+1), a dourada vale +5, fuja das cascas (−3) e dos cocos
// (−2 e deixa tonto). Combo a cada 5 seguidas. 45 segundos. Só no aparelho.
// =====================================================================
const BAN_CSS = `
.b3d{position:absolute;inset:0;z-index:60;background:#9fd7f2;font-family:Inter,"Segoe UI",system-ui,sans-serif;color:#fff;overflow:hidden;user-select:none;touch-action:none}
.b3d canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.b3d .hud{position:absolute;inset:0;pointer-events:none}
.b3d .score{position:absolute;left:max(18px,env(safe-area-inset-left,0px));top:14px;font:900 56px/1 Sora,Inter,sans-serif;text-shadow:0 3px 0 rgba(0,0,0,.3)}
.b3d .score small{display:block;font:700 14px Inter,sans-serif;opacity:.9;margin-top:4px}
.b3d .clock{position:absolute;left:50%;top:14px;transform:translateX(-50%);font:900 34px Sora,Inter,sans-serif;text-shadow:0 3px 0 rgba(0,0,0,.3);font-variant-numeric:tabular-nums}
.b3d .clock.low{color:#fecaca}
.b3d .combo{position:absolute;right:max(18px,env(safe-area-inset-right,0px));top:70px;font:900 28px Sora,Inter,sans-serif;color:#fde047;text-shadow:0 3px 0 rgba(0,0,0,.3)}
.b3d .pop{position:absolute;font:900 24px Sora,Inter,sans-serif;text-shadow:0 2px 0 rgba(0,0,0,.35);transform:translate(-50%,-50%);animation:b3dp .9s ease-out forwards;white-space:nowrap}
@keyframes b3dp{0%{opacity:0;transform:translate(-50%,-30%) scale(.6)}15%{opacity:1;transform:translate(-50%,-60%) scale(1.15)}100%{opacity:0;transform:translate(-50%,-180%) scale(1)}}
.b3d .top{position:absolute;right:max(18px,env(safe-area-inset-right,0px));top:16px;display:flex;gap:6px;pointer-events:auto}
.b3d button{border:0;border-radius:12px;padding:9px 14px;font:700 13px Inter,sans-serif;cursor:pointer;background:rgba(15,12,20,.6);color:#fff}
.b3d .keys{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;gap:6px;font-size:12px;flex-wrap:wrap;justify-content:center}
.b3d .keys span{background:rgba(15,12,20,.5);border-radius:8px;padding:4px 8px}
.b3d .keys kbd{font:700 11px Inter,sans-serif;background:#fff;color:#1b1622;border-radius:4px;padding:1px 5px;margin-right:4px}
.b3d .msg{position:absolute;left:50%;top:34%;transform:translate(-50%,-50%);font:900 64px/1 Sora,Inter,sans-serif;text-shadow:0 5px 0 rgba(0,0,0,.28);text-align:center}
.b3d .end{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(10,8,16,.55);pointer-events:auto}
.b3d .end .card{background:#16131c;border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:20px;width:min(400px,calc(100% - 32px));display:flex;flex-direction:column;gap:12px}
.b3d .end h2{margin:0;font:900 26px Sora,Inter,sans-serif}
.b3d .end p{margin:0;color:#cfc9d8;line-height:1.5}
.b3d .end .row{display:flex;gap:8px;flex-wrap:wrap}
.b3d .end .primary{background:linear-gradient(135deg,#ef4444,#f4511e)}
@media (pointer:coarse){.b3d .keys{display:none}}
`;

function openBanana3D(container, { skin = null, name = 'Você', onShare, onExit, onResult, onRanking } = {}) {
  if (!document.getElementById('b3d-css')) { const st = document.createElement('style'); st.id = 'b3d-css'; st.textContent = BAN_CSS; document.head.appendChild(st); }
  const wrap = document.createElement('div');
  wrap.className = 'b3d';
  wrap.innerHTML = `<canvas></canvas><div class="hud">
    <div class="score">0<small>Recorde: —</small></div><div class="clock">45</div><div class="combo"></div><div class="msg"></div>
    <div class="keys"><span><kbd>←</kbd><kbd>→</kbd> ou mouse/dedo: mexe a cesta</span><span>🍌 +1 · dourada +5 · casca −3 · coco −2</span><span><kbd>Esc</kbd>sai</span></div>
    <div class="top"><button data-a="restart">Recomeçar</button><button data-a="exit">Sair</button></div>
  </div>`;
  container.appendChild(wrap);
  const $ = (s) => wrap.querySelector(s);
  const canvas = $('canvas');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fd7f2);
  scene.fog = new THREE.Fog(0x9fd7f2, 28, 70);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  camera.position.set(0, 6.2, 15.5); camera.lookAt(0, 3.4, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x5d7f48, 1.3));
  const sun = new THREE.DirectionalLight(0xfff2dc, 1.8);
  sun.position.set(-6, 14, 9); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -4, near: 1, far: 40 });
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.04;
  scene.add(sun);
  const grad = toonGrad();
  const T = (c, extra = {}) => new THREE.MeshToonMaterial({ color: c, gradientMap: grad, ...extra });

  // ---------- Clareira ----------
  const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48), T(0x7cc35a));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const path = new THREE.Mesh(new THREE.PlaneGeometry(15, 3.2), T(0xc9a46a));
  path.rotation.x = -Math.PI / 2; path.position.set(0, 0.01, 0.2); path.receiveShadow = true; scene.add(path);
  const trunkM = T(0x8a5a33), leafM = T(0x2f9e55), leafM2 = T(0x48b863), rockM = T(0x9aa0a8), flowerM = [T(0xff6b9a), T(0xffd84a), T(0xffffff)];
  function palm(x, z, h = 6, s = 1) {
    const g = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.24 * s - i * 0.015, 0.3 * s - i * 0.015, h / 6, 9), trunkM);
      seg.position.set(Math.sin(i * 0.4) * 0.25, h / 12 + (i * h) / 6, 0); seg.rotation.z = Math.sin(i * 0.4) * 0.06; seg.castShadow = true; g.add(seg);
    }
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.55 * s, 3.2 * s, 4, 1), i % 2 ? leafM : leafM2);
      leaf.scale.z = 0.25; leaf.position.set(0.25, h, 0); leaf.rotation.set(0, (i / 7) * Math.PI * 2, 1.25); leaf.castShadow = true;
      const piv = new THREE.Group(); piv.add(leaf); piv.rotation.y = (i / 7) * Math.PI * 2; leaf.position.set(1.3 * s, h - 0.2, 0); leaf.rotation.set(0, 0, -1.2);
      g.add(piv);
    }
    for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.SphereGeometry(0.22 * s, 10, 8), T(0x6b4a2b)); c.position.set(Math.cos(i * 2.1) * 0.3, h - 0.35, Math.sin(i * 2.1) * 0.3); g.add(c); }
    g.position.set(x, 0, z); scene.add(g);
    return g;
  }
  function bush(x, z, s = 1) {
    const g = new THREE.Group();
    for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8 * s * (0.8 + Math.random() * 0.4), 1), i % 2 ? leafM : leafM2); b.position.set((i - 1.5) * 0.7 * s, 0.5 * s, (Math.random() - 0.5) * 0.6); b.castShadow = true; g.add(b); }
    if (Math.random() < 0.7) for (let i = 0; i < 3; i++) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.13 * s, 8, 6), flowerM[i % 3]); f.position.set((Math.random() - 0.5) * 2 * s, 0.9 * s + Math.random() * 0.4, 0.4 * s); g.add(f); }
    g.position.set(x, 0, z); scene.add(g);
  }
  palm(-9.5, -4, 7.5, 1.1); palm(9.8, -3, 6.8); palm(-13, -10, 8, 1.2); palm(13.5, -11, 8.5, 1.2); palm(-6, -14, 7); palm(5, -16, 8); palm(0.5, -20, 9, 1.2);
  bush(-8, 1.5, 1.1); bush(8.3, 2, 1); bush(-4.5, -6, 0.9); bush(4.8, -7, 1); bush(-11, -1, 1.2); bush(11.5, 0, 1.3); bush(0, -9, 1.1);
  for (let i = 0; i < 6; i++) { const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35 + Math.random() * 0.35), rockM); r.position.set((Math.random() - 0.5) * 18, 0.15, -2 - Math.random() * 10); r.castShadow = true; scene.add(r); }
  // nuvenzinhas
  const cloudM = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, fog: false });
  const clouds = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group();
    for (let j = 0; j < 4; j++) { const p = new THREE.Mesh(new THREE.SphereGeometry(1 + Math.random() * 0.8, 12, 10), cloudM); p.position.set(j * 1.3 - 2, Math.random() * 0.5, 0); p.scale.y = 0.6; g.add(p); }
    g.position.set(-25 + i * 12, 14 + Math.random() * 4, -28 - Math.random() * 8); scene.add(g); clouds.push(g);
  }

  // ---------- O seu mamaco com a cesta ----------
  const LIM = 6.2;
  const m = makeMamaco('', skin || defaultSkin('banana'));
  m.root.scale.setScalar(1.3);
  scene.add(m.root);
  const basket = new THREE.Group();
  const bM = T(0xb9773d), bM2 = T(0x8a5a2b);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.44, 0.42, 20, 1, true), bM); bowl.material.side = THREE.DoubleSide; bowl.castShadow = true;
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.44, 20), bM2); bottom.rotation.x = -Math.PI / 2; bottom.position.y = -0.2;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.06, 8, 28), bM2); rim.rotation.x = Math.PI / 2; rim.position.y = 0.21;
  basket.add(bowl, bottom, rim);
  for (let i = 0; i < 3; i++) { const band = new THREE.Mesh(new THREE.TorusGeometry(0.53 + i * 0.03, 0.025, 6, 28), bM2); band.rotation.x = Math.PI / 2; band.position.y = -0.12 + i * 0.12; basket.add(band); }
  // cesta na frente da barriga (antes ficava atravessando o macaco), segura pela borda
  basket.scale.setScalar(0.8);
  basket.position.set(0, 0.42, 0.9);
  m.root.add(basket);
  // bananas dentro da cesta (aparecem conforme os pontos)
  const pile = [];

  // ---------- Itens ----------
  // banana de verdade: arco comprido, gomos (6 lados), pontas fechadas e
  // afinando (antes era um tubo grosso e curto, aberto nas pontas)
  const bananaGeo = (() => {
    const pts = [];
    for (let i = 0; i <= 12; i++) { const a = -0.85 + (i / 12) * 1.7; pts.push(new THREE.Vector3(Math.sin(a) * 0.5, -Math.cos(a) * 0.5 + 0.5, 0)); }
    const curve = new THREE.CatmullRomCurve3(pts);
    const SEG = 24, RAD = 6, R = 0.1;
    const frames = curve.computeFrenetFrames(SEG, false);
    const pos = [], idx = [];
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG, c = curve.getPointAt(u);
      const k = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, (u - 0.02) / 0.96))), 0.5);
      const r = R * k * (i === 0 || i === SEG ? 0 : 1);
      for (let j = 0; j <= RAD; j++) {
        const t = (j / RAD) * Math.PI * 2;
        const n = frames.normals[i].clone().multiplyScalar(Math.cos(t)).add(frames.binormals[i].clone().multiplyScalar(Math.sin(t) * 0.88));
        pos.push(c.x + n.x * r, c.y + n.y * r, c.z + n.z * r);
      }
    }
    for (let i = 0; i < SEG; i++) for (let j = 0; j < RAD; j++) {
      const a = i * (RAD + 1) + j, b = a + RAD + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.translate(0, -0.22, 0);
    return g;
  })();
  const stemGeo = new THREE.CylinderGeometry(0.035, 0.05, 0.14, 6);
  const MAT = { banana: T(0xffd23f), gold: T(0xffc400, { emissive: 0x7a4b00, emissiveIntensity: 0.6 }), peel: T(0x8a6d1f), coco: T(0x6b4a2b), stem: T(0x4b3a1e) };
  function makeItem(kind) {
    const g = new THREE.Group();
    if (kind === 'coco') {
      const c = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 12), MAT.coco); c.castShadow = true; g.add(c);
      for (let i = 0; i < 3; i++) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), MAT.stem); d.position.set(Math.cos(i * 2.1) * 0.12, 0.3, Math.sin(i * 2.1) * 0.12); g.add(d); }
    } else if (kind === 'peel') {
      for (let i = 0; i < 3; i++) { const p = new THREE.Mesh(bananaGeo, MAT.peel); p.scale.set(0.8, 0.6, 1.4); p.rotation.set(0, (i / 3) * Math.PI * 2, 0.9); p.castShadow = true; g.add(p); }
    } else {
      const b = new THREE.Mesh(bananaGeo, kind === 'gold' ? MAT.gold : MAT.banana); b.castShadow = true; g.add(b);
      const st = new THREE.Mesh(stemGeo, MAT.stem); st.position.set(0.41, -0.01, 0); st.rotation.z = -0.72; g.add(st);
      if (kind === 'gold') { const halo = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.68, 24), new THREE.MeshBasicMaterial({ color: 0xfff3a0, transparent: true, opacity: 0.6, side: THREE.DoubleSide })); g.add(halo); g.userData.halo = halo; }
    }
    scene.add(g);
    return g;
  }
  // confete ao pegar
  const partGeo = new THREE.TetrahedronGeometry(0.09);
  const parts = [];
  function burst(p, color, n = 10) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
    for (let i = 0; i < n; i++) {
      const s = new THREE.Mesh(partGeo, mat); s.position.copy(p);
      s.userData.v = new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 3, (Math.random() - 0.5) * 3);
      s.userData.t = 0.7; scene.add(s); parts.push(s);
    }
  }
  function pop(text, worldPos, color = '#fff') {
    const v = worldPos.clone().project(camera);
    const el = document.createElement('div'); el.className = 'pop'; el.textContent = text; el.style.color = color;
    el.style.left = `${(v.x * 0.5 + 0.5) * 100}%`; el.style.top = `${(-v.y * 0.5 + 0.5) * 100}%`;
    $('.hud').appendChild(el); setTimeout(() => el.remove(), 950);
  }

  // ---------- Som (segue o 🔊 e fica mudo com a janela escondida) ----------
  const snd = MG_AUDIO.bus(0.2);
  const audio = () => {};
  const beep = (f, d, type = 'sine', g = 0.12, slide = null, delay = 0) => snd.beep(f, d, type, g, slide, delay);
  const sfx = {
    catch: (combo) => beep(620 + Math.min(8, combo) * 50, 0.12, 'triangle', 0.12, 900 + Math.min(8, combo) * 60),
    gold: () => { beep(880, 0.12, 'square', 0.07); beep(1320, 0.18, 'square', 0.06, null, 0.1); beep(1760, 0.25, 'triangle', 0.08, null, 0.2); },
    bad: () => beep(220, 0.3, 'sawtooth', 0.1, 110),
    bonk: () => { beep(160, 0.18, 'square', 0.12, 80); beep(520, 0.4, 'sine', 0.05, 300, 0.12); },
    miss: () => beep(300, 0.12, 'sine', 0.05, 240),
    tick: () => beep(1000, 0.05, 'square', 0.04),
    end: () => { beep(523, 0.15, 'triangle', 0.1); beep(659, 0.15, 'triangle', 0.1, null, 0.15); beep(784, 0.3, 'triangle', 0.12, null, 0.3); },
  };

  // ---------- Estado ----------
  const DUR = 45;
  let state = 'count', countT = 2.6, time = DUR, score = 0, combo = 0, caught = 0, items = [], spawnT = 0, px = 0, pv = 0, targetX = null, dizzyT = 0, t = 0;
  const keys = new Set();
  function bestScore(val) {
    try {
      const prev = Number(localStorage.getItem('mamacos-mg-banana3d')) || 0;
      if (val !== undefined && val > prev) { localStorage.setItem('mamacos-mg-banana3d', String(val)); return { best: val, better: true }; }
      return { best: prev, better: false };
    } catch { return { best: 0, better: false }; }
  }
  function reset() {
    for (const it of items) scene.remove(it.g);
    for (const b of pile) basket.remove(b);
    items = []; pile.length = 0;
    state = 'count'; countT = 2.6; time = DUR; score = 0; combo = 0; caught = 0; spawnT = 0.6; px = 0; pv = 0; dizzyT = 0; targetX = null;
    m.root.position.set(0, 0, -0.42);
    const e = $('.end'); if (e) e.remove();
    hud();
  }
  function spawn() {
    const k = time / DUR; // 1 → 0
    const r = Math.random();
    const kind = r < 0.05 ? 'gold' : r < 0.2 + (1 - k) * 0.12 ? 'peel' : r < 0.28 + (1 - k) * 0.16 ? 'coco' : 'banana';
    const g = makeItem(kind);
    const x = (Math.random() * 2 - 1) * LIM;
    g.position.set(x, 10 + Math.random() * 1.5, 0.75);
    items.push({ g, kind, vy: -(3.2 + (1 - k) * 3.4 + Math.random() * 1.2), spin: (Math.random() - 0.5) * 6, wob: Math.random() * 6 });
  }
  function addPile() {
    if (pile.length >= 9) return;
    const b = new THREE.Mesh(bananaGeo, MAT.banana);
    b.scale.setScalar(0.7); b.position.set((Math.random() - 0.5) * 0.6, 0.05 + pile.length * 0.03, (Math.random() - 0.5) * 0.5); b.rotation.set(Math.random(), Math.random() * 6, Math.random());
    basket.add(b); pile.push(b);
  }
  function hud() {
    const b = bestScore().best;
    $('.score').innerHTML = `${score}<small>Recorde: ${b || '—'}</small>`;
    const c = $('.clock'); c.textContent = String(Math.max(0, Math.ceil(time))); c.classList.toggle('low', time <= 10);
    const mult = combo >= 10 ? 3 : combo >= 5 ? 2 : 1;
    $('.combo').textContent = mult > 1 ? `x${mult} combo!` : combo >= 2 ? `${combo} seguidas` : '';
  }
  function finish() {
    state = 'done'; sfx.end();
    const { best, better } = bestScore(score);
    onResult?.({ game: 'banana3d', score });
    m.wave();
    const end = document.createElement('div'); end.className = 'end';
    end.innerHTML = `<div class="card"><h2>${score >= 40 ? 'Mamaco lendário! 🍌' : score >= 20 ? 'Boa colheita! 🍌' : 'Tempo esgotado!'}</h2><p>Você fez <b>${score}</b> pontos e pegou ${caught} bananas.${better ? ' <b style="color:#34d399">Novo recorde!</b>' : ` Recorde: ${best}.`}</p><div class="row"><button class="primary" data-a="again">Jogar de novo</button>${onShare ? '<button data-a="share">Desafiar no chat</button>' : ''}${onRanking ? '<button data-a="rank">🏆 Ranking</button>' : ''}<button data-a="exit">Sair</button></div></div>`;
    wrap.appendChild(end);
    end.addEventListener('click', (e) => {
      const a = e.target.closest('button')?.dataset.a;
      if (a === 'again') reset();
      if (a === 'exit') exit();
      if (a === 'rank') { dispose(); onRanking?.(); return; }
      if (a === 'share') { onShare?.(`🍌 Chuva de Banana 3D: fiz ${score} pontos (${caught} bananas). Bate essa! (Minigames → Chuva de Banana)`); e.target.textContent = 'Enviado!'; e.target.disabled = true; }
    });
  }

  // ---------- Controles ----------
  const kd = (e) => {
    const k = e.key.toLowerCase();
    if (k === 'escape') { e.preventDefault(); e.stopPropagation(); exit(); return; }
    if (['a', 'd', 'arrowleft', 'arrowright', ' '].includes(k)) { e.preventDefault(); e.stopPropagation(); keys.add(k); targetX = null; audio(); }
    if (k === ' ' && state === 'done') reset();
  };
  const ku = (e) => keys.delete(e.key.toLowerCase());
  const onBlur = () => keys.clear();
  addEventListener('keydown', kd, true); addEventListener('keyup', ku, true); addEventListener('blur', onBlur);
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.75), hit = new THREE.Vector3(), ndc = new THREE.Vector2();
  function pointer(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(plane, hit)) targetX = Math.max(-LIM, Math.min(LIM, hit.x));
  }
  canvas.addEventListener('pointermove', pointer);
  canvas.addEventListener('pointerdown', (e) => { audio(); pointer(e); });
  wrap.querySelector('.top').prepend(MG_AUDIO.button());
  wrap.querySelector('.top').addEventListener('click', (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'restart') { audio(); reset(); }
    if (a === 'exit') exit();
  });

  // ---------- Loop ----------
  function resize() { const w = wrap.clientWidth, h = wrap.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w / h < 1 ? 62 : 42; camera.updateProjectionMatrix(); }
  const ro = new ResizeObserver(resize); ro.observe(wrap); resize();
  let raf = 0, last = performance.now(), hudT = 0;
  const tmp = new THREE.Vector3();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.033, (now - last) / 1000)); last = now; t += dt;
    const msg = $('.msg');
    if (state === 'count') {
      const before = Math.ceil(countT - 0.6);
      countT -= dt;
      const c = Math.ceil(countT - 0.6);
      msg.textContent = countT > 0.6 ? String(c) : 'JÁ!';
      if (c !== before && c > 0) sfx.tick();
      if (countT <= 0) { state = 'play'; msg.textContent = ''; }
    }
    // movimento (com um pouquinho de inércia, e tonto depois de levar coco)
    let want = 0;
    if (state !== 'done') {
      if (keys.has('arrowleft') || keys.has('a')) want -= 1;
      if (keys.has('arrowright') || keys.has('d')) want += 1;
      if (!want && targetX != null) want = Math.max(-1, Math.min(1, (targetX - px) * 1.6));
    }
    const maxV = dizzyT > 0 ? 3 : 9.5;
    if (dizzyT > 0) { dizzyT -= dt; want += Math.sin(t * 9) * 0.35; }
    pv += (want * maxV - pv) * Math.min(1, dt * 14);
    px = Math.max(-LIM, Math.min(LIM, px + pv * dt));
    if (Math.abs(px) >= LIM) pv = 0;
    m.root.position.x = px;
    m.root.rotation.y += ((pv > 0.5 ? 0.45 : pv < -0.5 ? -0.45 : 0) - m.root.rotation.y) * Math.min(1, dt * 10);
    basket.rotation.z = -pv * 0.025;
    m.update(dt, t, { speed: Math.abs(pv) * 0.55, air: false, vy: 0, turn: 0, accel: 0 });
    // braços pra frente segurando a borda da cesta
    for (const [a, sd] of [[m.arms[0], 1], [m.arms[1], -1]]) { a.shoulder.rotation.set(-0.95, 0, 0.32 * sd); a.elbow.rotation.set(-0.25, 0, 0); }
    if (dizzyT > 0) { m.emoteExpr = 'susto'; m.emoteT = 0.2; }
    if (state === 'play') {
      time -= dt;
      const lastSec = Math.ceil(time + dt);
      if (time <= 5 && Math.ceil(time) !== lastSec && time > 0) sfx.tick();
      spawnT -= dt;
      if (spawnT <= 0) { spawn(); spawnT = Math.max(0.28, 0.75 - (1 - time / DUR) * 0.45) * (0.7 + Math.random() * 0.6); }
      if (time <= 0) { time = 0; for (const it of items) scene.remove(it.g); items = []; finish(); }
    }
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i], g = it.g;
      g.position.y += it.vy * dt;
      g.rotation.z += it.spin * dt; g.rotation.y += dt * 1.5;
      g.position.x += Math.sin(t * 2 + it.wob) * 0.004;
      if (g.userData.halo) g.userData.halo.lookAt(camera.position);
      const bx = px, by = 0.78;
      if (g.position.y < by + 0.35 && g.position.y > by - 0.3 && Math.abs(g.position.x - bx) < 0.8) {
        tmp.copy(g.position);
        if (it.kind === 'banana' || it.kind === 'gold') {
          combo++; caught++;
          const mult = combo >= 10 ? 3 : combo >= 5 ? 2 : 1;
          const pts = (it.kind === 'gold' ? 5 : 1) * mult;
          score += pts;
          if (it.kind === 'gold') { sfx.gold(); burst(tmp, 0xffe066, 18); pop(`+${pts} ✨`, tmp, '#fde047'); }
          else { sfx.catch(combo); burst(tmp, 0xffd23f, 8); pop(`+${pts}`, tmp); }
          addPile();
          m.emoteExpr = 'feliz'; m.emoteT = 0.5;
        } else if (it.kind === 'peel') {
          score = Math.max(0, score - 3); combo = 0; sfx.bad(); burst(tmp, 0x8a6d1f, 10); pop('−3', tmp, '#fecaca');
          m.emoteExpr = 'serio'; m.emoteT = 0.8;
        } else {
          score = Math.max(0, score - 2); combo = 0; dizzyT = 1.1; sfx.bonk(); burst(tmp, 0x6b4a2b, 10); pop('−2 tonto!', tmp, '#fecaca');
        }
        scene.remove(g); items.splice(i, 1); hud();
        continue;
      }
      if (g.position.y < 0.15) {
        if (it.kind === 'banana' || it.kind === 'gold') { if (combo >= 3) pop('combo perdido', g.position, '#e5e7eb'); combo = 0; sfx.miss(); hud(); }
        burst(g.position, it.kind === 'coco' ? 0x6b4a2b : 0xffd23f, 5);
        scene.remove(g); items.splice(i, 1);
      }
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const s = parts[i], u = s.userData;
      u.t -= dt; u.v.y -= 9 * dt; s.position.addScaledVector(u.v, dt); s.rotation.x += dt * 8;
      s.material.opacity = Math.max(0, u.t / 0.7);
      if (u.t <= 0) { scene.remove(s); parts.splice(i, 1); }
    }
    for (const c of clouds) { c.position.x += dt * 0.4; if (c.position.x > 32) c.position.x = -32; }
    // câmera acompanha de leve
    camera.position.x += (px * 0.35 - camera.position.x) * Math.min(1, dt * 3);
    camera.lookAt(camera.position.x * 0.6, 3.4, 0);
    hudT -= dt; if (hudT <= 0) { hudT = 0.1; if (state === 'play') hud(); }
    renderer.render(scene, camera);
  }
  reset();
  raf = requestAnimationFrame(frame);
  // teste: avança sem desenhar; keys: ['__auto'] pega tudo que é bom
  wrap.__sim = (secs, hold = []) => {
    const rafSave = window.requestAnimationFrame, renSave = renderer.render;
    window.requestAnimationFrame = () => 0; renderer.render = () => {};
    const auto = hold.includes('__auto');
    for (const k of hold) if (k !== '__auto') keys.add(k);
    for (let i = 0; i < secs * 30; i++) {
      if (auto) { const good = items.filter((it) => it.kind === 'banana' || it.kind === 'gold').sort((a, b) => a.g.position.y - b.g.position.y)[0]; targetX = good ? good.g.position.x : 0; }
      frame(last + 33.4);
    }
    for (const k of hold) keys.delete(k);
    window.requestAnimationFrame = rafSave; renderer.render = renSave; last = performance.now();
    return { state, score, caught, combo, time: +time.toFixed(1), items: items.length, px: +px.toFixed(2) };
  };

  let closed = false;
  function dispose() {
    if (closed) return; closed = true;
    cancelAnimationFrame(raf); ro.disconnect();
    removeEventListener('keydown', kd, true); removeEventListener('keyup', ku, true);
    snd.close(); removeEventListener('blur', onBlur);
    renderer.dispose();
    scene.traverse((o) => { if (o.isMesh && o.geometry && !o.geometry.userData.zones) o.geometry.dispose(); });
    wrap.remove();
  }
  function exit() { dispose(); onExit?.(); }
  return dispose;
}

export { createOffice, openMinigames, createSkinPreview, skinThumb, defaultSkin, detectRoomTheme, OUTFITS, HATS, HAT_LABELS, FACEWEAR, registerOutfit, Mamaco, FOFO_SKINS, BACKWEAR, BACK_LABELS, registerFofoSkin };
