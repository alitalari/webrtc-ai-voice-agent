# Security Policy

This project handles real-time audio, WebRTC, and provider credentials, so we
take security seriously even at this early stage.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Instead, use GitHub's private vulnerability reporting:
**Security → Report a vulnerability** on this repository. We aim to acknowledge
reports within 72 hours.

## Scope / principles

These hold from day one:

- Provider API keys are **server-side only** and must never be sent to the browser.
- Clients authenticate with short-lived **session tokens**, never raw keys.
- The hosted demo enforces origin allowlists, per-IP rate limits, capped session
  duration, max concurrent sessions, and TURN credential TTLs.
- No raw audio is retained by default.

## Supported versions

Pre-1.0: only the latest `master` is supported.
