// 14 days in Japan: the three buttons show or hide each kind of item (what the reel's cards say, what its clips show, what we added).
(function () {
  var hidden = {};
  Array.prototype.forEach.call(document.querySelectorAll('.filters button[data-k]'), function (b) {
    b.addEventListener('click', function () {
      var k = b.dataset.k, on = b.getAttribute('aria-pressed') === 'true';
      b.setAttribute('aria-pressed', on ? 'false' : 'true'); hidden[k] = on;
      document.body.dataset.hide = Object.keys(hidden).filter(function (x) { return hidden[x]; }).join(' ');
    });
  });
})();
