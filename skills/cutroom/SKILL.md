---
name: cutroom
description: Make or refresh a demo video of software the user is building, with Cutroom. Records the app or website (clicks, typing, auto-zoom), cuts it into a narrated or beat-synced video with captions, voice-over, effects and HTML scenes, re-records it after the UI changes, and exports MP4 in 16:9 and 9:16. Use when the user asks for a demo video, product walkthrough, launch or release video, feature clip, changelog video, README GIF or vertical social clip of something they made, or to update one after a release.
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
5. `CUT my-demo voice` voices the lines with the built-in offline voices (one-time 147 MB download). `--lang en` voices the `en` lines.
6. `CUT my-demo check` lists problems, each with the command that fixes it. Fix them.
7. `CUT my-demo look <scene-id> <scene-id>+2.5` renders frames exactly as exported and prints image paths. Open them and fix what looks wrong (text over bright footage gets `"plate": true`).
8. `CUT my-demo export` writes the MP4 and prints its path. Add `--format tall` for 9:16, `--mode beat` for the music cut, `--clean` to hide URLs, `--out <file>` to choose the file.

Tell the user they can open the project in the Cutroom editor to adjust it by hand.

## When the product changes

`CUT my-demo rerecord all` records every website again from its saved steps. Captions, cuts and sounds anchored to marks follow the new footage. Run `check`: it names anything anchored to a mark the new recording no longer has. Then `look` and `export`.

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
- Declared variables (`data-composition-variables` on the root) can be filled per scene: `CUT my-demo set growth visual.vars.title '"Q3"'`.

`CUT my-demo html check growth` lists problems. `CUT my-demo add html <path>` copies an existing page or composition folder into the project.

## Rules

- Change videos only through the command line, never by editing `storyboard.json` directly: the CLI keeps versions and the editor's undo history.
- One command per call. Prefer the dedicated commands (`trim`, `split`, `mv`, `add`, `min`) over `set`.
- Only record pages the user asked for.
- Cutroom renders with Remotion. Remotion is free for individuals and companies of up to three people; larger companies need a Remotion company license. Mention it if the user is making the video for a company.
