# Credits and third-party licenses

The Cutroom source code is MIT-licensed (see LICENSE). Bundled assets and dependencies have their own terms:

| What | Where | License |
|---|---|---|
| Remotion | npm dependency | [Remotion License](https://www.remotion.dev/license): free for individuals and companies with up to 3 employees; larger companies need a company license |
| "Aerosol of my Love", Kevin MacLeod (incompetech.com) | `public/music/` | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/): keep this credit when you publish videos that use it |
| Interface click sound, Kenney (kenney.nl) | `public/sfx/click.wav` | CC0 |
| Sound effect library: interface, impact, digital and sci-fi sounds by Kenney (kenney.nl) | `public/sfx/lib/` (listed in `src/fx/sounds.ts` with `by: "Kenney (CC0)"`) | CC0 |
| Sound effect library: whooshes, risers, booms, hits, dings, typing and the rest | `public/sfx/lib/` (`by: "Cutroom"`) | Synthesized by `tools/build_sfx.py` for this project, MIT |
| Whoosh and pop sounds | `public/sfx/` | Generated with ffmpeg for this project, MIT |
| Noto Sans SC (downloaded by `npm run setup`) | `public/fonts/` | SIL Open Font License 1.1 |
| Demo planner page recording | `public/showcase/cap/` | Made for this project, MIT |
| Demo photo (Peyto Lake, Tanvi Malik) and time-lapse clip (Joshua Tree, NPS / Kristi Rugg) | `public/showcase/media/` | CC0 and public domain, from Wikimedia Commons; sources in `public/showcase/media/SOURCES.md`, rebuilt by `tools/demo_media.py` |
| Effect designs: timings, easing and look of many transitions, text animations, overlays, cards and backgrounds | `src/fx/` | Adapted from [HyperFrames](https://github.com/heygen-com/hyperframes) by HeyGen, Apache License 2.0 (see `licenses/hyperframes-LICENSE`). Reimplemented in React/Remotion; the HyperFrames component each effect follows is named in `src/fx/registry.ts` (`src` fields) |
| Effect preview clips | `public/_fx/` | Rendered by `npm run previews` from the demo media, MIT |
