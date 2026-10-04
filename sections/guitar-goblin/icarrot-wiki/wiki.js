// iCarrot Wiki: the page-list toggle on phones, search, and the "updated" stamp.
(function () {
	var root = document.documentElement.getAttribute("data-root") || "";
	var menu = document.getElementById("menu");
	var sidebar = document.getElementById("sidebar");
	if (menu && sidebar) {
		menu.addEventListener("click", function () {
			var open = sidebar.classList.toggle("open");
			menu.setAttribute("aria-expanded", open ? "true" : "false");
		});
	}

	var input = document.getElementById("search");
	var results = document.getElementById("results");
	var index = null;
	function show(query) {
		query = query.trim().toLowerCase();
		results.innerHTML = "";
		if (!query || !index) {
			results.hidden = true;
			return;
		}
		var words = query.split(/\s+/);
		var hits = index.filter(function (e) {
			var hay = (e.t + " " + e.s + " " + e.c).toLowerCase();
			return words.every(function (w) { return hay.indexOf(w) >= 0; });
		}).sort(function (a, b) {
			return (b.t.toLowerCase().indexOf(words[0]) === 0) - (a.t.toLowerCase().indexOf(words[0]) === 0);
		}).slice(0, 12);
		hits.forEach(function (e) {
			var li = document.createElement("li");
			var a = document.createElement("a");
			a.href = root + e.u;
			a.textContent = e.t;
			var small = document.createElement("small");
			small.textContent = e.c;
			a.appendChild(small);
			li.appendChild(a);
			results.appendChild(li);
		});
		if (!hits.length) {
			var none = document.createElement("li");
			none.innerHTML = "<a>No pages match.</a>";
			results.appendChild(none);
		}
		results.hidden = false;
	}
	if (input && results) {
		input.addEventListener("focus", function () {
			if (index) return;
			fetch(root + "search.json").then(function (r) { return r.json(); }).then(function (data) {
				index = data;
				show(input.value);
			}).catch(function () { index = []; });
		});
		input.addEventListener("input", function () { show(input.value); });
		input.addEventListener("keydown", function (e) {
			if (e.key === "Enter") {
				var first = results.querySelector("a[href]");
				if (first) location.href = first.href;
			} else if (e.key === "Escape") {
				results.hidden = true;
			}
		});
		document.addEventListener("click", function (e) {
			if (!results.contains(e.target) && e.target !== input) results.hidden = true;
		});
	}

	var stamp = document.getElementById("build-stamp");
	if (stamp) {
		fetch(root + "build.json").then(function (r) { return r.json(); }).then(function (b) {
			stamp.textContent = "Generated from the iCarrot game files, last changed " + b.date + " (" + b.commit + ").";
		}).catch(function () {});
	}
})();
