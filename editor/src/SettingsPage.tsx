import React, { useEffect, useState } from 'react';
import { Icon } from './icons';
import { LANG, nm, setLang, tr } from './i18n';
import { resetPrefs, setPrefs, usePrefs, type Prefs } from './prefs';
import { TRANSITION_LIST } from './catalog';
import { Connection, type AiStatus } from './ChatPanel';

export type SettingsTab = 'general' | 'editing' | 'preview' | 'export' | 'ai' | 'keys' | 'storage' | 'about';

const TABS: [SettingsTab, string, string, string][] = [
  ['general', 'General', '常规', 'gear'],
  ['editing', 'Editing', '剪辑', 'split'],
  ['preview', 'Preview', '预览', 'play'],
  ['export', 'Export', '导出', 'export'],
  ['ai', 'AI', 'AI', 'sparkle'],
  ['keys', 'Shortcuts', '快捷键', 'keyboard'],
  ['storage', 'Storage', '存储', 'folder'],
  ['about', 'About', '关于', 'info'],
];

interface AppInfo {
  version: string;
  exportDir: string;
  exportDefault: string;
  projectsDir: string;
  cache: { dir: string; bytes: number };
}

const post = (url: string, body: object) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function Row({ label, desc, children, stack }: { label: string; desc?: string; children: React.ReactNode; stack?: boolean }) {
  return (
    <div className={`srow${stack ? ' stack' : ''}`}>
      <div className="sl">
        <b>{label}</b>
        {desc ? <small>{desc}</small> : null}
      </div>
      <div className="sc">{children}</div>
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="sw" title={label}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <i />
    </label>
  );
}

function Num({ value, min, max, step, unit, onChange }: { value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Number(v);
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n / step) * step)));
    else setV(String(value));
  };
  return (
    <span className="snum">
      <input type="number" value={v} min={min} max={max} step={step} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      <span>{unit}</span>
    </span>
  );
}

const mb = (b: number) => (b < 1e6 ? `${Math.round(b / 1e3)} KB` : `${(b / 1e6).toFixed(1)} MB`);

const KEYS: [string, string, string][] = [
  ['Space', 'Play / pause', '播放 / 暂停'],
  ['← / →', 'One frame back / forward', '后退 / 前进一帧'],
  ['Shift + ← / →', 'One second back / forward', '后退 / 前进一秒'],
  ['Home / End', 'Go to the start / end', '跳到片头 / 片尾'],
  ['S, Ctrl + B, Ctrl + K', 'Split at the playhead', '在播放头处拆分'],
  ['Q / W', 'Trim the start / end of the scene to the playhead', '把这段的开头 / 结尾裁到播放头'],
  ['Ctrl + D', 'Duplicate the scene', '复制这一段'],
  ['Delete', 'Delete the selected scene, sound or overlay', '删除选中的段落、音效或叠加元素'],
  ['Ctrl + Alt + C / V', 'Copy / paste a scene’s effects', '复制 / 粘贴一段的特效'],
  ['Ctrl + Z', 'Undo', '撤销'],
  ['Ctrl + Shift + Z, Ctrl + Y', 'Redo', '重做'],
  ['N', 'Snapping on / off (hold Alt while dragging to skip it)', '吸附开关（拖动时按住 Alt 临时不吸）'],
  ['Esc', 'Deselect; close this window', '取消选中；关闭本窗口'],
  ['Ctrl + click', 'Point the AI at what you click', '把点到的东西指给 AI'],
  ['Enter / Shift + Enter', 'Send a chat message / new line', '发送消息 / 换行'],
  ['Ctrl + ,', 'Settings', '设置'],
];

export function SettingsPage({ tab, setTab, onClose, variant, setVariant }: { tab: SettingsTab; setTab: (t: SettingsTab) => void; onClose: () => void; variant: 'default' | 'clean'; setVariant: (v: 'default' | 'clean') => void }) {
  const prefs = usePrefs();
  const [app, setApp] = useState<AppInfo | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [dir, setDir] = useState('');
  const [err, setErr] = useState('');
  const set = (patch: Partial<Prefs>) => setPrefs(patch);

  useEffect(() => {
    fetch('/api/app')
      .then((r) => r.json())
      .then((j: AppInfo) => {
        setApp(j);
        setDir(j.exportDir);
      })
      .catch(() => undefined);
    fetch('/api/ai')
      .then((r) => r.json())
      .then(setAi)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input, textarea, select')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const appPost = async (url: string, body: object) => {
    const r = await post(url, body);
    const j = await r.json();
    if (!r.ok) return setErr(j.error ?? String(r.status));
    setErr('');
    setApp(j);
    setDir(j.exportDir);
  };

  let body: React.ReactNode = null;
  if (tab === 'general')
    body = (
      <>
        <Row label={tr('Interface language', '界面语言')} desc={tr('The video’s own language is chosen under the preview', '视频本身的语言在预览下方切换')}>
          <select value={LANG} onChange={(e) => setLang(e.target.value as 'en' | 'zh')}>
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
        </Row>
        <Row label={tr('Hints and tips', '提示和说明')} desc={tr('Help lines in the panels, plus tips and sample requests in the AI chat', '面板里的说明文字，以及 AI 对话里的提示和示例')}>
          <Switch on={prefs.hints} onChange={(v) => set({ hints: v })} label={tr('Hints and tips', '提示和说明')} />
        </Row>
        <Row label={tr('Restore defaults', '恢复默认设置')} desc={tr('Resets everything on this page except the language, AI connection and export folder', '恢复本页所有设置（界面语言、AI 连接、导出文件夹除外）')}>
          <button className="btn" onClick={resetPrefs}>
            {tr('Restore', '恢复')}
          </button>
        </Row>
      </>
    );
  else if (tab === 'editing')
    body = (
      <>
        <h4>{tr('New scenes', '新加的段落')}</h4>
        <Row label={tr('Image length', '图片时长')} desc={tr('How long an imported image or photo lasts', '导入的图片、照片默认持续多久')}>
          <Num value={prefs.imageSec} min={0.5} max={30} step={0.5} unit={tr('s', '秒')} onChange={(v) => set({ imageSec: v })} />
        </Row>
        <Row label={tr('Slow push-in on images', '图片自动慢推')} desc={tr('New images get a gentle Ken Burns move', '新加的图片带轻微的推近运镜')}>
          <Switch on={prefs.imagePush} onChange={(v) => set({ imagePush: v })} label={tr('Slow push-in on images', '图片自动慢推')} />
        </Row>
        <Row label={tr('Transition into new scenes', '新段落的转场')}>
          <select value={prefs.newTransition === 'fade' ? '' : prefs.newTransition} onChange={(e) => set({ newTransition: e.target.value || 'fade' })}>
            {TRANSITION_LIST.map((t) => (
              <option key={t.id || 'fade'} value={t.id}>
                {nm(t)}
              </option>
            ))}
          </select>
        </Row>
        <Row label={tr('Overlay length', '叠加元素时长')} desc={tr('Labels, arrows, lower thirds and text added from the library', '从素材库加的标签、箭头、字幕条、文字')}>
          <Num value={prefs.overlaySec} min={0.3} max={20} step={0.1} unit={tr('s', '秒')} onChange={(v) => set({ overlaySec: v })} />
        </Row>
        <h4>{tr('Timeline', '时间线')}</h4>
        <Row label={tr('Snapping', '吸附')} desc={tr('The playhead, trimmed edges, sound effects and overlays snap to cuts, recording marks, captions, beats and each other while you drag. N toggles it; hold Alt to drag freely.', '拖动播放头、裁剪边缘、音效和叠加元素时，自动吸到切点、录屏打点、字幕起点、节拍和彼此上。按 N 开关；按住 Alt 拖动可临时不吸。')}>
          <Switch on={prefs.snap} onChange={(v) => set({ snap: v })} label={tr('Snapping', '吸附')} />
        </Row>
        <Row label={tr('Follow the playhead', '播放时跟随播放头')} desc={tr('Scroll the timeline while playing so the playhead stays in view', '播放时时间线自动滚动，播放头一直在视野内')}>
          <Switch on={prefs.followPlayhead} onChange={(v) => set({ followPlayhead: v })} label={tr('Follow the playhead', '播放时跟随播放头')} />
        </Row>
        {(
          [
            ['overlays', tr('Overlays lane', '叠加轨'), tr('When and how long each overlay shows', '每个叠加元素的出现时间和时长')],
            ['effects', tr('Effects lane', '特效轨'), tr('Colour, lens and atmosphere effects per scene', '每段的调色、镜头和氛围效果')],
            ['camera', tr('Camera lane', '运镜轨'), tr('Zooms on recordings and camera moves', '录屏推近和运镜效果')],
            ['sfx', tr('Sound FX lane', '音效轨'), tr('Placed sound effects', '已放置的音效')],
          ] as [keyof Prefs['lanes'], string, string][]
        ).map(([k, l, d]) => (
          <Row key={k} label={l} desc={d}>
            <Switch on={prefs.lanes[k]} onChange={(v) => set({ lanes: { ...prefs.lanes, [k]: v } })} label={l} />
          </Row>
        ))}
      </>
    );
  else if (tab === 'preview')
    body = (
      <>
        <Row label={tr('Hide links and URLs', '隐藏网址和链接')} desc={tr('For Xiaohongshu, which bans links in videos. Applies to the preview and to exports.', '小红书不允许视频里出现网址。预览和导出都会去掉。')}>
          <Switch on={variant === 'clean'} onChange={(v) => setVariant(v ? 'clean' : 'default')} label={tr('Hide links and URLs', '隐藏网址和链接')} />
        </Row>
        <Row label={tr('Loop playback', '循环播放')} desc={tr('Start again from the beginning at the end', '播到结尾后从头再播')}>
          <Switch on={prefs.loop} onChange={(v) => set({ loop: v })} label={tr('Loop playback', '循环播放')} />
        </Row>
        <Row label={tr('Preview volume', '预览音量')} desc={tr('Only for listening here; exports are not affected', '只影响这里试听，不影响导出')}>
          <span className="svol">
            <input type="range" min={0} max={1} step={0.05} value={prefs.volume} onChange={(e) => set({ volume: Number(e.target.value) })} style={{ ['--b' as string]: `${prefs.volume * 100}%` }} />
            <span>{Math.round(prefs.volume * 100)}%</span>
          </span>
        </Row>
      </>
    );
  else if (tab === 'export')
    body = (
      <>
        <Row stack label={tr('Export folder', '导出文件夹')} desc={app && app.exportDir !== app.exportDefault ? tr(`Default: ${app.exportDefault}`, `默认：${app.exportDefault}`) : undefined}>
          <span className="sdir">
            <input value={dir} onChange={(e) => setDir(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && appPost('/api/app', { exportDir: dir })} spellCheck={false} />
            <button className="btn" disabled={!app || dir.trim() === app.exportDir} onClick={() => appPost('/api/app', { exportDir: dir })}>
              {tr('Save', '保存')}
            </button>
            <button className="btn" onClick={() => post('/api/app/open', { what: 'exports' })} title={tr('Open in Explorer', '在资源管理器中打开')}>
              <Icon name="folder" size={14} />
            </button>
            {app && app.exportDir !== app.exportDefault ? (
              <button className="btn" onClick={() => appPost('/api/app', { exportDir: null })}>
                {tr('Default', '默认')}
              </button>
            ) : null}
          </span>
        </Row>
        {err ? (
          <div className="state bad">
            <Icon name="close" size={14} />
            <span>{err}</span>
          </div>
        ) : null}
        <Row label={tr('Export button makes', '「导出」按钮导出')} desc={tr('The other formats stay in the menu next to it', '其他格式仍在旁边的下拉菜单里')}>
          <select value={prefs.exportPreset} onChange={(e) => set({ exportPreset: e.target.value as Prefs['exportPreset'] })}>
            <option value="mp4">{tr('MP4 video', 'MP4 视频')}</option>
            <option value="2x">{tr('MP4 at 2× resolution', 'MP4，2 倍分辨率')}</option>
            <option value="gif">{tr('GIF (half size)', 'GIF 动图（半尺寸）')}</option>
            <option value="prores">{tr('ProRes master (.mov)', 'ProRes 母带（.mov）')}</option>
          </select>
        </Row>
      </>
    );
  else if (tab === 'ai')
    body = (
      <>
        <Connection st={ai} onChange={setAi} onClose={onClose} />
        {ai?.claude ? (
          <Row label={tr('Claude Code model', 'Claude Code 模型')} desc={tr('Used when the AI runs through your Claude Code login', '通过 Claude Code 登录运行时用哪个模型')}>
            <select value={prefs.claudeModel} onChange={(e) => set({ claudeModel: e.target.value })}>
              <option value="">{tr('Default', '默认')}</option>
              <option value="opus">Opus</option>
              <option value="sonnet">Sonnet</option>
              <option value="haiku">Haiku</option>
            </select>
          </Row>
        ) : null}
      </>
    );
  else if (tab === 'keys')
    body = (
      <table className="skeys">
        <tbody>
          {KEYS.map(([k, en, zh]) => (
            <tr key={k}>
              <td>
                {k.split(', ').map((x, i) => (
                  <React.Fragment key={x}>
                    {i ? <span className="or">{tr('or', '或')}</span> : null}
                    <kbd>{x}</kbd>
                  </React.Fragment>
                ))}
              </td>
              <td>{tr(en, zh)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  else if (tab === 'storage')
    body = (
      <>
        <Row label={tr('Projects', '项目文件夹')} desc={app?.projectsDir}>
          <button className="btn" onClick={() => post('/api/app/open', { what: 'projects' })}>
            <Icon name="folder" size={14} />
            {tr('Open', '打开')}
          </button>
        </Row>
        <Row label={tr('Thumbnail and waveform cache', '缩略图和波形缓存')} desc={app ? tr(`${mb(app.cache.bytes)} · rebuilt automatically when needed`, `${mb(app.cache.bytes)} · 需要时会自动重新生成`) : undefined}>
          <span className="sdir">
            <button className="btn" onClick={() => post('/api/app/open', { what: 'cache' })} title={tr('Open in Explorer', '在资源管理器中打开')}>
              <Icon name="folder" size={14} />
            </button>
            <button className="btn" disabled={!app?.cache.bytes} onClick={() => appPost('/api/app/cache/clear', {})}>
              {tr('Clear', '清理')}
            </button>
          </span>
        </Row>
      </>
    );
  else
    body = (
      <div className="sabout">
        <p>
          <b>Cutroom</b> {app?.version ? `v${app.version}` : ''}
          <br />
          {tr('Open-source video editor, MIT licence.', '开源视频剪辑器，MIT 许可证。')}{' '}
          <a href="https://github.com/WEBGRS/cutroom" target="_blank" rel="noreferrer">
            github.com/WEBGRS/cutroom
          </a>
        </p>
        <h4>{tr('Built with and credits', '基于以下项目与素材')}</h4>
        <ul>
          <li>{tr('Rendering and preview: Remotion (Remotion License)', '渲染与预览：Remotion（Remotion 许可）')}</li>
          <li>{tr('Many effect designs adapted from HyperFrames by HeyGen (Apache-2.0)', '许多特效设计改编自 HeyGen 的 HyperFrames（Apache-2.0）')}</li>
          <li>{tr('Interface and impact sounds by Kenney, kenney.nl (CC0); whooshes, risers and booms made for Cutroom', '界面音和撞击音来自 Kenney（kenney.nl，CC0）；嗖声、上升铺垫、低频轰等由 Cutroom 合成')}</li>
          <li>{tr('Music by Kevin MacLeod, incompetech.com (CC BY 4.0): credit him when you publish', '音乐来自 Kevin MacLeod（incompetech.com，CC BY 4.0）：发布时需要署名')}</li>
          <li>{tr('Demo photos and clip from Wikimedia Commons (CC0 and public domain)', '示例照片和视频来自 Wikimedia Commons（CC0 与公有领域）')}</li>
          <li>{tr('Captions use Noto Sans SC (SIL Open Font License)', '字幕字体 Noto Sans SC（SIL 开源字体许可）')}</li>
        </ul>
      </div>
    );

  const cur = TABS.find((t) => t[0] === tab)!;
  return (
    <div className="modal-back" onPointerDown={onClose}>
      <div className="settings" role="dialog" aria-label={tr('Settings', '设置')} onPointerDown={(e) => e.stopPropagation()}>
        <nav className="set-nav">
          <h2>{tr('Settings', '设置')}</h2>
          {TABS.map(([k, en, zh, ic]) => (
            <button key={k} className={tab === k ? 'on' : undefined} onClick={() => setTab(k)}>
              <Icon name={ic} size={15} />
              {tr(en, zh)}
            </button>
          ))}
        </nav>
        <div className="set-body">
          <div className="set-head">
            <h3>{tr(cur[1], cur[2])}</h3>
            <button className="icon sm" onClick={onClose} title={tr('Close (Esc)', '关闭 (Esc)')}>
              <Icon name="close" size={15} />
            </button>
          </div>
          <div className="set-scroll">{body}</div>
        </div>
      </div>
    </div>
  );
}
