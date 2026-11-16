// WHITEOUT — single state store + tiny event emitter.
// One job: hold the match state and let modules talk through named events.
// Phases: 'menu' | 'buy' | 'live' | 'roundEnd' | 'matchEnd'.
// Events: 'shot' (pos), 'kill', 'roundEnd', 'bombPlanted', 'bombDefused',
// 'explosion', 'damage', 'whiteout' ({ active: boolean }).
export function createGameState() {
  const listeners = new Map();

  const state = {
    phase: 'menu',
    round: 0,
    wins: { ct: 0, t: 0 },
    money: 800,
    timer: 0,
    streak: 0,
    kills: { ct: 0, t: 0 },

    on(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, []);
      listeners.get(evt).push(fn);
    },

    emit(evt, data) {
      const handlers = listeners.get(evt);
      if (!handlers) return;
      for (let i = 0; i < handlers.length; i += 1) handlers[i](data);
    },
  };

  return state;
}
