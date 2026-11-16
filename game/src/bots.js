// WHITEOUT — bots: 5 Halcyon defenders (ct, blue) vs 2 friendly Drift attackers (t, red).
// One job: move, see, shoot, and react — waypoint routes, hold positions, sight and
// sound reactions, plus the THAW CORE converge/defuse behaviour and the WHITEOUT hold.
// Defenders hold site/mid waypoints, rotate toward 'shot' sounds, and converge on a
// planted THAW CORE to defuse it. Friendly attackers push a site along waypoints.
// During a WHITEOUT bots HOLD position, reaction time doubles, and the Crevasse Bridge
// (mid) is a temporary no-go area — they repath around it.
import * as THREE from 'three';

const BOT_HEALTH = 100;
const WALK_SPEED = 3.2;
const REACTION_MIN = 0.4;
const REACTION_MAX = 0.8;
const BOT_SHOT_DAMAGE = 6;
const BOT_VS_BOT_DAMAGE = 20;
const BURST_MIN = 3;
const BURST_MAX = 5;
const SHOT_GAP = 0.12;
const TRACER_COUNT = 16;
const TRACER_LIFE = 0.45;
const HEARING_RANGE = 28;
const VISION_RANGE = 42;
const HALF_WIDTH = 0.35;
const BOT_HEIGHT = 1.8;
const MID_BAND = 5;

const TEAM_COLORS = { ct: 0x3f8cff, t: 0xe0533d };

function isMidNode(node) {
  if (/mid|bridge|crevasse/i.test(node.id)) return true;
  return Math.abs(node.pos.x) < MID_BAND && Math.abs(node.pos.z) < MID_BAND;
}

export function createBots(scene, world, hooks, state) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 60;
  const tmpOrigin = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();
  const tmpTarget = new THREE.Vector3();
  const tmpBox = new THREE.Box3();
  const tmpMin = new THREE.Vector3();
  const tmpMax = new THREE.Vector3();

  // Waypoint graph: id -> neighbour ids, built once from world.waypoints.
  const adjacency = new Map();
  const nodeById = new Map();
  const midNodeIds = new Set();
  for (const node of world.waypoints.nodes) {
    nodeById.set(node.id, node);
    adjacency.set(node.id, []);
    if (isMidNode(node)) midNodeIds.add(node.id);
  }
  for (const [a, b] of world.waypoints.edges) {
    if (adjacency.has(a) && adjacency.has(b)) {
      adjacency.get(a).push(b);
      adjacency.get(b).push(a);
    }
  }

  // Shared geometry/materials — no per-bot allocation beyond the group itself.
  const torsoGeo = new THREE.BoxGeometry(0.52, 0.78, 0.3);
  const headGeo = new THREE.SphereGeometry(0.16, 16, 12);
  const gunGeo = new THREE.BoxGeometry(0.08, 0.1, 0.62);
  const materials = {};
  for (const team of ['ct', 't']) {
    materials[team] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(TEAM_COLORS[team]),
      roughness: 0.6,
      metalness: 0.05,
    });
  }
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x141a24, roughness: 0.7 });

  // Tracer pool: thin fading lines from muzzle to hit point, reused, never allocated per shot.
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo, mat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerCursor = 0;

  function fireTracer(from, to) {
    const tracer = tracers[tracerCursor];
    tracerCursor = (tracerCursor + 1) % TRACER_COUNT;
    const pos = tracer.line.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, to.x, to.y, to.z);
    pos.needsUpdate = true;
    tracer.line.visible = true;
    tracer.line.material.opacity = 0.9;
    tracer.life = TRACER_LIFE;
  }

  function nearestNode(pos, avoidMid) {
    let best = null;
    let bestDist = Infinity;
    for (const node of world.waypoints.nodes) {
      if (avoidMid && midNodeIds.has(node.id)) continue;
      const dx = node.pos.x - pos.x;
      const dz = node.pos.z - pos.z;
      const dist = dx * dx + dz * dz;
      if (dist < bestDist) {
        bestDist = dist;
        best = node;
      }
    }
    return best;
  }

  // BFS over the waypoint graph; returns an array of node positions to walk through.
  function findPath(fromPos, toPos, avoidMid) {
    const start = nearestNode(fromPos, avoidMid);
    const goal = nearestNode(toPos, avoidMid);
    if (!start || !goal) return [toPos.clone()];
    if (start.id === goal.id) return [goal.pos.clone()];
    const prev = new Map();
    const queue = [start.id];
    prev.set(start.id, null);
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === goal.id) break;
      for (const next of adjacency.get(current) || []) {
        if (prev.has(next)) continue;
        if (avoidMid && midNodeIds.has(next)) continue;
        prev.set(next, current);
        queue.push(next);
      }
    }
    if (!prev.has(goal.id)) return [goal.pos.clone()];
    const ids = [];
    let cursor = goal.id;
    while (cursor !== null) {
      ids.unshift(cursor);
      cursor = prev.get(cursor);
    }
    return ids.map((id) => nodeById.get(id).pos.clone());
  }

  function blockedAt(x, z) {
    tmpMin.set(x - HALF_WIDTH, 0, z - HALF_WIDTH);
    tmpMax.set(x + HALF_WIDTH, BOT_HEIGHT, z + HALF_WIDTH);
    tmpBox.min.copy(tmpMin);
    tmpBox.max.copy(tmpMax);
    for (let i = 0; i < world.colliders.length; i += 1) {
      if (tmpBox.intersectsBox(world.colliders[i])) return true;
    }
    return false;
  }

  function moveBot(bot, dt, speed) {
    if (!bot.path || bot.pathIndex >= bot.path.length) return;
    const target = bot.path[bot.pathIndex];
    const dx = target.x - bot.group.position.x;
    const dz = target.z - bot.group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.35) {
      bot.pathIndex += 1;
      return;
    }
    const stepLen = Math.min(speed * dt, dist);
    const nx = bot.group.position.x + (dx / dist) * stepLen;
    const nz = bot.group.position.z + (dz / dist) * stepLen;
    bot.yaw = Math.atan2(dx, dz);
    bot.group.rotation.y = bot.yaw;
    // One axis at a time, same AABB collision as the player.
    if (!blockedAt(nx, bot.group.position.z)) bot.group.position.x = nx;
    if (!blockedAt(bot.group.position.x, nz)) bot.group.position.z = nz;
  }

  // Line of sight from `from` to `to`: clear when no shootable wall is in between.
  function hasLineOfSight(from, to) {
    tmpDir.subVectors(to, from);
    const dist = tmpDir.length();
    if (dist < 0.01 || dist > VISION_RANGE) return false;
    tmpDir.multiplyScalar(1 / dist);
    tmpOrigin.copy(from);
    raycaster.set(tmpOrigin, tmpDir);
    raycaster.far = dist;
    const hits = raycaster.intersectObjects(world.shootables, false);
    return hits.length === 0 || hits[0].distance >= dist - 0.15;
  }

  function makeBot(id, team, spawn) {
    const group = new THREE.Group();
    group.position.copy(spawn);
    const torso = new THREE.Mesh(torsoGeo, materials[team]);
    torso.position.y = 1.0;
    torso.castShadow = true;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeo, materials[team]);
    head.position.y = 1.55;
    head.castShadow = true;
    head.userData.part = 'head';
    const gun = new THREE.Mesh(gunGeo, darkMaterial);
    gun.position.set(0.22, 1.05, 0.3);
    group.add(torso, head, gun);
    scene.add(group);
    const bot = {
      id, team, group, torso, head,
      health: BOT_HEALTH, alive: true, yaw: 0,
      mode: 'hold', waypoint: null,
      reaction: 0, burstLeft: 0, nextShot: 0,
      home: spawn.clone(), path: null, pathIndex: 0,
      target: null, targetIsPlayer: false, targetSeenAt: -1,
      cooldownUntil: 0, fall: 0, thinkAt: 0, investigate: null,
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    return bot;
  }

  const list = [];
  const hitMeshes = [];
  for (let i = 0; i < 5; i += 1) {
    const bot = makeBot(i, 'ct', world.spawns.ct[i]);
    list.push(bot);
    hitMeshes.push(bot.torso, bot.head);
  }
  for (let i = 0; i < 2; i += 1) {
    const bot = makeBot(5 + i, 't', world.spawns.t[i]);
    list.push(bot);
    hitMeshes.push(bot.torso, bot.head);
  }

  let whiteoutActive = false;
  const api = {
    list,
    hitMeshes,

    setWhiteout(active) {
      whiteoutActive = active;
    },

    damage(mesh, amount, part) {
      const bot = mesh.userData.bot;
      if (!bot || !bot.alive) return false;
      bot.health -= amount;
      if (bot.health > 0) return false;
      bot.alive = false;
      bot.health = 0;
      bot.fall = 0;
      bot.target = null;
      bot.burstLeft = 0;
      if (hooks.onBotKilled) hooks.onBotKilled(bot, true);
      return true;
    },

    aliveCount(team) {
      let count = 0;
      for (const bot of list) if (bot.alive && bot.team === team) count += 1;
      return count;
    },

    aimPoint(i) {
      const bot = list[i % list.length];
      tmpTarget.set(bot.group.position.x, bot.group.position.y + 1.0, bot.group.position.z);
      return tmpTarget.clone();
    },

    reset(roundNum) {
      const site = roundNum % 2 === 1 ? 'A' : 'B';
      for (const bot of list) {
        const spawn = bot.team === 'ct'
          ? world.spawns.ct[bot.id]
          : world.spawns.t[bot.id - 5];
        bot.group.position.copy(spawn);
        bot.group.rotation.set(0, 0, 0);
        bot.health = BOT_HEALTH;
        bot.alive = true;
        bot.fall = 0;
        bot.target = null;
        bot.burstLeft = 0;
        bot.nextShot = 0;
        bot.cooldownUntil = 0;
        bot.path = null;
        bot.pathIndex = 0;
        bot.investigate = null;
        bot.mode = bot.team === 'ct' ? 'hold' : 'push';
        bot.waypoint = null;
        if (bot.team === 'ct') {
          // Defenders spread across the two sites and mid: hold positions.
          const home = bot.id % 3 === 0 ? world.sites.A.center
            : bot.id % 3 === 1 ? world.sites.B.center
              : new THREE.Vector3(0, 0, 0);
          bot.home.copy(home);
          bot.waypoint = nearestNode(home, false);
        } else {
          bot.home.copy(world.sites[site].center);
        }
      }
      // Friendly attackers push the round's site; defenders walk to their hold posts.
      for (const bot of list) {
        if (bot.team === 't') {
          bot.path = findPath(bot.group.position, world.sites[site].center, false);
          bot.pathIndex = 0;
        } else if (bot.waypoint) {
          bot.path = findPath(bot.group.position, bot.waypoint.pos, false);
          bot.pathIndex = 0;
        }
      }
    },

    step(dt, time, ctx) {
      const reactionMul = whiteoutActive ? 2 : 1;
      const speedMul = whiteoutActive ? 0.75 : 1;
      const playerPos = ctx.playerPos;
      const bombPlanted = !!ctx.bombPlanted;
      const bombSite = ctx.bombSite || null;
      const bombPos = ctx.bombPos || null;

      // Tracers fade out.
      for (const tracer of tracers) {
        if (tracer.life <= 0) continue;
        tracer.life -= dt;
        if (tracer.life <= 0) {
          tracer.line.visible = false;
          tracer.line.material.opacity = 0;
        } else {
          tracer.line.material.opacity = (tracer.life / TRACER_LIFE) * 0.9;
        }
      }

      for (const bot of list) {
        if (!bot.alive) {
          // Fallen bot tips over once and stays down until reset.
          if (bot.fall < 1) {
            bot.fall = Math.min(1, bot.fall + dt / 0.4);
            bot.group.rotation.x = -bot.fall * 1.45;
            bot.group.position.y = -bot.fall * 0.08;
          }
          continue;
        }

        // THAW CORE planted: defenders converge on the site to defuse; attackers hold it.
        if (bombPlanted && bombSite) {
          const siteCenter = world.sites[bombSite].center;
          if (bot.team === 'ct') {
            if (bot.mode !== 'defuse') {
              bot.mode = 'defuse';
              bot.path = findPath(bot.group.position, siteCenter, whiteoutActive);
              bot.pathIndex = 0;
            }
          } else if (bot.mode !== 'hold') {
            bot.mode = 'hold';
            bot.path = findPath(bot.group.position, siteCenter, whiteoutActive);
            bot.pathIndex = 0;
          }
        }

        // WHITEOUT: hold position, no pushing or rotating. Repath around mid if needed.
        if (whiteoutActive) {
          if (bot.path && bot.path.some((p) => Math.abs(p.x) < MID_BAND && Math.abs(p.z) < MID_BAND)) {
            const dest = bot.mode === 'defuse' && bombSite
              ? world.sites[bombSite].center : bot.home;
            bot.path = findPath(bot.group.position, dest, true);
            bot.pathIndex = 0;
          }
        } else {
          // Hear 'shot' sounds: defenders rotate toward the noise.
          if (bot.team === 'ct' && ctx.events) {
            for (const evt of ctx.events) {
              if (evt.type !== 'shot' || !evt.pos) continue;
              const dx = evt.pos.x - bot.group.position.x;
              const dz = evt.pos.z - bot.group.position.z;
              if (dx * dx + dz * dz > HEARING_RANGE * HEARING_RANGE) continue;
              if (bot.mode === 'hold') {
                bot.mode = 'rotate';
                bot.investigate = evt.pos.clone();
                bot.path = findPath(bot.group.position, evt.pos, false);
                bot.pathIndex = 0;
              }
            }
          }
          // Movement: walk the waypoint path unless holding a post.
          const moving = bot.mode === 'push' || bot.mode === 'rotate' || bot.mode === 'defuse';
          if (moving) moveBot(bot, dt, WALK_SPEED * speedMul);
          if (bot.mode === 'rotate' && (!bot.path || bot.pathIndex >= bot.path.length)) {
            bot.mode = 'hold';
            bot.investigate = null;
          }
        }

        // Targeting, throttled per bot so the LOS raycast is not every frame for all.
        if (time < bot.thinkAt) continue;
        bot.thinkAt = time + 0.25 + bot.id * 0.03;
        tmpOrigin.set(bot.group.position.x, bot.group.position.y + 1.4, bot.group.position.z);

        // Pick the nearest visible enemy: the player, or an enemy bot.
        let best = null;
        let bestDist = Infinity;
        // The player is an attacker ('t'): only defenders ('ct') hunt the player.
        if (bot.team === 'ct' && ctx.playerAlive && playerPos) {
          tmpTarget.set(playerPos.x, playerPos.y + 1.2, playerPos.z);
          const d = tmpOrigin.distanceTo(tmpTarget);
          if (d < VISION_RANGE && hasLineOfSight(tmpOrigin, tmpTarget)) {
            best = { isPlayer: true, pos: tmpTarget.clone(), dist: d };
            bestDist = d;
          }
        }
        for (const other of list) {
          if (!other.alive || other.team === bot.team) continue;
          tmpTarget.set(other.group.position.x, other.group.position.y + 1.1, other.group.position.z);
          const d = tmpOrigin.distanceTo(tmpTarget);
          if (d >= bestDist || d > VISION_RANGE) continue;
          if (!hasLineOfSight(tmpOrigin, tmpTarget)) continue;
          best = { isPlayer: false, bot: other, pos: tmpTarget.clone(), dist: d };
          bestDist = d;
        }

        if (!best) {
          bot.target = null;
          bot.targetIsPlayer = false;
          bot.burstLeft = 0;
          continue;
        }
        const targetChanged = best.isPlayer ? !bot.targetIsPlayer : bot.target !== best.bot;
        if (targetChanged) {
          // Reaction: a fresh target is only engaged after 0.4–0.8 s (doubled in a whiteout).
          bot.targetSeenAt = time;
          bot.reactionDelay = (REACTION_MIN + Math.random() * (REACTION_MAX - REACTION_MIN)) * reactionMul;
        }
        bot.target = best.isPlayer ? null : best.bot;
        bot.targetIsPlayer = best.isPlayer;
        bot.targetPos = best.pos;

        if (time - bot.targetSeenAt < bot.reactionDelay) continue;
        if (time < bot.cooldownUntil) continue;

        // Burst fire with spread; tracers show every shot.
        if (bot.burstLeft <= 0) {
          bot.burstLeft = BURST_MIN + Math.floor(Math.random() * (BURST_MAX - BURST_MIN + 1));
          bot.nextShot = time;
        }
        if (time < bot.nextShot) continue;
        bot.nextShot = time + SHOT_GAP;
        bot.burstLeft -= 1;
        if (bot.burstLeft <= 0) bot.cooldownUntil = time + 0.6 + Math.random() * 0.5;

        // Face the target and fire.
        const aim = bot.targetPos;
        const dx = aim.x - bot.group.position.x;
        const dz = aim.z - bot.group.position.z;
        bot.yaw = Math.atan2(dx, dz);
        bot.group.rotation.y = bot.yaw;
        tmpOrigin.set(
          bot.group.position.x + Math.sin(bot.yaw) * 0.3,
          bot.group.position.y + 1.35,
          bot.group.position.z + Math.cos(bot.yaw) * 0.3,
        );
        const spread = 0.03 + bestDist * 0.0012;
        tmpDir.set(
          (aim.x - tmpOrigin.x) / bestDist + (Math.random() * 2 - 1) * spread,
          (aim.y - tmpOrigin.y) / bestDist + (Math.random() * 2 - 1) * spread,
          (aim.z - tmpOrigin.z) / bestDist + (Math.random() * 2 - 1) * spread,
        ).normalize();
        raycaster.set(tmpOrigin, tmpDir);
        raycaster.far = 70;
        const wallHits = raycaster.intersectObjects(world.shootables, false);
        const wallDist = wallHits.length > 0 ? wallHits[0].distance : Infinity;
        const hitChance = Math.max(0.2, 0.55 - bestDist * 0.01);
        const muzzle = tmpOrigin.clone();
        if (wallDist < bestDist && Math.random() < 0.7) {
          // Shot stopped by cover: tracer ends at the wall.
          tmpTarget.copy(tmpOrigin).addScaledVector(tmpDir, wallDist);
          fireTracer(muzzle, tmpTarget);
        } else if (Math.random() < hitChance) {
          fireTracer(muzzle, aim);
          if (best.isPlayer) {
            if (hooks.damagePlayer) hooks.damagePlayer(BOT_SHOT_DAMAGE, bot);
          } else {
            const victim = best.bot;
            victim.health -= BOT_VS_BOT_DAMAGE;
            if (victim.health <= 0 && victim.alive) {
              victim.alive = false;
              victim.health = 0;
              victim.fall = 0;
              victim.target = null;
              victim.burstLeft = 0;
              if (hooks.onBotKilled) hooks.onBotKilled(victim, false);
            }
          }
        } else {
          // Miss: tracer flies past the target.
          tmpTarget.copy(tmpOrigin).addScaledVector(tmpDir, bestDist + 4);
          fireTracer(muzzle, tmpTarget);
        }
        if (hooks.onShot) hooks.onShot(bot.group.position);
      }
    },
  };

  // Bots react to the WHITEOUT through the state event when a state store is passed in.
  if (state && typeof state.on === 'function') {
    state.on('whiteout', (data) => {
      if (data) api.setWhiteout(!!data.active);
    });
  }

  return api;
}
