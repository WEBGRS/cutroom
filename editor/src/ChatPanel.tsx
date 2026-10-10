import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';

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
  tools: Tool[];
  pending?: boolean;
  error?: string;
}

interface AiStatus {
  provider: 'claude-code' | 'anthropic' | null;
  pref: 'auto' | 'claude-code' | 'anthropic';
  claude: { path: string; version: string | null; loggedIn: boolean | null; method: string | null; plan: string | null } | null;
  key: { source: 'env' | 'file'; masked: string } | null;
}

const MODELS: [string, string][] = [
  ['', '默认模型'],
  ['opus', 'Opus'],
  ['sonnet', 'Sonnet'],
  ['haiku', 'Haiku'],
];

const SUGGEST = ['把选中这段缩短一点', '给所有图片加慢推效果', '字幕改成描边样式，放大一点', '在最前面加一个标题卡'];

const PREFS: [AiStatus['pref'], string, string][] = [
  ['auto', '自动', '有 Claude Code 登录就用它，没有再用 API Key'],
  ['claude-code', 'Claude Code 登录', '用你的 Claude 订阅额度，不另外付费'],
  ['anthropic', 'API Key', '按用量付费，Key 在 console.anthropic.com 创建'],
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

const providerName = (s: AiStatus) => (s.provider === 'claude-code' ? 'Claude Code' : s.provider === 'anthropic' ? 'API Key' : '未连接');

function Connection({ st, onChange, onClose }: { st: AiStatus | null; onChange: (s: AiStatus) => void; onClose: () => void }) {
  const [key, setKey] = useState('');
  const [test, setTest] = useState<{ ok: boolean; message: string; ms: number } | 'run' | null>(null);
  const save = async (body: object) => {
    const r = await post('/api/ai', body);
    onChange(await r.json());
    setTest(null);
  };
  const runTest = async () => {
    setTest('run');
    try {
      setTest(await (await post('/api/ai/test', {})).json());
    } catch (e) {
      setTest({ ok: false, message: (e as Error).message, ms: 0 });
    }
  };
  if (!st) return <div className="conn-page">正在检查…</div>;
  const c = st.claude;
  return (
    <div className="conn-page">
      <section>
        <h4>用哪种方式连接</h4>
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

      <section>
        <h4>Claude Code</h4>
        {!c ? (
          <div className="state bad">
            <Icon name="close" size={14} />
            <span>
              这台电脑上没找到 claude 命令。到 claude.com/claude-code 安装，在终端运行 <code>claude</code> 登录一次，再重开剪辑台。
            </span>
          </div>
        ) : c.loggedIn === false ? (
          <div className="state warn">
            <Icon name="warn" size={14} />
            <span>
              已安装，但还没登录。在终端运行 <code>claude</code> 按提示登录。
            </span>
          </div>
        ) : (
          <div className="state ok">
            <Icon name="check" size={14} />
            <span>
              {c.loggedIn ? '已登录' : '已安装'}
              {c.method ? `（${c.method}${c.plan ? ` · ${c.plan}` : ''}）` : ''}
              {c.version ? `，版本 ${c.version}` : ''}
            </span>
          </div>
        )}
        {c ? <div className="path" title={c.path}>{c.path}</div> : null}
      </section>

      <section>
        <h4>API Key</h4>
        {st.key ? (
          <div className="state ok">
            <Icon name="check" size={14} />
            <span>
              {st.key.source === 'env' ? '来自环境变量 ANTHROPIC_API_KEY：' : '已保存：'}
              <code>{st.key.masked}</code>
            </span>
            {st.key.source === 'file' ? (
              <button className="mini" onClick={() => save({ apiKey: null })}>
                删除
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="keyrow">
          <input type="password" value={key} placeholder="粘贴 sk-ant- 开头的 Key" onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
          <button
            className="btn"
            disabled={!key.trim()}
            onClick={async () => {
              await save({ apiKey: key.trim(), ...(st.pref === 'claude-code' ? { pref: 'auto' } : {}) });
              setKey('');
            }}
          >
            保存
          </button>
        </div>
        <p className="hint">Key 只存在这台电脑的 .editor/settings.json，不会进 git，也不会显示完整内容。</p>
      </section>

      <section className="test">
        <button className="btn" onClick={runTest} disabled={test === 'run' || !st.provider}>
          {test === 'run' ? '测试中…' : '测试连接'}
        </button>
        {test && test !== 'run' ? (
          <span className={`state ${test.ok ? 'ok' : 'bad'}`}>
            <Icon name={test.ok ? 'check' : 'close'} size={14} />
            <span>
              {test.message}
              {test.ms ? `（${(test.ms / 1000).toFixed(1)} 秒）` : ''}
            </span>
          </span>
        ) : !st.provider ? (
          <span className="hint">{st.pref === 'anthropic' ? '先在上面保存 API Key，或改用 Claude Code 登录' : st.pref === 'claude-code' ? '先安装并登录 Claude Code' : '先登录 Claude Code 或保存 API Key'}</span>
        ) : null}
      </section>

      <p className="hint">AI 只能运行剪辑台自己的命令（读写这个项目的分镜），不能动电脑上的其他文件。</p>
      <div className="conn-acts">
        <button className="primary" onClick={onClose} disabled={!st.provider}>
          完成
        </button>
      </div>
    </div>
  );
}

export function ChatPanel({ slug, context, where }: { slug: string; context: () => ChatContext; where: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [settings, setSettings] = useState(false);
  const [running, setRunning] = useState(false);
  const [input, setInput] = useState('');
  const [model, setModel] = useState(() => store.get('vs-chat-model'));
  const list = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const provider = status?.provider;

  useEffect(() => {
    fetch('/api/ai')
      .then((r) => r.json())
      .then((s: AiStatus) => {
        setStatus(s);
        if (!s.provider) setSettings(true);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let alive = true;
    setItems([]);
    fetch(`/api/chat?slug=${slug}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setRunning(!!j.running);
        setItems((j.history ?? []).map((h: { role: 'user' | 'assistant'; text: string; tools?: { cmd: string; ok: boolean }[] }) => ({ role: h.role, text: h.text, tools: (h.tools ?? []).map((t, i) => ({ id: String(i), cmd: t.cmd, ok: t.ok })) })));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [slug]);

  // Conversation sticks to the newest message; settings open at the top
  useEffect(() => {
    list.current?.scrollTo({ top: settings ? 0 : list.current.scrollHeight });
  }, [items, settings]);

  const patchLast = (fn: (it: Item) => Item) => setItems((xs) => (xs.length ? [...xs.slice(0, -1), fn(xs[xs.length - 1])] : xs));

  const send = async (text = input) => {
    const msg = text.trim();
    if (!msg || running) return;
    setInput('');
    setRunning(true);
    setItems((xs) => [...xs, { role: 'user', text: msg, tools: [] }, { role: 'assistant', text: '', tools: [], pending: true }]);
    try {
      const r = await post('/api/chat', { slug, message: msg, context: context(), model });
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
  const fresh = async () => {
    await post('/api/chat/reset', { slug });
    setItems([]);
  };

  return (
    <div className="chat">
      <div className="chat-head">
        <button className={`conn${provider ? ' ok' : ' off'}${settings ? ' open' : ''}`} onClick={() => setSettings((x) => !x)} title="连接设置">
          <i />
          {status ? providerName(status) : '检查中'}
          <Icon name="gear" size={13} />
        </button>
        <span className="grow" />
        {provider === 'claude-code' && !settings ? (
          <select
            className="model"
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              store.set('vs-chat-model', e.target.value);
            }}
            title="模型"
          >
            {MODELS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        ) : null}
        {!settings ? (
          <button className="mini" onClick={fresh} disabled={running || !items.length} title="清空对话，开始新的上下文">
            新对话
          </button>
        ) : null}
      </div>
      <div className="chat-list" ref={list}>
        {settings ? (
          <Connection st={status} onChange={setStatus} onClose={() => setSettings(false)} />
        ) : !items.length ? (
          <div className="chat-empty">
            <div className="chat-hello">
              <Icon name="sparkle" size={22} />
              <p>直接说要怎么改。改动马上出现在预览里，也能撤销。</p>
            </div>
            <div className="sugg">
              {SUGGEST.map((s) => (
                <button key={s} className="sugg-btn" onClick={() => send(s)} disabled={!provider}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          items.map((it, i) =>
            it.role === 'user' ? (
              <div key={i} className="msg user">
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
                {it.pending && !it.text ? <div className="typing">{it.tools.length ? '正在改…' : '思考中…'}</div> : null}
                {it.error ? <div className="err">{it.error}</div> : null}
              </div>
            ),
          )
        )}
      </div>
      {!settings ? (
        <div className="chat-input">
          <div className="ctx">{where}</div>
          <div className="box">
            <textarea
              ref={ta}
              value={input}
              rows={2}
              placeholder={provider ? '比如：把选中这段缩短到 3 秒，加个暖色滤镜' : '先在上面连接 AI'}
              disabled={!provider}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            {running ? (
              <button className="send stop" onClick={stop} title="停止">
                <Icon name="close" size={14} />
              </button>
            ) : (
              <button className="send" onClick={() => send()} disabled={!input.trim() || !provider} title="发送 (Enter)">
                <Icon name="up" size={16} />
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
