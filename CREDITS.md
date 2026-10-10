# Credits and third-party licenses

The Cutroom source code is MIT-licensed (see LICENSE). Bundled assets and dependencies have their own terms:

| What | Where | License |
|---|---|---|
| Remotion | npm dependency | [Remotion License](https://www.remotion.dev/license): free for individuals and companies with up to 3 employees; larger companies need a company license |
| "Aerosol of my Love", Kevin MacLeod (incompetech.com) | `public/music/` | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/): keep this credit when you publish videos that use it |
| Interface click sound, Kenney (kenney.nl) | `public/sfx/click.wav` | CC0 |
| Whoosh and pop sounds | `public/sfx/` | Generated with ffmpeg for this project, MIT |
| Noto Sans SC (downloaded by `npm run setup`) | `public/fonts/` | SIL Open Font License 1.1 |
| Demo media (planner page recording, fractal still, gradient clip) | `public/showcase/` | Made for this project, MIT |
| Effect designs: timings, easing and look of many transitions, text animations, overlays, cards and backgrounds | `src/fx/` | Adapted from [HyperFrames](https://github.com/heygen-com/hyperframes) by HeyGen, Apache License 2.0 (see `licenses/hyperframes-LICENSE`). Reimplemented in React/Remotion; the HyperFrames component each effect follows is named in `src/fx/registry.ts` (`src` fields) |
| Effect preview clips | `public/_fx/` | Rendered by `npm run previews` from the demo media, MIT |
