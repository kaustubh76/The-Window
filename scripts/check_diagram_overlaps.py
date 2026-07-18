#!/usr/bin/env python3
"""
Read-only verification gate for the regenerated Excalidraw diagram.
Asserts the diagram is schema-valid and overlap-free before a human opens it.

Usage:  python3 scripts/check_diagram_overlaps.py [path]   (default: canonical file)
Exit 0 = PASS, 1 = FAIL.
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "the_window_architecture.excalidraw")
ORIG = os.path.join(ROOT, "the_window_architecture.base.excalidraw")

doc = json.load(open(PATH))
els = [e for e in doc["elements"] if not e.get("isDeleted")]
by_id = {e["id"]: e for e in els}

CONTAINER_IDS = {"lane_actors", "lane_dash", "lane_svc", "lane_chain",
                 "band_circ", "band_demo", "band_host", "legend_box", "speedrun_box"}

def rect(e):
    return (e["x"], e["y"], e["x"] + e["width"], e["y"] + e["height"])

def is_node(e):
    return (e["type"] == "rectangle" and e["id"] not in CONTAINER_IDS
            and not e["id"].startswith("legend_sw") and not e["id"].endswith("_bg"))

def is_label(t):
    return (t["id"].endswith("_lbl") or
            (t.get("containerId") in by_id and by_id[t["containerId"]]["type"] == "arrow"))

nodes = [e for e in els if is_node(e)]
containers = [e for e in els if e["id"] in CONTAINER_IDS]
texts = [e for e in els if e["type"] == "text"]
arrows = [e for e in els if e["type"] == "arrow"]

def segments(a):
    x0, y0 = a["x"], a["y"]
    pts = [(x0 + px, y0 + py) for px, py in a["points"]]
    return list(zip(pts, pts[1:]))

def seg_rect_hit(seg, r, shrink=1.0):
    """does an axis-aligned segment pass through the interior of rect r?"""
    (ax, ay), (bx, by) = seg
    rx0, ry0, rx1, ry1 = r[0] + shrink, r[1] + shrink, r[2] - shrink, r[3] - shrink
    if rx1 <= rx0 or ry1 <= ry0:
        return False
    if abs(ay - by) < 0.5:   # horizontal
        y = ay
        if not (ry0 < y < ry1): return False
        lo, hi = sorted((ax, bx))
        return lo < rx1 and hi > rx0
    if abs(ax - bx) < 0.5:   # vertical
        x = ax
        if not (rx0 < x < rx1): return False
        lo, hi = sorted((ay, by))
        return lo < ry1 and hi > ry0
    return False   # non-orthogonal handled elsewhere

def rects_overlap(a, b, pad=0.5):
    return (a[0] < b[2] - pad and a[2] > b[0] + pad and
            a[1] < b[3] - pad and a[3] > b[1] + pad)

def contains(outer, inner, pad=-1):
    return (outer[0] <= inner[0] + (-pad) and outer[1] <= inner[1] + (-pad) and
            outer[2] >= inner[2] - (-pad) and outer[3] >= inner[3] - (-pad))

fails = []
warns = []

# ---- A. schema / references ----
ids = [e["id"] for e in els]
if len(ids) != len(set(ids)):
    from collections import Counter
    dup = [i for i, c in Counter(ids).items() if c > 1]
    fails.append(f"duplicate ids: {dup}")
for e in els:
    for key in ("startBinding", "endBinding"):
        b = e.get(key)
        if b and b.get("elementId") and b["elementId"] not in by_id:
            fails.append(f"{e['id']}.{key} -> missing {b['elementId']}")
    if e.get("boundElements"):
        for b in e["boundElements"]:
            if b.get("id") not in by_id:
                fails.append(f"{e['id']}.boundElements -> missing {b['id']}")
for t in texts:
    cid = t.get("containerId")
    if cid and cid not in by_id:
        fails.append(f"text {t['id']}.containerId -> missing {cid}")

# reciprocity: arrow bound to boxes, boxes list arrow
for a in arrows:
    for key in ("startBinding", "endBinding"):
        b = a.get(key)
        if b and b.get("elementId"):
            box = by_id.get(b["elementId"])
            be = (box.get("boundElements") or []) if box else []
            if not any(x.get("id") == a["id"] for x in be):
                warns.append(f"reciprocity: {b['elementId']} missing back-ref to arrow {a['id']}")

# ---- orthogonality ----
nonortho = []
for a in arrows:
    for seg in segments(a):
        (ax, ay), (bx, by) = seg
        if abs(ax - bx) > 0.5 and abs(ay - by) > 0.5:
            nonortho.append(a["id"]); break
if nonortho:
    fails.append(f"non-orthogonal arrows: {sorted(set(nonortho))}")

# ---- B. geometry ----
# label -> own arrow
def own_arrow(t):
    if t["id"].endswith("_lbl"):
        return t["id"][:-4]
    if t.get("containerId") in by_id and by_id[t["containerId"]]["type"] == "arrow":
        return t["containerId"]
    return None

# readability model:
#   B1a  an arrow LINE crossing static text (box/lane/band titles, legend, headers) -> defect
#   B1b  an arrow LABEL overlapping static text -> defect (label unreadable)
#   B1c  an arrow LABEL overlapping another arrow label -> defect
#   (a label sitting over an arrow LINE is fine: it carries an opaque backing rect)
static_texts = [t for t in texts if not is_label(t)]
label_texts = [t for t in texts if is_label(t)]

# GUARD: a bound label (containerId set to an arrow) is re-centred by Excalidraw onto the arrow's
# arc-midpoint at RENDER time, discarding its stored x,y. Our overlap checks read stored x,y, so any
# still-bound label makes this whole check lie. Every arrow label must be detached (containerId=null).
still_bound = [t["id"] for t in label_texts if t.get("containerId")]
if still_bound:
    fails.append(f"BOUND labels (will re-center on render, must be detached): {len(still_bound)} -> {still_bound[:12]}")

lineXtext = []          # B1a
for t in static_texts:
    tr = rect(t)
    for a in arrows:
        for seg in segments(a):
            if seg_rect_hit(seg, tr, shrink=1.5):
                lineXtext.append((a["id"], t["id"]))
                break
if lineXtext:
    fails.append(f"ARROW LINE x static TEXT: {len(lineXtext)}")

lblXtext = []           # B1b
for lb in label_texts:
    for t in static_texts:
        if rects_overlap(rect(lb), rect(t), pad=1):
            lblXtext.append((lb["id"], t["id"]))
if lblXtext:
    fails.append(f"LABEL x static TEXT: {len(lblXtext)}")

lblXlbl = []            # B1c
for i in range(len(label_texts)):
    for j in range(i + 1, len(label_texts)):
        if rects_overlap(rect(label_texts[i]), rect(label_texts[j]), pad=1):
            lblXlbl.append((label_texts[i]["id"], label_texts[j]["id"]))
if lblXlbl:
    fails.append(f"LABEL x LABEL: {len(lblXlbl)}")
tXa = lineXtext  # for the summary line

# B2 arrow through node interior (exclude near own endpoints' box)
aXbox = []
for a in arrows:
    own = set()
    for key in ("startBinding", "endBinding"):
        b = a.get(key)
        if b and b.get("elementId"):
            own.add(b["elementId"])
    for n in nodes:
        if n["id"] in own:
            continue
        for seg in segments(a):
            if seg_rect_hit(seg, rect(n), shrink=1.5):
                aXbox.append((a["id"], n["id"]))
                break
if aXbox:
    fails.append(f"ARROW through NODE interior: {len(aXbox)}")

# B3 node <-> node overlap
nXn = []
for i in range(len(nodes)):
    for j in range(i + 1, len(nodes)):
        if rects_overlap(rect(nodes[i]), rect(nodes[j]), pad=1):
            nXn.append((nodes[i]["id"], nodes[j]["id"]))
if nXn:
    fails.append(f"NODE x NODE overlaps: {len(nXn)}")

# B4 each node inside some container
outside = []
for n in nodes:
    if not any(contains(rect(c), rect(n)) for c in containers):
        outside.append(n["id"])
if outside:
    warns.append(f"nodes not inside any container: {outside}")

# B5 arrow <-> arrow colinear same-direction overlap
def norm_segs():
    hs = []; vs = []
    for a in arrows:
        for seg in segments(a):
            (ax, ay), (bx, by) = seg
            if abs(ay - by) < 0.5 and abs(ax - bx) >= 0.5:
                hs.append((round(ay), min(ax, bx), max(ax, bx), a["id"]))
            elif abs(ax - bx) < 0.5 and abs(ay - by) >= 0.5:
                vs.append((round(ax), min(ay, by), max(ay, by), a["id"]))
    return hs, vs
hs, vs = norm_segs()
aXa = []
for arrset in (hs, vs):
    for i in range(len(arrset)):
        for j in range(i + 1, len(arrset)):
            c1, lo1, hi1, id1 = arrset[i]; c2, lo2, hi2, id2 = arrset[j]
            if id1 == id2: continue
            if abs(c1 - c2) <= 6 and lo1 < hi2 - 6 and hi1 > lo2 + 6:
                aXa.append((id1, id2, c1))
if aXa:
    warns.append(f"ARROW x ARROW colinear overlaps: {len(aXa)}")

# ---- C. content parity vs original ----
orig = json.load(open(ORIG))
orig_ids = {e["id"] for e in orig["elements"] if not e.get("isDeleted")}
missing = orig_ids - set(ids)
if missing:
    fails.append(f"MISSING original ids: {sorted(missing)}")
# text parity
orig_txt = {e["id"]: e.get("text") for e in orig["elements"] if e["type"] == "text" and not e.get("isDeleted")}
changed = [i for i, s in orig_txt.items() if i in by_id and by_id[i].get("text") != s]
if changed:
    warns.append(f"changed original text on: {changed}")

# ---- report ----
print(f"== checking {os.path.basename(PATH)} ==")
print(f"elements={len(els)} nodes={len(nodes)} arrows={len(arrows)} texts={len(texts)} containers={len(containers)}")
print(f"[B1a] arrow-line x text: {len(lineXtext)}", "  e.g. " + str(lineXtext[:6]) if lineXtext else "")
print(f"[B1b] label x text     : {len(lblXtext)}", "  e.g. " + str(lblXtext[:6]) if lblXtext else "")
print(f"[B1c] label x label    : {len(lblXlbl)}", "  e.g. " + str(lblXlbl[:6]) if lblXlbl else "")
print(f"[B2]  arrow x node int : {len(aXbox)}", "  e.g. " + str(aXbox[:6]) if aXbox else "")
print(f"[B3]  node x node      : {len(nXn)}", "  e.g. " + str(nXn[:6]) if nXn else "")
print(f"[B5]  arrow x arrow    : {len(aXa)}", "  e.g. " + str(aXa[:8]) if aXa else "")
print()
if warns:
    print("WARN:")
    for w in warns: print("  -", w)
if fails:
    print("FAIL:")
    for f in fails: print("  -", f)
    sys.exit(1)
print("PASS ✓  (no blocking overlaps)")
sys.exit(0)
