#!/usr/bin/env python3
"""
Regenerate the canonical `the_window_architecture.excalidraw` with a clean layout.

Strategy: LOAD the hand-authored BASE scene (`the_window_architecture.base.excalidraw`),
FREEZE every element's content / style / id / seed, and mutate only the GEOMETRY layer —
box x/y (sizes unchanged), title positions, container sizes, and fully re-routed orthogonal
arrows through dedicated channels so no arrow crosses box text and no two arrows overlap.
Then append a legend, a hosting/automation overlay, and a "why this wins a speedrun" callout.
Writes the CANONICAL `the_window_architecture.excalidraw` (the base is the editable input; keep
them separate so re-running stays idempotent). Validate with scripts/check_diagram_overlaps.py.

Run:  python3 scripts/regen_architecture_diagram.py
"""
import json, os, copy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC  = os.path.join(ROOT, "the_window_architecture.base.excalidraw")
OUT  = os.path.join(ROOT, "the_window_architecture.excalidraw")
UPDATED = 1720000000000

# ----------------------------------------------------------------------------- config
# Column left-x (box widths are kept from the file). Gutters are the empty space between.
AX, BX, C1X, C2X, SPANX, DX = 120, 520, 960, 1290, 960, 2040
LANE_TOP = 232
ROW_GAP  = 56
TRACK    = 18
TITLE_OFF = -36       # lane/band title offset above its container (keeps titles clear of avenues)
# vertical routing channels (centre x). C|D gutter is WIDE (1540..2040): arrows in the left half
# (V_CD tracks), the numbered-flow LABELS in a clear column on the right (LABEL_COL) — so labels sit
# beside the arrow bundle, never on it.
CH = {"V_left": 75, "V_AB": 470, "V_BC": 900, "V_C": 1250, "V_CD": 1684, "V_right": 2600}
LABEL_COL = 1916      # label column x-centre, right of the arrow bundle, left of the chain boxes
H_TOP  = 197          # clear avenue above all lane boxes (titles ~158-178, boxes start at LANE_TOP=232)
H_TOP2 = 212          # second top-avenue track

# lane skeleton: which boxes, in which column, in order (semantic regroup of services)
LANES = [
    {"id": "lane_actors", "title": "lane_actors_t", "stroke": "#e8590c",
     "cols": {AX: ["a_lenders", "a_borrower", "a_admin", "a_operator", "a_public", "a_guard", "a_leak"]}},
    {"id": "lane_dash", "title": "lane_dash_t", "stroke": "#1971c2",
     "cols": {BX: ["d_app", "d_live", "d_mock", "d_env"]}},
    {"id": "lane_svc", "title": "lane_svc_t", "stroke": "#2f9e44",
     "cols": {C1X: ["s_control", "s_indexer"],
              C2X: ["s_keeper", "s_agents", "s_admin", "s_operator"]},
     "span": ["s_lib", "s_eerc"]},          # full-width rows below both sub-columns
    {"id": "lane_chain", "title": "lane_chain_t", "stroke": "#6741d9",
     "cols": {DX: ["c_eerc", "c_registry", "c_auction", "c_oracle", "c_vault", "c_book", "c_verifiers"]}},
]
BANDS = [
    {"id": "band_circ", "title": "band_circ_t", "row": {"z_solvency": 960, "z_pocd": 1340, "z_art": 1720}},
    {"id": "band_demo", "title": "band_demo_t",
     "row": {"m_demo": 120, "m_auto": 500, "m_verify": 880, "m_deploy": 1240, "m_profile": 1620}},
]

# ----------------------------------------------------------------------------- load
scene = json.load(open(SRC))
els = scene["elements"]
by_id = {e["id"]: e for e in els}
pos = {}   # id -> (x, y)  (w/h unchanged, read from element)

def W(i): return by_id[i]["width"]
def Hh(i): return by_id[i]["height"]

# ----------------------------------------------------------------------------- layout: boxes
def stack(ids, x, y0):
    y = y0
    for i in ids:
        pos[i] = (x, y)
        y += Hh(i) + ROW_GAP
    return y - ROW_GAP  # bottom of last box

lane_bottom = {}
for lane in LANES:
    bottoms = []
    for x, ids in lane["cols"].items():
        bottoms.append(stack(ids, x, LANE_TOP))
    if lane.get("span"):
        y = max(bottoms) + ROW_GAP
        for i in lane["span"]:
            pos[i] = (SPANX, y)
            y += Hh(i) + ROW_GAP
        bottoms.append(y - ROW_GAP)
    lane_bottom[lane["id"]] = max(bottoms)

LANES_BOTTOM = max(lane_bottom.values())
H_BUS = LANES_BOTTOM + 34                        # print-bus avenue below every lane box
BAND_UP = H_BUS + 36                             # band->lane routing avenue (below bus, above circuits title)
BAND_CIRC_TOP = H_BUS + 100

# bands
for i, x in BANDS[0]["row"].items():
    pos[i] = (x, BAND_CIRC_TOP + 20)
band_circ_bottom = BAND_CIRC_TOP + 20 + max(Hh(i) for i in BANDS[0]["row"]) + 20
BAND_DEMO_TOP = band_circ_bottom + 60
for i, x in BANDS[1]["row"].items():
    pos[i] = (x, BAND_DEMO_TOP + 20)
band_demo_bottom = BAND_DEMO_TOP + 20 + max(Hh(i) for i in BANDS[1]["row"]) + 20

# ----------------------------------------------------------------------------- apply box + title moves
def move_box(i, nx, ny):
    e = by_id[i]
    dx, dy = nx - e["x"], ny - e["y"]
    e["x"], e["y"] = nx, ny
    t = by_id.get(i + "_t")
    if t:
        t["x"] += dx
        t["y"] += dy

for i, (x, y) in pos.items():
    move_box(i, x, y)

# resize lane / band containers to wrap children (+pad) and reposition their titles
PAD = 24
def wrap(container_id, ids, title_y_off=TITLE_OFF):
    xs0 = [by_id[i]["x"] for i in ids]; ys0 = [by_id[i]["y"] for i in ids]
    xs1 = [by_id[i]["x"] + W(i) for i in ids]; ys1 = [by_id[i]["y"] + Hh(i) for i in ids]
    x0, y0, x1, y1 = min(xs0) - PAD, min(ys0) - PAD, max(xs1) + PAD, max(ys1) + PAD
    c = by_id[container_id]
    c["x"], c["y"], c["width"], c["height"] = x0, y0, x1 - x0, y1 - y0
    t = by_id.get(container_id + "_t")
    if t:
        t["x"], t["y"] = x0 + 2, y0 + title_y_off
    return (x0, y0, x1, y1)

for lane in LANES:
    ids = [i for ids in lane["cols"].values() for i in ids] + lane.get("span", [])
    wrap(lane["id"], ids)
for band in BANDS:
    wrap(band["id"], list(band["row"].keys()))

# move header title/tagline to top-left (unchanged x, keep)
by_id["title"]["x"], by_id["title"]["y"] = 40, 20
by_id["tagline"]["x"], by_id["tagline"]["y"] = 40, 52

# ----------------------------------------------------------------------------- geometry helpers
def L(i): return by_id[i]["x"]
def R(i): return by_id[i]["x"] + W(i)
def T(i): return by_id[i]["y"]
def B(i): return by_id[i]["y"] + Hh(i)
def CX(i): return by_id[i]["x"] + W(i) / 2
def CY(i): return by_id[i]["y"] + Hh(i) / 2

def edge(i, side, frac=0.5):
    if side == "L": return (L(i), T(i) + frac * Hh(i))
    if side == "R": return (R(i), T(i) + frac * Hh(i))
    if side == "T": return (L(i) + frac * W(i), T(i))
    if side == "B": return (L(i) + frac * W(i), B(i))
    raise ValueError(side)

def vx(name, t=0): return CH[name] + t * TRACK

# orthogonalize a rough waypoint list: insert corners so every segment is H or V
def ortho(points):
    out = [points[0]]
    for p in points[1:]:
        x0, y0 = out[-1]
        if abs(p[0] - x0) > 0.5 and abs(p[1] - y0) > 0.5:
            out.append((p[0], y0))   # corner: horizontal first
        out.append(p)
    # dedupe consecutive
    dd = [out[0]]
    for p in out[1:]:
        if abs(p[0] - dd[-1][0]) > 0.5 or abs(p[1] - dd[-1][1]) > 0.5:
            dd.append(p)
    return dd

# route builders (return absolute waypoint lists) --------------------------------
def hop(src, sside, gx, dst, dside, sfrac=0.5, dfrac=0.5):
    """exit src side -> vertical channel gx -> into dst side"""
    p0, p1 = edge(src, sside, sfrac), edge(dst, dside, dfrac)
    return [p0, (gx, p0[1]), (gx, p1[1]), p1]

def avenue(src, sside, gx1, ay, gx2, dst, dside, sfrac=0.5, dfrac=0.5):
    p0, p1 = edge(src, sside, sfrac), edge(dst, dside, dfrac)
    return [p0, (gx1, p0[1]), (gx1, ay), (gx2, ay), (gx2, p1[1]), p1]

def straightV(src, sside, dst, dside, sfrac=0.5, dfrac=0.5):
    p0, p1 = edge(src, sside, sfrac), edge(dst, dside, dfrac)
    return [p0, (p0[0], p1[1]), p1]

def riser(src, dst, rx, sside="T", dside="B", sfrac=0.5, dfrac=0.5):
    """band box -> up a gutter -> into lane box bottom"""
    p0, p1 = edge(src, sside, sfrac), edge(dst, dside, dfrac)
    return [p0, (rx, p0[1]), (rx, p1[1]), p1]

def band_up(src, sfrac, clear_x, tgt, tgt_x, up_y):
    """band box top -> up a box-clear column -> along an avenue below the lanes -> up into target bottom
    at x=tgt_x. tgt may be a node or a lane/band container (enters container bottom edge)."""
    p0 = edge(src, "T", sfrac)
    if tgt.startswith(("lane_", "band_")):
        c = by_id[tgt]; ty = c["y"] + c["height"]
    else:
        ty = B(tgt)
    return [p0, (p0[0], p0[1] - 14), (clear_x, p0[1] - 14), (clear_x, up_y),
            (tgt_x, up_y), (tgt_x, ty)]

# ----------------------------------------------------------------------------- routes
# id -> (waypoints, label_seg_pref, detach_label)
# label_seg_pref: 'H' prefer longest horizontal segment, 'V' vertical
def build_routes():
    r = {}
    # actor -> dashboard (adjacent, via V_AB)
    r["x1"] = (hop("a_lenders", "R", vx("V_AB", -1), "d_app", "L", 0.4, 0.35), "H")
    r["x2"] = (hop("a_borrower", "R", vx("V_AB", 1), "d_app", "L", 0.5, 0.75), "H")
    # actor keys -> services (long, via avenues / low crossing)
    r["x3"] = (avenue("a_admin", "R", vx("V_AB", 0), B("d_env") + 34, vx("V_BC", 0),
                      "s_lib", "L", 0.5, 0.5), "H")               # cross B below d_env
    r["x4"] = (avenue("a_operator", "L", vx("V_left"), H_TOP2, vx("V_CD", -4),
                      "s_operator", "R", 0.4, 0.35), "H")          # over the far-left margin + top
    # dashboard internal
    r["d1"] = (straightV("d_app", "B", "d_live", "T", 0.4, 0.4), "V")
    r["d2"] = (hop("d_app", "L", vx("V_AB", -2), "d_mock", "L", 0.7, 0.5), "V")  # skip d_live via V_AB gutter
    # dashboard <-> services
    r["w1"] = (hop("d_live", "R", vx("V_BC", -1), "s_control", "L", 0.5, 0.5), "H")
    r["r2"] = (hop("s_indexer", "L", vx("V_BC", 1), "d_live", "R", 0.5, 0.65), "H")
    r["g1"] = (hop("s_eerc", "L", vx("V_BC", 2), "d_env", "R", 0.4, 0.6), "H")
    # services internal
    r["w2"] = (hop("s_control", "R", vx("V_C", -1), "s_lib", "T", 0.5, 0.3), "V")   # down V_C into s_lib top
    r["w3"] = (straightV("s_lib", "B", "s_eerc", "T", 0.5, 0.5), "V")
    # services (C2/span) -> chain via the wide V_CD gutter; each on a distinct track (no arrow overlap)
    r["e1"] = (hop("s_lib", "R", vx("V_CD", -7), "c_eerc", "L", 0.55, 0.7), "V")
    r["w4"] = (hop("s_lib", "R", vx("V_CD", -6), "c_registry", "L", 0.3, 0.5), "V")  # lane-bound -> registry
    r["n7"] = (hop("s_lib", "R", vx("V_CD", -5), "c_vault", "L", 0.42, 0.3), "H")
    r["n1"] = (hop("s_keeper", "R", vx("V_CD", -3), "c_auction", "L", 0.35, 0.15), "V")
    # s_admin has 5 arrows (n5/n6/n9/n4 exit, n3 enters) — give each a distinct edge fraction
    r["n5"] = (hop("s_admin", "R", vx("V_CD", -2), "c_oracle", "L", 0.15, 0.4), "H")
    r["n2"] = (hop("s_agents", "R", vx("V_CD", -1), "c_auction", "L", 0.5, 0.62), "H")
    r["n3"] = (hop("c_auction", "L", vx("V_CD", 0), "s_admin", "R", 0.9, 0.35), "H")   # chain -> svc
    r["n8"] = (hop("s_operator", "R", vx("V_CD", 2), "c_vault", "L", 0.8, 0.68), "H")
    r["n6"] = (hop("s_admin", "R", vx("V_CD", 3), "c_book", "L", 0.5, 0.3), "V")
    r["n9"] = (hop("s_admin", "R", vx("V_CD", 4), "c_book", "L", 0.85, 0.58), "V")
    r["n10"] = (hop("s_keeper", "R", vx("V_CD", 5), "c_book", "L", 0.65, 0.82), "V")
    r["n4"] = (hop("s_admin", "R", vx("V_CD", 6), "s_eerc", "R", 0.65, 0.45), "V")     # svc-internal, down
    # chain -> indexer (R1) over the top into s_indexer's right edge (avoids s_control/s_keeper)
    p_r1s = edge("c_eerc", "L", 0.25)
    r["r1"] = ([p_r1s, (vx("V_CD", 1), p_r1s[1]), (vx("V_CD", 1), H_TOP),
                (vx("V_C", 0), H_TOP), (vx("V_C", 0), CY("s_indexer")),
                (R("s_indexer"), CY("s_indexer"))], "H")
    # chain internal (right-side channel V_right)
    r["i1"] = (hop("c_book", "R", vx("V_right", -1), "c_vault", "R", 0.5, 0.6), "V")
    r["i2"] = (hop("c_oracle", "R", vx("V_right", 0), "c_auction", "R", 0.4, 0.6), "V")
    r["i3"] = (hop("c_oracle", "R", vx("V_right", 1), "c_verifiers", "R", 0.6, 0.4), "V")
    r["i4"] = (hop("c_vault", "R", vx("V_right", 2), "c_verifiers", "R", 0.4, 0.6), "V")
    # x5 RatePrinted -> public: exit c_oracle LEFT into V_CD, down to the print-bus, across, up into a_public
    p_ora, p_pub = edge("c_oracle", "L", 0.32), edge("a_public", "L", 0.5)
    r["x5"] = ([p_ora, (vx("V_CD", 1), p_ora[1]), (vx("V_CD", 1), H_BUS),
                (vx("V_left"), H_BUS), (vx("V_left"), p_pub[1]), p_pub], "H", True)
    # band -> lane risers via the band-avenue (clear_x columns avoid the band title span; detach labels)
    r["g2"] = (band_up("z_art", 0.4, 1980, "s_eerc", 1300, BAND_UP), "V", True)
    r["g3"] = (band_up("z_pocd", 0.6, 1560, "c_verifiers", 2230, BAND_UP - 10), "V", True)
    r["g4"] = (band_up("z_solvency", 0.5, 915, "c_verifiers", 2420, BAND_UP + 10), "V", True)
    r["g5"] = (band_up("m_auto", 0.5, 675, "lane_svc", 1150, BAND_UP - 22), "V", True)
    r["g6"] = (band_up("m_deploy", 0.5, 1710, "lane_chain", 2460, BAND_UP + 22), "V", True)
    return r

routes = build_routes()

# ----------------------------------------------------------------------------- apply arrow routes
def set_arrow(aid, waypoints, detach=False):
    a = by_id[aid]
    pts = ortho(waypoints)
    x0, y0 = pts[0]
    a["x"], a["y"] = x0, y0
    rel = [[round(px - x0, 2), round(py - y0, 2)] for px, py in pts]
    a["points"] = rel
    xs = [p[0] for p in rel]; ys = [p[1] for p in rel]
    a["width"] = max(xs) - min(xs)
    a["height"] = max(ys) - min(ys)
    a["elbowed"] = False
    a["roundness"] = None
    a["startBinding"] = a.get("startBinding") or {}
    a["endBinding"] = a.get("endBinding") or {}
    if a.get("startBinding"): a["startBinding"]["gap"] = 6; a["startBinding"]["focus"] = 0
    if a.get("endBinding"):   a["endBinding"]["gap"] = 6; a["endBinding"]["focus"] = 0
    return pts

# route all arrows, collect their point paths.
# DETACH EVERY LABEL (containerId=null): a bound label is re-centred by Excalidraw onto the arrow's
# arc-midpoint at render time, discarding our computed x,y — that was the "texts still overlap" bug.
arrow_pts = {}
for aid, spec in routes.items():
    arrow_pts[aid] = set_arrow(aid, spec[0])
    lbl = by_id.get(aid + "_lbl")
    if lbl:
        lbl["containerId"] = None
        lbl["textAlign"] = "left"
        lbl["verticalAlign"] = "top"
        a = by_id[aid]
        a["boundElements"] = [b for b in (a.get("boundElements") or []) if b.get("id") != lbl["id"]]

# ---- label placement --------------------------------------------------------
GUTTER_X = LABEL_COL     # numbered-flow labels stack in the clear column right of the arrow bundle
GUTTER_ARROWS = {"e1", "w4", "n7", "n1", "n5", "n2", "n3", "n8", "n6", "n9", "n10", "n4"}

def longest_seg(pts, orient):
    best, bl = None, -1
    for a, b in zip(pts, pts[1:]):
        if orient == "H" and abs(a[1] - b[1]) < 1: L = abs(a[0] - b[0])
        elif orient == "V" and abs(a[0] - b[0]) < 1: L = abs(a[1] - b[1])
        else: L = -1
        if L > bl: bl, best = L, (a, b)
    return best, bl

def init_label(aid, pts, pref):
    lbl = by_id.get(aid + "_lbl")
    if not lbl: return
    w, h = lbl["width"], lbl["height"]
    if aid in GUTTER_ARROWS:                     # pack in the wide C|D gutter, centred, y = run midpoint
        ys = [p[1] for p in pts]; cx, cy = GUTTER_X, (min(ys) + max(ys)) / 2
    elif aid == "x5":                            # on the print-bus, left of centre
        cx, cy = 520, H_BUS
    elif aid in ("g2", "g3", "g4", "g5", "g6"):  # on the band-avenue horizontal run
        seg, _ = longest_seg(pts, "H"); cx, cy = (seg[0][0] + seg[1][0]) / 2, seg[0][1]
    else:
        seg, L = longest_seg(pts, pref)
        if not seg or L <= 0: seg, _ = longest_seg(pts, "V" if pref == "H" else "H")
        if not seg: seg = (pts[0], pts[-1])
        cx, cy = (seg[0][0] + seg[1][0]) / 2, (seg[0][1] + seg[1][1]) / 2
    lbl["x"], lbl["y"] = cx - w / 2, cy - h / 2

for aid in routes:
    init_label(aid, arrow_pts[aid], routes[aid][1])

# pre-spread the gutter labels across the gutter's height (each kept on its own arrow's run)
def _midy(a): ys = [p[1] for p in arrow_pts[a]]; return (min(ys) + max(ys)) / 2
_gl = sorted([a for a in GUTTER_ARROWS if by_id.get(a + "_lbl")], key=_midy)
_ylo, _yhi = 300, 1240
for _k, _a in enumerate(_gl):
    ys = [p[1] for p in arrow_pts[_a]]; amin, amax = min(ys), max(ys)
    ty = _ylo + _k * (_yhi - _ylo) / max(1, len(_gl) - 1)
    ty = max(amin + 16, min(amax - 16, ty))          # keep the label on its arrow's vertical run
    lb = by_id[_a + "_lbl"]; lb["x"], lb["y"] = GUTTER_X - lb["width"] / 2, ty - lb["height"] / 2

# declutter: nudge labels vertically so none overlaps a box/lane title or another label
def bb(e, pad=0): return (e["x"] - pad, e["y"] - pad, e["x"] + e["width"] + pad, e["y"] + e["height"] + pad)
def ov(a, b): return a[0] < b[2] and a[2] > b[0] and a[1] < b[3] and a[3] > b[1]

label_els = [by_id[a + "_lbl"] for a in routes if by_id.get(a + "_lbl")]
static_els = [by_id[i + "_t"] for i in pos if by_id.get(i + "_t")]
static_els += [by_id[c["id"] + "_t"] for c in LANES + BANDS if by_id.get(c["id"] + "_t")]
static_els += [by_id["title"], by_id["tagline"]]

for _ in range(1500):
    moved = False
    for lb in label_els:
        r = bb(lb, 2)
        for st in static_els:
            if ov(r, bb(st, 1)):
                lb["y"] += -7 if lb["y"] + lb["height"] / 2 < st["y"] + st["height"] / 2 else 7
                moved = True; r = bb(lb, 2)
        for lb2 in label_els:
            if lb2 is lb: continue
            if ov(r, bb(lb2, 3)):
                mid, mid2 = lb["y"] + lb["height"] / 2, lb2["y"] + lb2["height"] / 2
                lb["y"] += -7 if mid <= mid2 else 7
                moved = True; r = bb(lb, 2)
    if not moved:
        break

# deterministic final pass: gutter labels all share x=GUTTER_X, so cascade them in y to guarantee
# zero overlap (the iterative nudge can leave a residual when the column is locally crowded)
gl = sorted([by_id[a + "_lbl"] for a in GUTTER_ARROWS if by_id.get(a + "_lbl")], key=lambda e: e["y"])
for k in range(1, len(gl)):
    min_y = gl[k - 1]["y"] + gl[k - 1]["height"] + 7
    if gl[k]["y"] < min_y:
        gl[k]["y"] = min_y

# opaque backing rects behind every arrow label (so a label reads cleanly over crossing lines)
label_bgs = []
BG_SEED = 8000
for lb in label_els:
    label_bgs.append({
        "id": lb["id"] + "_bg", "type": "rectangle",
        "x": lb["x"] - 4, "y": lb["y"] - 2, "width": lb["width"] + 8, "height": lb["height"] + 4,
        "angle": 0, "strokeColor": "transparent", "backgroundColor": "#ffffff", "fillStyle": "solid",
        "strokeWidth": 1, "strokeStyle": "solid", "roughness": 0, "opacity": 100, "groupIds": [],
        "frameId": None, "roundness": None, "seed": (BG_SEED := BG_SEED + 3), "version": 1,
        "versionNonce": BG_SEED, "isDeleted": False, "boundElements": None, "updated": UPDATED,
        "link": None, "locked": False})

# ----------------------------------------------------------------------------- new elements: legend + hosting overlay
SEED = 5000
def nseed():
    global SEED; SEED += 7; return SEED

def rect(id, x, y, w, h, bg, stroke="#1e1e1e", dashed=False, bound=None):
    return {"id": id, "type": "rectangle", "x": x, "y": y, "width": w, "height": h,
            "angle": 0, "strokeColor": stroke, "backgroundColor": bg, "fillStyle": "solid",
            "strokeWidth": 1, "strokeStyle": "dashed" if dashed else "solid", "roughness": 1,
            "opacity": 100, "groupIds": [], "frameId": None, "roundness": {"type": 3},
            "seed": nseed(), "version": 1, "versionNonce": nseed(), "isDeleted": False,
            "boundElements": bound or [], "updated": UPDATED, "link": None, "locked": False}

def text(id, x, y, s, size=11, color="#1e1e1e", w=None, align="left", container=None):
    lines = s.split("\n")
    ww = w if w else max(len(l) for l in lines) * size * 0.56
    hh = len(lines) * size * 1.25
    return {"id": id, "type": "text", "x": x, "y": y, "width": ww, "height": hh,
            "angle": 0, "strokeColor": color, "backgroundColor": "transparent", "fillStyle": "solid",
            "strokeWidth": 1, "strokeStyle": "solid", "roughness": 1, "opacity": 100, "groupIds": [],
            "frameId": None, "roundness": None, "seed": nseed(), "version": 1, "versionNonce": nseed(),
            "isDeleted": False, "boundElements": None, "updated": UPDATED, "link": None, "locked": False,
            "text": s, "originalText": s, "fontSize": size, "fontFamily": 1, "textAlign": align,
            "verticalAlign": "top", "containerId": container, "lineHeight": 1.25, "autoResize": True}

def arrow(id, pts, color, label=None, dashed=False, src=None, dst=None):
    x0, y0 = pts[0]
    rel = [[round(px - x0, 2), round(py - y0, 2)] for px, py in ortho(pts)]
    xs = [p[0] for p in rel]; ys = [p[1] for p in rel]
    be = []
    e = {"id": id, "type": "arrow", "x": x0, "y": y0, "width": max(xs)-min(xs), "height": max(ys)-min(ys),
         "angle": 0, "strokeColor": color, "backgroundColor": "transparent", "fillStyle": "solid",
         "strokeWidth": 1, "strokeStyle": "dashed" if dashed else "solid", "roughness": 1, "opacity": 100,
         "groupIds": [], "frameId": None, "roundness": None, "seed": nseed(), "version": 1,
         "versionNonce": nseed(), "isDeleted": False, "boundElements": be, "updated": UPDATED, "link": None,
         "locked": False, "points": rel, "lastCommittedPoint": None,
         "startBinding": {"elementId": src, "focus": 0, "gap": 6} if src else None,
         "endBinding": {"elementId": dst, "focus": 0, "gap": 6} if dst else None,
         "startArrowhead": None, "endArrowhead": "arrow", "elbowed": False}
    return e

new_elements = []

# --- Hosting & automation band (full width, bottom) ---
HB_TOP = band_demo_bottom + 60
host_boxes = [
    ("h_vercel",   120,  "VERCEL — static frontend", "dist → the-window-five.vercel.app\nlive-only build · browser holds NO keys", "#e7f5ff"),
    ("h_render_i", 470,  "RENDER — window-indexer", "window-indexer-w3pv.onrender.com\nread-only REST · rebuilds from Fuji", "#d3f9d8"),
    ("h_render_c", 820,  "RENDER — window-control", "window-control-opuo.onrender.com\nsingle write API · server-side proving", "#d3f9d8"),
    ("h_docker",  1170,  "DOCKER HUB image", "kaushtubh02/thewindow-backend\nbakes ABIs · 43113.json · zkeys", "#fff3bf"),
    ("h_gha",     1520,  "GITHUB ACTIONS — fuji-drivers", "24/7 chained runs (public repo, 4-vCPU)\nkeeper+agents+operator+admin · docker run", "#ffe3e3"),
    ("h_fuji",    1870,  "FUJI 43113 (live) / L1 43117", "C-Chain RPC · permissioned L1\nTxAllowList synced from MemberRegistry", "#ede7f6"),
]
HB_H = 96
for hid, hx, title, body, bg in host_boxes:
    new_elements.append(rect(hid, hx, HB_TOP + 22, 320, HB_H, bg))
    new_elements.append(text(hid + "_t", hx + 10, HB_TOP + 30, title + "\n" + body, size=11))
HB_BOTTOM = HB_TOP + 22 + HB_H
new_elements.append(rect("band_host", 100, HB_TOP - 6, 2110, HB_BOTTOM - HB_TOP + 28, "transparent", stroke="#5f3dc4", dashed=True))
new_elements.append(text("band_host_t", 102, HB_TOP - 32, "HOSTING & AUTOMATION (24/7) — Vercel · Render · Docker Hub · GitHub Actions · Fuji/L1", size=16, color="#5f3dc4"))

# hosting arrows (simple orthogonal, own bindings)
def hedge(i, side, frac=0.5):
    e = by_id.get(i) or next(x for x in new_elements if x["id"] == i)
    x, y, w, h = e["x"], e["y"], e["width"], e["height"]
    return {"L": (x, y+frac*h), "R": (x+w, y+frac*h), "T": (x+frac*w, y), "B": (x+frac*w, y+h)}[side]
HA = HB_TOP + 4   # avenue just above hosting boxes
def arr_top(src, dst, color, lift, sfrac=0.5, dfrac=0.5):
    p0, p1 = hedge(src, "T", sfrac), hedge(dst, "T", dfrac)
    return arrow(f"ha_{src}_{dst}", [p0, (p0[0], HA - lift), (p1[0], HA - lift), p1], color, src=src, dst=dst)
def arr_bot(src, dst, color, drop, sfrac=0.5, dfrac=0.5):
    p0, p1 = hedge(src, "B", sfrac), hedge(dst, "B", dfrac)
    return arrow(f"ha_{src}_{dst}", [p0, (p0[0], HB_BOTTOM + drop), (p1[0], HB_BOTTOM + drop), p1], color, src=src, dst=dst)
# Docker Hub image is pulled by both Render-control and GitHub Actions (top avenue, staggered exits)
new_elements.append(arr_top("h_docker", "h_render_c", "#5f3dc4", 40, sfrac=0.38))
new_elements.append(arr_top("h_docker", "h_gha", "#5f3dc4", 22, sfrac=0.62))
# Render-indexer and GH-Actions drivers both hit Fuji RPC (bottom avenue, staggered exits)
new_elements.append(arr_bot("h_render_i", "h_fuji", "#5f3dc4", 22, dfrac=0.38))
new_elements.append(arr_bot("h_gha", "h_fuji", "#5f3dc4", 40, dfrac=0.62))
# Vercel-served app talks to Render services (adjacent hop)
new_elements.append(arrow("ha_vercel_render", [hedge("h_vercel", "R"), hedge("h_render_i", "L")], "#5f3dc4", src="h_vercel", dst="h_render_i"))

# --- Legend / color key (below the hosting band, in clear open space) ---
LX, LY = 120, HB_BOTTOM + 84
leg_rows = [
    ("#2f9e44", "R  read path", "chain → indexer → dashboard (poll 3s · cached REST)"),
    ("#1971c2", "W  write path", "dashboard → Control API → lib → eerc-node → chain"),
    ("#6741d9", "E · i  eERC + on-chain", "member ops (register / wrap) · contract ↔ contract wiring"),
    ("#e8590c", "1–10  autonomous loop", "open → bid → decrypt → print → match → lock → fund → repay / seize"),
    ("#e03131", "g  artifacts / deploy", "circom build → verifier.sol · snarkjs proving"),
    ("#868e96", "dashed  key material / ops", "auditor & operator keys (env) · demo runners · trust boundary"),
]
COL_W, ROWH = 1000, 30
LEG_W, LEG_H = 2 * COL_W + 40, 44 + 3 * ROWH + 26
new_elements.append(rect("legend_box", LX, LY, LEG_W, LEG_H, "#f8f9fa", stroke="#495057"))
new_elements.append(text("legend_title", LX + 16, LY + 12,
                         "LEGEND — arrow groups & trust markers", size=14, color="#212529"))
for k, (color, head, desc) in enumerate(leg_rows):
    col, row = k // 3, k % 3
    cx = LX + 16 + col * COL_W
    ry = LY + 46 + row * ROWH
    new_elements.append(rect(f"legend_sw{k}", cx, ry + 2, 26, 14, color, stroke=color))
    new_elements.append(text(f"legend_h{k}", cx + 36, ry, head, size=11, color="#212529"))
    new_elements.append(text(f"legend_d{k}", cx + 236, ry, desc, size=11, color="#495057"))
new_elements.append(text("legend_leak", LX + 16, LY + LEG_H - 24,
                         "leak budget: amounts hidden (EGCT ciphertexts) · member addresses + rate ticks visible on-chain · "
                         "only plaintext surface = auditor key in services/lib/adminops.mjs",
                         size=10, color="#868e96"))

# --- "Why this wins a speedrun" callout (below the legend, open space) ---
SLX, SLY = LX, LY + LEG_H + 48
SL_W, SL_H = LEG_W, 224
new_elements.append(rect("speedrun_box", SLX, SLY, SL_W, SL_H, "#fff9db", stroke="#e8590c"))
new_elements.append(text("speedrun_title", SLX + 16, SLY + 12,
                         "WHY THIS WINS A SPEEDRUN — finished-and-true beats ambitious-and-broken", size=15, color="#d9480f"))
new_elements.append(text("speedrun_body", SLX + 16, SLY + 46,
    "● FINISHED & LIVE 24/7 — open the site and watch real Fuji txs print M-ONIA, each\n"
    "   Snowtrace-linked. No wallet needed to be convinced; the proof is public and on-chain.\n"
    "● A THESIS JUDGES ALREADY BELIEVE — observable borrowing kills lending markets (2008\n"
    "   discount-window stigma; SOFR exists for exactly this). On a transparent chain the machine\n"
    "   money market isn't worse — it's impossible. THE WINDOW makes it possible in ciphertext.\n"
    "● HITS ALL THREE JUDGING CRITERIA AT ONCE — value: M-ONIA = SOFR for the agent economy ·\n"
    "   complexity: homomorphic bid aggregation + on-chain Groth16 PoCD (chunked to fit EIP-170) ·\n"
    "   Avalanche: eERC encrypted balances end-to-end on Fuji 43113.\n"
    "● HONEST BY CONSTRUCTION — an accountable, rotatable auditor decrypts only aggregates; no\n"
    "   'nobody can see' overclaim. Maturity reads.",
    size=11, color="#343a40"))
new_elements.append(text("speedrun_closer", SLX + 16, SLY + SL_H - 26,
    "Machines will need to borrow. They will refuse to be watched doing it.", size=12, color="#d9480f"))

# ----------------------------------------------------------------------------- reciprocity + assemble
# ensure every arrow's label back-ref + src/dst boundElements are consistent
def ensure_bound(box_id, aid):
    e = by_id.get(box_id) or next((x for x in new_elements if x["id"] == box_id), None)
    if not e: return
    be = e.get("boundElements") or []
    if not any(b.get("id") == aid for b in be):
        be.append({"id": aid, "type": "arrow"})
    e["boundElements"] = be

for aid in routes:
    a = by_id[aid]
    for binding in (a.get("startBinding"), a.get("endBinding")):
        if binding and binding.get("elementId"):
            ensure_bound(binding["elementId"], aid)

# reciprocity for the new hosting-overlay arrows
for e in new_elements:
    if e["type"] == "arrow":
        for binding in (e.get("startBinding"), e.get("endBinding")):
            if binding and binding.get("elementId"):
                ensure_bound(binding["elementId"], e["id"])

# z-order: containers, nodes, titles+headers, arrows, then legend/host, labels last
order_containers = [l["id"] for l in LANES] + [b["id"] for b in BANDS]
order_nodes = [i for i in pos if not i.startswith(("lane_", "band_"))]
node_set = set(order_nodes)
titles = [e["id"] for e in els if e["type"] == "text" and e["id"].endswith("_t")]
headers = ["title", "tagline"]
arrows_ids = list(routes.keys())
labels = [a + "_lbl" for a in routes if by_id.get(a + "_lbl")]

emit = []
seen = set()
def push(i):
    e = by_id.get(i)
    if e and i not in seen:
        emit.append(e); seen.add(i)

for i in order_containers: push(i)
for i in order_nodes: push(i)
for i in titles: push(i)
for i in headers: push(i)
for i in arrows_ids: push(i)
emit.extend(new_elements)
emit.extend(label_bgs)         # white backing rects sit above arrows, below labels
for i in labels: push(i)
# any leftover live elements (safety)
for e in els:
    if e["id"] not in seen:
        emit.append(e)

scene["elements"] = emit
json.dump(scene, open(OUT, "w"), indent=1, ensure_ascii=False)
print(f"wrote {OUT}")
print(f"elements: {len(emit)} (orig {len(els)} + new {len(new_elements)})")
print(f"lanes bottom={LANES_BOTTOM:.0f} bus={H_BUS:.0f} circ_top={BAND_CIRC_TOP:.0f} host_top={HB_TOP:.0f} host_bottom={HB_BOTTOM:.0f}")
