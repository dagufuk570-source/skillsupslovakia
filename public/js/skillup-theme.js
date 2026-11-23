/* SkillUp Slovakia theme: light/dark switch, mobile menu, hero headline, missing-image placeholder */
(function () {
  var root = document.documentElement;

  // Light / dark (remembered)
  var themeBtn = document.getElementById('suTheme');
  if (themeBtn) themeBtn.addEventListener('click', function () {
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('su-theme', next); } catch (e) {}
  });

  // Mobile menu
  var header = document.getElementById('suHeader');
  var burger = document.getElementById('suBurger');
  if (header && burger) {
    var setOpen = function (open) { header.classList.toggle('open', open); burger.setAttribute('aria-expanded', String(open)); };
    burger.addEventListener('click', function () { setOpen(!header.classList.contains('open')); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
    document.addEventListener('click', function (e) { if (header.classList.contains('open') && !header.contains(e.target)) setOpen(false); });
  }

  // Hero headline: split into words so they rise in one after another (the highlighted phrase stays intact)
  var title = document.getElementById('suHeroTitle');
  if (title) {
    var i = 0;
    var split = function (node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(function (part) {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            var w = document.createElement('span'); w.className = 'w';
            var s = document.createElement('span'); s.style.setProperty('--i', i++); s.textContent = part;
            w.appendChild(s); frag.appendChild(w);
          });
          node.replaceChild(frag, n);
        } else if (n.nodeName !== 'svg') split(n);
      });
    };
    split(title);
  }

  // Scroll reveal: blocks rise and fade in as they enter the screen (skipped when the visitor prefers reduced motion)
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce && 'IntersectionObserver' in window) {
    var picks = Array.prototype.slice.call(document.querySelectorAll(
      '.container .row > [class*="col-"], .section-title-bar, h1.display-6, h2.display-6, .stats-card, .about-mid-card, .card, .team-item, ' +
      '.partner-card, .fo-card, .ab-head, .ab-photo, .ab-split > .ab-text, .ab-card, .contact-map-iframe'
    )).filter(function (el) { return !el.closest('.su-header, .su-hero, .footer, .bg-dark, .modal, form'); });
    // wrappers that hold other picked blocks stay still, so every block moves on its own
    picks = picks.filter(function (el) { return !picks.some(function (o) { return o !== el && el.contains(o); }); });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target; io.unobserve(el);
        el.classList.add('in');
        // afterwards hand the element back to its own hover transitions
        setTimeout(function () { el.classList.remove('su-reveal', 'in'); el.style.removeProperty('--d'); }, 1400);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    var groups = new Map();
    picks.forEach(function (el) {
      // blocks of one row come in one after another
      var group = el.closest('.row, .partner-grid, .fo-list, .ab-pair, .ab-split') || el.parentElement;
      var n = groups.get(group) || 0; groups.set(group, n + 1);
      el.style.setProperty('--d', ((n % 4) * 0.09) + 's');
      el.classList.add('su-reveal');
      io.observe(el);
    });
  }

  // Images whose file is missing get a branded placeholder instead of a broken-image box
  var swap = function (img) {
    if (!img || img.dataset.suFallback || img.closest('.su-logo, .su-hero')) return;
    img.dataset.suFallback = '1';
    var ph = document.createElement('div');
    ph.className = 'su-img-fallback';
    ph.innerHTML = '<img src="/img/logo.png" alt="">';
    img.replaceWith(ph);
  };
  window.addEventListener('error', function (e) { if (e.target && e.target.tagName === 'IMG') swap(e.target); }, true);
  var sweep = function () { Array.prototype.forEach.call(document.images, function (img) { if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) swap(img); }); };
  if (document.readyState === 'complete') sweep(); else window.addEventListener('load', sweep);
})();
