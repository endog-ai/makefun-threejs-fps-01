// WHITEOUT map: Halcyon Station — an Antarctic research outpost under a
// polar-night aurora sky. ~44 x 36 m. Three lanes: A-long Glacier Path
// (east), mid Crevasse Bridge over a frozen pond, B-tunnel Service Corridor
// (west). Site A is the Observatory Dome, site B the Fuel Depot.
// All geometry is built from primitives, no textures, no external assets.
// Every solid mesh gets a Box3 collider and is a bullet shootable, except
// ground-level visuals that are walked over (pond, bridge deck, site rings)
// and sky effects (aurora ribbons) — those are neither.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const BOUNDS = { minX: -22, maxX: 22, minZ: -18, maxZ: 18 };

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);
  scene.background = new THREE.Color(PALETTE.canvas);
  // Clear polar night: thin fog. whiteout.js drives the density up.
  scene.fog = new THREE.FogExp2(new THREE.Color(PALETTE.canvas), 0.004);

  const colliders = [];
  const shootables = [];
  const solids = [];

  // ---- materials (one cached standard material per palette name) ----
  const materials = {};
  function mat(name) {
    if (!materials[name]) {
      materials[name] = new THREE.MeshStandardMaterial({
        color: new THREE.Color(PALETTE[name]),
        roughness: name === 'ice' ? 0.35 : name === 'snow' ? 0.95 : 0.9,
        metalness: 0.03,
      });
    }
    return materials[name];
  }
  const glassMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.ice),
    transparent: true,
    opacity: 0.32,
    roughness: 0.12,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  const windowMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.accent),
    emissive: new THREE.Color(PALETTE.accent),
    emissiveIntensity: 2.0,
    roughness: 0.55,
  });
  const tipMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.danger),
    emissive: new THREE.Color(PALETTE.danger),
    emissiveIntensity: 1.6,
    roughness: 0.55,
  });
  const auroraMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.aurora),
    transparent: true,
    opacity: 0.26,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const ringMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.site),
    transparent: true,
    opacity: 0.75,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // ---- build helpers ----
  function add(mesh, collide, shoot) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) solids.push(mesh);
    if (shoot) shootables.push(mesh);
    return mesh;
  }
  function box(w, h, d, x, y, z, name, collide, shoot) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(name));
    mesh.position.set(x, y, z);
    return add(mesh, collide !== false, shoot !== false);
  }
  function cyl(rt, rb, h, x, y, z, name, segments, collide, shoot) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(rt, rb, h, segments || 20),
      mat(name),
    );
    mesh.position.set(x, y, z);
    return add(mesh, collide !== false, shoot !== false);
  }

  // ---- snow ground: large white plane, subtle deterministic bumps ----
  // Flat for gameplay (players walk at y = 0); bumps are visual only.
  const groundGeo = new THREE.PlaneGeometry(48, 40, 48, 40);
  groundGeo.rotateX(-Math.PI / 2);
  {
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(
        i,
        0.05 * Math.sin(x * 0.35) * Math.cos(z * 0.3) +
          0.03 * Math.sin(x * 0.9 + 1.7) * Math.sin(z * 0.7 + 0.6),
      );
    }
    groundGeo.computeVertexNormals();
  }
  const ground = new THREE.Mesh(groundGeo, mat('snow'));
  ground.receiveShadow = true;
  ground.castShadow = true;
  group.add(ground);
  shootables.push(ground);

  // ---- outer snow walls with snow caps ----
  box(0.4, 4.6, 36.8, -22.2, 2.3, 0, 'surface');
  box(0.4, 4.6, 36.8, 22.2, 2.3, 0, 'surface');
  box(44.8, 4.6, 0.4, 0, 2.3, -18.2, 'surface');
  box(44.8, 4.6, 0.4, 0, 2.3, 18.2, 'surface');
  box(0.7, 0.25, 37.0, -22.2, 4.7, 0, 'snow');
  box(0.7, 0.25, 37.0, 22.2, 4.7, 0, 'snow');
  box(45.0, 0.25, 0.7, 0, 4.7, -18.2, 'snow');
  box(45.0, 0.25, 0.7, 0, 4.7, 18.2, 'snow');

  // ---- glacier ice cliffs flanking the east and west lanes ----
  box(1.2, 5.5, 12, 20.8, 2.75, 0, 'ice');
  box(1.2, 4.5, 10, -20.8, 2.25, 6, 'ice');

  // ---- habitation modules on the north edge, warm amber windows ----
  function habModule(cx) {
    box(5, 2.6, 2.5, cx, 1.3, -16.6, 'surface');
    box(5.4, 0.2, 2.9, cx, 2.7, -16.6, 'snow');
    // Warm windows on the south face (accent emissive, shootable only —
    // the module wall behind them already carries the collider).
    for (const wx of [cx - 1.5, cx + 1.5]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.08), windowMat);
      win.position.set(wx, 1.5, -15.32);
      win.castShadow = false;
      win.receiveShadow = true;
      group.add(win);
      shootables.push(win);
    }
  }
  habModule(-6);
  habModule(7);

  // ---- site A: Observatory Dome (glass dome on a plinth, warm glow) ----
  // Dome footprint x 13.2..21.8, z -17.8..-9.2; site centre sits clear of it.
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(4, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    glassMat,
  );
  dome.position.set(17.5, 1.0, -13.5);
  add(dome, true, true);
  cyl(4.3, 4.3, 1.0, 17.5, 0.5, -13.5, 'concrete', 32);
  // Door on the plinth's south face (visual; the dome box covers it).
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.0, 0.2), mat('surface'));
  door.position.set(17.5, 1.0, -9.15);
  door.castShadow = true;
  door.receiveShadow = true;
  group.add(door);
  shootables.push(door);
  // Site A ring on open snow in front of the dome.
  const ringA = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.2, 48), ringMat);
  ringA.rotation.x = -Math.PI / 2;
  ringA.position.set(12.5, 0.03, -8);
  ringA.receiveShadow = true;
  group.add(ringA);

  // ---- site B: Fuel Depot (drum yard ring + floodlight) ----
  const drumAngles = [0, 45, 90, 135, 180, 225, 270, 315];
  drumAngles.forEach((deg, i) => {
    const a = (deg * Math.PI) / 180;
    const dx = -15 + 5 * Math.cos(a);
    const dz = -10 + 5 * Math.sin(a);
    cyl(0.45, 0.45, 1.0, dx, 0.5, dz, i % 3 === 0 ? 'danger' : 'concrete', 20);
  });
  // Low concrete barriers at the yard edge.
  box(2.4, 1.0, 0.6, -11, 0.5, -2, 'concrete');
  box(2.4, 1.0, 0.6, -19, 0.5, -3, 'concrete');
  // Floodlight pole.
  cyl(0.12, 0.16, 5.5, -20, 2.75, -14.5, 'hairline', 12);
  box(0.7, 0.3, 0.4, -20, 5.5, -14.5, 'surface');
  const ringB = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.2, 48), ringMat);
  ringB.rotation.x = -Math.PI / 2;
  ringB.position.set(-15, 0.03, -10);
  ringB.receiveShadow = true;
  group.add(ringB);

  // ---- mid: frozen pond + Crevasse Bridge (deck is a walked-over visual) ----
  const pond = new THREE.Mesh(new THREE.CircleGeometry(4.5, 40), mat('ice'));
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(0, 0.02, 0);
  pond.receiveShadow = true;
  group.add(pond);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.08, 12), mat('surface'));
  deck.position.set(0, 0.0, 0);
  deck.receiveShadow = true;
  group.add(deck);
  box(0.15, 0.5, 12, -1.5, 0.3, 0, 'hairline');
  box(0.15, 0.5, 12, 1.5, 0.3, 0, 'hairline');

  // ---- Service Corridor (west): roofed tunnel, gap at z 0..4 for cross-play ----
  for (const wx of [-18, -14]) {
    box(0.3, 2.9, 6, wx, 1.45, -3, 'concrete');
    box(0.3, 2.9, 8, wx, 1.45, 8, 'concrete');
  }
  box(4.6, 0.25, 6.4, -16, 3.0, -3, 'snow');
  box(4.6, 0.25, 8.4, -16, 3.0, 8, 'snow');

  // ---- snowcat vehicle as cover, mid-east ----
  const snowcat = new THREE.Group();
  snowcat.position.set(6, 0, 3.5);
  snowcat.rotation.y = -0.35;
  group.add(snowcat);
  function catPart(geo, material, x, y, z) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    snowcat.add(m);
    solids.push(m);
    shootables.push(m);
    return m;
  }
  catPart(new THREE.BoxGeometry(3.6, 1.1, 1.9), mat('concrete'), 0, 0.75, 0);
  catPart(new THREE.BoxGeometry(1.7, 0.9, 1.6), mat('surface'), 0.6, 1.7, 0);
  catPart(new THREE.BoxGeometry(1.7, 0.4, 0.1), windowMat, 0.6, 1.8, 0.85);
  catPart(new THREE.BoxGeometry(3.8, 0.4, 0.35), mat('hairline'), 0, 0.2, 0.85);
  catPart(new THREE.BoxGeometry(3.8, 0.4, 0.35), mat('hairline'), 0, 0.2, -0.85);

  // ---- supply crates (kept clear of waypoint nodes) ----
  const crates = [
    [12.5, 14.5, 1.6, 'concrete'],
    [-12.5, 14.5, 1.6, 'concrete'],
    [18, 2, 1.2, 'surface'],
    [-9, 5, 1.4, 'concrete'],
    [4, -6, 1.2, 'surface'],
    [-4, -6, 1.4, 'concrete'],
    [12, -13, 1.0, 'hairline'],
    [-12, 3, 1.2, 'surface'],
    [2, 12, 1.0, 'concrete'],
    [19, -1, 1.0, 'surface'],
  ];
  for (const [x, z, s, name] of crates) {
    box(s, s, s, x, s / 2, z, name);
  }
  // One stacked crate.
  box(0.9, 0.9, 0.9, 4, 1.65, -6, 'hairline');

  // ---- snow berms (low rounded mounds, solid cover) ----
  const berms = [
    [18.5, -3, 2.2, 1.6, 0.9],
    [-18.5, 3, 2.2, 1.6, 0.9],
    [8, 12, 2.0, 1.5, 0.8],
    [-8, 12, 2.0, 1.5, 0.8],
    [0, -16, 2.5, 1.6, 0.9],
  ];
  for (const [x, z, rx, rz, h] of berms) {
    const berm = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      mat('snow'),
    );
    berm.scale.set(rx, h, rz);
    berm.position.set(x, 0, z);
    add(berm, true, true);
  }

  // ---- antenna masts with warning tips ----
  function antenna(x, z) {
    cyl(0.12, 0.18, 7, x, 3.5, z, 'hairline', 10);
    box(1.6, 0.1, 0.1, x, 5.5, z, 'hairline');
    box(1.1, 0.1, 0.1, x, 6.3, z, 'hairline');
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), tipMat);
    tip.position.set(x, 7.1, z);
    tip.castShadow = true;
    group.add(tip);
    shootables.push(tip);
  }
  antenna(-20.5, 15);
  antenna(20.5, -15.5);

  // ---- aurora ribbons high in the sky (animated by main.js) ----
  const auroraMeshes = [];
  const ribbons = [
    { w: 70, h: 9, x: 0, y: 27, z: -28, ry: 0, rx: 0.25, phase: 0 },
    { w: 56, h: 7, x: -18, y: 31, z: -18, ry: 0.6, rx: 0.15, phase: 2.1 },
    { w: 60, h: 8, x: 16, y: 24, z: -24, ry: -0.5, rx: 0.35, phase: 4.2 },
  ];
  for (const r of ribbons) {
    const geo = new THREE.PlaneGeometry(r.w, r.h, 64, 4);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      pos.setZ(
        i,
        Math.sin(px * 0.12 + r.phase) * 2.0 + Math.sin(py * 0.5 + r.phase) * 0.8,
      );
    }
    geo.computeVertexNormals();
    geo.userData.base = Float32Array.from(pos.array);
    geo.userData.phase = r.phase;
    const ribbon = new THREE.Mesh(geo, auroraMat);
    ribbon.position.set(r.x, r.y, r.z);
    ribbon.rotation.set(r.rx, r.ry, 0);
    group.add(ribbon);
    auroraMeshes.push(ribbon);
  }

  // ---- lighting: cold moonlight key + warm station windows ----
  const hemi = new THREE.HemisphereLight(
    new THREE.Color(PALETTE.ice),
    new THREE.Color(PALETTE.snow),
    0.55,
  );
  scene.add(hemi);

  const moon = new THREE.DirectionalLight(new THREE.Color(PALETTE.ink), 1.7);
  moon.position.set(18, 26, 12);
  moon.target.position.set(0, 0, -2);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -26;
  moon.shadow.camera.right = 26;
  moon.shadow.camera.top = 22;
  moon.shadow.camera.bottom = -22;
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 70;
  moon.shadow.bias = -0.0006;
  scene.add(moon, moon.target);

  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.35);
  fill.position.set(-14, 10, 14);
  scene.add(fill);

  const domeLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 40, 20, 2);
  domeLight.position.set(17.5, 2.5, -13.5);
  scene.add(domeLight);

  const depotLight = new THREE.PointLight(new THREE.Color(PALETTE.ink), 30, 22, 2);
  depotLight.position.set(-20, 5.2, -14.5);
  scene.add(depotLight);

  const winLight1 = new THREE.PointLight(new THREE.Color(PALETTE.accent), 8, 9, 2);
  winLight1.position.set(-6, 2, -14.2);
  scene.add(winLight1);

  const winLight2 = new THREE.PointLight(new THREE.Color(PALETTE.accent), 8, 9, 2);
  winLight2.position.set(7, 2, -14.2);
  scene.add(winLight2);

  // ---- colliders from the finished world transforms ----
  scene.updateMatrixWorld(true);
  for (const mesh of solids) {
    colliders.push(new THREE.Box3().setFromObject(mesh));
  }

  // ---- waypoints: connected graph over all 3 lanes and both sites ----
  const nodeDefs = [
    ['t0', 0, 15],
    ['t1', -4, 15.5],
    ['t2', 4, 15.5],
    ['s1', -10, 13],
    ['s2', 10, 13],
    ['m1', 0, 10],
    ['m2', 0, 4],
    ['m3', 0, -2],
    ['m4', 0, -8],
    ['m5', 0, -13.5],
    ['e1', 12, 11],
    ['e2', 16, 6],
    ['e3', 16, 0],
    ['e4', 16, -4],
    ['w1', -12, 11],
    ['w2', -16, 6],
    ['w3', -16, 2],
    ['w4', -16, -4],
    ['a1', 12.5, -8],
    ['a2', 19.5, -7],
    ['a3', 10, -12],
    ['b1', -15, -10],
    ['b2', -18.5, -12.5],
    ['b3', -10, -12],
    ['n1', -8, -14],
    ['n2', 8, -14],
    ['c1', 8, -8],
    ['c2', -8, -8],
  ];
  const nodes = nodeDefs.map(([id, x, z]) => ({
    id,
    pos: new THREE.Vector3(x, 0, z),
  }));
  const edges = [
    ['t0', 't1'], ['t0', 't2'], ['t1', 's1'], ['t2', 's2'],
    ['t1', 'm1'], ['t2', 'm1'], ['t0', 'm1'],
    ['s1', 'w1'], ['s2', 'e1'], ['s1', 'm1'], ['s2', 'm1'],
    ['m1', 'm2'], ['m2', 'm3'], ['m3', 'm4'], ['m4', 'm5'],
    ['e1', 'e2'], ['e2', 'e3'], ['e3', 'e4'], ['e4', 'a1'],
    ['a1', 'a3'], ['a1', 'a2'], ['e4', 'a2'],
    ['w1', 'w2'], ['w2', 'w3'], ['w3', 'w4'], ['w4', 'b1'],
    ['b1', 'b2'], ['b1', 'b3'], ['w4', 'b3'],
    ['m4', 'c1'], ['m4', 'c2'], ['c1', 'e4'], ['c2', 'w4'],
    ['c1', 'a3'], ['c2', 'b3'],
    ['m5', 'n1'], ['m5', 'n2'], ['n1', 'b3'], ['n2', 'a3'],
    ['n1', 'c2'], ['n2', 'c1'],
    ['m1', 'e1'], ['m1', 'w1'],
    ['m3', 'e3'], ['m3', 'w3'], ['m2', 'w3'],
  ];

  return {
    colliders,
    shootables,
    group,
    spawns: {
      ct: [
        new THREE.Vector3(11, 0, -12),
        new THREE.Vector3(8, 0, -14.5),
        new THREE.Vector3(-11, 0, -12),
        new THREE.Vector3(-18.5, 0, -12),
        new THREE.Vector3(0, 0, -13.5),
      ],
      t: [
        new THREE.Vector3(-6, 0, 15),
        new THREE.Vector3(-3, 0, 16),
        new THREE.Vector3(0, 0, 15),
        new THREE.Vector3(3, 0, 16),
        new THREE.Vector3(6, 0, 15),
      ],
    },
    sites: {
      A: { center: new THREE.Vector3(12.5, 0, -8), radius: 3.2, name: 'Observatory Dome' },
      B: { center: new THREE.Vector3(-15, 0, -10), radius: 3.2, name: 'Fuel Depot' },
    },
    waypoints: { nodes, edges },
    bounds: BOUNDS,
    auroraMeshes,
    name: 'WHITEOUT',
  };
}
