import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { nm, tr } from './i18n';
import type { AiRef } from './pick';
import { getPrefs, usePrefs } from './prefs';
import { FEATURED, PROMPTS, SLOT, type PromptItem } from './prompts';

export interface ChatContext {
  format: string;
  mode: string;
  lang: string;
  variant: string;
  sel?: string | null;
  t?: number;
}

interface Tool {
  id: string;
  cmd: string;
  ok?: boolean;
  out?: string;
}

interface Item {
  role: 'user' | 'assistant';
  text: string;
  refs?: string[];
  tools: Tool[];
  pending?: boolean;
  error?: string;
}

interface Preset {
  id: string;
  en: string;
  zh: string;
  base: string;
  keyUrl?: string;
  env?: string;
  noKey?: boolean;
}

interface AgentInfo {
  id: string;
  en: string;
  zh: string;
  plansEn: string;
  plansZh: string;
  login: string;
  pkg: string;
  installed: boolean;
  path: string | null;
  version: string | null;
  loggedIn: boolean | null;
  method: string | null;
  model: string;
}

export interface AiStatus {
  provider: 'claude-code' | 'anthropic' | 'compat' | 'agent' | null;
  pref: 'auto' | 'claude-code' | 'anthropic' | 'compat' | 'agent';
  agent: string | null;
  agents: AgentInfo[];
  claude: { path: string; version: string | null; loggedIn: boolean | null; method: string | null; plan: string | null } | null;
  key: { source: 'env' | 'file'; masked: string } | null;
  compat: { preset: string; base: string; model: string; key: { source: 'env' | 'file'; masked: string } | null; ready: boolean } | null;
  presets: Preset[];
}


const PREFS: [AiStatus['pref'], string, string][] = [
  ['auto', tr('Automatic', '自动'), tr('Your Claude Code login if there is one, else the Claude API key, else another model you set up', '优先用 Claude Code 登录，其次 Claude API Key，最后用你配置的其他模型')],
  ['claude-code', tr('Claude Code login', 'Claude Code 登录'), tr('Uses your Claude subscription; nothing extra to pay', '用你的 Claude 订阅额度，不另外付费')],
  ['anthropic', tr('Claude API key', 'Claude API Key'), tr('Pay per use; create a key at console.anthropic.com', '按用量付费，Key 在 console.anthropic.com 创建')],
  ['agent', tr('Other subscriptions', '其他订阅'), tr('Your ChatGPT or Google plan, through the official Codex CLI or Gemini CLI', '用你的 ChatGPT 或 Google 订阅，通过官方的 Codex CLI 或 Gemini CLI')],
  ['compat', tr('Other models', '其他模型'), tr('OpenAI, Gemini, DeepSeek, Qwen, Kimi, GLM, OpenRouter or local Ollama, with your own key', 'OpenAI、Gemini、DeepSeek、通义千问、Kimi、智谱、OpenRouter 或本机 Ollama，用你自己的 Key')],
];

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k) ?? '';
    } catch {
      return '';
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // Private mode: preference just won't persist
    }
  },
};

const post = (url: string, body: object) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// Inline `code` spans; the rest stays plain text
function Rich({ text }: { text: string }) {
  const parts = text.split(/(`[^`\n]+`)/g);
  return (
    <>
      {parts.map((s, i) => (s.startsWith('`') && s.endsWith('`') && s.length > 2 ? <code key={i}>{s.slice(1, -1)}</code> : <React.Fragment key={i}>{s}</React.Fragment>))}
    </>
  );
}

const presetOf = (s: AiStatus) => s.presets?.find((p) => p.id === s.compat?.preset);
const providerName = (s: AiStatus) => {
  if (s.provider === 'claude-code') return 'Claude Code';
  if (s.provider === 'anthropic') return 'Claude API';
  if (s.provider === 'agent') return s.agent === 'codex' ? 'ChatGPT · Codex' : s.agent === 'gemini' ? 'Gemini CLI' : tr('Subscription', '订阅');
  if (s.provider === 'compat') {
    const p = presetOf(s);
    // Short provider name; a custom address shows its host
    let host = '';
    try {
      host = new URL(s.compat?.base ?? '').host;
    } catch {
      host = '';
    }
    const name = s.compat?.preset === 'custom' ? host : p ? nm(p).replace(/[（(].*$/, '').trim() : '';
    return `${name} · ${s.compat?.model ?? ''}`;
  }
  return tr('Not connected', '未连接');
};

// Another subscription: pick the vendor's CLI, install it, sign in through it
function AgentSection({ st, save, onChange }: { st: AiStatus; save: (body: object) => Promise<void>; onChange: (s: AiStatus) => void }) {
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const act = async (id: string, action: string) => {
    setBusy(`${id}:${action}`);
    setNote('');
    try {
      const r = await post('/api/ai/agent', { id, action });
      const j = await r.json();
      if (action === 'install') setNote(j.ok ? tr('Installed.', '已安装。') : tr(`Install failed: ${j.out}`, `安装失败：${j.out}`));
      if (action === 'signin') setNote(r.ok ? tr('A terminal window opened. Finish signing in there, then press Refresh.', '已打开一个终端窗口，在里面完成登录，再点「刷新」。') : j.error);
      const s = await (await post('/api/ai/agent', { id, action: 'refresh' })).json();
      onChange(s);
    } finally {
      setBusy('');
    }
  };
  return (
    <section>
      <h4>{tr('Other subscriptions', '其他订阅')}</h4>
      <div className="rcards" role="radiogroup">
        {st.agents.map((a) => {
          const on = st.agent === a.id;
          return (
            <div key={a.id} className={`rc agent${on ? ' on' : ''}`}>
              <input type="radio" name="agent" checked={on} onChange={() => void save({ agent: { id: a.id } })} aria-label={nm(a)} />
              <span className="ag">
                <b>{nm(a)}</b>
                <small>{tr(a.plansEn, a.plansZh)}</small>
                <span className={`state ${!a.installed ? 'bad' : a.loggedIn === false ? 'warn' : 'ok'}`}>
                  <Icon name={!a.installed ? 'close' : a.loggedIn === false ? 'warn' : 'check'} size={13} />
                  <span>
                    {!a.installed
                      ? tr('Not installed', '没有安装')
                      : a.loggedIn === false
                        ? tr('Installed, not signed in', '已安装，未登录')
                        : tr(`Ready${a.method ? ` (${a.method})` : ''}`, `可用${a.method ? `（${a.method}）` : ''}`)}
                    {a.version ? ` · v${a.version}` : ''}
                  </span>
                </span>
                <span className="ag-acts">
                  {!a.installed ? (
                    <button className="btn" disabled={!!busy} onClick={() => act(a.id, 'install')} title={`npm install -g ${a.pkg}`}>
                      {busy === `${a.id}:install` ? tr('Installing…', '安装中…') : tr('Install', '安装')}
                    </button>
                  ) : (
                    <button className="btn" disabled={!!busy} onClick={() => act(a.id, 'signin')} title={a.login}>
                      {a.loggedIn ? tr('Switch account', '切换账号') : tr('Sign in', '登录')}
                    </button>
                  )}
                  <button className="btn" disabled={!!busy} onClick={() => act(a.id, 'refresh')}>
                    {tr('Refresh', '刷新')}
                  </button>
                </span>
                {on ? (
                  <label className="crow">
                    <span>{tr('Model', '模型')}</span>
                    <input
                      defaultValue={a.model}
                      placeholder={tr('Leave empty for the CLI’s default', '留空用它的默认模型')}
                      onBlur={(e) => e.target.value.trim() !== a.model && void save({ agent: { id: a.id, model: e.target.value } })}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                      spellCheck={false}
                    />
                  </label>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
      {note ? <p className="hint">{note}</p> : null}
      <p className="hint">
        {tr(
          'The CLI runs on this computer with your own sign-in. Cutroom turns off its shell, file and web tools; it can only use the editor. Chinese “Coding Plan” keys (GLM, Kimi, Qwen, MiniMax) are not supported: their terms allow them only in interactive coding tools.',
          'CLI 在这台电脑上用你自己的账号运行。剪辑台会关掉它的命令行、读写文件和联网工具，它只能操作剪辑台。国内各家的「编程套餐 (Coding Plan)」Key（智谱、Kimi、通义、MiniMax）不支持：条款只允许在交互式编程工具里使用。',
        )}
      </p>
    </section>
  );
}

// Another provider: which one, its address, its key, its model
function CompatSection({ st, save, refresh }: { st: AiStatus; save: (body: object) => Promise<void>; refresh: () => Promise<void> }) {
  const c = st.compat;
  const p = presetOf(st);
  const [key, setKey] = useState('');
  const [base, setBase] = useState(c?.base ?? '');
  const [model, setModel] = useState(c?.model ?? '');
  const [models, setModels] = useState<{ list: string[]; error?: string; loading: boolean }>({ list: [], loading: false });
  const canList = !!c?.base && (!!c?.key || !!p?.noKey || c?.preset === 'custom');
  useEffect(() => setBase(c?.base ?? ''), [c?.base]);
  useEffect(() => setModel(c?.model ?? ''), [c?.model]);
  const load = async () => {
    setModels((m) => ({ ...m, loading: true }));
    try {
      const j = await (await fetch('/api/ai/models')).json();
      setModels({ list: j.models ?? [], error: j.error, loading: false });
      if (j.model && j.model !== c?.model) await refresh();
    } catch (e) {
      setModels({ list: [], error: (e as Error).message, loading: false });
    }
  };
  useEffect(() => {
    if (canList) void load();
    else setModels({ list: [], loading: false });
  }, [c?.preset, c?.base, c?.key?.masked]);
  const commitBase = () => {
    if (base.trim() !== (c?.base ?? '')) void save({ compat: { base: base.trim() } });
  };
  const commitModel = (v = model) => {
    if (v.trim() !== (c?.model ?? '')) void save({ compat: { model: v.trim() } });
  };
  return (
    <section>
      <h4>{tr('Other models', '其他模型')}</h4>
      <label className="crow">
        <span>{tr('Provider', '服务商')}</span>
        <select value={c?.preset ?? ''} onChange={(e) => void save({ compat: { preset: e.target.value } })}>
          {!c ? <option value="">{tr('Choose…', '请选择…')}</option> : null}
          {st.presets.map((x) => (
            <option key={x.id} value={x.id}>
              {nm(x)}
            </option>
          ))}
        </select>
      </label>
      {c ? (
        <>
          <label className="crow">
            <span>{tr('Address', '接口地址')}</span>
            <input value={base} placeholder="https://…/v1" onChange={(e) => setBase(e.target.value)} onBlur={commitBase} onKeyDown={(e) => e.key === 'Enter' && commitBase()} spellCheck={false} />
          </label>
          {!p?.noKey ? (
            <>
              {c.key ? (
                <div className="state ok">
                  <Icon name="check" size={14} />
                  <span>
                    {c.key.source === 'env' ? tr(`From the ${p?.env} variable: `, `来自环境变量 ${p?.env}：`) : tr('Key saved: ', '已保存 Key：')}
                    <code>{c.key.masked}</code>
                  </span>
                  {c.key.source === 'file' ? (
                    <button className="mini" onClick={() => void save({ compat: { key: null } })}>
                      {tr('Remove', '删除')}
                    </button>
                  ) : null}
                </div>
              ) : null}
              <div className="keyrow">
                <input type="password" value={key} placeholder={c.preset === 'custom' ? tr('API key (leave empty if the server needs none)', 'API Key（服务不需要就留空）') : tr(`Paste your ${nm(p!)} API key`, `粘贴 ${nm(p!)} 的 API Key`)} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
                <button
                  className="btn"
                  disabled={!key.trim()}
                  onClick={async () => {
                    await save({ compat: { key: key.trim() } });
                    setKey('');
                  }}
                >
                  {tr('Save', '保存')}
                </button>
              </div>
              {p?.keyUrl ? (
                <p className="hint">
                  {tr('Get a key: ', '去这里创建 Key：')}
                  <a href={p.keyUrl} target="_blank" rel="noreferrer">
                    {p.keyUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                  </a>
                </p>
              ) : null}
            </>
          ) : (
            <p className="hint">{tr('No key needed. Install Ollama, run it, and pull a model that supports tools, e.g. ollama pull qwen3', '不需要 Key。安装并打开 Ollama，再拉一个支持工具调用的模型，比如 ollama pull qwen3')}</p>
          )}
          <label className="crow">
            <span>{tr('Model', '模型')}</span>
            <span className="mrow">
              <input list="compat-models" value={model} placeholder={models.loading ? tr('Loading the list…', '正在读取模型列表…') : tr('Model name', '模型名')} onChange={(e) => {
                setModel(e.target.value);
                if (models.list.includes(e.target.value)) commitModel(e.target.value);
              }} onBlur={() => commitModel()} onKeyDown={(e) => e.key === 'Enter' && commitModel()} spellCheck={false} />
              <button className="icon sm" title={tr('Reload the model list', '重新读取模型列表')} onClick={() => void load()} disabled={!canList || models.loading}>
                <Icon name="redo" size={13} />
              </button>
            </span>
          </label>
          <datalist id="compat-models">
            {models.list.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          {models.error ? (
            <div className="state bad">
              <Icon name="close" size={14} />
              <span>{models.error}</span>
            </div>
          ) : models.list.length ? (
            <p className="hint">{tr(`${models.list.length} models available. Pick one that supports tool calling (function calling); the AI edits through a tool.`, `这个服务有 ${models.list.length} 个模型。选一个支持工具调用 (function calling) 的，AI 要靠工具来改片子。`)}</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export function Connection({ st, onChange, onClose }: { st: AiStatus | null; onChange: (s: AiStatus) => void; onClose: () => void }) {
  const [key, setKey] = useState('');
  const [test, setTest] = useState<{ ok: boolean; message: string; ms: number } | 'run' | null>(null);
  const [err, setErr] = useState('');
  const save = async (body: object) => {
    const r = await post('/api/ai', body);
    const j = await r.json();
    if (!r.ok) return setErr(j.error ?? String(r.status));
    setErr('');
    onChange(j);
    setTest(null);
  };
  const refresh = async () => onChange(await (await fetch('/api/ai')).json());
  const runTest = async () => {
    setTest('run');
    try {
      setTest(await (await post('/api/ai/test', {})).json());
    } catch (e) {
      setTest({ ok: false, message: (e as Error).message, ms: 0 });
    }
  };
  if (!st) return <div className="conn-page">{tr('Checking…', '正在检查…')}</div>;
  const c = st.claude;
  return (
    <div className="conn-page">
      <section>
        <h4>{tr('How to connect', '用哪种方式连接')}</h4>
        <div className="rcards" role="radiogroup">
          {PREFS.map(([v, l, d]) => (
            <label key={v} className={`rc${st.pref === v ? ' on' : ''}`}>
              <input type="radio" name="pref" checked={st.pref === v} onChange={() => save({ pref: v })} />
              <span>
                <b>{l}</b>
                <small>{d}</small>
              </span>
            </label>
          ))}
        </div>
      </section>

      {st.pref === 'compat' ? <CompatSection st={st} save={save} refresh={refresh} /> : null}
      {st.pref === 'agent' ? <AgentSection st={st} save={save} onChange={onChange} /> : null}
      {err ? (
        <div className="state bad">
          <Icon name="close" size={14} />
          <span>{err}</span>
        </div>
      ) : null}

      {st.pref === 'auto' || st.pref === 'claude-code' ? (
      <section>
        <h4>Claude Code</h4>
        {!c ? (
          <div className="state bad">
            <Icon name="close" size={14} />
            <span>
              {tr('No claude command on this computer. Install Claude Code from claude.com/claude-code, run ', '这台电脑上没找到 claude 命令。到 claude.com/claude-code 安装，在终端运行 ')}
              <code>claude</code>
              {tr(' once to sign in, then restart Cutroom.', ' 登录一次，再重开剪辑台。')}
            </span>
          </div>
        ) : c.loggedIn === false ? (
          <div className="state warn">
            <Icon name="warn" size={14} />
            <span>
              {tr('Installed but not signed in. Run ', '已安装，但还没登录。在终端运行 ')}
              <code>claude</code>
              {tr(' in a terminal and follow the prompts.', ' 按提示登录。')}
            </span>
          </div>
        ) : (
          <div className="state ok">
            <Icon name="check" size={14} />
            <span>
              {c.loggedIn ? tr('Signed in', '已登录') : tr('Installed', '已安装')}
              {c.method ? ` (${c.method}${c.plan ? ` · ${c.plan}` : ''})` : ''}
              {c.version ? tr(`, version ${c.version}`, `，版本 ${c.version}`) : ''}
            </span>
          </div>
        )}
        {c ? <div className="path" title={c.path}>{c.path}</div> : null}
      </section>
      ) : null}

      {st.pref === 'auto' || st.pref === 'anthropic' ? (
      <section>
        <h4>{tr('Claude API key', 'Claude API Key')}</h4>
        {st.key ? (
          <div className="state ok">
            <Icon name="check" size={14} />
            <span>
              {st.key.source === 'env' ? tr('From the ANTHROPIC_API_KEY variable: ', '来自环境变量 ANTHROPIC_API_KEY：') : tr('Saved: ', '已保存：')}
              <code>{st.key.masked}</code>
            </span>
            {st.key.source === 'file' ? (
              <button className="mini" onClick={() => save({ apiKey: null })}>
                {tr('Remove', '删除')}
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="keyrow">
          <input type="password" value={key} placeholder={tr('Paste a key starting with sk-ant-', '粘贴 sk-ant- 开头的 Key')} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
          <button
            className="btn"
            disabled={!key.trim()}
            onClick={async () => {
              await save({ apiKey: key.trim(), ...(st.pref === 'claude-code' ? { pref: 'auto' } : {}) });
              setKey('');
            }}
          >
            {tr('Save', '保存')}
          </button>
        </div>
        <p className="hint">{tr('The key stays on this computer in .editor/settings.json. It is never committed to git or shown in full.', 'Key 只存在这台电脑的 .editor/settings.json，不会进 git，也不会显示完整内容。')}</p>
      </section>
      ) : null}

      <section className="test">
        <button className="btn" onClick={runTest} disabled={test === 'run' || !st.provider}>
          {test === 'run' ? tr('Testing…', '测试中…') : tr('Test connection', '测试连接')}
        </button>
        {test && test !== 'run' ? (
          <span className={`state ${test.ok ? 'ok' : 'bad'}`}>
            <Icon name={test.ok ? 'check' : 'close'} size={14} />
            <span>
              {test.message}
              {test.ms ? tr(` (${(test.ms / 1000).toFixed(1)} s)`, `（${(test.ms / 1000).toFixed(1)} 秒）`) : ''}
            </span>
          </span>
        ) : !st.provider ? (
          <span className="hint">{st.pref === 'anthropic' ? tr('Save an API key above, or switch to the Claude Code login', '先在上面保存 API Key，或改用 Claude Code 登录') : st.pref === 'claude-code' ? tr('Install Claude Code and sign in first', '先安装并登录 Claude Code') : st.pref === 'compat' ? tr('Choose a provider, save its key and pick a model', '选好服务商，保存 Key，再选一个模型') : st.pref === 'agent' ? tr('Choose a subscription and install its CLI', '选一个订阅，并安装它的命令行工具') : tr('Sign in to Claude Code or save an API key first', '先登录 Claude Code 或保存 API Key')}</span>
        ) : null}
      </section>

      <p className="hint">{tr('The AI can only run Cutroom’s own commands (reading and editing this project’s storyboard). It cannot touch other files on your computer.', 'AI 只能运行剪辑台自己的命令（读写这个项目的分镜），不能动电脑上的其他文件。')}</p>
      <div className="conn-acts">
        <button className="primary" onClick={onClose} disabled={!st.provider}>
          {tr('Done', '完成')}
        </button>
      </div>
    </div>
  );
}

interface Pointing {
  refs: AiRef[];
  onRemoveRef: (key: string) => void;
  onClearRefs: () => void;
  armed: boolean;
  onArm: () => void;
  focusKey: number;
}

// Connection setup lives in Settings › AI; statusKey changes when that window closes
export function ChatPanel({ slug, context, where, refs, onRemoveRef, onClearRefs, armed, onArm, focusKey, onSettings, statusKey }: { slug: string; context: () => ChatContext; where: string; onSettings: () => void; statusKey: number } & Pointing) {
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [input, setInput] = useState('');
  const { hints } = usePrefs();
  const list = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const provider = status?.provider;

  useEffect(() => {
    fetch('/api/ai')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => undefined);
  }, [statusKey]);

  useEffect(() => {
    let alive = true;
    setItems([]);
    fetch(`/api/chat?slug=${slug}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setRunning(!!j.running);
        setItems((j.history ?? []).map((h: { role: 'user' | 'assistant'; text: string; refs?: string[]; tools?: { cmd: string; ok: boolean }[] }) => ({ role: h.role, text: h.text, refs: h.refs, tools: (h.tools ?? []).map((t, i) => ({ id: String(i), cmd: t.cmd, ok: t.ok })) })));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [slug]);

  // Conversation sticks to the newest message
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [items]);

  // The input grows with what is in it, up to about seven lines
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 168)}px`;
  }, [input]);

  // A new pointed-at reference puts the cursor in the input
  useEffect(() => {
    if (focusKey) ta.current?.focus();
  }, [focusKey, !!provider]);

  const patchLast = (fn: (it: Item) => Item) => setItems((xs) => (xs.length ? [...xs.slice(0, -1), fn(xs[xs.length - 1])] : xs));

  const send = async (text = input) => {
    const msg = text.trim();
    const sent = refs;
    if ((!msg && !sent.length) || running) return;
    setInput('');
    onClearRefs();
    setRunning(true);
    setItems((xs) => [...xs, { role: 'user', text: msg, refs: sent.map((r) => r.label), tools: [] }, { role: 'assistant', text: '', tools: [], pending: true }]);
    try {
      const r = await post('/api/chat', { slug, message: msg, refs: sent.map(({ label, detail }) => ({ label, detail })), context: context(), model: getPrefs().claudeModel || undefined });
      const reader = r.body!.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const e = JSON.parse(line);
          if (e.type === 'text') patchLast((it) => ({ ...it, text: it.text + e.delta }));
          else if (e.type === 'tool') patchLast((it) => ({ ...it, tools: [...it.tools, { id: e.id, cmd: e.cmd }] }));
          else if (e.type === 'tool_result') patchLast((it) => ({ ...it, tools: it.tools.map((t) => (t.id === e.id ? { ...t, ok: e.ok, out: e.out } : t)) }));
          else if (e.type === 'error') patchLast((it) => ({ ...it, error: e.message }));
        }
      }
    } catch (err) {
      patchLast((it) => ({ ...it, error: (err as Error).message }));
    }
    patchLast((it) => ({ ...it, pending: false }));
    setRunning(false);
  };

  const stop = () => post('/api/chat/stop', { slug });
  const [menu, setMenu] = useState(false);
  // A prompt from the library goes into the input with its first 【…】 selected, ready to type over
  const insertPrompt = (p: PromptItem) => {
    const text = tr(p.en, p.zh);
    setInput((cur) => (cur.trim() ? `${cur.trimEnd()}
${text}` : text));
    setMenu(false);
    requestAnimationFrame(() => {
      const el = ta.current;
      if (!el) return;
      el.focus();
      const from = el.value.length - text.length;
      const m = SLOT.exec(el.value.slice(from));
      if (m) el.setSelectionRange(from + m.index, from + m.index + m[0].length);
      else el.setSelectionRange(el.value.length, el.value.length);
    });
  };
  // Tab jumps to the next 【…】 still in the text
  const nextSlot = (el: HTMLTextAreaElement) => {
    const re = new RegExp(SLOT.source, 'g');
    const all = [...el.value.matchAll(re)];
    if (!all.length) return false;
    const m = all.find((x) => x.index! >= el.selectionEnd) ?? all[0];
    el.setSelectionRange(m.index!, m.index! + m[0].length);
    return true;
  };
  const fresh = async () => {
    await post('/api/chat/reset', { slug });
    setItems([]);
  };

  return (
    <div className="chat">
      <div className="chat-head">
        <button className={`conn${provider ? ' ok' : ' off'}`} onClick={onSettings} title={tr('AI connection (Settings)', 'AI 连接（设置）')}>
          <i />
          {status ? providerName(status) : tr('Checking', '检查中')}
          <Icon name="gear" size={13} />
        </button>
        <span className="grow" />
        <button className="mini" onClick={fresh} disabled={running || !items.length} title={tr('Clear the conversation and start fresh', '清空对话，开始新的上下文')}>
          {tr('New chat', '新对话')}
        </button>
      </div>
      <div className="chat-list" ref={list}>
        {status && !provider ? (
          <div className="chat-empty">
            <div className="chat-hello">
              <Icon name="sparkle" size={22} />
              <p>{tr('The AI isn’t connected yet. Use your Claude Code login, a Claude API key, or another model such as OpenAI, Gemini or DeepSeek.', 'AI 还没连接。可以用 Claude Code 登录、Claude API Key，或者 OpenAI、Gemini、DeepSeek 等其他模型。')}</p>
            </div>
            <button className="primary" onClick={onSettings}>
              {tr('Connect the AI', '连接 AI')}
            </button>
          </div>
        ) : !items.length ? (
          <div className="chat-empty">
            <div className="chat-hello">
              <Icon name="sparkle" size={22} />
              <p>{tr('Say what to change. Edits show up in the preview right away, and you can undo them.', '直接说要怎么改。改动马上出现在预览里，也能撤销。')}</p>
            </div>
            {hints ? (
              <div className="chat-tip">
                <kbd>Ctrl</kbd>
                <span>{tr('+ click anything (a scene, a caption, a spot in the preview, an effect, a setting) to point the AI at it, then say what you think.', '+ 点任何东西（段落、字幕、画面上某一点、特效、某个设置），就把它指给 AI，再说你的意见。')}</span>
              </div>
            ) : null}
            <div className="sugg">
              {FEATURED.map(([g, i]) => {
                const p = PROMPTS.find((x) => x.id === g)!.items[i];
                return (
                  <button key={`${g}${i}`} className="sugg-btn" onClick={() => insertPrompt(p)} disabled={!provider}>
                    <PromptText text={tr(p.en, p.zh)} />
                  </button>
                );
              })}
              <button className="sugg-more" onClick={() => setMenu(true)} disabled={!provider}>
                <Icon name="bulb" size={13} />
                {tr('More prompts', '更多提示词')}
              </button>
            </div>
          </div>
        ) : (
          items.map((it, i) =>
            it.role === 'user' ? (
              <div key={i} className="msg user">
                {it.refs?.length ? (
                  <div className="msg-refs">
                    {it.refs.map((r, k) => (
                      <span key={k} className="ref-chip">
                        <Icon name="target" size={11} />
                        {r}
                      </span>
                    ))}
                  </div>
                ) : null}
                {it.text}
              </div>
            ) : (
              <div key={i} className="msg bot">
                {it.tools.length ? (
                  <div className="tools">
                    {it.tools.map((t) => (
                      <div key={t.id} className={`tool-line${t.ok === false ? ' bad' : t.ok === undefined ? ' run' : ''}`} title={t.out}>
                        <span className="dot" />
                        {t.cmd}
                      </div>
                    ))}
                  </div>
                ) : null}
                {it.text ? (
                  <div className="txt">
                    <Rich text={it.text.trim()} />
                  </div>
                ) : null}
                {it.pending && !it.text ? <div className="typing">{it.tools.length ? tr('Editing…', '正在改…') : tr('Thinking…', '思考中…')}</div> : null}
                {it.error ? <div className="err">{it.error}</div> : null}
              </div>
            ),
          )
        )}
      </div>
      {provider || !status ? (
        <div className="chat-input">
          {hints ? <div className="ctx">{where}</div> : null}
          {refs.length ? (
            <div className="chat-refs">
              {refs.map((r) => (
                <span key={r.key} className="ref-chip" title={r.detail}>
                  <Icon name="target" size={11} />
                  {r.label}
                  <button onClick={() => onRemoveRef(r.key)} aria-label={tr('Remove', '移除')}>
                    <Icon name="close" size={10} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <div className="box">
            {menu ? <PromptMenu onPick={insertPrompt} onClose={() => setMenu(false)} /> : null}
            <textarea
              ref={ta}
              value={input}
              rows={2}
              placeholder={!provider ? tr('Checking the AI connection…', '正在检查 AI 连接…') : refs.length ? tr('What do you think about this?', '你觉得这里怎么样？要怎么改？') : tr('e.g. make the selected scene 3 s long and give it a warm look', '比如：把选中这段缩短到 3 秒，加个暖色滤镜')}
              disabled={!provider}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
                if (e.key === 'Tab' && !e.shiftKey && nextSlot(e.currentTarget)) e.preventDefault();
              }}
            />
            <button className={`prompt-btn${menu ? ' on' : ''}`} onClick={() => setMenu(!menu)} disabled={!provider} title={tr('Prompt library', '常用提示词')} aria-expanded={menu}>
              <Icon name="bulb" size={15} />
            </button>
            <button className={`pick-btn${armed ? ' on' : ''}`} onClick={onArm} title={tr('Point at something (or hold Ctrl and click)', '指向某个东西（或按住 Ctrl 点击）')} aria-pressed={armed}>
              <Icon name="target" size={15} />
            </button>
            {running ? (
              <button className="send stop" onClick={stop} title={tr('Stop', '停止')}>
                <Icon name="close" size={14} />
              </button>
            ) : (
              <button className="send" onClick={() => send()} disabled={(!input.trim() && !refs.length) || !provider} title={tr('Send (Enter)', '发送 (Enter)')}>
                <Icon name="up" size={16} />
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// The parts to fill in are highlighted instead of showing their brackets
const PromptText = ({ text }: { text: string }) => (
  <>
    {text.split(/(【[^】]*】)/).map((part, k) => (part.startsWith('【') ? <mark key={k}>{part.slice(1, -1)}</mark> : part))}
  </>
);

// Prompts by task; picking one fills the input
function PromptMenu({ onPick, onClose }: { onPick: (p: PromptItem) => void; onClose: () => void }) {
  const [group, setGroup] = useState(() => {
    try {
      return localStorage.getItem('cutroom-prompt-group') || PROMPTS[0].id;
    } catch {
      return PROMPTS[0].id;
    }
  });
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!box.current?.contains(t) && !t.closest('.prompt-btn')) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  const pick = (id: string) => {
    setGroup(id);
    try {
      localStorage.setItem('cutroom-prompt-group', id);
    } catch {
      // Not remembered
    }
  };
  const g = PROMPTS.find((x) => x.id === group) ?? PROMPTS[0];
  return (
    <div className="prompt-menu" ref={box} role="dialog" aria-label={tr('Prompt library', '常用提示词')}>
      <div className="pm-tabs" role="tablist">
        {PROMPTS.map((x) => (
          <button key={x.id} role="tab" aria-selected={x.id === g.id} className={x.id === g.id ? 'on' : undefined} onClick={() => pick(x.id)}>
            {nm(x)}
          </button>
        ))}
      </div>
      <div className="pm-list">
        {g.items.map((p, i) => (
          <button key={i} className="pm-item" onClick={() => onPick(p)}>
            <PromptText text={tr(p.en, p.zh)} />
          </button>
        ))}
      </div>
      <div className="pm-foot">{tr('Click to put it in the box; Tab jumps between the 【】 parts to fill in.', '点一下放进输入框；按 Tab 在要填的【】之间跳。')}</div>
    </div>
  );
}
