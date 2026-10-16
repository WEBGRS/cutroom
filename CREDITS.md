# Credits and third-party licenses

The Cutroom source code is MIT-licensed (see LICENSE). Bundled assets and dependencies have their own terms:

| What | Where | License |
|---|---|---|
| Remotion | npm dependency | [Remotion License](https://www.remotion.dev/license): free for individuals and companies with up to 3 employees; larger companies need a company license |
| "Aerosol of my Love", Kevin MacLeod (incompetech.com) | `public/music/` | [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/): keep this credit when you publish videos that use it |
| Music you compose with `music compose`: the studio and the instrument recordings | not included; installed separately | [XSXB-Band](https://github.com/sparklecatta-lang/XSXB-Band) by sparklecatta-lang, MIT; its instrument recordings are CC0 and download on first use (guitar-amp models are GPL-3.0 and only used for metal guitar). Cutroom talks to the studio over HTTP and runs its render script; it contains none of its code |
| Interface click sound, Kenney (kenney.nl) | `public/sfx/click.wav` | CC0 |
| Sound effect library: interface, impact, digital and sci-fi sounds by Kenney (kenney.nl) | `public/sfx/lib/` (listed in `src/fx/sounds.ts` with `by: "Kenney (CC0)"`) | CC0 |
| Sound effect library: whooshes, risers, booms, hits, dings, typing and the rest | `public/sfx/lib/` (`by: "Cutroom"`) | Synthesized by `tools/build_sfx.py` for this project, MIT |
| Whoosh and pop sounds | `public/sfx/` | Generated with ffmpeg for this project, MIT |
| Noto Sans SC (downloaded by `npm run setup`) | `public/fonts/` | SIL Open Font License 1.1 |
| Demo planner page recording | `public/showcase/cap/` | Made for this project, MIT |
| Demo narration (Chinese and English) | `public/showcase/vo/` | Voiced by Cutroom's built-in voices: [Kokoro-82M v1.1-zh](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh) by hexgrad, Apache License 2.0, run through [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache License 2.0) |
| Built-in voice model (downloaded on first use, not in this repository) | `kokoro-int8-multi-lang-v1_1` from the sherpa-onnx releases | Kokoro-82M v1.1-zh, Apache License 2.0 |
| HD voices: model and runtime (installed on request, not in this repository) | [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) Base and VoiceDesign models, the `qwen-tts` package, PyTorch | Qwen3-TTS by the Qwen team, Alibaba Cloud, Apache License 2.0; PyTorch, BSD-style license |
| HD voice presets (reference clips) | `editor/voices/` | Generated for Cutroom with Qwen3-TTS VoiceDesign from written descriptions (no real person's voice); released with Cutroom under the MIT License |
| Demo photo (Peyto Lake, Tanvi Malik) and time-lapse clip (Joshua Tree, NPS / Kristi Rugg) | `public/showcase/media/` | CC0 and public domain, from Wikimedia Commons; sources in `public/showcase/media/SOURCES.md`, rebuilt by `tools/demo_media.py` |
| Effect designs: timings, easing and look of many transitions, text animations, overlays, cards and backgrounds | `src/fx/` | Adapted from [HyperFrames](https://github.com/heygen-com/hyperframes) by HeyGen, Apache License 2.0 (see `licenses/hyperframes-LICENSE`). Reimplemented in React/Remotion; the HyperFrames component each effect follows is named in `src/fx/registry.ts` (`src` fields) |
| Effect preview clips | `public/_fx/` | Rendered by `npm run previews` from the demo media, MIT |
| JianyingPro draft format: templates and the shapes of tracks, materials and segments | `editor/src/jianying/`, `editor/src/jianying.ts` | From [pyJianYingDraft](https://github.com/GuanYixuan/pyJianYingDraft) by GuanYixuan, Apache License 2.0 (see `licenses/pyJianYingDraft-LICENSE`); the writer is a TypeScript reimplementation |
| Demo badge image | `public/showcase/media/badge-new.png` | Drawn for this project, MIT |
