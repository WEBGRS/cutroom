import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chatLoop, listModels, pickModel, ping, trimHistory, type Conn } from '../src/compat';

// A tiny OpenAI-compatible server: streams a tool call in fragments, then a reply
function mock(): Promise<{ base: string; bodies: any[]; close: () => void }> {
  const bodies: any[] = [];
  const chunk = (res: http.ServerResponse, delta: object, finish: string | null = null) => res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      if (req.headers.authorization !== 'Bearer k') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'bad key' } }));
      }
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ id: 'text-embedding-x', created: 9 }, { id: 'models/chat-b', created: 2 }, { id: 'chat-a', created: 1 }] }));
      }
      const b = JSON.parse(body);
      bodies.push(b);
      if (!b.stream) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ model: b.model, choices: [{ message: { content: 'OK' } }] }));
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (b.messages.at(-1).role === 'user') {
        chunk(res, { reasoning_content: 'think' });
        const s = JSON.stringify({ args: ['set', 'intro', 'fx.look', '"cool"'] });
        chunk(res, { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'editor', arguments: '' } }] });
        for (let i = 0; i < s.length; i += 5) chunk(res, { tool_calls: [{ index: 0, function: { arguments: s.slice(i, i + 5) } }] });
        chunk(res, {}, 'tool_calls');
      } else {
        chunk(res, { content: 'Done, ' });
        chunk(res, { content: 'intro is cool.' }, 'stop');
      }
      res.end('data: [DONE]\n\n');
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, bodies, close: () => server.close() })));
}

test('model list: chat models only, newest first, picked sensibly', async () => {
  const m = await mock();
  try {
    const c: Conn = { preset: 'custom', base: m.base, model: '', key: 'k' };
    const ids = await listModels(c);
    assert.deepEqual(ids, ['chat-b', 'chat-a']);
    assert.equal(pickModel(ids, 'chat-a', 'chat-b'), 'chat-a', 'keeps the chosen one');
    assert.equal(pickModel(ids, 'gone', 'chat-a'), 'chat-a', 'falls back to the hint');
    assert.equal(pickModel(ids, 'gone', 'also-gone'), 'chat-b', 'then the newest');
    await assert.rejects(listModels({ ...c, key: 'wrong' }), (e: Error & { status?: number }) => e.status === 401 && /bad key/.test(e.message));
    assert.equal(await ping({ ...c, model: 'chat-a' }), 'chat-a');
  } finally {
    m.close();
  }
});

test('tool loop: fragments joined, tool run, reasoning sent back only within the turn', async () => {
  const m = await mock();
  try {
    const ran: string[][] = [];
    let text = '';
    const out = await chatLoop({
      c: { preset: 'custom', base: m.base, model: 'chat-a', key: 'k' },
      system: 'sys',
      history: [],
      prompt: 'make intro cool',
      toolDescription: 'run',
      run: async (a) => {
        ran.push(a);
        return { ok: true, out: 'intro.fx.look: — → cool' };
      },
      onText: (s) => (text += s),
      onTool: () => undefined,
      onToolResult: () => undefined,
      signal: new AbortController().signal,
    });
    assert.deepEqual(ran, [['set', 'intro', 'fx.look', '"cool"']]);
    assert.equal(text, 'Done, intro is cool.');
    const second = m.bodies[1].messages;
    assert.equal(second[0].role, 'system');
    assert.equal(second.at(-2).reasoning_content, 'think', 'reasoning goes back during the tool loop');
    assert.equal(second.at(-1).tool_call_id, 'call_1');
    assert.ok(m.bodies.every((b) => b.tools?.[0]?.function?.name === 'editor'));
    assert.deepEqual(out.map((x) => x.role), ['user', 'assistant', 'tool', 'assistant']);
    assert.ok(out.every((x) => !('reasoning_content' in x)), 'not kept for later turns');
  } finally {
    m.close();
  }
});

test('history is trimmed only at a user message', () => {
  const msgs = [
    { role: 'user' },
    { role: 'assistant', tool_calls: [{ id: 'a' }] },
    { role: 'tool', tool_call_id: 'a' },
    { role: 'assistant' },
    { role: 'user' },
    { role: 'assistant', tool_calls: [{ id: 'b' }] },
    { role: 'tool', tool_call_id: 'b' },
    { role: 'assistant' },
  ];
  assert.deepEqual(trimHistory(msgs, 5).map((x) => x.role), ['user', 'assistant', 'tool', 'assistant']);
  assert.equal(trimHistory(msgs, 20).length, 8);
});
