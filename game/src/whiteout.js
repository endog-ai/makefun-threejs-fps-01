// WHITEOUT — the signature mechanic: a blizzard that sweeps Halcyon Station.
// One job: run the whiteout cycle (fog, snow, slow, muffle) and tell everyone.
// Cycle: first whiteout ~20 s into round 1, then every ~25 s, lasting ~5 s.
// During a whiteout: scene fog ramps from clear (~0.004) to thick (~0.045,
// visibility ~6 m), a few hundred snow points drive sideways, player + bot
// movement x0.75 (bots and the player read the state event / slow factor),
// and shot sounds muffle (audio.whiteoutStart/whiteoutEnd). Bots hold their
// position and repath around mid while it blows — they subscribe to the
// state 'whiteout' event themselves (see bots.js).
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const CLEAR_DENSITY = 0.004;
const WHITEOUT_DENSITY = 0.045;
const FIRST_WHITEOUT_AT = 20;
const WHITEOUT_EVERY = 25;
const WHITEOUT_LASTS = 5;
const SNOW_COUNT = 600;
const SNOW_AREA = { x: 30, y: 18, z: 24 };

export function createWhiteout(scene, state, audio, hooks) {
  // One THREE.Points cloud, pre-allocated positions, updated in place —
  // no per-frame allocation. Snow always drifts a little; in a whiteout
  // it drives sideways, fast, and the cloud turns near-opaque.
  const positions = new Float32Array(SNOW_COUNT * 3);
  const speeds = new Float32Array(SNOW_COUNT * 2);
  for (let i = 0; i < SNOW_COUNT; i += 1) {
    positions[i * 3] = (Math.random() * 2 - 1) * SNOW_AREA.x;
    positions[i * 3 + 1] = Math.random() * SNOW_AREA.y;
    positions[i * 3 + 2] = (Math.random() * 2 - 1) * SNOW_AREA.z;
    speeds[i * 2] = 2 + Math.random() * 3; // sideways wind
    speeds[i * 2 + 1] = 1 + Math.random() * 1.5; // fall
  }
  const snowGeo = new THREE.BufferGeometry();
  snowGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const snowMat = new THREE.PointsMaterial({
    color: new THREE.Color(PALETTE.snow),
    size: 0.14,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  const snow = new THREE.Points(snowGeo, snowMat);
  snow.frustumCulled = false;
  scene.add(snow);

  const whiteout = {
    active: false,
    liveTime: 0,
    nextAt: FIRST_WHITEOUT_AT,
    activeFor: 0,
    density: CLEAR_DENSITY,

    reset() {
      if (whiteout.active) whiteout.end();
      whiteout.liveTime = 0;
      whiteout.nextAt = FIRST_WHITEOUT_AT;
      whiteout.activeFor = 0;
      whiteout.density = CLEAR_DENSITY;
      if (scene.fog) scene.fog.density = CLEAR_DENSITY;
      snowMat.opacity = 0.18;
    },

    // Staging driver: ?whiteout=1 forces a whiteout now, so the plant
    // screenshot can catch fog rolling in at the frame edge.
    force() {
      if (!whiteout.active) whiteout.begin();
    },

    begin() {
      whiteout.active = true;
      whiteout.activeFor = 0;
      if (state) state.emit('whiteout', { active: true });
      if (audio) audio.whiteoutStart();
      if (hooks && hooks.onWhiteoutStart) hooks.onWhiteoutStart();
    },

    end() {
      whiteout.active = false;
      whiteout.nextAt = whiteout.liveTime + WHITEOUT_EVERY;
      if (state) state.emit('whiteout', { active: false });
      if (audio) audio.whiteoutEnd();
      if (hooks && hooks.onWhiteoutEnd) hooks.onWhiteoutEnd();
    },

    step(dt) {
      // The clock only runs while a round is live, so the first whiteout
      // lands ~20 s into round 1 as the contract promises.
      if (state && state.phase === 'live') whiteout.liveTime += dt;
      if (!whiteout.active && state && state.phase === 'live' && whiteout.liveTime >= whiteout.nextAt) {
        whiteout.begin();
      } else if (whiteout.active) {
        whiteout.activeFor += dt;
        if (whiteout.activeFor >= WHITEOUT_LASTS) whiteout.end();
      }

      // Fog ramps toward its target so the blizzard rolls in and lifts
      // instead of snapping on and off.
      const target = whiteout.active ? WHITEOUT_DENSITY : CLEAR_DENSITY;
      whiteout.density += (target - whiteout.density) * Math.min(1, dt * 2);
      if (scene.fog) scene.fog.density = whiteout.density;

      // Snow drives sideways: slow drift in clear air, a sideways gale
      // in a whiteout. Positions wrap inside the box, updated in place.
      const wind = whiteout.active ? 2.6 : 0.6;
      const fall = whiteout.active ? 2.2 : 1;
      const pos = snowGeo.attributes.position;
      const arr = pos.array;
      for (let i = 0; i < SNOW_COUNT; i += 1) {
        let x = arr[i * 3] - speeds[i * 2] * wind * dt;
        let y = arr[i * 3 + 1] - speeds[i * 2 + 1] * fall * dt;
        const z = arr[i * 3 + 2] + Math.sin(whiteout.liveTime * 0.7 + i) * 0.15 * dt;
        if (x < -SNOW_AREA.x) x += SNOW_AREA.x * 2;
        if (y < 0) y += SNOW_AREA.y;
        arr[i * 3] = x;
        arr[i * 3 + 1] = y;
        arr[i * 3 + 2] = z;
      }
      pos.needsUpdate = true;
      const targetOpacity = whiteout.active ? 0.85 : 0.18;
      snowMat.opacity += (targetOpacity - snowMat.opacity) * Math.min(1, dt * 2);
    },
  };

  return whiteout;
}
