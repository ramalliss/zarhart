// Low-poly Cessna 172-style airplane in the three.js local frame (forward = -z, up = +y, right = +x), origin at the CG.
import * as THREE from "three";

function regTexture(reg) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 64;
  const g = c.getContext("2d"); g.clearRect(0, 0, 256, 64); g.fillStyle = "#1b2a44"; g.font = "bold 46px Arial"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(reg, 128, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildAirplane({ reg = "N19ZR", stripe = 0xe64bd0, simple = false } = {}) {
  const g = new THREE.Group();
  const white = new THREE.MeshPhongMaterial({ color: 0xf3f4f6, shininess: 60, specular: 0x444444 });
  const grey = new THREE.MeshLambertMaterial({ color: 0x5b6068 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1d2228 });
  const glass = new THREE.MeshPhongMaterial({ color: 0x223040, shininess: 120, specular: 0x99aabb, transparent: true, opacity: 0.55 });
  const accent = new THREE.MeshLambertMaterial({ color: stripe });
  const navy = new THREE.MeshLambertMaterial({ color: 0x1b2a44 });
  const parts = {};
  const add = (mesh, x, y, z, parent = g) => { mesh.position.set(x, y, z); parent.add(mesh); return mesh; };

  // fuselage: a lathe profile along -z
  const prof = [[0.0, -2.25], [0.42, -2.2], [0.55, -1.7], [0.6, -1.1], [0.66, -0.3], [0.66, 0.6], [0.55, 1.6], [0.36, 3.0], [0.2, 4.6], [0.14, 5.35], [0.0, 5.45]];
  const lat = new THREE.LatheGeometry(prof.map(([r, z]) => new THREE.Vector2(r, z)), 16);
  lat.rotateX(Math.PI / 2); // lathe axis y -> z
  const fus = new THREE.Mesh(lat, white); fus.scale.set(1.12, 1.3, 1); add(fus, 0, -0.05, 0);
  // cabin & windows
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.72, 2.2), white); add(cabin, 0, 0.55, -0.15);
  const ws = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.62, 0.9), glass); ws.rotation.x = -0.65; add(ws, 0, 0.62, -1.3);
  for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 1.7), glass); add(w, sx * 0.6, 0.6, -0.2); }
  // stripe + registration
  for (const sx of [-1, 1]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 5.2), accent); add(s, sx * 0.73, 0.05, 0.9); s.rotation.y = sx * 0.02;
    const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 5.0), navy); add(s2, sx * 0.72, -0.08, 0.9);
    const r = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.38), new THREE.MeshBasicMaterial({ map: regTexture(reg), transparent: true }));
    r.rotation.y = sx * Math.PI / 2; add(r, sx * 0.47, 0.18, 3.4);
  }
  // cowling & spinner
  const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.6, 0.9, 16), white); cowl.rotation.x = Math.PI / 2; add(cowl, 0, -0.08, -1.8);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.36, 14), white); spinner.rotation.x = -Math.PI / 2; add(spinner, 0, -0.08, -2.43);
  // propeller (blades + blur disc)
  const prop = new THREE.Group(); add(prop, 0, -0.08, -2.32);
  for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.95, 0.04), dark); b.position.y = s * 0.5; b.rotation.y = s * 0.25; prop.add(b); }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.98, 32), new THREE.MeshBasicMaterial({ color: 0x9aa3ad, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
  disc.position.z = -0.02; prop.add(disc);
  parts.prop = prop; parts.disc = disc;
  // high wing
  const wingMatFn = (w, x) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.15, 1.5), white); add(m, x, 0.98, -0.18); return m; };
  wingMatFn(5.0, -2.95); wingMatFn(5.0, 2.95); wingMatFn(1.2, 0);
  for (const sx of [-1, 1]) {
    // flaps (inboard) & ailerons (outboard) hinge at the trailing edge
    const flapPivot = new THREE.Group(); add(flapPivot, sx * 1.9, 0.94, 0.57);
    const flap = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 0.42), white); flap.position.set(0, 0, 0.21); flapPivot.add(flap);
    const ailPivot = new THREE.Group(); add(ailPivot, sx * 4.25, 0.94, 0.57);
    const ail = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.07, 0.36), white); ail.position.set(0, 0, 0.18); ailPivot.add(ail);
    parts[sx < 0 ? "flapL" : "flapR"] = flapPivot; parts[sx < 0 ? "ailL" : "ailR"] = ailPivot;
    // strut
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 2.2, 6), grey);
    st.position.set(sx * 1.55, 0.25, -0.15); st.rotation.z = sx * 0.95; g.add(st);
    // wingtip
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 1.3), accent); add(tip, sx * 5.48, 0.98, -0.12);
  }
  // tail
  const hs = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.07, 0.75), white); add(hs, 0, 0.12, 4.75);
  const elevPivot = new THREE.Group(); add(elevPivot, 0, 0.12, 5.12);
  const elev = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.05, 0.5), white); elev.position.z = 0.25; elevPivot.add(elev); parts.elevator = elevPivot;
  const finShape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1.25, 0), new THREE.Vector2(1.1, 1.45), new THREE.Vector2(0.45, 1.5)].map((v) => new THREE.Vector2(v.x, v.y)));
  const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.07, bevelEnabled: false }); finGeo.translate(0, 0, -0.035); finGeo.rotateY(-Math.PI / 2);
  const fin = new THREE.Mesh(finGeo, white); add(fin, 0, 0.18, 3.95);
  const finStripe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.9), accent); add(finStripe, 0, 0.95, 4.65);
  const rudPivot = new THREE.Group(); add(rudPivot, 0, 0.2, 5.2);
  const rud = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.35, 0.4), white); rud.position.set(0, 0.68, 0.2); rudPivot.add(rud); parts.rudder = rudPivot;
  // landing gear
  for (const sx of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.12), grey); leg.position.set(sx * 0.95, -0.62, 0.38); leg.rotation.z = sx * 0.55; g.add(leg);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.17, 14), dark); w.rotation.z = Math.PI / 2; add(w, sx * 1.25, -0.92, 0.38);
    const fair = new THREE.Mesh(new THREE.SphereGeometry(0.33, 10, 8), white); fair.scale.set(0.55, 0.7, 1.4); add(fair, sx * 1.25, -0.88, 0.38);
  }
  const nleg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.75, 6), grey); add(nleg, 0, -0.6, -1.55);
  const nw = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.13, 12), dark); nw.rotation.z = Math.PI / 2; add(nw, 0, -0.97, -1.55);
  // lights
  const lightMat = (c) => new THREE.MeshBasicMaterial({ color: c });
  parts.navL = add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), lightMat(0xff2222)), -5.55, 0.98, -0.6);
  parts.navR = add(new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), lightMat(0x22ff44)), 5.55, 0.98, -0.6);
  parts.beacon = add(new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), lightMat(0xff2200)), 0, 1.72, 4.9);
  parts.strobeL = add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), lightMat(0xffffff)), -5.55, 1.0, -0.2);
  parts.strobeR = add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), lightMat(0xffffff)), 5.55, 1.0, -0.2);
  if (!simple) {
    const spot = new THREE.SpotLight(0xfff2d8, 0, 900, 0.32, 0.45, 1.2); spot.position.set(-0.9, 0.95, -0.95);
    const tgt = new THREE.Object3D(); tgt.position.set(-0.9, -6, -40); g.add(spot, tgt); spot.target = tgt; parts.landingLight = spot;
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  g.userData.parts = parts;
  return g;
}

/** Cockpit frame shown in the cockpit camera: glareshield, window posts, overhead wing roots. */
export function buildCockpit() {
  const g = new THREE.Group();
  const dash = new THREE.MeshLambertMaterial({ color: 0x15191e });
  const frame = new THREE.MeshLambertMaterial({ color: 0xd9dbdf });
  const glare = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.5), dash); glare.position.set(0, 0.2, -1.05); g.add(glare);
  const face = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.75, 0.06), dash); face.position.set(0, -0.18, -1.28); g.add(face);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.95, 0.07), new THREE.MeshLambertMaterial({ color: 0x8b9097 })); post.position.set(sx * 0.66, 0.62, -1.08); post.rotation.x = -0.62; post.rotation.z = sx * 0.06; g.add(post);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.6), frame); door.position.set(sx * 0.66, 0.98, -0.25); g.add(door);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 2.2, 6), new THREE.MeshLambertMaterial({ color: 0x8a9098 })); strut.position.set(sx * 1.55, 0.25, -0.15); strut.rotation.z = sx * 0.95; g.add(strut);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 1.8), frame); roof.position.set(0, 1.12, -0.2); g.add(roof);
  const top = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.9), frame); top.position.set(0, 1.1, -0.95); g.add(top);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(11, 0.14, 1.5), new THREE.MeshLambertMaterial({ color: 0xe8eaee })); wing.position.set(0, 0.98, -0.18); g.add(wing);
  const compass = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.1), dash); compass.position.set(0, 0.98, -0.95); g.add(compass);
  return g;
}

export function animateAirplane(group, ac, t, dt = 1 / 60) {
  const p = group.userData.parts; if (!p) return;
  const c = ac.ctl;
  p.prop.rotation.z += (ac.eng.rpm / 60) * Math.PI * 2 * dt * 0.999;
  const fast = ac.eng.rpm > 500;
  p.disc.visible = fast; p.prop.children.forEach((b) => { if (b !== p.disc) b.visible = !fast || ac.eng.rpm < 900; });
  p.elevator.rotation.x = -(c.elevator * 0.4 + c.trim * 0.15);
  p.rudder.rotation.y = -c.rudder * 0.35;
  p.ailL.rotation.x = c.aileron * 0.35; p.ailR.rotation.x = -c.aileron * 0.35;
  const f = (ac.flaps || 0) * Math.PI / 180;
  p.flapL.rotation.x = f; p.flapR.rotation.x = f;
  const L = ac.elec.lights, pw = ac.powered;
  p.navL.visible = p.navR.visible = pw && L.nav;
  p.beacon.visible = pw && L.beacon && (t % 1.2) < 0.15;
  const st = pw && L.strobe && ((t % 1.1) < 0.06 || ((t - 0.15) % 1.1 < 0.06 && t % 1.1 > 0.15));
  p.strobeL.visible = p.strobeR.visible = st;
  if (p.landingLight) p.landingLight.intensity = pw && L.landing ? 120 : 0;
}
