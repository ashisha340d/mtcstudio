import { createContext, useContext, useReducer, useCallback, useEffect, useRef } from 'react';

const DEV_USER = import.meta.env.VITE_DEV_MODE === 'true'
  ? { id: 0, name: 'Dev Admin', employee_id: 'DEV01', role: 'ADMIN' }
  : null;

// Ensure dev session token is in sessionStorage so posApi interceptor sends it
if (DEV_USER) sessionStorage.setItem('mtc_session', 'dev-session');

// ── Role definitions & permission matrix ──────────────────────
export const ROLE = {
  ADMIN:   'ADMIN',
  MANAGER: 'MANAGER',
  CASHIER: 'CASHIER',
};

const PERMISSIONS = {
  // Order entry & basic ops
  ORDER_CREATE:     [ROLE.CASHIER, ROLE.MANAGER, ROLE.ADMIN],
  ORDER_SEND_KOT:   [ROLE.CASHIER, ROLE.MANAGER, ROLE.ADMIN],
  ORDER_CHECKOUT:   [ROLE.CASHIER, ROLE.MANAGER, ROLE.ADMIN],
  TABLE_MANAGE:     [ROLE.CASHIER, ROLE.MANAGER, ROLE.ADMIN],
  // Manager+
  ORDER_CANCEL:     [ROLE.MANAGER, ROLE.ADMIN],
  ORDER_VOID_ITEM:  [ROLE.MANAGER, ROLE.ADMIN],
  DISCOUNT_APPLY:   [ROLE.MANAGER, ROLE.ADMIN],
  REFUND:           [ROLE.MANAGER, ROLE.ADMIN],
  DAY_BOOK_VIEW:    [ROLE.MANAGER, ROLE.ADMIN],
  // Admin only
  MENU_MANAGE:      [ROLE.ADMIN],
  USER_MANAGE:      [ROLE.ADMIN],
  SETTINGS:         [ROLE.ADMIN],
};

export function can(user, permission) {
  if (!user) return false;
  return (PERMISSIONS[permission] || []).includes(user.role);
}

// ── State ─────────────────────────────────────────────────────
const initialState = {
  user:            DEV_USER,
  sessionId:       DEV_USER ? 'dev-session' : null,
  locked:          DEV_USER ? false : true,
  error:           null,
  autoLockSeconds: 120,
};

const A = {
  LOGIN_SUCCESS:  'LOGIN_SUCCESS',
  LOGOUT:         'LOGOUT',
  LOCK:           'LOCK',
  UNLOCK:         'UNLOCK',
  SET_ERROR:      'SET_ERROR',
  SET_AUTO_LOCK:  'SET_AUTO_LOCK',
};

function authReducer(state, { type, payload }) {
  switch (type) {
    case A.LOGIN_SUCCESS:
      return { ...state, user: payload.user, sessionId: payload.sessionId, locked: false, error: null };
    case A.LOGOUT:
      return { ...initialState, locked: true };
    case A.LOCK:
      return { ...state, locked: true };
    case A.UNLOCK:
      return { ...state, locked: false, error: null };
    case A.SET_ERROR:
      return { ...state, error: payload };
    case A.SET_AUTO_LOCK:
      return { ...state, autoLockSeconds: payload };
    default:
      return state;
  }
}

// ── Context ───────────────────────────────────────────────────
const AuthContext = createContext(null);

export function AuthProvider({ children, apiService }) {
  const [state, dispatch] = useReducer(authReducer, initialState);

  // Activity timer for auto-lock
  const lockTimer = useRef(null);

  const resetLockTimer = useCallback(() => {
    if (lockTimer.current) clearTimeout(lockTimer.current);
    if (!state.locked && state.user) {
      lockTimer.current = setTimeout(
        () => dispatch({ type: A.LOCK }),
        (state.autoLockSeconds || 120) * 1000
      );
    }
  }, [state.locked, state.user, state.autoLockSeconds]);

  // Reset timer on user activity
  useEffect(() => {
    const events = ['mousedown', 'keydown', 'touchstart', 'pointerdown'];
    const handler = () => resetLockTimer();
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, handler));
  }, [resetLockTimer]);

  // Start timer when user logs in / unlocks
  useEffect(() => {
    resetLockTimer();
    return () => { if (lockTimer.current) clearTimeout(lockTimer.current); };
  }, [state.locked, state.user]); // eslint-disable-line

  // ── Actions ───────────────────────────────────────────────
  const login = useCallback(async (pin) => {
    dispatch({ type: A.SET_ERROR, payload: null });
    try {
      const { user, sessionId } = await apiService.pinLogin(pin);
      dispatch({ type: A.LOGIN_SUCCESS, payload: { user, sessionId } });
      return true;
    } catch {
      dispatch({ type: A.SET_ERROR, payload: 'Incorrect PIN' });
      return false;
    }
  }, [apiService]);

  const lock = useCallback(() => {
    if (lockTimer.current) clearTimeout(lockTimer.current);
    dispatch({ type: A.LOCK });
  }, []);

  const logout = useCallback(async () => {
    if (lockTimer.current) clearTimeout(lockTimer.current);
    try { await apiService.logout(state.sessionId); } catch { /* silent */ }
    dispatch({ type: A.LOGOUT });
  }, [apiService, state.sessionId]);

  const value = {
    ...state,
    login,
    lock,
    logout,
    can: (permission) => can(state.user, permission),
    setAutoLock: (s) => dispatch({ type: A.SET_AUTO_LOCK, payload: s }),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export default AuthContext;
