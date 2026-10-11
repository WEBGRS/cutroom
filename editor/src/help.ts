// CLI usage, shared by the CLI itself and the AI assistant's instructions
export const HELP = `node editor/dist/cli.mjs <slug> <command> [args] [--format wide|tall] [--mode voice|beat] [--lang zh|en]

  ls                       timeline as rendered (start/dur/visual/text, capture marks)
  show <id>                scene JSON
  get <id|-> <path>        one field (- = whole board)
  add <kind> [after-id]    new scene: title | stats | counter | chart | checklist | quote | chat | notifs | code | terminal | flap | outro | flow
                           | compare <img> | image <src> | clip <src> | screen <src>
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
  voice list | voice use <engine> [voice]
                           voice-over engines and voices; pick one (builtin needs no key)
  inspect <url> [--mobile] a web page's headings and clickable elements, with selectors for record steps
  record <name> <url> [steps] [--mobile] [--size WxH]
                           screen-record a web page into cap/<name>.mp4 (cursor, clicks and marks are logged
                           for auto-zoom). steps = JSON array, one action each: {"wait":ms} {"click":sel}
                           {"hover":sel} {"fill":[sel,text]} {"type":text} {"press":"Enter"} {"scroll":px}
                           {"scrollTo":sel} {"select":[css,option]} {"mark":name} {"zoom":sel,"scale":1.8}
                           {"unzoom":true} {"until":sel} {"goto":url} {"idle":ms}. sel = CSS or text="Label".
                           No steps: a short scroll through the page. Then: add screen cap/<name>.mp4`;
