// Weapons for WHITEOUT: three guns, a frag grenade and a thermal vest.
// This module owns the numbers; main.js owns the ray and the damage application.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: { id: 'pistol', name: 'Sparrow-9', price: 0, mag: 12, reserve: 36, gap: 0.16, reload: 1.4, damage: 26, headMul: 3, spreadStill: 0.003, spreadMove: 0.02, auto: false },
  smg: { id: 'smg', name: 'Hailstorm-9', price: 1500, mag: 32, reserve: 96, gap: 0.065, reload: 1.8, damage: 22, headMul: 3, spreadStill: 0.004, spreadMove: 0.032, auto: true },
  rifle: { id: 'rifle', name: 'Glacier-7 Carbine', price: 2700, mag: 30, reserve: 90, gap: 0.096, reload: 1.9, damage: 34, headMul: 3, spreadStill: 0.0022, spreadMove: 0.028, auto: true },
};
export const GRENADE = { id: 'grenade', name: 'Frag Grenade', price: 300, max: 2 };
export const ARMOR = { id: 'armor', name: 'Thermal Vest', price: 650 };

const GRENADE_RADIUS = 6;
const GRENADE_DAMAGE = 90;
const GRENADE_FUSE = 1.6;
const GRENADE_SPEED = 14;
const GRENADE_UP = 3.5;
const GRENADE_BOUNCE = 0.45;
const GRENADE_SIZE = 0.09;
const MOVE_REFERENCE = 5.2;
const MUZZLE_TIME = 0.06;

export function createWeapon(camera, scene, world, hooks) {
  // One view-model group, restyled per weapon: barrel length and accent change.
  // Kept small and low so it reads as a gun, not a slab: the frame belongs
  // to the station, not the weapon. A faint emissive lift keeps it readable
  // in the polar night instead of going pure black.
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.concrete), roughness: 0.45, metalness: 0.55, emissive: new THREE.Color(PALETTE.concrete), emissiveIntensity: 0.25 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2, emissive: new THREE.Color(PALETTE.hairline), emissiveIntensity: 0.3 });
  const gripMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ice), roughness: 0.6, metalness: 0.1, emissive: new THREE.Color(PALETTE.ice), emissiveIntensity: 0.2 });

  // One view-model group, restyled per weapon: barrel length and accent change.
  const model = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), metal);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.4), dark);
  barrel.position.set(0, 0.025, -0.38);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), dark);
  stock.position.set(0, -0.02, 0.3);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.07), gripMat);
  grip.position.set(0, -0.1, 0.05);
  model.add(receiver, barrel, stock, grip);
  model.position.set(0.3, -0.26, -0.5);
  model.scale.setScalar(0.8);
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.18),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.3, -0.24, -0.95);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.3, -0.22, -0.7);
  camera.add(flashLight);

  const grenadeGeo = new THREE.SphereGeometry(GRENADE_SIZE, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.concrete), roughness: 0.4, metalness: 0.6 });
  const boomGeo = new THREE.SphereGeometry(1, 12, 10);
  const boomMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false });
  const boom = new THREE.Mesh(boomGeo, boomMat);
  boom.visible = false;
  scene.add(boom);
  const boomLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 14);
  scene.add(boomLight);

  // Per-weapon ammo cache so switching guns keeps each magazine as it was.
  const ammo = {};
  for (const id of Object.keys(WEAPONS)) {
    ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
  }
  const state = {
    mag: WEAPONS.pistol.mag,
    reserve: WEAPONS.pistol.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    weaponId: 'pistol',
    grenades: 0,
  };
  const live = [];
  const probe = new THREE.Box3();
  const tmpVel = new THREE.Vector3();
  let boomLeft = 0;

  function def() {
    return WEAPONS[state.weaponId];
  }

  function restyle() {
    const d = def();
    if (d.id === 'pistol') {
      barrel.scale.set(1, 1, 0.55);
      barrel.position.z = -0.3;
      stock.visible = false;
      grip.position.z = 0.08;
    } else if (d.id === 'smg') {
      barrel.scale.set(1.15, 1.15, 0.9);
      barrel.position.z = -0.36;
      stock.visible = true;
      grip.position.z = 0.02;
    } else {
      barrel.scale.set(1, 1, 1.5);
      barrel.position.z = -0.5;
      stock.visible = true;
      grip.position.z = 0.05;
    }
  }

  function setWeapon(id) {
    if (!WEAPONS[id] || id === state.weaponId) return;
    ammo[state.weaponId].mag = state.mag;
    ammo[state.weaponId].reserve = state.reserve;
    state.weaponId = id;
    state.mag = ammo[id].mag;
    state.reserve = ammo[id].reserve;
    state.reloadLeft = 0;
    state.cooldown = 0;
    restyle();
  }

  function step(dt) {
    const d = def();
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = -0.5 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (d.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = d.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
    if (boomLeft > 0) {
      boomLeft = Math.max(0, boomLeft - dt);
      const t = 1 - boomLeft / 0.35;
      boom.scale.setScalar(0.5 + t * GRENADE_RADIUS);
      boomMat.opacity = 0.85 * (1 - t);
      boomLight.intensity = 60 * (1 - t);
      if (boomLeft === 0) {
        boom.visible = false;
        boomLight.intensity = 0;
      }
    }
    // Grenade sim: gravity, bounce off world.colliders, fuse 1.6 s, then explode.
    for (let i = live.length - 1; i >= 0; i--) {
      const g = live[i];
      g.fuse -= dt;
      tmpVel.copy(g.vel);
      tmpVel.y -= 20 * dt;
      g.vel.copy(tmpVel);
      const p = g.mesh.position;
      let nx = p.x + g.vel.x * dt;
      probe.min.set(nx - GRENADE_SIZE, p.y - GRENADE_SIZE, p.z - GRENADE_SIZE);
      probe.max.set(nx + GRENADE_SIZE, p.y + GRENADE_SIZE, p.z + GRENADE_SIZE);
      if (world.colliders.some((c) => probe.intersectsBox(c))) {
        g.vel.x *= -GRENADE_BOUNCE;
      } else {
        p.x = nx;
      }
      let nz = p.z + g.vel.z * dt;
      probe.min.set(p.x - GRENADE_SIZE, p.y - GRENADE_SIZE, nz - GRENADE_SIZE);
      probe.max.set(p.x + GRENADE_SIZE, p.y + GRENADE_SIZE, nz + GRENADE_SIZE);
      if (world.colliders.some((c) => probe.intersectsBox(c))) {
        g.vel.z *= -GRENADE_BOUNCE;
      } else {
        p.z = nz;
      }
      p.y += g.vel.y * dt;
      if (p.y < GRENADE_SIZE) {
        p.y = GRENADE_SIZE;
        if (Math.abs(g.vel.y) > 1.5) g.vel.y *= -GRENADE_BOUNCE;
        else g.vel.y = 0;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
      }
      if (g.fuse <= 0) {
        scene.remove(g.mesh);
        live.splice(i, 1);
        boom.position.copy(p);
        boom.visible = true;
        boomLeft = 0.35;
        boomLight.position.copy(p);
        hooks.onExplode(p, GRENADE_RADIUS, GRENADE_DAMAGE);
      }
    }
  }

  restyle();

  return {
    state,
    def,
    setWeapon,
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def().gap;
      state.flash = MUZZLE_TIME;
      state.kick = 0.055;
      hooks.onShot();
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      const d = def();
      if (state.reloadLeft > 0 || state.mag === d.mag || state.reserve === 0) return;
      state.reloadLeft = d.reload;
    },
    spread(speed) {
      const d = def();
      return d.spreadStill + Math.min(1, speed / MOVE_REFERENCE) * d.spreadMove;
    },
    refill() {
      const d = def();
      state.mag = d.mag;
      state.reserve = d.reserve;
      ammo[d.id].mag = d.mag;
      ammo[d.id].reserve = d.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    throwGrenade(origin, dir) {
      if (state.grenades <= 0) return false;
      state.grenades -= 1;
      const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
      mesh.position.copy(origin);
      scene.add(mesh);
      const vel = dir.clone().normalize().multiplyScalar(GRENADE_SPEED);
      vel.y += GRENADE_UP;
      live.push({ mesh, vel, fuse: GRENADE_FUSE });
      return true;
    },
    get grenades() {
      return live;
    },
  };
}
