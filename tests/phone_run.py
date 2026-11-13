"""A scripted phone-width run of Find time to hang v2, as a list of taps.

    python3 tests/phone_run.py BASE_URL OUT_DIR [--keep] [--name NAME]

create -> share -> two people fill in by rule -> one adds an away-stretch -> best time ->
lock it in, plus the filter, undo, the link preview and the viewer's locale. Every person is
invented. Prints a JSON report (taps, keystrokes and automated wall time per path) and writes
phone screenshots to OUT_DIR. Without --keep the event is deleted at the end with the creator's
key; with --keep it stays (the demo).
"""
import datetime as dt
import json
import re
import sys
import time
from zoneinfo import ZoneInfo

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1].rstrip("/")
OUT = sys.argv[2]
KEEP = "--keep" in sys.argv
NAME = sys.argv[sys.argv.index("--name") + 1] if "--name" in sys.argv else "Space game (test run)"
PHONE = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="en-US")
CHI = ZoneInfo("America/Chicago")

report = {"base": BASE, "paths": {}, "checks": []}
atexit_cleanup = []


class Path:
    """Counts taps and typed characters, and the wall time of a path."""

    def __init__(self, name):
        self.name, self.taps, self.keys, self.t0 = name, 0, 0, time.time()

    def tap(self, loc):
        loc.wait_for(state="visible")
        loc.tap()
        self.taps += 1

    def type(self, loc, text):
        loc.fill(text)
        self.keys += len(text)

    def done(self, note=""):
        report["paths"][self.name] = {"taps": self.taps, "typed": self.keys, "seconds": round(time.time() - self.t0, 1), "note": note}


def check(what, ok):
    report["checks"].append({"check": what, "ok": bool(ok)})
    if not ok:
        for f in atexit_cleanup:
            f()
        print(json.dumps(report, indent=1))
        raise SystemExit(f"FAILED: {what}")


def shot(page, name):
    page.screenshot(path=f"{OUT}/{name}.png", full_page=False)


def saved(page):
    expect(page.locator("#toast")).to_contain_text("Saved", timeout=8000)


def close_sheet(page):
    page.locator(".sheet-head button[aria-label=Close]").tap()
    expect(page.locator("#sheet")).to_be_hidden()


def next_weekday(d, wd):  # wd: Monday 0 .. Sunday 6
    return d + dt.timedelta(days=(wd - d.weekday()) % 7)


def fetch(page, path, method="GET", body=None):
    """A request from inside the page (same origin, through the browser's own network path)."""
    return page.evaluate("""async ([p, m, b]) => {
        const r = await fetch(p, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
        return { status: r.status, type: r.headers.get('content-type') || '', text: await r.text() };
    }""", [path, method, body])


with sync_playwright() as p:
    browser = p.chromium.launch()
    A = browser.new_context(**PHONE, timezone_id="America/Chicago")
    A.grant_permissions(["clipboard-read", "clipboard-write"], origin=BASE)
    a = A.new_page()

    # ---- create and share (Avery, Chicago) ----
    P = Path("create_and_share")
    a.goto(BASE + "/hang/")
    P.tap(a.locator("#c-name"))
    P.type(a.locator("#c-name"), NAME)
    P.tap(a.locator("#c-roster"))
    P.type(a.locator("#c-roster"), "Avery, Blake, Cam")
    shot(a, "01-create")
    P.tap(a.locator("#create-go"))
    a.wait_for_url(re.compile(r"/hang/[a-z0-9-]+-[a-z0-9]{6}$"))
    ev_id = a.url.rsplit("/", 1)[1]
    url = f"{BASE}/hang/{ev_id}"
    expect(a.locator("#share-link")).to_have_text(url)
    shot(a, "02-share")
    P.tap(a.locator("#copy-link"))
    check("copy link puts the link on the clipboard", a.evaluate("navigator.clipboard.readText()") == url)
    P.tap(a.locator(".sheet-head button[aria-label=Close]"))
    P.done("name and roster typed; the share sheet opens by itself")
    check("slug carries the name", ev_id.startswith("space-game"))
    key = a.evaluate(f"JSON.parse(localStorage.getItem('hang2:key:{ev_id}'))")
    open(f"{OUT}/event.json", "w").write(json.dumps({"id": ev_id, "key": key, "url": url}))

    def cleanup():
        if KEEP:
            return
        r = fetch(a, "/api/hangout", "POST", {"action": "delete", "id": ev_id, "key": key})
        report["checks"].append({"check": "cleanup: the test event is deleted", "ok": r["status"] == 200})
    atexit_cleanup.append(cleanup)

    # ---- the first minute: tap your name, pick usual times from chips ----
    P = Path("first_minute_avery")
    P.tap(a.locator("#dock-me"))
    P.tap(a.locator('.names button[data-name="Avery"]'))
    P.tap(a.locator('#presets [data-preset="wkn"]'))
    saved(a)
    P.tap(a.locator('#presets [data-preset="fs"]'))
    saved(a)
    P.done("Fill in -> name -> two preset chips; each chip saves")
    shot(a, "03-my-times-chips")
    check("weekly rules read back", "Mon–Fri after 8 PM" in a.locator("#my-rules").inner_text())

    P = Path("change_8pm_to_830")
    P.tap(a.locator("#my-rules li .rtext", has_text="Mon–Fri"))
    P.type(a.locator("#rule-from"), "20:30")
    expect(a.locator("#rule-text")).to_have_text("Mon–Fri after 8:30 PM")
    shot(a, "04-rule-editor")
    P.tap(a.locator("#rule-save"))
    saved(a)
    P.done("tap the rule, type the time, Save")
    check("the edited rule reads back", "Mon–Fri after 8:30 PM" in a.locator("#my-rules").inner_text())

    # ---- away for a stretch: from today through the coming Sunday, so this weekend is out ----
    today = dt.datetime.now(CHI).date()
    away_end = next_weekday(today, 6)
    sat1 = next_weekday(today, 5)
    sat2 = next_weekday(away_end + dt.timedelta(days=1), 5)
    P = Path("away_for_a_stretch")
    P.tap(a.locator("#away-stretch"))
    P.type(a.locator("#day-from"), today.isoformat())
    P.type(a.locator("#day-to"), away_end.isoformat())
    shot(a, "05-away-stretch")
    P.tap(a.locator("#day-away"))
    saved(a)
    P.done("button -> two dates -> Away (dates typed here; a phone shows its date picker)")
    check("the stretch reads back", "Away" in a.locator("#my-days").inner_text())

    P = Path("one_day_from_the_month")
    wed = next_weekday(away_end + dt.timedelta(days=1), 2)
    if wed.month != today.month:
        a.locator(".sheet-body .mnav button[aria-label='Next month']").tap()
    P.tap(a.locator(f'.sheet-body .month .day[data-day="{wed.isoformat()}"]'))
    P.tap(a.locator("#day-away"))
    saved(a)
    P.done("tap a day in your month -> Not free")
    check("the single day reads back", "Not free" in a.locator("#my-days").inner_text())
    shot(a, "06-my-month")
    a.locator("#my-done").tap()
    expect(a.locator("#sheet")).to_be_hidden()

    # ---- Blake, New York, opens the link fresh ----
    B = browser.new_context(**PHONE, timezone_id="America/New_York")
    B.grant_permissions(["clipboard-read", "clipboard-write"], origin=BASE)
    b = B.new_page()
    P = Path("first_minute_blake")
    b.goto(url)
    P.tap(b.locator("#dock-me"))
    P.tap(b.locator('.names button[data-name="Blake"]'))
    P.tap(b.locator('#presets [data-preset="wke"]'))
    saved(b)
    P.tap(b.locator('#presets [data-preset="wkn"]'))
    saved(b)
    P.tap(b.locator("#my-rules li", has_text="Mon–Fri").locator(".seg button", has_text="Maybe"))
    saved(b)
    P.done("Fill in -> name -> Weekends + Weeknights, weeknights marked maybe")
    check("Blake's weeknights are a maybe", b.locator("#my-rules li", has_text="Mon–Fri").locator("[aria-pressed=true]").inner_text() == "Maybe")
    b.locator("#my-done").tap()

    # ---- best time, seen from Chicago ----
    a.reload()
    expect(a.locator("#best ol li").first).to_be_visible()
    best = a.locator("#best ol li").first.inner_text()
    sat2_text = f"{sat2.strftime('%a')}, {sat2.strftime('%b')} {sat2.day}"
    check(f"best time is the Saturday after the away-stretch ({sat2_text}), both sure: got {best!r}", sat2_text in best and "2 sure" in best and "6 PM–12 AM" in best)
    check("the zone is named", "Central Time" in a.locator(".head .meta").inner_text())
    check("week starts on Sunday for en-US", a.locator(".month .wd").first.inner_text() == "S")
    cell = a.locator(f'.month .day[data-day="{sat1.isoformat()}"]')
    if cell.count():
        check("the away Saturday does not work", "t2" not in (cell.get_attribute("class") or ""))
    shot(a, "07-month-best")
    a.locator("#best").scroll_into_view_if_needed()
    shot(a, "08-best-times")

    # ---- lock it in ----
    P = Path("lock_it_in")
    P.tap(a.locator("#best ol li button.win").first)
    shot(a, "09-day-sheet")
    P.tap(a.locator(".winrow button", has_text="Lock in").first)
    P.tap(a.locator("#lock-label"))
    P.type(a.locator("#lock-label"), "Session 0")
    shot(a, "10-lock")
    P.tap(a.locator("#lock-go"))
    expect(a.locator("#ics")).to_be_visible()
    shot(a, "11-locked")
    ics_href = a.locator("#ics").get_attribute("href")
    r = fetch(a, ics_href)
    check("the .ics downloads as a calendar", r["status"] == 200 and r["type"].startswith("text/calendar") and "SUMMARY:" in r["text"])
    check("the Google link is a template link", "calendar.google.com/calendar/render?action=TEMPLATE" in a.locator("#gcal").get_attribute("href"))
    P.tap(a.locator("#copy-discord"))
    line = a.evaluate("navigator.clipboard.readText()")
    check("the Discord line uses Discord timestamps and the link", "<t:" in line and url in line and "Session 0" in line)
    P.done("best time -> Lock in -> name it -> Lock it in -> Copy for Discord")
    close_sheet(a)
    expect(a.locator("#next-session")).to_contain_text("Session 0")
    check("the locked day shows a lock", a.locator(f'.month .day[data-day="{sat2.isoformat()}"] .lock').count() == 1 or sat2.month != today.month)

    # ---- filter: everyone except Avery ----
    b.reload()
    b.locator("#people .chip", has_text="Avery").tap()
    expect(b.locator(".who .filter")).to_contain_text("Everyone except Avery")
    check("the count drops to one counted", "1 counted" in b.locator(".who h2").inner_text())
    shot(b, "12-filter")
    b.locator(".who .filter .link").tap()

    # ---- undo: Blake taps Avery's name by mistake ----
    P = Path("undo_wrong_name")
    before = json.loads(fetch(a, f"/api/hangout?id={ev_id}")["text"])
    avery_before = next(x for x in before["people"] if x["name"] == "Avery")
    b.locator("#dock-me").tap()
    b.locator("#not-me").tap()
    b.locator('.names button[data-name="Avery"]').tap()
    b.locator('#presets [data-preset="eve"]').tap()
    saved(b)
    P.tap(b.locator("#toast .toast-act"))
    expect(b.locator("#toast")).to_contain_text("Undone")
    after = json.loads(fetch(a, f"/api/hangout?id={ev_id}")["text"])
    avery_after = next(x for x in after["people"] if x["name"] == "Avery")
    check("undo puts Avery's times back", avery_after["rules"] == avery_before["rules"] and avery_after["days"] == avery_before["days"])
    P.done("one tap on Undo in the toast")
    b.locator("#not-me").tap()
    b.locator('.names button[data-name="Blake"]').tap()
    close_sheet(b)

    # ---- waiting and the nudge ----
    check("Cam is shown as waiting", "Waiting on Cam" in b.locator(".who .waiting").inner_text())
    b.locator("#nudge").tap()
    nudge = b.evaluate("navigator.clipboard.readText()")
    check("the nudge names who is missing and has the link", "Cam" in nudge and url in nudge)

    # ---- from New York the same session reads in Eastern time ----
    b.reload()
    check("New York sees its own zone named", "Eastern Time" in b.locator(".head .meta").inner_text())
    check("New York sees the 6 PM Chicago session at 7–9 PM", "7–9 PM" in b.locator("#next-session").inner_text())
    shot(b, "13-new-york")

    # ---- the link preview ----
    html = fetch(a, f"/hang/{ev_id}")["text"]
    check("the link preview carries the event name", f'<meta property="og:title" content="{NAME}"' in html)

    # ---- en-GB: 24-hour times, weeks from Monday ----
    G = browser.new_context(**dict(PHONE, locale="en-GB"), timezone_id="Europe/London")
    g = G.new_page()
    g.goto(url)
    expect(g.locator(".month .wd").first).to_be_visible()
    check("week starts on Monday for en-GB", g.locator(".month .wd").first.inner_text() == "M")
    check("24-hour clock for en-GB", re.search(r"\b\d{2}:\d{2}\b", g.locator("#next-session").inner_text()) is not None)
    G.close()

    report["event"] = url
    report["kept"] = KEEP
    for f in atexit_cleanup:
        f()
    browser.close()

print(json.dumps(report, indent=1))
