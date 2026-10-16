---
name: cutroom
description: Make or refresh a demo video of software the user is building, with Cutroom. Records the app or website (clicks, typing, auto-zoom), cuts it into a narrated video with captions, voice-over, effects and HTML scenes, re-records it after the UI changes, and exports MP4 in 16:9 and 9:16 or a 剪映 (JianyingPro) draft. Also breaks a reference video into shots to learn its pacing. Use when the user asks for a demo video, product walkthrough, launch or release video, feature clip, changelog video, README GIF or vertical social clip of something they made, or to update one after a release.
---

# Cutroom

Cutroom keeps each video as one `storyboard.json` and edits it through a command line you can drive without any prompts. The user can open the same project in the Cutroom editor and watch every change land in the preview within a second. Edits made there show up for you in `log --unseen`.

## Find the command line

Use the first one that exists, and call it `CUT` below:

1. Desktop app (Windows): `"%LOCALAPPDATA%\Programs\Cutroom\cutroom.cmd"` in the default install folder; otherwise `cutroom.cmd` next to `Cutroom.exe`. Projects live in `Documents\Cutroom`.
2. A source checkout (`git clone https://github.com/WEBGRS/cutroom`, then `npm install && npm run build`): `node <checkout>/editor/dist/cli.mjs`, run from the checkout. Projects live in `public/`.

Every command is `CUT <project> <command> [args]`. `CUT help` prints all of them; `CUT fx` lists every effect field.

## Make a demo

1. `CUT my-demo new "My app"` creates a project with an intro and an outro.
2. Look at the page first: `CUT my-demo inspect http://localhost:3000` lists headings and clickable elements with selectors.
3. Record what to show, with a `mark` before each moment you will talk about:
   `CUT my-demo record signup http://localhost:3000 '[{"mark":"open"},{"click":"text=\"Sign up\""},{"fill":["#email","ada@example.com"]},{"mark":"submit"},{"click":"button[type=submit]"},{"wait":1500}]'`
   Local dev servers work. Pages behind a login don't: the recorder opens a fresh browser.
4. `CUT my-demo add screen cap/signup.mp4 intro` puts it after the intro. Write narration lines that sync to the marks:
   `CUT my-demo set <scene-id> lines '[{"zh":"Sign up takes one field.","at":"@open"},{"zh":"Then you are in.","at":"@submit"}]'`
   The `zh` field holds the main caption in any language; `en` is an optional second-language line under it.
5. `CUT my-demo voice` voices the lines with the current engine (default: the built-in offline voices, one-time 147 MB download). `--lang en` voices the `en` lines. On a PC with an NVIDIA card the HD voices sound far more natural and read English words inside Chinese: `CUT my-demo voice list` shows whether they are installed; `voice use local casual_m` picks one (install with `voice install` only when the user agrees: about 10 GB). `voice clone <clip> --text "…"` makes the user's own voice from a recording of them.
6. `CUT my-demo check` lists problems, each with the command that fixes it. Fix them.
7. `CUT my-demo look <scene-id> <scene-id>+2.5` renders frames exactly as exported and prints image paths. Open them and fix what looks wrong (text over bright footage gets `"plate": true`).
8. `CUT my-demo export` writes the MP4 and prints its path. Add `--format tall` for 9:16, `--clean` to hide URLs, `--out <file>` to choose the file.

Tell the user they can open the project in the Cutroom editor to adjust it by hand.

## Desktop apps (Windows)

You can't click in desktop apps, but the user can, and Cutroom records them while they do:

1. `CUT my-demo windows excel` lists the open windows whose title or program matches (and the screens).
2. `CUT my-demo record-window sheet "EXCEL.EXE" --note "Type the totals, then press Stop" --marks typed,chart` puts a record bar on the user's screen with your note. They press Start (F9), do it, press Mark (F9) at each beat, then Stop (F10). The command returns when they stop and saves `cap/sheet.mp4`; pointer moves and clicks are logged, so the camera zooms in on clicks like in a web recording, and Mark presses become `@typed`, `@chart`. `--area` records the window's place on screen, so its menus and pop-ups show. `record-screen <name> [n]` records a whole screen.
3. Use it like any recording: `add screen cap/sheet.mp4 <after-id>`, or `swap <scene-id> cap/sheet.mp4` to put it into an existing scene (lines and sounds stay).

Ask before starting one: it needs the user's time. A video the user already made (OBS, Game Bar, a phone) comes in with `CUT my-demo import <file>`; name its moments with `mark <recording> <name> <seconds>`.

## Plan, rules and delivery

- `CUT my-demo plan` prints, per scene, what the narration says, what the picture shows and the text on screen, and notes where the picture only repeats the words or the words describe an action that no footage shows.
- `CUT my-demo rules` lists the user's standing preferences (`<project>/RULES.md`, and `--all` for every project). When the user corrects something meant to last, `rules add "…"`.
- `export --lufs -14` sets the loudness video platforms expect; every export reports its loudness.

## When the product changes

`CUT my-demo rerecord all` records every website again from its saved steps (desktop recordings are made again with `record-window <name> … --replace`). Captions, cuts and sounds anchored to marks follow the new footage. Run `check`: it names anything anchored to a mark the new recording no longer has. Then `look` and `export`.

## Things the library doesn't have: HTML scenes

When no card or overlay shows what is needed (a chart of real numbers, a diagram, a branded title), write an HTML page and use it as a scene:

```
CUT my-demo html write growth '<!doctype html>…'
CUT my-demo add html scenes/growth/index.html <after-id>
CUT my-demo look growth+1 growth+3
```

Page rules (the same contract as HyperFrames compositions, which also work unchanged):

- One root element: `<div data-composition-id="growth" data-width="1920" data-height="1080" data-duration="5">`. Use 1080×1920 for a 9:16-only scene.
- Animate with CSS `@keyframes` or `element.animate(…)`, finite durations, `fill: both`. Time 0 is the start of the scene. A paused GSAP timeline registered as `window.__timelines["growth"]` works too (load GSAP with a script tag).
- Elements with `data-start` / `data-duration` show only in that window.
- No `Date.now`, timers or `requestAnimationFrame` loops: Cutroom sets the clock frame by frame, and anything else differs between preview and export.
- No sound inside the page; add music, sound effects and voice-over in Cutroom.
- Music: `CUT my-demo music help` explains how to write a track as a score (real instrument recordings play it; needs the XSXB-Band studio installed). `music compose <name> <draft>` renders it into the library, `music use <name>` puts it under the video. You cannot hear it: say so and let the user listen.
- Declared variables (`data-composition-variables` on the root) can be filled per scene: `CUT my-demo set growth visual.vars.title '"Q3"'`.

`CUT my-demo html check growth` lists problems. `CUT my-demo add html <path>` copies an existing page or composition folder into the project.

## More tools

- **Learn from a reference video.** `CUT my-demo shots <video>` lists every shot with its start, length and camera move (static, pan, push in, handheld…), saves three keyframes per shot and a page that plays any shot when clicked (`ref/<name>/index.html` in the project). Open a few keyframes, then match the reference's average shot length and kinds of shots. Run it on your own export to check the rhythm.
- **9:16 from wide footage.** `CUT my-demo reframe <scene-id>` crops an image or video scene for 9:16 so the part with the most motion and detail stays in view. It writes a separate 9:16 visual; check it with `look <scene-id> --format tall`.
- **A person talking.** `CUT my-demo cut-silence <scene-id>` removes pauses of 0.5 s or more (`--min` to change) and splits the scene into jump-cut pieces. Set `visual.muted` to false on the pieces so the speech is heard.
- **Art that doesn't exist yet.** `CUT my-demo imagine logo "a paper plane logo, flat, blue" --transparent` saves `media/logo.png` (needs an OpenAI or Gemini key in the environment or Cutroom's Settings; transparency needs OpenAI). Put it on a scene as an image overlay: `CUT my-demo set <scene-id> overlays.0 '{"kind":"image","src":"media/logo.png","at":0.3,"dur":3,"x":0.8,"y":0.25,"w":0.2,"enter":"pop"}'`.
- **File size limits.** `export --max-mb 15` sets the bitrate so the file fits.
- **Finishing in 剪映 (JianyingPro).** `export --jianying` renders the picture and writes a JianyingPro draft with the narration, music, sound effects and captions on their own tracks and adds it to JianyingPro's draft list. Use it when the user wants to finish the edit there.

## Rules

- Change videos only through the command line, never by editing `storyboard.json` directly: the CLI keeps versions and the editor's undo history.
- One command per call. Prefer the dedicated commands (`trim`, `split`, `mv`, `add`, `min`) over `set`.
- Only record pages the user asked for.
- Cutroom renders with Remotion. Remotion is free for individuals and companies of up to three people; larger companies need a Remotion company license. Mention it if the user is making the video for a company.
