// Plays a centrally-configured alert sound (uploaded via File Maintenance),
// falling back to a short oscillator beep when none is set. Android/iOS
// suspend audio until a user gesture — call unlock() once on first click/touch.
export function createAlertPlayer(beepFreq = 880) {
  let ctx = null;
  let audio = null;
  let src = null;

  function getCtx() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch { return null; }
    }
    return ctx;
  }

  function setSrc(url) {
    const next = url || null;
    if (next === src) return;
    src = next;
    audio = src ? Object.assign(new Audio(), { preload: 'auto', src }) : null;
  }

  async function unlock() {
    const c = getCtx();
    if (c?.state === 'suspended') { try { await c.resume(); } catch {} }
    if (audio) {
      try { audio.volume = 0; await audio.play(); audio.pause(); audio.currentTime = 0; audio.volume = 1; }
      catch {}
    }
  }

  function play() {
    if (audio) { audio.currentTime = 0; audio.play().catch(() => {}); return; }
    const c = getCtx();
    if (!c || c.state === 'suspended') return;
    try {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.connect(gain); gain.connect(c.destination);
      osc.frequency.value = beepFreq; osc.type = 'sine';
      gain.gain.setValueAtTime(0.25, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.35);
      osc.start(); osc.stop(c.currentTime + 0.35);
    } catch {}
  }

  return { setSrc, unlock, play };
}
