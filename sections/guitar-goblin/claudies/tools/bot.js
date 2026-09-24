window.makeBot = function (opts) {
  opts = opts || {};
  var seq = ['lightL', 'offL', 'lightR', 'offR', 'camUp', 'cove', 'ecorner', 'camDown', 'idle'];
  var dur = { lightL: 0.45, offL: 0.05, lightR: 0.45, offR: 0.05, camUp: 0.3, cove: 0.5, ecorner: 0.6, camDown: 0.25, idle: opts.idle || 1.2 };
  var st = { i: seq.length - 1, until: 0, hL: false, cR: false, cap: 0, c4b: false, bangs: 0 };
  return function (api) {
    var N = api.N, P = api.perceive(), t = N.t, ph = seq[st.i];
    if (N.stats.bangs > st.bangs) { st.bangs = N.stats.bangs; st.cap = 0; }
    if (P.golden && !P.camUp) { api.cam(true); api.view('cove'); return; }
    // observe
    if (ph === 'lightL' && P.atL !== undefined) st.hL = P.atL === 'hallu';
    if (ph === 'lightR' && P.atR !== undefined) st.cR = P.atR === 'clippy';
    if (P.camUp && P.seen) {
      if (P.cam === 'cove' && P.captcha != null) st.cap = P.captcha;
      if (P.cam === 'ecorner') st.c4b = P.seen.indexOf('claudie') >= 0;
    }
    var camPhase = ph === 'camUp' || ph === 'cove' || ph === 'ecorner';
    var wantL = st.hL || st.cap >= 2;
    var wantR = st.cR || (st.c4b && (camPhase || ph === 'offR' || ph === 'lightR'));
    if (!P.dead && !P.powerOut) {
      if (N.doorL !== wantL) api.door('L');
      if (N.doorR !== wantR) api.door('R');
    }
    if (t < st.until) return;
    st.i = (st.i + 1) % seq.length; ph = seq[st.i]; st.until = t + dur[ph];
    switch (ph) {
      case 'lightL': if (!N.lightL) api.light('L'); break;
      case 'offL': if (N.lightL) api.light('L'); break;
      case 'lightR': if (!N.lightR) api.light('R'); break;
      case 'offR': if (N.lightR) api.light('R'); break;
      case 'camUp': if (st.c4b && !N.doorR && !P.dead) api.door('R'); api.cam(true); api.view('cove'); break;
      case 'cove': api.view('cove'); break;
      case 'ecorner': api.view('ecorner'); break;
      case 'camDown': api.cam(false); break;
    }
  };
};
