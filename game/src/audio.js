// Synthesized WebAudio only — no audio files, no network. Every method no-ops
// safely when the context is unavailable. The whiteout wind howl rises at
// whiteoutStart and falls at whiteoutEnd; while it blows, shots are muffled.
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let wind = null;
  let muffled = false;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const len = Math.floor(ctx.sampleRate * 1.5);
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    } catch (err) {
      ctx = null;
    }
    return ctx;
  }

  function tone(freq, dur, type, gain, slideTo, delay = 0) {
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noiseHit(dur, filterFreq, gain, filterType = 'lowpass', delay = 0) {
    if (!ctx || !noiseBuf) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = muffled ? Math.min(filterFreq, 700) : filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(muffled ? gain * 0.45 : gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  const SHOT_KIND = {
    pistol: { dur: 0.09, freq: 1800, gain: 0.5, thump: 140 },
    smg: { dur: 0.07, freq: 2200, gain: 0.4, thump: 160 },
    rifle: { dur: 0.14, freq: 1200, gain: 0.6, thump: 110 },
  };

  return {
    unlock() {
      const c = ensure();
      if (c && c.state === 'suspended') c.resume().catch(() => {});
    },
    shot(kind) {
      if (!ensure()) return;
      const s = SHOT_KIND[kind] || SHOT_KIND.rifle;
      noiseHit(s.dur, s.freq, s.gain);
      tone(s.thump, s.dur + 0.04, 'sine', 0.5, 50);
    },
    reload() {
      if (!ensure()) return;
      tone(520, 0.06, 'square', 0.12);
      noiseHit(0.05, 3000, 0.1, 'highpass', 0.08);
      tone(380, 0.06, 'square', 0.12, undefined, 0.22);
      noiseHit(0.05, 3000, 0.12, 'highpass', 0.3);
    },
    hit() {
      if (!ensure()) return;
      tone(1200, 0.06, 'square', 0.18, 900);
    },
    kill() {
      if (!ensure()) return;
      tone(1200, 0.06, 'square', 0.2, 900);
      tone(1600, 0.1, 'square', 0.2, 1200, 0.07);
    },
    dryfire() {
      if (!ensure()) return;
      tone(900, 0.04, 'square', 0.1, 600);
    },
    plant() {
      if (!ensure()) return;
      tone(660, 0.12, 'sine', 0.25, 880);
      tone(880, 0.18, 'sine', 0.25, 1320, 0.12);
    },
    beep(final) {
      if (!ensure()) return;
      tone(final ? 1560 : 1040, final ? 0.22 : 0.09, 'square', 0.16);
    },
    explosion() {
      if (!ensure()) return;
      noiseHit(0.9, 400, 0.9);
      tone(70, 0.8, 'sine', 0.7, 30);
      noiseHit(0.4, 2500, 0.3, 'highpass');
    },
    roundWin() {
      if (!ensure()) return;
      tone(523, 0.14, 'triangle', 0.25);
      tone(659, 0.14, 'triangle', 0.25, undefined, 0.14);
      tone(784, 0.3, 'triangle', 0.3, undefined, 0.28);
    },
    roundLose() {
      if (!ensure()) return;
      tone(392, 0.16, 'triangle', 0.25);
      tone(330, 0.16, 'triangle', 0.25, undefined, 0.16);
      tone(262, 0.34, 'triangle', 0.3, undefined, 0.32);
    },
    click() {
      if (!ensure()) return;
      tone(800, 0.04, 'square', 0.1);
    },
    footstep() {
      if (!ensure()) return;
      noiseHit(0.06, 500, 0.08);
    },
    whiteoutStart() {
      if (!ensure()) return;
      muffled = true;
      if (wind) return;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 420;
      filter.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 1.2);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.35;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 180;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      src.connect(filter);
      filter.connect(g);
      g.connect(master);
      src.start();
      lfo.start();
      wind = { src, g, lfo };
    },
    whiteoutEnd() {
      muffled = false;
      if (!ctx || !wind) return;
      const w = wind;
      wind = null;
      w.g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.0);
      const stopAt = ctx.currentTime + 1.1;
      try {
        w.src.stop(stopAt);
        w.lfo.stop(stopAt);
      } catch (err) {
        // Already stopped.
      }
    },
  };
}
