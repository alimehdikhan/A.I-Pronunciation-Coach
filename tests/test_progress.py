"""History filters and paging, and the richer analytics (improvement, calendar, mastery, tricky words)."""

from tests.conftest import PROFILE_KEY, timed_words, wav_bytes

HEADERS = {"X-Profile-Key": PROFILE_KEY}


def attempt(client, fake_asr, said, target="Hello world", username="Sam"):
    fake_asr.text, fake_asr.words = said, timed_words(said)
    response = client.post(
        "/api/evaluate",
        files={"audio": ("clip.wav", wav_bytes(), "audio/wav")},
        data={"target_text": target, "username": username, "difficulty": "beginner"},
        headers=HEADERS,
    )
    assert response.status_code == 200 and response.json()["saved"] is True
    return response.json()


def test_history_pages_and_reports_the_total(client, fake_asr):
    for _ in range(5):
        attempt(client, fake_asr, "Hello world")

    first = client.get("/api/history/Sam", params={"limit": 2}, headers=HEADERS).json()
    second = client.get("/api/history/Sam", params={"limit": 2, "offset": 2}, headers=HEADERS).json()
    last = client.get("/api/history/Sam", params={"limit": 2, "offset": 4}, headers=HEADERS).json()

    assert first["total"] == second["total"] == last["total"] == 5
    assert (len(first["records"]), len(second["records"]), len(last["records"])) == (2, 2, 1)
    ids = [r["id"] for r in first["records"] + second["records"] + last["records"]]
    assert ids == sorted(ids, reverse=True) and len(set(ids)) == 5  # newest first, no repeats


def test_history_filters_by_score_and_phrase(client, fake_asr):
    attempt(client, fake_asr, "Hello world")  # clean
    attempt(client, fake_asr, "Hello word")  # a slip on "world"
    attempt(client, fake_asr, "Good morning", target="Good morning")

    records = client.get("/api/history/Sam", params={"limit": 50}, headers=HEADERS).json()["records"]
    scores = sorted(r["score"] for r in records)
    assert scores[0] < scores[-1]

    high = client.get("/api/history/Sam", params={"min_score": scores[-1] - 0.01}, headers=HEADERS).json()
    assert 1 <= high["total"] < 3 and all(r["score"] >= scores[-1] - 0.01 for r in high["records"])

    low = client.get("/api/history/Sam", params={"max_score": scores[0] + 0.01}, headers=HEADERS).json()
    assert low["total"] >= 1 and all(r["score"] <= scores[0] + 0.01 for r in low["records"])

    phrase = client.get("/api/history/Sam", params={"q": "morning"}, headers=HEADERS).json()
    assert phrase["total"] == 1 and phrase["records"][0]["target_text"] == "Good morning"
    assert client.get("/api/history/Sam", params={"q": "100%"}, headers=HEADERS).json()["total"] == 0  # not a wildcard


def test_history_filters_stay_private(client, fake_asr):
    attempt(client, fake_asr, "Hello world")
    assert client.get("/api/history/Sam", params={"q": "hello"}, headers={"X-Profile-Key": "x" * 43}).status_code == 403


def test_analytics_includes_calendar_mastery_and_tricky_words(client, fake_asr):
    for _ in range(6):
        attempt(client, fake_asr, "Hello word")  # "world" -> "word" every time

    body = client.get("/api/analytics/Sam", headers=HEADERS).json()

    calendar = body["daily_activity"]
    assert len(calendar) == 84 and calendar[-1]["count"] == 6 and sum(d["count"] for d in calendar) == 6
    assert [d["date"] for d in calendar] == sorted(d["date"] for d in calendar)

    mastery = {m["phoneme"]: m for m in body["sound_mastery"]}
    assert mastery and all({"phoneme", "clean_rate", "attempts", "trend", "status"} <= set(m) for m in mastery.values())
    rates = [m["clean_rate"] for m in body["sound_mastery"]]
    assert rates == sorted(rates)  # weakest first

    assert any(w["word"] == "world" and w["misses"] >= 2 for w in body["tricky_words"])
    assert body["improvement"] is not None and body["improvement"]["attempts"] == 3


def test_analytics_without_history_keeps_the_new_fields_empty(client):
    body = client.get("/api/analytics/Nobody", headers=HEADERS).json()
    assert body["improvement"] is None and body["daily_activity"] == [] and body["sound_mastery"] == []
    assert body["tricky_words"] == []
