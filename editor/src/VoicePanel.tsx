import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { nm, tr } from './i18n';
import { ENGINES, TEST_ENGINE, type EngineDef, type EngineId, type VoiceDef } from './voices';

interface LineState {
  scene: string;
  k: number;
  text: string;
  state: 'voiced' | 'stale' | 'missing' | 'empty';
}
interface Job {
  slug: string;
  lang: 'zh' | 'en';
  state: 'running' | 'done' | 'error' | 'cancelled';
  done: number;
  total: number;
  error?: string;
  result?: { voiced: number; seconds: number; failed: { line: string; error: string }[] };
}
interface ModelJob {
  state: 'running' | 'done' | 'error';
  got: number;
  total: number;
  error?: string;
}
interface Status {
  settings: { engine: EngineId; voices: Record<string, { zh?: string; en?: string }>; speed: number };
  engines: { id: EngineId; ready: boolean; need?: 'model' | 'key' }[];
  model: { installed: boolean; bytes: number; job: ModelJob | null };
  job: Job | null;
  lines: LineState[];
}

const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Built-in voices clearest in a Whisper listen-back (34 of 100 screened on 4 sentences, the best on 8 more)
export const BUILTIN_PICKS = ['zm_041', 'zf_072', 'zf_018', 'zf_043', 'zm_045', 'zm_058'];

export function VoicePanel({ slug, lang, mode, onSettings }: { slug: string; lang: 'zh' | 'en'; mode: 'voice' | 'beat'; onSettings: () => void }) {
  const [st, setSt] = useState<Status | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<'picks' | 'f' | 'm' | 'all'>('picks');
  const [playing, setPlaying] = useState<string | null>(null);
  const [loadingVoice, setLoadingVoice] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const load = () =>
    fetch(`/api/voice?slug=${encodeURIComponent(slug)}&lang=${lang}`)
      .then((r) => r.json())
      .then((j: Status) => setSt(j))
      .catch(() => undefined);

  useEffect(() => {
    void load();
    const es = new EventSource('/api/events');
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.type === 'voice') setSt((s) => (s ? { ...s, job: e.job } : s));
      if (e.type === 'voice-model') setSt((s) => (s ? { ...s, model: { ...s.model, job: e.job, installed: e.job.state === 'done' || s.model.installed } } : s));
      if ((e.type === 'voice' && e.job.state !== 'running') || (e.type === 'voice-model' && e.job.state !== 'running') || (e.type === 'timings' && e.slug === slug) || (e.type === 'board' && e.slug === slug)) void load();
    };
    return () => {
      es.close();
      audio.current?.pause();
    };
  }, [slug, lang]);

  if (!st) return <div className="lib-note pad">{tr('Loading…', '加载中…')}</div>;

  const engines: EngineDef[] = st.engines.some((e) => e.id === 'test') ? [...ENGINES, TEST_ENGINE] : ENGINES;
  const engine = engines.find((e) => e.id === st.settings.engine) ?? ENGINES[0];
  const es = st.engines.find((e) => e.id === engine.id);
  const chosen = st.settings.voices[engine.id]?.[lang] ?? engine.def[lang];
  const job = st.job?.slug === slug ? st.job : null;
  const running = job?.state === 'running';
  const mj = st.model.job;
  const count = (s: LineState['state']) => st.lines.filter((l) => l.state === s).length;
  const voiced = count('voiced');
  const todo = count('missing') + count('stale');
  const total = st.lines.filter((l) => l.state !== 'empty').length;

  const setSettings = async (patch: Record<string, unknown>) => {
    setErr('');
    const r = await post('/api/voice/settings', { ...patch, lang });
    const j = await r.json();
    if (!r.ok) return setErr(j.error);
    setSt((s) => (s ? { ...s, settings: j.settings } : s));
  };
  const run = async (redo: boolean) => {
    setErr('');
    const r = await post('/api/voice/run', { slug, lang, redo });
    const j = await r.json();
    if (!r.ok) return setErr(j.error);
    setSt((s) => (s ? { ...s, job: j.job } : s));
  };
  const listen = async (v: VoiceDef) => {
    audio.current?.pause();
    if (playing === v.id) return setPlaying(null);
    setErr('');
    setLoadingVoice(v.id);
    try {
      const r = await post('/api/voice/sample', { engine: engine.id, voice: v.id, lang });
      if (!r.ok) throw new Error((await r.json()).error);
      const a = new Audio(URL.createObjectURL(await r.blob()));
      audio.current = a;
      a.onended = () => setPlaying(null);
      await a.play();
      setPlaying(v.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoadingVoice(null);
    }
  };

  // Voices for this language; the built-in Chinese set is long, so it opens on a short list
  let voices = engine.voices.filter((v) => v.lang === 'any' || v.lang === lang);
  const big = voices.length > 20;
  if (big && filter === 'picks') voices = voices.filter((v) => BUILTIN_PICKS.includes(v.id) || v.id === chosen);
  else if (big && filter !== 'all') voices = voices.filter((v) => v.gender === filter);
  const langName = lang === 'en' ? tr('English', '英文') : tr('Chinese', '中文');

  return (
    <div className="vop">
      {mode === 'beat' ? <div className="vo-warn">{tr('The beat cut has no narration. Switch to the narrated cut to hear the voice-over.', '卡点版没有旁白。切到旁白版才能听到配音。')}</div> : null}
      <label className="vo-row">
        <span>{tr('Engine', '引擎')}</span>
        <select value={engine.id} onChange={(e) => void setSettings({ engine: e.target.value })} disabled={running}>
          {engines.map((e) => (
            <option key={e.id} value={e.id}>
              {nm(e)}
            </option>
          ))}
        </select>
      </label>
      <p className="lib-note">{tr(engine.noteEn, engine.noteZh)}</p>

      {es?.need === 'model' ? (
        <div className="vo-card">
          {mj?.state === 'running' ? (
            <>
              <div className="vo-bar">
                <i style={{ width: `${Math.round((mj.got / mj.total) * 100)}%` }} />
              </div>
              <span className="lib-note">{tr(`Downloading the voice model… ${Math.round(mj.got / 1e6)} / ${Math.round(mj.total / 1e6)} MB`, `正在下载语音模型… ${Math.round(mj.got / 1e6)} / ${Math.round(mj.total / 1e6)} MB`)}</span>
            </>
          ) : (
            <>
              <button className="primary" onClick={() => void post('/api/voice/model', {}).then(load)}>
                <Icon name="download" size={14} />
                {tr(`Download voices (${Math.round(st.model.bytes / 1e6)} MB)`, `下载音色（${Math.round(st.model.bytes / 1e6)} MB）`)}
              </button>
              {mj?.state === 'error' ? <span className="vo-err">{mj.error}</span> : null}
            </>
          )}
        </div>
      ) : es?.need === 'key' ? (
        <div className="vo-card">
          <span className="lib-note">{tr('No key for this provider yet.', '这家还没有填 Key。')}</span>
          <button className="btn" onClick={onSettings}>
            <Icon name="gear" size={14} />
            {tr('Add a key in Settings › AI', '去「设置 › AI」填 Key')}
          </button>
        </div>
      ) : null}

      <div className="vo-card">
        <div className="vo-count">
          <b>{tr(`${voiced} of ${total} ${langName} lines voiced`, `${total} 句${langName}旁白，已配音 ${voiced} 句`)}</b>
          {count('stale') ? <span>{tr(`${count('stale')} changed since`, `${count('stale')} 句文字改过`)}</span> : null}
        </div>
        {running ? (
          <>
            <div className="vo-bar">
              <i style={{ width: `${job!.total ? Math.round((job!.done / job!.total) * 100) : 0}%` }} />
            </div>
            <div className="vo-acts">
              <span className="lib-note">{tr(`Voicing ${job!.done} / ${job!.total}…`, `正在配音 ${job!.done} / ${job!.total}…`)}</span>
              <span className="grow" />
              <button className="mini" onClick={() => void post('/api/voice/cancel', {})}>
                {tr('Stop', '停止')}
              </button>
            </div>
          </>
        ) : (
          <div className="vo-acts">
            {todo ? (
              <button className="primary" disabled={!es?.ready} onClick={() => void run(false)}>
                <Icon name="mic" size={14} />
                {tr(`Voice ${todo} line${todo > 1 ? 's' : ''}`, `给 ${todo} 句配音`)}
              </button>
            ) : (
              <span className="vo-done">
                <Icon name="check" size={13} />
                {total ? tr('All lines voiced', '都配好了') : tr('No narration lines yet', '还没有旁白')}
              </span>
            )}
            <button className="mini" disabled={!es?.ready || !voiced} onClick={() => void run(true)} title={tr('Re-voice every line with the current voice and speed', '用当前音色和语速重配所有句子')}>
              {tr('Redo all', '全部重配')}
            </button>
          </div>
        )}
        {job && !running && job.state !== 'cancelled' ? (
          job.state === 'error' ? (
            <span className="vo-err">{job.error}</span>
          ) : job.result?.failed.length ? (
            <span className="vo-err">{tr(`${job.result.failed.length} line(s) failed: ${job.result.failed[0].error}`, `${job.result.failed.length} 句失败：${job.result.failed[0].error}`)}</span>
          ) : job.result ? (
            <span className="lib-note">{tr(`Done: ${job.result.voiced} line(s), ${job.result.seconds} s of narration`, `完成：配了 ${job.result.voiced} 句，旁白共 ${job.result.seconds} 秒`)}</span>
          ) : null
        ) : null}
      </div>

      <label className="vo-row">
        <span>{tr('Speed', '语速')}</span>
        <input type="range" min={0.8} max={1.3} step={0.05} value={st.settings.speed} disabled={running} onChange={(e) => setSt({ ...st, settings: { ...st.settings, speed: Number(e.target.value) } })} onPointerUp={(e) => void setSettings({ speed: Number((e.target as HTMLInputElement).value) })} onKeyUp={(e) => void setSettings({ speed: Number((e.target as HTMLInputElement).value) })} />
        <span className="vo-num">{st.settings.speed.toFixed(2)}×</span>
      </label>

      <section className="lib-sec">
        <h4>
          {tr(`Voices for ${langName}`, `${langName}音色`)}
          <span>{engine.voices.filter((v) => v.lang === 'any' || v.lang === lang).length}</span>
        </h4>
        {big ? (
          <div className="vo-filter" role="tablist">
            {(
              [
                ['picks', tr('Suggested', '推荐')],
                ['f', tr('Female', '女声')],
                ['m', tr('Male', '男声')],
                ['all', tr('All', '全部')],
              ] as const
            ).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : undefined} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
          </div>
        ) : null}
        {voices.map((v) => (
          <div key={v.id} className={`arow${v.id === chosen ? ' on' : ''}`} data-pick={`voice|${engine.id}:${v.id}|${nm(v)}`}>
            <button className="icon sm" disabled={!es?.ready || (!!loadingVoice && loadingVoice !== v.id)} onClick={() => void listen(v)} title={tr('Listen', '试听')}>
              <Icon name={loadingVoice === v.id ? 'wait' : playing === v.id ? 'pause' : 'play'} size={14} />
            </button>
            <span className="arow-t">
              <b>{nm(v)}</b>
              {v.gender && engine.id !== 'builtin' ? <span>{v.gender === 'f' ? tr('Female', '女声') : tr('Male', '男声')}</span> : null}
            </span>
            {v.id === chosen ? (
              <span className="arow-on">
                <Icon name="check" size={13} />
                {tr('In use', '使用中')}
              </span>
            ) : (
              <button className="mini" disabled={running} onClick={() => void setSettings({ voice: v.id })}>
                {tr('Use', '使用')}
              </button>
            )}
          </div>
        ))}
      </section>
      {err ? <p className="vo-err">{err}</p> : null}
    </div>
  );
}
