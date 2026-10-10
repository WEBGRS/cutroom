import React, { useEffect, useRef, useState } from 'react';
import type { Format, Fx, Overlay, Scene, StatsVisual, Visual } from '../../src/lib/types';
import { fmtTime, visualKey, type ETimeline } from './model';
import { getPath, replaceScene, setPath, toggleTall, type Caps, type Doc, type Op } from './ops';
import { BOARD_FX, DIRS, OVERLAYS, SCENE_FX, TRANSITIONS } from './catalog';
import { Field, FieldControl, JsonEdit, Row, asRef, isNum, num, refOk } from './Fields';
import { Icon } from './icons';

const KIND_NAME: Record<string, string> = { screen: '录屏', title: '标题卡', stats: '数字卡', outro: '片尾', flow: '流程图', clip: '视频', scroll: '长图', image: '图片' };

type Commit = (fn: (d: Doc) => Op, opts?: { coalesce?: string; timings?: boolean }) => void;

interface Props {
  doc: Doc;
  slug: string;
  format: Format;
  mode: 'voice' | 'beat';
  etl: ETimeline | null;
  caps: Caps;
  assets: string[];
  music: { src: string; beats: boolean }[];
  sel: string | null;
  focusLine: number | null;
  commit: Commit;
  onSelect: (id: string | null) => void;
  actions: { split: () => void; dup: () => void; del: () => void; up: () => void; down: () => void };
  fxClip: Fx | null;
  setFxClip: (fx: Fx | null) => void;
  playheadIn: (id: string) => number;
}

const isImg = (a: string) => /\.(png|jpe?g|webp|gif)$/i.test(a);
const isVid = (a: string) => /\.(mp4|webm|mov)$/i.test(a);

type STab = 'visual' | 'trans' | 'fx' | 'over' | 'lines';
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

export const KIND_COLOR: Record<string, string> = { screen: '#4f8ef7', clip: '#3fb68b', image: '#e0a440', title: '#a78bfa', stats: '#a78bfa', flow: '#a78bfa', outro: '#a78bfa', scroll: '#4f8ef7' };

export function Inspector(p: Props) {
  const { doc, sel } = p;
  const scene = sel ? doc.board.scenes.find((s) => s.id === sel) : undefined;
  const listRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useTab<STab>('vs-itab', ['visual', 'trans', 'fx', 'over', 'lines'], 'visual');

  useEffect(() => {
    if (p.focusLine === null) return;
    if (tab !== 'lines') setTab('lines');
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-k="${p.focusLine}"]`)?.scrollIntoView({ block: 'nearest' }));
  }, [p.focusLine, sel]);

  if (!scene) return <BoardPanel {...p} />;

  const set = (path: string, value: unknown) => p.commit((d) => setPath(d, scene.id, path, value), { coalesce: `${scene.id}.${path}` });
  const key = visualKey(scene, p.format);
  const v = scene[key] as Visual;
  const e = p.etl?.scenes.find((x) => x.id === scene.id);
  const hidden = p.etl?.hidden.find((h) => h.id === scene.id);
  const marks = v.kind === 'screen' ? (p.caps[v.src]?.events ?? []).filter((x) => x.type === 'mark' && x.name).map((x) => x.name!) : [];
  const fps = p.etl?.fps ?? 60;
  const tr = TRANSITIONS.find(([t]) => t === (scene.transition === 'fade' ? '' : (scene.transition ?? '')));
  const fxCount = scene.fx ? Object.keys(scene.fx).length : 0;
  const lineCount = p.mode === 'voice' ? scene.lines.length : (scene.beat?.length ?? 0);

  let body: React.ReactNode;
  if (tab === 'visual')
    body = (
      <>
        <div className="sec">
          {p.format === 'tall' ? (
            <label className="check">
              <input type="checkbox" checked={!!scene.tall} onChange={(ev) => p.commit((d) => toggleTall(d, scene.id, ev.target.checked))} />
              竖屏用单独画面
            </label>
          ) : null}
          <VisualFields v={v} k={key} set={set} assets={p.assets} marks={marks} />
        </div>
        <div className="sec">
          <h3>位置</h3>
          <Row label="出现在">
            <select value={scene.only ?? ''} onChange={(ev) => set('only', ev.target.value || undefined)}>
              <option value="">横屏和竖屏</option>
              <option value="wide">只在横屏</option>
              <option value="tall">只在竖屏</option>
            </select>
          </Row>
          <Row label="章节名">
            <Field value={scene.chapter} placeholder="不是章节开头就留空" onCommit={(s) => set('chapter', s || undefined)} />
          </Row>
        </div>
        {p.mode === 'voice' ? (
          <div className="sec">
            <h3>时长</h3>
            <div className="row3">
              <div>
                <label>前留白 秒</label>
                <Field value={scene.lead} placeholder="0.45" validate={isNum} onCommit={(s) => set('lead', num(s))} />
              </div>
              <div>
                <label>后留白 秒</label>
                <Field value={scene.tail} placeholder="0.5" validate={isNum} onCommit={(s) => set('tail', num(s))} />
              </div>
              <div>
                <label>最短 秒</label>
                <Field value={scene.minSec} placeholder="不限" validate={isNum} onCommit={(s) => set('minSec', num(s))} />
              </div>
            </div>
          </div>
        ) : null}
        <div className="sec">
          <details>
            <summary>整段 JSON</summary>
            <JsonEdit value={scene} onApply={(x) => p.commit((d) => replaceScene(d, scene.id, x as Scene))} />
          </details>
        </div>
      </>
    );
  else if (tab === 'trans')
    body =
      p.mode === 'voice' ? (
        <div className="sec">
          <h3>进入这一段的方式{tr?.[2] ? <span className="rule" title={tr[2]}>!</span> : null}</h3>
          <div className="row3">
            <div style={{ gridColumn: 'span 2' }}>
              <label>转场</label>
              <select value={scene.transition === 'fade' ? '' : (scene.transition ?? '')} onChange={(ev) => set('transition', ev.target.value || undefined)}>
                {TRANSITIONS.map(([t, l]) => (
                  <option key={t} value={t}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>时长 秒</label>
              <Field value={scene.transDur} placeholder="0.4" validate={isNum} onCommit={(s) => set('transDur', num(s))} />
            </div>
          </div>
          {['slide', 'wipe', 'flip'].includes(scene.transition ?? '') ? (
            <Row label="方向">
              <select value={scene.transDir ?? ''} onChange={(ev) => set('transDir', ev.target.value || undefined)}>
                {DIRS.map(([d, l]) => (
                  <option key={d} value={d}>
                    {l}
                  </option>
                ))}
              </select>
            </Row>
          ) : null}
        </div>
      ) : (
        <div className="sec">
          <h3>卡点版切入方式</h3>
          <Row label="切入">
            <select value={scene.beatTransition ?? ''} onChange={(ev) => set('beatTransition', ev.target.value || undefined)}>
              {TRANSITIONS.filter(([t]) => t !== 'none').map(([t, l]) => (
                <option key={t} value={t}>
                  {t ? l : '交叉淡化（默认）'}
                </option>
              ))}
            </select>
          </Row>
        </div>
      );
  else if (tab === 'fx')
    body = (
      <div className="sec">
        <div className="sec-acts">
          <button className="mini" disabled={!scene.fx} onClick={() => p.setFxClip(scene.fx ?? null)} title="复制特效 (Ctrl+Alt+C)">
            复制特效
          </button>
          <button className="mini" disabled={!p.fxClip} onClick={() => set('fx', p.fxClip ? { ...p.fxClip } : undefined)} title="粘贴特效 (Ctrl+Alt+V)">
            粘贴
          </button>
          <span className="grow" />
          <button className="mini" disabled={!scene.fx} onClick={() => set('fx', undefined)}>
            全部清除
          </button>
        </div>
        {SCENE_FX.filter((g) => g.group !== '录屏' || v.kind === 'screen').map((g) => (
          <div className="fxg" key={g.group}>
            <h3>{g.group}</h3>
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
              const def = OVERLAYS.find((o) => o.kind === ev.target.value);
              if (!def) return;
              const at = Math.max(0, Math.round(p.playheadIn(scene.id) * 10) / 10);
              set(`overlays.${scene.overlays?.length ?? 0}`, { kind: def.kind, at, dur: 1.6, ...def.init });
            }}
          >
            <option value="">+ 在播放头添加…</option>
            {OVERLAYS.map((o) => (
              <option key={o.kind} value={o.kind}>
                {o.label}
                {o.rule ? '（规范不推荐）' : ''}
              </option>
            ))}
          </select>
        </div>
        {(scene.overlays ?? []).length ? (
          (scene.overlays ?? []).map((o, i) => <OverlayItem key={i} o={o} i={i} set={set} />)
        ) : (
          <p className="hint">这一段还没有叠加元素。标签、箭头、高亮框、马赛克都在这里加，也可以从左边「叠加」页点选。</p>
        )}
      </div>
    );
  else
    body = (
      <div className="sec" ref={listRef}>
        {p.mode === 'voice' ? (
          <>
            {scene.lines.map((l, k) => (
              <div key={k} data-k={k} className={`item${p.focusLine === k ? ' focus' : ''}`}>
                <div className="head">
                  <span className="idx">{k + 1}</span>
                  {e?.lines[k]?.stale ? <span className="chip">文字改过，配音待重做</span> : null}
                  <span className="grow" />
                  <button className="icon sm" title="删除这一句" onClick={() => set(`lines.${k}`, undefined)}>
                    <Icon name="close" size={14} />
                  </button>
                </div>
                <Field multiline value={l.zh} placeholder="中文　{+加快} {-放慢} [[重点]]" onCommit={(s) => set(`lines.${k}.zh`, s)} autoFocus={p.focusLine === k} />
                <Field value={l.en} placeholder="English" onCommit={(s) => set(`lines.${k}.en`, s || undefined)} />
                <Field value={l.at} placeholder="对齐到 @标记（可空）" list="marks" validate={refOk(marks)} onCommit={(s) => set(`lines.${k}.at`, asRef(s))} />
              </div>
            ))}
            <button className="add" onClick={() => set(`lines.${scene.lines.length}`, { zh: '' })}>
              <Icon name="plus" size={14} />
              加一句
            </button>
          </>
        ) : !scene.beat ? (
          <>
            <p className="hint">这一段不在卡点版里。</p>
            <button className="mini" onClick={() => set('beat', [{ t: '', n: 4 }])}>
              加入卡点版
            </button>
          </>
        ) : (
          <>
            {scene.beat.map((b, k) => (
              <div key={k} data-k={k} className={`item${p.focusLine === k ? ' focus' : ''}`}>
                <div className="head">
                  <span className="idx">{k + 1}</span>
                  <span className="grow" />
                  <button className="icon sm" title="删除这一句" onClick={() => set(`beat.${k}`, undefined)}>
                    <Icon name="close" size={14} />
                  </button>
                </div>
                <Field value={b.t} placeholder="屏幕上的字　[[重点]]" onCommit={(s) => set(`beat.${k}.t`, s)} autoFocus={p.focusLine === k} />
                <Field value={b.en} placeholder="English" onCommit={(s) => set(`beat.${k}.en`, s || undefined)} />
                <div className="row">
                  <label>拍数</label>
                  <Field value={b.n ?? 4} type="number" validate={(s) => Number(s) >= 1} onCommit={(s) => set(`beat.${k}.n`, Math.round(Number(s)))} />
                </div>
              </div>
            ))}
            <div className="sec-acts">
              <button className="add" onClick={() => set(`beat.${scene.beat!.length}`, { t: '', n: 4 })}>
                <Icon name="plus" size={14} />
                加一句
              </button>
              <span className="grow" />
              <button className="mini" onClick={() => set('beat', undefined)}>
                移出卡点版
              </button>
            </div>
          </>
        )}
      </div>
    );

  return (
    <div className="insp">
      <div className="ihead">
        <div className="ihead-row">
          <span className="kdot" style={{ background: KIND_COLOR[v.kind] ?? '#8b90a0' }} />
          <h2>{scene.id}</h2>
          <span className="kind">{KIND_NAME[v.kind] ?? v.kind}</span>
          <span className="grow" />
          <button className="icon sm" onClick={p.actions.up} title="前移一段">
            <Icon name="up" size={14} />
          </button>
          <button className="icon sm" onClick={p.actions.down} title="后移一段">
            <Icon name="down" size={14} />
          </button>
          <button className="icon sm" onClick={p.actions.split} disabled={!e} title="在播放头处拆分 (Ctrl+B)">
            <Icon name="split" size={14} />
          </button>
          <button className="icon sm" onClick={p.actions.dup} title="复制这一段 (Ctrl+D)">
            <Icon name="copy" size={14} />
          </button>
          <button className="icon sm danger" onClick={p.actions.del} title="删除这一段 (Delete)">
            <Icon name="trash" size={14} />
          </button>
        </div>
        <div className="meta">{e ? `从 ${fmtTime(e.start, fps)} 开始，${(e.dur / fps).toFixed(2)} 秒` : `这一版没用到：${hidden?.why ?? '未用'}`}</div>
      </div>
      <Tabs<STab>
        value={tab}
        onChange={setTab}
        items={[
          ['visual', '画面'],
          ['trans', '转场'],
          ['fx', '特效', fxCount],
          ['over', '叠加', scene.overlays?.length],
          ['lines', p.mode === 'voice' ? '旁白' : '卡点字', lineCount],
        ]}
      />
      <div className="ibody">{body}</div>
      <datalist id="marks">
        {marks.map((m) => (
          <option key={m} value={`@${m}`} />
        ))}
      </datalist>
    </div>
  );
}

function OverlayItem({ o, i, set }: { o: Overlay; i: number; set: (path: string, value: unknown) => void }) {
  const def = OVERLAYS.find((x) => x.kind === o.kind);
  const f = (name: string) => `overlays.${i}.${name}`;
  const fields = def?.fields ?? ['text', 'sub', 'x', 'y'];
  return (
    <div className="item ov">
      <div className="head">
        <span className="idx">{i + 1}</span>
        <span className="ovk">
          {def?.label ?? o.kind}
          {def?.rule ? (
            <span className="rule" title={def.rule}>
              !
            </span>
          ) : null}
        </span>
        <span className="grow" />
        <button className="icon sm" title="删除" onClick={() => set(`overlays.${i}`, undefined)}>
          <Icon name="close" size={14} />
        </button>
      </div>
      {fields.includes('text') ? <Field value={o.text} placeholder="文字" onCommit={(s) => set(f('text'), s)} /> : null}
      {fields.includes('sub') ? <Field value={o.sub} placeholder="副标题（可空）" onCommit={(s) => set(f('sub'), s || undefined)} /> : null}
      <div className="row4">
        <div>
          <label>开始 秒</label>
          <Field value={o.at} validate={isNum} onCommit={(s) => set(f('at'), num(s) ?? 0)} />
        </div>
        <div>
          <label>时长 秒</label>
          <Field value={o.dur} placeholder="1.6" validate={isNum} onCommit={(s) => set(f('dur'), num(s))} />
        </div>
        {(['x', 'y', 'w', 'h'] as const)
          .filter((k) => fields.includes(k))
          .map((k) => (
            <div key={k}>
              <label>{{ x: '横 x', y: '纵 y', w: '宽 w', h: '高 h' }[k]}</label>
              <Field value={o[k]} placeholder="0–1" validate={isNum} onCommit={(s) => set(f(k), num(s))} />
            </div>
          ))}
      </div>
      {def?.hint ? <div className="hint">{def.hint}</div> : null}
    </div>
  );
}

function VisualFields({ v, k, set, assets, marks }: { v: Visual; k: string; set: (path: string, value: unknown) => void; assets: string[]; marks: string[] }) {
  const f = (name: string) => `${k}.${name}`;
  const pick = (list: string[]) => [...new Set([(v as { src?: string }).src ?? '', ...list])].filter(Boolean);
  const frameSel = (value: string | undefined, allowNone: boolean) => (
    <select value={value ?? (allowNone ? '' : 'window')} onChange={(e) => set(f('frame'), e.target.value === (allowNone ? '' : 'window') ? undefined : e.target.value)} style={{ width: '100%' }}>
      {allowNone ? <option value="">铺满</option> : null}
      <option value="window">窗口</option>
      <option value="phone">手机</option>
      <option value="bare">无边框</option>
    </select>
  );
  switch (v.kind) {
    case 'screen':
      return (
        <>
          <Row label="录屏">
            <select value={v.src} onChange={(e) => set(f('src'), e.target.value)}>
              {pick(assets.filter((a) => a.startsWith('cap/') && isVid(a))).map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Row>
          <Row label="起点">
            <Field value={v.from} placeholder="0" list="marks" validate={refOk(marks)} onCommit={(s) => set(f('from'), asRef(s))} />
          </Row>
          <Row label="终点">
            <Field value={v.to} placeholder="录屏结尾" list="marks" validate={refOk(marks)} onCommit={(s) => set(f('to'), asRef(s))} />
          </Row>
          <div className="row3">
            <div>
              <label>速度</label>
              <Field value={v.rate} placeholder="默认 1" validate={isNum} onCommit={(s) => set(f('rate'), num(s))} />
            </div>
            <div>
              <label>基础缩放</label>
              <Field value={v.base} placeholder="默认 1" validate={isNum} onCommit={(s) => set(f('base'), num(s))} />
            </div>
            <div>
              <label>外框</label>
              {frameSel(v.frame, false)}
            </div>
          </div>
          <div className="row3">
            <div style={{ gridColumn: 'span 2' }}>
              <label>点击自动推近</label>
              <select value={v.zoom ?? 'auto'} onChange={(e) => set(f('zoom'), e.target.value === 'auto' ? undefined : e.target.value)} style={{ width: '100%' }}>
                <option value="auto">开（默认）</option>
                <option value="off">关</option>
              </select>
            </div>
          </div>
          <Row label="网址">
            <Field value={v.url} placeholder="（不显示）" onCommit={(s) => set(f('url'), s || undefined)} />
          </Row>
        </>
      );
    case 'image':
      return (
        <>
          <Row label="图片">
            <select value={v.src} onChange={(e) => set(f('src'), e.target.value)}>
              {pick(assets.filter(isImg)).map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Row>
          <div className="row3">
            <div>
              <label>填充</label>
              <select value={v.fit ?? 'cover'} onChange={(e) => set(f('fit'), e.target.value === 'cover' ? undefined : e.target.value)} style={{ width: '100%' }}>
                <option value="cover">裁满</option>
                <option value="contain">完整显示</option>
              </select>
            </div>
            <div>
              <label>外框</label>
              {frameSel(v.frame, true)}
            </div>
          </div>
        </>
      );
    case 'clip':
      return (
        <>
          <Row label="视频">
            <select value={v.src} onChange={(e) => set(f('src'), e.target.value)}>
              {pick(assets.filter(isVid)).map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Row>
          <div className="row3">
            <div>
              <label>从第几秒</label>
              <Field value={v.from} placeholder="0" validate={isNum} onCommit={(s) => set(f('from'), num(s))} />
            </div>
            <div>
              <label>速度</label>
              <Field value={v.rate} placeholder="默认 1" validate={isNum} onCommit={(s) => set(f('rate'), num(s))} />
            </div>
            <div>
              <label>外框</label>
              {frameSel(v.frame, true)}
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={v.muted === false} onChange={(e) => set(f('muted'), e.target.checked ? false : undefined)} />
            保留视频原声
          </label>
        </>
      );
    case 'title':
      return (
        <>
          <Row label="小标题">
            <Field value={v.kicker} onCommit={(s) => set(f('kicker'), s || undefined)} />
          </Row>
          <Row label="标题">
            <Field value={v.title} onCommit={(s) => set(f('title'), s)} />
          </Row>
          <Row label="副标题">
            <Field value={v.sub} onCommit={(s) => set(f('sub'), s || undefined)} />
          </Row>
        </>
      );
    case 'stats':
      return <StatsFields v={v} k={k} set={set} />;
    case 'outro':
      return (
        <>
          <Row label="标题">
            <Field value={v.title} onCommit={(s) => set(f('title'), s)} />
          </Row>
          <Row label="网址">
            <Field value={v.url} onCommit={(s) => set(f('url'), s || undefined)} />
          </Row>
          <Row label="小字">
            <Field multiline value={(v.lines ?? []).join('\n')} onCommit={(s) => set(f('lines'), s.trim() ? s.split('\n').filter(Boolean) : undefined)} />
          </Row>
        </>
      );
    default:
      return <JsonEdit value={v} onApply={(x) => set(k, x)} />;
  }
}

function StatsFields({ v, k, set }: { v: StatsVisual; k: string; set: (path: string, value: unknown) => void }) {
  return (
    <>
      <Row label="标题">
        <Field value={v.title} placeholder="（无）" onCommit={(s) => set(`${k}.title`, s || undefined)} />
      </Row>
      {v.items.map((it, i) => (
        <div className="row3" key={i}>
          <Field value={it.value} placeholder="数字" onCommit={(s) => set(`${k}.items.${i}.value`, s)} />
          <Field value={it.label} placeholder="说明" onCommit={(s) => set(`${k}.items.${i}.label`, s)} />
          <div style={{ display: 'flex', gap: 4 }}>
            <Field value={it.en} placeholder="English" onCommit={(s) => set(`${k}.items.${i}.en`, s || undefined)} />
            <button className="icon sm" title="删除" onClick={() => set(`${k}.items.${i}`, undefined)}>
              <Icon name="close" size={14} />
            </button>
          </div>
        </div>
      ))}
      <button className="add" onClick={() => set(`${k}.items.${v.items.length}`, { value: '0', label: '' })}>
        <Icon name="plus" size={14} />
        加一项
      </button>
    </>
  );
}

const fieldsOf = (paths: string[]) => BOARD_FX.flatMap((g) => g.fields).filter((f) => paths.includes(f.path));

function BoardPanel(p: Props) {
  const b = p.doc.board;
  const [tab, setTab] = useTab<BTab>('vs-btab', ['basic', 'audio', 'caps', 'look'], 'basic');
  const set = (path: string, value: unknown) => p.commit((d) => setPath(d, null, path, value), { coalesce: `board.${path}` });
  const audio = [...p.music.map((m) => m.src), ...p.assets.filter((a) => /\.(mp3|wav|m4a)$/i.test(a)).map((a) => `${p.slug}/${a}`)];
  const controls = (paths: string[]) =>
    fieldsOf(paths)
      .filter((f) => !f.path.startsWith('music.') || (p.mode === 'voice' && !!b.music))
      .map((f) => <FieldControl key={f.path} def={f} value={getPath(b, f.path)} onChange={(x) => set(f.path, x)} />);

  let body: React.ReactNode;
  if (tab === 'basic')
    body = (
      <>
        <div className="sec">
          <Row label="标题">
            <Field value={b.title} onCommit={(s) => set('title', s)} />
          </Row>
          <Row label="竖屏顶栏">
            <Field value={b.header} placeholder="竖屏顶部的一行字" onCommit={(s) => set('header', s || undefined)} />
          </Row>
          <Row label="顶栏英文">
            <Field value={b.headerEn} onCommit={(s) => set('headerEn', s || undefined)} />
          </Row>
        </div>
        <div className="sec">
          <h3>颜色和背景</h3>
          <div className="swatches">
            <label>
              <input type="color" value={b.theme.accent} onChange={(e) => set('theme.accent', e.target.value)} />
              主色
            </label>
            <label>
              <input type="color" value={b.theme.bg?.[0] ?? '#0b1020'} onChange={(e) => set('theme.bg', [e.target.value, b.theme.bg?.[1] ?? '#18223d'])} />
              背景 1
            </label>
            <label>
              <input type="color" value={b.theme.bg?.[1] ?? '#18223d'} onChange={(e) => set('theme.bg', [b.theme.bg?.[0] ?? '#0b1020', e.target.value])} />
              背景 2
            </label>
          </div>
          <Row label="背景图">
            <select value={b.theme.wallpaper ?? ''} onChange={(e) => set('theme.wallpaper', e.target.value || undefined)}>
              <option value="">渐变（默认）</option>
              {p.assets.filter(isImg).map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Row>
          {b.theme.wallpaper ? controls(['theme.wallBlur']) : null}
        </div>
        {p.etl?.hidden.length ? (
          <div className="sec">
            <h3>这一版没用到的段落</h3>
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
        {p.mode === 'voice' ? (
          <div className="sec">
            <h3>旁白版配乐</h3>
            <Row label="音乐">
              <select value={b.music?.src ?? ''} onChange={(e) => set('music', e.target.value ? { ...(b.music ?? {}), src: e.target.value } : undefined)}>
                <option value="">无</option>
                {[...new Set([b.music?.src ?? '', ...audio])].filter(Boolean).map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </Row>
            <div className="row3">
              <div>
                <label>音量</label>
                <Field value={b.music?.volume} placeholder="0.22" validate={isNum} onCommit={(s) => set('music.volume', num(s))} />
              </div>
              <div>
                <label>说话时压到</label>
                <Field value={b.music?.duck} placeholder="0.3" validate={isNum} onCommit={(s) => set('music.duck', num(s))} />
              </div>
            </div>
            {controls(['music.fadeIn', 'music.fadeOut'])}
          </div>
        ) : (
          <div className="sec">
            <h3>卡点版配乐</h3>
            <Row label="音乐">
              <select value={b.beat?.music ?? ''} onChange={(e) => set('beat', e.target.value ? { ...(b.beat ?? {}), music: e.target.value } : undefined)}>
                <option value="">无</option>
                {[...new Set([b.beat?.music ?? '', ...p.music.filter((m) => m.beats).map((m) => m.src)])].filter(Boolean).map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </Row>
            <div className="row3">
              <div>
                <label>从第几小节</label>
                <Field value={b.beat?.startBar} placeholder="0" validate={isNum} onCommit={(s) => set('beat.startBar', num(s))} />
              </div>
              <div>
                <label>音量</label>
                <Field value={b.beat?.volume} placeholder="0.85" validate={isNum} onCommit={(s) => set('beat.volume', num(s))} />
              </div>
            </div>
          </div>
        )}
        <div className="sec">
          <h3>音效</h3>
          {controls(['sfx.whoosh', 'sfx.click', 'sfx.pop', 'sfx.volume'])}
        </div>
      </>
    );
  else if (tab === 'caps')
    body = (
      <div className="sec">
        {controls(['captions.off', 'captions.style', 'captions.pos', 'captions.scale', 'captions.anim', 'chapterBar'])}
      </div>
    );
  else
    body = (
      <div className="sec">
        <h3>录屏画框</h3>
        {controls(['frame.radius', 'frame.shadow', 'frame.inset', 'frame.glow'])}
        <h3 className="gap">卡片</h3>
        {controls(['glass'])}
      </div>
    );

  return (
    <div className="insp">
      <div className="ihead">
        <div className="ihead-row">
          <span className="kdot board" />
          <h2>项目设置</h2>
        </div>
        <div className="meta">影响整条片子。点时间线上的段落，改那一段。</div>
      </div>
      <Tabs<BTab>
        value={tab}
        onChange={setTab}
        items={[
          ['basic', '基本'],
          ['audio', '声音'],
          ['caps', '字幕'],
          ['look', '画框'],
        ]}
      />
      <div className="ibody">{body}</div>
    </div>
  );
}
