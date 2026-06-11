"""
Educational Tutor Engine
Provides step-by-step guidance, mouth placement, and personalized practice for phoneme mistakes.
"""

import nltk
from typing import Dict, List, Any

# Ensure cmudict is available
try:
    nltk.data.find('corpora/cmudict')
except LookupError:
    nltk.download('cmudict')

try:
    cmu_dict = nltk.corpus.cmudict.dict()
except Exception:
    cmu_dict = {}

# Hardcoded Phoneme Knowledge Base (Abridged for commonly confused English sounds)
PHONEME_KB = {
    "v": {
        "name": "Voiced labiodental fricative",
        "placement": "Gently bite your lower lip with your top teeth. Blow air while using your vocal cords (make it vibrate).",
        "common_substitutions": ["w", "b", "f"],
        "why_wrong": "You might be rounding your lips like /w/ or fully closing them like /b/ instead of biting the lower lip.",
        "minimal_pairs": [("vet", "wet"), ("vow", "wow"), ("vest", "west")],
        "easier_words": ["van", "vote", "cave"],
        "practice_sentence": "Victor's vibrant violet van vanished."
    },
    "w": {
        "name": "Voiced labial-velar approximant",
        "placement": "Round your lips tightly into an 'O' shape and push air out without your teeth touching your lips.",
        "common_substitutions": ["v"],
        "why_wrong": "Your top teeth are probably touching your bottom lip (like /v/). Keep your teeth away from your lips.",
        "minimal_pairs": [("wet", "vet"), ("wine", "vine")],
        "easier_words": ["we", "water", "win"],
        "practice_sentence": "We watched the white whale swim away."
    },
    "r": {
        "name": "Alveolar approximant",
        "placement": "Pull your tongue back slightly, curl the tip up without touching the roof of your mouth. Round your lips slightly.",
        "common_substitutions": ["l", "w"],
        "why_wrong": "If it sounds like /l/, your tongue tip is touching the roof of your mouth behind your teeth. It shouldn't touch anywhere.",
        "minimal_pairs": [("right", "light"), ("read", "lead"), ("row", "low")],
        "easier_words": ["red", "run", "car"],
        "practice_sentence": "The red rabbit ran right round the rock."
    },
    "l": {
        "name": "Alveolar lateral approximant",
        "placement": "Press the tip of your tongue firmly against the bumpy ridge just behind your top front teeth. Let air flow around the sides.",
        "common_substitutions": ["r"],
        "why_wrong": "Your tongue tip is likely pulled back and not making firm contact with the roof of your mouth.",
        "minimal_pairs": [("light", "right"), ("lead", "read")],
        "easier_words": ["lip", "log", "tall"],
        "practice_sentence": "Little lucky ladybugs landed on the leaf."
    },
    "θ": {
        "name": "Voiceless dental fricative (Unvoiced 'th')",
        "placement": "Place the tip of your tongue slightly between your upper and lower front teeth. Blow air gently. Do NOT use your voice.",
        "common_substitutions": ["s", "t", "f"],
        "why_wrong": "You might be pulling your tongue behind your teeth (making an /s/ or /t/) or biting your lip (making an /f/).",
        "minimal_pairs": [("think", "sink"), ("three", "tree"), ("thought", "fought")],
        "easier_words": ["thumb", "math", "bath"],
        "practice_sentence": "I think the three thieves threw the things."
    },
    "ð": {
        "name": "Voiced dental fricative (Voiced 'th')",
        "placement": "Place the tip of your tongue between your teeth and blow air, but THIS TIME vibrate your vocal cords (make a buzzing sound).",
        "common_substitutions": ["d", "z", "v"],
        "why_wrong": "You are either completely stopping the air behind your teeth (making a /d/) or biting your lip (/v/).",
        "minimal_pairs": [("then", "den"), ("breathe", "breed"), ("they", "day")],
        "easier_words": ["the", "this", "mother"],
        "practice_sentence": "This and that, those and these are there."
    },
    "ʃ": {
        "name": "Voiceless postalveolar fricative ('sh')",
        "placement": "Round your lips, raise the blade of your tongue toward the roof of your mouth (further back than /s/) and blow a steady stream of air.",
        "common_substitutions": ["s", "tʃ"],
        "why_wrong": "Your tongue is too far forward and lips aren't rounded (making /s/), or you are stopping the air first (making /ch/).",
        "minimal_pairs": [("ship", "sip"), ("shoe", "sue"), ("shell", "sell")],
        "easier_words": ["she", "fish", "shop"],
        "practice_sentence": "She sells shiny sea shells on the ship."
    },
    "s": {
        "name": "Voiceless alveolar fricative",
        "placement": "Keep your lips relaxed, tongue tip behind your top teeth (or resting behind bottom teeth), push air through the narrow gap.",
        "common_substitutions": ["ʃ", "θ"],
        "why_wrong": "You might be sticking your tongue out (/th/) or rounding your lips too much (/sh/).",
        "minimal_pairs": [("sip", "ship"), ("sue", "shoe")],
        "easier_words": ["sun", "bus", "sat"],
        "practice_sentence": "Sam saw seven small silver snakes."
    },
    "p": {
        "name": "Voiceless bilabial plosive",
        "placement": "Press both lips together firmly to stop the air. Then release it with a sudden puff of air (no voice).",
        "common_substitutions": ["b", "f"],
        "why_wrong": "You are vibrating your vocal cords (making /b/) or not closing your lips fully (making /f/).",
        "minimal_pairs": [("pig", "big"), ("pear", "bear")],
        "easier_words": ["pop", "pen", "cup"],
        "practice_sentence": "Peter Piper picked a peck of pickled peppers."
    },
    "b": {
        "name": "Voiced bilabial plosive",
        "placement": "Press both lips together firmly to stop the air. Vibrate your vocal cords as you release the air.",
        "common_substitutions": ["p", "v"],
        "why_wrong": "You are forgetting to use your voice (/p/) or not closing your lips fully (/v/).",
        "minimal_pairs": [("big", "pig"), ("bear", "pear")],
        "easier_words": ["boy", "cab", "rub"],
        "practice_sentence": "A big black bear bit a big black bug."
    }
}

GENERIC_PHONEME = {
    "name": "Unknown Phoneme",
    "placement": "Listen carefully to the reference audio and try to mimic the exact mouth shape.",
    "common_substitutions": [],
    "why_wrong": "Your articulation didn't quite match the native sound. Try slowing down.",
    "minimal_pairs": [],
    "easier_words": [],
    "practice_sentence": "Practice makes perfect."
}

def get_syllable_breakdown(word: str) -> Dict[str, Any]:
    """Retrieve syllable breakdown and stress using CMUDict."""
    word = word.lower().strip()
    if word not in cmu_dict:
        return {"word": word, "syllable_count": 0, "stress_index": -1, "cmu_phonemes": []}
    
    pronunciation = cmu_dict[word][0]
    vowels = [ph for ph in pronunciation if ph[-1].isdigit()]
    syllable_count = len(vowels)
    
    stress_index = -1
    for i, v in enumerate(vowels):
        if v.endswith('1'):
            stress_index = i
            break
            
    return {
        "word": word,
        "syllable_count": syllable_count,
        "stress_index": stress_index + 1 if stress_index != -1 else 0,
        "cmu_phonemes": pronunciation
    }

def generate_tutor_card(word: str, expected_phoneme: str, actual_phoneme: str) -> Dict[str, Any]:
    """Generate the full educational payload for a mispronounced word."""
    kb_data = GENERIC_PHONEME
    for key, data in PHONEME_KB.items():
        if key in expected_phoneme.lower() or expected_phoneme.lower() in key:
            kb_data = data
            break

    syllable_info = get_syllable_breakdown(word)

    return {
        "word": word,
        "expected_phoneme": expected_phoneme,
        "actual_phoneme": actual_phoneme,
        "tutor_data": {
            "name": kb_data["name"],
            "placement_guide": kb_data["placement"],
            "why_wrong": kb_data["why_wrong"].replace("actual", actual_phoneme),
            "common_substitutions": kb_data["common_substitutions"],
            "minimal_pairs": [{"correct": c, "incorrect": i} for c, i in kb_data["minimal_pairs"]],
            "easier_words": kb_data["easier_words"],
            "practice_sentence": kb_data["practice_sentence"]
        },
        "syllable_info": syllable_info
    }

def get_personalized_practice(weaknesses: List[str]) -> List[Dict[str, str]]:
    """Return practice sentences targeting the specific weak phonemes."""
    practice = []
    for weak in weaknesses:
        for key, data in PHONEME_KB.items():
            if key in weak.lower() or weak.lower() in key:
                practice.append({
                    "target_phoneme": weak,
                    "focus": key,
                    "sentence": data["practice_sentence"],
                    "minimal_pairs": data["minimal_pairs"]
                })
                break
    
    if not practice:
        practice.append({
            "target_phoneme": "General",
            "focus": "Clear Speech",
            "sentence": "The quick brown fox jumps over the lazy dog.",
            "minimal_pairs": []
        })
        
    return practice
