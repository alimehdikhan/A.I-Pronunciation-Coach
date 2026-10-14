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
