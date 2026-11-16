// WHITEOUT — integration: wires the player, weapons, bots, rounds, THAW CORE,
// whiteout and HUD into one fixed-step game loop, plus the deterministic
// ?shot=<name>&seed=1 staging the screenshots are taken from.
// One job per module; this file owns only the wiring between them:
// shooting raycast (headshot: 3x damage), grenade AoE, plant/defuse input,
// round flow, HUD sync, the buy menu, the whiteout wiring, and the damage vignette.
//
// Round rules (coordinated here, not in any one module): attackers win by
// elimination or THAW CORE detonation; defenders win by elimination, by
// defuse, or on the timer — except that a planted THAW CORE freezes the round
// timer (the round runs until detonation or defuse), and an elimination
// win for the defenders waits while a THAW CORE is planted so they can defuse.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createMap } from './map.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS, GRENADE, ARMOR } from './weapon.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createGameState } from './state.js';
import { createBots } from './bots.js';
import { createRounds, ROUND_TIME } from './rounds.js';
import { createBomb } from './bomb.js';
import { createWhiteout } from './whiteout.js';

const STEP = 1 / 60;
const ROUND_END_PAUSE = 4.5;
const T_SPAWN = 0;

// Seeded RNG for ?shot staging: with ?seed=1 every staged run plays the
// same sim, so a screenshot can be retaken and still match. Real play
// (no seed) keeps Math.random untouched.
const params = new URLSearchParams(location.search);
const shotName = params.get('shot');
const staging = shotName === 'start' || shotName === 'play' || shotName === 'plant' || shotName === 'buy';
if (staging && params.get('seed')) {
  let s = parseInt(params.get('seed'), 10) >>> 0 || 1;
  Math.random = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const forceWhiteout = params.get('whiteout') === '1';

// ---- renderer / scene -------------------------------------------------
const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
// FogExp2 is set by createMap (clear polar night, 0.004); whiteout.js drives it.
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 220);
camera.rotation.order = 'YXZ';
scene.add(camera);

const world = createMap(scene);
const state = createGameState();
const player = createPlayer(world.colliders);
const audio = staging
  ? { unlock() {}, shot() {}, reload() {}, hit() {}, kill() {}, dryfire() {}, plant() {}, beep() {}, explosion() {}, roundWin() {}, roundLose() {}, click() {}, footstep() {}, whiteoutStart() {}, whiteoutEnd() {} }
  : createAudio();
const hud = createHud();

// ---- dynamic DOM: damage vignette, hint line, plant bar --------------
const vignette = document.createElement('div');
vignette.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:0;background:radial-gradient(ellipse at center,transparent 52%,rgba(212,61,42,0.6) 100%)';
document.body.appendChild(vignette);

const hintEl = document.createElement('div');
hintEl.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);font-family:ui-monospace,Menlo,monospace;font-size:13px;color:#f0a830;pointer-events:none;display:none';
document.body.appendChild(hintEl);

const plantBar = document.createElement('div');
plantBar.style.cssText = 'position:fixed;left:50%;top:58%;transform:translateX(-50%);width:220px;height:10px;border:1px solid #e9eef5;background:#141a24;display:none;pointer-events:none';
const plantFill = document.createElement('div');
plantFill.style.cssText = 'height:100%;width:0%;background:#f0a830';
plantBar.appendChild(plantFill);
document.body.appendChild(plantBar);

// THAW CORE glow: the planting / planted site ring ignites amber.
const glowLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 16);
scene.add(glowLight);
const glowRing = new THREE.Mesh(
  new THREE.RingGeometry(2.6, 3.2, 48),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, side: THREE.DoubleSide }),
);
glowRing.rotation.x = -Math.PI / 2;
scene.add(glowRing);

// Core detonation burst (own mesh; the grenade blast lives in weapon.js).
const detoMesh = new THREE.Mesh(
  new THREE.SphereGeometry(1, 20, 14),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false }),
);
detoMesh.visible = false;
scene.add(detoMesh);
const detoLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 26);
scene.add(detoLight);
let detoAge = -1;
const detoPos = new THREE.Vector3();

// ---- match state owned here -------------------------------------------
let health = 100;
let playerAlive = true;
let owned = new Set(['pistol']);
let simTime = 0;
let roundEndAt = -100;
let prevPhase = state.phase;
let planting = false;
let plantingSite = null;
let vignetteFlash = 0;
let lastHint = '';
let hintUntil = 0;
let prevDefusing = false;
let lastBotShotAt = -100;
let lastGrenadeBlastAt = -100;
let prevFiring = false;
let wantShot = false;
let wantGrenade = false;
let stepAcc = 0;
let lastShotPart = 'torso';
const lastStepPos = new THREE.Vector3(-6, 0, 15);

const raycaster = new THREE.Raycaster();
const shootDir = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();
let shotEvents = [];
// Debug record for the staging driver / play-test: what the last shot hit
// and what the last line-of-sight check found. Read-only diagnostics.
const debug = { lastShot: null, lastLos: null };

// ---- hooks: bots -------------------------------------------------------
const botHooks = {
  damagePlayer: (dmg) => damagePlayer(dmg),
  damageBot: () => {}, // notification only: bots own their health, never re-apply
  onBotKilled: (bot, byPlayer) => {
    const name = bot.team === 'ct' ? `HALCYON-${bot.id + 1}` : `DRIFT-${bot.id - 4}`;
    if (byPlayer) {
      const head = lastShotPart === 'head';
      // During the buy shot's staged clear the feed stays quiet so the
      // round-won banner + buy menu own the frame.
      if (!(staging && shotName === 'buy' && stage.phase === 'clear')) {
        hud.feed(head ? `YOU ▸ ${name} — HEADSHOT` : `YOU ▸ ${name}`);
      }
      state.kills.t += 1;
      state.emit('kill', { byPlayer: true, killerTeam: 't' });
      rounds.addKillReward();
      audio.kill();
    } else {
      hud.feed(`${name} is down`);
    }
  },
  onShot: (pos) => {
    shotEvents.push({ type: 'shot', pos });
    lastBotShotAt = simTime;
  },
};

// ---- hooks: weapon -----------------------------------------------------
const weaponHooks = {
  onShot: () => audio.shot(weapon.state.weaponId),
  onExplode: (pos, radius, damage) => grenadeExploded(pos, radius, damage),
};

function grenadeExploded(pos, radius, damage) {
  lastGrenadeBlastAt = simTime;
  lastShotPart = 'torso';
  audio.explosion();
  for (const bot of bots.list) {
    if (!bot.alive) continue;
    const d = Math.hypot(
      bot.group.position.x - pos.x,
      bot.group.position.y + 1.0 - pos.y,
      bot.group.position.z - pos.z,
    );
    if (d < radius) bots.damage(bot.torso, Math.round(damage * (1 - (d / radius) * 0.5)), 'torso');
  }
  if (playerAlive) {
    const d = Math.hypot(
      player.state.position.x - pos.x,
      player.state.position.y + 1.0 - pos.y,
      player.state.position.z - pos.z,
    );
    if (d < radius) damagePlayer(Math.round(damage * (1 - (d / radius) * 0.5)));
  }
}

// ---- hooks: THAW CORE --------------------------------------------------
const bombHooks = {
  beep: (final) => audio.beep(final),
  onPlanted: (site) => {
    hud.feed(`THAW CORE PLANTED AT ${world.sites[site].name.toUpperCase()}`);
    audio.plant();
  },
  onDefused: () => {
    hud.feed('THAW CORE DEFUSED');
    rounds.endRound('ct', 'defused');
  },
  onExplode: (pos) => {
    audio.explosion();
    detoPos.copy(pos);
    detoAge = 0;
    rounds.endRound('t', 'detonation');
  },
};

// ---- hooks: rounds -----------------------------------------------------
const roundHooks = {
  onRoundStart: (n) => startRoundSetup(n),
  onRoundEnd: (winner, reason) => {
    const title = winner === 't' ? 'DRIFT TAKE THE ROUND' : 'HALCYON TAKE THE ROUND';
    const reasonText = reason === 'elimination'
      ? 'All defenders eliminated'
      : reason === 'detonation'
        ? 'The THAW CORE detonated'
        : reason === 'defused'
          ? 'The THAW CORE was defused'
          : 'Time expired — defenders hold';
    hud.showBanner(title, reasonText);
    hud.feed(title);
    if (winner === 't') audio.roundWin();
    else audio.roundLose();
    roundEndAt = simTime;
    hud.hideBuyMenu();
  },
  onMatchEnd: (winner) => {
    hud.hideBuyMenu();
    hud.showOverlay('matchEnd', {
      winner,
      round: state.round,
      scoreT: state.wins.t,
      scoreCt: state.wins.ct,
    });
  },
  onMoneyChange: (m) => hud.setMoney(m),
  onBuyResult: () => {},
  isBombPlanted: () => bomb.status === 'planted',
};

// ---- hooks: whiteout ---------------------------------------------------
const whiteoutHooks = {
  onWhiteoutStart: () => {
    hud.setWhiteout(true);
    bots.setWhiteout(true);
    hud.feed('WHITEOUT — VISIBILITY LOW');
  },
  onWhiteoutEnd: () => {
    hud.setWhiteout(false);
    bots.setWhiteout(false);
  },
};

const weapon = createWeapon(camera, scene, world, weaponHooks);
const bots = createBots(scene, world, botHooks, state);
const rounds = createRounds(state, state, roundHooks);
const bomb = createBomb(scene, world, state, bombHooks);
const whiteout = createWhiteout(scene, state, audio, whiteoutHooks);
const input = createInput(renderer.domElement, (locked) => {
  if (!locked && state.phase === 'live' && !isBuyOpen()) hud.showOverlay('paused');
  if (locked && (state.phase === 'live' || state.phase === 'buy')) hud.hideOverlay();
});

const shotTargets = [...bots.hitMeshes, ...world.shootables];

// ---- player damage -----------------------------------------------------
function damagePlayer(amount) {
  if (!playerAlive || state.phase !== 'live') return;
  let dmg = amount;
  if (player.state.armor > 0) dmg = Math.max(1, Math.round(dmg / 2));
  health -= dmg;
  vignetteFlash = 0.65;
  state.emit('damage', { amount: dmg });
  if (health <= 0) {
    health = 0;
    playerAlive = false;
    hud.feed('YOU ARE DOWN');
    hud.setHealth(0);
  }
}

// ---- shooting: raycast, headshot 3x, recoil + spread -------------------
function fireShot() {
  const def = weapon.def();
  if (!weapon.takeRound()) return;
  weapon.pullTrigger();
  player.recoil(0.012, (Math.random() - 0.5) * 0.006);
  camera.getWorldDirection(shootDir);
  const spread = weapon.spread(player.groundSpeed());
  shootDir.x += (Math.random() * 2 - 1) * spread;
  shootDir.y += (Math.random() * 2 - 1) * spread;
  shootDir.z += (Math.random() * 2 - 1) * spread;
  shootDir.normalize();
  raycaster.set(camera.position, shootDir);
  raycaster.far = 120;
  shotEvents.push({ type: 'shot', pos: player.state.position.clone() });
  const hits = raycaster.intersectObjects(shotTargets, false);
  if (!hits.length) {
    debug.lastShot = { hit: 'nothing', part: null, dmg: 0 };
    return;
  }
  const hit = hits[0];
  const bot = hit.object.userData ? hit.object.userData.bot : null;
  if (!bot) {
    debug.lastShot = { hit: 'wall', part: null, dmg: 0, dist: +hit.distance.toFixed(1) };
    return; // wall hit: the shot stops, no marker
  }
  const part = hit.object.userData.part || 'torso';
  lastShotPart = part;
  const dmg = def.damage * (part === 'head' ? def.headMul : 1);
  debug.lastShot = { hit: `bot ${bot.id} ${bot.team}`, part, dmg, dist: +hit.distance.toFixed(1) };
  const killed = bots.damage(hit.object, dmg, part);
  hud.hitMarker(killed, killed ? 300 : 90);
  if (!killed) audio.hit();
}

function handleFiring() {
  if (state.phase !== 'live' || !playerAlive) {
    prevFiring = input.state.firing || wantShot;
    wantShot = false;
    return;
  }
  const staged = wantShot;
  const firing = input.state.firing || staged;
  wantShot = false;
  const def = weapon.def();
  // A staged trigger pulse counts as a fresh press each tick it is set,
  // so the semi-auto pistol fires once per pulse instead of once per hold.
  const rising = (firing && !prevFiring) || staged;
  if (firing && weapon.ready() && (def.auto || rising)) {
    fireShot();
  } else if (rising && weapon.state.mag === 0 && weapon.state.reloadLeft === 0) {
    audio.dryfire();
    showHint('MAG EMPTY — PRESS R', 1.2);
  }
  prevFiring = firing;
}

// ---- one-shot keys: reload, weapon switch, grenade, buy menu ----------
function handlePressedKeys() {
  const pressed = input.state.pressed;
  if (state.phase === 'live' && playerAlive) {
    if (pressed.has('KeyR')) {
      const def = weapon.def();
      if (weapon.state.reloadLeft === 0 && weapon.state.mag < def.mag && weapon.state.reserve > 0) {
        weapon.reload();
        audio.reload();
      }
    }
    const switchTo = pressed.has('Digit1') ? 'pistol' : pressed.has('Digit2') ? 'smg' : pressed.has('Digit3') ? 'rifle' : null;
    if (switchTo && owned.has(switchTo) && switchTo !== weapon.state.weaponId) {
      weapon.setWeapon(switchTo);
      audio.click();
    }
    if (pressed.has('KeyG') && weapon.state.grenades > 0) {
      camera.getWorldDirection(shootDir);
      tmpTarget.copy(camera.position).addScaledVector(shootDir, 0.6);
      tmpTarget.y -= 0.1;
      if (weapon.throwGrenade(tmpTarget, shootDir)) audio.click();
    }
  }
  if (pressed.has('KeyB') && state.phase === 'buy') {
    if (isBuyOpen()) hud.hideBuyMenu();
    else openBuyMenu();
  }
  if (pressed.has('Escape') && isBuyOpen()) hud.hideBuyMenu();
}

function isBuyOpen() {
  const menu = document.getElementById('buy-menu');
  return !!menu && !menu.hidden;
}

function buyItems() {
  return [
    { id: 'pistol', name: 'Sparrow-9', price: 0 },
    { id: 'smg', name: 'Hailstorm-9', price: owned.has('smg') ? 0 : WEAPONS.smg.price },
    { id: 'rifle', name: 'Glacier-7 Carbine', price: owned.has('rifle') ? 0 : WEAPONS.rifle.price },
    { id: 'grenade', name: 'Frag Grenade', price: GRENADE.price },
    { id: 'armor', name: 'Thermal Vest', price: ARMOR.price },
  ];
}

function openBuyMenu() {
  if (state.phase !== 'buy') return;
  hud.showBuyMenu(buyItems(), state.money, onBuy);
  // The round-end banner sits under the buy panel (both are fixed and the
  // panel paints later); lift it above the panel while shopping so the
  // round result stays readable, and put it back when play resumes.
  const bannerEl = document.getElementById('banner');
  if (bannerEl && !bannerEl.hidden) {
    bannerEl.style.top = '9%';
    bannerEl.style.zIndex = '10';
  }
  if (document.pointerLockElement) document.exitPointerLock();
}

function refreshBuyMenu() {
  if (isBuyOpen()) hud.showBuyMenu(buyItems(), state.money, onBuy);
}

function onBuy(id) {
  // Re-selecting an owned weapon just switches to it, free.
  if (WEAPONS[id] && owned.has(id)) {
    weapon.setWeapon(id);
    audio.click();
    hud.setWeaponName(weapon.def().name);
    hud.setAmmo(weapon.state.mag, weapon.state.reserve);
    refreshBuyMenu();
    return;
  }
  if (!rounds.buy(id)) return;
  audio.click();
  if (WEAPONS[id]) {
    owned.add(id);
    weapon.setWeapon(id);
  } else if (id === GRENADE.id) {
    weapon.state.grenades += 1;
  } else if (id === ARMOR.id) {
    player.state.armor = 1;
  }
  hud.setWeaponName(weapon.def().name);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  refreshBuyMenu();
}

// ---- THAW CORE: hold E inside a site to plant --------------------------
function handlePlant() {
  if (state.phase !== 'live' || !playerAlive || bomb.status !== 'carried') {
    if (planting) {
      bomb.cancelPlant();
      planting = false;
    }
    return;
  }
  const p = player.state.position;
  let site = null;
  for (const key of ['A', 'B']) {
    const s = world.sites[key];
    const dx = p.x - s.center.x;
    const dz = p.z - s.center.z;
    if (dx * dx + dz * dz < s.radius * s.radius) {
      site = key;
      break;
    }
  }
  if (input.state.keys.has('KeyE') && site) {
    if (!planting) {
      bomb.startPlant(site);
      planting = true;
      plantingSite = site;
      audio.plant();
    }
  } else if (planting) {
    bomb.cancelPlant();
    planting = false;
  }
}

function attackerNearSite(center) {
  const R = 8;
  if (playerAlive) {
    const dx = player.state.position.x - center.x;
    const dz = player.state.position.z - center.z;
    if (dx * dx + dz * dz < R * R) return true;
  }
  for (const bot of bots.list) {
    if (bot.team !== 't' || !bot.alive) continue;
    const dx = bot.group.position.x - center.x;
    const dz = bot.group.position.z - center.z;
    if (dx * dx + dz * dz < R * R) return true;
  }
  return false;
}

// ---- round setup / round-end checks ------------------------------------
function startRoundSetup(n) {
  bots.reset(n);
  bomb.reset();
  whiteout.reset();
  planting = false;
  plantingSite = null;
  playerAlive = true;
  health = 100;
  player.state.armor = 0;
  player.state.velocity.set(0, 0, 0);
  const spawn = world.spawns.t[T_SPAWN];
  player.state.position.set(spawn.x, 0, spawn.z);
  player.state.yaw = 0;
  player.state.pitch = 0;
  lastStepPos.set(spawn.x, 0, spawn.z);
  if (n === 1) {
    owned = new Set(['pistol']);
    weapon.setWeapon('pistol');
    weapon.refill();
    weapon.state.grenades = 0;
  }
  hud.setRound(n);
  hud.setHealth(100);
  hud.setWeaponName(weapon.def().name);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setMoney(state.money);
  hud.setBomb('');
  if (!staging || shotName === 'buy') openBuyMenu();
}

function checkRoundEnd() {
  if (state.phase !== 'live') return;
  // Defenders cannot win by elimination while a THAW CORE is planted: they
  // still have to defuse it (or let it detonate).
  if (bomb.status !== 'planted' && !playerAlive && bots.aliveCount('t') === 0) {
    rounds.endRound('ct', 'elimination');
    return;
  }
  if (bots.aliveCount('ct') === 0) rounds.endRound('t', 'elimination');
}

// ---- HUD sync, hints, vignette, THAW CORE glow -------------------------
function showHint(text, seconds) {
  hintEl.textContent = text;
  hintEl.style.display = 'block';
  lastHint = text;
  hintUntil = simTime + seconds;
}

function syncHud() {
  hud.setHealth(health);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.setMoney(state.money);
  hud.setTimer(state.phase === 'menu' ? ROUND_TIME : bomb.status === 'planted' ? bomb.timer : state.timer);
  hud.setRound(Math.max(1, state.round));
  hud.setScore(state.wins.ct, state.wins.t);
  hud.setWeaponName(weapon.def().name);
  hud.setWhiteout(whiteout.active);
  if (planting) {
    hud.setBomb(`PLANTING THAW CORE ${Math.round(bomb.plantProgress * 100)}%`, bomb.plantProgress);
  } else if (bomb.status === 'planted') {
    hud.setBomb(bomb.defusing
      ? `DEFUSING THE THAW CORE ${Math.round(bomb.defuseProgress * 100)}%`
      : `THAW CORE PLANTED — ${Math.ceil(bomb.timer)}s`, bomb.defuseProgress);
  } else {
    hud.setBomb('');
  }

  // Hint line: reload beats empty mag beats buy-phase reminder.
  let hint = '';
  if (state.phase === 'live' && playerAlive) {
    if (weapon.state.reloadLeft > 0) hint = 'RELOADING…';
    else if (weapon.state.mag === 0) hint = 'MAG EMPTY — PRESS R';
    else if (weapon.state.mag <= 6) hint = 'LOW AMMO — PRESS R TO RELOAD';
  } else if (state.phase === 'buy' && !isBuyOpen()) {
    hint = 'BUY PHASE — PRESS B FOR EQUIPMENT';
  }
  if (hint) {
    if (hint !== lastHint) {
      hintEl.textContent = hint;
      hintEl.style.display = 'block';
      lastHint = hint;
    }
  } else if (simTime >= hintUntil) {
    hintEl.style.display = 'none';
    lastHint = '';
  }

  // Plant progress bar under the crosshair.
  if (planting) {
    plantBar.style.display = 'block';
    plantFill.style.width = `${Math.round(bomb.plantProgress * 100)}%`;
  } else {
    plantBar.style.display = 'none';
  }

  // Damage vignette: flash on hurt, slow pulse at low health.
  vignetteFlash = Math.max(0, vignetteFlash - 0.016);
  const lowPulse = playerAlive && health <= 25 ? 0.16 + 0.06 * Math.sin(simTime * 5) : 0;
  vignette.style.opacity = String(Math.max(vignetteFlash, lowPulse));

  // THAW CORE glow at the planting / planted site.
  const glowSite = planting ? plantingSite : bomb.status === 'planted' ? bomb.site : null;
  if (glowSite) {
    const c = world.sites[glowSite].center;
    glowLight.position.set(c.x, 1.8, c.z);
    glowRing.position.set(c.x, 0.06, c.z);
    const pulse = 0.6 + 0.4 * Math.sin(simTime * 6);
    glowLight.intensity = planting ? 8 + 18 * bomb.plantProgress : 20 * pulse + 8;
    glowRing.material.opacity = planting ? 0.25 + 0.5 * bomb.plantProgress : 0.55 * pulse + 0.2;
  } else {
    glowLight.intensity = 0;
    glowRing.material.opacity = 0;
  }
}

function updateCamera() {
  if (state.phase === 'menu') {
    // Station vista for the menu: Observatory Dome + warm hab windows
    // mid-ground, aurora ribbons high in the polar-night sky. The camera
    // looks straight up the station so the dome lands right of the panel
    // and the far hab module's warm windows land left of it.
    camera.position.set(8, 4.5, 6);
    camera.lookAt(8, 7, -16);
    return;
  }
  camera.position.set(
    player.state.position.x,
    player.state.position.y + player.state.eye,
    player.state.position.z,
  );
  camera.rotation.y = player.state.yaw;
  camera.rotation.x = player.state.pitch;
  camera.updateMatrixWorld();
}

// ---- aurora: slow undulation of the sky ribbons -------------------------
const auroraBases = world.auroraMeshes.map((mesh) => ({
  mesh,
  base: Float32Array.from(mesh.geometry.userData.base),
  phase: mesh.geometry.userData.phase,
}));
function animateAurora(time) {
  for (const ribbon of auroraBases) {
    const pos = ribbon.mesh.geometry.attributes.position;
    const arr = pos.array;
    const base = ribbon.base;
    for (let i = 0; i < arr.length; i += 3) {
      const x = base[i];
      const y = base[i + 1];
      arr[i + 2] = base[i + 2] + Math.sin(time * 0.45 + ribbon.phase + x * 0.08) * 0.9;
      arr[i + 1] = y + Math.sin(time * 0.3 + ribbon.phase + x * 0.05) * 0.4;
    }
    pos.needsUpdate = true;
  }
}

// ---- ?shot staging -----------------------------------------------------
// Every staged frame is the real game simulated forward with scripted
// inputs (aim, trigger pulses, E held, grenade thrown) — never composited.
// When a shot's predicate holds, the sim freezes on that exact frame
// (stagingHold) so the screenshot catches even 60 ms effects (muzzle
// flash, hitmarker, tracer, grenade blast) exactly as rendered.
let stageVictim = null;
const stage = { name: shotName, phase: 'init', t0: 0, attempts: 0, ready: false, done: false };
let stagingHold = false;
let frames = 0;

// Burn-ammo aim points: solid cover the ray is guaranteed to stop on.
const wallPoint = new THREE.Vector3(18, 1.5, 2); // east ice cliff, from mid
const buyWallPoint = new THREE.Vector3(20, 2.5, 12); // east cliff, from spawn
// mid-east, in the frame's centre-left from the play position and clear
// of the east lane the victim rotates along, so the blast shows large
// without wounding (or stealing) the staged victim.
const midPoint = new THREE.Vector3(6, 1.2, -4); // grenade target, east of the Crevasse Bridge

function aimAt(target, pitchBias = 0) {
  const dx = target.x - player.state.position.x;
  const dy = target.y - (player.state.position.y + player.state.eye);
  const dz = target.z - player.state.position.z;
  const dist = Math.hypot(dx, dy, dz) || 1;
  player.state.yaw = Math.atan2(-dx, -dz);
  player.state.pitch = Math.max(-1.45, Math.min(1.45,
    Math.asin(Math.max(-1, Math.min(1, dy / dist))) + pitchBias));
}

function nearestCtBot() {
  let best = null;
  let bestD = Infinity;
  for (const bot of bots.list) {
    if (bot.team !== 'ct' || !bot.alive) continue;
    const dx = bot.group.position.x - player.state.position.x;
    const dz = bot.group.position.z - player.state.position.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = bot;
    }
  }
  return best;
}

function botHead(bot) {
  return tmpTarget.set(bot.group.position.x, bot.group.position.y + 1.53, bot.group.position.z);
}

function botTorso(bot) {
  return tmpTarget.set(bot.group.position.x, bot.group.position.y + 1.0, bot.group.position.z);
}

function skipBuyPhase() {
  if (state.phase === 'buy') {
    state.phase = 'live';
    state.timer = ROUND_TIME;
    hud.hideBuyMenu();
    hud.hideBanner();
  }
}

function hasLosTo(bot) {
  // Clean line of sight from the camera to the bot's head: the ray must
  // reach the bot without a wall, crate or the snowcat stopping it first.
  // The staged kill round is only fired with a clear lane, so it cannot
  // be wasted on cover the staging driver did not see.
  tmpTarget.set(bot.group.position.x, bot.group.position.y + 1.53, bot.group.position.z);
  const dx = tmpTarget.x - camera.position.x;
  const dy = tmpTarget.y - camera.position.y;
  const dz = tmpTarget.z - camera.position.z;
  const dist = Math.hypot(dx, dy, dz) || 1;
  shootDir.set(dx / dist, dy / dist, dz / dist);
  raycaster.set(camera.position, shootDir);
  raycaster.far = dist;
  const hits = raycaster.intersectObjects(world.shootables, false);
  const blocked = hits.length > 0 && hits[0].distance < dist - 0.15;
  debug.lastLos = { bot: bot.id, blocked, hitDist: hits.length ? +hits[0].distance.toFixed(1) : null, botDist: +dist.toFixed(1) };
  return !blocked;
}

function pickVictim() {
  // The staged victim must survive the hunt at 74 hp and live until the
  // final round: pick a defender one torso hit cannot kill (health > 78)
  // with a clean line of sight from the camera. Prefer the Observatory
  // Dome (A) holder: it rotates toward the shots along the east lane,
  // away from the friendly push down mid, so it stays alive until the
  // player's kill round; the Fuel Depot (B) holder rotates straight down
  // mid into the friendly attackers. Falls back to the nearest live
  // defender if every defender is already wounded or unsighted.
  let best = null;
  let bestScore = -Infinity;
  for (const bot of bots.list) {
    if (bot.team !== 'ct' || !bot.alive) continue;
    if (bot.health <= 78) continue;
    if (!hasLosTo(bot)) continue;
    const dx = bot.group.position.x - player.state.position.x;
    const dz = bot.group.position.z - player.state.position.z;
    const dist = Math.hypot(dx, dz);
    const site = bot.home.x > 5 ? 1000 : bot.home.x < -5 ? 500 : 0;
    const score = site - dist;
    if (score > bestScore) {
      bestScore = score;
      best = bot;
    }
  }
  return best || nearestCtBot();
}

function stageSetupPlay() {
  stage.t0 = simTime;
  stage.attempts += 1;
  stage.ready = false; // a ready set in a dying attempt must not leak here
  stageVictim = null;
  stage.thrown = false;
  rounds.startMatch();
  hud.hideOverlay(); // staging has no Play click; the menu overlay must go
  onBuy('grenade'); // real economy: a $300 frag from the $800 start
  skipBuyPhase();
  // East of mid: off the friendly bots' push path down x = 0, so no
  // teammate walks through the camera mid-take, and with a clear lane
  // down the east side to the Observatory Dome holder.
  player.state.position.set(10, 0, 8);
  player.state.velocity.set(0, 0, 0);
  player.state.yaw = 0;
  player.state.pitch = 0;
  stage.phase = 'hunt';
}

function stageSetupPlant() {
  stage.t0 = simTime;
  stage.attempts += 1;
  stage.ready = false; // a ready set in a dying attempt must not leak here
  rounds.startMatch();
  hud.hideOverlay(); // staging has no Play click; the menu overlay must go
  skipBuyPhase();
  player.state.position.set(12.5, 0, -8); // inside site A, Observatory Dome
  player.state.velocity.set(0, 0, 0);
  player.state.yaw = 0;
  player.state.pitch = 0;
  input.state.keys.add('KeyE'); // hold E: the real plant input path
  if (forceWhiteout) whiteout.force();
  stage.phase = 'planting';
}

function stageSetupBuy() {
  stage.t0 = simTime;
  stage.attempts += 1;
  stage.ready = false; // a ready set in a dying attempt must not leak here
  rounds.startMatch();
  hud.hideOverlay(); // staging has no Play click; the menu overlay must go
  skipBuyPhase();
  player.state.position.set(-6, 0, 15);
  player.state.velocity.set(0, 0, 0);
  stage.phase = 'burn';
}

function stageTick() {
  if (!staging || stage.done) return;
  if (shotName === 'start') return;
  const elapsed = simTime - stage.t0;

  // Death during a combat shot: retake the shot (max 3 attempts), then
  // accept the best frame we have rather than nothing.
  if (!playerAlive) {
    input.state.keys.delete('KeyE');
    if (stage.attempts < 3) {
      if (shotName === 'play') stageSetupPlay();
      else if (shotName === 'plant') stageSetupPlant();
      else if (shotName === 'buy') stageSetupBuy();
    } else {
      stage.ready = true;
    }
    return;
  }

  if (shotName === 'play') {
    // The victim is the defender wounded in 'hunt' (one pistol torso hit
    // leaves it at 74 hp); the final headshot finishes it, so the HEADSHOT
    // killfeed is fresh in the frozen frame instead of expired.
    const bot = stageVictim && stageVictim.alive ? stageVictim : nearestCtBot();
    if (stage.phase === 'hunt') {
      // Lock the victim on the first pick: re-picking after the wound
      // would switch to a fresh defender (the health filter excludes the
      // wounded one) and the final round could never kill it.
      if (!stageVictim || !stageVictim.alive) stageVictim = pickVictim();
      const target = stageVictim;
      if (!target) {
        stage.phase = 'burn';
        return;
      }
      stageVictim = target;
      // One torso hit wounds the victim to 74 hp (26 damage): enough that
      // it survives the friendly attackers' fire for the ~2 s the take
      // needs, while the final headshot (26 x 3 = 78) still finishes it.
      // A headshot here would leave it at 22 hp and the friendlies would
      // kill it before the blast window. A clean miss gets one retry.
      aimAt(botTorso(target));
      if (weapon.state.mag === 12 && weapon.ready()) wantShot = true;
      else if (weapon.state.mag === 11 && stageVictim.health === 100 && weapon.ready()) wantShot = true;
      else if (weapon.state.mag <= 11 && stageVictim.health < 100) stage.phase = 'burn';
      else if (weapon.state.mag <= 10) stage.phase = 'burn';
      else if (elapsed > 20) stage.phase = 'burn';
    } else if (stage.phase === 'burn') {
      // Throw the grenade first: its 1.6 s fuse then lands the blast just
      // as the burn ends, so the kill round fires before the friendly
      // attackers can finish the wounded victim themselves.
      if (weapon.state.grenades > 0 && !stage.thrown) {
        aimAt(midPoint);
        wantGrenade = true;
        stage.thrown = true;
        return;
      }
      if (stageVictim && stageVictim.alive) {
        const blastRecent = lastGrenadeBlastAt > 0 && simTime - lastGrenadeBlastAt < 0.35;
        if (blastRecent && hasLosTo(stageVictim)) {
          aimAt(botHead(stageVictim));
          if (weapon.state.mag > 0 && weapon.ready()) wantShot = true;
          if (weapon.state.mag <= 3) stage.phase = 'wait-blast';
          return;
        }
      }
      aimAt(wallPoint);
      if (weapon.state.mag > 3 && weapon.ready()) wantShot = true;
      else if (weapon.state.mag <= 3) stage.phase = 'wait-blast';
      if (elapsed > 25) stage.phase = 'wait-blast';
    } else if (stage.phase === 'wait-blast') {
      if (!stageVictim || !stageVictim.alive) {
        stage.phase = 'final';
        return;
      }
      aimAt(botHead(stageVictim));
      // The grenade fuse is 1.6 s and the blast shows for 0.35 s: fire
      // the kill round inside that window so blast, muzzle flash, and
      // the headshot kill all land in the same frozen frame. The victim
      // sits at ~74 hp, so the headshot (78) finishes it. The round is
      // only fired with a clean lane — a wall would eat it and the frame
      // with it.
      const blastRecent = lastGrenadeBlastAt > 0 && simTime - lastGrenadeBlastAt < 0.35;
      if (blastRecent && hasLosTo(stageVictim) && weapon.state.mag > 0 && weapon.ready()) wantShot = true;
      if (weapon.state.mag <= 2) stage.phase = 'final';
      else if (elapsed > 30) stage.phase = 'final';
    } else if (stage.phase === 'final') {
      // Freeze the moment the victim drops: muzzle flash, hitmarker and
      // a fresh HEADSHOT feed all in one frame. Mag 2 keeps the LOW AMMO
      // hint on screen; the 0/90 EMPTY state is proven in the buy shot.
      if (!stageVictim || !stageVictim.alive) {
        stage.ready = true;
        return;
      }
      aimAt(botHead(stageVictim));
      if (weapon.state.mag > 0 && weapon.ready() && hasLosTo(stageVictim)) wantShot = true;
      else if (weapon.state.mag === 0) stage.ready = true;
      else if (elapsed > 35) stage.ready = true;
    }
  } else if (shotName === 'plant') {
    const bot = nearestCtBot();
    if (bot) aimAt(botHead(bot), -0.18); // bot in frame, site ring at feet
    if (bomb.plantProgress >= 0.5 && bomb.plantProgress < 0.85 && bot) {
      stage.ready = true;
    } else if (bomb.status === 'planted' || elapsed > 15) {
      input.state.keys.delete('KeyE');
      if (stage.attempts < 3 && bomb.status !== 'planted') stageSetupPlant();
      else stage.ready = true;
    }
  } else if (shotName === 'buy') {
    if (stage.phase === 'burn') {
      aimAt(buyWallPoint);
      if (weapon.state.mag > 0 && weapon.ready()) wantShot = true;
      if (weapon.state.mag === 0) stage.phase = 'clear';
      else if (elapsed > 12) stage.phase = 'clear';
    } else if (stage.phase === 'clear') {
      for (const bot of bots.list) {
        if (bot.team === 'ct' && bot.alive) bots.damage(bot.torso, 999, 'torso');
      }
      stage.phase = 'wait-buy';
    } else if (stage.phase === 'wait-buy') {
      if (state.phase === 'buy' && isBuyOpen() && weapon.state.mag === 0) stage.ready = true;
      else if (elapsed > 25) stage.ready = true;
    }
  }
}

function stageCheck() {
  if (!staging || stage.done) return;
  if (shotName === 'start') {
    if (frames >= 2) {
      stage.done = true;
      window.__shotReady = true;
    }
    return;
  }
  if (stage.ready) {
    stagingHold = true;
    stage.done = true;
    window.__shotReady = true;
  }
}

// ---- fixed-step simulation ---------------------------------------------
function stepSim(dt) {
  simTime += dt;
  // Camera first: the staging driver reads camera.position for its
  // line-of-sight checks, and it must be the player eye — not the
  // (0,0,0) default it holds before the first updateCamera() runs.
  // The one-tick aim lag is negligible (a bot moves ~5 cm per tick).
  updateCamera();
  if (staging) stageTick();
  const look = input.takeLook();
  if (input.state.locked || staging) player.look(look.x, look.y);
  updateCamera();

  if (state.phase === 'menu' || state.phase === 'matchEnd') {
    // Menu vista: aurora keeps undulating behind the overlay.
  } else if (state.phase === 'roundEnd') {
    if (simTime - roundEndAt >= ROUND_END_PAUSE) rounds.startRound(state.round + 1);
  } else {
    // 'buy' or 'live'
    if (state.phase === 'live') {
      // Whiteout slows the player to x0.75 while it blows.
      player.step(dt, input.state.keys, whiteout.active ? 0.75 : 1);
      handlePressedKeys();
      handleFiring();
      if (wantGrenade) {
        wantGrenade = false;
        if (playerAlive && weapon.state.grenades > 0) {
          camera.getWorldDirection(shootDir);
          tmpTarget.copy(camera.position).addScaledVector(shootDir, 0.6);
          tmpTarget.y -= 0.1;
          if (weapon.throwGrenade(tmpTarget, shootDir)) audio.click();
        }
      }
      handlePlant();
    } else {
      player.step(dt, input.state.keys, 1);
      handlePressedKeys();
    }
    weapon.step(dt);
    whiteout.step(dt);

    // Shots heard this tick (player fire + bot fire) reach the bots as
    // events; the whiteout reaches them live through the state event.
    const eventsThisTick = shotEvents;
    shotEvents = [];
    const ctx = {
      playerPos: player.state.position,
      playerAlive,
      playerSpeed: player.groundSpeed(),
      bombPlanted: bomb.status === 'planted',
      bombSite: bomb.site,
      bombPos: bomb.position,
      events: eventsThisTick,
    };
    if (state.phase === 'live') bots.step(dt, simTime, ctx);

    const defusingBot = bomb.defusing;
    if (defusingBot && !prevDefusing) hud.feed('HALCYON IS DEFUSING THE THAW CORE');
    prevDefusing = defusingBot;
    bomb.step(dt, {
      playerPos: player.state.position,
      playerAlive,
      bots,
    });

    // A planted THAW CORE freezes the round timer: the round runs until
    // detonation or defuse, never a timeout win for the defenders.
    // (Hold it at 36 — above the 35 s bomb timer — whatever the round
    // timer read when the plant landed; the old `timer < 36` guard left
    // it counting down from ~89 and the round could end on time mid-plant.)
    if (bomb.status === 'planted') state.timer = 36;
    rounds.step(dt);
    if (state.phase === 'live') checkRoundEnd();

    const moved = Math.hypot(player.state.position.x - lastStepPos.x, player.state.position.z - lastStepPos.z);
    stepAcc += moved;
    lastStepPos.set(player.state.position.x, 0, player.state.position.z);
    if (stepAcc > 2.4 && player.groundSpeed() > 1 && player.state.onGround) {
      stepAcc = 0;
      audio.footstep();
    }

    if (detoAge >= 0) {
      detoAge += dt;
      const t = detoAge / 0.6;
      if (t >= 1) {
        detoMesh.visible = false;
        detoLight.intensity = 0;
        detoAge = -1;
      } else {
        detoMesh.visible = true;
        detoMesh.position.copy(detoPos);
        const s = 0.5 + t * 9;
        detoMesh.scale.set(s, s, s);
        detoMesh.material.opacity = 0.9 * (1 - t);
        detoLight.position.copy(detoPos);
        detoLight.position.y += 1;
        detoLight.intensity = 120 * (1 - t);
      }
    }
  }

  if (prevPhase !== state.phase) {
    if (state.phase === 'live') {
      if (isBuyOpen()) hud.hideBuyMenu();
      hud.hideBanner();
      const bannerEl = document.getElementById('banner');
      if (bannerEl) {
        bannerEl.style.top = '';
        bannerEl.style.zIndex = '';
      }
      if (!input.state.locked && !staging) hud.showOverlay('paused');
    }
    prevPhase = state.phase;
  }
  syncHud();
  input.clearPressed();
}

// ---- render loop --------------------------------------------------------
let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (!stagingHold) {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 6) {
      stepSim(STEP);
      acc -= STEP;
      n += 1;
    }
    if (n === 6) acc = 0;
  }
  animateAurora(simTime);
  renderer.render(scene, camera);
  frames += 1;
  if (staging) stageCheck();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function requestLockSafe() {
  try {
    const p = input.requestLock();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (err) { /* pointer lock unavailable; the game still plays */ }
}

renderer.domElement.addEventListener('click', () => {
  audio.unlock();
  if ((state.phase === 'live' || state.phase === 'buy') && !input.state.locked && !isBuyOpen()) {
    requestLockSafe();
  }
});

hud.onPlay(() => {
  audio.unlock();
  if (state.phase === 'menu' || state.phase === 'matchEnd') {
    hud.hideOverlay();
    rounds.startMatch();
  } else {
    hud.hideOverlay();
    requestLockSafe();
  }
});

// ---- init ---------------------------------------------------------------
bots.reset(1);
bomb.reset();
weapon.setWeapon('pistol');
weapon.refill();
hud.setHealth(100);
hud.setAmmo(WEAPONS.pistol.mag, WEAPONS.pistol.reserve);
hud.setMoney(state.money);
hud.setTimer(ROUND_TIME);
hud.setRound(1);
hud.setScore(0, 0);
hud.setWeaponName(WEAPONS.pistol.name);
hud.setBomb('');
hud.showOverlay('start');

if (staging) {
  if (shotName === 'start') {
    stage.phase = 'start';
  } else if (shotName === 'play') stageSetupPlay();
  else if (shotName === 'plant') stageSetupPlant();
  else if (shotName === 'buy') stageSetupBuy();
}
updateCamera(); // valid eye position before the first staged tick reads it

window.__whiteout = { state, bots, weapon, player, bomb, rounds, whiteout, hud, input, world, camera, renderer, stage, debug, get simTime() { return simTime; } };
window.__shotReady = false;
requestAnimationFrame(frame);
