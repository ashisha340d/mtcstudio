/* ══════════════════════════════════════════════════════════════════════════
   Munch Time Cafe — Guest Wi-Fi portal
   No dependencies. Everything degrades to a working page when this file
   never runs: reveals stay visible, the dock is reachable in the footer, and
   the connect form submits natively.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var doc = document;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var form = doc.getElementById('connectForm');
  var dstField = doc.getElementById('connectDst');
  var defaultDst = dstField ? dstField.value : '';

  /* ── Telemetry ───────────────────────────────────────────────────────────
     sendBeacon so a tap that navigates away still reports. Silently dropped
     if the endpoint is unreachable — telemetry never blocks a guest. */
  function track(event, section, refId, meta) {
    try {
      var body = JSON.stringify({ event: event, section: section, refId: refId, meta: meta });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/wifi/api/event', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/wifi/api/event', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: body, keepalive: true,
        }).catch(function () {});
      }
    } catch (e) { /* never surface telemetry failures */ }
  }

  /* ── Connect hand-off ────────────────────────────────────────────────────
     Show the overlay, then submit on the next frame so the guest sees the
     transition start before the browser tears the page down. */
  var connecting = false;

  function goOnline(dst, source) {
    if (connecting || !form) return;
    connecting = true;

    if (dstField && dst) dstField.value = dst;
    track('connect', source || 'unknown', dst || defaultDst);

    var veil = doc.getElementById('veil');
    if (veil) {
      veil.hidden = false;
      // Move the screen reader into the overlay so the state change is announced.
      var heading = veil.querySelector('h2');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus();
      }
    }
    if (window.navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }

    var submit = function () { form.submit(); };
    reduced ? submit() : setTimeout(submit, 420);
  }

  doc.addEventListener('click', function (e) {
    var el = e.target.closest('[data-connect]');
    if (!el) return;
    e.preventDefault();
    goOnline(el.getAttribute('data-dst') || '', el.getAttribute('data-ev') || 'connect');
  });

  /* ── Smooth in-page navigation ───────────────────────────────────────── */
  doc.addEventListener('click', function (e) {
    var link = e.target.closest('a[data-scroll]');
    if (!link) return;
    var target = doc.querySelector(link.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    var ev = link.getAttribute('data-ev');
    if (ev) track('nav', ev, link.getAttribute('href'));
  });

  /* ── Scroll progress ─────────────────────────────────────────────────── */
  var bar = doc.getElementById('scrollBar');
  var dock = doc.getElementById('dock');
  var hero = doc.querySelector('.hero');
  var ticking = false;
  var deepestPct = 0;

  function onScroll() {
    var max = doc.documentElement.scrollHeight - window.innerHeight;
    var pct = max > 0 ? window.scrollY / max : 0;

    if (bar) bar.style.width = (pct * 100).toFixed(2) + '%';

    // The dock appears once the hero is mostly behind the guest, so the hero's
    // own "Continue to Internet" button is never competing with it.
    if (dock && hero) {
      var past = window.scrollY > hero.offsetHeight * 0.62;
      dock.classList.toggle('is-visible', past);
    }

    // Scroll depth, reported once per quarter reached.
    var quarter = Math.floor(pct * 4);
    if (quarter > deepestPct) {
      deepestPct = quarter;
      track('scroll_depth', String(quarter * 25) + '%');
    }
    ticking = false;
  }

  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  onScroll();

  /* ── Reveal on enter ─────────────────────────────────────────────────────
     Siblings inside one container stagger, which reads as a considered
     sequence rather than everything popping at once. */
  if ('IntersectionObserver' in window && !reduced) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        var siblings = el.parentElement ? Array.prototype.filter.call(el.parentElement.children, function (n) {
          return n.classList.contains('reveal');
        }) : [];
        var index = siblings.indexOf(el);
        el.style.setProperty('--d', Math.min(index, 6) * 70 + 'ms');
        el.classList.add('is-in');
        revealObserver.unobserve(el);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    doc.querySelectorAll('.reveal').forEach(function (el) { revealObserver.observe(el); });
  } else {
    doc.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ── Section reach tracking ──────────────────────────────────────────── */
  if ('IntersectionObserver' in window) {
    var seen = Object.create(null);
    var sectionObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var id = entry.target.id;
        if (!id || seen[id]) return;
        seen[id] = true;
        track('section_view', id);
      });
    }, { threshold: 0.35 });

    doc.querySelectorAll('main section[id]').forEach(function (s) { sectionObserver.observe(s); });
  }

  /* ── Count-up ────────────────────────────────────────────────────────── */
  function countUp(el) {
    var target = parseFloat(el.getAttribute('data-count')) || 0;
    var decimals = parseInt(el.getAttribute('data-decimals'), 10) || 0;
    if (reduced) { el.textContent = target.toFixed(decimals); return; }

    var start = performance.now();
    var dur = 1100;
    (function step(now) {
      var t = Math.min(1, (now - start) / dur);
      var eased = 1 - Math.pow(1 - t, 3);
      el.textContent = (target * eased).toFixed(decimals);
      if (t < 1) requestAnimationFrame(step);
    })(start);
  }

  if ('IntersectionObserver' in window) {
    var countObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        countUp(entry.target);
        countObserver.unobserve(entry.target);
      });
    }, { threshold: 0.6 });
    doc.querySelectorAll('.count').forEach(function (el) { countObserver.observe(el); });
  } else {
    doc.querySelectorAll('.count').forEach(countUp);
  }

  /* ── Rails: pointer drag on desktop ──────────────────────────────────────
     Touch already has native momentum; this only adds grab-scrolling for a
     mouse, and bails the moment the pointer is a finger. */
  doc.querySelectorAll('[data-rail]').forEach(function (rail) {
    var down = false, startX = 0, startLeft = 0, moved = false;

    rail.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') return;
      down = true; moved = false;
      startX = e.clientX;
      startLeft = rail.scrollLeft;
      rail.setPointerCapture(e.pointerId);
    });

    rail.addEventListener('pointermove', function (e) {
      if (!down) return;
      var dx = e.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      rail.scrollLeft = startLeft - dx;
    });

    var end = function (e) {
      if (!down) return;
      down = false;
      try { rail.releasePointerCapture(e.pointerId); } catch (err) {}
      // Suppress the click that follows a drag so cards don't fire on release.
      if (moved) {
        var swallow = function (ev) { ev.stopPropagation(); ev.preventDefault(); };
        rail.addEventListener('click', swallow, { capture: true, once: true });
      }
    };
    rail.addEventListener('pointerup', end);
    rail.addEventListener('pointercancel', end);
  });

  /* ── Hero parallax ───────────────────────────────────────────────────────
     Only while the hero is on screen, and only when motion is welcome. */
  if (hero && !reduced) {
    var media = hero.querySelector('.hero__media');
    var heroTicking = false;
    window.addEventListener('scroll', function () {
      if (heroTicking) return;
      heroTicking = true;
      requestAnimationFrame(function () {
        var y = window.scrollY;
        if (media && y < hero.offsetHeight) {
          media.style.transform = 'translate3d(0,' + (y * 0.28).toFixed(1) + 'px,0)';
        }
        heroTicking = false;
      });
    }, { passive: true });
  }

  /* ── Pause offscreen hero video ──────────────────────────────────────── */
  var video = doc.querySelector('.hero__video');
  if (video && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { video.play().catch(function () {}); }
        else { video.pause(); }
      });
    }, { threshold: 0.1 }).observe(video);
  }

  /* ── Card interest ───────────────────────────────────────────────────── */
  doc.addEventListener('click', function (e) {
    var card = e.target.closest('.card, .cake, .tile, .shelf__row, .ticket');
    if (!card) return;
    var heading = card.querySelector('h3');
    var section = card.closest('section');
    track('item_tap', section ? section.id : null, heading ? heading.textContent.trim() : null);
  });
})();
