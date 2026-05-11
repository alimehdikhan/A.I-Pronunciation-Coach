"""
Pronunciation scoring helpers.

The scorer compares reference and transcribed text at two levels:
phoneme-like strings for pronunciation similarity and normalized words for
exact word accuracy. Epitran is used when available; a conservative text
fallback keeps the API usable if optional English G2P system data is missing.
"""

import logging
import re
from typing import Any, Dict, List
import unicodedata

import epitran
import Levenshtein


logger = logging.getLogger("pronunciation_coach.pronunciation")
WORD_RE = re.compile(r"[a-z0-9]+(?:'[a-z0-9]+)?")


class PronunciationScorer:
    """Scores pronunciation accuracy using phoneme and word comparison."""

    def __init__(self, language: str = "eng-Latn"):
        """
        Initialize pronunciation scorer.

        Args:
            language: Epitran language code, for example "eng-Latn".
        """
        self.language = language
        self.epi = epitran.Epitran(language)
        self.phoneme_backend = "epitran"

    def text_to_phonemes(self, text: str) -> str:
        """Convert text to a phoneme representation with a safe fallback."""
        normalized_text = self.normalize_text(text)
        if not normalized_text:
            return ""

        try:
            phonemes = self.epi.transliterate(normalized_text)
        except Exception:
            logger.warning(
                "Epitran transliteration failed for language '%s'; using text fallback.",
                self.language,
                exc_info=True,
            )
            self.phoneme_backend = "text-fallback"
            return self.fallback_phonemes(normalized_text)

        if not phonemes:
            self.phoneme_backend = "text-fallback"
            return self.fallback_phonemes(normalized_text)

        return phonemes

    @staticmethod
    def normalize_text(text: str) -> str:
        """Normalize user-facing text for consistent comparisons."""
        text = unicodedata.normalize("NFKC", text or "").lower()
        text = re.sub(r"\s+", " ", text).strip()
        return text

    @staticmethod
    def fallback_phonemes(text: str) -> str:
        """Return a simple ASCII-ish representation when IPA is unavailable."""
        decomposed = unicodedata.normalize("NFKD", text)
        ascii_text = decomposed.encode("ascii", "ignore").decode("ascii")
        words = WORD_RE.findall(ascii_text.lower())
        return " ".join(words)

    @classmethod
    def split_words(cls, text: str) -> List[str]:
        """Split text into normalized words without punctuation."""
        return WORD_RE.findall(cls.fallback_phonemes(text))

    def calculate_similarity(self, ref_phonemes: str, trans_phonemes: str) -> float:
        """
        Calculate similarity between two phoneme sequences.

        Returns:
            Similarity score between 0 and 1, where 1 is a perfect match.
        """
        ref_phonemes = ref_phonemes or ""
        trans_phonemes = trans_phonemes or ""
        max_len = max(len(ref_phonemes), len(trans_phonemes))
        if max_len == 0:
            return 1.0

        distance = Levenshtein.distance(ref_phonemes, trans_phonemes)
        return max(0.0, min(1.0, 1 - (distance / max_len)))

    def get_word_level_scores(self, reference_words: List[str], transcribed_words: List[str]) -> List[Dict[str, Any]]:
        """Calculate pronunciation scores for individual words."""
        word_scores = []
        max_len = max(len(reference_words), len(transcribed_words))

        for index in range(max_len):
            ref_word = reference_words[index] if index < len(reference_words) else ""
            trans_word = transcribed_words[index] if index < len(transcribed_words) else ""

            if not ref_word and not trans_word:
                continue

            ref_phonemes = self.text_to_phonemes(ref_word)
            trans_phonemes = self.text_to_phonemes(trans_word)
            similarity = self.calculate_similarity(ref_phonemes, trans_phonemes)

            word_scores.append(
                {
                    "reference_word": ref_word,
                    "transcribed_word": trans_word,
                    "score": round(similarity * 100, 2),
                    "reference_phonemes": ref_phonemes,
                    "transcribed_phonemes": trans_phonemes,
                    "match": ref_word == trans_word,
                }
            )

        return word_scores

    def generate_feedback(self, score: float, accuracy: float, word_scores: List[Dict[str, Any]]) -> str:
        """Generate human-readable feedback based on scores."""
        feedback_parts = []

        if score >= 90:
            feedback_parts.append("Excellent pronunciation! Your speech is very clear and accurate.")
        elif score >= 75:
            feedback_parts.append("Good pronunciation! You're speaking clearly with minor errors.")
        elif score >= 60:
            feedback_parts.append("Fair pronunciation. Keep practicing to improve clarity.")
        else:
            feedback_parts.append("Keep practicing! Focus on pronouncing each word carefully.")

        incorrect_words = [word for word in word_scores if not word["match"] and word["reference_word"]]
        if incorrect_words:
            words = ", ".join(word["reference_word"] for word in incorrect_words[:5])
            feedback_parts.append(f"Words to practice: {words}")

        if accuracy < 100:
            feedback_parts.append(f"Word accuracy: {accuracy}% - Try to pronounce all words clearly.")

        if self.phoneme_backend == "text-fallback":
            feedback_parts.append(
                "Phoneme scoring is using a text fallback because the IPA transliteration backend is unavailable."
            )

        return "\n\n".join(feedback_parts)

    def score_pronunciation(self, reference_text: str, transcribed_text: str) -> Dict[str, Any]:
        """
        Compare reference and transcribed text and return scoring details.
        """
        reference_text = self.normalize_text(reference_text)
        transcribed_text = self.normalize_text(transcribed_text)

        if not reference_text:
            return {
                "score": 0.0,
                "accuracy": 0.0,
                "phoneme_analysis": {
                    "reference_phonemes": "",
                    "transcribed_phonemes": self.text_to_phonemes(transcribed_text),
                    "phoneme_similarity": 0.0,
                    "backend": self.phoneme_backend,
                },
                "word_level_scores": [],
                "feedback": "No reference text was provided for pronunciation scoring.",
            }

        ref_phonemes = self.text_to_phonemes(reference_text)
        trans_phonemes = self.text_to_phonemes(transcribed_text)
        phoneme_score = self.calculate_similarity(ref_phonemes, trans_phonemes)

        ref_words = self.split_words(reference_text)
        trans_words = self.split_words(transcribed_text)
        word_scores = self.get_word_level_scores(ref_words, trans_words)

        correct_words = sum(1 for word in word_scores if word["match"])
        total_words = len(ref_words)
        word_accuracy = (correct_words / total_words * 100) if total_words else 0.0

        final_score = (phoneme_score * 70) + (word_accuracy * 0.30)
        final_score = max(0.0, min(100.0, round(final_score, 2)))

        return {
            "score": final_score,
            "accuracy": round(word_accuracy, 2),
            "phoneme_analysis": {
                "reference_phonemes": ref_phonemes,
                "transcribed_phonemes": trans_phonemes,
                "phoneme_similarity": round(phoneme_score * 100, 2),
                "backend": self.phoneme_backend,
            },
            "word_level_scores": word_scores,
            "feedback": self.generate_feedback(final_score, word_accuracy, word_scores),
        }
