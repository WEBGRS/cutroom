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

const MODELS: [string, string][] = [
  ['', '默认模型'],
  ['opus', 'Opus'],
  ['sonnet', 'Sonnet'],
  ['haiku', 'Haiku'],
];

const SUGGEST = ['把选中这段缩短一点', '给所有图片加慢推效果', '字幕改成描边样式，放大一点', '在最前面加一个标题卡'];

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

// Inline `code` spans; the rest stays plain text
function Rich({ text }: { text: string }) {
  const parts = text.split(/(`[^`\n]+`)/g);
  return (
    <>
      {parts.map((s, i) => (s.startsWith('`') && s.endsWith('`') && s.length > 2 ? <code key={i}>{s.slice(1, -1)}</code> : <React.Fragment key={i}>{s}</React.Fragment>))}
    </>
  );
}

export function ChatPanel({ slug, context, where }: { slug: string; context: () => ChatContext; where: string }) {
  const [items, setItems] = useState<Item[]>([]);
  const [provider, setProvider] = useState<string | null | undefined>(undefined);
  const [running, setRunning] = useState(false);
  const [input, setInput] = useState('');
  const [model, setModel] = useState(() => store.get('vs-chat-model'));
  const list = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let alive = true;
    setItems([]);
    fetch(`/api/chat?slug=${slug}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        setProvider(j.provider);
        setRunning(!!j.running);
        setItems((j.history ?? []).map((h: { role: 'user' | 'assistant'; text: string; tools?: { cmd: string; ok: boolean }[] }) => ({ role: h.role, text: h.text, tools: (h.tools ?? []).map((t, i) => ({ id: String(i), cmd: t.cmd, ok: t.ok })) })));
      })
      .catch(() => alive && setProvider(null));
    return () => {
      alive = false;
    };
  }, [slug]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [items]);

  const patchLast = (fn: (it: Item) => Item) => setItems((xs) => (xs.length ? [...xs.slice(0, -1), fn(xs[xs.length - 1])] : xs));

  const send = async (text = input) => {
    const msg = text.trim();
    if (!msg || running) return;
    setInput('');
    setRunning(true);
    setItems((xs) => [...xs, { role: 'user', text: msg, tools: [] }, { role: 'assistant', text: '', tools: [], pending: true }]);
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, message: msg, context: context(), model }) });
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

  const stop = () => fetch('/api/chat/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug }) });
  const fresh = async () => {
    await fetch('/api/chat/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug }) });
    setItems([]);
  };

  return (
    <div className="chat">
      <div className="chat-head">
        <span className="chat-title">AI 剪辑助手</span>
        {provider ? <span className="kind">{provider === 'claude-code' ? 'Claude Code' : 'API'}</span> : null}
        <span className="grow" />
        {provider === 'claude-code' ? (
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
        <button className="mini" onClick={fresh} disabled={running || !items.length} title="清空对话，开始新的上下文">
          新对话
        </button>
      </div>
      <div className="chat-list" ref={list}>
        {provider === null ? (
          <div className="chat-empty">
            <p>没找到可用的 AI。</p>
            <p>
              安装并登录 Claude Code（<code>claude</code> 命令）后重启编辑器；或者设置环境变量 <code>ANTHROPIC_API_KEY</code>。
            </p>
          </div>
        ) : !items.length ? (
          <div className="chat-empty">
            <p>直接说要怎么改，改动会马上出现在预览里，也能撤销。</p>
            <div className="sugg">
              {SUGGEST.map((s) => (
                <button key={s} className="chip-btn" onClick={() => send(s)} disabled={!provider}>
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
      <div className="chat-input">
        <div className="ctx">{where}</div>
        <div className="box">
          <textarea
            ref={ta}
            value={input}
            rows={2}
            placeholder={provider ? '比如：把 price 这段的终点提前一秒，加个暖色滤镜' : ''}
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
    </div>
  );
}
