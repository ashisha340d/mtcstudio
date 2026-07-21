// Haptic feedback — no-ops on devices without a vibrator (iOS Safari),
// or when the waiter has switched vibration off in Settings.
let enabled = true;
export const setHapticsEnabled = (on) => { enabled = !!on; };

const can = () => enabled && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

export const tapLight   = () => { if (can()) navigator.vibrate(8); };
export const tapMedium  = () => { if (can()) navigator.vibrate(18); };
export const tapSuccess = () => { if (can()) navigator.vibrate([14, 40, 14]); };
export const tapWarn    = () => { if (can()) navigator.vibrate([30, 60, 30]); };
export const tapCall    = () => { if (can()) navigator.vibrate([200, 100, 200]); };
