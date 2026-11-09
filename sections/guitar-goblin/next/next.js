// NEXT: every time on the page seeks the video, and the row for the card on screen lights up while it plays.
(function () {
  var video = document.getElementById('edit');
  if (!video) return;
  var rows = Array.prototype.slice.call(document.querySelectorAll('.src li[data-t]'));
  var chapters = Array.prototype.slice.call(document.querySelectorAll('.chapters button'));
  var times = rows.map(function (r) { return parseFloat(r.dataset.t); });
  var chapterTimes = chapters.map(function (b) { return parseFloat(b.dataset.t); });

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

  // the last row (or chapter) whose time has passed is the current one
  function lastAtOrBefore(list, t) { var k = -1; for (var i = 0; i < list.length; i++) if (list[i] <= t + 0.05) k = i; return k; }
  var curRow = -1, curCh = -1;
  function mark() {
    var t = video.currentTime, r = t > 0 ? lastAtOrBefore(times, t) : -1, c = lastAtOrBefore(chapterTimes, t);
    if (t >= 58.5) r = -1;                              // after the last sourced card
    if (r !== curRow) { if (rows[curRow]) rows[curRow].classList.remove('on'); if (rows[r]) rows[r].classList.add('on'); curRow = r; }
    if (c !== curCh) { if (chapters[curCh]) chapters[curCh].classList.remove('on'); if (chapters[c]) chapters[c].classList.add('on'); curCh = c; }
  }
  video.addEventListener('timeupdate', mark);
  video.addEventListener('seeked', mark);
})();
