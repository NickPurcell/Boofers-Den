"""Rebuild the class tables in sections/jpesus/holotable/rules.js (CLASS_TABLE, CLASS_RESOURCES) from SW5e.

    curl -o class.json https://sw5eapi.azurewebsites.net/api/class
    python3 tests/holotable_gen_classes.py class.json out.js   # then paste out.js over the two constants
"""
# Builds rules.js's class-table data from SW5e's /api/class export (class.json, fetched from sw5eapi.azurewebsites.net).
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
SKIP = {"Level", "Proficiency Bonus", "Features", "Force Points", "Tech Points", "Max Power Level"}
def cell(v):
    v = (v or "").replace("�", "").strip()
    return "" if v in ("-", "—") else v
table = {}
for c in sorted(d, key=lambda c: c["name"]):
    heads = [h for h in json.loads(c["levelChangeHeadersJson"]) if h not in SKIP]
    lc = c["levelChanges"]
    table[c["name"]] = {h: [cell(lc[str(L)].get(h)) for L in range(1, 21)] for h in heads}

def nums(col, unlimited=99):
    return [unlimited if v.lower() == "unlimited" else int(v) if v.isdigit() else 0 for v in col]
def steps(start, at=(5, 9, 13, 17), first=1):   # n uses from `first`, +1 at each level in `at`
    return [0 if L < first else start + sum(1 for a in at if L >= a) for L in range(1, 21)]
def by_level(pairs):   # [(from_level, value), ...]
    return [max([v for f, v in pairs if L >= f] or [0]) for L in range(1, 21)]

T = table
presets = {
    "Berserker": [dict(key="rage", name="Rages", max=nums(T["Berserker"]["Rages"]), refill="long")],
    "Consular": [dict(key="force-shield", name="Force Shield", max=steps(2, first=2), refill="long")],
    "Engineer": [dict(key="potent-aptitude", name="Potent Aptitude", max=steps(2), die=T["Engineer"]["Potent Aptitude"], refill="short")],
    "Fighter": [
        dict(key="superiority", name="Superiority dice", max=nums(T["Fighter"]["Superiority Dice Quantity"]), die=T["Fighter"]["Superiority Dice Size"], refill="short"),
        dict(key="second-wind", name="Second Wind", max=[1] * 20, refill="short"),
        dict(key="action-surge", name="Action Surge", max=by_level([(2, 1), (17, 2)]), refill="short"),
        dict(key="indomitable", name="Indomitable", max=by_level([(9, 1), (13, 2), (17, 3)]), refill="long"),
    ],
    "Guardian": [dict(key="channel-the-force", name="Channel the Force", max=steps(2), refill="short")],
    "Monk": [dict(key="focus", name="Focus points", max=nums(T["Monk"]["Focus Points"]), refill="short")],
    "Scholar": [dict(key="superiority-scholar", name="Superiority dice (Scholar)", max=nums(T["Scholar"]["Superiority Dice Quantity"]), die=T["Scholar"]["Superiority Dice Size"], refill="short")],
    "Sentinel": [dict(key="ideal-manifests", name="Ideal manifests", max=nums(T["Sentinel"]["Ideal Manifests"]), refill="long")],
}
for cls, ps in presets.items():
    for p in ps:
        p["max"] = {"class": cls, "levels": p["max"]}
        if "die" in p: p["die"] = {"class": cls, "levels": [x if x.startswith("d") else "" for x in p["die"]]}
js = ("  // ---- class tables (audit 3.2-3.11), generated from SW5e's class data (/api/class, levelChanges) by\n"
      "  // gen_classes.py: each class's table columns by level (spell-point columns are left to casterInfo), and the\n"
      "  // spendable uses each class gets, in the combat view's resource shape (max / die read at the class level).\n"
      "  const CLASS_TABLE = " + json.dumps(table, ensure_ascii=False, separators=(",", ":")) + ";\n"
      "  const CLASS_RESOURCES = " + json.dumps(presets, ensure_ascii=False, separators=(",", ":")) + ";\n")
open(sys.argv[2], "w", encoding="utf-8").write(js)
print(len(js), "bytes")
for cls, ps in presets.items():
    for p in ps: print(cls, p["key"], p["max"]["levels"], p.get("die", {}).get("levels", "")[:5] if p.get("die") else "")
