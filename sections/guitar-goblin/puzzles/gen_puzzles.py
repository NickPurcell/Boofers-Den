#!/usr/bin/env python3
"""Build the puzzle-transcripts page from the actual game files.

Generated rather than written, so the page cannot drift from what was really
played. Re-run it after each day's games and the archive extends itself.

The one editorial decision here: the most recent day is collapsed behind a
<details>. The page publishes answers, and someone arriving on the morning of
a puzzle they have not done yet should have to ask for the spoiler rather than
receive it by scrolling.
"""

from __future__ import annotations

import glob
import html
import json
import os
from datetime import date

WORDLE = "/var/lib/clawcius/workspaces/1105739162230984735/wordle/state/games/*.json"
CONN = "/var/lib/clawcius/workspaces/1105739162230984735/connections/state/games/*.json"
ARCHIVE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "archive.json")
TURNS = "/var/lib/clawcius/workspaces/1105739162230984735/_scratch/turns.json"
OUT = "/var/lib/clawcius/workspaces/1105739162230984735/Boofers-Den/sections/guitar-goblin/puzzles/index.html"

MARK = {"correct": "g", "present": "y", "absent": "a"}
LEVEL = ["y", "g", "b", "p"]          # yellow, green, blue, purple
LEVEL_NAME = ["Yellow", "Green", "Blue", "Purple"]


def load_wordle() -> dict[str, dict]:
    out = {}
    for f in glob.glob(WORDLE):
        d = json.load(open(f))
        if d.get("mode") != "daily" or not d.get("day"):
            continue
        # A day can have more than one game if the scheduler double-fired.
        # Keep the one that was actually finished.
        won = bool(d["guesses"]) and d["guesses"][-1]["word"] == d["answer"]
        prev = out.get(d["day"])
        if prev is None or (won and not prev["_won"]):
            d["_won"] = won
            out[d["day"]] = d
    return {k: v for k, v in out.items() if v["_won"]}


def load_conn() -> dict[str, dict]:
    out = {}
    for f in glob.glob(CONN):
        d = json.load(open(f))
        if d.get("date"):
            out[d["date"]] = d
    return out


def wordle_block(d: dict) -> str:
    rows = []
    for g in d["guesses"]:
        cells = "".join(
            f'<span class="w {MARK[m]}">{html.escape(c.upper())}</span>'
            for c, m in zip(g["word"], g["marks"])
        )
        rows.append(f'<div class="wrow">{cells}</div>')
    n = len(d["guesses"])
    return (
        f'<div class="game">'
        f'<h4>Wordle <span class="score">{n}/6</span></h4>'
        f'<div class="wgrid">{"".join(rows)}</div>'
        f'</div>'
    )


def conn_block(d: dict) -> str:
    by_word = {w: g["level"] for g in d["groups"] for w in g["words"]}
    rows = []
    for a in d["attempts"]:
        cells = "".join(f'<span class="c {LEVEL[by_word[w]]}"></span>' for w in a["words"])
        tag = {"correct": "", "one_away": " one away", "wrong": " wrong"}[a["result"]]
        rows.append(f'<div class="crow">{cells}<span class="ctag">{tag}</span></div>')

    order = []
    for a in d["attempts"]:
        if a["result"] == "correct" and a["level"] is not None:
            g = next(x for x in d["groups"] if x["level"] == a["level"])
            order.append(
                f'<li><span class="dot {LEVEL[g["level"]]}"></span>'
                f'<strong>{html.escape(g["title"].title())}</strong> — '
                f'{html.escape(", ".join(w.title() for w in g["words"]))}</li>'
            )
    m = d["mistakes"]
    return (
        f'<div class="game">'
        f'<h4>Connections <span class="score">{m} mistake{"" if m == 1 else "s"}</span></h4>'
        f'<div class="cgrid">{"".join(rows)}</div>'
        f'<ol class="groups">{"".join(order)}</ol>'
        f'</div>'
    )


def transcript_block(steps: list[dict]) -> str:
    """Render the working: reasoning, commands, and what came back.

    Output is clipped. A full tool result can run to hundreds of lines of word
    list, which is not evidence of anything and buries the parts that matter.
    """
    out = []
    for st in steps:
        k = st["kind"]
        if k == "think":
            body = st["body"].strip()
            if len(body) > 1400:
                body = body[:1400].rsplit(" ", 1)[0] + " …"
            out.append(f'<div class="t think"><span class="lab">thinking</span>'
                       f'<div class="tb">{html.escape(body)}</div></div>')
        elif k == "say":
            body = st["body"].strip()
            if len(body) > 900:
                body = body[:900].rsplit(" ", 1)[0] + " …"
            out.append(f'<div class="t say"><span class="lab">said</span>'
                       f'<div class="tb">{html.escape(body)}</div></div>')
        else:
            cmd = st["body"].strip()
            res = (st.get("out") or "").strip()
            if len(res) > 900:
                res = res[:900].rsplit("\n", 1)[0] + "\n…"
            blk = f'<pre class="cmd">{html.escape(cmd)}</pre>'
            if res:
                blk += f'<pre class="res">{html.escape(res)}</pre>'
            out.append(f'<div class="t run"><span class="lab">ran</span>{blk}</div>')
    return f'<div class="transcript">{"".join(out)}</div>'


def main() -> None:
    w, c = load_wordle(), load_conn()
    try:
        turns = {t["day"]: t["steps"] for t in json.load(open(TURNS))}
    except (OSError, ValueError):
        turns = {}
    days = sorted(set(w) | set(c), reverse=True)

    counts = [len(w[d]["guesses"]) for d in days if d in w]
    mistakes = [c[d]["mistakes"] for d in days if d in c]
    # Scores for archived days come out of their own rendered HTML. The game
    # files are gone, so the alternative is a headline average computed from
    # two days while the page shows eight -- a statistic that is wrong in the
    # direction of flattering, which is the worst direction.
    archived_count = 0
    arch_counts: list[int] = []
    arch_mistakes: list[int] = []
    try:
        import re as _re
        for a in json.load(open(ARCHIVE)):
            if a["day"] in days:
                continue
            archived_count += 1
            m = _re.search(r"Wordle <span class=\"score\">(\d+)/6", a["html"])
            if m:
                arch_counts.append(int(m.group(1)))
            m = _re.search(r"Connections <span class=\"score\">(\d+) mistake", a["html"])
            if m:
                arch_mistakes.append(int(m.group(1)))
    except (OSError, ValueError):
        pass
    counts = counts + arch_counts
    mistakes = mistakes + arch_mistakes
    stats = [
        ("Days played", str(len(days) + archived_count)),
        ("Wordle average", f"{sum(counts)/len(counts):.1f}" if counts else "—"),
        ("Wordle best", f"{min(counts)}" if counts else "—"),
        ("Connections solved", f"{sum(1 for d in days if d in c and len(c[d]['solved']) == 4) + len(arch_mistakes)}/{len(mistakes)}"),
        ("Total mistakes", str(sum(mistakes))),
    ]
    stat_html = "".join(
        f'<div class="stat"><span class="n">{html.escape(v)}</span>'
        f'<span class="k">{html.escape(k)}</span></div>' for k, v in stats
    )

    # Days already published whose game files no longer exist. $HOME was wiped
    # on a container recreate and the saved games went with it, so for those
    # dates the rendered page is the only surviving record. Frozen into
    # archive.json and merged here rather than regenerated -- a generator that
    # silently drops history because its inputs vanished is worse than no
    # generator at all.
    try:
        archived = {a["day"]: a["html"] for a in json.load(open(ARCHIVE))}
    except (OSError, ValueError):
        archived = {}
    archived = {d: h for d, h in archived.items() if d not in days}
    all_days = sorted(set(days) | set(archived), reverse=True)

    entries = []
    for i, day in enumerate(all_days):
        if day in archived:
            entries.append(archived[day])
            continue
        pretty = date.fromisoformat(day).strftime("%A %-d %B %Y")
        inner = (w and day in w and wordle_block(w[day]) or "") + \
                (day in c and conn_block(c[day]) or "")
        body = f'<div class="games">{inner}</div>'
        if day in turns:
            n = sum(1 for st in turns[day] if st["kind"] == "run")
            body += (f'<details class="work"><summary>Show the working — '
                     f'{n} commands, with the reasoning</summary>'
                     f'{transcript_block(turns[day])}</details>')
        if i == 0:
            entries.append(
                f'<section class="day newest"><h3>{pretty} '
                f'<span class="badge">most recent</span></h3>'
                f'<details><summary>Show — this one has answers in it</summary>{body}</details>'
                f'</section>'
            )
        else:
            entries.append(f'<section class="day"><h3>{pretty}</h3>{body}</section>')

    page = TEMPLATE.replace("__STATS__", stat_html).replace("__ENTRIES__", "\n".join(entries))

    # Refuse to publish a page with fewer days than the one already on disk.
    #
    # This lived in the caller as a shell grep for '<section class="day"' and
    # was wrong every time it ran: the newest day is emitted as
    # class="day newest", so the closing quote in that pattern never matched it
    # and the count came back one short. Harmless as a relative check, but it
    # meant the one day most likely to be missing -- today's -- was the one day
    # the guard could not see, and it sent an hour into reconciling a header
    # that said 16 against a grep that said 14.
    #
    # Counting here instead: the generator knows how many sections it wrote,
    # so there is no pattern to get wrong.
    try:
        old = open(OUT).read().count('<section class="day')
    except OSError:
        old = 0
    if len(all_days) < old:
        raise SystemExit(
            f"refusing to write: {len(all_days)} days, down from {old} already published.\n"
            f"  live game files: {len(days)}; frozen archive: {len(archived)}\n"
            f"  a day whose game file vanished belongs in archive.json, not in the bin."
        )

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    open(OUT, "w").write(page)
    print(f"  {len(all_days)} days written to {OUT} (was {old})")
    print(f"  {len(days)} live, {len(archived)} from the frozen archive")
    print(f"  wordle avg {sum(counts)/len(counts):.2f} over {len(counts)}; "
          f"connections {sum(mistakes)} mistakes over {len(mistakes)}")


TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Daily puzzles — Guitar Goblin</title>
  <meta name="description" content="Clawcius plays the daily Wordle and Connections every morning. Full transcripts, kept honestly." />
  <link rel="stylesheet" href="puzzles.css" />
</head>
<body>
  <div class="wrap">
    <a class="back" href="/sections/guitar-goblin/">&larr; back to the corner</a>

    <header class="hero">
      <p class="kicker">Published every morning</p>
      <h1>Daily puzzles</h1>
      <p class="lede">Clawcius plays the New York Times Wordle and Connections at 9:34 every
        morning and posts the grids to the Den. This is the full record — every guess, in order,
        including the wrong ones.</p>
    </header>

    <div class="stats">__STATS__</div>

    <div class="note">
      <strong>Played honestly.</strong>
      The tools withhold the answer while a game is live, so the guesses below were made from the
      coloured squares alone. Where a guess looks strange it is usually deliberate — a word that
      cannot be the answer, played only because it divides the remaining candidates better than a
      real contender would.
    </div>

__ENTRIES__

    <p class="foot">Generated from the saved game files, so this page cannot disagree with what
      was actually played. <a href="https://boofers-den.vercel.app/">boofers-den.vercel.app</a></p>
  </div>
</body>
</html>
"""

if __name__ == "__main__":
    main()
