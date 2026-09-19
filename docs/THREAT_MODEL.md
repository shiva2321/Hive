# Enterprise Security Threat Model (STRIDE)

This document presents the STRIDE threat analysis for the **Universal Cross-AI Memory Platform**, identifying critical attack vectors when processing sensitive chat logs and establishing production mitigations.

---

## 1. Threat Matrix & Mitigations

| Category | Potential Threat | Impact | Implemented Mitigation |
| :--- | :--- | :--- | :--- |
| **Spoofing** | Adversary impersonates another tenant or injects forged chat history via API. | High | Cryptographically signed JWT tokens with tenant claims + HMAC-SHA256 API key verification. |
| **Tampering** | Malicious alteration of historical decisions or database records. | High | **AES-256-GCM** authenticated encryption with 128-bit authentication tags. Tampered ciphertext immediately fails verification and aborts. |
| **Repudiation** | User denies altering architectural guardrails or accessing sensitive memories. | Medium | Append-only `audit_logs` table recording actor ID, tenant ID, action, IP address, and timestamp. |
| **Information Disclosure** | Cloud database breach leaks developer API keys, database credentials, or proprietary source code. | Critical | **Zero-Knowledge Envelope Encryption**: Plaintext is never stored unencrypted. Local pre-embedding **regex & Shannon entropy scanner** redacts keys before storage. |
| **Denial of Service** | Ingestion flood: uploading 1GB zip archives simultaneously to exhaust server RAM and CPU. | High | Durable SQLite-backed ingestion queue (jobs process one at a time, survive a process restart) plus sliding-window token bucket rate limiting (HTTP 429). No true concurrency cap or streaming unzipper exists yet — see the ingestion-completeness plan for follow-up. |
| **Elevation of Privilege** | Tenant A accesses Tenant B's memories by querying foreign node IDs. | Critical | PostgreSQL **Row-Level Security (RLS)** enforces tenant isolation at the database engine level via `current_setting('app.current_tenant_id')`. |

---

## 2. Secrets & Credential Scrubbing Guarantees

Before any message content or metadata is indexed into vector embeddings or graph relationships, it passes through the `SecretSanitizer` pipeline:
- **OpenAI Keys**: `sk-[A-Za-z0-9]{32,}` $\rightarrow$ `[REDACTED_OPENAI_KEY]`
- **Anthropic Keys**: `sk-ant-[A-Za-z0-9_-]{32,}` $\rightarrow$ `[REDACTED_ANTHROPIC_KEY]`
- **AWS Keys**: `(?:AKIA|ASIA)[A-Z0-9]{16}` $\rightarrow$ `[REDACTED_AWS_KEY]`
- **GitHub Tokens**: `(?:ghp|gho)_[A-Za-z0-9_]{20,}` $\rightarrow$ `[REDACTED_GITHUB_TOKEN]`
- **Connection Strings**: `postgres://user:pass@host/db` $\rightarrow$ `[REDACTED_DB_CONNECTION_STRING]`
- **SSH Private Keys**: `-----BEGIN PRIVATE KEY-----` $\rightarrow$ `[REDACTED_PRIVATE_KEY]`

---

## 3. Cryptographic Specification
* **Algorithm**: AES-256-GCM (NIST SP 800-38D).
* **Key Derivation**: PBKDF2 with SHA-256, 100,000 iterations and per-tenant salt.
* **Nonce/IV**: 96-bit cryptographically secure pseudorandom number generator (CSPRNG) per record, never reused.
* **Tag**: 128-bit authentication tag.
