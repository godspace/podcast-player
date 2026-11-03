// Configuration
const CONFIG = {
    // Voices
    YANDEX_VOICES: [
        {id:'filipp',  name:'Filipp (муж)'},
        {id:'jane',    name:'Jane (жен)'},
        {id:'ermil',   name:'Ermil (муж)'},
        {id:'zahar',   name:'Zahar (муж)'},
        {id:'madirus', name:'Madirus (муж)'},
        {id:'oksana',  name:'Oksana (жен)'},
        {id:'alena',   name:'Alena (жен)'},
        {id:'omazh',   name:'Omazh (жен)'}
    ],
    
    DEFAULT_VOICES: ['filipp', 'jane'],
    
    EMOTIONS: [
        {id:'neutral', name:'Нейтрально'},
        {id:'good',    name:'Весело / Добро'},
        {id:'evil',    name:'Зло / Сердито'}
    ],
    
    // LLM Prompt
    LLM_PROMPT: `Ты — профессиональный сценарист подкастов. Создай текстовый подкаст в формате JSON.

══════════════ ТРЕБУЕМАЯ СТРУКТУРА JSON ══════════════
{
  "podcast": {
    "title": "Название подкаста",
    "subtitle": "Краткий подзаголовок",
    "language": "ru-RU",
    "estimated_duration_minutes": 15,
    "speakers": [
      { "id": "speaker_1", "name": "Первый голос" },
      { "id": "speaker_2", "name": "Второй голос" }
    ],
    "segments": [
      {
        "segment_id": 1,
        "title": "Название сегмента",
        "lines": [
          { "speaker": "speaker_1", "text": "Привет!", "emotion": "good", "pause_after_ms": 500 }
        ]
      }
    ]
  }
}

══════════════ ПРАВИЛА ══════════════
1. Используй РОВНО ДВУХ спикеров: "speaker_1" и "speaker_2"
2. Поле "name" необязательно
3. "emotion": "neutral", "good" или "evil"
4. "pause_after_ms": 300–1200
5. 5–10 сегментов
6. Текст ДЛЯ ОЗВУЧКИ: без маркдауна, чисел словами
7. 30–80 реплик
8. Живой диалог: вопросы, реакции

Тема: [УКАЖИТЕ ТЕМУ]

Верни ТОЛЬКО JSON.`,

    // Default proxy URL
    DEFAULT_PROXY_URL: 'https://yandex-tts-proxy.kozlov-stereo.workers.dev'
};

// State
const S = {
    podcast: null,
    lines: [],
    idx: -1,
    playing: false,
    paused: false,
    stopRequested: false,
    exporting: false,
    voiceMap: {},
    audioCache: {},
    audioEl: document.getElementById('audioEl')
};

// Helper
const $ = id => document.getElementById(id);