# Editor feature research (for Cutroom)

Date: 2026-10-09. Scope: CapCut / Jianying desktop, Premiere Pro, DaVinci Resolve (Edit + Cut), Final Cut Pro, Kdenlive, Descript, Screen Studio, OpenCut.

**Evidence legend.** `[n]` = confirmed by a source in section 4 (read or search-summarised this session). No tag = background knowledge, not re-checked this session. "unverified" = I am not sure the editor has it. Remotion API names in section 3 are recalled from memory: check them against the installed Remotion version before building.

Our model, for reference: ordered scenes, derived durations (ripple only), one visual per scene, narration or beat captions, text overlays, per-scene transition, 2 cuts x 2 aspect ratios, Remotion render, agent CLI on the same JSON.

---

## 1. Feature matrix

Columns: **CC** CapCut/Jianying, **PR** Premiere Pro, **DR** Resolve, **FC** Final Cut Pro, **KD** Kdenlive, **DS** Descript, **SS** Screen Studio, **OC** OpenCut.
`Y` = has it, `-` = no, `~` = partial, `?` = unverified.

### Timeline editing ops

| Feature | CC | PR | DR | FC | KD | DS | SS | OC | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Multi-track timeline | Y [1] | Y | Y | ~ (magnetic storyline + connected clips) | Y | ~ (scene/layer based) | - | Y [6][7] | FCP is the only major editor whose model resembles ours (primary storyline, others attach to it). |
| Ripple delete / gap close | Y (Track Magnet [1]) | Y | Y | Y (default behaviour) | Y | Y (delete text = delete media [9]) | ~ (trim) | ? | |
| Split / blade at playhead | Y [2] | Y | Y | Y | Y | Y (split scene) | Y (trim/cut) | Y | |
| Trim start/end to playhead | Y (Q/W [3]) | Y (ripple trim to playhead) | Y | Y | ? | n/a | Y | ? | CapCut Q/W is the fastest trim gesture. |
| Roll / slip / slide / 4-point | - | Y | Y | Y | ~ | - | - | - | Slip is the only one that survives a ripple model well. |
| Snapping | Y (Auto Snapping [1]) | Y | Y | Y | Y | ~ | n/a | ? | |
| Multi-select, group, link A/V | Y | Y | Y | Y | Y | ~ | n/a | ? | |
| Markers / in-out ranges | ? | Y | Y | Y | Y | ~ | n/a | ? | |
| Nested / compound | ~ (compound clip) | Y (nested sequence) | Y (compound clip) | Y (compound clip) | Y (nested seq since 23.04 [13]) | ~ | - | - | |
| Multicam | - | Y | Y (Resolve 20 SmartSwitch picks the active speaker [11]) | Y | Y | ~ (multi-camera: unverified) | - | - | |
| Proxies for heavy media | ~ | Y | Y | Y | Y (proxy clips [13]) | n/a | n/a | - | |
| Undo/redo, timeline zoom, thumbnails, waveforms | Y | Y | Y | Y | Y | Y | Y | Y | We have these already. |

### Text, captions, transitions, effects, color, speed

| Feature | CC | PR | DR | FC | KD | DS | SS | OC | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Auto captions (speech to text) | Y, 16+ languages [1] | Y; caption translation, 27 languages [10] | Y | Y (Transcribe to Captions, on-device model [12]) | Y (Whisper / Vosk [13]) | Y (core) [9] | ~ (transcript editing listed [5]) | ? | Caption styling is where CapCut leads. |
| Caption style presets / word highlight | Y | ~ (Essential Graphics templates) | Y (Animated Subtitles in v20 [11]) | ~ | ~ | Y | - | ? | |
| Titles / text animation presets | Y | Y (MOGRT) | Y (Fusion titles) | Y (Motion templates) | ~ | ~ | - | ~ | |
| Transitions library | Y [1] | Y | Y | Y | Y | ~ | n/a | ~ (in progress [7]) | |
| Effects / filters | Y (movie-style filters [1]) | Y | Y (Fusion, ResolveFX) | Y | Y (MLT / Frei0r) | ~ | Y (motion blur [5]) | ~ (in progress [7]) | |
| Keyframes | Y [1] | Y | Y (dedicated keyframe editor in v20 [11]) | Y | Y | ~ | n/a (auto) | Y (classic [8]) | |
| Color | Y (HSL, curves [1]) | Y (Lumetri, colour management [10]) | Y (best in class) | Y (colour board, LUTs) | ~ | - | - | - | |
| Chroma key / bg removal | Y [1] | Y | Y | Y (Magnetic Mask [12]) | Y | Y (AI Green Screen [9]) | Y (camera cutout [5]) | - | |
| Speed: constant, ramp, reverse, freeze | Y (optical flow slow-mo [1]; Ctrl+R [2]) | Y | Y | Y | Y | ~ | Y (speed adjustment [5]) | ? | |

### Audio, AI, assets, export, management, collaboration

| Feature | CC | PR | DR | FC | KD | DS | SS | OC | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Audio: fades, ducking, noise reduction, mixer | Y (noise reduction [1]) | Y (Enhance Speech, Auto Ducking) | Y (Fairlight; v20 AI Audio Assistant mixes the timeline [11]) | Y | Y | Y (Studio Sound [9]) | Y (noise reduction, podcast mode [5]) | ? | Ducking music under narration is the one most relevant to us. |
| AI: generate / rough-cut | Y (script-to-video, AI video maker [1][4]) | Y (Generative Extend [10]) | Y (IntelliScript builds a timeline from a script [11]) | ~ | - | Y (Underlord agent edits from instructions [9]) | - | - (plugin and MCP planned [6]) | |
| AI: search footage | ? | Y (Media Intelligence, natural-language search [10]) | ~ | ~ | - | Y | - | - | |
| AI: reframe to 9:16 | Y (Auto Reframe [1]) | Y | Y | Y (Smart Conform [12]) | - | ~ | Y (zooms re-aim for aspect ratio [5]) | - | |
| AI: voice / TTS | Y (1000+ voices, voice cloning [1]) | ~ | ~ | - | ~ (text-to-speech refined in 25.08 [13]) | Y (Overdub) [9] | Y (AI voiceover [5]) | - | |
| Text-based editing | ~ | Y (Text-Based Editing; not re-checked this session) | ~ | ~ | - | Y (core: delete a word, delete the media [9]) | Y ("edit like text" [5]) | - | |
| Templates / assets | Y (templates, stock, GIPHY [1]) | Y (MOGRT, Stock) | ~ | Y (Motion) | ~ | Y | Y (backgrounds, wallpapers [5]) | ~ | |
| Export presets | Y (1080p / 4K, HW accel [1]) | Y (Media Encoder) | Y (Deliver page) | Y (Share destinations) | Y (render presets) | Y | Y (720p/1080p/4K 60 fps, GIF, share link [5]) | Y (no watermark [8]) | |
| Project / media mgmt | ~ (media pool) | Y (bins, Productions) | Y (media pool, Blackmagic Cloud) | Y (Libraries, Events) | Y (project bin, folders) | Y | ~ | ~ | |
| Collaboration | ~ (cloud / team space: unverified) | Y (Frame.io, Productions) | Y (Blackmagic Cloud) | ~ (shared libraries: unverified) | - | Y (comments, shared projects) | share link [5] | - | Ours: agent plus human on one JSON file. |

### Takeaways from the matrix

- The feature set that makes a "polished short demo video" is small: split/trim, speed, captions with styling, transitions, a few filters, audio ducking, 9:16 reframe, and export presets. Everything else (nested sequences, multicam, colour pages) is pro-grade.
- Screen Studio's value is entirely in the *recording* layer: auto zoom on clicks, cursor smoothing/size/hide, motion blur, backgrounds with padding/shadow, camera layouts [5]. We already own the capture marks and automatic camera, so this is where we can lead.
- Descript's differentiator is a *script is the timeline* view [9]. Our narration lines already are a transcript, so this is cheap for us.
- OpenCut's rewrite plans an editor API, plugin architecture, MCP server for agents, headless mode and a scripting interface [6][8]. That validates our "agent edits the same file" direction; it is still a roadmap, not a shipped feature. The classic version is a conventional multi-track editor with keyframes [8]. Star count differs by source (GitHub page says 93.4k [6]; one blog says 45k+ [8]); do not quote it.
- CapCut leads on the AI/template/caption layer. Paywall boundaries between its free and Pro tiers: unverified.

---

## 2. De-facto keyboard shortcuts

Windows keys. `[n]` = confirmed this session; others from memory and should be checked in-app. The Adobe Premiere Pro shortcut page returned 403 to my fetch, and a search surfaced the page for the newer "Premiere" app rather than Premiere Pro; Premiere column below is therefore mostly background knowledge.

| Action | CapCut / Jianying | Premiere Pro | Resolve | Final Cut | Our proposal |
|---|---|---|---|---|---|
| Play / pause | Space [2] | Space | Space | Space | Space |
| Shuttle J / K / L | unverified (a low-quality source claims J/K/L) | J K L | J K L | J K L | J K L (J/L tap = step speed) |
| Frame step | Left / Right [2] | Left / Right | Left / Right | Left / Right | Left / Right; Shift = 1 s (Premiere uses 5 frames, FCP 1 s) |
| Split at playhead | Ctrl+B [2]; Ctrl+Shift+B = all tracks | Ctrl+K (Add Edit [14]) | Ctrl+\ | Cmd+B | **S and Ctrl+B** both |
| Trim to playhead | **Q** = trim left, **W** = trim right [3] | **Q / W** = ripple trim previous / next edit to playhead (recalled; the 403 page blocks re-check) | Shift+[ / Shift+] (recalled) | Opt+[ / Opt+] | **Q / W** (CapCut and Premiere agree) |
| Delete (ripple) | Delete; closes gap when Track Magnet is on [1] | Shift+Delete = ripple delete [14] (plain Delete leaves a gap) | Delete / Backspace variants (unverified which is ripple) | Delete (ripple by default) | Delete = ripple delete (our only mode) |
| Timeline zoom | Ctrl + / Ctrl - [2] | = and - (recalled); \ fit | Ctrl + / Ctrl -; Shift+Z fit | Cmd + / Cmd -; Shift+Z fit | = / -, Shift+Z to fit |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z [2] | Ctrl+Z / Ctrl+Shift+Z | Ctrl+Z / Ctrl+Shift+Z | Cmd+Z / Cmd+Shift+Z | same |
| Copy / paste | Ctrl+C / Ctrl+V [2] | same | same | same | same (scene level) |
| Duplicate | Ctrl+D (one third-party page [2]) | no default; Alt-drag | Alt-drag | Opt-drag (Cmd+D is duplicate project) | Ctrl+D = duplicate scene |
| Marker | M (unverified for CapCut) | M [14] | M | M | M |
| Mark in / out | I / O (unverified for CapCut) | I / O | I / O | I / O | I / O to set preview loop and export range |
| Speed dialog | Ctrl+R [2] | Ctrl+R | Ctrl+R (Retime controls) | Cmd+R | Ctrl+R |
| Keyframe | Alt+K (from a weak source; unverified) | n/a | n/a | n/a | skip until keyframes exist |

Notes:
- The only genuine CapCut vs Premiere split is *split* (Ctrl+B vs Ctrl+K). Q/W trim-to-playhead is shared in spirit and key (CapCut confirmed [3], Premiere from memory).
- Frame step and play/pause are universal. JKL is universal in pro editors; CapCut support unverified.
- Premiere's `E` (extend edit to playhead) is the same idea as Q/W in the opposite direction; skip.

---

## 3. Prioritised list for Cutroom

Fit test: does it work with scenes, derived durations, a single visual layer, one JSON, and Remotion rendering?

### P0: must have, cheap, fits the model

| # | Item | What it is | How it maps |
|---|---|---|---|
| 1 | Shortcut set from section 2 | Space, JKL, arrows, S/Ctrl+B split, Q/W trim, Delete, Ctrl+D, M, I/O, =/-/Shift+Z, undo/redo | Pure UI. Q/W = set the scene's trim-start / trim-end so the scene boundary lands on the playhead (writes the same fields edge-trim already writes). |
| 2 | Duplicate scene, copy/paste scene, paste attributes | Clone a scene; optionally copy only transition/overlays/look onto selected scenes | Deep-copy the scene object with a new id; paste attributes copies a whitelist of fields (`transition`, `look`, `overlays`). CLI exposes the same ops. |
| 3 | Markers and notes | Named points on the project timeline (and on a scene) | `storyboard.markers: [{t | scene+offset, label, color}]`. Zero render impact. Agent can leave "TODO here" notes. Marker names can double as export chapters (item 12). |
| 4 | Loop range and "render selection" | Set I/O, loop playback of that range, export only that range or one scene | Player `inFrame` / `outFrame` / `loop` props; export maps to `remotion render --frames=a-b` (verify). Fast iteration, big win. |
| 5 | Per-scene look (basic filters) | brightness, contrast, saturation, hue, blur, grayscale, sepia, vignette plus named presets | Scene field `look: {preset?, brightness, contrast, saturate, ...}` applied as CSS `filter` on the visual layer; renders identically in Chrome headless. This is the fit-the-model replacement for the color page. |
| 6 | Screen-recording frame (Screen Studio-style background) | Gradient/image background, padding, rounded corners, shadow around the recording | Scene field `frame: {bg, padding, radius, shadow}` on the `screen` visual; a CSS wrapper. High visual payoff, tiny cost. |
| 7 | Constant speed for clip kinds | 0.25x to 4x on video clips and screen recordings | Scene `speed` field; `playbackRate` on `<OffthreadVideo>`/`<Video>` (verify); derived duration = source length / speed; capture marks scale with it. |
| 8 | Beat grid on timeline | Show music bars/beats on the ruler and snap scene edges to them in the music cut | We already derive durations from bars, so this is display plus a snap target. Resolve and Premiere show audio markers; CapCut has beat markers (exact feature: unverified). |
| 9 | Safe-zone and aspect guides | Toggleable overlays for 9:16 platform UI areas and title-safe | Preview-only overlay, no JSON. |
| 10 | Export presets dialog | Pick cut x aspect x preset: "YouTube 1080p", "Shorts/Reels 1080x1920", "4K", "Draft (half scale, higher CRF)", "GIF preview" | Map to Remotion flags (`--scale`, `--crf`, `--codec`, `--every-nth-frame`) (verify). Also "Export this frame as PNG" via `remotion still`. |
| 11 | Sidecar subtitle export | `.srt` / `.vtt` from narration lines or beat captions | Durations are derived, so cue times come free from the scene timeline. Matches the Premiere/CapCut/FCP caption export flow. |
| 12 | Chapter list export | YouTube-style `00:00 Title` lines from scene titles or markers | Same timeline math as item 11. Text file. |
| 13 | Caption style presets | Font, size, colour, outline/box, position, uppercase; 3-5 named presets | Project-level `captionStyle` with per-scene override; pure CSS in the caption component. CapCut's biggest draw. |
| 14 | Audio basics | Per-scene volume, fade in/out, project music volume, mute | Scene/project fields; Remotion `volume` accepts a per-frame function. |

### P1: valuable, moderate effort

| # | Item | What it is | How it maps |
|---|---|---|---|
| 15 | Script view (Descript-style) | One document listing every scene's narration lines; click a line to seek, edit inline, drag to reorder, delete a line | View over `scenes[].narration`. Editing text triggers TTS regeneration for that scene only; durations re-derive. Closest honest analogue to text-based editing. Filler-word removal does not apply (our narration is generated text). |
| 16 | Music ducking | Lower music under narration automatically | Compute a volume envelope from narration scene windows; pass as the `volume` function on the music `<Audio>`; fields `duck: {amountDb, attack, release}`. Premiere (Auto Ducking) and Resolve have this. |
| 17 | Caption word highlight (karaoke) | Active word coloured or scaled as spoken | Needs word timestamps (TTS alignment or Whisper); then highlight by frame. Remotion's `@remotion/captions` has a TikTok-style pager (verify). If our beat captions lack word times, this is P2. |
| 18 | Manual camera regions on screen recordings | Add/move/delete zoom regions on a scene (rect, ease, start/end), override auto camera, "no zoom" regions | Scene field `camera: [{t0, t1, rect|auto, ease}]` merged over the automatic camera. UI is a lane *inside the selected scene's strip*, not a global track. This is Screen Studio's manual mode (switch auto to manual, pick region, zoom level, glide [15]). |
| 19 | Cursor polish controls | Cursor size, smoothing strength, hide-when-idle, click ripple | Scene or project fields feeding the existing cursor renderer. All Screen Studio features [5]. |
| 20 | Camera motion blur | Blur on fast camera moves | `@remotion/motion-blur` CameraMotionBlur (verify; expect render time cost; make it a toggle). Screen Studio ships this [5]. |
| 21 | Transition catalogue | Fade, slide, wipe, flip, zoom, clock-wipe plus duration and easing | `@remotion/transitions` presentations (verify). Transitions overlap neighbours, which shortens total duration; our derived-duration engine already has to account for this. |
| 22 | Manual reframe point for 9:16 | Per-scene focus point or crop rect used by the vertical cut | Scene `focus: {x, y}` driving `object-position` / crop on visuals that are not cursor-driven. For screen recordings, reuse the camera. Premiere / CapCut / FCP automate this [1][10][12]; manual is enough for us. |
| 23 | Overlays attached to a scene | Callouts, arrows, highlight boxes, blur/redact boxes, logo, picture-in-picture | `scene.overlays[]` with `{type, rect, from, to}` where times are *relative to the scene*. Overlays move with the scene, never float on a global track; this is exactly FCP's "connected clip" semantics. Blur box = CSS `backdrop-filter` (check headless render). |
| 24 | Text animation presets | In/out: fade, pop, slide, typewriter; lower-third templates | Field on each text overlay (`anim: "pop"`); Remotion `spring` / `interpolate`. |
| 25 | Freeze frame and short speed ramp | Hold the current frame for N seconds; ease-in/out speed | Freeze = new `hold` field on a clip scene or auto-split into a still scene. Ramp = `speed: [{t, v}]` curve. Slightly harder because duration derives from integration of speed. |
| 26 | Slip edit | Change which part of a clip plays without changing scene length | Drag in the inspector changes `sourceOffset`. Fits ripple because duration is unchanged. |
| 27 | Media bin and drag-to-add | Panel listing project assets; dragging one creates a scene of the right kind | Bin = scan of project media folder; drop creates `video`/`image`/`scroll` scene at the drop index. Add relink/missing-file flags. |
| 28 | Preview proxies | Downscaled copies for scrubbing heavy screen recordings | ffmpeg-generated proxy swapped in by the Player, original used by render. Kdenlive, Premiere, Resolve, FCP all do this [13]. |
| 29 | Brand kit / theme | Fonts, colours, logo watermark applied across cards and captions | Project-level `theme` tokens consumed by card kinds; optional `watermark` with corner and opacity. |
| 30 | Caption/narration localisation | Duplicate project text into another language and re-run TTS | `locale` variants in storyboard or a CLI `translate` command; the agent does the translation. Premiere ships caption translation to 27 languages [10]. |
| 31 | Agent-change review | Highlight scenes the CLI changed since last view; show a diff; revert one scene | We already have live two-way sync; add a per-scene "changed by agent" badge and a snapshot list (the JSON is git-friendly). Nothing in the surveyed editors does this; closest is Descript Underlord [9]. |
| 32 | Section groups | Collapsible group of scenes with an optional title card | Maps nested/compound clips onto the flat list: `scene.group` string plus a collapsed UI state. Does not change rendering. |

### P2: later, or does not fit

| # | Item | Why it is P2 | Closest fit |
|---|---|---|---|
| 33 | **Free multi-track placement** (overlapping video tracks, free X/Y positioning in time, gaps) | Breaks derived durations and ripple invariants. | Scene-attached overlays (item 23) for B-roll/PiP; `padBefore` / `padAfter` seconds or a blank "hold" scene instead of gaps. |
| 34 | Roll / slide / 4-point / overwrite / insert-edit modes | Assume free placement. | Ripple insert (default); roll edit = change the split between two adjacent fixed-duration scenes (only meaningful when neither duration is derived). |
| 35 | Multicam | Needs synchronised multi-source angles. | None needed; screen + webcam handled by overlay (item 23) or a split-layout visual kind. |
| 36 | Keyframe curve editor / Fusion-style node graphs | Heavy UI, rarely needed for scene-based explainers. | Limited keyframes on overlay transform (item 24 family) and CSS filters. |
| 37 | Pro colour: wheels, scopes, LUT pipeline, HDR | Out of audience; CSS filters cover 90% of use. | `look.preset` names; optional SVG `feColorMatrix` per scene; real 3D LUT via WebGL only if asked. |
| 38 | Real-time collaboration (cursors, comments, roles) | Single user plus agent today. | File-level sync already exists; a comment field on markers could cover review notes. |
| 39 | AI generative video / extend / upscale / bg removal / eye contact | Needs external models; low fit with programmatic scenes. | Agent can call external tools via the CLI and drop the result in as a `video` scene. |
| 40 | Silence and filler-word removal, Studio Sound-style enhancement | Only relevant to *recorded* voice. | If recorded narration is ever added: ffmpeg `silencedetect` / denoise in the finalize step, then re-derive durations. |
| 41 | Auto-captions from arbitrary footage (Whisper) | Our captions come from scripts; useful only for imported video clips. | A CLI `transcribe` helper that writes caption lines for a `video` scene. |
| 42 | Stock library, GIPHY, template marketplace | Licensing and hosting overhead. | Local asset folder plus the media bin (item 27). |
| 43 | Native/mobile apps, Rust core, plugin SDK (OpenCut's direction [6]) | Out of scope for a Remotion tool. | The JSON schema plus CLI is already our plugin surface. |

### Suggested build order

1. Items 1, 2, 3, 4, 14 (editing feel and fast iteration).
2. Items 5, 6, 7, 13, 10 (visible polish plus export).
3. Items 11, 12, 8, 9 (cheap deliverables and guides).
4. Items 15, 16, 18, 19, 23 (P1 differentiators: script view, ducking, camera control, overlays).
5. The rest by demand.

---

## 4. Sources

Read directly (fetched):
- [1] https://www.capcut.com/resource/pc-professional-video-editor (CapCut desktop feature list)
- [2] https://www.skillademia.com/shortcuts/capcut-shortcuts/ (third-party CapCut Windows shortcuts: Ctrl+B, Ctrl+D, Ctrl+R, undo/redo, zoom)
- [5] https://screen.studio/ (Screen Studio features)
- [6] https://github.com/OpenCut-app/OpenCut (OpenCut status: rewrite, Rust core, MCP server, MIT)

Used via search-result summaries (not fetched in full):
- [3] CapCut Q/W trim and Ctrl+B split: https://fastshortcuts.com/shortcuts/capcut/ and https://primalvideo.com/guides/capcut-for-pc-mac-tutorial/ (the J/K/L and "K and M add transitions" claims in the same results came from SEO-spam pages and are not relied on)
- [4] https://freeacademy.ai/es/lessons/capcut-ai-features ; https://marcandrews.com/?p=3178 (CapCut AI features)
- [7] https://opencut.app/roadmap (OpenCut roadmap, Feb 2026 snapshot)
- [8] https://mer.vin/2026/07/opencut-explained-open-source-capcut-alternative-classic-editor-vs-ground-up-rewrite/ ; https://themenonlab.blog/blog/opencut-open-source-capcut-alternative-video-editor
- [9] https://tooliverse.ai/tools/descript ; https://www.ki-syndikat.de/tools/descript/ ; https://commandlinux.com/ai/descript-ai/ (Descript: text-based editing, Underlord, Studio Sound, Eye Contact, Green Screen, Overdub)
- [10] https://www.businesswire.com/news/home/20250402472642/en ; https://tvtechnology.com/news/nab-show-adobe-launches-generative-extend-ai-for-premiere-pro ; https://www.jonpeddie.com/news/ai-innovations-in-adobe-premiere-pro/ (Premiere: Generative Extend, Media Intelligence, caption translation, colour management)
- [11] https://nofilmschool.com/davinci-resolve-20 ; https://www.broadcastnow.co.uk/production-and-post/nab-2025-blackmagic-adds-ai-powered-rough-cut-and-audio-generation-to-resolve/5203915.article (Resolve 20: IntelliScript, SmartSwitch, Animated Subtitles, AI Audio Assistant, keyframe editor)
- [12] https://newsshooter.com/2024/11/13/final-cut-pro-11-features-magnetic-mask-transcribe-to-captions-and-more (FCP 11: Magnetic Mask, Transcribe to Captions, Smart Conform)
- [13] https://docs.kdenlive.org/more_information/whats_new.html ; https://linuxiac.com/kdenlive-25-08-video-editor-released-with-over-300-fixes/ (Kdenlive: Whisper since 23.04, nested sequences, proxies, 25.08 maintenance release)
- [14] https://helpx.adobe.com/premiere/desktop/get-started/keyboard-shortcuts/default-keyboard-shortcuts.html (search snippet only; fetch returned 403; snippet gave Ctrl+K Add Edit, Shift+Delete Ripple Delete, M Add Marker; this page is for the newer "Premiere" app, so treat as indicative for Premiere Pro)
- [15] https://daveswift.com/screen-studio/ ; https://www.superchargebrowser.com/features/auto-zoom-recording/ (search summaries on Screen Studio manual vs auto zoom; the second is a different product's page, used only for the generic auto-zoom concept)
- Final Cut Pro, Kdenlive and Resolve keyboard shortcuts and most Premiere Pro keys: background knowledge, not verified this session.

Tool problems: the Adobe help page returned 403 and Firecrawl reported no credits; both gaps are flagged in the text above.
