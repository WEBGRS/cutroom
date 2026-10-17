# Cutroom

A video editor for demos of the software you build. Record your app, cut it with an AI that edits the same project you do, and when the UI changes, record it again: captions and cuts are tied to moments in the recording, so the edit carries over to the new footage. Exports MP4 in 16:9 and 9:16, with voice-over and captions.

[![Download for Windows](https://img.shields.io/github/v/release/WEBGRS/cutroom?label=download&color=3b6ef5)](https://github.com/WEBGRS/cutroom/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/WEBGRS/cutroom/actions/workflows/ci.yml/badge.svg)](https://github.com/WEBGRS/cutroom/actions/workflows/ci.yml)

![Cutroom editor: transition library, preview, effect settings, and a timeline with overlay, effect, camera, video, caption, voice and sound lanes](docs/screenshot.png)

## What it does

- **Records your app and remembers how.** The recorder drives a browser through your clicks and typing, logs every cursor move, and drops named marks where you'll talk. Zoom, a smooth cursor and click ripples are added afterwards, so you never re-record to fix the camera. Local dev servers work.
- **Records desktop apps too.** For anything outside a browser (JianyingPro, Excel, an IDE, a game), a record bar comes up while you work the app, with Start, Mark and Stop on F9/F10. Your pointer and clicks are logged, so the same zoom, cursor and click ripples apply. The assistant can ask you for a recording and put its instructions on the bar, then cut the footage in and line the captions up with your marks.
- **Re-records after a release.** Each recording keeps its steps. `rerecord all` plays them against the new UI; captions, cuts and sound cues anchored to marks (`"at": "@submit"`) land on the same moments in the new footage, and `check` names any mark that disappeared.
- **Edits with an AI next to you.** Hold Ctrl and click a spot in the preview, a scene or a caption, then say what you want changed there. The assistant edits through the editor's CLI; its changes appear in the preview within a second and can be undone like your own. It can record websites, write and voice narration, and look at rendered frames to check the text and circles it placed.
  ![The AI panel: a spot Ctrl+clicked in the preview, the request, the command the AI ran, and the circle it drew there](docs/ai-chat.png)
- **Plays HTML when the library runs out.** Any HTML page with seekable animation becomes a scene, frame-accurate in preview and export: a chart of your real numbers, a diagram, a branded title. [HyperFrames](https://github.com/heygen-com/hyperframes) compositions play unchanged, and the assistant can write these pages too.
- **Shows what you'll export.** The preview is a Remotion Player running the same React composition as the renderer. A test renders frames both ways and compares them; most come out bit-identical.
- **Hands off to 剪映 (JianyingPro).** `export --jianying` writes a draft with the picture cut per scene, the narration, the music (its ducking as volume keyframes), the sound effects and the captions on their own tracks, and adds it to JianyingPro's draft list, for anyone who finishes videos there.

## Where it fits

Cutroom is built on [Remotion](https://www.remotion.dev) and plays HyperFrames compositions. If you want to write a video in code, use those directly. Cutroom is for editing demo videos with a timeline, a recorder and an assistant, and for keeping them current.

| | Remotion | HyperFrames | Cutroom |
|---|---|---|---|
| You write | React components | HTML, CSS and seekable JavaScript | Nothing: a timeline and a chat. HTML pages when you want them |
| Made for | Apps that generate video, personalized videos at scale, cloud rendering | Agents writing motion graphics from a prompt | Demo videos of your own software: recordings, captions, voice-over, re-recording |
| In Cutroom | The renderer and the preview | A scene type: drop a composition in | |
| License | [Remotion License](https://www.remotion.dev/license): free for individuals and companies of up to 3 people | Apache 2.0 | MIT. It renders with Remotion, so Remotion's license applies too |

## Use it from your coding agent

If you build your app with Claude Code, Codex or Cursor, the same agent can make its demo video. For Claude Code, install the plugin:

```bash
claude plugin marketplace add WEBGRS/cutroom
claude plugin install cutroom@cutroom
```

Other agents can read [skills/cutroom/SKILL.md](skills/cutroom/SKILL.md) directly. The skill drives the command line, which is `cutroom.cmd` next to `Cutroom.exe` in the desktop app (`%LOCALAPPDATA%\Programs\Cutroom`), or `node editor/dist/cli.mjs` in a source checkout:

```bash
cutroom my-app new "My app"
cutroom my-app inspect http://localhost:3000
cutroom my-app record signup http://localhost:3000 '[{"mark":"open"},{"click":"text=\"Sign up\""},{"fill":["#email","ada@example.com"]},{"mark":"submit"},{"click":"button[type=submit]"},{"wait":1500}]'
cutroom my-app add screen cap/signup.mp4 intro
cutroom my-app voice
cutroom my-app check
cutroom my-app export --format tall
```

Open the project in the editor afterwards to adjust it by hand; the agent sees your edits with `log --unseen`.

## Features

- **Timeline**: filmstrip thumbnails, waveforms, drag to reorder, drag edges to trim, split at the playhead, undo/redo. Lanes under the scenes show where every overlay, effect, camera move and sound effect sits, and each cut shows its transition. Drag an overlay or a sound to move it; click any bar to open its settings. Dragged edges, cues and the playhead snap to cuts, recording marks, caption starts and each other (the magnet button or N; hold Alt to drag freely).
- **Both sizes from one storyboard**: 16:9 and 9:16 from the same scenes, with a separate 9:16 picture where a scene needs one. The size is a project setting (Properties › Project); the assistant asks which one you want before it makes the first version.
- **Every line over the right picture**: the assistant plans a shot for each narration line before it records, and `look lines` renders one frame per line with its caption so the assistant (or you) can check that each picture shows what its line says.
- **A shot design per scene**: one line under the scene's name says what the shot shows and how it is made (the page or app, the actions, the camera). The assistant writes it; edit it and ask the assistant to follow it, and it rebuilds that scene.
- **Library panel**: media, cards, text, overlays, transitions, effects, backdrops, voice-over, sound effects and music. Every effect has a rendered preview that plays on hover; one click applies it to the selected scene.
- **182 effects**:
  - 39 transitions (whip pan, glitch, film burn, 3D cube, light leak, tile grid, …)
  - 33 text animations (decode, scramble, typewriter, split-flap, count-up, marker highlight, …), usable on titles, overlays and captions
  - 41 overlays (hand-drawn circles and arrows, notifications, chat bubbles, keyboard keys, AI prompt box, counters, progress rings, confetti, …) and 12 lower-third styles
  - 14 card scenes (bar chart, checklist, testimonial, chat thread, code typing, terminal, before/after wipe, …)
  - 10 animated backdrops
  - 33 scene-effect presets (looks, duotone, RGB split, bloom, CRT, pixelate, handheld drift, focus pull, stop motion, …)
  - Many of the designs are adapted from [HyperFrames](https://github.com/heygen-com/hyperframes); see [CREDITS.md](CREDITS.md).
- **HTML scenes**: see [below](#html-scenes).
- **Image overlays**: logos, stickers and product shots on any scene, with an entrance (pop, rise, slide, spin, fade), a turn and an optional float. `imagine` draws one with an OpenAI or Gemini key, with a transparent background on OpenAI.
- **Shot breakdown**: `shots <video>` finds every cut in a reference video (or your own export), gives each shot's length and camera move (static, pan, push in, pull out, handheld) with three keyframes, and writes a page where clicking a shot plays it.
- **Footage tools**: `reframe` crops a wide image or clip for 9:16 around the part with the most motion and detail; `cut-silence` turns a talking clip into jump cuts without the long pauses; `export --max-mb` fits the file under a size limit.
- **Music written for your video**: ask the assistant for a track and it writes the score; real instrument recordings (CC0, from [XSXB-Band](https://github.com/sparklecatta-lang/XSXB-Band), installed separately) play it. The result lands in the music library at the right level, with no credit line to print. `cutroom my-app music help` shows how.
- **58 sound effects**: whooshes, risers, booms, hits, clicks, typing, notification dings and digital blips. Listen in the library, drag one onto the Sound FX lane, then drag it to the exact frame.
- **Captions**: box, outline or plain styles, any position and size, and most text animations; a Screen Studio-style frame for recordings, frosted cards and a chapter bar.
- **AI voice-over**: pick a voice in Library › Voiceover and press Voice. The built-in voices are free, small and run offline anywhere (100 Chinese, 3 English; a 147 MB model downloads once). The **HD voices** run [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) on your own NVIDIA card (6 GB or more; one install of about 10 GB): they sound like a person talking, read English words inside Chinese, and can speak in **your own voice** from a passage you read into the microphone, a clip you bring, or a voice you describe in a sentence. OpenAI, Gemini and Qwen cloud voices use your key from Settings › AI. Only lines without current audio are voiced, so editing a line re-voices just that line.
- **Screen recordings**: Library › Media › Record a website takes a short scroll through any page; the AI assistant or the CLI records clicks and typing. Recordings keep their steps for `rerecord`. Library › Media › Record an app records a window, a window's area (menus included) or a whole screen on Windows. `import` brings in videos you recorded elsewhere.
- **AI assistant**: works with a Claude subscription (through Claude Code), a ChatGPT plan (through the Codex CLI), a Google account (through the Gemini CLI or Antigravity), a Claude API key, or any OpenAI-compatible API: OpenAI, Gemini, DeepSeek, Qwen, Kimi, GLM, OpenRouter or a local Ollama. See [Connecting the AI](#connecting-the-ai).
- **Export**: MP4, 2× resolution, GIF, ProRes, SRT subtitles and a chapter list, from the export menu or `export` on the command line. The export menu shows where files go (desktop app: `Documents\Cutroom\exports\editor`).
- **Settings** (gear icon or Ctrl+,): language, help hints, default lengths and transition for new scenes, which timeline lanes to show, preview loop and volume, hiding URLs for platforms that ban links, the export folder and preset, the AI connection, shortcuts and the thumbnail cache.
- **English and Chinese** interface, chosen in the installer or in Settings.

![Voiceover library: engine, voices and progress; the scene's narration lines with their audio; the voice lane on the timeline](docs/voiceover.png)

![Sound FX library, the scene's Sound tab and the Sound FX lane on the timeline](docs/sound-fx.png)

## HTML scenes

A page in the project's `scenes/` folder plays as a scene. Cutroom loads it in a frame, takes over its clock and sets the time for every frame, so scrubbing, previewing and exporting all show the same picture.

```html
<div data-composition-id="growth" data-width="1920" data-height="1080" data-duration="5">
  <h1 style="animation: rise .6s ease-out .2s both">Signups doubled</h1>
</div>
<style>@keyframes rise { from { opacity: 0; transform: translateY(40px) } }</style>
```

```bash
node editor/dist/cli.mjs my-app html write growth '<the page>'   # or drop an .html file on the editor
node editor/dist/cli.mjs my-app add html scenes/growth/index.html intro
node editor/dist/cli.mjs my-app html check growth                # clocks, timers and other things that break seeking
```

- Animate with CSS keyframes, `element.animate()`, a paused GSAP timeline on `window.__timelines`, Anime.js, Lottie or Three.js (the HyperFrames adapter conventions). Elements with `data-start` and `data-duration` show only in that window.
- A scene lasts as long as the page's `data-duration` unless its narration runs longer.
- Variables declared in `data-composition-variables` show up as fields in the scene's settings and can be set per scene (`set growth visual.vars.title '"Q3"'`), so one page can serve several scenes.
- A HyperFrames composition, including one that mounts sub-compositions, can be copied in as it is: `add html path/to/composition`.
- The showcase's `loop` scene (`public/showcase/scenes/loop`) is a worked example with a separate 9:16 page.

## Install (Windows)

Download `Cutroom-Setup-<version>.exe` from the [latest release](https://github.com/WEBGRS/cutroom/releases/latest) and run it. The installer is not code-signed, so Windows SmartScreen may say "Windows protected your PC": click **More info**, then **Run anyway**.

The installer asks for a language first. Projects, settings and exports live in `Documents\Cutroom`, so uninstalling never deletes your videos. The first export downloads Remotion's headless browser (about 110 MB) once.

To build the installer yourself, run `npm run dist` from a source checkout; it lands in `dist-app/`.

## Run from source

Requirements: Node.js 22+, [ffmpeg](https://ffmpeg.org) on your `PATH` (FFmpeg 8 or newer to record desktop apps; otherwise Cutroom downloads a build once, 87 MB), and Chrome for screen recordings and browser tests. Developed and tested on Windows 11.

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

The `showcase` project opens first. It uses every kind of scene and effect, so it doubles as a reference.

## Connecting the AI

Open the **AI assistant** tab and click the connection pill at its top, or go to Settings › AI.

| Option | What you need |
|---|---|
| **Claude Code login** | A Claude subscription. Install [Claude Code](https://docs.anthropic.com/en/docs/claude-code), run `claude` once in a terminal and sign in, then restart the editor. |
| **ChatGPT plan** | The official [Codex CLI](https://github.com/openai/codex), signed in with your ChatGPT account. |
| **Google account** | The official [Gemini CLI](https://github.com/google-gemini/gemini-cli), signed in with Google (free tier or a Google AI plan). |
| **Google Antigravity** | The [Antigravity](https://antigravity.google) command-line agent (`agy`), signed in with Google. Besides Gemini it offers Claude and GPT-OSS models; Settings › AI lists them. |
| **Claude API key** | A key from the [Anthropic Console](https://console.anthropic.com), pasted in Settings › AI or set as `ANTHROPIC_API_KEY`. Pay per use. |
| **Other models** | A key for OpenAI, Google Gemini, DeepSeek, Qwen (Alibaba Model Studio), Kimi, Zhipu GLM or OpenRouter, or a local [Ollama](https://ollama.com) with no key. Pick a model from the list the provider returns; it must support tool calling. |

- **Codex and Gemini CLI**: Settings › AI can install either one (`npm install -g`) and opens a terminal for its own sign-in. Cutroom starts the CLI with its shell, file and web tools turned off and gives it one tool, the editor, through a small MCP server (`editor/dist/mcp.mjs`). Each request is an ephemeral session, so nothing lands in your own Codex or Gemini history.
- **Antigravity**: install it from [antigravity.google](https://antigravity.google) and sign in once by running `agy`. Cutroom runs it with a home folder of its own that holds only the editor's MCP server, lets it open only the frames `look` renders (Antigravity does not pass images in tool results), and denies its shell, file-writing and web-page tools (`command`, `write_file`, `read_url`, `execute_url`), so your own Antigravity settings are untouched. Its web search stays on; it reads nothing on your computer.
- **Keys**: a pasted key is stored only in `.editor/settings.json` on your machine (git-ignored) and is never sent back to the page in full. Keys can also come from `OPENAI_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `DASHSCOPE_API_KEY`, `MOONSHOT_API_KEY`, `ZHIPUAI_API_KEY` or `OPENROUTER_API_KEY`. For Ollama, pull a tool-capable model first, e.g. `ollama pull qwen3`.
- **Not supported**: Chinese "Coding Plan" keys, because their terms only allow interactive coding tools.

**Test connection** sends one short request through whichever option is active. In auto mode the editor prefers the Claude Code login, then the Claude API key, then a configured other provider.

In the chat panel's header you pick the model, the reasoning effort (Claude Code, the Claude API, Codex and Antigravity take an effort; higher thinks longer and uses more of your plan) and what the AI may do. Type `/` in the message box to search the prompt library, or open it with the lightbulb; the expand button gives the chat half the window, and the column button at the right end of the tabs runs the panel the full height of the window. Select text anywhere (a caption, a setting, a shot design, a reply) and click **Add to chat** to quote it with the scene and field it belongs to. The button next to the logo folds the library away.

### What the AI may do

- **Editor only** (the default): the assistant runs the editor's own CLI on the open project and nothing else, as described above.
- **Full access**: it works like an assistant in your own terminal. It can write files (HTML scenes, SVG, scripts, subtitles), run programs such as ffmpeg, read your code, search the web and, with Claude Code, use your own skills and MCP servers. Reads and edits inside the project folder run at once. Shell commands and changes outside the project folder stop and ask in the chat: **Allow**, **Allow all in this chat** or **Decline**; a declined step does not run, and nothing is asked or run while no one is in the panel. The timeline itself still changes only through the editor CLI, so versions, undo and the live preview stay in sync. Claude Code keeps its own tools and asks through its permission prompt (`--permission-prompt-tool`); the Claude API, other models, Codex and Antigravity get Cutroom's `shell`, `read_file` and `write_file` tools, with their own shell and file tools still off. Gemini CLI can't ask in the panel, so here it stays on editor only.
- **Allow everything**: the same tools as Full access, and no step stops to ask, for every connection including Gemini CLI. Pair it with rolling back.

### Rolling back

Before each message the editor saves a checkpoint of the project folder, plus the files outside it that the assistant changes with its file tools. Hover a message you sent and click **Roll back to here** to put the files back as they were before it; the line this leaves in the chat has **Undo**. Changes that shell commands make outside the project folder can't be rolled back. Checkpoints are kept in `.editor/<project>/checkpoints` (the last 50; files over 500 MB are not copied).

## A storyboard

```json
{
  "slug": "my-video",
  "title": "My video",
  "theme": { "accent": "#3b6ef5", "bg": ["#0b1020", "#1a2140"] },
  "scenes": [
    {
      "id": "intro",
      "lines": [{ "zh": "这是新版的搜索。", "en": "This is the new search." }],
      "visual": { "kind": "title", "title": "New in v1.1" },
      "fx": { "vignette": 0.35, "grain": 0.2 },
      "sounds": [{ "id": "whoosh", "at": 0.2 }]
    },
    {
      "id": "demo",
      "transition": "dip",
      "lines": [{ "zh": "点哪里，推近哪里。", "en": "It zooms in on every click.", "at": "@add-0.3" }],
      "visual": { "kind": "screen", "src": "cap/planner.mp4", "to": "@filter+1.2" },
      "overlays": [{ "kind": "arrow", "at": 3.6, "text": "auto zoom", "x": 0.62, "y": 0.36 }]
    },
    {
      "id": "growth",
      "lines": [{ "zh": "注册翻了一倍。", "en": "Signups doubled." }],
      "visual": { "kind": "html", "src": "scenes/growth/index.html", "vars": { "title": "Q3" } }
    }
  ]
}
```

`zh` holds the main caption line (any language) and `en` an optional second-language line under it. Run `node editor/dist/cli.mjs fx` for every effect field.

Projects live in `public/<slug>/` together with their media. Create one from the project menu in the editor or with `new`, or drop images, video, music and HTML pages onto the editor window to import them.

## Editing from the command line

The CLI is what the AI assistant uses, and you can use it too. Changes show up live in an open editor.

```bash
node editor/dist/cli.mjs showcase ls --format tall              # timeline as rendered
node editor/dist/cli.mjs showcase trim record --to @filter+0.8   # keeps the mark anchor
node editor/dist/cli.mjs showcase split record 4.2
node editor/dist/cli.mjs showcase set photo fx.look '"warm"'
node editor/dist/cli.mjs showcase add title intro                 # new title card after "intro"
node editor/dist/cli.mjs showcase log --unseen                    # what changed in the UI since you last looked
node editor/dist/cli.mjs showcase check                           # problems to fix before export, each with its fix
node editor/dist/cli.mjs showcase look record photo+2.5           # render frames as an export would, for the AI to look at
node editor/dist/cli.mjs showcase show all                        # every scene's JSON
node editor/dist/cli.mjs showcase media                           # recordings (with marks), images, videos, HTML pages, music
node editor/dist/cli.mjs showcase music use realizer             # background music from the library
node editor/dist/cli.mjs showcase voice                           # voice-over for lines without current audio
node editor/dist/cli.mjs showcase voice --lang en --redo          # re-voice the English track
node editor/dist/cli.mjs showcase voice install                   # HD voices: Python environment + Qwen3-TTS model (NVIDIA card)
node editor/dist/cli.mjs showcase voice clone me.wav --text "…"    # your own voice from a clip (with the words it says)
node editor/dist/cli.mjs showcase voice use local casual_f        # use an HD voice
node editor/dist/cli.mjs showcase inspect https://example.com     # a page's clickable elements and their selectors
node editor/dist/cli.mjs showcase record demo https://example.com '[{"wait":800},{"mark":"more"},{"click":"text=\"Learn more\""},{"wait":1500}]'
node editor/dist/cli.mjs showcase rerecord all                    # record the websites again from their saved steps
node editor/dist/cli.mjs showcase windows excel                   # open windows that match, and the screens
node editor/dist/cli.mjs showcase record-window sheet EXCEL.EXE --note "Type the totals, then Stop" --marks typed
node editor/dist/cli.mjs showcase swap planner cap/sheet.mp4      # new footage in a scene; its lines and sounds stay
node editor/dist/cli.mjs showcase plan                            # per scene: what is said, what is shown, text that repeats the words
node editor/dist/cli.mjs showcase rules add "Captions under 16 characters"   # a standing rule the assistant follows
node editor/dist/cli.mjs showcase export --lufs -14              # export at the loudness video platforms expect
node editor/dist/cli.mjs showcase html vars loop                  # an HTML scene's variables and their values
node editor/dist/cli.mjs showcase export --format tall
node editor/dist/cli.mjs my-app new "My app"                      # a new project
node editor/dist/cli.mjs fx                                       # every effect field and its range
```

## Keyboard shortcuts

| Key | Action |
|---|---|
| Space | Play / pause |
| ← / → | One frame back / forward (with Shift: one second) |
| Home / End | Go to the start / end |
| S, Ctrl+B or Ctrl+K | Split at the playhead |
| Q / W | Trim the scene's start / end to the playhead |
| Ctrl+D | Duplicate the scene |
| Delete | Delete the selected scene, sound or overlay |
| Ctrl+Alt+C / Ctrl+Alt+V | Copy / paste a scene's effects |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z or Ctrl+Y | Redo |
| N | Snapping on / off (hold Alt while dragging to skip it) |
| Esc | Deselect |
| Ctrl+click | Point the AI at what you click |
| Ctrl+, | Settings |

## How it works

```
 timeline UI ──PUT──┐                         ┌── Remotion Player (preview)
                    ├──► storyboard.json ◄────┤
 AI chat ─► CLI ────┘    (versioned saves,    └── remotion render (export)
 coding agent ─► CLI      log + snapshots)
             file watcher ─► server-sent events ─► every open editor
```

- `src/`: the Remotion composition: scenes, camera, captions, effects, transitions. `src/lib/html.ts` is the HTML scene runtime that sets a page's clock frame by frame.
- `src/fx/`: the effect library: text animations, transitions, overlays, cards, backdrops, scene effects, sounds, and `registry.ts`, the list that drives the UI and the previews.
- `editor/src/`: UI (React), server, CLI, edit operations, the effects catalog behind the UI, the CLI's `fx` listing and the AI's instructions, plus the AI providers (`chat.ts`, `compat.ts`, `agents.ts`, `mcp.ts`), voice-over (`voice.ts`, `voices.ts`, HD voices in `localvoice.ts` with the Python worker in `editor/py/`), web recording and re-recording (`record.ts`), desktop recording (`desktop.ts`), imports and marks (`importfile.ts`), the assistant's saved rules (`rules.ts`), export loudness (`loudness.ts`), HTML scene files (`htmlfiles.ts`) and exports (`exporter.ts`).
- `tools/capture.mjs`: deterministic screen recorder. `editor/demo/capture.mjs` shows how to script one.
- `tools/deskrec.cs`: the Windows helper for desktop recording (window list, record bar, pointer log), compiled on first use with the C# compiler that ships with Windows. FFmpeg's `gfxcapture` does the capture.
- `editor/fx/previews.ts`: renders the hover previews into `public/_fx/` (`npm run previews`; `--only transition/whip` for one).
- `skills/cutroom/` and `.claude-plugin/`: the skill and plugin for coding agents.
- `app/`: desktop shell; `electron-builder.yml` and `build/installer.nsh` make the installer, and `build/cutroom.cmd` becomes the command line next to `Cutroom.exe`.

## Tests

```bash
npm test             # unit tests: edit operations, timeline model, effects catalog, AI providers, voice-over, recording and re-recording, desktop recording (on Windows it records a test window it opens, with scripted input), HTML scenes, CLI
npm run typecheck
npm run test:e2e     # drives the editor in headless Chrome against a throwaway copy of the showcase
npm run test:oracle  # preview frames vs. Remotion's renderer (PSNR ≥ 50 dB; most frames identical), HTML scenes included
npm run test:app     # launches the desktop app hidden and checks it starts and cleans up
npm run test:shots   # screenshots every panel, tab, menu, dialog and error state into .scratch/uishots
```

The e2e, oracle, app and screenshot scripts need the editor running (`npm run editor`) and Chrome installed.

## Limitations

- The timeline is scene-based and always closed up (ripple). There is no free placement on multiple tracks; overlays and sounds attach to scenes instead.
- Twelve of Remotion's shader transitions need an experimental Chrome flag, so they are not offered.
- The built-in voices are clear but not studio quality, and Chinese voices now and then misread a rare word: listen back, or switch to the HD voices or a cloud voice. HD voices sample each take, so a line can come out differently on a redo; redo a line you don't like. Your own recording can replace any line through `timings.json`.
- Recording needs Google Chrome or Microsoft Edge. It opens a fresh browser, so pages behind a login can't be recorded; record those with Record an app instead.
- Desktop recording is Windows-only. You work the app yourself, so `rerecord` can't repeat it. Window capture leaves out menus and pop-ups, which are separate windows: use the window area mode for those.
- HTML scenes: sound inside a page is not exported, and pages that load scripts or fonts from the internet need a connection to preview and export. Animation driven by timers or `requestAnimationFrame` can't be seeked; `html check` points it out.
- Rendering is local. There is no cloud rendering like Remotion Lambda.
- Windows only so far, and the installer is unsigned.

## Credits and license

Cutroom is MIT-licensed. Remotion has its own license: free for individuals and companies with up to three employees, while larger companies need a [company license](https://www.remotion.dev/license). HTML scenes follow the HyperFrames composition conventions (timing attributes, `window.__timelines`, adapter registries, variables) so compositions play unchanged; the runtime that plays them is Cutroom's own. The built-in voices are [Kokoro-82M v1.1-zh](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh) (Apache-2.0) run through [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache-2.0); the model is downloaded on first use, not bundled. The HD voices run [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) (Apache-2.0), installed on request. The JianyingPro draft writer follows the format of [pyJianYingDraft](https://github.com/GuanYixuan/pyJianYingDraft) (Apache-2.0). Bundled music and sounds, and the HyperFrames designs the effect library adapts (Apache-2.0), are listed in [CREDITS.md](CREDITS.md).
