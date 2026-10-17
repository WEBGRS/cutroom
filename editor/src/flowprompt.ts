// The assistant's workflow instructions: whole videos follow the stages, edits follow the editing steps
import type { Storyboard } from '../../src/lib/types';
import { contentKey, describe } from './flow';

export const EDIT_STEPS = `1. Find out first. \`ls\` (with the --format of the user's current view, given in each message) shows the timeline; \`show <id>\` a scene's JSON; \`media\` the footage the project already has; \`windows <word>\` the apps open on this computer. Never ask the user for something these tell you. For a request to improve, restructure or review the video, also run \`plan\`: per scene what the narration says, what the picture shows and the text on screen, with notes where the picture only repeats the words or the words describe an action no footage shows.
2. Shot list, before any recording for a new video or a rebuild: for each narration line write the page and the action that shows it ("courses site: search COMP SCI 400, open it, the grade chart"). Every site, page or feature the narration names gets footage of its own; a line goes only over footage of what it says. A home page that lists or links to things is not footage of those things: record each of them. Plan one scene per line or per page, and build from that list. Each scene is one shot: write its shot design into the scene with \`set <id> shot "…"\` (in the user's language: the page or app, the actions in order, the camera and any card or text, e.g. "选课网站：搜索框输入 COMP SCI 400，点开课程，镜头推近成绩分布"), so the user can read and change how every shot is made.
3. Get the footage. Choose by what has to be on screen:
   - A website or web app: \`inspect <url>\`, then \`record <name> <url> '<steps>'\`. You work it (scripted clicks and typing).
   - Cutroom itself: \`record\` with this editor's address (below). You work it.
   - A desktop app (JianyingPro/剪映, DaVinci Resolve, Excel, an IDE, a game, anything not in a browser): \`windows <word>\` to find it, then \`record-window <name> "<program or title>" --note "<what to do>" --marks <beat1>,<beat2>\`. The PERSON works the app while a record bar on their screen shows your note; the command returns when they press Stop. Clicks and pointer moves are logged, so the camera zooms in on each click like in a web recording.
   - Several apps or the desktop: \`record-screen <name> [n] --note … --marks …\`, worked by the person the same way.
   - A video they already have (OBS, Game Bar, a phone, an export): \`import <path>\`; name its key moments with \`mark <recording> <name> <seconds>\` (find them with \`look\` or \`shots\`).
   - Something that doesn't exist as footage (numbers, a diagram, a comparison, a title): a card (\`add <kind>\`) or an HTML scene.
4. Put it on the timeline. A new scene: \`add screen cap/<name>.mp4 <after-id>\`. Different footage in an existing scene (keeps its lines, sounds and transition; overlays made for the old picture are removed): \`swap <id> cap/<name>.mp4\`. Show only the part that matters: \`trim <id> --from @mark --to @mark\`.
5. Words. Narration lines: \`set <id> lines '[…]'\` or \`set <id> lines.<k>.zh "…"\`; tie a line to the moment it describes with "at": "@mark".
6. Voice. Run \`voice\` after lines change (it only voices lines without current audio).
7. Look, line by line. \`look lines\` renders one frame in the middle of every narration line with that line's caption on it. Open every frame and check that the picture shows what its line says (the page, the feature, the result it names); for each one that doesn't, fix it (record the right page, swap, trim, move or rewrite the line) and look again. \`look <id>\` checks layout, text and colour in a scene.
8. Check. Run \`check\` after your last edit (again if you changed anything since) and fix what it lists. A recording shorter than its narration can't be fixed by you alone: shorten the lines, or say in the reply that a longer recording is needed and how long.
9. Reply (rules at the end).`;

export function workflowSection(board: Storyboard | null): string {
  const now = board ? describe(board.workflow, contentKey(board)) : 'unknown';
  return `## Workflow
Making or rebuilding a whole video follows the stages below. Anything else (an edit, a fix, a question, one new scene) uses the editing steps the request needs.
This project: ${now}

### Making a whole video
Run \`flow\` first in every turn of this process: it prints the mode, the stage, whether the user is choosing, and the current stage's contract (what to do, what to deliver, when it is done). Work only in that stage, and move on with \`flow stage <next>\` when its contract says so.
0. Start. The size (16:9 widescreen for Bilibili or YouTube, 9:16 vertical for Douyin, Xiaohongshu, Shorts or Reels) and the checking mode must be known. Modes: plan+sample (the user approves the plan, then a finished sample), plan (only the plan), none (no stops). Take them from the request or the board; ask only for what is missing, both in one sentence, and stop until they answer. Then \`set - format '"wide"'\` or \`set - format '"tall"'\` (the editor's preview switches to it) and \`flow start <mode>\`. Build for the size: \`ls\` and \`look\` with that --format, HTML scenes at its size, \`reframe\` for footage in 9:16. A board with a workflow has both: don't ask again.
1. brief → 2. plans (checkpoint plan) → 3. script and voice → 4. shot table → 5. sample (checkpoint sample) → 6. full, in batches → 7. sound → 8. review, by an independent reviewer → 9. done.
- At a checkpoint: write the products, run \`flow wait <plan|sample>\`, and end your turn with one sentence saying the plans (or the sample) are in the card above. Don't list them: the card shows them.
- While \`flow\` says the user is choosing, their message is feedback on that stage. Change only what it names, at the smallest slice (wording, timing, picture or code); \`brief write\` the updated brief when a decision changed; re-render what changed; \`flow wait\` again. Only the user passes a checkpoint, with the buttons in the panel; never try to move past it.
- Mode none: never stop. Where a checkpoint would be, add one line to your final reply instead (e.g. "Took plan B: …").
- After the user has edited by hand (\`log --unseen\` shows their edits), name the pattern in one sentence and offer it as a rule; save it with \`rules add\` only when they agree.

### Editing steps (for edits, and inside the build stages)
${EDIT_STEPS}`;
}
