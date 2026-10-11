// CLI usage, shared by the CLI itself and the AI assistant's instructions
export const HELP = `node editor/dist/cli.mjs <slug> <command> [args] [--format wide|tall] [--mode voice|beat] [--lang zh|en]

  new [title]              create the project <slug> (an intro title and an outro); \`projects\` (no slug) lists them
  ls                       timeline as rendered (start/dur/visual/text, capture marks)
  show <id> [id …] | all   scene JSON (several at once)
  get <id|-> <path>        one field (- = whole board)
  add <kind> [after-id]    new scene: title | stats | counter | chart | checklist | quote | chat | notifs | code | terminal | flap | outro | flow
                           | compare <img> | image <src> | clip <src> | screen <src> | html <page>
                           (html: scenes/<name>/index.html, or a page/folder on disk to copy in)
  mv <id> <before-id|end>  reorder
  trim <id> [--from T] [--to T] [--tall]   T = seconds or @mark±x (screen visuals)
  min <id> <sec|off>       minimum length (voice cut)
  bars <id> <n>            length in bars (beat cut)
  split <id> <sec>         split at scene-relative seconds of the current format/mode
  rm <id> | dup <id>
  tall <id> on|off         separate tall visual
  set <id|-> <path> <json> set a field (- = board); value 'undefined' deletes; path '.' replaces the scene
  log [n] [--unseen]       recent edits (ui/cli/external); --unseen marks them read
  diff [from] [to]         compare snapshots (default: before last UI edit → now)
  fx                       list every effect field with allowed values
  voice [scene-id ...] [--redo] [--lang zh|en]
                           AI voice-over for narration lines without current audio (--redo: re-voice them all);
                           --lang en voices the second-language lines
  voice list | voice use <engine> [voice] | voice speed <0.5–2>
                           voice-over engines and voices; pick one (builtin needs no key); speaking rate
  media                    the project's recordings (with marks), images, videos, audio and the music library
  beat [use <music/track.mp3> [--bar N] | off]
                           beat cut music: the tempo comes from the track's beat data (no BPM to set); lists tracks
  look [t | id | id+t ...] render frames exactly as exported and print their image paths (t = seconds or m:ss,
                           id = a scene's middle; up to 8; default: a spread of scenes). Respects --format/--mode/--lang
  check                    problems to fix before export (long captions, missing voice-over, overlapping or silent sounds,
                           unreadable text on footage, missing media, too-short scenes), each with the command that fixes it
  inspect <url> [--mobile] a web page's headings and clickable elements, with selectors for record steps
  record <name> <url> [steps] [--mobile] [--size WxH]
                           screen-record a web page into cap/<name>.mp4 (cursor, clicks and marks are logged
                           for auto-zoom). steps = JSON array, one action each: {"wait":ms} {"click":sel}
                           {"hover":sel} {"fill":[sel,text]} {"type":text} {"press":"Enter"} {"scroll":px}
                           {"scrollTo":sel} {"select":[css,option]} {"mark":name} {"zoom":sel,"scale":1.8}
                           {"unzoom":true} {"until":sel} {"goto":url} {"idle":ms}. sel = CSS or text="Label".
                           No steps: a short scroll through the page. Then: add screen cap/<name>.mp4
  rerecord [name ... | all] record websites again from their saved steps (after the site changed); captions and
                           cuts anchored to marks follow the new footage. No arguments: list them
  html [list]              HTML scenes: pages with seekable animation in scenes/ (HyperFrames compositions work as is)
  html new <name> [sec]    starter page sized to the board (--format tall: 1080×1920)
  html write <name> <html> write or replace scenes/<name>/index.html (the page as one argument, a file, or - for stdin)
  html import <path>       copy a page, or a folder with index.html, into scenes/
  html check [name|id]     problems that make a page render differently in preview and export
  html vars <scene-id>     the page's declared variables and their values (set <id> visual.vars.<var> <json>)
  export [--format wide|tall] [--mode voice|beat] [--lang zh|en] [--clean] [--silent] [--scale 2] [--codec h264|h265|vp9|prores|gif] [--out file]
                           render the video to a file (default: the export folder). --max-mb N keeps the file under N MB
  export --jianying [--out <draft folder>] [--name n]
                           a JianyingPro (剪映专业版) draft instead: the picture per scene, narration, music (with its ducking),
                           sound effects and captions on their own tracks, added to JianyingPro's draft list
  shots <video> [--name n] [--sensitivity 0..1]
                           break a video (a reference to learn from, or your own export) into shots: cut points, lengths,
                           camera moves and three keyframes each, plus a page that plays any shot (ref/<name>/index.html)
  reframe <id> [--format wide]
                           crop an image or video scene for 9:16 (default) or 16:9 so the part with the most motion and detail
                           stays in view; sets tall.pos (a separate 9:16 visual, so the 16:9 cut is untouched)
  cut-silence <id> [--min 0.5]
                           cut pauses of --min seconds or more out of a talking video scene; it becomes jump-cut pieces
  imagine <name> "<prompt>" [--transparent] [--shape square|wide|tall] [--engine openai|gemini]
                           AI image into media/<name>.png (needs an OpenAI or Gemini key; --transparent needs OpenAI);
                           use it as an image scene or an image overlay ({"kind":"image","src":"media/<name>.png",...})`;
