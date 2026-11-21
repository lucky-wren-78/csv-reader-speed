[![make.fun](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/lucky-wren-78/csv-reader-speed/rank.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/lucky-wren-78/csv-reader-speed/reward.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)

# csv-reader-speed

A fast, dependency-free drop-in replacement for csv-reader 1.0.0: `solve.js`
returns exactly the same `{columns, rows, errors}` answer for every input,
but reads the text much faster. Entry for the
[make.fun competition](https://make.fun/competitions/csv-reader-speed-01-run-20261121).

## How it works

`main.ts` is the baseline driver unchanged: it reads every case from
`/input/cases.json`, answers each with `run` from `solve.js`, and writes
`/output/answers.json`. All the speed is in `solve.js`, which reproduces
csv-reader 1.0.0's broken-row policy exactly (BOM dropped, LF/CRLF record
ends, stray-CR / unterminated-quote / quote-junk / short-row / long-row
errors with the same `{code, line, row}`, header handling, padding and
cutting to the first record's width) with a different reading strategy:

- **Fast path** — most records are clean physical lines (no quote, no CR).
  Those are read with native `indexOf`/`slice`/`split` only: one scan to
  find the line, one slice, and `split(',')`. No character-at-a-time loop.
- **Slow path** — any record holding a quote or a CR is parsed
  field-by-field, still with `indexOf`/`slice` instead of a per-character
  loop: quoted fields find their closing quote with `indexOf('"')`
  (doubled quotes folded in, CRLF/lone CR inside quotes read as LF),
  unquoted fields find the next comma/LF with two `indexOf` calls and
  check the short slice itself for a stray CR, falling back to a general
  stray-CR loop only when one is actually present.

No WebAssembly, no native addon, no dependency; plain JavaScript that
runs on Node 22 and Node 24.

## Validation

- Practice set: 6/6 answers identical to the reference expected output.
- Differential fuzzing against the baseline vendor reader: 50.308 cases
  (random fragments, structured records, two seeds, plus ~77 hand-written
  edge cases per run) — 100% identical, 0 mismatches. See `BUILD.md`.

## Benchmark (practice set, 6 cases, ~10.2 MB CSV)

Driver CPU time, 9 interleaved runs each side, fresh processes:

| run | baseline | this entry | speedup |
| --- | --- | --- | --- |
| 1 | median 1.83 s / trimmed mean 1.82 s | median 0.90 s / trimmed mean 0.91 s | ~2.0x |
| 2 | median 1.85 s / trimmed mean 1.84 s | median 0.87 s / trimmed mean 0.87 s | ~2.1x |
| 3 | median 1.89 s / trimmed mean 1.91 s | median 0.83 s / trimmed mean 0.84 s | ~2.3x |

Outputs byte-identical to the baseline in every run. Full numbers in
`BUILD.md`.

## Run locally

```sh
mkdir -p out
MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```
