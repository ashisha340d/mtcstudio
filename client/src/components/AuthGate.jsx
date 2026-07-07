import { useAuth } from '../context/AuthContext';
import PinScreen from '../pages/Auth/PinScreen';

/**
 * Wraps any route in auth. Shows PIN screen when locked.
 * Usage: <AuthGate><POSDashboard /></AuthGate>
 */
export default function AuthGate({ children }) {
  const { locked } = useAuth();
  if (locked) return <PinScreen />;
  return children;
}

/**
 * Hides UI if the active user lacks the required permission.
 * Usage: <Can do="ORDER_CANCEL"><CancelButton /></Can>
 */
export function Can({ do: permission, fallback = null, children }) {
  const { can } = useAuth();
  return can(permission) ? children : fallback;
}
