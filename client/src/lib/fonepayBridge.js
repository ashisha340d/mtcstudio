// Bridge to the native MTC Studio launcher's WebView2 FonepayMonitor (D:\mtclaucher).
// window.checkFonepayStart is exposed via w.Bind() and only acks the request —
// the real payload arrives later, pushed in via window.__onFonepayResult / __onFonepayError.

const TIMEOUT_MS = 25000;

export function isFonepayBridgeAvailable() {
  return typeof window !== 'undefined' && typeof window.checkFonepayStart === 'function';
}

export function checkFonepay() {
  return new Promise((resolve, reject) => {
    if (!isFonepayBridgeAvailable()) {
      reject(new Error('Check Fonepay is only available inside the MTC Studio desktop app.'));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Timed out waiting for Fonepay. Login may be required — check the Fonepay window.'));
    }, TIMEOUT_MS);

    function cleanup() {
      clearTimeout(timer);
      delete window.__onFonepayResult;
      delete window.__onFonepayError;
    }

    window.__onFonepayResult = (payload) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        resolve(typeof payload === 'string' ? JSON.parse(payload) : payload);
      } catch (err) {
        reject(err);
      }
    };

    window.__onFonepayError = (message) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message || 'Fonepay check failed.'));
    };

    window.checkFonepayStart().catch((err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}
