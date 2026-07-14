import { useState, useEffect } from 'react';

export const SPLASH_URL = '/uploads/asset/splash.gif';

let cachedOk = null; // module-level cache so we only probe once per app load

/**
 * Preload/verify splash.gif. Returns: null = checking, true = ok, false = missing.
 * If false, callers must skip splash & screensaver entirely.
 */
export function useSplashGif() {
  const [ok, setOk] = useState(cachedOk);

  useEffect(() => {
    if (cachedOk !== null) return;
    const img = new Image();
    img.onload  = () => { cachedOk = true;  setOk(true);  };
    img.onerror = () => { cachedOk = false; setOk(false); };
    img.src = SPLASH_URL;
  }, []);

  return ok;
}

/**
 * Fullscreen splash / screensaver overlay. Background matches POS dark theme.
 * `hint` shows a tap-to-continue prompt (screensaver mode).
 */
export default function SplashOverlay({ onWake, hint = false, fadingOut = false }) {
  return (
    <div className={`splash-root${fadingOut ? ' splash-root--out' : ''}`} onPointerDown={onWake}>
      <img className="splash-gif" src={SPLASH_URL} alt="" draggable="false" />
      {hint && <div className="splash-hint">TAP TO CONTINUE</div>}
    </div>
  );
}
