// Voice-over engines and their voices, shared by the server, the CLI and the UI

export type EngineId = 'builtin' | 'openai' | 'gemini' | 'qwen' | 'test';

export interface VoiceDef {
  id: string;
  en: string;
  zh: string;
  // Language the voice was made for; 'any' speaks both
  lang: 'zh' | 'en' | 'any';
  gender?: 'f' | 'm';
}

export interface EngineDef {
  id: EngineId;
  en: string;
  zh: string;
  noteEn: string;
  noteZh: string;
  // Key comes from the matching preset in Settings › AI (or its env variable)
  keyPreset?: string;
  voices: VoiceDef[];
  def: { zh: string; en: string };
}

// Built-in model: Kokoro v1.1-zh int8 through sherpa-onnx, speaker ids follow voices.bin order
export const KOKORO = {
  name: 'kokoro-int8-multi-lang-v1_1',
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2',
  bytes: 147_031_220,
  speakers: [
    'af_maple', 'af_sol', 'bf_vale',
    ...[1, 2, 3, 4, 5, 6, 7, 8, 17, 18, 19, 21, 22, 23, 24, 26, 27, 28, 32, 36, 38, 39, 40, 42, 43, 44, 46, 47, 48, 49, 51, 59, 60, 67, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 83, 84, 85, 86, 87, 88, 90, 92, 93, 94, 99].map((n) => `zf_${String(n).padStart(3, '0')}`),
    ...[9, 10, 11, 12, 13, 14, 15, 16, 20, 25, 29, 30, 31, 33, 34, 35, 37, 41, 45, 50, 52, 53, 54, 55, 56, 57, 58, 61, 62, 63, 64, 65, 66, 68, 69, 80, 81, 82, 89, 91, 95, 96, 97, 98, 100].map((n) => `zm_${String(n).padStart(3, '0')}`),
  ],
};

const kokoroVoices = (): VoiceDef[] =>
  KOKORO.speakers.map((id) => {
    const [kind, n] = id.split('_');
    if (kind === 'af') return { id, en: `${n[0].toUpperCase()}${n.slice(1)} (US)`, zh: `${n[0].toUpperCase()}${n.slice(1)}（美式）`, lang: 'en', gender: 'f' };
    if (kind === 'bf') return { id, en: `${n[0].toUpperCase()}${n.slice(1)} (UK)`, zh: `${n[0].toUpperCase()}${n.slice(1)}（英式）`, lang: 'en', gender: 'f' };
    const f = kind === 'zf';
    return { id, en: `${f ? 'Female' : 'Male'} ${Number(n)}`, zh: `${f ? '女声' : '男声'} ${Number(n)}`, lang: 'zh', gender: f ? 'f' : 'm' };
  });

const named = (list: [string, string, string, ('f' | 'm')?][]): VoiceDef[] => list.map(([id, en, zh, gender]) => ({ id, en, zh, lang: 'any', gender }));

export const ENGINES: EngineDef[] = [
  {
    id: 'builtin',
    en: 'Built-in voices',
    zh: '内置配音',
    noteEn: 'Free and offline. Downloads a 147 MB voice model once. 100 Chinese voices and 3 English ones.',
    noteZh: '免费、离线。第一次用要下载 147 MB 的语音模型。100 个中文音色，3 个英文音色。',
    voices: kokoroVoices(),
    def: { zh: 'zm_041', en: 'af_maple' },
  },
  {
    id: 'openai',
    en: 'OpenAI',
    zh: 'OpenAI',
    noteEn: 'gpt-4o-mini-tts. Uses the OpenAI key from Settings › AI. Paid per character.',
    noteZh: 'gpt-4o-mini-tts。用「设置 › AI」里的 OpenAI Key，按字数计费。',
    keyPreset: 'openai',
    voices: named([
      ['alloy', 'Alloy · neutral', 'Alloy · 中性'],
      ['ash', 'Ash · clear', 'Ash · 清晰', 'm'],
      ['ballad', 'Ballad · soft', 'Ballad · 柔和', 'm'],
      ['coral', 'Coral · warm', 'Coral · 温暖', 'f'],
      ['echo', 'Echo · calm', 'Echo · 沉稳', 'm'],
      ['fable', 'Fable · storyteller', 'Fable · 讲故事', 'm'],
      ['nova', 'Nova · bright', 'Nova · 明亮', 'f'],
      ['onyx', 'Onyx · deep', 'Onyx · 低沉', 'm'],
      ['sage', 'Sage · gentle', 'Sage · 温和', 'f'],
      ['shimmer', 'Shimmer · light', 'Shimmer · 轻快', 'f'],
      ['verse', 'Verse · expressive', 'Verse · 富有表现力', 'm'],
      ['marin', 'Marin · natural', 'Marin · 自然', 'f'],
      ['cedar', 'Cedar · natural', 'Cedar · 自然', 'm'],
    ]),
    def: { zh: 'coral', en: 'coral' },
  },
  {
    id: 'gemini',
    en: 'Google Gemini',
    zh: 'Google Gemini',
    noteEn: 'Gemini TTS. Uses the Gemini key from Settings › AI; Google AI Studio keys have a free tier.',
    noteZh: 'Gemini 语音合成。用「设置 › AI」里的 Gemini Key，Google AI Studio 的 Key 有免费额度。',
    keyPreset: 'gemini',
    voices: named([
      ['Kore', 'Kore · firm', 'Kore · 坚定'],
      ['Puck', 'Puck · upbeat', 'Puck · 活泼'],
      ['Charon', 'Charon · informative', 'Charon · 讲解'],
      ['Zephyr', 'Zephyr · bright', 'Zephyr · 明亮'],
      ['Fenrir', 'Fenrir · excitable', 'Fenrir · 兴奋'],
      ['Leda', 'Leda · youthful', 'Leda · 年轻'],
      ['Orus', 'Orus · firm', 'Orus · 坚定'],
      ['Aoede', 'Aoede · breezy', 'Aoede · 轻快'],
      ['Callirrhoe', 'Callirrhoe · easy-going', 'Callirrhoe · 随和'],
      ['Autonoe', 'Autonoe · bright', 'Autonoe · 明亮'],
      ['Enceladus', 'Enceladus · breathy', 'Enceladus · 气声'],
      ['Iapetus', 'Iapetus · clear', 'Iapetus · 清晰'],
      ['Umbriel', 'Umbriel · easy-going', 'Umbriel · 随和'],
      ['Algieba', 'Algieba · smooth', 'Algieba · 顺滑'],
      ['Despina', 'Despina · smooth', 'Despina · 顺滑'],
      ['Erinome', 'Erinome · clear', 'Erinome · 清晰'],
      ['Algenib', 'Algenib · gravelly', 'Algenib · 沙哑'],
      ['Rasalgethi', 'Rasalgethi · informative', 'Rasalgethi · 讲解'],
      ['Laomedeia', 'Laomedeia · upbeat', 'Laomedeia · 活泼'],
      ['Achernar', 'Achernar · soft', 'Achernar · 轻柔'],
      ['Alnilam', 'Alnilam · firm', 'Alnilam · 坚定'],
      ['Schedar', 'Schedar · even', 'Schedar · 平稳'],
      ['Gacrux', 'Gacrux · mature', 'Gacrux · 成熟'],
      ['Pulcherrima', 'Pulcherrima · forward', 'Pulcherrima · 直接'],
      ['Achird', 'Achird · friendly', 'Achird · 友好'],
      ['Zubenelgenubi', 'Zubenelgenubi · casual', 'Zubenelgenubi · 随意'],
      ['Vindemiatrix', 'Vindemiatrix · gentle', 'Vindemiatrix · 温柔'],
      ['Sadachbia', 'Sadachbia · lively', 'Sadachbia · 生动'],
      ['Sadaltager', 'Sadaltager · knowledgeable', 'Sadaltager · 博学'],
      ['Sulafat', 'Sulafat · warm', 'Sulafat · 温暖'],
    ]),
    def: { zh: 'Kore', en: 'Kore' },
  },
  {
    id: 'qwen',
    en: 'Qwen TTS (Alibaba Model Studio)',
    zh: '通义千问语音合成（阿里云百炼）',
    noteEn: 'qwen3-tts-flash, strong in Chinese and its dialects. Uses the Qwen key from Settings › AI.',
    noteZh: 'qwen3-tts-flash，中文和方言都好。用「设置 › AI」里的通义千问 Key。',
    keyPreset: 'qwen',
    voices: named([
      ['Cherry', 'Cherry · bright', 'Cherry · 阳光', 'f'],
      ['Ethan', 'Ethan · warm', 'Ethan · 温暖', 'm'],
      ['Serena', 'Serena · gentle', 'Serena · 温柔', 'f'],
      ['Chelsie', 'Chelsie · sweet', 'Chelsie · 甜美', 'f'],
      ['Nofish', 'Nofish · casual', 'Nofish · 随性', 'm'],
      ['Jennifer', 'Jennifer · cinematic', 'Jennifer · 电影感', 'f'],
      ['Ryan', 'Ryan · energetic', 'Ryan · 有活力', 'm'],
      ['Katerina', 'Katerina · mature', 'Katerina · 成熟', 'f'],
      ['Elias', 'Elias · lecturer', 'Elias · 讲解', 'm'],
      ['Dylan', 'Dylan · Beijing', 'Dylan · 北京话', 'm'],
      ['Jada', 'Jada · Shanghai', 'Jada · 上海话', 'f'],
      ['Sunny', 'Sunny · Sichuan', 'Sunny · 四川话', 'f'],
      ['Rocky', 'Rocky · Cantonese', 'Rocky · 粤语', 'm'],
      ['Kiki', 'Kiki · Cantonese', 'Kiki · 粤语', 'f'],
    ]),
    def: { zh: 'Cherry', en: 'Cherry' },
  },
];

// Silent stand-in for tests (CUTROOM_VOICE_TEST=1)
export const TEST_ENGINE: EngineDef = {
  id: 'test',
  en: 'Test tone',
  zh: '测试音',
  noteEn: 'A tone as long as the line would take to read.',
  noteZh: '按朗读时长生成的测试音。',
  voices: [{ id: 'tone', en: 'Tone', zh: '测试音', lang: 'any' }],
  def: { zh: 'tone', en: 'tone' },
};

export const engineDef = (id: string | undefined, test = false): EngineDef | undefined => (test && id === 'test' ? TEST_ENGINE : ENGINES.find((e) => e.id === id));

// Sentence used for a voice's preview
export const SAMPLE = { zh: '你好，这是 Cutroom 的配音预览。', en: 'Hi, this is a Cutroom voice preview.' };
