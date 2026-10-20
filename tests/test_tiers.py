"""Confidence tiers: "Fix this" and "Worth checking" slips, and what each one is allowed to change."""

import json

import httpx
import numpy as np
import pytest
from sqlalchemy import create_engine, inspect, text

from backend import pronunciation, teaching
from backend.acoustic import PhonemeResult, WordAcoustics
from backend.coach import CoachRequest, CoachService, template_reply
from backend.database import init_db
from backend.phonetics import primary_pronunciation
from backend.pronunciation import CHECK, FIX, PHONEME_ERROR, PHONEME_FIX, PronunciationScorer, sound_tier
from backend.repositories import find_user, observations, save_attempt, weakness_rows

CLEAN = 0.97
BORDERLINE = (PHONEME_FIX + PHONEME_ERROR) / 2
SURE = PHONEME_FIX / 2


def heard(word, probabilities, alternative="s"):
    """Acoustic evidence for `word`, one probability per dictionary sound."""
    pron = primary_pronunciation(word)
    assert len(probabilities) == len(pron.phonemes)
    return WordAcoustics(
        pron,
        [
            PhonemeResult(ph, p, -1.0, alternative, 0.1 * i, 0.1 * i + 0.1)
            for i, (ph, p) in enumerate(zip(pron.phonemes, probabilities, strict=True))
        ],
    )


def score(monkeypatch, think_probabilities, so_probabilities=(CLEAN, CLEAN)):
    """Score "I think so." with the given probabilities for each sound of "think" (θ ɪ ŋ k) and "so"."""
    evidence = [heard("i", [CLEAN]), heard("think", list(think_probabilities)), heard("so", list(so_probabilities))]
    monkeypatch.setattr(pronunciation, "analyse_acoustics", lambda tokens, log_probs, inventory: evidence)
    scorer = PronunciationScorer(inventory=object())  # the fake analysis never touches the inventory
    words = [
        {"word": w, "start": 0.2 + 0.4 * i, "end": 0.5 + 0.4 * i, "probability": 0.95} for i, w in enumerate(["I", "think", "so"])
    ]
    return scorer.score_pronunciation("I think so.", "I think so", "intermediate", words, 1.6, np.zeros((10, 3)))


def test_sound_tier_boundaries():
    assert sound_tier(PHONEME_ERROR) is None and sound_tier(0.99) is None
    assert sound_tier(PHONEME_ERROR - 0.001) == CHECK
    assert sound_tier(PHONEME_FIX) == CHECK
    assert sound_tier(PHONEME_FIX - 0.001) == FIX
    assert 0 < PHONEME_FIX < PHONEME_ERROR


def test_tiers_label_slips_without_changing_any_score(monkeypatch):
    as_checked = score(monkeypatch, [SURE, CLEAN, CLEAN, BORDERLINE])
    monkeypatch.setattr(pronunciation, "PHONEME_FIX", 1.0)  # every flagged sound becomes "fix"
    all_fix = score(monkeypatch, [SURE, CLEAN, CLEAN, BORDERLINE])
    monkeypatch.setattr(pronunciation, "PHONEME_FIX", 0.0)  # every flagged sound becomes "check"
    all_check = score(monkeypatch, [SURE, CLEAN, CLEAN, BORDERLINE])

    for other in (all_fix, all_check):
        assert other["score"] == as_checked["score"] and other["metrics"] == as_checked["metrics"]
        assert [(w["status"], w["score"]) for w in other["words"]] == [(w["status"], w["score"]) for w in as_checked["words"]]
    think = as_checked["words"][1]
    assert [p["tier"] for p in think["phonemes"]] == [FIX, None, None, CHECK]
    assert [op["tier"] for op in think["alignment"]] == [FIX, None, None, CHECK]
    assert think["tier"] == FIX  # the surest slip names the word


def test_a_borderline_slip_is_worded_as_uncertain_and_is_not_a_weak_sound(monkeypatch):
    result = score(monkeypatch, [BORDERLINE, CLEAN, CLEAN, CLEAN])
    think = result["words"][1]

    assert think["status"] == "mispronounced" and think["tier"] == CHECK
    assert think["phonemes"][0]["flagged"] is True and think["phonemes"][0]["tier"] == CHECK
    insight = result["insights"][0]
    assert insight["tier"] == CHECK and insight["severity"] == "medium" and "Worth checking" in insight["title"]
    assert result["weak_phonemes"] == []


def test_a_sure_slip_leads_the_insight_even_when_a_borderline_one_comes_first(monkeypatch):
    result = score(monkeypatch, [BORDERLINE, CLEAN, CLEAN, SURE])
    insight = result["insights"][0]
    assert insight["tier"] == FIX and insight["severity"] == "high" and insight["expected"] == "k"
    assert result["weak_phonemes"] == ["k"]


# --- what gets saved, and what counts against mastery --------------------------------


def saved(session_factory, results):
    db = session_factory()
    for result in results:
        save_attempt(db, "Asha", "key-1", "I think so.", "I think so", result)
    user = find_user(db, "Asha")
    return db, user


def test_only_fix_slips_count_against_mastery(monkeypatch, session_factory):
    db, user = saved(session_factory, [score(monkeypatch, [BORDERLINE, CLEAN, CLEAN, SURE])])

    rows = {(p, w): (ok, s) for p, ok, s, w, _t in observations(db, user)}
    assert rows[("θ", "think")][0] is True  # borderline: stored, but as clean
    assert rows[("k", "think")][0] is False
    assert weakness_rows(db, user, 5) == [("k", 1)]  # mistakes are "Fix this" slips only
    tiers = dict(db.execute(text("SELECT phoneme, tier FROM phoneme_observations WHERE word = 'think'")).all())
    assert tiers == {"θ": CHECK, "ɪ": None, "ŋ": None, "k": FIX}
    db.close()


def test_little_history_with_only_borderline_slips_does_not_claim_mastery(monkeypatch, session_factory):
    # One attempt, one borderline slip: no sound has enough tries, nothing is weak, and the
    # coach must not say the learner's sounds are "in good shape".
    db, user = saved(session_factory, [score(monkeypatch, [BORDERLINE, CLEAN, CLEAN, CLEAN])])
    plan = teaching.build_plan(observations(db, user))

    assert weakness_rows(db, user, 5) == []
    assert plan["focus"]["why"] == "starter"
    assert "good shape" not in plan["focus"]["reason"]
    assert plan["also_work_on"] == [] and plan["strengths"] == []
    assert plan["session"] and plan["focus"]["words"]
    db.close()


def test_a_first_sure_slip_becomes_the_focus_before_there_is_enough_history(monkeypatch, session_factory):
    db, user = saved(session_factory, [score(monkeypatch, [CLEAN, CLEAN, CLEAN, CLEAN], so_probabilities=(SURE, CLEAN))])
    plan = teaching.build_plan(observations(db, user))

    assert weakness_rows(db, user, 5) == [("s", 1)]
    assert plan["focus"]["phoneme"] == "s" and plan["focus"]["why"] == "early"
    assert "early days" in plan["focus"]["reason"].lower() and "1 of 1 time" in plan["focus"]["reason"]
    db.close()


def test_a_few_clean_tries_are_not_reported_as_maintenance():
    rows = [("θ", True, 95.0, "think", None), ("θ", True, 96.0, "thin", None), ("r", True, 97.0, "red", None)]
    assert teaching.choose_focus(teaching.compute_mastery(rows)) == ("θ", "starter")


def test_the_tier_column_is_added_to_an_existing_database(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'before_tiers.db'}")
    assert init_db(engine)
    with engine.begin() as conn:  # the table as it was before tiers
        conn.execute(text("DROP TABLE phoneme_observations"))
        conn.execute(text(
            "CREATE TABLE phoneme_observations (id INTEGER PRIMARY KEY, record_id INTEGER NOT NULL, "
            "phoneme VARCHAR(8) NOT NULL, word VARCHAR, ok BOOLEAN NOT NULL, score FLOAT)"
        ))
        conn.execute(text("INSERT INTO phoneme_observations (record_id, phoneme, word, ok) VALUES (1, 'θ', 'think', 0)"))

    assert init_db(engine)
    assert "tier" in {c["name"] for c in inspect(engine).get_columns("phoneme_observations")}
    with engine.connect() as conn:
        assert conn.execute(text("SELECT phoneme, ok, tier FROM phoneme_observations")).one() == ("θ", 0, None)
    engine.dispose()


# --- the coach explains only "Fix this" slips -----------------------------------------


def slip(word, expected, tier, actual="s"):
    return {"word": word, "kind": "substitution", "expected": expected, "actual": actual, "tier": tier}


def test_only_borderline_slips_get_a_mostly_clean_summary_and_no_tips():
    reply = template_reply(CoachRequest(target_text="I think so.", score=88, slips=[slip("think", "θ", "check")]))

    assert reply.tips == [] and reply.one_thing is None
    assert reply.worth_checking == ["think"]
    assert "mostly clean" in reply.summary and "“think”" in reply.summary
    assert "Clean delivery" not in reply.summary  # never claims a perfect attempt


def test_tips_are_given_for_fix_slips_only():
    reply = template_reply(CoachRequest(
        target_text="I think three things.",
        score=70,
        slips=[slip("think", "θ", "check"), slip("three", "θ", "fix"), slip("three", "r", "check", "l"), slip("things", "ŋ", None)],
    ))

    assert [(t.word, t.phoneme) for t in reply.tips] == [("three", "θ"), ("things", "ŋ")]  # untiered (older clients) count as fix
    assert reply.worth_checking == ["think"]  # "three" has a sure slip, so it is not listed again


@pytest.mark.anyio
async def test_the_model_never_sees_or_explains_borderline_slips():
    seen = {}

    def handler(request):
        seen["facts"] = json.loads(json.loads(request.content)["messages"][1]["content"])
        content = {
            "summary": "Perfect! Every word was flawless.",
            "one_thing": "Bite your tongue.",
            "tips": [{"word": "think", "phoneme": "θ", "tip": "Put your tongue between your teeth."}],
            "practice_sentence": "Think of three things.",
        }
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(content)}}]})

    service = CoachService("test-key", "test-model", transport=httpx.MockTransport(handler))
    reply = await service.coach(CoachRequest(target_text="I think so.", score=90, slips=[slip("think", "θ", "check")]))

    assert seen["facts"]["slips"] == [] and seen["facts"]["worth_checking"] == ["think"]
    assert reply.source == "groq"
    assert reply.tips == [] and reply.one_thing is None  # a tip about a borderline word is dropped
    assert "perfect" not in reply.summary.lower() and "mostly clean" in reply.summary
    assert reply.worth_checking == ["think"]
