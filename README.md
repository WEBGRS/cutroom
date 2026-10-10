# Cutroom

A code-first video editor. Each video is a `storyboard.json` file: you edit it in a timeline UI, and an AI assistant can edit the same file from a chat panel. Rendering is done by [Remotion](https://www.remotion.dev).

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/WEBGRS/cutroom/actions/workflows/ci.yml/badge.svg)](https://github.com/WEBGRS/cutroom/actions/workflows/ci.yml)

![Cutroom editor: media library, preview, filmstrip timeline and properties panel](docs/screenshot.png)

## Why

Most editors store a project as an opaque binary or database. Cutroom stores it as a small JSON document, which means:

- **You and an AI can work on the same cut.** The chat panel runs Claude with access to one tool, the editor's CLI. Its edits appear in the preview within a second, and your edits in the UI are visible to it. Both sides go through the same versioned save path, so neither overwrites the other.
![The AI panel: a request, the CLI commands it ran, and its summary](docs/ai-chat.png)

- **Timing stays tied to content.** Captions and cuts can be anchored to marks recorded with a screen capture (`"@add-0.3"`), so re-recording a demo doesn't break the edit.
- **What you preview is what you export.** The preview is a Remotion Player running the same React composition the renderer uses. A test renders the same frames both ways and compares them; most come out bit-identical.

## Features

- **Timeline**: filmstrip thumbnails, waveforms, drag to reorder, drag edges to trim, split at the playhead, undo/redo, beat grid for music-cut versions.
- **Two cuts from one storyboard**: a narrated cut and a beat-synced music cut, each in 16:9 and 9:16. Switch between them under the preview (aspect ratio, language, URLs shown or hidden) and above the timeline (narrated or beat cut).
- **Library panel**: eight sections (media, cards, text, overlays, transitions, effects, backdrops, music). Every effect has a rendered preview that plays on hover; one click applies it to the selected scene.
- **182 effects**:
  - 39 transitions (whip pan, glitch, film burn, 3D cube, light leak, tile grid, …)
  - 33 text animations (decode, scramble, typewriter, split-flap, count-up, marker highlight, …), usable on titles, overlays and captions
  - 41 overlays (hand-drawn circles and arrows, notifications, chat bubbles, keyboard keys, AI prompt box, counters, progress rings, confetti, …) and 12 lower-third styles
  - 14 card scenes (bar chart, checklist, testimonial, chat thread, code typing, terminal, before/after wipe, …)
  - 10 animated backdrops
  - 33 scene-effect presets (looks, duotone, RGB split, bloom, CRT, pixelate, handheld drift, focus pull, stop motion, …)
  - Many of the designs are adapted from [HyperFrames](https://github.com/heygen-com/hyperframes); see [CREDITS.md](CREDITS.md).
- **Captions**: box, outline or plain styles, any position and size, and most text animations; a Screen Studio-style frame for recordings, frosted cards and a chapter bar.
- **Screen recordings**: a deterministic browser recorder logs clicks and cursor moves; the editor adds smooth auto-zoom, a synthetic cursor and click ripples afterwards.
- **AI chat**: uses your [Claude Code](https://docs.anthropic.com/en/docs/claude-code) login or an Anthropic API key. See [Connecting the AI](#connecting-the-ai).
- **Export**: MP4, 2× resolution, GIF, ProRes, SRT subtitles and a chapter list.
- **Desktop app**: the same editor in its own window, with a Windows installer.
- **English and Chinese**: the interface starts in English; pick Chinese in the installer or from the globe menu in the top bar.

## Install (Windows)

Build the installer with `npm run dist` (it lands in `dist-app/`), or download it from the releases page when one is published. The installer asks for a language first. The app keeps projects, settings and exports in `Documents\Cutroom`, so uninstalling never deletes your videos. The first export downloads Remotion's headless browser (about 110 MB) once.

## Run from source

Requirements: Node.js 22+, [ffmpeg](https://ffmpeg.org) on your `PATH`, and Chrome for screen recordings and browser tests. Developed and tested on Windows 11.

```bash
git clone https://github.com/WEBGRS/cutroom.git
cd cutroom
npm install
npm run setup        # downloads the Noto Sans SC font used for captions
npm run editor       # http://127.0.0.1:8814
```

Or open it as a desktop app:

```bash
npm run app
```

The `showcase` project opens first. It uses every effect type, so it doubles as a reference.

## Connecting the AI

Open the **AI assistant** tab. The pill at its top shows the connection; click it to change it.

- **Claude Code login** (uses your Claude subscription): install [Claude Code](https://docs.anthropic.com/en/docs/claude-code), run `claude` once in a terminal and sign in, then restart the editor.
- **API key** (pay per use): create a key in the [Anthropic Console](https://console.anthropic.com) and paste it into the settings page, or set `ANTHROPIC_API_KEY` before starting the editor. A pasted key is stored only in `.editor/settings.json` on your machine (git-ignored) and is never sent back to the page in full.

**Test connection** sends one short request through whichever option is active. In auto mode the editor prefers the Claude Code login and falls back to the key. Either way the assistant can only run the editor's own CLI on the open project.

## A storyboard

```json
{
  "slug": "my-video",
  "title": "My video",
  "theme": { "accent": "#3b6ef5", "bg": ["#0b1020", "#1a2140"] },
  "scenes": [
    {
      "id": "intro",
      "lines": [{ "zh": "这条视频是写出来的。", "en": "This video was written, not dragged." }],
      "visual": { "kind": "title", "title": "Edit video as code" },
      "fx": { "vignette": 0.35, "grain": 0.2 }
    },
    {
      "id": "demo",
      "transition": "dip",
      "lines": [{ "zh": "点哪里，推近哪里。", "en": "It zooms in on every click.", "at": "@add-0.3" }],
      "visual": { "kind": "screen", "src": "cap/planner.mp4", "to": "@filter+1.2" },
      "overlays": [{ "kind": "arrow", "at": 3.6, "text": "auto zoom", "x": 0.62, "y": 0.36 }]
    }
  ]
}
```

`zh` holds the main caption line (any language) and `en` an optional second-language line under it. Run `node editor/dist/cli.mjs fx` for every effect field.

Projects live in `public/<slug>/` together with their media. Create one from the project menu in the editor, or drop images, video and music onto the editor window to import them.

## Editing from the command line

The CLI is what the AI assistant uses, and you can use it too. Changes show up live in an open editor.

```bash
node editor/dist/cli.mjs showcase ls --format tall --mode beat   # timeline as rendered
node editor/dist/cli.mjs showcase trim record --to @filter+0.8   # keeps the mark anchor
node editor/dist/cli.mjs showcase split record 4.2
node editor/dist/cli.mjs showcase set photo fx.look '"warm"'
node editor/dist/cli.mjs showcase add title intro                 # new title card after "intro"
node editor/dist/cli.mjs showcase log --unseen                    # what changed in the UI since you last looked
node editor/dist/cli.mjs fx                                       # every effect field and its range
```

## Keyboard shortcuts

| Key | Action |
|---|---|
| Space | Play / pause |
| ← / → (Shift: 1 s) | Step one frame |
| Ctrl+B or S | Split at the playhead |
| Q / W | Trim the scene's start / end to the playhead |
| Ctrl+D | Duplicate scene |
| Ctrl+Alt+C / Ctrl+Alt+V | Copy / paste effects |
| Delete | Remove scene |
| Ctrl+Z / Ctrl+Y | Undo / redo |

## How it works

```
 timeline UI ──PUT──┐                         ┌── Remotion Player (preview)
                    ├──► storyboard.json ◄────┤
 AI chat ─► CLI ────┘    (versioned saves,    └── remotion render (export)
                          log + snapshots)
             file watcher ─► server-sent events ─► every open editor
```

- `src/`: the Remotion composition: scenes, camera, captions, effects, transitions.
- `editor/src/`: UI (React), server, CLI, edit operations, the effects catalog that drives the UI, the CLI's `fx` listing and the AI's instructions.
- `tools/capture.mjs`: deterministic screen recorder. `editor/demo/capture.mjs` shows how to script one.
- `src/fx/`: the effect library: text animations, transitions, overlays, cards, backdrops, scene effects, and `registry.ts`, the list that drives the UI and the previews.
- `editor/fx/previews.ts`: renders the hover previews into `public/_fx/` (`npm run previews`; `--only transition/whip` for one).
- `app/`: desktop shell; `electron-builder.yml` and `build/installer.nsh` make the installer.

## Tests

```bash
npm test             # unit tests (edit operations, timeline model, effects catalog)
npm run typecheck
npm run test:e2e     # drives the editor in headless Chrome against a throwaway copy of the showcase
npm run test:oracle  # preview frames vs. Remotion's renderer (PSNR ≥ 50 dB; most frames identical)
npm run test:app     # launches the desktop app hidden and checks it starts and cleans up
npm run test:shots   # screenshots every panel, tab, menu, dialog and error state into .scratch/uishots
```

The e2e, oracle, app and screenshot scripts need the editor running (`npm run editor`) and Chrome installed.

## Limitations

- The timeline is scene-based and always closed up (ripple). There is no free placement on multiple tracks; overlays attach to scenes instead.
- Twelve of Remotion's shader transitions need an experimental Chrome flag, so they are not offered.
- Narration audio has to be produced outside the editor (any TTS or your own recording, listed in `timings.json`).
- The installer is unsigned, so Windows SmartScreen asks for confirmation on first run. It is built for Windows only so far.

## Credits and license

Cutroom is MIT-licensed. Remotion has its own license: free for individuals and companies with up to three employees, while larger companies need a [company license](https://www.remotion.dev/license). Bundled music and sounds, and the HyperFrames designs the effect library adapts (Apache-2.0), are listed in [CREDITS.md](CREDITS.md).
