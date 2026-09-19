# Security Policy

## Reporting a Vulnerability

Hive stores and processes sensitive developer conversation data. We take security extremely seriously.

**Please do NOT open a public GitHub issue for security vulnerabilities.**

Instead, email: **security@hive-memory.dev** (or open a private GitHub Security Advisory).

Include:
- A description of the vulnerability and its potential impact
- Steps to reproduce or proof-of-concept
- Any suggested mitigations you have identified

We will acknowledge your report within 48 hours and aim to release a patch within 14 days for critical issues.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x (current) | ✅ Active |

## Security Architecture Summary

Hive is local-first by design. The full threat model is documented in [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md).

Key guarantees:

- **AES-256-GCM** authenticated encryption for all stored content
- **HMAC-SHA256 blind indexing** — search without decrypting plaintext
- **Pre-storage secret scrubbing** — API keys, tokens, and connection strings are redacted before any indexing
- **No cloud egress** — plaintext conversation content never leaves your machine

