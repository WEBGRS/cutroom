"""Builds the sound-effect library: public/sfx/lib/*.ogg and src/fx/sounds.ts.

Kenney packs (CC0) are downloaded once into .scratch/kenney; the rest are synthesized here.
Usage: python tools/build_sfx.py
"""
import io, json, math, os, re, subprocess, sys, urllib.request, wave, zipfile
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'sfx', 'lib')
CACHE = os.path.join(ROOT, '.scratch', 'kenney')
SR = 44100

PACKS = {
    'interface': 'interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds',
    'impact': 'impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds',
    'digital': 'digital-audio/216eac4753-1677590265/kenney_digital-audio',
    'ui': 'ui-audio/490d233f68-1677590494/kenney_ui-audio',
    'scifi': 'sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds',
}

# id, English, Chinese, category, source: ('kenney', pack, file stem) or ('synth', fn)
LIBRARY = [
    ('whoosh', 'Whoosh', '嗖', 'transition', ('synth', 'whoosh')),
    ('whoosh-short', 'Quick whoosh', '短嗖声', 'transition', ('synth', 'whoosh_short')),
    ('whoosh-long', 'Long whoosh', '长嗖声', 'transition', ('synth', 'whoosh_long')),
    ('swoosh-up', 'Swoosh up', '上扬扫过', 'transition', ('synth', 'swoosh_up')),
    ('swoosh-down', 'Swoosh down', '下沉扫过', 'transition', ('synth', 'swoosh_down')),
    ('riser', 'Riser', '上升铺垫', 'transition', ('synth', 'riser')),
    ('riser-long', 'Long riser', '长上升铺垫', 'transition', ('synth', 'riser_long')),
    ('downlifter', 'Downlifter', '下坠', 'transition', ('synth', 'downlifter')),
    ('slide-open', 'Slide open', '滑开', 'transition', ('kenney', 'interface', 'maximize_004')),
    ('slide-close', 'Slide close', '收起', 'transition', ('kenney', 'interface', 'minimize_004')),
    ('boom', 'Boom', '低频轰', 'hit', ('synth', 'boom')),
    ('hit', 'Punchy hit', '重击', 'hit', ('synth', 'hit')),
    ('punch', 'Punch', '拳击', 'hit', ('kenney', 'impact', 'impactPunch_heavy_000')),
    ('punch-light', 'Light punch', '轻击', 'hit', ('kenney', 'impact', 'impactPunch_medium_001')),
    ('thud', 'Thud', '闷响', 'hit', ('kenney', 'impact', 'impactSoft_heavy_000')),
    ('wood', 'Wood knock', '木头敲击', 'hit', ('kenney', 'impact', 'impactWood_heavy_002')),
    ('metal', 'Metal clang', '金属撞击', 'hit', ('kenney', 'impact', 'impactMetal_heavy_001')),
    ('glass', 'Glass tap', '玻璃轻敲', 'hit', ('kenney', 'impact', 'impactGlass_light_002')),
    ('bell', 'Bell', '钟声', 'hit', ('kenney', 'impact', 'impactBell_heavy_000')),
    ('explosion', 'Explosion', '爆炸', 'hit', ('kenney', 'scifi', 'explosionCrunch_000')),
    ('click', 'Click', '点击', 'ui', ('kenney', 'interface', 'click_001')),
    ('click-soft', 'Soft click', '轻点击', 'ui', ('kenney', 'ui', 'click1')),
    ('mouse', 'Mouse click', '鼠标点击', 'ui', ('kenney', 'ui', 'mouseclick1')),
    ('tap', 'Tap', '轻触', 'ui', ('kenney', 'interface', 'select_003')),
    ('toggle', 'Toggle', '开关', 'ui', ('kenney', 'interface', 'toggle_002')),
    ('switch', 'Switch', '拨动', 'ui', ('kenney', 'interface', 'switch_003')),
    ('tick', 'Tick', '嘀嗒', 'ui', ('kenney', 'interface', 'tick_004')),
    ('scroll', 'Scroll', '滚动', 'ui', ('kenney', 'interface', 'scroll_002')),
    ('rollover', 'Hover', '悬停', 'ui', ('kenney', 'ui', 'rollover1')),
    ('pluck', 'Pluck', '拨弦', 'ui', ('kenney', 'interface', 'pluck_001')),
    ('drop', 'Drop', '落下', 'ui', ('kenney', 'interface', 'drop_002')),
    ('typing', 'Typing', '打字', 'ui', ('synth', 'typing')),
    ('shutter', 'Camera shutter', '快门', 'ui', ('synth', 'shutter')),
    ('ding', 'Ding', '叮', 'notify', ('synth', 'ding')),
    ('pop', 'Pop', '啵', 'notify', ('synth', 'pop')),
    ('success', 'Success', '成功', 'notify', ('kenney', 'interface', 'confirmation_001')),
    ('success-2', 'Success, bright', '成功（明亮）', 'notify', ('kenney', 'interface', 'confirmation_004')),
    ('notify', 'Notification', '通知', 'notify', ('kenney', 'interface', 'glass_001')),
    ('notify-2', 'Notification, soft', '通知（柔和）', 'notify', ('kenney', 'interface', 'glass_004')),
    ('error', 'Error', '错误', 'notify', ('kenney', 'interface', 'error_004')),
    ('question', 'Question', '疑问', 'notify', ('kenney', 'interface', 'question_002')),
    ('bong', 'Bong', '咚', 'notify', ('kenney', 'interface', 'bong_001')),
    ('open', 'Open', '打开', 'notify', ('kenney', 'interface', 'open_002')),
    ('close', 'Close', '关闭', 'notify', ('kenney', 'interface', 'close_002')),
    ('sparkle', 'Sparkle', '闪光', 'digital', ('synth', 'sparkle')),
    ('glitch', 'Glitch', '故障', 'digital', ('synth', 'glitch')),
    ('power-up', 'Power up', '能量提升', 'digital', ('kenney', 'digital', 'powerUp5')),
    ('level-up', 'Level up', '升级', 'digital', ('kenney', 'digital', 'powerUp2')),
    ('blip', 'Blip', '哔', 'digital', ('kenney', 'digital', 'pepSound1')),
    ('two-tone', 'Two tone', '双音', 'digital', ('kenney', 'digital', 'twoTone1')),
    ('three-tone', 'Three tone', '三音', 'digital', ('kenney', 'digital', 'threeTone1')),
    ('phaser-up', 'Phaser up', '相位上扬', 'digital', ('kenney', 'digital', 'phaserUp3')),
    ('phaser-down', 'Phaser down', '相位下降', 'digital', ('kenney', 'digital', 'phaserDown2')),
    ('laser', 'Laser', '激光', 'digital', ('kenney', 'digital', 'laser4')),
    ('zap', 'Zap', '电击', 'digital', ('kenney', 'digital', 'zap1')),
    ('computer', 'Computer noise', '电脑运算', 'digital', ('kenney', 'scifi', 'computerNoise_001')),
    ('force-field', 'Force field', '力场', 'digital', ('kenney', 'scifi', 'forceField_001')),
    ('door', 'Sci-fi door', '科幻门', 'digital', ('kenney', 'scifi', 'doorOpen_001')),
]

CATS = [('transition', 'Transitions', '转场'), ('hit', 'Hits', '冲击'), ('ui', 'Clicks & typing', '点击与打字'), ('notify', 'Notifications', '提示音'), ('digital', 'Digital', '电子音')]


# ---------- synthesis ----------
rng = np.random.default_rng(7)
t_ = lambda d: np.arange(int(SR * d)) / SR


def lowpass(x, cutoff):
    """One-pole low-pass with a per-sample cutoff (Hz)."""
    a = 1 - np.exp(-2 * np.pi * np.asarray(cutoff, dtype=float) / SR)
    a = np.broadcast_to(a, x.shape)
    y = np.zeros_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += a[i] * (x[i] - acc)
        y[i] = acc
    return y


def bell(n, peak=0.5, sharp=2.0):
    k = np.linspace(0, 1, n)
    return np.where(k < peak, (k / peak) ** sharp, ((1 - k) / (1 - peak)) ** (sharp * 0.8))


def svf_band(x, fc, q):
    """State-variable band-pass with a per-sample centre frequency."""
    fc = np.broadcast_to(np.asarray(fc, dtype=float), x.shape)
    f = 2 * np.sin(np.pi * np.minimum(fc, SR / 6) / SR)
    damp = 1 / q
    lo = bp = 0.0
    y = np.zeros_like(x)
    for i in range(len(x)):
        hp = x[i] - lo - damp * bp
        bp += f[i] * hp
        lo += f[i] * bp
        y[i] = bp
    return y


def arc(n, f0, fpeak, f1, peak):
    """Centre frequency that rises to fpeak at `peak` and settles at f1."""
    k = np.linspace(0, 1, n)
    up = f0 * (fpeak / f0) ** np.clip(k / peak, 0, 1)
    down = fpeak * (f1 / fpeak) ** np.clip((k - peak) / (1 - peak), 0, 1)
    return np.where(k < peak, up, down)


def noise_sweep(d, f0, fpeak, f1=None, peak=0.5, q=2.5, pan=True):
    n = int(SR * d)
    fc = arc(n, f0, fpeak, f1 if f1 is not None else f0, peak)
    body = svf_band(rng.standard_normal(n), fc, q) + 0.5 * svf_band(rng.standard_normal(n), fc * 1.9, q * 1.4)
    air = svf_band(rng.standard_normal(n), np.minimum(fc * 4, 12000), 1.2) * 0.25
    x = (body + air) * bell(n, peak, 2.2)
    if not pan:
        return x
    # Pass from left to right
    k = np.linspace(0, 1, n)
    th = (0.15 + 0.7 * k) * np.pi / 2
    return np.stack([x * np.cos(th), x * np.sin(th)], 1)


def whoosh():
    return noise_sweep(0.7, 350, 2600, 500, 0.55)


def whoosh_short():
    return noise_sweep(0.35, 500, 3600, 800, 0.6)


def whoosh_long():
    return noise_sweep(1.4, 220, 1800, 300, 0.6, q=3)


def swoosh_up():
    x = noise_sweep(0.6, 300, 6000, 6000, 0.85, pan=False)
    tone = 0.08 * np.sin(2 * np.pi * np.cumsum(np.geomspace(200, 1200, len(x))) / SR) * bell(len(x), 0.85)
    return x / (np.abs(x).max() + 1e-9) + tone


def swoosh_down():
    x = noise_sweep(0.6, 6000, 6000, 250, 0.02, pan=False)
    tone = 0.08 * np.sin(2 * np.pi * np.cumsum(np.geomspace(1200, 160, len(x))) / SR) * bell(len(x), 0.2)
    return x / (np.abs(x).max() + 1e-9) + tone


def riser(d=1.2):
    n = int(SR * d)
    k = np.linspace(0, 1, n)
    tone = sum(np.sin(2 * np.pi * np.cumsum(np.geomspace(f, f * 4, n)) / SR) / (i + 1) for i, f in enumerate([110, 220, 330]))
    nz = noise_sweep(d, 200, 7000, 7000, 0.98, q=1.5, pan=False)
    env = k ** 2.2
    env[-int(SR * 0.03):] *= np.linspace(1, 0, int(SR * 0.03))
    return (0.6 * tone + 0.8 * nz / (np.abs(nz).max() + 1e-9)) * env


def riser_long():
    return riser(2.4)


def downlifter():
    return riser(1.2)[::-1]


def boom():
    t = t_(1.6)
    f = 70 * np.exp(-t * 2.2) + 32
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.6)
    click = rng.standard_normal(len(t)) * np.exp(-t * 60) * 0.5
    return np.tanh(1.6 * (s + lowpass(click, 1800)))


def hit():
    t = t_(0.7)
    body = np.sin(2 * np.pi * np.cumsum(120 * np.exp(-t * 10) + 50) / SR) * np.exp(-t * 7)
    snap = lowpass(rng.standard_normal(len(t)), 5000) * np.exp(-t * 35)
    return np.tanh(2.0 * (body + 0.8 * snap))


def ding():
    t = t_(1.6)
    return sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t * dcy) for f, a, dcy in [(1318.5, 1, 3), (2637, 0.35, 5), (3955, 0.15, 8), (1975.5, 0.2, 4)])


def pop():
    t = t_(0.25)
    return np.sin(2 * np.pi * np.cumsum(900 * np.exp(-t * 25) + 300) / SR) * np.exp(-t * 22)


def sparkle():
    out = np.zeros(int(SR * 1.1))
    for i, f in enumerate([2093, 2637, 3136, 3951, 4699, 5274]):
        s = int(SR * 0.07 * i)
        t = t_(0.5)
        tone = np.sin(2 * np.pi * f * t) * np.exp(-t * 9) * (0.8 ** i)
        out[s:s + len(t)] += tone[: len(out) - s]
    return out


def glitch():
    out = np.zeros(int(SR * 0.6))
    pos = 0
    while pos < len(out):
        n = int(SR * rng.uniform(0.01, 0.05))
        f = rng.choice([110, 220, 440, 880, 1760, 3520])
        t = np.arange(n) / SR
        seg = np.sign(np.sin(2 * np.pi * f * t)) * 0.6 if rng.random() < 0.6 else rng.standard_normal(n) * 0.5
        out[pos:pos + n] += seg[: len(out) - pos]
        pos += n + int(SR * rng.uniform(0, 0.02))
    return out * bell(len(out), 0.1, 1)


def typing():
    out = np.zeros(int(SR * 1.2))
    t = 0.05
    while t < 1.1:
        n = int(SR * 0.03)
        click = lowpass(rng.standard_normal(n), 4000) * np.exp(-np.arange(n) / SR * 180)
        thock = np.sin(2 * np.pi * rng.uniform(180, 260) * np.arange(n) / SR) * np.exp(-np.arange(n) / SR * 90) * 0.4
        s = int(SR * t)
        out[s:s + n] += (click + thock) * rng.uniform(0.6, 1)
        t += rng.uniform(0.06, 0.14)
    return out


def shutter():
    out = np.zeros(int(SR * 0.35))
    for at, amp in [(0.0, 1), (0.09, 0.7)]:
        n = int(SR * 0.05)
        c = (lowpass(rng.standard_normal(n), 6000) - lowpass(rng.standard_normal(n), 400)) * np.exp(-np.arange(n) / SR * 90) * amp
        s = int(SR * at)
        out[s:s + n] += c
    return out


def write_wav(path, x):
    x = np.asarray(x, dtype=float)
    x = x / (np.abs(x).max() + 1e-9) * 0.7
    fade = min(len(x), int(SR * 0.005))
    x[-fade:] *= np.linspace(1, 0, fade)[:, None] if x.ndim == 2 else np.linspace(1, 0, fade)
    st = x if x.ndim == 2 else np.stack([x, x], 1)
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((st * 32767).astype('<i2').tobytes())


# ---------- assembly ----------
def kenney_file(pack, stem):
    base = os.path.join(CACHE, pack)
    if not os.path.isdir(base):
        os.makedirs(CACHE, exist_ok=True)
        url = f'https://kenney.nl/media/pages/assets/{PACKS[pack]}.zip'
        data = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})).read()
        zipfile.ZipFile(io.BytesIO(data)).extractall(base)
    for dp, _, fs in os.walk(base):
        for f in fs:
            if f == f'{stem}.ogg':
                return os.path.join(dp, f)
    raise SystemExit(f'missing {pack}/{stem}')


def ffmpeg(*args):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-y', *args], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(r.stderr)


def peak_db(path):
    r = subprocess.run(['ffmpeg', '-hide_banner', '-i', path, '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True)
    m = re.search(r'max_volume: (-?[\d.]+) dB', r.stderr)
    return float(m.group(1)) if m else 0.0


def duration(path):
    r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], capture_output=True, text=True)
    return float(r.stdout.strip())


def main():
    os.makedirs(OUT, exist_ok=True)
    tmp = os.path.join(ROOT, '.scratch', 'sfx-tmp')
    os.makedirs(tmp, exist_ok=True)
    rows = []
    for sid, en, zh, cat, src in LIBRARY:
        raw = os.path.join(tmp, f'{sid}.wav')
        if src[0] == 'synth':
            write_wav(raw, globals()[src[1]]())
        else:
            ffmpeg('-i', kenney_file(src[1], src[2]), '-ar', str(SR), '-ac', '2', raw)
        # Trim leading silence, then peak-normalise to -3 dBFS
        trimmed = os.path.join(tmp, f'{sid}-t.wav')
        ffmpeg('-i', raw, '-af', 'silenceremove=start_periods=1:start_threshold=-55dB', trimmed)
        gain = -3.0 - peak_db(trimmed)
        out = os.path.join(OUT, f'{sid}.ogg')
        ffmpeg('-i', trimmed, '-af', f'volume={gain:.2f}dB', '-c:a', 'libvorbis', '-q:a', '5', out)
        rows.append({'id': sid, 'en': en, 'zh': zh, 'cat': cat, 'dur': round(duration(out), 2), 'by': 'Kenney (CC0)' if src[0] == 'kenney' else 'Cutroom'})
        print(f'{sid:14} {rows[-1]["dur"]:5.2f}s  {rows[-1]["by"]}')
    ts = os.path.join(ROOT, 'src', 'fx', 'sounds.ts')
    with open(ts, 'w', encoding='utf-8', newline='\n') as f:
        f.write('// Generated by tools/build_sfx.py: the sound-effect library in public/sfx/lib\n')
        f.write('export interface SoundDef {\n  id: string;\n  en: string;\n  zh: string;\n  cat: string;\n  dur: number;\n  by: string;\n}\n\n')
        f.write('export const SOUND_CATS: { id: string; en: string; zh: string }[] = ' + json.dumps([{'id': c, 'en': e, 'zh': z} for c, e, z in CATS], ensure_ascii=False) + ';\n\n')
        f.write('export const SOUNDS: SoundDef[] = [\n' + ''.join(f'  {json.dumps(r, ensure_ascii=False)},\n' for r in rows) + '];\n\n')
        f.write("export const soundSrc = (id: string) => `sfx/lib/${id}.ogg`;\nexport const soundDef = (id: string) => SOUNDS.find((s) => s.id === id);\n")
    print(f'{len(rows)} sounds -> {OUT}')


if __name__ == '__main__':
    main()
