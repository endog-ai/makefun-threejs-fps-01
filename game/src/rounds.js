// WHITEOUT — rounds and economy.
// One job: run the match clock (buy phase -> live round -> round end) and the money.
// First to 5 rounds wins the match (max 9 rounds). Attackers ('t', the player side) win
// a round by detonating the THAW CORE or eliminating all defenders; defenders ('ct') win
// by elimination, by defusing the THAW CORE, or by running the round timer out.
// Prices match weapon.js: pistol 0, smg 1500, rifle 2700, grenade 300, armor 650.

export const BUY_TIME = 12;
export const ROUND_TIME = 100;
export const WIN_ROUNDS = 5;
export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const LOSS_STREAK_BONUS = 500;
export const LOSS_REWARD_CAP = 3400;

const PRICES = { pistol: 0, smg: 1500, rifle: 2700, grenade: 300, armor: 650 };
const GRENADE_MAX = 2;

export function createRounds(state, events, hooks) {
  const emit = events && typeof events.emit === 'function' ? events : state;
  let grenadesBought = 0;
  let armorBought = false;
  let roundEnded = false;

  function pay(amount) {
    state.money -= amount;
    if (hooks.onMoneyChange) hooks.onMoneyChange(state.money);
  }

  const rounds = {
    step(dt) {
      if (state.phase === 'buy') {
        state.timer -= dt;
        if (state.timer <= 0) {
          state.phase = 'live';
          state.timer = ROUND_TIME;
        }
        return;
      }
      if (state.phase !== 'live') return;
      // The THAW CORE timer owns the round once planted — the round clock only ends
      // the round on timeout while the core is still carried.
      const planted = (hooks.isBombPlanted && hooks.isBombPlanted())
        || (typeof state.bombPlanted === 'boolean' && state.bombPlanted);
      state.timer -= dt;
      if (state.timer <= 0 && !planted) {
        rounds.endRound('ct', 'Time expired — the THAW CORE was never planted');
      }
    },

    startMatch() {
      state.wins.ct = 0;
      state.wins.t = 0;
      state.money = START_MONEY;
      state.streak = 0;
      state.kills.ct = 0;
      state.kills.t = 0;
      state.round = 0;
      rounds.startRound(1);
    },

    startRound(n) {
      state.round = n;
      state.phase = 'buy';
      state.timer = BUY_TIME;
      grenadesBought = 0;
      armorBought = false;
      roundEnded = false;
      if (hooks.onRoundStart) hooks.onRoundStart(n);
    },

    endRound(winner, reason) {
      if (roundEnded || state.phase === 'matchEnd') return;
      roundEnded = true;
      state.wins[winner] += 1;
      // Economy: winners take the round win reward; losers take the loss reward,
      // +500 per consecutive loss for the player side, capped at 3400.
      if (winner === 't') {
        state.money += WIN_REWARD;
        state.streak = 0;
      } else {
        const lossReward = Math.min(
          LOSS_REWARD + state.streak * LOSS_STREAK_BONUS,
          LOSS_REWARD_CAP,
        );
        state.money += lossReward;
        state.streak += 1;
      }
      if (hooks.onMoneyChange) hooks.onMoneyChange(state.money);
      state.phase = 'roundEnd';
      state.timer = 0;
      emit.emit('roundEnd', { winner, reason, round: state.round });
      if (hooks.onRoundEnd) hooks.onRoundEnd(winner, reason);
      if (state.wins[winner] >= WIN_ROUNDS) {
        state.phase = 'matchEnd';
        if (hooks.onMatchEnd) hooks.onMatchEnd(winner);
      }
    },

    // +300 for a kill; main.js calls this when a bot dies to the player.
    addKillReward() {
      state.money += KILL_REWARD;
      if (hooks.onMoneyChange) hooks.onMoneyChange(state.money);
    },

    buy(itemId) {
      const price = PRICES[itemId];
      let ok = false;
      if (price === undefined) {
        ok = false;
      } else if (state.phase !== 'buy') {
        ok = false;
      } else if (itemId === 'grenade' && grenadesBought >= GRENADE_MAX) {
        ok = false;
      } else if (itemId === 'armor' && armorBought) {
        ok = false;
      } else if (state.money < price) {
        ok = false;
      } else {
        pay(price);
        if (itemId === 'grenade') grenadesBought += 1;
        if (itemId === 'armor') armorBought = true;
        ok = true;
      }
      if (hooks.onBuyResult) hooks.onBuyResult(itemId, ok);
      return ok;
    },
  };

  return rounds;
}
