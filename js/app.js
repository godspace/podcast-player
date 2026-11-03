document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
    loadLibrary();
});

// ============ INDEXEDDB HELPERS ============
const DB_NAME = 'PodcastPlayerDB';
const STORE_NAME = 'episodes';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            e.target.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveEpisode(episode) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(episode);
    await tx.done;
}

async function getAllEpisodes() {
    return new Promise((resolve) => {
        openDB().then(db => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const request = tx.objectStore(STORE_NAME).getAll();
            
            request.onsuccess = () => {
                let episodes = request.result;
                if (!Array.isArray(episodes)) {
                    console.warn('IndexedDB вернул не массив, используем []');
                    episodes = [];
                }
                try {
                    episodes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                } catch (e) {
                    console.error('Ошибка сортировки эпизодов:', e);
                    episodes = [];
                }
                resolve(episodes);
            };
            
            request.onerror = () => {
                console.error('Ошибка запроса к IndexedDB:', request.error);
                resolve([]);
            };
        }).catch(err => {
            console.error('Ошибка открытия базы данных:', err);
            resolve([]);
        });
    });
}

async function deleteEpisode(id) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    await tx.done;
}

async function getEpisode(id) {
    return new Promise((resolve, reject) => {
        openDB().then(db => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const request = tx.objectStore(STORE_NAME).get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        }).catch(reject);
    });
}

// ============ EVENT LISTENERS ============
function initEventListeners() {
    // Tabs
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
        });
    });

    // Upload
    $('dropzone').addEventListener('click', () => $('jsonFile').click());
    $('dropzone').addEventListener('dragover', handleDragOver);
    $('dropzone').addEventListener('dragleave', handleDragLeave);
    $('dropzone').addEventListener('drop', handleDrop);
    $('jsonFile').addEventListener('change', handleFileSelect);
    $('btnParseText').addEventListener('click', handleTextParse);

    // State change
    $('btnChangeSource').addEventListener('click', resetUploadState);
    $('btnOpenVoices').addEventListener('click', openVoiceModal);

    // Controls
    $('btnPlay').addEventListener('click', play);
    $('btnPause').addEventListener('click', pause);
    $('btnStop').addEventListener('click', stopPlayback);
    $('btnPrev').addEventListener('click', () => step(-1));
    $('btnNext').addEventListener('click', () => step(1));

    // Sliders
    $('rateSlider').addEventListener('input', updateRate);
    $('volSlider').addEventListener('input', updateVolume);

    // Export & Transcript
    $('btnExport').addEventListener('click', exportMp3);
    $('transcriptToggle').addEventListener('click', toggleTranscript);
    $('progressBg').addEventListener('click', handleProgressClick);
    $('btnCopyPrompt').addEventListener('click', copyPrompt);
}

// ============ UPLOAD & PARSING ============
function handleDragOver(e) { e.preventDefault(); $('dropzone').classList.add('drag'); }
function handleDragLeave(e) { e.preventDefault(); $('dropzone').classList.remove('drag'); }
function handleDrop(e) {
    e.preventDefault();
    $('dropzone').classList.remove('drag');
    if (e.dataTransfer.files.length) readFile(e.dataTransfer.files[0]);
}
function handleFileSelect(e) {
    if (e.target.files.length) readFile(e.target.files[0]);
}
function handleTextParse() {
    const text = $('jsonText').value.trim();
    if (!text) { toast('Введите JSON текст'); return; }
    try {
        loadPodcast(JSON.parse(text));
        showLoadedState('JSON из текста');
        // Запускаем предварительную генерацию
        preGeneratePodcast();
    } catch (err) {
        toast('Ошибка JSON: ' + err.message);
    }
}

function readFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
        try {
            loadPodcast(JSON.parse(e.target.result));
            showLoadedState(file.name);
            // Запускаем предварительную генерацию
            preGeneratePodcast();
        } catch (err) {
            toast('Ошибка JSON: ' + err.message);
        }
    };
    reader.readAsText(file);
}

function showLoadedState(sourceName) {
    $('uploadSection').classList.add('hidden');
    $('loadedSection').classList.remove('hidden');
    $('loadedInfo').textContent = `✅ Загружено: ${sourceName}`;
    $('exportStatus').textContent = 'Готов к экспорту';
}

function resetUploadState() {
    stopPlayback();
    S.preGenerating = false;
    S.podcast = null;
    S.lines = [];
    S.idx = -1;
    S.audioCache = {};
    pendingSynthesis.clear();
    $('jsonFile').value = '';
    $('jsonText').value = '';
    $('uploadSection').classList.remove('hidden');
    $('loadedSection').classList.add('hidden');
    $('voiceRowsModal').innerHTML = '<div class="empty-state"><p>Сначала загрузите сценарий</p></div>';
    updateProgress();
    $('curName').textContent = 'Нажмите ▶';
    $('curText').textContent = 'Загрузите сценарий для начала';
    $('curAvatar').textContent = '?';
    $('curAvatar').className = 'avatar speaker-1';
    $('statusBar').textContent = 'Готов к работе';
    $('statusBar').className = 'status';
}

// ============ PRE-GENERATION ============
async function preGeneratePodcast() {
    if (!S.lines.length) return;
    
    S.preGenerating = true;
    setStatus('Предварительная генерация: подготовка...', 'success');
    
    try {
        const blobs = [];
        
        for (let i = 0; i < S.lines.length; i++) {
            if (!S.preGenerating) {
                setStatus('Предварительная генерация отменена', 'error');
                return;
            }
            
            setStatus(`Предварительная генерация: реплика ${i + 1}/${S.lines.length}`, 'success');
            $('exportStatus').textContent = `Генерация: ${i + 1}/${S.lines.length}`;
            
            const blob = await ensureAudio(i);
            blobs.push(blob);
            
            $('progressBar').style.width = ((i + 1) / S.lines.length * 100) + '%';
        }
        
        // Сохраняем в библиотеку
        const episodeId = `ep_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const episode = {
            id: episodeId,
            title: S.podcast.title || 'Без названия',
            blobs: blobs, // Массив blob'ов по репликам
            mergedBlob: null, // Будет создан при экспорте
            durationSec: 0,
            createdAt: Date.now(),
            podcastData: S.podcast
        };
        
        await saveEpisode(episode);
        await loadLibrary();
        
        setStatus(`✅ Предварительная генерация завершена: ${S.lines.length} реплик`, 'success');
        $('exportStatus').textContent = '✅ Готов к воспроизведению и экспорту';
        toast('📚 Подкаст сохранён в библиотеку');
        
    } catch (err) {
        setStatus('Ошибка предварительной генерации: ' + err.message, 'error');
        toast('Ошибка генерации: ' + err.message);
    } finally {
        S.preGenerating = false;
    }
}

// ============ PODCAST LOADING ============
function loadPodcast(data) {
    stopPlayback();
    S.podcast = data.podcast || data;
    S.lines = [];
    S.audioCache = {};
    pendingSynthesis.clear();
    S.idx = -1;

    (S.podcast.segments || []).forEach(seg => {
        (seg.lines || []).forEach(l => {
            S.lines.push({ ...l, segmentId: seg.segment_id, segmentTitle: seg.title });
        });
    });

    renderVoiceRowsModal();
    renderTranscript();
    updateProgress();
    enableControls();
}

function renderVoiceRowsModal() {
    const box = $('voiceRowsModal');
    box.innerHTML = '';

    (S.podcast.speakers || []).forEach((sp, i) => {
        S.voiceMap[sp.id] = {
            voice: CONFIG.DEFAULT_VOICES[i % CONFIG.DEFAULT_VOICES.length],
            emotion: sp.emotion || 'neutral'
        };

        const row = document.createElement('div');
        row.className = 'voice-row-modal';

        const displayName = `Голос ${i + 1}`;

        row.innerHTML = `
            <div class="voice-label-modal">
                <div class="avatar speaker-${i + 1}">${i + 1}</div>
                <span>${displayName}</span>
            </div>
            <select id="voice_${sp.id}" class="voice-select"></select>
            <select id="emotion_${sp.id}" class="emotion-select"></select>
        `;

        const voiceSelect = row.querySelector(`#voice_${sp.id}`);
        CONFIG.YANDEX_VOICES.forEach(v => {
            const option = document.createElement('option');
            option.value = v.id;
            option.textContent = v.name;
            if (v.id === S.voiceMap[sp.id].voice) option.selected = true;
            voiceSelect.appendChild(option);
        });
        voiceSelect.addEventListener('change', () => {
            S.voiceMap[sp.id].voice = voiceSelect.value;
            invalidateCacheForSpeaker(sp.id);
        });

        const emotionSelect = row.querySelector(`#emotion_${sp.id}`);
        CONFIG.EMOTIONS.forEach(em => {
            const option = document.createElement('option');
            option.value = em.id;
            option.textContent = em.name;
            if (em.id === S.voiceMap[sp.id].emotion) option.selected = true;
            emotionSelect.appendChild(option);
        });
        emotionSelect.addEventListener('change', () => {
            S.voiceMap[sp.id].emotion = emotionSelect.value;
            invalidateCacheForSpeaker(sp.id);
        });

        box.appendChild(row);
    });
}

function invalidateCacheForSpeaker(speakerId) {
    S.lines.forEach((line, i) => {
        if (line.speaker === speakerId) {
            delete S.audioCache[i];
        }
    });
    toast('⚠️ Кэш очищен для изменённого голоса');
}

function renderTranscript() {
    const list = $('transcriptList');
    if (!list) return;
    list.innerHTML = '';
    let idx = 0;

    (S.podcast.segments || []).forEach(seg => {
        const header = document.createElement('div');
        header.className = 'segment-header';
        header.textContent = `Сегмент ${seg.segment_id}: ${seg.title}`;
        list.appendChild(header);

        (seg.lines || []).forEach(line => {
            const item = document.createElement('div');
            item.className = 'transcript-item';
            item.dataset.index = idx;

            const speakerIdx = getSpkIndex(line.speaker);

            item.innerHTML = `
                <div class="transcript-speaker">Голос ${speakerIdx + 1}</div>
                <div class="transcript-text">${line.text}</div>
            `;

            item.addEventListener('click', () => jumpTo(parseInt(item.dataset.index)));
            list.appendChild(item);
            idx++;
        });
    });
}

// ============ PLAYBACK ============
let lastStepTime = 0;

function play() {
    if (S.exporting || S.preGenerating) { 
        toast(S.preGenerating ? 'Идёт предварительная генерация...' : 'Дождитесь окончания экспорта'); 
        return; 
    }
    if (!S.lines.length) { toast('Сначала загрузите сценарий'); return; }
    if (S.paused) { S.audioEl.play(); S.paused = false; setStatus('Продолжение', 'success'); return; }
    if (S.playing) return;
    if (S.idx < 0) S.idx = 0;

    S.playing = true;
    S.paused = false;
    S.stopRequested = false;
    playCurrent();
}

function pause() {
    if (!S.playing || S.paused) return;
    S.audioEl.pause();
    S.paused = true;
    setStatus('Пауза');
}

function stopPlayback() {
    S.stopRequested = true;
    S.playing = false;
    S.paused = false;
    S.audioEl.pause();
    S.audioEl.currentTime = 0;
    if (!S.exporting && !S.preGenerating) setStatus('Остановлено');
    updateProgress();
}

function step(d) {
    const now = Date.now();
    if (now - lastStepTime < 300) return;
    lastStepTime = now;

    const n = S.idx + d;
    if (n < 0 || n >= S.lines.length) return;
    S.audioEl.pause();
    S.idx = n;
    displayLine();
    if (S.playing) { S.stopRequested = false; playCurrent(); }
}

function jumpTo(i) {
    if (S.exporting || S.preGenerating) { 
        toast(S.preGenerating ? 'Идёт предварительная генерация...' : 'Дождитесь окончания экспорта'); 
        return; 
    }
    if (i < 0 || i >= S.lines.length) return;
    S.audioEl.pause();
    S.idx = i;
    displayLine();
    if (S.playing) {
        S.stopRequested = false;
        playCurrent();
    } else {
        S.playing = true;
        S.paused = false;
        S.stopRequested = false;
        playCurrent();
    }
}

async function playCurrent() {
    if (S.stopRequested || S.idx >= S.lines.length) {
        S.playing = false;
        setStatus('Подкаст завершён 🎉', 'success');
        return;
    }

    displayLine();
    const line = S.lines[S.idx];

    try {
        setStatus('Говорит: Голос ' + (getSpkIndex(line.speaker) + 1), 'success');
        const blob = await ensureAudio(S.idx);
        if (S.stopRequested) return;

        S.audioEl.src = URL.createObjectURL(blob);
        S.audioEl.volume = parseFloat($('volSlider').value);
        await S.audioEl.play();

        S.audioEl.onended = async () => {
            if (S.stopRequested) return;
            await sleep(line.pause_after_ms || 400);
            if (!S.stopRequested) { S.idx++; playCurrent(); }
        };
    } catch (err) {
        setStatus('Ошибка: ' + err.message, 'error');
        toast('Ошибка воспроизведения: ' + err.message);
        S.playing = false;
    }
}

// ============ SYNTHESIS WITH DEDUPLICATION ============
const pendingSynthesis = new Map();

async function ensureAudio(i) {
    if (S.audioCache[i]) return S.audioCache[i];
    if (pendingSynthesis.has(i)) return pendingSynthesis.get(i);

    const line = S.lines[i];
    const map = S.voiceMap[line.speaker] || { voice: 'jane', emotion: 'neutral' };
    const speed = $('rateSlider').value;

    const promise = synthesize(line.text, map.voice, map.emotion, speed);
    pendingSynthesis.set(i, promise);

    try {
        const blob = await promise;
        S.audioCache[i] = blob;
        return blob;
    } finally {
        pendingSynthesis.delete(i);
    }
}

async function synthesize(text, voice, emotion, speed) {
    const url = $('proxyUrl').value.trim() || CONFIG.DEFAULT_PROXY_URL;
    const body = { text, voice, emotion, speed: String(speed), lang: 'ru-RU' };

    $('proxyStatus').textContent = '⏳ Запрос...';
    const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!r.ok) {
        const err = await r.text();
        throw new Error('Прокси вернул ' + r.status + ': ' + err);
    }
    $('proxyStatus').textContent = '✅ OK';
    return await r.blob();
}

// ============ UI UPDATES ============
function displayLine() {
    if (S.idx < 0 || S.idx >= S.lines.length) return;
    
    const line = S.lines[S.idx];
    const spIdx = getSpkIndex(line.speaker);

    const curNameEl = $('curName');
    const curAvatarEl = $('curAvatar');
    const curTextEl = $('curText');
    const curSegEl = $('curSeg');

    if (curNameEl) {
        curNameEl.textContent = `Голос ${spIdx + 1}`;
        curNameEl.className = 'speaker-name';
    }
    if (curAvatarEl) {
        curAvatarEl.className = `avatar speaker-${spIdx + 1}`;
        curAvatarEl.textContent = spIdx + 1;
    }
    if (curTextEl) {
        curTextEl.textContent = line.text;
    }
    if (curSegEl) {
        curSegEl.textContent = `Сегмент ${line.segmentId}: ${line.segmentTitle}`;
    }

    updateProgress();
    highlightTranscript();
}

function getSpkIndex(id) {
    const idx = (S.podcast?.speakers || []).findIndex(s => s.id === id);
    return idx >= 0 ? idx : 0;
}

function updateProgress() {
    const total = S.lines.length;
    const cur = S.idx + 1;
    $('progressBar').style.width = (total ? (cur / total * 100) : 0) + '%';
    $('progCurrent').textContent = `${cur} / ${total}`;
    $('progSegment').textContent = (S.idx >= 0 && S.idx < total) ? S.lines[S.idx].segmentTitle : '—';
}

function highlightTranscript() {
    const items = document.querySelectorAll('.transcript-item');
    items.forEach((el, i) => {
        el.classList.remove('active', 'played');
        if (i < S.idx) {
            el.classList.add('played');
        } else if (i === S.idx) {
            el.classList.add('active');
            if (!$('transcriptList').classList.contains('hidden')) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    });
}

function setStatus(msg, cls = '') {
    const s = $('statusBar');
    s.className = 'status ' + cls;
    s.textContent = msg;
}

function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

function enableControls() {
    ['btnPlay', 'btnPause', 'btnStop', 'btnPrev', 'btnNext', 'btnExport'].forEach(id => {
        $(id).disabled = false;
    });
}

function updateRate() { $('rateVal').textContent = $('rateSlider').value + 'x'; }
function updateVolume() { $('volVal').textContent = Math.round($('volSlider').value * 100) + '%'; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============ MODALS & HELPERS ============
function openVoiceModal() { $('voiceModal').classList.remove('hidden'); }
function closeVoiceModal() { $('voiceModal').classList.add('hidden'); }
function openSettingsModal() { $('settingsModal').classList.remove('hidden'); }
function closeSettingsModal() { $('settingsModal').classList.add('hidden'); }

function toggleTranscript() {
    const list = $('transcriptList');
    const btn = $('transcriptToggle');
    
    if (list.classList.contains('hidden')) {
        list.classList.remove('hidden');
        btn.innerHTML = 'Скрыть транскрипт ▲';
        setTimeout(() => {
            const activeItem = list.querySelector('.transcript-item.active');
            if (activeItem) {
                activeItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }, 50);
    } else {
        list.classList.add('hidden');
        btn.innerHTML = 'Показать весь транскрипт ▼';
    }
}

function scrollToSection(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
}

function handleProgressClick(e) {
    if (!S.lines.length || S.exporting || S.preGenerating) return;
    const r = $('progressBg').getBoundingClientRect();
    const p = (e.clientX - r.left) / r.width;
    jumpTo(Math.min(Math.floor(p * S.lines.length), S.lines.length - 1));
}

function copyPrompt() {
    navigator.clipboard.writeText(CONFIG.LLM_PROMPT)
        .then(() => toast('✅ Промпт скопирован'))
        .catch(() => toast('Ошибка копирования'));
}

// ============ LIBRARY (INDEXEDDB) ============
async function loadLibrary() {
    try {
        const episodes = await getAllEpisodes();
        renderLibrary(episodes);
    } catch (err) {
        console.error('Ошибка загрузки библиотеки:', err);
    }
}

function renderLibrary(episodes) {
    const container = $('libraryContainer');
    if (!container) return;

    if (episodes.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>Библиотека пуста. Загрузите первый подкаст!</p></div>';
        return;
    }

    container.innerHTML = episodes.map(ep => `
        <div class="library-item" data-id="${ep.id}">
            <div class="library-info">
                <div class="library-title">${ep.title}</div>
                <div class="library-meta">
                    <span>${ep.blobs ? ep.blobs.length + ' реплик' : '—'}</span>
                    <span>${formatBytes(ep.mergedBlob ? ep.mergedBlob.size : 0)}</span>
                    <span>${new Date(ep.createdAt).toLocaleDateString('ru-RU')}</span>
                </div>
            </div>
            <div class="library-actions">
                <button class="btn btn-small btn-primary" onclick="playFromLibrary('${ep.id}')">▶ Слушать</button>
                <button class="btn btn-small btn-secondary" onclick="downloadFromLibrary('${ep.id}')">💾 Скачать</button>
                <button class="btn btn-small btn-secondary" onclick="deleteFromLibrary('${ep.id}')">🗑 Удалить</button>
            </div>
        </div>
    `).join('');
}

function formatDuration(sec) {
    if (!sec) return '0:00';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatBytes(bytes) {
    if (!bytes) return '0 Б';
    if (bytes < 1024) return bytes + ' Б';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
    return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
}

async function playFromLibrary(id) {
    const episode = await getEpisode(id);
    if (!episode) {
        toast('Эпизод не найден');
        return;
    }

    loadPodcast(episode.podcastData);
    showLoadedState(`Библиотека: ${episode.title}`);

    // Кэшируем ВСЕ blob'ы из библиотеки
    if (episode.blobs && Array.isArray(episode.blobs)) {
        episode.blobs.forEach((blob, i) => {
            S.audioCache[i] = blob;
        });
    }

    S.idx = 0;
    displayLine(); // Обновляем транскрипт сразу
    play();

    toast(`▶ Воспроизведение: ${episode.title}`);
}

async function downloadFromLibrary(id) {
    const episode = await getEpisode(id);
    if (!episode) {
        toast('Эпизод не найден');
        return;
    }

    if (!episode.mergedBlob) {
        toast('MP3 ещё не создан. Нажмите "Экспорт в MP3" после открытия подкаста.');
        return;
    }

    const a = document.createElement('a');
    a.href = URL.createObjectURL(episode.mergedBlob);
    a.download = episode.title + '.mp3';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);

    toast(`💾 Скачано: ${episode.title}.mp3`);
}

async function deleteFromLibrary(id) {
    if (!confirm('Удалить этот подкаст из библиотеки?')) return;

    await deleteEpisode(id);
    await loadLibrary();
    toast('🗑 Подкаст удалён из библиотеки');
}

// ============ MP3 EXPORT ============
async function loadLame() {
    if (window.lamejs && window.lamejs.Mp3Encoder) return true;
    const cdns = [
        'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js',
        'https://unpkg.com/lamejs@1.2.1/lame.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js'
    ];
    for (const src of cdns) {
        try {
            await new Promise((res, rej) => {
                const s = document.createElement('script');
                s.src = src;
                s.onload = res;
                s.onerror = rej;
                document.head.appendChild(s);
            });
            if (window.lamejs && window.lamejs.Mp3Encoder) return true;
        } catch (e) { /* пробуем следующий */ }
    }
    return false;
}

function floatToInt16(f32) {
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) {
        const s = Math.max(-1, Math.min(1, f32[i]));
        i16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return i16;
}

function writeStr(view, off, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
}

function pcmToWavBlob(pcmBuffer, sampleRate) {
    const data = pcmBuffer.byteLength;
    const buf = new ArrayBuffer(44 + data);
    const v = new DataView(buf);
    writeStr(v, 0, 'RIFF');
    v.setUint32(4, 36 + data, true);
    writeStr(v, 8, 'WAVE');
    writeStr(v, 12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    writeStr(v, 36, 'data');
    v.setUint32(40, data, true);
    new Uint8Array(buf, 44).set(new Uint8Array(pcmBuffer));
    return new Blob([buf], { type: 'audio/wav' });
}

async function exportMp3() {
    if (!S.lines.length || S.exporting || S.preGenerating) return;
    stopPlayback();
    S.exporting = true;
    const btn = $('btnExport');
    btn.disabled = true;
    $('exportStatus').textContent = 'Склейка MP3...';

    const haveLame = await loadLame();
    if (!haveLame) toast('MP3-кодер недоступен — будет экспортирован WAV');

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const sr = ctx.sampleRate;
    const BLOCK = 1152;

    let encoder = null, mp3Parts = [], pcmChunks = [];
    if (haveLame) encoder = new lamejs.Mp3Encoder(1, sr, 128);

    const pushPcm = (i16) => {
        if (encoder) {
            for (let i = 0; i < i16.length; i += BLOCK) {
                const buf = encoder.encodeBuffer(i16.subarray(i, Math.min(i + BLOCK, i16.length)));
                if (buf.length) mp3Parts.push(new Uint8Array(buf));
            }
        } else {
            pcmChunks.push(i16);
        }
    };

    try {
        for (let i = 0; i < S.lines.length; i++) {
            setStatus(`Экспорт: реплика ${i + 1}/${S.lines.length}`, 'success');
            $('exportStatus').textContent = `Склейка: ${i + 1}/${S.lines.length}`;

            const blob = await ensureAudio(i);
            const ab = await blob.arrayBuffer();
            const audioBuf = await ctx.decodeAudioData(ab);

            pushPcm(floatToInt16(audioBuf.getChannelData(0)));

            const pauseMs = S.lines[i].pause_after_ms ?? 400;
            pushPcm(new Int16Array(Math.round(sr * pauseMs / 1000)));

            $('progressBar').style.width = ((i + 1) / S.lines.length * 100) + '%';
        }

        let outBlob, ext;
        if (encoder) {
            const end = encoder.flush();
            if (end.length) mp3Parts.push(new Uint8Array(end));
            outBlob = new Blob(mp3Parts, { type: 'audio/mp3' });
            ext = 'mp3';
        } else {
            const total = pcmChunks.reduce((s, c) => s + c.length, 0);
            const pcm = new Int16Array(total);
            let off = 0;
            for (const c of pcmChunks) { pcm.set(c, off); off += c.length; }
            outBlob = pcmToWavBlob(pcm.buffer, sr);
            ext = 'wav';
        }

        const title = (S.podcast.title || 'podcast')
            .replace(/[^\wа-яА-ЯёЁ\- ]/g, '')
            .trim()
            .replace(/\s+/g, '_') || 'podcast';
        const fname = `${title}.${ext}`;

        const a = document.createElement('a');
        a.href = URL.createObjectURL(outBlob);
        a.download = fname;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);

        const mb = (outBlob.size / 1048576).toFixed(1);
        setStatus(`✅ Экспорт завершён: ${fname} (${mb} МБ)`, 'success');
        $('exportStatus').textContent = `✅ ${fname} (${mb} МБ)`;
        toast('✅ Файл скачан: ' + fname);

        // Обновляем запись в библиотеке: добавляем mergedBlob
        const episodes = await getAllEpisodes();
        const currentEpisode = episodes.find(ep => 
            ep.podcastData && ep.podcastData.title === S.podcast.title
        );
        if (currentEpisode) {
            currentEpisode.mergedBlob = outBlob;
            currentEpisode.durationSec = Math.round(pcmChunks.reduce((s, c) => s + c.length, 0) / sr);
            await saveEpisode(currentEpisode);
            await loadLibrary();
            toast('📚 Библиотека обновлена');
        }

    } catch (err) {
        setStatus('Ошибка экспорта: ' + err.message, 'error');
        toast('Ошибка экспорта: ' + err.message);
    } finally {
        ctx.close();
        S.exporting = false;
        btn.disabled = false;
        updateProgress();
    }
}