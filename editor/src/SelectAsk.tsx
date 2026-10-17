// Select text anywhere in the editor (a field, a caption, an AI reply) and hand it to the AI chat with where it came from
import React, { useEffect, useState } from 'react';
import { tr } from './i18n';
import { resolvePick, type AiRef, type PickContext } from './pick';

interface Pending {
  x: number;
  y: number;
  below: boolean;
  text: string;
  el: Element;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// The selected text and the element it is in: the selection inside a text field, or a selection on the page
function current(): { text: string; el: Element; rect: DOMRect | null } | null {
  const a = document.activeElement;
  if (a instanceof HTMLTextAreaElement || (a instanceof HTMLInputElement && ['text', 'search', 'url', ''].includes(a.type))) {
    const s = a.selectionStart ?? 0;
    const e = a.selectionEnd ?? 0;
    if (e > s) return { text: a.value.slice(s, e), el: a, rect: null };
  }
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  const node = r.commonAncestorContainer;
  const el = node instanceof Element ? node : node.parentElement;
  return el ? { text: sel.toString(), el, rect: r.getBoundingClientRect() } : null;
}

export function SelectAsk({ ctx, onAdd }: { ctx: () => PickContext; onAdd: (ref: AiRef) => void }) {
  const [p, setP] = useState<Pending | null>(null);
  useEffect(() => {
    const check = (ev?: MouseEvent) =>
      // Once the browser has settled the selection
      window.setTimeout(() => {
        const c = current();
        if (!c || !c.text.trim() || !c.el.closest('.app') || c.el.closest('.chat-input, .chat-refs, .sel-ask, .modal, .menu-pop')) return setP(null);
        const box = c.rect && c.rect.width ? c.rect : c.el.getBoundingClientRect();
        const x = c.rect && c.rect.width ? box.left + box.width / 2 : (ev?.clientX ?? box.left + 40);
        const top = c.rect && c.rect.width ? box.top : (ev?.clientY ?? box.top);
        const below = top < 48;
        setP({ x, y: below ? (c.rect && c.rect.width ? box.bottom : top + 18) : top, below, text: c.text.trim(), el: c.el });
      }, 0);
    const up = (e: MouseEvent) => check(e);
    const key = (e: KeyboardEvent) => (e.key === 'Escape' ? setP(null) : e.shiftKey || e.key === 'Shift' ? check() : undefined);
    const down = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest?.('.sel-ask')) setP(null);
    };
    const away = () => setP(null);
    window.addEventListener('mouseup', up);
    window.addEventListener('keyup', key);
    window.addEventListener('mousedown', down);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => {
      window.removeEventListener('mouseup', up);
      window.removeEventListener('keyup', key);
      window.removeEventListener('mousedown', down);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    };
  }, []);
  if (!p) return null;
  const add = () => {
    const text = p.text.length > 600 ? `${p.text.slice(0, 600)}…` : p.text;
    const reply = p.el.closest('.msg.bot');
    const where = reply ? null : resolvePick(p.el, p.x, p.y, ctx())?.ref;
    const quote = `「${clip(text.replace(/\s+/g, ' '), 14)}」`;
    onAdd(
      reply
        ? { key: `sel:reply:${text.slice(0, 60)}`, label: tr(`${quote} · AI reply`, `${quote} · AI 回复`), detail: `The user quoted this part of your earlier reply: "${text}"` }
        : { key: `sel:${where?.key ?? ''}:${text.slice(0, 60)}`, label: `${quote}${where ? ` · ${where.label}` : ''}`, detail: `${where ? `${where.detail} ` : ''}The user selected this text${where ? ' there' : ' in the editor'}: "${text}"` },
    );
    window.getSelection()?.removeAllRanges();
    setP(null);
  };
  return (
    <button className={`sel-ask${p.below ? ' below' : ''}`} style={{ left: p.x, top: p.y }} onMouseDown={(e) => e.preventDefault()} onClick={add}>
      {tr('Add to chat', '添加到对话')}
    </button>
  );
}
