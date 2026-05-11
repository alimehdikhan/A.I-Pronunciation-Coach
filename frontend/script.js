// Enhanced AI Pronunciation Coach - JavaScript
// Preset sentences, TTS teacher, recording, analysis, and improvement tips.

// Use relative API paths so frontend works when served from the same backend.
// If you serve frontend separately on another port, set this to that backend URL.
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
});

function initializeApp() {
    renderSentences(currentLevel);
    updateLevelButtonState();
    updateCurrentTextDisplay();
}

function setupEventListeners() {
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
}

async function checkAPIHealth() {
    try {
        const response = await fetch(`${API_URL}/health`);
        if (!response.ok) {
            throw new Error('Health check failed');
        }

        const data = await response.json();
        if (data.status !== 'healthy') {
            showNotification('API is loading speech models. Please wait a moment.', 'warning');
        }
    } catch (error) {
        showNotification('Cannot connect to the API. Make sure the backend is running on port 8000.', 'error');
    }
}

function handleLevelChange(level) {
    if (!level || level === currentLevel) {
        return;
    }

    currentLevel = level;
    currentText = '';
    document.getElementById('targetText').value = '';

    const isCustom = level === 'custom';
    document.getElementById('customSection').style.display = isCustom ? 'block' : 'none';
    document.querySelector('.preset-section').style.display = isCustom ? 'none' : 'block';

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
        const isActive = button.dataset.level === currentLevel;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
    });
}

function renderSentences(level) {
    const sentenceList = document.getElementById('sentenceList');
    sentenceList.replaceChildren();

    if (level === 'custom' || !SENTENCES[level]) {
        return;
    }

    SENTENCES[level].forEach((sentence, index) => {
        const card = document.createElement('div');
        card.className = 'sentence-card';

        const number = document.createElement('span');
        number.className = 'sentence-number';
        number.textContent = String(index + 1);

        const text = document.createElement('p');
        text.className = 'sentence-text';
        text.textContent = sentence;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn-select';
        button.textContent = 'Select';
        button.addEventListener('click', () => selectSentence(sentence));

        card.append(number, text, button);
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
    document.getElementById('currentText').textContent = currentText || 'Select a sentence to begin';
    updateSpeechControls();
}

function supportsSpeechSynthesis() {
    return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

function updateSpeechControls() {
    const listenButton = document.getElementById('listenBtn');
    const supported = supportsSpeechSynthesis();

    listenButton.disabled = !currentText || !supported;
    listenButton.title = supported ? '' : 'Text-to-speech is not supported in this browser.';
}

function speakText() {
    if (!currentText || !supportsSpeechSynthesis()) {
        showNotification('Text-to-speech is not supported in this browser.', 'warning');
        return;
    }

    const utterance = new SpeechSynthesisUtterance(currentText);
    utterance.rate = 0.85;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const englishVoice = voices.find((voice) => voice.lang.startsWith('en-'));
    if (englishVoice) {
        utterance.voice = englishVoice;
    }

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    showNotification('Listen carefully and try to imitate the teacher voice.', 'info');
}

function supportsRecording() {
    return Boolean(
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === 'function' &&
        typeof window.MediaRecorder === 'function'
    );
}

function getPreferredRecordingOptions() {
    if (!window.MediaRecorder || typeof window.MediaRecorder.isTypeSupported !== 'function') {
        return undefined;
    }

    const preferredTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg',
        'audio/mp4'
    ];

    const mimeType = preferredTypes.find((type) => window.MediaRecorder.isTypeSupported(type));
    return mimeType ? { mimeType } : undefined;
}

function extensionForMimeType(mimeType) {
    if (mimeType.includes('ogg') || mimeType.includes('opus')) {
        return 'ogg';
    }
    if (mimeType.includes('mp4')) {
        return 'm4a';
    }
    if (mimeType.includes('wav')) {
        return 'wav';
    }
    return 'webm';
}

async function startRecording() {
    if (!currentText) {
        showNotification('Please select a sentence first.', 'warning');
        return;
    }

    if (!supportsRecording()) {
        showNotification('Audio recording is not supported in this browser.', 'error');
        return;
    }

    let stream = null;
    try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recordingOptions = getPreferredRecordingOptions();
        mediaRecorder = recordingOptions ? new MediaRecorder(stream, recordingOptions) : new MediaRecorder(stream);
        audioChunks = [];
        clearRecordedAudio();

        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onerror = () => {
            stopMediaTracks(stream);
            showNotification('Recording failed. Please try again.', 'error');
        };

        mediaRecorder.onstop = () => {
            const mimeType = mediaRecorder.mimeType || recordingOptions?.mimeType || 'audio/webm';
            recordedBlob = new Blob(audioChunks, { type: mimeType });
            recordedFileName = `recording.${extensionForMimeType(mimeType)}`;

            if (recordedBlob.size === 0) {
                recordedBlob = null;
                showNotification('No audio was captured. Please record again.', 'warning');
                return;
            }

            recordedAudioUrl = URL.createObjectURL(recordedBlob);
            const audioPlayer = document.getElementById('audioPlayer');
            audioPlayer.src = recordedAudioUrl;
            audioPlayer.load();
            document.getElementById('audioPlayback').classList.remove('hidden');
            document.getElementById('evaluateBtn').disabled = false;
        };

        mediaRecorder.start();

        document.getElementById('recordBtn').disabled = true;
        document.getElementById('stopBtn').disabled = false;
        document.getElementById('recordingStatus').classList.remove('hidden');
        document.getElementById('results').classList.add('hidden');

        showNotification('Recording started. Speak clearly.', 'info');
    } catch (error) {
        stopMediaTracks(stream);
        console.error('Error accessing microphone:', error);
        showNotification('Could not access the microphone. Please allow microphone permissions.', 'error');
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        const stream = mediaRecorder.stream;
        mediaRecorder.stop();
        stopMediaTracks(stream);

        document.getElementById('recordBtn').disabled = false;
        document.getElementById('stopBtn').disabled = true;
        document.getElementById('recordingStatus').classList.add('hidden');

        showNotification('Recording complete. Click Get Detailed Feedback.', 'success');
    }
}

function stopMediaTracks(stream) {
    if (!stream) {
        return;
    }

    stream.getTracks().forEach((track) => track.stop());
}

async function evaluatePronunciation() {
    if (!recordedBlob || !currentText) {
        showNotification('Please record audio and select text first.', 'warning');
        return;
    }

    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('evaluateBtn').disabled = true;

    try {
        const formData = new FormData();
        formData.append('audio', recordedBlob, recordedFileName);
        formData.append('target_text', currentText);

        const response = await fetch(`${API_URL}/api/evaluate`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(await readErrorMessage(response));
        }

        const data = await response.json();
        displayEnhancedResults(data);
    } catch (error) {
        console.error('Error:', error);
        showNotification(error.message || 'Error evaluating pronunciation. Please try again.', 'error');
    } finally {
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('evaluateBtn').disabled = false;
    }
}

async function readErrorMessage(response) {
    try {
        const data = await response.json();
        return data.detail || 'API request failed.';
    } catch (error) {
        return 'API request failed.';
    }
}

function toFiniteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function clampPercentage(value) {
    return Math.min(100, Math.max(0, toFiniteNumber(value)));
}

function normalizeWordScores(wordScores) {
    if (!Array.isArray(wordScores)) {
        return [];
    }

    return wordScores.map((word) => ({
        reference_word: String(word?.reference_word || ''),
        transcribed_word: String(word?.transcribed_word || ''),
        reference_phonemes: String(word?.reference_phonemes || ''),
        transcribed_phonemes: String(word?.transcribed_phonemes || ''),
        score: clampPercentage(word?.score),
        match: Boolean(word?.match)
    }));
}

function normalizeResultData(data) {
    const phonemeAnalysis = data?.phoneme_analysis && typeof data.phoneme_analysis === 'object'
        ? data.phoneme_analysis
        : {};

    return {
        score: clampPercentage(data?.score),
        accuracy: clampPercentage(data?.accuracy),
        referenceText: String(data?.reference_text || currentText || ''),
        transcription: String(data?.transcription || ''),
        wordLevelScores: normalizeWordScores(data?.word_level_scores),
        phonemeAnalysis: {
            referencePhonemes: String(phonemeAnalysis.reference_phonemes || ''),
            transcribedPhonemes: String(phonemeAnalysis.transcribed_phonemes || ''),
            similarity: phonemeAnalysis.phoneme_similarity == null
                ? null
                : clampPercentage(phonemeAnalysis.phoneme_similarity)
        }
    };
}

function displayEnhancedResults(rawData) {
    const data = normalizeResultData(rawData);
    const results = document.getElementById('results');
    results.classList.remove('hidden');
    results.scrollIntoView({ behavior: 'smooth' });

    animateScore(data.score);

    document.getElementById('accuracyBar').style.width = `${data.accuracy}%`;
    document.getElementById('accuracyText').textContent = `${data.accuracy.toFixed(1)}%`;
    document.getElementById('pronunciationBar').style.width = `${data.score}%`;
    document.getElementById('pronunciationText').textContent = `${data.score.toFixed(1)}%`;

    document.getElementById('expectedText').textContent = data.referenceText;
    document.getElementById('transcription').textContent = data.transcription || 'No speech detected.';

    displayDetailedFeedback(data);
    displayPhonemeAnalysis(data.phonemeAnalysis);
    displayWordScores(data.wordLevelScores);
    displayImprovementTips(data);
}

function animateScore(score) {
    const scoreCircle = document.getElementById('scoreCircle');
    const scoreValue = document.getElementById('scoreValue');
    const circumference = 2 * Math.PI * 90;
    const offset = circumference - (score / 100) * circumference;

    setTimeout(() => {
        scoreCircle.style.strokeDashoffset = offset;
        animateNumber(scoreValue, 0, score, 1000);
    }, 100);
}

function displayDetailedFeedback(data) {
    const feedbackDiv = document.getElementById('feedback');
    const section = document.createElement('div');
    section.className = 'feedback-section';

    if (data.score >= 90) {
        section.appendChild(makeFeedbackParagraph('feedback-excellent', 'Excellent!', 'Your pronunciation is outstanding. You speak with clarity and precision.'));
    } else if (data.score >= 75) {
        section.appendChild(makeFeedbackParagraph('feedback-good', 'Good work!', 'You have solid pronunciation with only minor areas to improve.'));
    } else if (data.score >= 60) {
        section.appendChild(makeFeedbackParagraph('feedback-fair', 'Fair effort!', 'You are making progress. Focus on the areas highlighted below.'));
    } else {
        section.appendChild(makeFeedbackParagraph('feedback-needs-work', 'Keep practicing!', 'Pronunciation takes time. Use the teacher voice and practice slowly.'));
    }

    if (data.accuracy < 100) {
        const incorrectWords = data.wordLevelScores.filter((word) => !word.match).length;
        const paragraph = document.createElement('p');
        const strong = document.createElement('strong');
        strong.textContent = `${incorrectWords} word(s)`;
        paragraph.append(strong, document.createTextNode(' need attention for better accuracy.'));
        section.appendChild(paragraph);
    }

    feedbackDiv.replaceChildren(section);
}

function makeFeedbackParagraph(className, label, message) {
    const paragraph = document.createElement('p');
    const strong = document.createElement('strong');

    paragraph.className = className;
    strong.textContent = label;
    paragraph.append(strong, document.createTextNode(` ${message}`));

    return paragraph;
}

function displayPhonemeAnalysis(phonemeData) {
    const container = document.getElementById('phonemeComparison');
    container.replaceChildren(
        makePhonemeRow('Expected:', phonemeData.referencePhonemes || 'N/A'),
        makePhonemeRow('Your pronunciation:', phonemeData.transcribedPhonemes || 'N/A'),
        makePhonemeRow(
            'Similarity:',
            phonemeData.similarity == null ? 'N/A' : `${phonemeData.similarity.toFixed(1)}%`
        )
    );
}

function makePhonemeRow(labelText, valueText) {
    const row = document.createElement('div');
    row.className = 'phoneme-row';

    const label = document.createElement('div');
    label.className = 'phoneme-label';
    label.textContent = labelText;

    const value = document.createElement('div');
    value.className = 'phoneme-value';
    value.textContent = valueText;

    row.append(label, value);
    return row;
}

function displayWordScores(wordScores) {
    const container = document.getElementById('wordScores');
    container.replaceChildren();

    if (!wordScores.length) {
        const empty = document.createElement('p');
        empty.textContent = 'No word-level data available.';
        container.appendChild(empty);
        return;
    }

    wordScores.forEach((word) => {
        const wordDiv = document.createElement('div');
        wordDiv.className = `word-score ${word.match ? 'correct' : 'incorrect'}`;

        const main = document.createElement('div');
        main.className = 'word-main';
        main.textContent = word.reference_word || word.transcribed_word || 'Unknown';

        const phoneme = document.createElement('div');
        phoneme.className = 'word-phoneme';
        phoneme.textContent = word.transcribed_phonemes || 'N/A';

        const score = document.createElement('div');
        score.className = 'word-score-value';
        score.textContent = `${word.score.toFixed(1)}%`;

        wordDiv.append(main, phoneme, score);
        container.appendChild(wordDiv);
    });
}

function displayImprovementTips(data) {
    const improvementList = document.getElementById('improvementList');
    improvementList.replaceChildren();

    const tips = [];

    if (data.accuracy < 70) {
        tips.push('Focus on pronouncing each word clearly and separately.');
        tips.push('Use the Listen to Teacher button to hear correct pronunciation.');
    }

    if (data.score < 80) {
        tips.push('Practice speaking slowly at first, then gradually increase speed.');
        tips.push('Pay attention to individual sounds in each word.');
    }

    const incorrectWords = data.wordLevelScores.filter((word) => !word.match && word.reference_word);
    if (incorrectWords.length > 0) {
        const wordList = incorrectWords
            .map((word) => `"${word.reference_word}"`)
            .slice(0, 3)
            .join(', ');
        tips.push(`Focus on these words: ${wordList}.`);
    }

    tips.push('Repeat this sentence multiple times until you reach 90% or higher.');
    tips.push('Move to the next difficulty level once you consistently score above 85%.');

    tips.forEach((tip) => {
        const listItem = document.createElement('li');
        listItem.textContent = tip;
        improvementList.appendChild(listItem);
    });
}

function animateNumber(element, start, end, duration) {
    const range = end - start;
    const startTime = performance.now();

    function update(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const value = start + range * progress;
        element.textContent = Math.round(value);

        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }

    requestAnimationFrame(update);
}

function resetForRetry() {
    resetApp();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function loadNextSentence() {
    if (currentLevel === 'custom') {
        showNotification('Create your own custom sentence above.', 'info');
        return;
    }

    const sentences = SENTENCES[currentLevel];
    const currentIndex = sentences.indexOf(currentText);
    const nextIndex = (currentIndex + 1) % sentences.length;

    selectSentence(sentences[nextIndex]);
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetResults() {
    document.getElementById('results').classList.add('hidden');
    document.getElementById('audioPlayback').classList.add('hidden');
    document.getElementById('evaluateBtn').disabled = true;
}

function resetApp() {
    resetResults();
    clearRecordedAudio();
    audioChunks = [];
}

function clearRecordedAudio() {
    if (recordedAudioUrl) {
        URL.revokeObjectURL(recordedAudioUrl);
        recordedAudioUrl = null;
    }

    recordedBlob = null;
    recordedFileName = 'recording.webm';

    const audioPlayer = document.getElementById('audioPlayer');
    if (audioPlayer) {
        audioPlayer.removeAttribute('src');
        audioPlayer.load();
    }
}

function showNotification(message, type) {
    const colors = {
        info: '#667eea',
        success: '#48bb78',
        warning: '#f6ad55',
        error: '#f56565'
    };

    const notification = document.createElement('div');
    notification.setAttribute('role', type === 'error' ? 'alert' : 'status');
    notification.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${colors[type] || colors.info};
        color: white;
        padding: 15px 20px;
        border-radius: 10px;
        box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        z-index: 10000;
        max-width: 350px;
        animation: slideIn 0.3s ease;
        font-weight: 500;
    `;
    notification.textContent = message;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 4000);
}

if (supportsSpeechSynthesis()) {
    window.speechSynthesis.addEventListener('voiceschanged', () => {
        window.speechSynthesis.getVoices();
    });
}
