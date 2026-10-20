"""Interview from your CV: reading the file, keeping personal details private, and questions about this candidate."""

import io
import json
import zipfile

import httpx
import pytest

from backend import cv
from backend.api import interview as interview_api
from backend.coach import CoachService
from tests.conftest import PROFILE_KEY, timed_words, wav_bytes

HEADERS = {"X-Profile-Key": PROFILE_KEY}

CV_TEXT = """Asha Verma
asha.verma@example.com | +91 98765 43210 | linkedin.com/in/ashaverma

Summary
Backend developer with three years of experience building payment systems.

Experience
Software Engineer | FinPay Solutions, Pune | 2022 - present
• Built the UPI refunds service in Python and FastAPI, cutting refund time from 3 days to 4 hours.
• Moved reporting jobs to PostgreSQL and Docker.
Intern | Brightlabs | 2021

Projects
Payment Reconciliation Tool
• Matched bank statements with orders using Pandas.
Campus Event App

Skills
Python, FastAPI, PostgreSQL, Docker, Git, SQL, Pandas

Education
B.Tech Computer Science, 2021
"""

JOB_AD = """Backend Engineer
We are hiring a backend engineer to build our lending platform.
You will work with Python, Kubernetes and AWS, and mentor junior engineers.
"""


def docx_bytes(paragraphs):
    ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    body = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paragraphs)
    xml = f'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="{ns}"><w:body>{body}</w:body></w:document>'
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", xml)
    return buffer.getvalue()


def pdf_bytes(lines):
    """A minimal one-page PDF with a text layer."""
    content = "BT /F1 11 Tf 50 750 Td 14 TL " + " ".join(f"({line}) Tj T*" for line in lines) + " ET"
    objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        f"<< /Length {len(content)} >>\nstream\n{content}\nendstream",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(f"{number} 0 obj\n{body}\nendobj\n".encode())
    xref = out.tell()
    out.write(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets:
        out.write(f"{offset:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return out.getvalue()


# --- reading ------------------------------------------------------------------------------------


def test_a_cv_is_read_from_pdf_word_or_text():
    lines = ["Experience", "Software Engineer at FinPay", "Built the refunds service in Python and FastAPI"]
    assert "refunds service" in cv.extract_text(pdf_bytes(lines), "cv.pdf")
    assert "refunds service" in cv.extract_text(docx_bytes(lines), "cv.docx")
    assert "refunds service" in cv.extract_text("\n".join(lines).encode(), "cv.txt")


@pytest.mark.parametrize(
    ("data", "name", "code"),
    [
        (pdf_bytes([]), "scan.pdf", "cv_scanned"),
        (b"x" * (cv.MAX_FILE_BYTES + 1), "big.pdf", "cv_too_large"),
        (b"\x89PNG....", "photo.png", "cv_unsupported"),
        (b"PK\x03\x04 not really a zip", "cv.docx", "cv_unreadable"),
    ],
    ids=["scanned-pdf", "too-large", "image", "broken-docx"],
)
def test_unreadable_cvs_say_what_to_do(data, name, code):
    with pytest.raises(cv.CVError) as error:
        cv.extract_text(data, name)
    assert error.value.code == code and "paste" in str(error.value).lower()


def test_personal_details_are_removed_before_anything_leaves_the_server():
    facts = cv.model_facts(CV_TEXT, JOB_AD, "Experienced (2-7 years)", 5)
    sent = json.dumps(facts)
    assert "asha.verma@example.com" not in sent and "98765" not in sent and "linkedin.com/in" not in sent
    assert "Asha Verma" in facts["cv"]  # the name goes with the CV; contact details do not
    assert "2022" in facts["cv"]  # years are not phone numbers


def test_parsing_finds_the_role_projects_and_skills_and_what_the_job_adds():
    found = cv.read_profile(CV_TEXT, JOB_AD)
    assert found["current_role"] == "Software Engineer"
    assert found["projects"][:2] == ["Payment Reconciliation Tool", "Campus Event App"]
    assert {"Python", "FastAPI", "PostgreSQL", "Docker"} <= set(found["skills"])
    assert found["job_title"] == "Backend Engineer"
    assert found["shared_skills"] == ["Python"] and set(found["missing_skills"]) == {"Kubernetes", "AWS"}


# --- questions ----------------------------------------------------------------------------------


@pytest.mark.parametrize("count", cv.COUNTS)
def test_without_the_model_questions_are_still_about_this_cv(count):
    questions = cv.fallback_questions(cv.read_profile(CV_TEXT, JOB_AD), count)
    assert len(questions) == count and questions[0]["kind"] == "intro"
    text = " ".join(q["text"] for q in questions)
    assert "Payment Reconciliation Tool" in text and "Python" in text
    if count >= 5:
        assert "Backend Engineer" in text and "Kubernetes" in text  # the job and what the CV lacks


def test_a_cv_with_nothing_to_parse_gets_sensible_questions():
    questions = cv.fallback_questions(cv.read_profile("I have worked in a shop for two years and like people.", ""), 5)
    assert len(questions) == 5 and all(q["text"].endswith(("?", ".")) for q in questions)


MODEL_QUESTIONS = {
    "questions": [
        {"kind": "intro", "text": "I see you're at FinPay. Walk me through your background.", "about": "FinPay role"},
        {"kind": "motivation", "text": "Why do you want to move into lending?", "about": "Job advert"},
        {"kind": "behavioural", "text": "You cut refund time to 4 hours. How did you do it?", "about": "UPI refunds service"},
        {"kind": "role", "text": "How would you keep patient health records secure if you moved to healthcare?", "about": "Security"},
        {"kind": "tough", "text": "The role needs Kubernetes. How would you get up to speed?", "about": "Kubernetes"},
    ]
}


def test_the_models_questions_are_kept_when_they_are_proper():
    questions = cv.parse_questions(MODEL_QUESTIONS, 5)
    assert [q["kind"] for q in questions] == ["intro", "motivation", "behavioural", "role", "tough"]
    assert "patient health records" in questions[3]["text"]  # health as a work topic is fine


@pytest.mark.parametrize(
    "question",
    ["Are you married?", "How old are you, roughly?", "What is your religion?", "Do you have any children yet?", "What caste are you from?"],
)
def test_questions_about_personal_life_are_never_asked(question):
    bad = {"questions": [*MODEL_QUESTIONS["questions"][:4], {"kind": "tough", "text": question, "about": "x"}]}
    with pytest.raises(ValueError):
        cv.parse_questions(bad, 5)


# --- the API ------------------------------------------------------------------------------------


def start_from_cv(client, **fields):
    data = {"cv_text": CV_TEXT, "job_ad": JOB_AD, "level": "mid", "count": "5", **fields}
    return client.post("/api/interview/cv", data=data, headers=HEADERS)


def test_a_pasted_cv_starts_a_saved_interview_about_the_candidate(client, fake_asr):
    body = start_from_cv(client, username="asha").json()
    assert body["type"] == "cv" and body["type_label"] == "From your CV" and body["saved"] and body["source"] == "template"
    assert [q["index"] for q in body["questions"]] == [0, 1, 2, 3, 4]
    assert body["questions"][2]["about"] == "Payment Reconciliation Tool"
    assert body["read"]["missing_skills"] == ["Kubernetes", "AWS"]

    question = body["questions"][2]
    fake_asr.text = "In my last job I built the reconciliation tool myself and as a result we found errors faster."
    fake_asr.words = timed_words(fake_asr.text)
    answer = client.post(
        "/api/interview/answer",
        data={"question_id": question["id"], "session_id": str(body["id"]), "question_index": "2", "username": "asha"},
        files={"audio": ("a.wav", wav_bytes(), "audio/wav")},
        headers=HEADERS,
    ).json()
    assert answer["saved"] and answer["question"]["text"] == question["text"] and answer["question"]["kind"] == "behavioural"

    detail = client.get(f"/api/interview/sessions/asha/{body['id']}", headers=HEADERS).json()
    assert detail["type"] == "cv" and detail["questions"][2]["text"] == question["text"] and detail["answered"] == 1
    assert "asha.verma@example.com" not in json.dumps(detail) and "FinPay Solutions, Pune" not in json.dumps(detail)


def test_an_uploaded_cv_works_and_an_unsaved_cv_question_can_be_answered(client, fake_asr):
    files = {"cv_file": ("cv.docx", docx_bytes(CV_TEXT.split("\n")), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
    body = client.post("/api/interview/cv", data={"count": "3"}, files=files, headers=HEADERS).json()
    assert body["saved"] is False and len(body["questions"]) == 3
    question = body["questions"][1]
    fake_asr.text, fake_asr.words = "I built it with Pandas.", timed_words("I built it with Pandas.")
    answer = client.post(
        "/api/interview/answer",
        data={"question_id": question["id"], "question_text": question["text"], "question_kind": question["kind"]},
        files={"audio": ("a.wav", wav_bytes(), "audio/wav")},
    )
    assert answer.status_code == 200 and answer.json()["question"]["text"] == question["text"]


def test_no_cv_or_an_unreadable_one_is_explained(client):
    missing = client.post("/api/interview/cv", data={"cv_text": "hi"})
    assert missing.status_code == 400 and missing.json()["code"] == "cv_missing"
    scan = client.post("/api/interview/cv", files={"cv_file": ("scan.pdf", pdf_bytes([]), "application/pdf")})
    assert scan.status_code == 400 and scan.json()["code"] == "cv_scanned"


def test_the_model_writes_the_questions_from_a_redacted_cv(client, monkeypatch):
    seen = {}

    def handler(request):
        seen["facts"] = json.loads(json.loads(request.content)["messages"][1]["content"])
        return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(MODEL_QUESTIONS)}}]})

    monkeypatch.setattr(interview_api, "get_coach", lambda: CoachService("k", "m", transport=httpx.MockTransport(handler)))
    body = start_from_cv(client, username="asha").json()
    assert body["source"] == "groq" and body["questions"][2]["text"] == MODEL_QUESTIONS["questions"][2]["text"]
    assert "asha.verma@example.com" not in json.dumps(seen["facts"]) and seen["facts"]["number_of_questions"] == 5
    assert "Backend Engineer" in seen["facts"]["job_advert"]


def test_cv_interviews_are_not_offered_as_a_bank_type(client):
    assert "cv" not in [t["id"] for t in client.get("/api/interview/options").json()["types"]]


def test_a_cv_interview_can_be_taken_again_with_the_same_questions(client):
    first = start_from_cv(client, username="asha").json()
    again = client.post(f"/api/interview/sessions/asha/{first['id']}/repeat", headers=HEADERS).json()
    assert again["id"] != first["id"] and again["type"] == "cv"
    assert [q["text"] for q in again["questions"]] == [q["text"] for q in first["questions"]]
    assert client.post("/api/interview/sessions/asha/999999/repeat", headers=HEADERS).status_code == 404
