// The contract of each stage: what to do, what to deliver, when it is done, where failures go
import type { Gates, Stage } from '../../src/lib/types';
import { gatesFor } from './flow';

export function guide(stage: Stage, gates: Gates): string {
  const g = gatesFor(gates);
  // Going back to table: what it costs
  const structural = `flow stage table only for structural changes (adding, removing or reordering scenes): ${g.includes('sample') ? 'it reopens the sample checkpoint, so the user approves the sample again' : 'the project then goes through sample and full again'}`;
  switch (stage) {
    case 'brief':
      return `Stage brief.
Do: find out first (ls, media, plan, the user's material and pages). Then brief write '<text>' (for long text: brief write - with the text on stdin, or brief write <file> for a file in the project or temp folder) with the seven blocks <role> <inputs> <direction> <structure> <build> <gotchas> <start>. <inputs> holds what the product is and who the video is for, the one sentence viewers keep, length and size, brand colours and fonts, voice, music, and three lists, each a key line followed by "- item" lines: features: (must-show features), terms: (names exactly as captions must spell them), data: (what on screen is real, faked or blurred). <direction> starts with why the video exists in one sentence and ends with an avoid list (e.g. purple neon glow, centred big text on a gradient, everything fading in at once, effects over what is being clicked). Facts only from the user's material; mark defaults as defaults; list missing real material (a logo, a page you can't reach) as gaps instead of inventing it.
Deliver: brief.md.
Done when: brief write reports nothing missing. Then: flow stage plans.
Failures go to: the user, only for a fact you cannot find (one question).`;
    case 'plans':
      return `Stage plans.
Do: three plans that differ on purpose: A stays closest to the material, B uses another visual language, C tells it another way (one running subject, one long take, a metaphor). plans write a '<markdown>' for each (for long text: plans write a - with it on stdin, or plans write a <file> for a file in the project or temp folder): "# Plan A: <name>", one sentence, look (2–4 colours, fonts), motion personality (energy low/high and tone serious/playful, giving entry duration, easing, overshoot), length and size, one line per shot with seconds, sound, risks. For each, build its most typical shot as a scene (often an HTML page: html write plan-a '<page>') and run plans preview a '<scene json>' --at <seconds> (add --motion 3 when the plan's point is movement). Open every image and fix what is off before showing it.
Deliver: plans/plan-a.md, plan-b.md, plan-c.md with a preview each.
Done when: three plans and three previews exist and you looked at each. ${g.includes('plan') ? 'Then: flow wait plan and end your turn with one sentence saying the three plans are in the card above.' : 'Then: pick the strongest, record it with flow choose <a|b|c> (the reviewer judges the look against it), say which in one line of your final reply, and flow stage script.'}
Failures go to: this stage. A message while the user is choosing is feedback: change only what it names, update brief.md when a decision changed, re-render that preview, then flow wait plan again.`;
    case 'script':
      return `Stage script.
Do: narration lines for the chosen plan, one line per on-screen action, said like a person talks; spell product names as in the brief's terms list; the first 3 seconds say or show the result. Lay the scenes out (add, set <id> lines), then voice. From now on the real voice lengths size every scene.
Deliver: every scene has its lines and current voice.
Done when: check lists no missing or stale voice. Then: flow stage table.
Failures go to: brief, when the plan can't be said in the length the brief allows.`;
    case 'table':
      return `Stage table.
Do: one scene per line or per page. For each scene: set <id> shot "…" (what the picture proves beyond the words, and how it is made), set <id> role a (real footage of the product) or b (made explanation), set <id> intent "…" (the one conclusion the viewer takes), and set <id> seam "…" where an object carries over the cut (which object, where, how big). Merge scenes that add no new conclusion; split a scene that carries two. Nothing appears before the line that introduces it. Hold budget: a logo or brand mark stays ≥ 1 s, ≥ 0.5 s of stillness after a batch of entrances, the opening's main action lasts ≥ 3 s. Size the lines and scenes to the length the brief asks for (plan notes a cut more than 10% off it). Don't record final footage yet.
Deliver: role, intent and shot on every scene.
Done when: plan reports no scene without role or intent and no must-show feature without a scene. Then: flow stage sample.
Failures go to: brief, when a must-show feature has no material.`;
    case 'sample':
      return `Stage sample.
Do: build for real the opening and the riskiest passage (the hardest recording, the trickiest transition), with at least one real cut between them: record their footage paced to each line, build their cards and HTML scenes, look lines, check. Then review run <their ids> (it renders the sheets itself and has an independent reviewer judge them); fix what it marks, at most 2 review rounds (then show the sample with what is left). This passage becomes the reference the rest copies.
Deliver: those scenes finished and one or two review rounds in review/log.md.
Done when: the round says ready, or after 2 rounds its remaining problems are listed. ${g.includes('sample') ? 'Then: flow wait sample and end your turn with one sentence saying the sample is in the card above.' : 'Then: flow stage full.'}
Failures go to: table when the plan itself is wrong; otherwise this stage. A message while the user is looking is feedback: change only what it names, review run those scenes again, flow wait sample again.`;
    case 'full':
      return `Stage full.
Do: build the remaining scenes in batches of a few related scenes, copying the sample's look and motion. After each batch: look lines for those scenes, check, and review <ids> for the cuts around them (sheets only, no reviewer call); fix before the next batch. review run is for the sample and the review stage, not for every batch. Watch for sameness creeping in (the same card, entrance and rhythm everywhere): go back to the scene's intent and pick the form that proves it. Fix feedback at the smallest slice (wording, timing, picture or code); never rebuild scenes that already passed.
Deliver: every scene built.
Done when: check is clean and look lines matched every line. Then: flow stage sound.
Failures go to: the shot table when a scene can't prove its intent with the material there is: fix that row in place with set (shot, intent, lines) and rebuild only that scene; ${structural}.`;
    case 'sound':
      return `Stage sound.
Do: only now, with the picture locked: music under the voice, sound cues on actions (placed relative to the scene or a mark), no cue on every cut by default. If the picture changes after this, re-check every cue.
Deliver: music and cues in place.
Done when: check shows no overlapping or silent cues. Then: flow stage review.
Failures go to: full, when a cue needs a picture change.`;
    case 'review':
      return `Stage review.
Do: review run (it renders the contact sheets itself, of the whole cut, and an independent reviewer that sees only the brief, the chosen plan, the shot table and the sheets judges them). If review run says it is not available on this connection, look at the sheets as a critic, item by item against the checklist, and save it with review log '<report>' (marked self-review). Send each problem where it is fixed: a shot-table problem (a row's shot, intent, lines, seam or role) → fix that row in place with set and re-render only the scenes it names; picture problems → fix only the named scenes; sound → fix the cues. Use ${structural}. Then review run again.
Deliver: review/log.md with a ready round, or after 3 final rounds the list of what is left (sample and batch rounds don't count).
Done when: ready, or 3 final rounds. Then: flow stage done and reply with the reviewer's verdict, what it looked at, and any problems left.
Failures go to: the stage named above.`;
    case 'done':
      return `Stage done. The video is finished. Export only when the user asks (export --lufs -14). Later edits are normal edits; a request to rebuild the whole video starts again with flow stage brief.`;
  }
}
