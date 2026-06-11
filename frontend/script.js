// Premium AI Pronunciation Coach - JavaScript

const API_URL = '';

const SENTENCES = {
    beginner: [
        "Hello, how are you?",
        "My name is John.",
        "I love learning English.",
        "The cat is on the mat.",
        "Today is a beautiful day.",
        "I like to eat apples.",
        "She has a red car.",
        "We go to school every day.",
        "The sun is shining bright.",
        "I can count to ten."
    ],
    intermediate: [
        "The quick brown fox jumps over the lazy dog.",
        "Practice makes perfect when learning pronunciation.",
        "Communication skills are essential in the workplace.",
        "Technology has transformed our daily lives significantly.",
        "Reading books expands your vocabulary and knowledge.",
        "Traveling abroad helps you understand different cultures.",
        "Exercise regularly to maintain good physical health.",
        "Environmental protection is everyone's responsibility.",
        "Critical thinking skills are valuable in problem-solving.",
        "Time management improves productivity and reduces stress."
    ],
    professional: [
        "We need to strategically align our objectives with market demands.",
        "The quarterly financial reports indicate substantial growth potential.",
        "Implementing sustainable practices enhances corporate social responsibility.",
        "Effective stakeholder engagement requires transparent communication channels.",
        "Data-driven decision-making optimizes operational efficiency significantly.",
        "Our competitive advantage lies in innovative technological solutions.",
        "Regulatory compliance ensures adherence to industry standards.",
        "Leveraging synergies across departments maximizes organizational performance.",
        "Customer-centric approaches drive long-term business sustainability.",
        "Continuous professional development fosters leadership excellence."
    ]
};

let currentLevel = 'beginner';
let currentText = '';
let mediaRecorder = null;
let audioChunks = [];
let recordedBlob = null;
let recordedFileName = 'recording.webm';
let recordedAudioUrl = null;

document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
    setupEventListeners();
    checkAPIHealth();
    
    // Restore username
    const savedName = localStorage.getItem('username');
    if (savedName) {
        document.getElementById('usernameInput').value = savedName;
    }
});

function initializeApp() {
    renderSentences(currentLevel);
    updateLevelButtonState();
    updateCurrentTextDisplay();
}

function setupEventListeners() {
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
        });
    }

    document.querySelectorAll('.level-btn').forEach((button) => {
        button.addEventListener('click', () => handleLevelChange(button.dataset.level));
    });

    document.getElementById('recordBtn').addEventListener('click', startRecording);
    document.getElementById('stopBtn').addEventListener('click', stopRecording);
    document.getElementById('evaluateBtn').addEventListener('click', evaluatePronunciation);
    document.getElementById('listenBtn').addEventListener('click', speakText);

    document.getElementById('practiceAgainBtn')?.addEventListener('click', resetForRetry);
    document.getElementById('nextSentenceBtn')?.addEventListener('click', loadNextSentence);

    document.getElementById('targetText')?.addEventListener('input', (event) => {
        const nextText = event.target.value.trim();
        if (nextText !== currentText) {
            currentText = nextText;
            resetApp();
            updateCurrentTextDisplay();
        }
    });

    // Username tracking
    document.getElementById('usernameInput')?.addEventListener('input', (e) => {
        localStorage.setItem('username', e.target.value.trim());
    });

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            document.querySelectorAll('.tab-content').forEach(content => content.classList.add('hidden'));
            document.getElementById(btn.dataset.tab + 'Tab').classList.remove('hidden');

            if (btn.dataset.tab === 'history') loadHistory();
            if (btn.dataset.tab === 'analytics') loadAnalytics();
            if (btn.dataset.tab === 'personalized') loadPersonalizedPractice();
        });
    });

    // Tutor Modal interactions
    document.getElementById('closeTutorBtn')?.addEventListener('click', () => {
        document.getElementById('tutorModal').classList.add('hidden');
    });
    
    document.getElementById('refreshPracticeBtn')?.addEventListener('click', () => {
        loadPersonalizedPractice();
    });
}

async function checkAPIHealth() {
    try {
        const response = await fetch(`${API_URL}/health`);
        if (!response.ok) throw new Error('Health check failed');
        const data = await response.json();
        if (data.status !== 'healthy') {
            showToast('API models are loading. Please wait.', 'warning');
        }
    } catch (error) {
        showToast('Cannot connect to API. Is backend running?', 'error');
    }
}

function handleLevelChange(level) {
    if (!level || level === currentLevel) return;

    currentLevel = level;
    currentText = '';
    document.getElementById('targetText').value = '';

    const isCustom = level === 'custom';
    document.getElementById('customSection').classList.toggle('hidden', !isCustom);
    document.getElementById('presetSection').classList.toggle('hidden', isCustom);

    if (isCustom) {
        document.getElementById('sentenceList').replaceChildren();
    } else {
        renderSentences(level);
    }

    updateLevelButtonState();
    resetApp();
    updateCurrentTextDisplay();
}

function updateLevelButtonState() {
    document.querySelectorAll('.level-btn').forEach((button) => {
        button.classList.toggle('active', button.dataset.level === currentLevel);
    });
}

function renderSentences(level) {
    const sentenceList = document.getElementById('sentenceList');
    sentenceList.replaceChildren();
    if (!SENTENCES[level]) return;

    SENTENCES[level].forEach((sentence, index) => {
        const card = document.createElement('div');
        card.className = 'sentence-card';
        card.onclick = () => selectSentence(sentence);

        const number = document.createElement('div');
        number.className = 'sentence-number';
        number.textContent = index + 1;

        const text = document.createElement('div');
        text.className = 'sentence-text';
        text.textContent = sentence;

        card.append(number, text);
        sentenceList.appendChild(card);
    });
}

function selectSentence(sentence) {
    currentText = sentence;
    document.getElementById('targetText').value = '';
    resetApp();
    updateCurrentTextDisplay();
}

function updateCurrentTextDisplay() {
    const el = document.getElementById('currentText');
    if (currentText) {
        el.textContent = currentText;
        el.classList.remove('empty-state');
    } else {
        el.textContent = 'Select a phrase from the left menu to start.';
        el.classList.add('empty-state');
    }
    
    const listenButton = document.getElementById('listenBtn');
    const supported = 'speechSynthesis' in window;
    listenButton.disabled = !currentText || !supported;
}

function speakText() {
    if (!currentText || !('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(currentText);
    utterance.rate = 0.85;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
}

function speakWord(word) {
    if (!word || !('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.rate = 0.5; // slow down for tutor
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
}

function getPreferredRecordingOptions() {
    if (!window.MediaRecorder || typeof window.MediaRecorder.isTypeSupported !== 'function') return undefined;
    const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'];
    const mimeType = preferredTypes.find(type => window.MediaRecorder.isTypeSupported(type));
    return mimeType ? { mimeType } : undefined;
}

function extensionForMimeType(mimeType) {
    if (mimeType.includes('ogg')) return 'ogg';
    if (mimeType.includes('mp4')) return 'm4a';
    if (mimeType.includes('wav')) return 'wav';
    return 'webm';
}

async function startRecording() {
    if (!currentText) {
        showToast('Please select or type a phrase first.', 'warning');
        return;
    }

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const options = getPreferredRecordingOptions();
        mediaRecorder = options ? new MediaRecorder(stream, options) : new MediaRecorder(stream);
        audioChunks = [];
        clearRecordedAudio();

        mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
            const mimeType = mediaRecorder.mimeType || options?.mimeType || 'audio/webm';
            recordedBlob = new Blob(audioChunks, { type: mimeType });
            recordedFileName = `recording.${extensionForMimeType(mimeType)}`;
            
            if (recordedBlob.size === 0) return showToast('No audio captured.', 'warning');

            recordedAudioUrl = URL.createObjectURL(recordedBlob);
            const player = document.getElementById('audioPlayer');
            player.src = recordedAudioUrl;
            player.load();
            
            document.getElementById('audioPlayback').classList.remove('hidden');
            document.getElementById('evaluateBtn').disabled = false;
        };

        mediaRecorder.start();
        document.getElementById('recordBtn').disabled = true;
        document.getElementById('stopBtn').disabled = false;
        document.getElementById('recordingStatus').classList.remove('hidden');
        document.getElementById('results').classList.add('hidden');
    } catch (err) {
        console.error(err);
        showToast('Microphone access denied.', 'error');
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        const stream = mediaRecorder.stream;
        mediaRecorder.stop();
        stream.getTracks().forEach(track => track.stop());

        document.getElementById('recordBtn').disabled = false;
        document.getElementById('stopBtn').disabled = true;
        document.getElementById('recordingStatus').classList.add('hidden');
    }
}

async function evaluatePronunciation() {
    if (!recordedBlob || !currentText) return;

    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('evaluateBtn').disabled = true;

    try {
        const formData = new FormData();
        formData.append('audio', recordedBlob, recordedFileName);
        formData.append('target_text', currentText);
        formData.append('difficulty', currentLevel);
        const username = document.getElementById('usernameInput')?.value.trim();
        if (username) {
            formData.append('username', username);
        }

        const response = await fetch(`${API_URL}/api/evaluate`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.detail || 'API Request Failed');
        }

        const data = await response.json();
        renderDashboard(data);
    } catch (err) {
        showToast(err.message, 'error');
        document.getElementById('evaluateBtn').disabled = false;
    } finally {
        document.getElementById('loading').classList.add('hidden');
    }
}

function renderDashboard(rawData) {
    const data = normalizeData(rawData);
    document.getElementById('results').classList.remove('hidden');
    
    // Animate Score Ring
    const circle = document.getElementById('scoreCircle');
    const valueEl = document.getElementById('scoreValue');
    const dashOffset = 377 - (data.score / 100) * 377;
    
    setTimeout(() => {
        circle.style.strokeDashoffset = dashOffset;
        animateNumber(valueEl, 0, data.score, 1200);
        document.getElementById('accuracyBar').style.width = `${data.accuracy}%`;
        document.getElementById('pronunciationBar').style.width = `${data.score}%`;
    }, 50);

    document.getElementById('accuracyText').textContent = `${data.accuracy.toFixed(1)}%`;
    document.getElementById('pronunciationText').textContent = `${data.score.toFixed(1)}%`;

    document.getElementById('expectedText').textContent = data.referenceText;
    document.getElementById('transcription').textContent = data.transcription || 'No speech detected';

    renderFeedbackBanner(data);
    renderPhonemes(data.phonemeAnalysis);
    renderWordScores(data.wordLevelScores);
    renderTips(data);

    document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderFeedbackBanner(data) {
    const banner = document.getElementById('feedbackBanner');
    let type = 'needs-work';
    let icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
    let title = 'Needs Work';
    let desc = 'Speak slower and focus on the phonetic breakdown below.';

    if (data.score >= 90) {
        type = 'excellent';
        title = 'Exceptional!';
        desc = 'Your pronunciation is outstanding. You speak with clarity and precision.';
        icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
    } else if (data.score >= 75) {
        type = 'good';
        title = 'Good Work';
        desc = 'Solid pronunciation with minor areas to improve.';
        icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    } else if (data.score >= 60) {
        type = 'fair';
        title = 'Making Progress';
        desc = 'Focus on the mispronounced words highlighted below.';
    }

    banner.className = `feedback-banner feedback-${type}`;
    banner.innerHTML = `
        <div class="feedback-icon">${icon}</div>
        <div class="feedback-content">
            <strong>${title}</strong>
            <p>${desc}</p>
        </div>
    `;
}

function renderPhonemes(ph) {
    const cont = document.getElementById('phonemeComparison');
    cont.innerHTML = `
        <div class="phoneme-row">
            <span class="phoneme-label">Reference</span>
            <span class="phoneme-value">${ph.referencePhonemes || 'N/A'}</span>
        </div>
        <div class="phoneme-row">
            <span class="phoneme-label">Transcribed</span>
            <span class="phoneme-value">${ph.transcribedPhonemes || 'N/A'}</span>
        </div>
    `;
}

function renderWordScores(words) {
    const cont = document.getElementById('wordScores');
    cont.replaceChildren();
    if (!words.length) return;

    words.forEach(w => {
        const div = document.createElement('div');
        div.className = `word-score ${w.match ? 'correct' : 'incorrect'}`;
        div.innerHTML = `
            <div class="word-main">${w.reference_word || w.transcribed_word || '?'}</div>
            <div class="word-phoneme">${w.transcribed_phonemes || '-'}</div>
            <div class="word-score-value">${w.score.toFixed(0)}%</div>
        `;
        
        if (!w.match && w.error_details && w.error_details.length > 0) {
            div.title = "Click for Tutor Guide!";
            div.onclick = () => openTutorCard(w.reference_word, w.error_details);
        }
        
        cont.appendChild(div);
    });
}

function renderTips(data) {
    const list = document.getElementById('improvementList');
    list.replaceChildren();
    const tips = [];

    if (data.score < 80) tips.push('Listen to the reference audio before recording.');
    const wrong = data.wordLevelScores.filter(w => !w.match && w.reference_word);
    if (wrong.length > 0) {
        tips.push(`Focus closely on: ${wrong.slice(0, 3).map(w => `"${w.reference_word}"`).join(', ')}.`);
    } else if (data.score >= 90) {
        tips.push('Excellent job! Move to the next difficulty level.');
    } else {
        tips.push('Maintain clear and consistent pacing.');
    }

    tips.forEach(t => {
        const li = document.createElement('li');
        li.textContent = t;
        list.appendChild(li);
    });
}

function normalizeData(data) {
    const c = val => Math.min(100, Math.max(0, Number(val) || 0));
    const pa = data.phoneme_analysis || {};
    return {
        score: c(data.score),
        accuracy: c(data.accuracy),
        referenceText: String(data.reference_text || currentText),
        transcription: String(data.transcription || ''),
        wordLevelScores: (data.word_level_scores || []).map(w => ({
            reference_word: String(w.reference_word || ''),
            transcribed_word: String(w.transcribed_word || ''),
            reference_phonemes: String(w.reference_phonemes || ''),
            transcribed_phonemes: String(w.transcribed_phonemes || ''),
            score: c(w.score),
            match: Boolean(w.match),
            error_details: w.error_details || []
        })),
        phonemeAnalysis: {
            referencePhonemes: String(pa.reference_phonemes || ''),
            transcribedPhonemes: String(pa.transcribed_phonemes || '')
        }
    };
}

function animateNumber(el, start, end, dur) {
    const startT = performance.now();
    const diff = end - start;
    const tick = t => {
        const p = Math.min((t - startT) / dur, 1);
        el.textContent = Math.round(start + diff * p);
        if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

function resetForRetry() {
    resetApp();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function loadNextSentence() {
    if (currentLevel === 'custom') return showToast('Create a custom phrase.', 'info');
    const list = SENTENCES[currentLevel];
    const idx = (list.indexOf(currentText) + 1) % list.length;
    selectSentence(list[idx]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetApp() {
    document.getElementById('results').classList.add('hidden');
    document.getElementById('audioPlayback').classList.add('hidden');
    document.getElementById('evaluateBtn').disabled = true;
    clearRecordedAudio();
    audioChunks = [];
}

function clearRecordedAudio() {
    if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
    recordedBlob = null;
    recordedAudioUrl = null;
    const player = document.getElementById('audioPlayer');
    if (player) {
        player.removeAttribute('src');
        player.load();
    }
}

const icons = {
    info: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`,
    success: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
    warning: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
    error: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`
};

function showToast(msg, type = 'info') {
    const cont = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `${icons[type] || icons.info} <span>${msg}</span>`;
    cont.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'toastFadeOut 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards';
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

// History & Analytics Data Loading
let scoreChartInstance = null;

async function loadHistory() {
    const username = document.getElementById('usernameInput')?.value.trim();
    if (!username) {
        document.getElementById('historyContainer').innerHTML = '<p>Please enter a username to view history.</p>';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/history/${username}`);
        if (!response.ok) throw new Error('Failed to fetch history');
        const data = await response.json();
        
        const container = document.getElementById('historyContainer');
        container.innerHTML = '';
        
        if (data.records.length === 0) {
            container.innerHTML = '<p>No history found for this user.</p>';
            return;
        }
        
        data.records.forEach(record => {
            const div = document.createElement('div');
            div.className = 'history-item';
            div.innerHTML = `
                <div>
                    <div style="font-weight: 500; font-size: 1.1em;">${record.target_text}</div>
                    <div style="color: var(--text-secondary); font-size: 0.9em;">
                        Date: ${new Date(record.created_at).toLocaleDateString()} | Diff: ${record.difficulty} | Acc: ${record.accuracy.toFixed(1)}%
                    </div>
                </div>
                <div class="score-badge">${record.score.toFixed(0)}</div>
            `;
            container.appendChild(div);
        });
    } catch (e) {
        showToast('Error loading history', 'error');
    }
}

async function loadAnalytics() {
    const username = document.getElementById('usernameInput')?.value.trim();
    if (!username) {
        document.getElementById('weaknessesList').innerHTML = '<li>Please enter a username.</li>';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/analytics/${username}`);
        if (!response.ok) throw new Error('Failed to fetch analytics');
        const data = await response.json();
        
        // Render Weaknesses
        const ul = document.getElementById('weaknessesList');
        ul.innerHTML = '';
        if (data.top_weaknesses.length === 0) {
            ul.innerHTML = '<li>No weaknesses identified yet.</li>';
        } else {
            data.top_weaknesses.forEach(w => {
                const li = document.createElement('li');
                li.innerHTML = `<strong>${w.phoneme}</strong> (${w.count} mistakes)`;
                ul.appendChild(li);
            });
        }
        
        // Render Chart
        const ctx = document.getElementById('scoreChart').getContext('2d');
        if (scoreChartInstance) scoreChartInstance.destroy();
        
        const labels = data.score_trend.map(t => new Date(t.date).toLocaleDateString());
        const scores = data.score_trend.map(t => t.score);
        
        scoreChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Pronunciation Score',
                    data: scores,
                    borderColor: '#4f46e5',
                    tension: 0.3,
                    fill: false
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: 100
                    }
                }
            }
        });
        
    } catch (e) {
        showToast('Error loading analytics', 'error');
    }
}

async function loadPersonalizedPractice() {
    const username = document.getElementById('usernameInput')?.value.trim();
    const container = document.getElementById('personalizedContainer');
    
    if (!username) {
        container.innerHTML = '<p>Please enter a username to get targeted practice.</p>';
        return;
    }
    
    container.innerHTML = '<p>Loading targeted exercises...</p>';
    try {
        const response = await fetch(`${API_URL}/api/tutor/personalized-practice/${username}`);
        if (!response.ok) throw new Error('Failed to fetch practices');
        const data = await response.json();
        
        container.innerHTML = '';
        data.practices.forEach(prac => {
            const div = document.createElement('div');
            div.className = 'history-item practice-card';
            
            let pairsHTML = '';
            if (prac.minimal_pairs && prac.minimal_pairs.length > 0) {
                const pairStr = prac.minimal_pairs.map(p => `${p[0]} / ${p[1]}`).join(', ');
                pairsHTML = `<p style="font-size: 0.85em; color: var(--text-secondary);">Minimal Pairs: ${pairStr}</p>`;
            }
            
            div.innerHTML = `
                <div style="flex: 1;">
                    <h4 style="color: var(--primary); margin-bottom: 0.5rem;">Target: /${prac.target_phoneme}/ (${prac.focus})</h4>
                    <p style="font-size: 1.1rem; font-weight: 500; margin-bottom: 0.5rem;">"${prac.sentence}"</p>
                    ${pairsHTML}
                </div>
                <button class="btn btn-primary" onclick="selectSentence('${prac.sentence}'); document.querySelector('[data-tab=practice]').click();">Practice</button>
            `;
            container.appendChild(div);
        });
        
    } catch (e) {
        container.innerHTML = '<p>Error loading practices.</p>';
    }
}

async function openTutorCard(word, error_details) {
    if (!error_details || error_details.length === 0) return;
    
    // Find the first replacement or deletion error
    let err = error_details.find(e => e.type === 'replace');
    if (!err) err = error_details.find(e => e.type === 'delete');
    if (!err) return;
    
    const expected = err.expected;
    const actual = err.actual || '-';
    
    document.getElementById('loading').classList.remove('hidden');
    try {
        const response = await fetch(`${API_URL}/api/tutor/card?word=${encodeURIComponent(word)}&expected=${encodeURIComponent(expected)}&actual=${encodeURIComponent(actual)}`);
        if (!response.ok) throw new Error("Failed to load tutor card");
        const data = await response.json();
        
        renderTutorCard(data);
        document.getElementById('tutorModal').classList.remove('hidden');
        
        document.getElementById('tutorAudioBtn').onclick = () => speakWord(word);
        
    } catch (e) {
        showToast("Error loading tutor guide.", "error");
    } finally {
        document.getElementById('loading').classList.add('hidden');
    }
}

function renderTutorCard(data) {
    const cont = document.getElementById('tutorContent');
    const td = data.tutor_data;
    
    // Build syllables
    let syllables = [];
    let sylCount = data.syllable_info.syllable_count;
    let stressIdx = data.syllable_info.stress_index;
    
    // Mock simple division based on word length for visual sake if actual syllables are tricky,
    // but we can just use the word and highlight the stress roughly.
    let wordVisual = data.word;
    
    let pairsHTML = '';
    if (td.minimal_pairs && td.minimal_pairs.length > 0) {
        pairsHTML = `
            <div class="tutor-section">
                <h4><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg> Minimal Pairs (Contrast)</h4>
                <ul style="list-style-type: none; padding-left: 1rem;">
                    ${td.minimal_pairs.map(p => `<li><strong>${p.correct}</strong> vs <em>${p.incorrect}</em></li>`).join('')}
                </ul>
            </div>
        `;
    }

    cont.innerHTML = `
        <div style="text-align: center; margin-bottom: 2rem;">
            <p style="font-size: 1.2rem;">You pronounced <span class="phoneme-tag phoneme-actual">/${data.actual_phoneme}/</span> instead of <span class="phoneme-tag phoneme-expected">/${data.expected_phoneme}/</span></p>
            <div class="syllable-word">${wordVisual}</div>
            <p style="color: var(--text-secondary);">${td.name}</p>
        </div>
        
        <div class="tutor-section">
            <h4><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg> Mouth & Tongue Placement</h4>
            <p>${td.placement_guide}</p>
        </div>

        <div class="tutor-section" style="background: var(--danger-bg); border-color: var(--danger);">
            <h4 style="color: var(--danger);"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> Why it sounded wrong</h4>
            <p style="color: var(--danger-text);">${td.why_wrong}</p>
        </div>
        
        ${pairsHTML}
        
        <div class="tutor-section" style="background: var(--success-bg); border-color: var(--success);">
            <h4 style="color: var(--success);"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> Practice Sentence</h4>
            <p style="color: var(--success-text); font-weight: 500; font-size: 1.1rem; font-style: italic;">"${td.practice_sentence}"</p>
        </div>
    `;
}
