// A Model Carol: every time on the page seeks the film, and the row for what is on screen lights up while it plays.
(function () {
  var video = document.getElementById('edit');
  if (!video) return;
  var rows = Array.prototype.slice.call(document.querySelectorAll('.src li[data-t]'));
  var chapters = Array.prototype.slice.call(document.querySelectorAll('.chapters button'));
  var times = rows.map(function (r) { return parseFloat(r.dataset.t); });
  var chapterTimes = chapters.map(function (b) { return parseFloat(b.dataset.t); });
  var HOLD = 4;                                          // a row stays lit this long after its moment, unless a later one takes over

  function seek(t) {
    var go = function () { video.currentTime = t; var p = video.play(); if (p && p.catch) p.catch(function () {}); };
    if (video.readyState >= 1) go(); else { video.addEventListener('loadedmetadata', go, { once: true }); video.load(); }
    var box = video.getBoundingClientRect();
    if (box.top < 0 || box.bottom > window.innerHeight) video.scrollIntoView({ block: 'center' });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-t]');
    if (b) seek(parseFloat(b.dataset.t));
  });

  // the rows are grouped by subject, not by time, so pick the latest moment that has passed rather than the last row in the list
  function latest(list, t, hold) { var k = -1; for (var i = 0; i < list.length; i++) if (list[i] <= t + 0.05 && (k < 0 || list[i] >= list[k])) k = i; return k >= 0 && hold && t - list[k] > hold ? -1 : k; }
  var curRow = -1, curCh = -1;
  function mark() {
    var t = video.currentTime, r = t > 0 ? latest(times, t, HOLD) : -1, c = latest(chapterTimes, t, 0);
    if (r !== curRow) { if (rows[curRow]) rows[curRow].classList.remove('on'); if (rows[r]) rows[r].classList.add('on'); curRow = r; }
    if (c !== curCh) { if (chapters[curCh]) chapters[curCh].classList.remove('on'); if (chapters[c]) chapters[c].classList.add('on'); curCh = c; }
  }
  video.addEventListener('timeupdate', mark);
  video.addEventListener('seeked', mark);
})();
