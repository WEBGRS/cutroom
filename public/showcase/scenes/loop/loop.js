// Text from the scene's variables; cards and links animate on the composition clock (WAAPI)
(function () {
  var root = document.querySelector('[data-composition-id]');
  var vars = {};
  JSON.parse(root.getAttribute('data-composition-variables')).forEach(function (d) { vars[d.id] = d.default; });
  var set = window.__hyperframes && window.__hyperframes.getVariables ? window.__hyperframes.getVariables() : {};
  for (var k in set) if (set[k] !== undefined) vars[k] = set[k];
  document.querySelectorAll('[data-var]').forEach(function (el) { el.textContent = vars[el.getAttribute('data-var')]; });
  var vertical = root.getAttribute('data-height') > root.getAttribute('data-width');
  document.querySelectorAll('.card').forEach(function (el, i) {
    el.animate([{ opacity: 0, transform: 'translateY(60px) scale(.92)' }, { opacity: 1, transform: 'none' }], { duration: 600, delay: 700 + i * 600, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' });
  });
  document.querySelectorAll('.link').forEach(function (el, i) {
    var axis = vertical ? 'scaleY' : 'scaleX';
    el.animate([{ transform: axis + '(0)' }, { transform: axis + '(1)' }], { duration: 450, delay: 1150 + i * 600, easing: 'cubic-bezier(.6,0,.2,1)', fill: 'both' });
  });
})();
