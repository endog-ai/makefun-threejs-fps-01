// WHITEOUT — the THAW CORE: the round objective.
// One job: plant / planted timer / defuse / detonation.
// The player carries the THAW CORE, holds E inside a site to plant it (3.5 s, driven by
// main.js via startPlant/cancelPlant), and a planted core counts down 35 s with
// accelerating beeps before it detonates. A defender bot channels a 5 s defuse at the
// planted site while no live attacker is within 8 m. Never just "bomb" in copy.
import * as THREE from 'three';

const PLANT_SECONDS = 3.5;
const PLANTED_SECONDS = 35;
const DEFUSE_SECONDS = 5;
const DEFUSE_CLEAR_RADIUS = 8;
const DEFUSE_CHANNEL_RADIUS = 2;
const BEEP_BASE = 0.3;
const BEEP_TOP = 1.2;

export function createBomb(scene, world, state, hooks) {
  // The THAW CORE itself: a small dark thermal-charge box with a blinking amber light.
  const coreGroup = new THREE.Group();
  const coreBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.26, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x141a24, roughness: 0.5, metalness: 0.4 }),
  );
  coreBody.castShadow = true;
  const coreLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 12, 8),
    new THREE.MeshStandardMaterial({
      color: 0xf0a830, emissive: 0xf0a830, emissiveIntensity: 2, roughness: 0.4,
    }),
  );
  coreLight.position.set(0, 0.16, 0);
  coreGroup.add(coreBody, coreLight);
  coreGroup.visible = false;
  scene.add(coreGroup);

  // Steam plume once the THAW CORE is planted: a small rising cone of pale vapour.
  const steam = new THREE.Mesh(
    new THREE.ConeGeometry(0.35, 1.1, 12, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0xc9d6e3, transparent: true, opacity: 0.35, roughness: 1,
    }),
  );
  steam.position.y = 0.7;
  steam.visible = false;
  coreGroup.add(steam);

  // The planted site ring: a flat amber ring on the snow that glows while the core burns.
  const ringGeo = new THREE.RingGeometry(2.6, 3.2, 40);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xf0a830, transparent: true, opacity: 0, side: THREE.DoubleSide,
  });
  const siteRing = new THREE.Mesh(ringGeo, ringMat);
  siteRing.rotation.x = -Math.PI / 2;
  siteRing.position.y = 0.05;
  siteRing.visible = false;
  scene.add(siteRing);

  const bomb = {
    status: 'carried',
    plantProgress: 0,
    defuseProgress: 0,
    site: null,
    timer: 0,
    position: new THREE.Vector3(),

    planting: false,
    defusing: false,
    nextBeepAt: 0,
    blinkAt: 0,

    // Begin the THAW CORE plant channel at a site; main.js calls this while E is held
    // inside the site radius, and cancelPlant() when E is released or the player leaves.
    startPlant(site) {
      if (bomb.status !== 'carried' || bomb.planting) return;
      bomb.planting = true;
      bomb.site = site;
      bomb.plantProgress = 0;
    },

    cancelPlant() {
      bomb.planting = false;
      bomb.plantProgress = 0;
      if (bomb.status === 'carried') bomb.site = null;
    },

    // Begin a defuse channel; main.js calls this when a defender bot is at the core.
    startDefuse() {
      if (bomb.status !== 'planted') return;
      bomb.defusing = true;
    },

    reset() {
      bomb.status = 'carried';
      bomb.plantProgress = 0;
      bomb.defuseProgress = 0;
      bomb.site = null;
      bomb.timer = 0;
      bomb.planting = false;
      bomb.defusing = false;
      bomb.nextBeepAt = 0;
      coreGroup.visible = false;
      steam.visible = false;
      siteRing.visible = false;
      ringMat.opacity = 0;
      bomb.position.set(0, 0, 0);
    },

    step(dt, ctx) {
      // Planting the THAW CORE: hold E inside the site for 3.5 s.
      if (bomb.status === 'carried' && bomb.planting && bomb.site) {
        const siteDef = world.sites[bomb.site];
        const playerPos = ctx.playerPos;
        const dx = playerPos.x - siteDef.center.x;
        const dz = playerPos.z - siteDef.center.z;
        const inside = dx * dx + dz * dz <= siteDef.radius * siteDef.radius;
        if (inside) {
          bomb.plantProgress += dt / PLANT_SECONDS;
          if (bomb.plantProgress >= 1) {
            bomb.plantProgress = 1;
            bomb.planting = false;
            bomb.status = 'planted';
            bomb.timer = PLANTED_SECONDS;
            bomb.position.copy(siteDef.center);
            bomb.position.y = 0.15;
            coreGroup.position.copy(bomb.position);
            coreGroup.visible = true;
            steam.visible = true;
            siteRing.position.set(siteDef.center.x, 0.05, siteDef.center.z);
            siteRing.visible = true;
            bomb.nextBeepAt = 0;
            if (state) state.emit('bombPlanted', { site: bomb.site });
            if (hooks.onPlanted) hooks.onPlanted(bomb.site);
          }
        } else {
          bomb.plantProgress = 0;
        }
        return;
      }

      if (bomb.status !== 'planted') return;

      // Blinking amber light + steaming, glowing site ring while the core burns.
      bomb.blinkAt += dt;
      const blinkOn = (bomb.blinkAt % 0.6) < 0.3;
      coreLight.material.emissiveIntensity = blinkOn ? 2.5 : 0.4;
      steam.rotation.y += dt * 1.5;
      steam.scale.y = 1 + Math.sin(bomb.blinkAt * 3) * 0.15;
      const urgency = 1 - bomb.timer / PLANTED_SECONDS;
      ringMat.opacity = 0.35 + urgency * 0.55;

      // Defuse: a defender bot channels 5 s at the core while no live attacker is near.
      const bots = ctx.bots ? ctx.bots.list : null;
      let defuserNear = false;
      let attackerNear = false;
      if (bots) {
        for (const bot of bots) {
          if (!bot.alive) continue;
          const dx = bot.group.position.x - bomb.position.x;
          const dz = bot.group.position.z - bomb.position.z;
          const distSq = dx * dx + dz * dz;
          if (bot.team === 'ct' && distSq <= DEFUSE_CHANNEL_RADIUS * DEFUSE_CHANNEL_RADIUS) {
            defuserNear = true;
          }
          if (bot.team === 't' && distSq <= DEFUSE_CLEAR_RADIUS * DEFUSE_CLEAR_RADIUS) {
            attackerNear = true;
          }
        }
      }
      if (ctx.playerAlive && ctx.playerPos) {
        const dx = ctx.playerPos.x - bomb.position.x;
        const dz = ctx.playerPos.z - bomb.position.z;
        if (dx * dx + dz * dz <= DEFUSE_CLEAR_RADIUS * DEFUSE_CLEAR_RADIUS) attackerNear = true;
      }
      if (defuserNear && !attackerNear) {
        bomb.defusing = true;
        bomb.defuseProgress += dt / DEFUSE_SECONDS;
        if (bomb.defuseProgress >= 1) {
          bomb.defuseProgress = 1;
          bomb.status = 'defused';
          bomb.defusing = false;
          coreGroup.visible = false;
          steam.visible = false;
          siteRing.visible = false;
          if (state) state.emit('bombDefused', { site: bomb.site });
          if (hooks.onDefused) hooks.onDefused();
          return;
        }
      } else {
        bomb.defusing = false;
        if (bomb.defuseProgress > 0) bomb.defuseProgress = Math.max(0, bomb.defuseProgress - dt / DEFUSE_SECONDS);
      }

      // Planted THAW CORE countdown: beeps accelerate, then detonation.
      bomb.timer -= dt;
      const elapsed = PLANTED_SECONDS - bomb.timer;
      if (elapsed >= bomb.nextBeepAt) {
        const interval = BEEP_TOP - (BEEP_TOP - BEEP_BASE) * (elapsed / PLANTED_SECONDS);
        bomb.nextBeepAt = elapsed + interval;
        if (hooks.beep) hooks.beep(bomb.timer <= 5);
      }
      if (bomb.timer <= 0) {
        bomb.timer = 0;
        bomb.status = 'exploded';
        coreGroup.visible = false;
        steam.visible = false;
        siteRing.visible = false;
        if (state) state.emit('explosion', { pos: bomb.position });
        if (hooks.onExplode) hooks.onExplode(bomb.position);
      }
    },
  };

  return bomb;
}
