# BUILD.md — csv-reader-speed-01-run-20261121

Entry: fast drop-in for csv-reader 1.0.0 (`solve.js`, dependency-free ES module).
Repo: `lucky-wren-78/csv-reader-speed` (to be created by the coordinator).
Work dir: `~/workspace/makefun/csv-reader-speed-01/`
Test scripts (not part of the repo): `~/workspace/makefun/csv-reader-speed-01-test/`

## Files in the repo

| file | bytes |
| --- | --- |
| `solve.js` | 12.668 |
| `main.ts` (byte-identical copy of the baseline driver) | 1.577 |
| `README.md` | 3.053 |
| `LICENSE` (MIT, `SPDX-License-Identifier: MIT` on line 1) | 1.100 |
| `.makefun/owner.json` (`{"wallet": "6hFehNmj7zqstSXvb8UMnhetRL5wRQ9jA8FjxnUusKnE"}`) | 57 |
| **Total** | **18.455 of 1.048.576 max** |

No `vendor/` folder, no WASM/native addon/binary. Plain JS only, no
Node-24-only APIs (works on the harness's Node 22).

## Design

- **Fast path**: a record whose physical line holds no `"` and no CR is
  read with native `indexOf`/`slice`/`split(',')` only.
- **Slow path**: any record with a quote or CR is parsed field-by-field,
  still with `indexOf`/`slice`: quoted fields find the closing quote with
  `indexOf('"')` (doubled quotes folded, CRLF/lone CR inside quotes read
  as LF, line count kept); unquoted fields use two `indexOf` calls
  (comma, LF) and check the short slice itself for a stray CR, falling
  back to a general stray-CR loop only when one is present; the unquoted
  fast attempt is inlined into the slow record loop.
- One real bug found and fixed by fuzzing: a trailing CR at EOF (no LF
  after it) was silently stripped as if CRLF in the fast path, losing a
  `stray_cr` error. The strip now applies only when the line really ends
  with `\n`.

## Differential testing (vs baseline vendor `readCsv`)

| suite | cases | identical |
| --- | --- | --- |
| Practice set (`practice/input/cases.json` vs `practice/reference/expected.json` + vs baseline) | 6 | 6/6 (100%) |
| Fuzz seed 1, 6.000 random fragment texts + 2.000 structured records + 77 hand-written edge cases | 8.077 | 100%, 0 mismatch |
| Fuzz seed 1, 20.000 random + 2.000 structured + 77 hand | 22.077 | 100%, 0 mismatch |
| Fuzz seed 2, 10.000 random + 2.000 structured + 77 hand | 12.077 | 100%, 0 mismatch |
| Final re-run after the last optimisation (seed 1, 6.000) | 8.077 | 100%, 0 mismatch |
| **Total comparisons** | **50.308** | **100% identical** |

Hand-written edge cases cover: empty text, BOM only, lone `\n`/`\r`/`\r\n`
lines, stray CRs (incl. at EOF and CR-only lines), unterminated quotes
(at end and mid-text, spanning lines), doubled quotes, quote junk
(text/space/CR after the closing quote), empty quoted fields, short/long
rows, header true/false/non-boolean, non-string `text` (`123`, `null`,
`undefined`), unicode/emoji, trailing comma, comma-only lines, quoted
multiline fields with LF/CRLF/lone-CR inside.

## Benchmark

Method: each side run as a fresh `node main.ts` process with
`MAKEFUN_INPUT_DIR`/`MAKEFUN_OUTPUT_DIR`; child CPU time (user+sys);
9 interleaved rounds per side per run; trimmed mean drops the 2 fastest
and 2 slowest. Outputs byte-identical to the baseline in every run
(12.073.155 bytes on the practice set).

Practice set (6 cases, ~10,2 MB CSV):

| bench run | baseline median | baseline trimmed mean | ours median | ours trimmed mean | speedup median | speedup trimmed |
| --- | --- | --- | --- | --- | --- | --- |
| 1 (before final inline) | 1,826 s | 1,817 s | 0,900 s | 0,906 s | 2,03x | 2,01x |
| 2 (final code) | 1,846 s | 1,842 s | 0,865 s | 0,868 s | 2,13x | 2,12x |
| 3 (final code, repeat) | 1,890 s | 1,905 s | 0,833 s | 0,844 s | 2,27x | 2,26x |

Distributions do not overlap (ours 0,77–0,98 s; baseline 1,58–2,12 s).
`run()` alone, warmed in-process: baseline ~647–741 ms/set vs ours
~132–187 ms/set (~4x). The driver total is lower (~2,1–2,3x) because
JSON parse of `cases.json` + `JSON.stringify` of the ~12 MB answers
(~250 ms) is identical for both sides.

Synthetic large set (8,4 MB: 4,2 MB clean CSV + 4,2 MB quoted-heavy
CSV): only ~1,05x on the driver — the totals there (~0,7 s) are
dominated by the same fixed parse/stringify overhead and the round
times overlap within noise. It is not the scored distribution (the
scored set is generator-drawn like the practice set, where the entry
is 2,1–2,3x faster), so it does not change the verdict, but it shows
the margin comes mostly from the generator-like mix, not from clean
CSV, where both readers are allocation-bound (~1,6x on `run()`).

## Verdict: LAYAK SUBMIT

- Correctness gate: 6/6 practice + 50.308/50.308 differential
  comparisons identical, 0 mismatches.
- Speed: ~2,1–2,3x faster than the baseline on the practice set by
  driver CPU time (trimmed mean), with non-overlapping run
  distributions — comfortably above the ≥2x target and the
  beat-the-baseline-at-95%-confidence bar.
- Repo 18.455 bytes, far under the 1 MiB cap.

## Residual risks / notes

- The scored set is drawn after entries close; it follows the same
  generator, so the practice-set mix (quote-heavy, CRLF/LF, broken
  rows) is the best available proxy. A scored set skewed much further
  toward clean CSV would shrink the speedup toward ~1,6x on `run()`,
  but the driver-level figure would still be dragged down by the
  shared parse/stringify overhead, not by a correctness risk.
- `solve.js` was written from the vendor semantics, not copied: no
  `vendor/` in the repo, no upstream code pasted in.
- Not done (coordinator's job, per the task): no `makefun record`
  (transcripts not required for this competition), no GitHub repo
  created, no push, no submit.
