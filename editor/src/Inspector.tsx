import React, { useEffect, useRef, useState } from 'react';
import type { Format, Fx, Overlay, Scene, SoundCue, StatsVisual, Visual } from '../../src/lib/types';
import { SOUNDS, SOUND_CATS, soundDef, soundSrc } from '../../src/fx/sounds';
import { fmtTime, visualKey, type ETimeline } from './model';
import { getPath, removeSound, replaceScene, setPath, toggleTall, type Caps, type Doc, type Op } from './ops';
import { BOARD_FX, CARD_LIST, DIR_LIST, DIR_TRANSITIONS, LOWER_LIST, OVERLAY_LIST, RULES, SCENE_FX, TEXT_LIST, TRANSITION_LIST, allFields, type FieldDef } from './catalog';
import { Field, FieldControl, JsonEdit, Row, asRef, isNum, num, refOk } from './Fields';
import { Icon } from './icons';
import { nm, tr } from './i18n';
import { getPrefs, usePrefs } from './prefs';
import { HtmlVars, isHtml } from './HtmlParts';

const BASE_KINDS: Record<string, { en: string; zh: string }> = {
  screen: { en: 'Recording', zh: '录屏' },
  clip: { en: 'Video', zh: '视频' },
  scroll: { en: 'Long image', zh: '长图' },
  image: { en: 'Image', zh: '图片' },
};
const kindName = (k: string) => {
  const c = CARD_LIST.find((x) => x.id === k);
  return c ? nm(c) : BASE_KINDS[k] ? nm(BASE_KINDS[k]) : k;
};

type Commit = (fn: (d: Doc) => Op, opts?: { coalesce?: string; timings?: boolean }) => void;

interface Props {
  doc: Doc;
  slug: string;
  format: Format;
  lang: 'zh' | 'en';
  etl: ETimeline | null;
  caps: Caps;
  assets: string[];
  music: { src: string }[];
  sel: string | null;
  focusLine: number | null;
  focus: Focus | null;
  commit: Commit;
  onSelect: (id: string | null) => void;
  actions: { split: () => void; dup: () => void; del: () => void; up: () => void; down: () => void };
  fxClip: Fx | null;
  setFxClip: (fx: Fx | null) => void;
  playheadIn: (id: string) => number;
}

const isImg = (a: string) => /\.(png|jpe?g|webp|gif)$/i.test(a);
const isVid = (a: string) => /\.(mp4|webm|mov)$/i.test(a);

type STab = 'visual' | 'trans' | 'fx' | 'over' | 'sound' | 'lines';
// A page to open, and the item on it (bumped by n so the same one can be opened again)
export interface Focus {
  tab: STab;
  i?: number;
  n: number;
}
type BTab = 'basic' | 'audio' | 'caps' | 'look';

// Remembered per panel, so switching scenes keeps the same page open
function useTab<T extends string>(key: string, ok: readonly T[], d: T): [T, (t: T) => void] {
  const [t, setT] = useState<T>(() => {
    try {
      const v = localStorage.getItem(key) as T;
      return ok.includes(v) ? v : d;
    } catch {
      return d;
    }
  });
  return [
    t,
    (v: T) => {
      setT(v);
      try {
        localStorage.setItem(key, v);
      } catch {
        // Private mode
      }
    },
  ];
}

function Tabs<T extends string>({ value, items, onChange }: { value: T; items: [T, string, number?][]; onChange: (t: T) => void }) {
  return (
    <div className="itabs" role="tablist">
      {items.map(([k, l, n]) => (
        <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : undefined} onClick={() => onChange(k)}>
          {l}
          {n ? <span className="n">{n}</span> : null}
        </button>
      ))}
    </div>
  );
}

export const KIND_COLOR: Record<string, string> = { screen: '#4f8ef7', clip: '#3fb68b', image: '#e0a440', scroll: '#4f8ef7' };
const kindColor = (k: string) => KIND_COLOR[k] ?? '#a78bfa';

// Select over a Named list, with the house-rule note on options that break it
function NamedSelect({ value, list, onChange, style }: { value: string; list: { id: string; en: string; zh: string; rule?: keyof typeof RULES }[]; onChange: (v: string) => void; style?: React.CSSProperties }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={style}>
      {list.map((o) => (
        <option key={o.id} value={o.id}>
          {nm(o)}
          {o.rule ? tr(' (against house style)', '（规范不推荐）') : ''}
        </option>
      ))}
    </select>
  );
}

export function Inspector(p: Props) {
  const { doc, sel } = p;
  const scene = sel ? doc.board.scenes.find((s) => s.id === sel) : undefined;
  const listRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useTab<STab>('vs-itab', ['visual', 'trans', 'fx', 'over', 'sound', 'lines'], 'visual');
  const soundRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (p.focusLine === null) return;
    if (tab !== 'lines') setTab('lines');
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-k="${p.focusLine}"]`)?.scrollIntoView({ block: 'nearest' }));
  }, [p.focusLine, sel]);

  useEffect(() => {
    const f = p.focus;
    if (!f) return;
    if (tab !== f.tab) setTab(f.tab);
    if (f.i !== undefined) requestAnimationFrame(() => bodyRef.current?.querySelector<HTMLElement>(`[data-k="${f.i}"]`)?.scrollIntoView({ block: 'nearest' }));
  }, [p.focus]);

  if (!scene) return <BoardPanel {...p} />;

  const set = (path: string, value: unknown) => p.commit((d) => setPath(d, scene.id, path, value), { coalesce: `${scene.id}.${path}` });
  const key = visualKey(scene, p.format);
  const v = scene[key] as Visual;
  const e = p.etl?.scenes.find((x) => x.id === scene.id);
  const hidden = p.etl?.hidden.find((h) => h.id === scene.id);
  const marks = v.kind === 'screen' ? (p.caps[v.src]?.events ?? []).filter((x) => x.type === 'mark' && x.name).map((x) => x.name!) : [];
  const fps = p.etl?.fps ?? 60;
  const curT = scene.transition === 'fade' ? '' : (scene.transition ?? '');
  const tr0 = TRANSITION_LIST.find((t) => t.id === curT);
  const fxCount = scene.fx ? Object.keys(scene.fx).length : 0;
  const lineCount = scene.lines.length;

  let body: React.ReactNode;
  if (tab === 'visual')
    body = (
      <>
        <div className="sec">
          {p.format === 'tall' ? (
            <label className="check">
              <input type="checkbox" checked={!!scene.tall} onChange={(ev) => p.commit((d) => toggleTall(d, scene.id, ev.target.checked))} />
              {tr('Separate picture for 9:16', '竖屏用单独画面')}
            </label>
          ) : null}
          <VisualFields v={v} k={key} set={set} assets={p.assets} marks={marks} slug={p.slug} setMin={(sec) => set('minSec', sec)} />
        </div>
        <div className="sec">
          <h3>{tr('Placement', '位置')}</h3>
          <Row label={tr('Shown in', '出现在')}>
            <select value={scene.only ?? ''} onChange={(ev) => set('only', ev.target.value || undefined)}>
              <option value="">{tr('16:9 and 9:16', '横屏和竖屏')}</option>
              <option value="wide">{tr('16:9 only', '只在横屏')}</option>
              <option value="tall">{tr('9:16 only', '只在竖屏')}</option>
            </select>
          </Row>
          <Row label={tr('Chapter', '章节名')}>
            <Field value={scene.chapter} placeholder={tr('Leave empty unless a chapter starts here', '不是章节开头就留空')} onCommit={(s) => set('chapter', s || undefined)} />
          </Row>
        </div>
        <div className="sec">
            <h3>{tr('Timing', '时长')}</h3>
            <div className="row3">
              <div>
                <label>{tr('Lead-in s', '前留白 秒')}</label>
                <Field value={scene.lead} placeholder="0.45" validate={isNum} onCommit={(s) => set('lead', num(s))} />
              </div>
              <div>
                <label>{tr('Tail s', '后留白 秒')}</label>
                <Field value={scene.tail} placeholder="0.5" validate={isNum} onCommit={(s) => set('tail', num(s))} />
              </div>
              <div>
                <label>{tr('Minimum s', '最短 秒')}</label>
                <Field value={scene.minSec} placeholder={tr('none', '不限')} validate={isNum} onCommit={(s) => set('minSec', num(s))} />
              </div>
            </div>
          </div>
        <div className="sec">
          <details>
            <summary>{tr('Scene JSON', '整段 JSON')}</summary>
            <JsonEdit value={scene} onApply={(x) => p.commit((d) => replaceScene(d, scene.id, x as Scene))} />
          </details>
        </div>
      </>
    );
  else if (tab === 'trans')
    body = (
        <div className="sec">
          <h3>
            {tr('How this scene comes in', '进入这一段的方式')}
            {tr0?.rule ? <span className="rule" title={nm(RULES[tr0.rule])}>!</span> : null}
          </h3>
          <div className="row3">
            <div style={{ gridColumn: 'span 2' }}>
              <label>{tr('Transition', '转场')}</label>
              <NamedSelect value={curT} list={TRANSITION_LIST} onChange={(x) => set('transition', x || undefined)} style={{ width: '100%' }} />
            </div>
            <div>
              <label>{tr('Length s', '时长 秒')}</label>
              <Field value={scene.transDur} placeholder="0.4" validate={isNum} onCommit={(s) => set('transDur', num(s))} />
            </div>
          </div>
          {DIR_TRANSITIONS.includes(curT) ? (
            <Row label={tr('Direction', '方向')}>
              <NamedSelect value={scene.transDir ?? ''} list={DIR_LIST} onChange={(x) => set('transDir', x || undefined)} />
            </Row>
          ) : null}
        </div>
      );
  else if (tab === 'fx')
    body = (
      <div className="sec">
        <div className="sec-acts">
          <button className="mini" disabled={!scene.fx} onClick={() => p.setFxClip(scene.fx ?? null)} title={tr('Copy effects (Ctrl+Alt+C)', '复制特效 (Ctrl+Alt+C)')}>
            {tr('Copy', '复制特效')}
          </button>
          <button className="mini" disabled={!p.fxClip} onClick={() => set('fx', p.fxClip ? { ...p.fxClip } : undefined)} title={tr('Paste effects (Ctrl+Alt+V)', '粘贴特效 (Ctrl+Alt+V)')}>
            {tr('Paste', '粘贴')}
          </button>
          <span className="grow" />
          <button className="mini" disabled={!scene.fx} onClick={() => set('fx', undefined)}>
            {tr('Clear all', '全部清除')}
          </button>
        </div>
        {SCENE_FX.filter((g) => !g.screen || v.kind === 'screen').map((g) => (
          <div className="fxg" key={g.id}>
            <h3>{nm(g)}</h3>
            {g.fields.map((f) => (
              <FieldControl key={f.path} def={f} value={getPath(scene, f.path)} onChange={(x) => set(f.path, x)} />
            ))}
          </div>
        ))}
      </div>
    );
  else if (tab === 'over')
    body = (
      <div className="sec">
        <div className="sec-acts">
          <select
            className="add-sel"
            value=""
            onChange={(ev) => {
              const def = OVERLAY_LIST.find((o) => o.id === ev.target.value);
              if (!def) return;
              const at = Math.max(0, Math.round(p.playheadIn(scene.id) * 10) / 10);
              set(`overlays.${scene.overlays?.length ?? 0}`, { kind: def.id, at, dur: getPrefs().overlaySec, ...def.init });
            }}
          >
            <option value="">{tr('+ Add at the playhead…', '+ 在播放头添加…')}</option>
            {OVERLAY_LIST.map((o) => (
              <option key={o.id} value={o.id}>
                {nm(o)}
                {o.rule ? tr(' (against house style)', '（规范不推荐）') : ''}
              </option>
            ))}
          </select>
        </div>
        {(scene.overlays ?? []).length ? (
          (scene.overlays ?? []).map((o, i) => <OverlayItem key={i} o={o} i={i} focus={p.focus?.tab === 'over' && p.focus.i === i} set={set} assets={p.assets} />)
        ) : (
          <p className="hint">{tr('No overlays yet. Labels, arrows, highlight boxes, lower thirds and animated text go here; the Overlays and Text sections of the library add them too.', '这一段还没有叠加元素。标签、箭头、高亮框、字幕条、动画文字都在这里加，也可以从左边素材库的「叠加」「文字」页点选。')}</p>
        )}
      </div>
    );
  else if (tab === 'sound')
    body = (
      <div className="sec" ref={soundRef}>
        <div className="sec-acts">
          <select
            className="add-sel"
            value=""
            onChange={(ev) => {
              if (!ev.target.value) return;
              const at = Math.round(p.playheadIn(scene.id) * 100) / 100;
              set(`sounds.${scene.sounds?.length ?? 0}`, { id: ev.target.value, at });
            }}
          >
            <option value="">{tr('+ Add at the playhead…', '+ 在播放头添加…')}</option>
            {SOUND_CATS.map((c) => (
              <optgroup key={c.id} label={nm(c)}>
                {SOUNDS.filter((s) => s.cat === c.id).map((s) => (
                  <option key={s.id} value={s.id}>
                    {nm(s)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {(scene.sounds ?? []).length ? (
          (scene.sounds ?? []).map((c, i) => <SoundItem key={i} c={c} i={i} max={e ? e.dur / fps : 10} past={!!e?.sounds[i]?.past} marks={marks} focus={p.focus?.tab === 'sound' && p.focus.i === i} set={set} del={() => p.commit((d) => removeSound(d, scene.id, i))} />)
        ) : (
          <p className="hint">{tr('No sound effects in this scene. Drag one from Sound FX in the library onto the timeline, or add it here at the playhead.', '这一段还没有音效。从左边素材库的「音效」页拖到时间线上，或者在这里加在播放头位置。')}</p>
        )}
      </div>
    );
  else
    body = (
      <div className="sec" ref={listRef}>
            {scene.lines.map((l, k) => (
              <div key={k} data-k={k} data-pick={`line|${k}|${l.zh.slice(0, 60)}`} className={`item${p.focusLine === k ? ' focus' : ''}`}>
                <div className="head">
                  <span className="idx">{k + 1}</span>
                  {e?.lines[k]?.stale ? <span className="chip">{tr('Text changed; voice needs redoing', '文字改过，配音待重做')}</span> : null}
                  <span className="grow" />
                  <button className="icon sm" title={tr('Delete this line', '删除这一句')} onClick={() => set(`lines.${k}`, undefined)}>
                    <Icon name="close" size={14} />
                  </button>
                </div>
                <Field multiline value={l.zh} placeholder={tr('Main line  {+faster} {-slower} [[highlight]]', '主字幕　{+加快} {-放慢} [[重点]]')} onCommit={(s) => set(`lines.${k}.zh`, s)} autoFocus={p.focusLine === k} />
                <Field value={l.en} placeholder={tr('Second-language line (optional)', '第二语言（可空）')} onCommit={(s) => set(`lines.${k}.en`, s || undefined)} />
                <Field value={l.at} placeholder={tr('Align to @mark (optional)', '对齐到 @标记（可空）')} list="marks" validate={refOk(marks)} onCommit={(s) => set(`lines.${k}.at`, asRef(s))} />
                <LineVoice slug={p.slug} lang={p.lang} line={`${scene.id}:${k}`} file={e?.lines[k]?.voiced ? e.lines[k].file : undefined} dur={e?.lines[k]?.voiced ? (e.lines[k].dur / fps) : undefined} empty={!(p.lang === 'en' ? l.en : l.zh)?.trim()} />
              </div>
            ))}
            <div className="sec-acts">
              <button className="add" onClick={() => set(`lines.${scene.lines.length}`, { zh: '' })}>
                <Icon name="plus" size={14} />
                {tr('Add a line', '加一句')}
              </button>
              <span className="grow" />
              {scene.lines.some((l) => (p.lang === 'en' ? l.en : l.zh)?.trim()) ? <VoiceScene slug={p.slug} lang={p.lang} scene={scene.id} all={!!e?.lines.length && e.lines.every((x) => x.voiced)} /> : null}
            </div>
      </div>
    );

  return (
    <div className="insp">
      <div className="ihead">
        <div className="ihead-row">
          <span className="kdot" style={{ background: kindColor(v.kind) }} />
          <h2>{scene.id}</h2>
          <span className="kind">{kindName(v.kind)}</span>
          <span className="grow" />
          <button className="icon sm" onClick={p.actions.up} title={tr('Move earlier', '前移一段')}>
            <Icon name="up" size={14} />
          </button>
          <button className="icon sm" onClick={p.actions.down} title={tr('Move later', '后移一段')}>
            <Icon name="down" size={14} />
          </button>
          <button className="icon sm" onClick={p.actions.split} disabled={!e} title={tr('Split at the playhead (Ctrl+B)', '在播放头处拆分 (Ctrl+B)')}>
            <Icon name="split" size={14} />
          </button>
          <button className="icon sm" onClick={p.actions.dup} title={tr('Duplicate (Ctrl+D)', '复制这一段 (Ctrl+D)')}>
            <Icon name="copy" size={14} />
          </button>
          <button className="icon sm danger" onClick={p.actions.del} title={tr('Delete scene (Delete)', '删除这一段 (Delete)')}>
            <Icon name="trash" size={14} />
          </button>
        </div>
        <div className="meta">{e ? tr(`Starts at ${fmtTime(e.start, fps)}, ${(e.dur / fps).toFixed(2)} s`, `从 ${fmtTime(e.start, fps)} 开始，${(e.dur / fps).toFixed(2)} 秒`) : tr(`Not in this version: ${hidden?.why ?? 'unused'}`, `这一版没用到：${hidden?.why ?? '未用'}`)}</div>
      </div>
      <Tabs<STab>
        value={tab}
        onChange={setTab}
        items={[
          ['visual', tr('Picture', '画面')],
          ['trans', tr('Transition', '转场')],
          ['fx', tr('Effects', '特效'), fxCount],
          ['over', tr('Overlays', '叠加'), scene.overlays?.length],
          ['sound', tr('Sound', '音效'), scene.sounds?.length],
          ['lines', tr('Narration', '旁白'), lineCount],
        ]}
      />
      <div className="ibody" ref={bodyRef}>
        {body}
      </div>
      <datalist id="marks">
        {marks.map((m) => (
          <option key={m} value={`@${m}`} />
        ))}
      </datalist>
    </div>
  );
}

let sxPlay: HTMLAudioElement | null = null;

function SoundItem({ c, i, max, past, marks, focus, set, del }: { c: SoundCue; i: number; max: number; past: boolean; marks: string[]; focus: boolean; set: (path: string, value: unknown) => void; del: () => void }) {
  const def = soundDef(c.id);
  const f = (name: string) => `sounds.${i}.${name}`;
  return (
    <div className={`item sound${focus ? ' focus' : ''}`} data-k={i} data-pick={`sound|${i}|${def ? nm(def) : c.id}`}>
      <div className="head">
        <span className="idx">{i + 1}</span>
        <button
          className="icon sm"
          title={tr('Listen', '试听')}
          onClick={() => {
            sxPlay?.pause();
            sxPlay = new Audio(`/${soundSrc(c.id)}`);
            sxPlay.volume = Math.min(1, 0.7 * (c.vol ?? 1));
            void sxPlay.play();
          }}
        >
          <Icon name="play" size={12} />
        </button>
        <select value={c.id} onChange={(ev) => set(f('id'), ev.target.value)} style={{ flex: 1, minWidth: 0 }}>
          {!def ? <option value={c.id}>{c.id}</option> : null}
          {SOUND_CATS.map((g) => (
            <optgroup key={g.id} label={nm(g)}>
              {SOUNDS.filter((s) => s.cat === g.id).map((s) => (
                <option key={s.id} value={s.id}>
                  {nm(s)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button className="icon sm" title={tr('Delete this sound', '删除这个音效')} onClick={del}>
          <Icon name="close" size={14} />
        </button>
      </div>
      {past ? <span className="chip">{tr('Starts after this scene ends, so it is silent', '开始时间超出了这一段，不会响')}</span> : null}
      {typeof c.at === 'string' ? (
        <Row label={tr('Starts at', '开始于')}>
          <Field value={c.at} placeholder="@mark" list="marks" validate={refOk(marks)} onCommit={(s) => set(f('at'), asRef(s) ?? 0)} />
        </Row>
      ) : (
        <FieldControl def={{ path: f('at'), en: 'Starts at (s)', zh: '开始（秒）', type: 'range', min: 0, max: Math.max(0.1, Math.round(max * 100) / 100), step: 0.01, def: 0 }} value={c.at} onChange={(v) => set(f('at'), v ?? 0)} />
      )}
      <FieldControl def={{ path: f('vol'), en: 'Volume', zh: '音量', type: 'range', min: 0, max: 2, step: 0.05, def: 1 }} value={c.vol} onChange={(v) => set(f('vol'), v)} />
    </div>
  );
}

const XY: Record<string, [string, string]> = { x: ['x', '横 x'], y: ['y', '纵 y'], w: ['w', '宽 w'], h: ['h', '高 h'] };

const ENTER: [string, string, string][] = [['pop', 'Pop', '弹出'], ['rise', 'Rise', '上浮'], ['slide', 'Slide in', '侧滑'], ['spin', 'Spin in', '旋入'], ['fade', 'Fade', '淡入']];

function OverlayItem({ o, i, focus, set, assets }: { o: Overlay; i: number; focus: boolean; set: (path: string, value: unknown) => void; assets: string[] }) {
  const def = OVERLAY_LIST.find((x) => x.id === o.kind);
  const f = (name: string) => `overlays.${i}.${name}`;
  const fields = def?.fields ?? ['text', 'sub', 'x', 'y'];
  return (
    <div className={`item ov${focus ? ' focus' : ''}`} data-k={i} data-pick={`overlay|${i}|${def ? nm(def) : o.kind}${o.text ? ` "${o.text.slice(0, 30)}"` : ''}`}>
      <div className="head">
        <span className="idx">{i + 1}</span>
        <span className="ovk">
          {def ? nm(def) : o.kind}
          {def?.rule ? (
            <span className="rule" title={nm(RULES[def.rule])}>
              !
            </span>
          ) : null}
        </span>
        <span className="grow" />
        <button className="icon sm" title={tr('Delete', '删除')} onClick={() => set(`overlays.${i}`, undefined)}>
          <Icon name="close" size={14} />
        </button>
      </div>
      {fields.includes('src') ? (
        <div className="row">
          <label>{tr('Image', '图片')}</label>
          <select value={o.src ?? ''} onChange={(e) => set(f('src'), e.target.value || undefined)}>
            <option value="">{tr('Choose an image', '选择图片')}</option>
            {[...new Set([o.src ?? '', ...assets.filter(isImg)])].filter(Boolean).map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </div>
      ) : null}
      {fields.includes('enter') ? (
        <div className="row">
          <label>{tr('Entrance', '进场')}</label>
          <select value={o.enter ?? 'pop'} onChange={(e) => set(f('enter'), e.target.value === 'pop' ? undefined : e.target.value)}>
            {ENTER.map(([id, en, zh]) => (
              <option key={id} value={id}>
                {tr(en, zh)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      {fields.includes('text') ? <Field value={o.text} placeholder={tr('Text', '文字')} onCommit={(s) => set(f('text'), s)} /> : null}
      {fields.includes('sub') ? <Field value={o.sub} placeholder={tr('Second line (optional)', '副标题（可空）')} onCommit={(s) => set(f('sub'), s || undefined)} /> : null}
      {fields.includes('anim') ? (
        <div className="row">
          <label>{tr('Animation', '动画')}</label>
          <NamedSelect value={o.anim ?? 'fadeup'} list={TEXT_LIST} onChange={(x) => set(f('anim'), x)} />
        </div>
      ) : null}
      {fields.includes('style') ? (
        <div className="row">
          <label>{tr('Style', '样式')}</label>
          <NamedSelect value={o.style ?? ''} list={LOWER_LIST} onChange={(x) => set(f('style'), x || undefined)} />
        </div>
      ) : null}
      <div className="row4">
        <div>
          <label>{tr('Start s', '开始 秒')}</label>
          <Field value={o.at} validate={isNum} onCommit={(s) => set(f('at'), num(s) ?? 0)} />
        </div>
        <div>
          <label>{tr('Length s', '时长 秒')}</label>
          <Field value={o.dur} placeholder="1.6" validate={isNum} onCommit={(s) => set(f('dur'), num(s))} />
        </div>
        {(['x', 'y', 'w', 'h'] as const)
          .filter((k) => fields.includes(k))
          .map((k) => (
            <div key={k}>
              <label>{tr(XY[k][0], XY[k][1])}</label>
              <Field value={o[k]} placeholder="0–1" validate={isNum} onCommit={(s) => set(f(k), num(s))} />
            </div>
          ))}
        {fields.includes('size') ? (
          <div>
            <label>{tr('Size ×', '大小 ×')}</label>
            <Field value={o.size} placeholder="1" validate={isNum} onCommit={(s) => set(f('size'), num(s))} />
          </div>
        ) : null}
        {fields.includes('color') ? (
          <div>
            <label>{tr('Colour', '颜色')}</label>
            <input type="color" value={o.color ?? '#5b8cff'} onChange={(e) => set(f('color'), e.target.value)} />
          </div>
        ) : null}
        {fields.includes('plate') ? (
          <div>
            <label title={tr('A dark backing so the text reads on bright footage', '深色底板，让文字压在亮画面上也看得清')}>{tr('Backing', '底板')}</label>
            <input type="checkbox" checked={!!o.plate} onChange={(e) => set(f('plate'), e.target.checked || undefined)} />
          </div>
        ) : null}
        {fields.includes('rot') ? (
          <div>
            <label>{tr('Turn °', '旋转 °')}</label>
            <Field value={o.rot} placeholder="0" validate={isNum} onCommit={(s) => set(f('rot'), num(s))} />
          </div>
        ) : null}
        {fields.includes('float') ? (
          <div>
            <label title={tr('Bobs gently after it lands', '落定后轻轻浮动')}>{tr('Float', '浮动')}</label>
            <input type="checkbox" checked={!!o.float} onChange={(e) => set(f('float'), e.target.checked || undefined)} />
          </div>
        ) : null}
      </div>
      {def?.hint ? <div className="hint">{nm(def.hint)}</div> : null}
    </div>
  );
}

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

function VisualFields({ v, k, set, assets, marks, slug, setMin }: { v: Visual; k: string; set: (path: string, value: unknown) => void; assets: string[]; marks: string[]; slug: string; setMin: (sec: number) => void }) {
  const f = (name: string) => `${k}.${name}`;
  const pick = (list: string[], cur?: string) => [...new Set([cur ?? '', ...list])].filter(Boolean);
  const frameSel = (value: string | undefined, allowNone: boolean) => (
    <select value={value ?? (allowNone ? '' : 'window')} onChange={(e) => set(f('frame'), e.target.value === (allowNone ? '' : 'window') ? undefined : e.target.value)} style={{ width: '100%' }}>
      {allowNone ? <option value="">{tr('Full bleed', '铺满')}</option> : null}
      <option value="window">{tr('Window', '窗口')}</option>
      <option value="phone">{tr('Phone', '手机')}</option>
      <option value="bare">{tr('No frame', '无边框')}</option>
    </select>
  );
  const text = (label: string, name: string, value: string | undefined, opt = true, multiline = false) => (
    <Row label={label}>
      <Field multiline={multiline} value={value} onCommit={(s) => set(f(name), opt ? s || undefined : s)} />
    </Row>
  );
  const imageSel = (label: string, name: string, value: string) => (
    <Row label={label}>
      <select value={value} onChange={(e) => set(f(name), e.target.value)}>
        <option value="">{tr('Choose an image', '选择图片')}</option>
        {pick(assets.filter(isImg), value).map((a) => (
          <option key={a}>{a}</option>
        ))}
      </select>
    </Row>
  );
  switch (v.kind) {
    case 'screen':
      return (
        <>
          <Row label={tr('Recording', '录屏')}>
            <select value={v.src} onChange={(e) => set(f('src'), e.target.value)}>
              {pick(assets.filter((a) => a.startsWith('cap/') && isVid(a)), v.src).map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Row>
          <Row label={tr('In', '起点')}>
            <Field value={v.from} placeholder="0" list="marks" validate={refOk(marks)} onCommit={(s) => set(f('from'), asRef(s))} />
          </Row>
          <Row label={tr('Out', '终点')}>
            <Field value={v.to} placeholder={tr('end of recording', '录屏结尾')} list="marks" validate={refOk(marks)} onCommit={(s) => set(f('to'), asRef(s))} />
          </Row>
          <div className="row3">
            <div>
              <label>{tr('Speed', '速度')}</label>
              <Field value={v.rate} placeholder="1" validate={isNum} onCommit={(s) => set(f('rate'), num(s))} />
            </div>
            <div>
              <label>{tr('Base zoom', '基础缩放')}</label>
              <Field value={v.base} placeholder="1" validate={isNum} onCommit={(s) => set(f('base'), num(s))} />
            </div>
            <div>
              <label>{tr('Frame', '外框')}</label>
              {frameSel(v.frame, false)}
            </div>
          </div>
          <div className="row3">
            <div style={{ gridColumn: 'span 2' }}>
              <label>{tr('Zoom on clicks', '点击自动推近')}</label>
              <select value={v.zoom ?? 'auto'} onChange={(e) => set(f('zoom'), e.target.value === 'auto' ? undefined : e.target.value)} style={{ width: '100%' }}>
                <option value="auto">{tr('On (default)', '开（默认）')}</option>
                <option value="off">{tr('Off', '关')}</option>
              </select>
            </div>
          </div>
          <Row label={tr('URL', '网址')}>
            <Field value={v.url} placeholder={tr('(hidden)', '（不显示）')} onCommit={(s) => set(f('url'), s || undefined)} />
          </Row>
        </>
      );
    case 'image':
      return (
        <>
          {imageSel(tr('Image', '图片'), 'src', v.src)}
          <div className="row3">
            <div>
              <label>{tr('Fit', '填充')}</label>
              <select value={v.fit ?? 'cover'} onChange={(e) => set(f('fit'), e.target.value === 'cover' ? undefined : e.target.value)} style={{ width: '100%' }}>
                <option value="cover">{tr('Fill', '裁满')}</option>
                <option value="contain">{tr('Fit whole', '完整显示')}</option>
              </select>
            </div>
            <div>
              <label>{tr('Frame', '外框')}</label>
              {frameSel(v.frame, true)}
            </div>
          </div>
        </>
      );
    case 'html':
      return (
        <>
          <Row label={tr('Page', '页面')}>
            <select value={v.src} onChange={(e) => set(f('src'), e.target.value)}>
              {pick(assets.filter(isHtml), v.src).map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Row>
          <div className="row3">
            <div>
              <label>{tr('From s', '从第几秒')}</label>
              <Field value={v.from} placeholder="0" validate={isNum} onCommit={(s) => set(f('from'), num(s))} />
            </div>
            <div>
              <label>{tr('Fit', '填充')}</label>
              <select value={v.fit ?? 'contain'} onChange={(e) => set(f('fit'), e.target.value === 'contain' ? undefined : e.target.value)} style={{ width: '100%' }}>
                <option value="contain">{tr('Fit whole', '完整显示')}</option>
                <option value="cover">{tr('Fill', '裁满')}</option>
              </select>
            </div>
            <div>
              <label>{tr('Frame', '外框')}</label>
              {frameSel(v.frame, true)}
            </div>
          </div>
          <HtmlVars slug={slug} v={v} onSet={(id, value) => set(f(`vars.${id}`), value)} onLength={setMin} />
        </>
      );
    case 'clip':
      return (
        <>
          <Row label={tr('Video', '视频')}>
            <select value={v.src} onChange={(e) => set(f('src'), e.target.value)}>
              {pick(assets.filter(isVid), v.src).map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Row>
          <div className="row3">
            <div>
              <label>{tr('From s', '从第几秒')}</label>
              <Field value={v.from} placeholder="0" validate={isNum} onCommit={(s) => set(f('from'), num(s))} />
            </div>
            <div>
              <label>{tr('Speed', '速度')}</label>
              <Field value={v.rate} placeholder="1" validate={isNum} onCommit={(s) => set(f('rate'), num(s))} />
            </div>
            <div>
              <label>{tr('Frame', '外框')}</label>
              {frameSel(v.frame, true)}
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={v.muted === false} onChange={(e) => set(f('muted'), e.target.checked ? false : undefined)} />
            {tr("Keep the video's own sound", '保留视频原声')}
          </label>
        </>
      );
    case 'title':
      return (
        <>
          {text(tr('Kicker', '小标题'), 'kicker', v.kicker)}
          {text(tr('Title', '标题'), 'title', v.title, false)}
          {text(tr('Subtitle', '副标题'), 'sub', v.sub)}
          <Row label={tr('Animation', '动画')}>
            <NamedSelect value={v.anim ?? ''} list={[{ id: '', en: 'Classic rise', zh: '经典上浮' }, ...TEXT_LIST]} onChange={(x) => set(f('anim'), x || undefined)} />
          </Row>
        </>
      );
    case 'stats':
      return <StatsFields v={v} k={k} set={set} />;
    case 'outro':
      return (
        <>
          {text(tr('Title', '标题'), 'title', v.title, false)}
          {text(tr('URL', '网址'), 'url', v.url)}
          <Row label={tr('Small print', '小字')}>
            <Field multiline value={(v.lines ?? []).join('\n')} onCommit={(s) => set(f('lines'), s.trim() ? lines(s) : undefined)} />
          </Row>
        </>
      );
    case 'counter':
      return (
        <>
          {text(tr('Number', '数字'), 'value', v.value, false)}
          {text(tr('Label', '说明'), 'label', v.label)}
          {text(tr('Small print', '小字'), 'sub', v.sub)}
        </>
      );
    case 'quote':
      return (
        <>
          {text(tr('Quote', '引言'), 'text', v.text, false, true)}
          {text(tr('Author', '作者'), 'author', v.author)}
          {text(tr('Role', '身份'), 'role', v.role)}
          <Row label={tr('Stars', '星级')}>
            <Field value={v.rating} placeholder="0–5" validate={isNum} onCommit={(s) => set(f('rating'), num(s))} />
          </Row>
        </>
      );
    case 'checklist':
    case 'flap':
      return (
        <>
          {text(tr('Title', '标题'), 'title', v.title)}
          <Row label={v.kind === 'flap' ? tr('Rows', '行') : tr('Items', '条目')}>
            <Field multiline rows={4} value={(v.kind === 'flap' ? v.rows : v.items).join('\n')} onCommit={(s) => set(f(v.kind === 'flap' ? 'rows' : 'items'), lines(s))} />
          </Row>
          <p className="hint">{tr('One per line', '每行一条')}</p>
        </>
      );
    case 'chart':
      return (
        <>
          {text(tr('Title', '标题'), 'title', v.title)}
          {text(tr('Unit', '单位'), 'unit', v.unit)}
          <Row label={tr('Bars', '柱子')}>
            <Field
              multiline
              rows={4}
              value={v.items.map((i) => `${i.label}: ${i.value}`).join('\n')}
              validate={(s) => lines(s).every((l) => /:\s*-?[\d.]+$/.test(l))}
              onCommit={(s) => set(f('items'), lines(s).map((l) => ({ label: l.replace(/:\s*-?[\d.]+$/, '').trim(), value: Number(l.split(':').pop()) })))}
            />
          </Row>
          <p className="hint">{tr('One bar per line: label: value', '每行一根柱子：名称: 数值')}</p>
        </>
      );
    case 'code':
      return (
        <>
          {text(tr('File name', '文件名'), 'title', v.title)}
          <Row label={tr('Code', '代码')}>
            <Field multiline rows={8} value={v.code} onCommit={(s) => set(f('code'), s)} />
          </Row>
        </>
      );
    case 'compare':
      return (
        <>
          {imageSel(tr('Before', '之前'), 'a', v.a)}
          {imageSel(tr('After', '之后'), 'b', v.b)}
          {text(tr('Before label', '之前标签'), 'labelA', v.labelA)}
          {text(tr('After label', '之后标签'), 'labelB', v.labelB)}
        </>
      );
    default:
      return <JsonEdit value={v} onApply={(x) => set(k, x)} />;
  }
}

function StatsFields({ v, k, set }: { v: StatsVisual; k: string; set: (path: string, value: unknown) => void }) {
  return (
    <>
      <Row label={tr('Title', '标题')}>
        <Field value={v.title} placeholder={tr('(none)', '（无）')} onCommit={(s) => set(`${k}.title`, s || undefined)} />
      </Row>
      {v.items.map((it, i) => (
        <div className="row3" key={i}>
          <Field value={it.value} placeholder={tr('Number', '数字')} onCommit={(s) => set(`${k}.items.${i}.value`, s)} />
          <Field value={it.label} placeholder={tr('Label', '说明')} onCommit={(s) => set(`${k}.items.${i}.label`, s)} />
          <div style={{ display: 'flex', gap: 4 }}>
            <Field value={it.en} placeholder="English" onCommit={(s) => set(`${k}.items.${i}.en`, s || undefined)} />
            <button className="icon sm" title={tr('Delete', '删除')} onClick={() => set(`${k}.items.${i}`, undefined)}>
              <Icon name="close" size={14} />
            </button>
          </div>
        </div>
      ))}
      <button className="add" onClick={() => set(`${k}.items.${v.items.length}`, { value: '0', label: '' })}>
        <Icon name="plus" size={14} />
        {tr('Add an item', '加一项')}
      </button>
    </>
  );
}

const fieldsOf = (paths: string[]) => allFields(BOARD_FX).filter((f) => paths.includes(f.path));

function BoardPanel(p: Props) {
  const { hints } = usePrefs();
  const b = p.doc.board;
  const [tab, setTab] = useTab<BTab>('vs-btab', ['basic', 'audio', 'caps', 'look'], 'basic');
  const set = (path: string, value: unknown) => p.commit((d) => setPath(d, null, path, value), { coalesce: `board.${path}` });
  const audio = [...p.music.map((m) => m.src), ...p.assets.filter((a) => /\.(mp3|wav|m4a)$/i.test(a)).map((a) => `${p.slug}/${a}`)];
  const controls = (paths: string[]) =>
    fieldsOf(paths)
      .filter((f: FieldDef) => !f.path.startsWith('music.') || !!b.music)
      .map((f: FieldDef) => <FieldControl key={f.path} def={f} value={getPath(b, f.path)} onChange={(x) => set(f.path, x)} />);

  let body: React.ReactNode;
  if (tab === 'basic')
    body = (
      <>
        <div className="sec">
          <Row label={tr('Title', '标题')}>
            <Field value={b.title} onCommit={(s) => set('title', s)} />
          </Row>
          <Row label={tr('Size', '画幅')}>
            <select value={b.format ?? p.format} onChange={(e) => set('format', e.target.value)}>
              <option value="wide">{tr('16:9 widescreen (YouTube, Bilibili)', '16:9 横屏（B站、YouTube）')}</option>
              <option value="tall">{tr('9:16 vertical (TikTok, Douyin, Xiaohongshu)', '9:16 竖屏（抖音、小红书）')}</option>
            </select>
          </Row>
          <Row label={tr('9:16 header', '竖屏顶栏')}>
            <Field value={b.header} placeholder={tr('Line at the top of 9:16', '竖屏顶部的一行字')} onCommit={(s) => set('header', s || undefined)} />
          </Row>
          <Row label={tr('Header (2nd)', '顶栏英文')}>
            <Field value={b.headerEn} onCommit={(s) => set('headerEn', s || undefined)} />
          </Row>
        </div>
        <div className="sec">
          <h3>{tr('Colour and background', '颜色和背景')}</h3>
          <div className="swatches">
            <label>
              <input type="color" value={b.theme.accent} onChange={(e) => set('theme.accent', e.target.value)} />
              {tr('Accent', '主色')}
            </label>
            <label>
              <input type="color" value={b.theme.bg?.[0] ?? '#0b1020'} onChange={(e) => set('theme.bg', [e.target.value, b.theme.bg?.[1] ?? '#18223d'])} />
              {tr('Background 1', '背景 1')}
            </label>
            <label>
              <input type="color" value={b.theme.bg?.[1] ?? '#18223d'} onChange={(e) => set('theme.bg', [b.theme.bg?.[0] ?? '#0b1020', e.target.value])} />
              {tr('Background 2', '背景 2')}
            </label>
          </div>
          <Row label={tr('Wallpaper', '背景图')}>
            <select value={b.theme.wallpaper ?? ''} onChange={(e) => set('theme.wallpaper', e.target.value || undefined)}>
              <option value="">{tr('Gradient (default)', '渐变（默认）')}</option>
              {p.assets.filter(isImg).map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Row>
          {controls(['theme.bgFx', ...(b.theme.wallpaper ? ['theme.wallBlur'] : [])])}
        </div>
        {p.etl?.hidden.length ? (
          <div className="sec">
            <h3>{tr('Scenes not in this version', '这一版没用到的段落')}</h3>
            <div className="hidden-list">
              {p.etl.hidden.map((h) => (
                <button key={h.id} className="mini" onClick={() => p.onSelect(h.id)} title={h.why}>
                  {h.id}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </>
    );
  else if (tab === 'audio')
    body = (
      <>
        <div className="sec">
            <h3>{tr('Music', '配乐')}</h3>
            <Row label={tr('Track', '音乐')}>
              <select value={b.music?.src ?? ''} onChange={(e) => set('music', e.target.value ? { ...(b.music ?? {}), src: e.target.value } : undefined)}>
                <option value="">{tr('None', '无')}</option>
                {[...new Set([b.music?.src ?? '', ...audio])].filter(Boolean).map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </Row>
            <div className="row3">
              <div>
                <label>{tr('Volume', '音量')}</label>
                <Field value={b.music?.volume} placeholder="0.22" validate={isNum} onCommit={(s) => set('music.volume', num(s))} />
              </div>
              <div>
                <label>{tr('Under voice', '说话时压到')}</label>
                <Field value={b.music?.duck} placeholder="0.3" validate={isNum} onCommit={(s) => set('music.duck', num(s))} />
              </div>
            </div>
            {controls(['music.fadeIn', 'music.fadeOut'])}
          </div>
        <div className="sec">
          <h3>{tr('Sound effects', '音效')}</h3>
          {controls(['sfx.whoosh', 'sfx.click', 'sfx.pop', 'sfx.volume'])}
        </div>
      </>
    );
  else if (tab === 'caps') body = <div className="sec">{controls(['captions.off', 'captions.style', 'captions.pos', 'captions.scale', 'captions.anim', 'chapterBar'])}</div>;
  else
    body = (
      <div className="sec">
        <h3>{tr('Recording frame', '录屏画框')}</h3>
        {controls(['frame.radius', 'frame.shadow', 'frame.inset', 'frame.glow'])}
        <h3 className="gap">{tr('Cards', '卡片')}</h3>
        {controls(['glass'])}
      </div>
    );

  return (
    <div className="insp">
      <div className="ihead">
        <div className="ihead-row">
          <span className="kdot board" />
          <h2>{tr('Project settings', '项目设置')}</h2>
        </div>
        {hints ? <div className="meta">{tr('These apply to the whole video. Click a scene on the timeline to edit it.', '影响整条片子。点时间线上的段落，改那一段。')}</div> : null}
      </div>
      <Tabs<BTab>
        value={tab}
        onChange={setTab}
        items={[
          ['basic', tr('General', '基本')],
          ['audio', tr('Sound', '声音')],
          ['caps', tr('Captions', '字幕')],
          ['look', tr('Frame', '画框')],
        ]}
      />
      <div className="ibody">{body}</div>
    </div>
  );
}

// One narration line's audio: play it, or say there is none yet
function LineVoice({ slug, lang, line, file, dur, empty }: { slug: string; lang: 'zh' | 'en'; line: string; file?: string; dur?: number; empty: boolean }) {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const a = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => a.current?.pause(), [file]);
  useEffect(() => setBusy(false), [file]);
  useEffect(() => {
    if (!busy) return;
    const es = new EventSource('/api/events');
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      if (ev.type === 'voice' && ev.job.state !== 'running') setBusy(false);
    };
    return () => es.close();
  }, [busy]);
  // A new take of just this line (sampled voices come out differently each time)
  const retake = async () => {
    const r = await fetch('/api/voice/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, lang, lines: [line], redo: true }) });
    if (r.ok) setBusy(true);
  };
  if (empty) return null;
  if (!file)
    return (
      <div className="ln-vo">
        <Icon name="mic" size={12} />
        {tr('No voice-over yet', '还没有配音')}
      </div>
    );
  const toggle = () => {
    if (on) {
      a.current?.pause();
      return setOn(false);
    }
    a.current = new Audio(`/${slug}/${file}`);
    a.current.onended = () => setOn(false);
    void a.current.play();
    setOn(true);
  };
  return (
    <div className="ln-vo ok">
      <button className="icon sm" onClick={toggle} title={on ? tr('Stop', '停止') : tr('Play the voice-over', '播放配音')}>
        <Icon name={on ? 'pause' : 'play'} size={12} />
      </button>
      {tr(`Voiced · ${dur?.toFixed(1)} s`, `已配音 · ${dur?.toFixed(1)} 秒`)}
      <span className="grow" />
      <button className="mini" disabled={busy} onClick={() => void retake()} title={tr('Voice this line again with the current voice', '用当前音色重新念这一句')}>
        <Icon name={busy ? 'wait' : 'redo'} size={12} />
        {busy ? tr('Voicing…', '配音中…') : tr('New take', '重念这句')}
      </button>
    </div>
  );
}

// Voice (or re-voice) every line of one scene with the voice chosen in the library
function VoiceScene({ slug, lang, scene, all }: { slug: string; lang: 'zh' | 'en'; scene: string; all: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!busy) return;
    const es = new EventSource('/api/events');
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.type === 'voice' && e.job.state !== 'running') {
        setBusy(false);
        if (e.job.state === 'error') setErr(e.job.error ?? '');
        else if (e.job.result?.failed.length) setErr(e.job.result.failed[0].error);
      }
    };
    return () => es.close();
  }, [busy]);
  const go = async () => {
    setErr('');
    const r = await fetch('/api/voice/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, lang, scenes: [scene], redo: all }) });
    if (!r.ok) return setErr((await r.json()).error);
    setBusy(true);
  };
  return (
    <>
      {err ? <span className="vo-err" title={err}>{err.length > 60 ? `${err.slice(0, 60)}…` : err}</span> : null}
      <button className="mini" disabled={busy} onClick={() => void go()} title={tr('Uses the engine and voice chosen under Voiceover in the library', '用素材库「配音」里选的引擎和音色')}>
        <Icon name={busy ? 'wait' : 'mic'} size={12} />
        {busy ? tr('Voicing…', '配音中…') : all ? tr('Re-voice scene', '重配这一段') : tr('Voice this scene', '给这一段配音')}
      </button>
    </>
  );
}
