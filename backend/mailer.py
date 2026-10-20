"""
Outgoing email over SMTP, used only for password reset.

Optional: without PRONUNCIATION_COACH_SMTP_HOST and PRONUNCIATION_COACH_MAIL_FROM the app
sends nothing, and the "Forgot password" link stays hidden. Any SMTP provider works
(SES, Mailgun, SendGrid, Postmark, a Gmail app password ...).
"""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from backend.config import settings

logger = logging.getLogger("pronunciation_coach.mailer")


def enabled() -> bool:
    return bool(settings.smtp_host and settings.mail_from)


def send(to: str, subject: str, body: str) -> None:
    """Send one plain-text email; raises on failure (callers decide what the user sees)."""
    message = EmailMessage()
    message["From"], message["To"], message["Subject"] = settings.mail_from, to, subject
    message.set_content(body)
    if settings.smtp_port == 465:
        server: smtplib.SMTP = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15)
    else:
        server = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15)
    with server:
        if settings.smtp_port != 465:
            server.starttls()
        if settings.smtp_user:
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(message)
