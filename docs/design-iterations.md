# Cutroom iterations

## Visual polish (2026-10-09)

Brief: "the look feels cheap, revise it a few times". Layout and interactions stay; materials change.
Screenshots per round: `.scratch/polish/r0-*.png` (before) … `r4-*.png` (after), comparisons `compare-*.png`.

Plan: quiet daylight-gray chrome; color comes from the content. The timeline becomes a filmstrip
(real recording thumbnails, card slates in the project's own backdrop and typeface, real waveforms).
System UI font for controls, Noto Sans SC (the video's font) for anything that ends up on screen.

| Round | Changed | Why |
|---|---|---|
| 1 | Thumbnail sprites + waveform peaks (ffmpeg, cached in `.editor/cache`); slates for title/stats/outro; icon transport and tools; grouped version switches; preview sized to the exact aspect with radius + shadow; scoped CSS tokens | Clips were pastel boxes with file names; every control had the same weight |
| 2 | Waveform as smoothed filled envelope; beat grid replaces minor ticks in the beat cut; markers as white triangles; shorter frame labels | 1 px peak bars read as a barcode; beat dots collided with time labels; yellow pins read as warnings |
| 3 | Narration lines get an index gutter with delete on hover; fit-zoom icon redrawn | Index row wasted height; old icon looked like fullscreen |
| 4 | Default-value placeholders say "默认 …"; darker placeholder color | Defaults looked like disabled values |

Bugs found along the way (both fixed, e2e stable across 3 runs):
- An external edit arriving while a page save was in flight was dropped; it is now replayed once the save lands.
- `fs.watch` died silently when a project folder was deleted and recreated; watchers are keyed by inode + birth time and reattached.

Checks after the last round: unit 9/9, e2e 10/10 ×3, oracle preview = render (∞ dB, controls fail as expected), 0 console errors.
