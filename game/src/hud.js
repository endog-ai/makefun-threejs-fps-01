// The DOM HUD: crosshair, hit marker, health/ammo/timer/score, kill feed, banners,
// buy menu and the overlay panels. It never touches the simulation; main.js pushes
// numbers in and reads the play callback out. Copy says THAW CORE, never just "bomb".
const COPY = {
  start: {
    title: 'WHITEOUT',
    copy: 'A round-based tactical FPS at Halcyon Station, an Antarctic research outpost under a polar-night aurora. Plant the THAW CORE at the Observatory Dome or the Fuel Depot — and mind the blizzard: every whiteout cuts visibility to a few metres.',
    action: 'Click to play',
  },
  paused: {
    title: 'Paused',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
};

export function createHud() {
  const overlay = document.getElementById('overlay');
  const title = document.getElementById('overlay-title');
  const copy = document.getElementById('overlay-copy');
  const play = document.getElementById('play');
  const ammo = document.getElementById('ammo');
  const ammoMag = document.getElementById('ammo-mag');
  const ammoReserve = document.getElementById('ammo-reserve');
  const scoreCt = document.getElementById('score-ct');
  const scoreT = document.getElementById('score-t');
  const timerEl = document.getElementById('timer');
  const roundLabel = document.getElementById('round-label');
  const health = document.getElementById('health');
  const healthValue = document.getElementById('health-value');
  const healthBar = document.querySelector('#health-bar i');
  const moneyEl = document.getElementById('money');
  const weaponNameEl = document.getElementById('weapon-name');
  const reloadHint = document.getElementById('reload-hint');
  const bombStatus = document.getElementById('bomb-status');
  const bombText = document.getElementById('bomb-text');
  const bombBar = document.getElementById('bomb-bar');
  const feedEl = document.getElementById('feed');
  const banner = document.getElementById('banner');
  const bannerTitle = document.getElementById('banner-title');
  const bannerSub = document.getElementById('banner-sub');
  const buyMenu = document.getElementById('buy-menu');
  const buyItems = document.getElementById('buy-items');
  const buyMoney = document.getElementById('buy-money');
  const whiteoutEl = document.getElementById('whiteout-indicator');
  const hitmarker = document.getElementById('hitmarker');

  let hitTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let lastCt = -1;
  let lastT = -1;
  let lastHealth = -1;
  let lastMoney = -1;
  let lastTimer = -1;
  let lastRound = -1;
  let lastWeapon = '';
  let lastBomb = '';

  function formatMoney(m) {
    return '$' + Math.floor(m).toLocaleString('en-US');
  }

  return {
    setAmmo(mag, reserve) {
      if (mag === lastMag && reserve === lastReserve) return;
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = '/ ' + reserve;
      ammo.classList.toggle('empty', mag === 0);
      reloadHint.hidden = mag !== 0;
    },
    setScore(ct, t) {
      if (ct === lastCt && t === lastT) return;
      lastCt = ct;
      lastT = t;
      scoreCt.textContent = String(ct);
      scoreT.textContent = String(t);
    },
    setHealth(hp) {
      const h = Math.max(0, Math.round(hp));
      if (h === lastHealth) return;
      lastHealth = h;
      healthValue.textContent = String(h);
      healthBar.style.width = h + '%';
      health.classList.toggle('low', h <= 30);
    },
    setMoney(m) {
      if (m === lastMoney) return;
      lastMoney = m;
      moneyEl.textContent = formatMoney(m);
    },
    setTimer(s) {
      const t = Math.max(0, Math.ceil(s));
      if (t === lastTimer) return;
      lastTimer = t;
      const min = Math.floor(t / 60);
      const sec = String(t % 60).padStart(2, '0');
      timerEl.textContent = min + ':' + sec;
    },
    setRound(n) {
      if (n === lastRound) return;
      lastRound = n;
      roundLabel.textContent = 'Round ' + n;
    },
    setWeaponName(name) {
      if (name === lastWeapon) return;
      lastWeapon = name;
      weaponNameEl.textContent = name;
    },
    setBomb(text, progress) {
      if (text === lastBomb && progress === undefined) return;
      lastBomb = text;
      if (!text) {
        bombStatus.hidden = true;
        return;
      }
      bombStatus.hidden = false;
      bombText.textContent = text;
      if (progress !== undefined) {
        bombBar.style.width = Math.round(Math.max(0, Math.min(1, progress)) * 100) + '%';
      }
    },
    feed(text) {
      const row = document.createElement('div');
      row.innerHTML = text;
      feedEl.appendChild(row);
      while (feedEl.children.length > 5) feedEl.removeChild(feedEl.firstChild);
      setTimeout(() => {
        if (row.parentNode === feedEl) feedEl.removeChild(row);
      }, 6000);
    },
    showBanner(bannerTitleText, sub) {
      bannerTitle.textContent = bannerTitleText;
      bannerSub.textContent = sub || '';
      banner.hidden = false;
    },
    hideBanner() {
      banner.hidden = true;
    },
    showBuyMenu(items, money, onBuy) {
      buyMoney.textContent = formatMoney(money);
      buyItems.replaceChildren();
      items.forEach((item, index) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-row';
        row.disabled = item.price > money || item.owned === true;
        const key = document.createElement('span');
        key.className = 'buy-key';
        key.textContent = item.key || String(index + 1);
        const name = document.createElement('span');
        name.className = 'buy-name';
        name.textContent = item.name;
        const price = document.createElement('span');
        price.className = 'buy-price';
        price.textContent = item.price === 0 ? 'OWNED' : formatMoney(item.price);
        row.append(key, name, price);
        row.addEventListener('click', () => onBuy(item.id));
        buyItems.appendChild(row);
      });
      buyMenu.hidden = false;
    },
    hideBuyMenu() {
      buyMenu.hidden = true;
    },
    showOverlay(mode, data) {
      if (mode === 'start' || mode === 'paused') {
        const text = COPY[mode];
        title.textContent = text.title;
        copy.textContent = text.copy;
        play.textContent = text.action;
      } else if (mode === 'roundEnd') {
        const winner = data && data.winner === 't' ? 'Drift' : 'Halcyon';
        title.textContent = winner + ' takes round ' + (data ? data.round : '');
        copy.textContent = (data && data.reason ? data.reason + ' ' : '') +
          'Score — Drift ' + (data ? data.scoreT : 0) + ' : ' + (data ? data.scoreCt : 0) + ' Halcyon.';
        play.textContent = 'Next round';
      } else if (mode === 'matchEnd') {
        const winner = data && data.winner === 't' ? 'Drift' : 'Halcyon';
        title.textContent = winner + ' wins the match';
        copy.textContent = 'Final score — Drift ' + (data ? data.scoreT : 0) + ' : ' +
          (data ? data.scoreCt : 0) + ' Halcyon. The THAW CORE stays frozen tonight.';
        play.textContent = 'Play again';
      }
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', Boolean(killed));
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.classList.remove('kill');
      }, holdMs);
    },
    setWhiteout(active) {
      whiteoutEl.hidden = !active;
    },
  };
}
