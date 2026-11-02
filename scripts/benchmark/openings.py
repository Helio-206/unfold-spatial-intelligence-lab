#!/usr/bin/env python3
"""Matches the pipeline's opening candidates (collinear gaps) against the door/window positions written in sample-1-manual-count.md."""
import json, sys, math
raw = json.load(open(sys.argv[1])); out = sys.argv[2]
DOORS = [(214, 300), (146, 293), (215, 375), (288, 375), (275, 582), (452, 531), (428, 560), (723, 336), (852, 517), (664, 632)]
WINDOWS = [(134, 94), (385, 95), (490, 95), (595, 95), (840, 93), (8, 330), (8, 578)]
TOL = 30
cands = [((o['start']['x'] + o['end']['x']) / 2, (o['start']['y'] + o['end']['y']) / 2, abs(o['end']['x'] - o['start']['x']) + abs(o['end']['y'] - o['start']['y'])) for o in raw['openingCandidates']]
def hits(points): return [p for p in points if any(math.hypot(p[0] - c[0], p[1] - c[1]) <= TOL for c in cands)]
res = dict(detected=len(cands), toleranceInPx=TOL, doorsExpected=len(DOORS), doorsMatched=len(hits(DOORS)), windowsExpected=len(WINDOWS), windowsMatched=len(hits(WINDOWS)),
           candidatesNearAnyExpected=sum(any(math.hypot(p[0] - c[0], p[1] - c[1]) <= TOL for p in DOORS + WINDOWS) for c in cands),
           candidateWidthsPx=sorted(round(c[2]) for c in cands), note='door/window gaps in this drawing are roughly 40-60 px wide')
json.dump(res, open(out, 'w'), indent=1); print(json.dumps(res))
