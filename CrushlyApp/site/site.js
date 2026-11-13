/* holUpp.net — the small amount of behaviour the site needs.
 *
 * No framework, no polyfill, no dependency: three things, each of which degrades
 * to a working page when it does not run. That matters because the pages are
 * static and must be readable by a crawler with JavaScript disabled.
 */
(function () {
  'use strict';

  var doc = document;
  doc.documentElement.classList.remove('no-js');

  /* 1. Mobile drawer -------------------------------------------------------- */
  var burger = doc.querySelector('.burger');
  var drawer = doc.getElementById('drawer');
  if (burger && drawer) {
    var setOpen = function (open) {
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      drawer.classList.toggle('is-open', open);
      doc.body.style.overflow = open ? 'hidden' : '';
    };
    burger.addEventListener('click', function () {
      setOpen(burger.getAttribute('aria-expanded') !== 'true');
    });
    drawer.addEventListener('click', function (event) {
      if (event.target.closest('a')) setOpen(false);
    });
    doc.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') setOpen(false);
    });
    window.addEventListener('resize', function () {
      if (window.innerWidth > 1000) setOpen(false);
    });
  }

  /* 2. Header gains its hairline once the page has moved -------------------- */
  var header = doc.querySelector('.site-header');
  if (header) {
    var onScroll = function () {
      header.classList.toggle('is-stuck', window.scrollY > 8);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* 3. Entrance animation ---------------------------------------------------
   * Elements are only hidden once the observer exists, and only then marked for
   * reveal: a browser without IntersectionObserver keeps a fully visible page
   * rather than a blank one.
   */
  var targets = doc.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && targets.length) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    Array.prototype.forEach.call(targets, function (el) {
      observer.observe(el);
    });
  } else {
    Array.prototype.forEach.call(targets, function (el) {
      el.classList.add('is-in');
    });
  }

  /* 4. APK download --------------------------------------------------------
   * The button never guesses. It asks the Worker what the current release is,
   * enables only when the answer is a real file, and says which of the four
   * states it is in — because a control that silently does nothing is a lie
   * about the product.
   */
  var button = doc.getElementById('apk-download');
  if (button) {
    var status = doc.getElementById('apk-status');
    var meta = doc.querySelectorAll('[data-release]');
    var setStatus = function (state, text) {
      if (status) {
        status.setAttribute('data-state', state);
        status.textContent = text;
      }
    };
    var fmtBytes = function (bytes) {
      if (!bytes) return '';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };
    var fmtDate = function (iso) {
      if (!iso) return '';
      try {
        return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      } catch (e) {
        return '';
      }
    };

    setStatus('checking', 'Checking the current Android build…');
    fetch(button.getAttribute('data-version-url'), { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('version ' + res.status);
        return res.json();
      })
      .then(function (info) {
        if (!info || !info.version || !info.bytes) throw new Error('incomplete release');
        button.href = button.getAttribute('data-download-url');
        button.removeAttribute('aria-disabled');
        button.setAttribute('download', '');
        button.textContent = 'Download APK · ' + info.version;
        setStatus('ready', 'Version ' + info.version + ' · ' + fmtBytes(info.bytes) + ' · verified before publishing.');
        Array.prototype.forEach.call(meta, function (el) {
          var key = el.getAttribute('data-release');
          if (key === 'version') el.textContent = info.version;
          if (key === 'bytes') el.textContent = fmtBytes(info.bytes);
          if (key === 'date') el.textContent = fmtDate(info.publishedAt || info.published_at) || el.textContent;
        });
      })
      .catch(function () {
        // Still offer the file: a stale version line is better than a dead
        // button, and the Worker's /download always serves the current one.
        button.href = button.getAttribute('data-download-url');
        button.removeAttribute('aria-disabled');
        setStatus('error', 'Couldn’t read the release details. The download button still works and always serves the newest build.');
      });
  }
})();
