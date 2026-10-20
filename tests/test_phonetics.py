"""Tests for tokenisation, dictionary lookup, syllables and alignment."""

from backend import phonetics


def test_tokenize_normalises_punctuation_numbers_and_hyphens():
    assert phonetics.tokenize("Data-driven, 25 times!") == ["data", "driven", "twenty", "five", "times"]
    assert phonetics.tokenize("Everyone’s café") == ["everyone's", "cafe"]


def test_display_tokens_keep_casing():
    assert phonetics.display_tokens("Data-driven, 10 times") == ["Data", "driven", "ten", "times"]


def test_cmudict_pronunciation_uses_ipa_tokens():
    pron = phonetics.primary_pronunciation("church")

    assert pron.source == "cmudict"
    assert pron.phonemes == ("tʃ", "ɝ", "tʃ")


def test_ipa_string_marks_stress():
    assert phonetics.ipa_string(phonetics.primary_pronunciation("beautiful")) == "ˈbjutəfəl"
    assert phonetics.ipa_string(phonetics.primary_pronunciation("cat")) == "kæt"


def test_syllabify_uses_maximal_onset():
    syllables = phonetics.syllabify(phonetics.primary_pronunciation("extra"))

    assert [s["phonemes"] for s in syllables] == [["ɛ", "k"], ["s", "t", "r", "ə"]]
    assert syllables[0]["stress"] == 1


def test_align_prefers_substitution_and_reports_ops():
    ops, cost = phonetics.align(list("kitten"), list("sitting"), lambda a, b: 0.0 if a == b else 1.0)

    assert cost == 3
    assert [op[0] for op in ops].count("replace") == 2
    assert [op[0] for op in ops].count("insert") == 1


def test_compare_words_gives_partial_credit_for_near_sounds():
    near = phonetics.compare_words("ship", "sheep").similarity
    far = phonetics.compare_words("ship", "shop").similarity

    assert 0 < far < near < 1


def test_unpronounceable_tokens_fall_back_to_spelling():
    pron = phonetics.primary_pronunciation("qzxv")

    assert pron.source == "spelling"
    assert phonetics.ipa_string(pron) == ""


def test_rule_fallback_pinpoints_sounds_in_non_words():
    """Whisper often writes mispronunciations as non-words; rules recover the phonemes."""
    cases = {("third", "turd"): ("θ", "t"), ("this", "zis"): ("ð", "z"), ("will", "vill"): ("w", "v"), ("very", "bery"): ("v", "b")}
    for (ref, hyp), (expected, actual) in cases.items():
        ops = [(e, a) for kind, e, a in phonetics.compare_words(ref, hyp).ops if kind != "equal"]
        assert ops == [(expected, actual)], (ref, hyp, ops)


def test_rule_pronunciation_basics():
    assert phonetics.rule_pronunciation("bike").phonemes == ("b", "aɪ", "k")
    assert phonetics.rule_pronunciation("merit").phonemes == ("m", "ɛ", "r", "ɪ", "t")
    assert phonetics.rule_pronunciation("bus").phonemes == ("b", "ʌ", "s")


def test_function_words_accept_their_weak_forms():
    def forms(word):
        return {"".join(p.phonemes) for p in phonetics.pronunciations(word)}

    reduced = {"a": "ə", "an": "ən", "the": "ðə", "to": "tə", "for": "fɚ", "of": "əv", "and": "ən", "can": "kən",
               "was": "wəz", "were": "wɚ", "have": "həv", "has": "həz", "them": "ðəm", "from": "frəm", "you": "jə",
               "your": "jɚ", "at": "ət", "as": "əz", "but": "bət", "that": "ðət"}
    for word, weak in reduced.items():
        assert weak in forms(word), word
    assert phonetics.primary_pronunciation("and").phonemes == ("ə", "n", "d")  # the citation form still comes first


def test_weak_forms_never_change_a_consonant():
    assert "də" not in {"".join(p.phonemes) for p in phonetics.pronunciations("the")}

    def consonants(phonemes):  # an r-coloured vowel keeps the r ("your" as /jɚ/)
        return [ph for p in phonemes for ph in (["r"] if p in ("ɚ", "ɝ") else [p]) if ph not in phonetics.VOWELS]

    for word, variants in phonetics.WEAK_FORMS.items():
        citation = consonants(phonetics.primary_pronunciation(word).phonemes)
        for weak in variants:
            assert consonants(phonetics._from_arpabet(weak.split()).phonemes) == citation or word == "and", (word, weak)  # "and" may drop its d (ən)
