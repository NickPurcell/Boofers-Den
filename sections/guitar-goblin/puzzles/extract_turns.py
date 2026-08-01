#!/usr/bin/env python3
"""Pull the puzzle-playing turns out of the session transcript.

A turn runs from the scheduled "Daily puzzles" prompt to the next real user
message. Within it we keep the reasoning, the commands, and the command output,
which together are the actual record of how a puzzle was solved.

Two filters matter. Only bash calls touching the puzzle tools are kept — the
rest of a turn is Discord plumbing nobody wants to read. And everything is run
past a secret scan before it leaves here, because a shell transcript is exactly
the sort of thing that quietly carries a token out into public.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import datetime

SRC = "/home/agent/.claude-agent/projects/-var-lib-clawcius-workspaces-1105739162230984735/e3093e37-ff09-46dd-a135-8763ed6015e9.jsonl"
OUT = "/var/lib/clawcius/workspaces/1105739162230984735/_scratch/turns.json"

PUZZLE_CMD = re.compile(r"(\./wordle|\./connections|best2\.py|solve\.py|wordlelib|connlib)")
# Anything that smells like a credential. Better to over-match and lose a line.
SECRET = re.compile(
    r"(DISCORD_TOKEN|ANTHROPIC_API_KEY|Bearer\s+\S+|sk-[A-Za-z0-9_\-]{16,}|"
    r"[A-Za-z0-9_\-]{24}\.[A-Za-z0-9_\-]{6}\.[A-Za-z0-9_\-]{27,})",
    re.IGNORECASE,
)


def records():
    with open(SRC, errors="replace") as f:
        for line in f:
            try:
                yield json.loads(line)
            except ValueError:
                continue


def blocks(rec):
    c = rec.get("message", {}).get("content") if isinstance(rec.get("message"), dict) else None
    return [b for b in c if isinstance(b, dict)] if isinstance(c, list) else []


def text_of(rec):
    c = rec.get("message", {}).get("content") if isinstance(rec.get("message"), dict) else None
    if isinstance(c, str):
        return c
    return "\n".join(b.get("text", "") for b in blocks(rec) if b.get("type") == "text")


def main():
    recs = list(records())

    # Bucket by the day the commands were run, taken from each record's own
    # timestamp. Keying on game ids failed because most days the id was passed
    # through a shell variable and never appears literally; keying on the
    # scheduled prompt missed 27 July, which was played on request rather than
    # on a timer. The commands themselves are the reliable signal.
    from zoneinfo import ZoneInfo
    LA = ZoneInfo("America/Los_Angeles")

    def day_of(rec):
        ts = rec.get("timestamp")
        if not ts:
            return None
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(LA).date().isoformat()

    # Collect every puzzle command with its index and time, then cut each day
    # into sessions on a 25-minute gap. On 27 and 31 July the tools were being
    # built as well as played, so first-to-last command spans hours of unrelated
    # development; the play itself is a tight burst. Keep the session that
    # actually starts a daily game.
    marks = []
    for i, r in enumerate(recs):
        if r.get("type") != "assistant":
            continue
        for b in blocks(r):
            if b.get("type") == "tool_use" and b.get("name") == "Bash":
                cmd = b.get("input", {}).get("command", "")
                if PUZZLE_CMD.search(cmd) and r.get("timestamp"):
                    t = datetime.fromisoformat(r["timestamp"].replace("Z", "+00:00"))
                    marks.append((i, t, cmd))
                    break

    sessions, cur = [], []
    for m in marks:
        if cur and (m[1] - cur[-1][1]).total_seconds() > 25 * 60:
            sessions.append(cur); cur = []
        cur.append(m)
    if cur:
        sessions.append(cur)

    spans = {}
    for sess in sessions:
        starts_game = any("new -m daily" in c or "connections new" in c for _, _, c in sess)
        if not starts_game:
            continue
        # Start at the moment a daily game is created, not at the session's
        # first puzzle command. On 27 July the tools were still being built and
        # tested right up to the point of playing, and everything before the
        # `new -m daily` is development rather than a solve.
        first_game = next(i for i, _, c in sess
                          if "new -m daily" in c or "connections new" in c)
        d = sess[0][1].astimezone(LA).date().isoformat()
        lo = max(0, first_game - 2)
        hi = min(len(recs), sess[-1][0] + 3)
        # A day may hold more than one session (the scheduler double-fired on
        # 31 July). Keep the longest, which is the one that finished both games.
        if d not in spans or (hi - lo) > (spans[d][1] - spans[d][0]):
            spans[d] = (lo, hi)

    turns = []
    for day in sorted(spans):
        i, end = spans[day]
        steps, results = [], {}
        for j in range(i, end):
            for b in blocks(recs[j]):
                if b.get("type") == "tool_result":
                    cont = b.get("content")
                    if isinstance(cont, list):
                        cont = "\n".join(x.get("text", "") for x in cont if isinstance(x, dict))
                    results[b.get("tool_use_id")] = str(cont or "")
        for j in range(i, end):
            r = recs[j]
            if r.get("type") != "assistant":
                continue
            for b in blocks(r):
                bt = b.get("type")
                if bt == "thinking":
                    steps.append({"kind": "think", "body": b.get("thinking", "")})
                elif bt == "text" and b.get("text", "").strip():
                    steps.append({"kind": "say", "body": b["text"]})
                elif bt == "tool_use" and b.get("name") == "Bash":
                    cmd = b.get("input", {}).get("command", "")
                    # The Discord post is the message already published, not
                    # puzzle work, and it is long. The reasoning blocks carry
                    # the conclusion perfectly well without it.
                    if not PUZZLE_CMD.search(cmd) or "discord-cli" in cmd or "BODY=" in cmd:
                        continue
                    steps.append({"kind": "run", "body": cmd,
                                  "out": results.get(b.get("id"), "")})
        # Keep only the puzzle work. On days when the tools were being built as
        # well as played, the span picks up unrelated development; a step earns
        # its place by being a puzzle command, or by being the reasoning
        # immediately either side of one.
        keep = set()
        for n, st in enumerate(steps):
            if st["kind"] == "run":
                keep.update(range(max(0, n - 1), min(len(steps), n + 2)))
        steps = [st for n, st in enumerate(steps) if n in keep]

        if steps:
            turns.append({"day": day, "steps": steps})

    # Secret sweep before anything is written.
    hits = 0
    for t in turns:
        for s in t["steps"]:
            for field in ("body", "out"):
                v = s.get(field)
                if v and SECRET.search(v):
                    s[field] = SECRET.sub("[redacted]", v)
                    hits += 1

    json.dump(turns, open(OUT, "w"), indent=1)
    print(f"  {len(turns)} puzzle turns extracted")
    for t in turns:
        k = [s["kind"] for s in t["steps"]]
        print(f"    {t['day']}  think={k.count('think')} run={k.count('run')} say={k.count('say')}")
    print(f"  redactions applied: {hits}")
    size = sum(len(s.get("body", "")) + len(s.get("out", "")) for t in turns for s in t["steps"])
    print(f"  total characters: {size:,}")


if __name__ == "__main__":
    main()
