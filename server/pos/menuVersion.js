'use strict';
// In-memory menu version stamp. Bumped on every menu write; POS clients
// compare it to skip redundant refetches. Resets on server restart, which
// simply triggers one refresh per client — harmless.
let version = Date.now();

function get() { return version; }

function bump() {
  version = Date.now();
  // Lazy require avoids any init-order coupling with socketServer
  try { require('./socketServer').emitMenuUpdated(version); } catch { }
  return version;
}

module.exports = { get, bump };
