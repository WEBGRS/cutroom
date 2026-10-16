import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { nm, tr } from './i18n';
import { ENGINES, RECORD_TEXT, TEST_ENGINE, type EngineDef, type EngineId, type VoiceDef } from './voices';

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
interface LocalJob {
  state: 'running' | 'done' | 'error';
  step: 'python' | 'torch' | 'packages' | 'model' | 'check';
  got: number;
  total: number;
  note?: string;
  error?: string;
}
type Phase = 'off' | 'queued' | 'starting' | 'loading' | 'ready';
interface LocalStatus {
  ready: boolean;
  design: boolean;
  model: string | null;
  folder: string;
  phase: Phase;
  device: string;
  job: LocalJob | null;
  bytes: number;
  designBytes: number;
  custom: VoiceDef[];
}
interface Status {
  settings: { engine: EngineId; voices: Record<string, { zh?: string; en?: string }>; speed: number };
  engines: { id: EngineId; ready: boolean; need?: 'model' | 'key' | 'install' }[];
  model: { installed: boolean; bytes: number; job: ModelJob | null };
  local: LocalStatus;
  job: Job | null;
  lines: LineState[];
}

const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Built-in voices clearest in a Whisper listen-back (34 of 100 screened on 4 sentences, the best on 8 more)
export const BUILTIN_PICKS = ['zm_041', 'zf_072', 'zf_018', 'zf_043', 'zm_045', 'zm_058'];

export function VoicePanel({ slug, lang, onSettings }: { slug: string; lang: 'zh' | 'en'; onSettings: () => void }) {
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
      if (e.type === 'voice-local') setSt((s) => (s ? { ...s, local: { ...s.local, job: e.job } } : s));
      if (e.type === 'voice-local-phase') setSt((s) => (s ? { ...s, local: { ...s.local, phase: e.phase, device: e.device } } : s));
      if ((e.type === 'voice-local' && e.job.state !== 'running') || e.type === 'voice-custom') void load();
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
  const hd = engine.id === 'local';
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
  const engineVoices = hd ? [...engine.voices, ...st.local.custom] : engine.voices;
  let voices = engineVoices.filter((v) => v.lang === 'any' || v.lang === lang);
  const big = voices.length > 20;
  if (big && filter === 'picks') voices = voices.filter((v) => BUILTIN_PICKS.includes(v.id) || v.id === chosen);
  else if (big && filter !== 'all') voices = voices.filter((v) => v.gender === filter);
  const langName = lang === 'en' ? tr('English', '英文') : tr('Chinese', '中文');
  const lj = st.local.job;
  // What the HD worker is doing before the first line comes out
  const phaseNote = !hd ? '' : st.local.phase === 'queued' ? tr('Waiting for the graphics card…', '排队等显卡…') : st.local.phase === 'starting' || st.local.phase === 'loading' ? tr('Loading the voice model (about half a minute)…', '正在加载语音模型（大约半分钟）…') : '';
  const forget = async (v: VoiceDef) => {
    if (!confirm(tr(`Remove the voice "${nm(v)}"?`, `删除音色「${nm(v)}」？`))) return;
    const r = await post('/api/voice/custom/delete', { id: v.id });
    if (!r.ok) setErr((await r.json()).error);
    void load();
  };

  return (
    <div className="vop">
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
      ) : es?.need === 'install' ? (
        <div className="vo-card">
          {lj?.state === 'running' ? (
            <>
              <b className="vo-step">{stepName(lj)}</b>
              <div className="vo-bar">
                <i style={{ width: `${lj.step === 'model' && lj.total ? Math.round((lj.got / lj.total) * 100) : 100}%` }} className={lj.step === 'model' ? undefined : 'pulse'} />
              </div>
              {lj.note && lj.step !== 'model' ? <span className="lib-note vo-mono">{lj.note}</span> : null}
              <span className="lib-note">{tr('You can keep editing; the install carries on in the background.', '可以继续剪，安装在后台进行。')}</span>
            </>
          ) : (
            <>
              <button className="primary" onClick={() => void post('/api/voice/local/install', { what: 'voices' }).then(load)}>
                <Icon name="download" size={14} />
                {tr(`Install HD voices (about ${Math.max(1, Math.round(st.local.bytes / 1e9))} GB)`, `安装高清配音（约 ${Math.max(1, Math.round(st.local.bytes / 1e9))} GB）`)}
              </button>
              <span className="lib-note">{tr(`Goes to ${st.local.folder}`, `装到 ${st.local.folder}`)}</span>
              {lj?.state === 'error' ? <span className="vo-err">{lj.error}</span> : null}
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
              <span className="lib-note">{job!.done === 0 && phaseNote ? phaseNote : tr(`Voicing ${job!.done} / ${job!.total}…`, `正在配音 ${job!.done} / ${job!.total}…`)}</span>
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
          <span>{engineVoices.filter((v) => v.lang === 'any' || v.lang === lang).length}</span>
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
              {v.mine ? <span>{v.mine === 'design' ? tr('Your voice · designed', '你的音色 · 按描述生成') : v.mine === 'record' ? tr('Your voice · recorded', '你的音色 · 录音') : tr('Your voice · from a clip', '你的音色 · 导入音频')}</span> : v.gender && engine.id !== 'builtin' ? <span>{v.gender === 'f' ? tr('Female', '女声') : tr('Male', '男声')}</span> : null}
            </span>
            {v.mine && v.id !== chosen ? (
              <button className="icon sm" disabled={running} onClick={() => void forget(v)} title={tr('Remove', '删除')}>
                <Icon name="trash" size={13} />
              </button>
            ) : null}
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
        {loadingVoice && phaseNote ? <p className="lib-note">{phaseNote}</p> : null}
      </section>
      {hd && es?.ready ? <MyVoices lang={lang} local={st.local} busy={running} onMade={(v) => void setSettings({ voice: v.id }).then(load)} /> : null}
      {err ? <p className="vo-err">{err}</p> : null}
    </div>
  );
}

const stepName = (j: LocalJob) =>
  j.step === 'python'
    ? tr('Setting up Python…', '准备 Python 环境…')
    : j.step === 'torch'
      ? tr('Installing PyTorch (about 3 GB)…', '安装 PyTorch（约 3 GB）…')
      : j.step === 'packages'
        ? tr('Installing the speech program…', '安装语音合成程序…')
        : j.step === 'model'
          ? tr(`Downloading the voice model… ${(j.got / 1e9).toFixed(1)} / ${(j.total / 1e9).toFixed(1)} GB`, `正在下载语音模型… ${(j.got / 1e9).toFixed(1)} / ${(j.total / 1e9).toFixed(1)} GB`)
          : tr('Trying a first line…', '试读一句…');

// Your own HD voices: read a passage into the microphone, bring a clip, or describe a voice
function MyVoices({ lang, local, busy, onMade }: { lang: 'zh' | 'en'; local: LocalStatus; busy: boolean; onMade: (v: VoiceDef) => void }) {
  const [mode, setMode] = useState<'' | 'record' | 'design'>('');
  const [rec, setRec] = useState<{ r: MediaRecorder; t0: number } | null>(null);
  const [secs, setSecs] = useState(0);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [working, setWorking] = useState('');
  const [err, setErr] = useState('');
  const file = useRef<HTMLInputElement | null>(null);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setSecs((Date.now() - rec.t0) / 1000), 200);
    return () => clearInterval(t);
  }, [rec]);

  const upload = async (blob: Blob, from: 'record' | 'import', fname: string) => {
    setWorking(tr('Saving the voice…', '正在保存音色…'));
    setErr('');
    try {
      const q = new URLSearchParams({ from, lang, name: name || (from === 'record' ? tr('My voice', '我的声音') : fname.replace(/\.[^.]+$/, '')), file: fname, text: from === 'record' ? RECORD_TEXT[lang] : '' });
      const r = await fetch(`/api/voice/custom?${q}`, { method: 'PUT', body: blob });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setMode('');
      setName('');
      onMade(j.voice);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setWorking('');
    }
  };
  const startRec = async () => {
    setErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
      const r = new MediaRecorder(stream);
      chunks.current = [];
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      r.start(250);
      setSecs(0);
      setRec({ r, t0: Date.now() });
    } catch (e) {
      setErr(tr(`No microphone: ${(e as Error).message}`, `用不了麦克风：${(e as Error).message}`));
    }
  };
  const stopRec = () => {
    if (!rec) return;
    const { r, t0 } = rec;
    const long = (Date.now() - t0) / 1000 >= 5;
    r.onstop = () => {
      r.stream.getTracks().forEach((t) => t.stop());
      if (long) void upload(new Blob(chunks.current, { type: r.mimeType }), 'record', `recording${r.mimeType.includes('ogg') ? '.ogg' : '.webm'}`);
    };
    if (!long) setErr(tr('Too short: read the whole passage (at least 5 seconds)', '太短了：把整段读完（至少 5 秒）'));
    r.stop();
    setRec(null);
  };
  const design = async () => {
    setWorking(tr('Making the voice (about a minute)…', '正在生成音色（大约一分钟）…'));
    setErr('');
    try {
      const r = await post('/api/voice/custom/design', { name, lang, instruct: desc });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setMode('');
      setName('');
      setDesc('');
      onMade(j.voice);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setWorking('');
    }
  };
  const dj = local.job;
  const idle = !busy && !working && !rec;

  return (
    <section className="lib-sec">
      <h4>{tr('Your own voices', '我的音色')}</h4>
      <p className="lib-note pad0">{tr('Read one passage into the microphone and every line is spoken in your voice. Or bring a clip, or describe a voice.', '对着麦克风读一段，之后每句旁白都用你的声音念。也可以导入一段音频，或者用一句话描述想要的声音。')}</p>
      <div className="vo-acts wrap">
        <button className="btn" disabled={!idle} onClick={() => setMode(mode === 'record' ? '' : 'record')}>
          <Icon name="mic" size={14} />
          {tr('Record my voice', '录我的声音')}
        </button>
        <button className="btn" disabled={!idle} onClick={() => file.current?.click()}>
          <Icon name="import" size={14} />
          {tr('Import a clip', '导入音频')}
        </button>
        <button className="btn" disabled={!idle} onClick={() => setMode(mode === 'design' ? '' : 'design')}>
          <Icon name="sparkle" size={14} />
          {tr('Describe a voice', '描述一个声音')}
        </button>
        <input
          ref={file}
          type="file"
          accept="audio/*,video/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void upload(f, 'import', f.name);
          }}
        />
      </div>
      {mode === 'record' ? (
        <div className="vo-card">
          <span className="lib-note">{tr('Read this aloud at your normal pace, in a quiet room:', '找个安静的地方，用平时说话的语速读这段：')}</span>
          <p className="vo-read">{RECORD_TEXT[lang]}</p>
          <input className="vo-name" placeholder={tr('Name (optional)', '名字（可不填）')} value={name} onChange={(e) => setName(e.target.value)} />
          {rec ? (
            <div className="vo-acts">
              <span className="vo-rec">
                <i />
                {secs.toFixed(0)} s
              </span>
              <button className="primary" onClick={stopRec}>
                <Icon name="stop" size={14} />
                {tr('Stop and save', '停止并保存')}
              </button>
            </div>
          ) : (
            <button className="primary" disabled={!!working} onClick={() => void startRec()}>
              <Icon name="mic" size={14} />
              {tr('Start recording', '开始录音')}
            </button>
          )}
        </div>
      ) : null}
      {mode === 'design' ? (
        <div className="vo-card">
          {local.design ? (
            <>
              <textarea className="vo-desc" rows={3} placeholder={tr('e.g. A woman in her twenties, relaxed and warm, like telling a friend about something she found', '比如：二十岁出头的女生，语气轻松温和，像在跟朋友分享一个新发现')} value={desc} onChange={(e) => setDesc(e.target.value)} />
              <input className="vo-name" placeholder={tr('Name (optional)', '名字（可不填）')} value={name} onChange={(e) => setName(e.target.value)} />
              <button className="primary" disabled={!desc.trim() || !!working} onClick={() => void design()}>
                <Icon name="sparkle" size={14} />
                {tr('Make this voice', '生成这个音色')}
              </button>
            </>
          ) : dj?.state === 'running' ? (
            <>
              <b className="vo-step">{stepName(dj)}</b>
              <div className="vo-bar">
                <i style={{ width: `${dj.total ? Math.round((dj.got / dj.total) * 100) : 100}%` }} />
              </div>
            </>
          ) : (
            <>
              <span className="lib-note">{tr('Describing a voice needs one more model.', '描述声音还需要再下载一个模型。')}</span>
              <button className="primary" onClick={() => void post('/api/voice/local/install', { what: 'design' })}>
                <Icon name="download" size={14} />
                {tr(`Download it (${(local.designBytes / 1e9).toFixed(1)} GB)`, `下载（${(local.designBytes / 1e9).toFixed(1)} GB）`)}
              </button>
              {dj?.state === 'error' ? <span className="vo-err">{dj.error}</span> : null}
            </>
          )}
        </div>
      ) : null}
      {working ? <p className="lib-note">{working}</p> : null}
      {err ? <p className="vo-err">{err}</p> : null}
    </section>
  );
}
