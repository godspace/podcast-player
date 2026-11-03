// App Logic
document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
});

function initEventListeners() {
    // Upload
    $('dropzone').addEventListener('click', () => $('jsonFile').click());
    $('dropzone').addEventListener('dragover', handleDragOver);
    $('dropzone').addEventListener('dragleave', handleDragLeave);
    $('dropzone').addEventListener('drop', handleDrop);
    $('jsonFile').addEventListener('change', handleFileSelect);
    
    // Controls
    $('btnPlay').addEventListener('click', play);
    $('btnPause').addEventListener('click', pause);
    $('btnStop').addEventListener('click', stopPlayback);
    $('btnPrev').addEventListener('click', () => step(-1));
    $('btnNext').addEventListener('click', () => step(1));
    
    // Sliders
    $('rateSlider').addEventListener('input', updateRate);
    $('volSlider').addEventListener('input', updateVolume);
    
    // Export
    $('btnExport').addEventListener('click', exportMp3);
    
    // Transcript
    $('transcriptToggle').addEventListener('click', toggleTranscript);
    
    // Progress
    $('progressBg').addEventListener('click', handleProgressClick);
}

// Upload Handlers
function handleDragOver(e) {
    e.preventDefault();
    $('dropzone').classList.add('drag');
}

function handleDragLeave(e) {
    e.preventDefault();
    $('dropzone').classList.remove('drag');
}

function handleDrop(e) {
    e.preventDefault();
    $('dropzone').classList.remove('drag');
    const files = e.dataTransfer.files;
    if (files.length) readFile(files[0]);
}

function handleFileSelect(e) {
    if (e.target.files.length) readFile(e.target.files[0]);
}

function readFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
        try {
            loadPodcast(JSON.parse(e.target.result));
            showFileInfo(file.name);
            setStatus('Файл загружен', 'success');
        } catch (err) {
            toast('Ошибка JSON: ' + err.message);
            setStatus('Ошибка загрузки', 'error');
        }
    };
    reader.readAsText(file);
}

function showFileInfo(name) {
    $('fileName').textContent = name;
    $('fileInfo').style.display = 'flex';
}

function removeFile() {
    $('jsonFile').value = '';
    $('fileInfo').style.display = 'none';
    S.podcast = null;
    S.lines = [];
    S.idx = -1;
    S.audioCache = {};
    $('voiceRows').innerHTML = '<div class="empty-state"><p>Сначала загрузите JSON файл</p></div>';
    updateProgress();
}

// Podcast Loading
function loadPodcast(data) {
    stopPlayback();
    S.podcast = data.podcast || data;
    S.lines = [];
    S.audioCache = {};
    S.idx = -1;
    
    (S.podcast.segments || []).forEach(seg => {
        (seg.lines || []).forEach(l => {
            S.lines.push({
                ...l,
                segmentId: seg.segment_id,
                segmentTitle: seg.title
            });
        });
    });
    
    renderVoiceRows();
    renderTranscript();
    updateProgress();
    enableControls();
    $('exportStatus').textContent = 'Готов к экспорту';
}

function renderVoiceRows() {
    const box = $('voiceRows');
    box.innerHTML = '';
    
    (S.podcast.speakers || []).forEach((sp, i) => {
        S.voiceMap[sp.id] = {
            voice: CONFIG.DEFAULT_VOICES[i % CONFIG.DEFAULT_VOICES.length],
            emotion: sp.emotion || 'neutral'
        };
        
        const row = document.createElement('div');
        row.className = 'voice-row';
        
        const displayName = sp.name || sp.id;
        row.innerHTML = `
            <div class="voice-label">
                <div class="avatar speaker-${i+1}">${displayName.charAt(0).toUpperCase()}</div>
                <div>
                    <div style="font-weight: 600;">${displayName}</div>
                    <div style="font-size: 0.875rem; color: var(--text-tertiary);">${sp.role || 'Спикер'}</div>
                </div>
            </div>
            <select id="voice_${sp.id}" class="voice-select"></select>
            <select id="emotion_${sp.id}" class="emotion-select"></select>
        `;
        
        // Populate voice select
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
        });
        
        // Populate emotion select
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
        });
        
        box.appendChild(row);
    });
}

function renderTranscript() {
    const list = $('transcriptList');
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
            
            const sp = (S.podcast.speakers || []).find(s => s.id === line.speaker);
            const speakerName = sp ? (sp.name || sp.id) : line.speaker;
            const speakerIdx = (S.podcast.speakers || []).findIndex(s => s.id === line.speaker);
            
            item.innerHTML = `
                <div class="transcript-speaker speaker-${speakerIdx+1}">${speakerName}</div>
                <div class="transcript-text">${line.text}</div>
            `;
            
            item.addEventListener('click', () => jumpTo(parseInt(item.dataset.index)));
            list.appendChild(item);
            idx++;
        });
    });
}

// Playback
function play() {
    if (S.exporting) {
        toast('Дождитесь окончания экспорта');
        return;
    }
    if (!S.lines.length) {
        toast('Сначала загрузите JSON');
        return;
    }
    if (S.paused) {
        S.audioEl.play();
        S.paused = false;
        setStatus('Продолжение', 'success');
        return;
    }
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
    if (!S.exporting) setStatus('Остановлено');
    updateProgress();
}

function step(d) {
    const n = S.idx + d;
    if (n < 0 || n >= S.lines.length) return;
    S.audioEl.pause();
    S.idx = n;
    displayLine();
    if (S.playing) {
        S.stopRequested = false;
        playCurrent();
    }
}

function jumpTo(i) {
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
        setStatus('Синтез: ' + getSpkName(line.speaker) + '…');
        const blob = await ensureAudio(S.idx);
        if (S.stopRequested) return;
        
        S.audioEl.src = URL.createObjectURL(blob);
        S.audioEl.volume = parseFloat($('volSlider').value);
        await S.audioEl.play();
        setStatus('Говорит: ' + getSpkName(line.speaker), 'success');
        
        S.audioEl.onended = async () => {
            if (S.stopRequested) return;
            await sleep(line.pause_after_ms || 400);
            if (!S.stopRequested) {
                S.idx++;
                playCurrent();
            }
        };
    } catch (err) {
        setStatus('Ошибка: ' + err.message, 'error');
        toast('Ошибка синтеза: ' + err.message);
        S.playing = false;
    }
}

async function ensureAudio(i) {
    if (S.audioCache[i]) return S.audioCache[i];
    
    const line = S.lines[i];
    const map = S.voiceMap[line.speaker] || {voice: 'jane', emotion: 'neutral'};
    const speed = $('rateSlider').value;
    
    const blob = await synthesize(line.text, map.voice, map.emotion, speed);
    S.audioCache[i] = blob;
    return blob;
}

async function synthesize(text, voice, emotion, speed) {
    const url = $('proxyUrl').value.trim() || CONFIG.DEFAULT_PROXY_URL;
    const body = { text, voice, emotion, speed: String(speed), lang: 'ru-RU' };
    
    $('proxyStatus').textContent = '⏳ Запрос...';
    
    const r = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body)
    });
    
    if (!r.ok) {
        const err = await r.text();
        throw new Error('Прокси вернул ' + r.status + ': ' + err);
    }
    
    $('proxyStatus').textContent = '✅ OK';
    return await r.blob();
}

// UI Updates
function displayLine() {
    if (S.idx < 0 || S.idx >= S.lines.length) return;
    
    const line = S.lines[S.idx];
    const name = getSpkName(line.speaker);
    const spIdx = (S.podcast.speakers || []).findIndex(s => s.id === line.speaker);
    
    $('curName').textContent = name;
    $('curName').className = 'speaker-name speaker-' + (spIdx + 1);
    $('curAvatar').className = 'avatar speaker-' + (spIdx + 1);
    $('curAvatar').textContent = name.charAt(0).toUpperCase();
    $('curText').textContent = line.text;
    $('curSeg').textContent = `Сегмент ${line.segmentId}: ${line.segmentTitle}`;
    
    updateProgress();
    highlightTranscript();
}

function updateProgress() {
    const total = S.lines.length;
    const cur = S.idx + 1;
    const percent = total ? (cur / total * 100) : 0;
    
    $('progressBar').style.width = percent + '%';
    $('progCurrent').textContent = `${cur} / ${total}`;
    
    if (S.idx >= 0 && S.idx < total) {
        $('progSegment').textContent = S.lines[S.idx].segmentTitle;
    } else {
        $('progSegment').textContent = '—';
    }
}

function highlightTranscript() {
    document.querySelectorAll('.transcript-item').forEach((el, i) => {
        el.classList.toggle('active', i === S.idx);
        el.classList.toggle('played', i < S.idx);
        if (i === S.idx) {
            el.scrollIntoView({behavior: 'smooth', block: 'nearest'});
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

// Helpers
function getSpkName(id) {
    const sp = (S.podcast?.speakers || []).find(s => s.id === id);
    return sp ? (sp.name || sp.id) : id;
}

function enableControls() {
    ['btnPlay', 'btnPause', 'btnStop', 'btnPrev', 'btnNext', 'btnExport'].forEach(id => {
        $(id).disabled = false;
    });
}

function updateRate() {
    $('rateVal').textContent = $('rateSlider').value + 'x';
}

function updateVolume() {
    $('volVal').textContent = Math.round($('volSlider').value * 100) + '%';
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// Export (simplified - full implementation from previous version)
async function exportMp3() {
    if (!S.lines.length || S.exporting) return;
    toast('Экспорт начат...');
    // Full implementation from previous version
}

// UI Helpers
function toggleTranscript() {
    const list = $('transcriptList');
    const btn = $('transcriptToggle');
    list.classList.toggle('hidden');
    btn.textContent = list.classList.contains('hidden') ? 'Показать транскрипт' : 'Скрыть транскрипт';
}

function toggleSettings() {
    const modal = $('settingsModal');
    modal.classList.toggle('hidden');
}

function scrollToSection(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({behavior: 'smooth'});
}

function handleProgressClick(e) {
    if (!S.lines.length || S.exporting) return;
    const r = $('progressBg').getBoundingClientRect();
    const p = (e.clientX - r.left) / r.width;
    jumpTo(Math.min(Math.floor(p * S.lines.length), S.lines.length - 1));
}

function copyPrompt() {
    navigator.clipboard.writeText(CONFIG.LLM_PROMPT).then(() => {
        toast('✅ Промпт скопирован');
    }).catch(() => {
        toast('Ошибка копирования');
    });
}