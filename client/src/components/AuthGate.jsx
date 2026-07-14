import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import PinScreen from '../pages/Auth/PinScreen';
import SplashOverlay, { useSplashGif } from './SplashScreen';

const BOOT_SPLASH_MS = 1500;   // boot splash duration
const FADE_MS = 500;   // splash fade-out duration (matches .splash-root--out CSS)
const SAVER_IDLE_MS = 30000;  // idle on PIN screen before screensaver returns

/**
 * Wraps any route in auth. Shows PIN screen when locked.
 * Boot: splash.gif intro (skipped if gif missing).
 * Locked: screensaver (splash.gif) until activity, then PIN mode.
 * Usage: <AuthGate><POSDashboard /></AuthGate>
 */
export default function AuthGate({ children }) {
  const { locked } = useAuth();
  const gifOk = useSplashGif();            // null=checking, true=ok, false=missing
  const [booting, setBooting] = useState(true);
  const [fadingOut, setFadingOut] = useState(false);
  const [saver, setSaver] = useState(false);
  const wasLocked = useRef(locked);

  // Boot splash — only when gif verified; skip entirely on fallback
  useEffect(() => {
    if (gifOk === false) { setBooting(false); return; }
    if (gifOk === true) {
      const t = setTimeout(() => setFadingOut(true), BOOT_SPLASH_MS);
      return () => clearTimeout(t);
    }
  }, [gifOk]);

  // Once fade starts, unmount splash after the CSS transition finishes
  useEffect(() => {
    if (!fadingOut) return;
    const t = setTimeout(() => setBooting(false), FADE_MS);
    return () => clearTimeout(t);
  }, [fadingOut]);

  // Re-arm screensaver only on a fresh lock (not on initial boot->PIN handoff)
  useEffect(() => {
    if (locked && !wasLocked.current) setSaver(true);
    wasLocked.current = locked;
  }, [locked]);

  // While locked: activity wakes to PIN mode, PIN-screen idle returns to saver
  useEffect(() => {
    if (!locked || gifOk !== true) return;
    let idle;
    const wake = () => {
      setSaver(false);
      clearTimeout(idle);
      idle = setTimeout(() => setSaver(true), SAVER_IDLE_MS);
    };
    const events = ['mousedown', 'keydown', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, wake, { passive: true }));
    return () => {
      clearTimeout(idle);
      events.forEach((e) => window.removeEventListener(e, wake));
    };
  }, [locked, gifOk]);

  const underlying = locked
    ? (saver && gifOk === true ? <SplashOverlay hint onWake={() => setSaver(false)} /> : <PinScreen />)
    : children;

  return (
    <>
      {underlying}
      {booting && gifOk !== false && <SplashOverlay fadingOut={fadingOut} />}
      {booting && gifOk === false && <div className="splash-root" />}
    </>
  );
}

/**
 * Hides UI if the active user lacks the required permission.
 * Usage: <Can do="ORDER_CANCEL"><CancelButton /></Can>
 */
export function Can({ do: permission, fallback = null, children }) {
  const { can } = useAuth();
  return can(permission) ? children : fallback;
}
