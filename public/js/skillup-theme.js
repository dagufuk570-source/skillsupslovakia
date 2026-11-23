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
