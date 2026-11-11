# Independent visual review packet

Certification of the Reality Engine requires a visual review by someone who did **not** implement it. This packet is what that person needs; nothing here is a review.

1. Open each `board-*.png` (inputs on the left, the product's reconstruction on the right). Boards are in `score-sheet.json` in a fixed shuffled order.
2. Fill `score-sheet.json` (reviewer name, independence declaration, a 1-5 score for each criterion, comments). Do not read `machine-metrics.json` until you have scored.
3. Return the file. A category is only certified "partially verified" with a mean >= 3 on every criterion and no board scoring 1 on `honesty`.

Status: **NOT REVIEWED** (no independent reviewer was available to the implementer). The only reviewer so far is the implementer, whose notes are in `reports/reality-engine/REPORT.md` and do not count.
