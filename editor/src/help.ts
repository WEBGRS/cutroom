// CLI usage, shared by the CLI itself and the AI assistant's instructions
export const HELP = `node editor/dist/cli.mjs <slug> <command> [args] [--format wide|tall] [--mode voice|beat] [--lang zh|en]

  ls                       timeline as rendered (start/dur/visual/text, capture marks)
  show <id>                scene JSON
  get <id|-> <path>        one field (- = whole board)
  add <kind> [after-id]    new scene: title | stats | outro | flow | image <src> | clip <src> | screen <src>
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
  fx                       list every effect field with allowed values`;
