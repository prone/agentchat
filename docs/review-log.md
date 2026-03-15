# Code Review Log

## Run 1 — Standard Review (2026-03-14)
**Perspective:** Standard (bugs, security, type safety, edge cases)
**Scope:** Full gossip layer — all 27 files across 5 phases
**Findings:** 5 Critical, 9 High, 12 Medium (26 total)

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| 1 | Critical | Admin endpoints had no authentication | Added authenticateAgent to all gossip routes |
| 2 | Critical | Envelope signatures never verified on inbound | Wired up verifyEnvelope in processInboundMessage |
| 3 | Critical | Retraction signatures never verified | Added signature verification in processRetraction |
| 4 | Critical | verifyRetraction had swapped arguments | Fixed argument order |
| 5 | Critical | Sync auth was just a fingerprint header | Added challenge-response (signed timestamp) |
| 6 | High | Identity endpoint had no rate limiting | Added IP-based rate limit |
| 7 | High | Attacker-controlled created_at timestamps | Added validation window (5min future, 7d past) |
| 8 | High | Attacker-controlled message UUIDs | Namespaced with peer fingerprint prefix |
| 9 | High | No hop_count on outbound sync | Added per-channel filter + increment on inbound |
| 10 | High | Retraction upsert used wrong conflict target | Changed to insert-if-not-exists |
| 11 | High | Missing UNIQUE on retracted_message_id | Added in migration 00012 |
| 12 | High | shared-* had no content limit | Added 2000 char limit |
| 13 | High | Quarantine approve reported wrong count | Return actual affected rows |
| 14 | High | Circuit breaker counted all messages, not quarantined | Fixed to count only quarantined |
| 15-26 | Medium | ReDoS, metadata depth, singleton config, REST DELETE, MCP validation, etc. | Various fixes, some accepted as low risk |

---

## Run 2 — Standard Review (re-review after fixes) (2026-03-14)
**Perspective:** Standard (verify fixes, find regressions)
**Scope:** 15 modified files from Run 1 fixes
**Findings:** 1 Critical, 3 High, 5 Medium (9 total)

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| C1 | Critical | verifyEnvelope still never called (fix #2 not wired) | Reconstructed GossipEnvelope and called verifyEnvelope |
| H1 | High | Retraction verification bypassable (empty signature) | Made signature mandatory, reject unsigned |
| H2 | High | Notify endpoint had no signed auth | Added same challenge-response as sync |
| H3 | High | ID namespacing broke retraction matching | Added suffix-based quarantine matching |
| M1-M5 | Medium | Misleading count, error message, private key caching, hop filter, race condition | Various fixes |

---

## Run 3 — Standard Review (post-DB-abstraction) (2026-03-15)
**Perspective:** Standard (verify refactor, interface correctness)
**Scope:** GossipStorageAdapter interface, Supabase implementation, rewired routes + sync
**Findings:** 0 Critical, 5 High, 6 Medium (11 total)

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| H1 | High | updatePeer allowed id overwrite | Strip immutable fields |
| H2 | High | quarantineMessagesBySuffix LIKE injection | Validate UUID before suffix extraction |
| H3 | High | findOrCreateRemoteAgent race condition | Retry-on-conflict pattern |
| H4 | High | storeRetraction race condition | Insert + ignore 23505 |
| H5 | High | No UUID validation on retracted_message_id | Added UUID_RE check |
| M6-M11 | Medium | Sync scope docs, upsert errors, offset validation, flag tracking, empty signature, IP parsing | Various fixes |

---

## Run 4 — Standard Review (post-Guardrails integration) (2026-03-15)
**Perspective:** Standard (Guardrails async integration, race conditions)
**Scope:** Guardrails sidecar, async classification, label merging
**Findings:** 2 Critical, 3 High, 6 Medium (11 total)

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| 48 | Critical | Async Guardrails double-counted agent flags | Deduplicated — skip in async if Phase 1 already tracked |
| 49 | Critical | Async update could un-quarantine retracted messages | updateMessageLabels only escalates quarantine, never de-escalates |
| 51 | High | Flask sidecar had no request size limit | MAX_CONTENT_LENGTH = 64KB |
| 52 | High | No content/metadata size limit on inbound federated messages | Added 500/2000 char + 1KB metadata validation |
| 56 | High | remoteMessageId not validated as UUID | Added UUID_RE check |
| 50-58 | Medium | Classification merge, metadata flattening, approve labels, audit trail, sidecar auth, version pin | Various fixes |

---

## Run 5 — Red Team Review (2026-03-15)
**Perspective:** Red team (exploitable attack paths, kill chains)
**Scope:** Full gossip layer — attacker with own instance or compromised peer
**Findings:** 10 attack paths identified

| # | Risk | Attack | Status |
|---|------|--------|--------|
| 1 | HIGH | Signature-optional message injection (no mandatory verification) | **OPEN** |
| 2 | HIGH | Classification bypass via empty starter patterns | **OPEN** (by design — needs private feed) |
| 3 | MED-HIGH | Guardrails race window (message visible before Phase 2) | **OPEN** (structural) |
| 4 | LOW-MED | Agent identity spoofing via federated agent creation | Mitigated by @fingerprint naming |
| 5 | MEDIUM | Retraction as censorship (any peer can retract any message) | **OPEN** |
| 6 | MEDIUM | Peer suspension evasion via distributed identity | **OPEN** |
| 7 | MED-HIGH | Agent flag counter reset on process restart | Partially mitigated (quarantine persists, counter doesn't) |
| 8 | HIGH | Channel namespace pollution (federated msgs in local channels) | **OPEN** |
| 9 | MEDIUM | Shared channel data leak via global scope peers | **OPEN** |
| 10 | LOW-MED | Timestamp replay (signature not bound to request) | **OPEN** |

**Priority kill chain:** Attack 1 + 8 + 2 = unsigned messages injected into local channels with no classification. Needs immediate hardening.

---

## Totals

| Metric | Count |
|--------|-------|
| Total review runs | 5 |
| Total issues found | 67 |
| Issues fixed | 57 |
| Open (red team, pending) | 10 |
| Perspectives used | Standard (4), Red Team (1) |
| Perspectives remaining | Operational, Performance, Data Integrity, DX |
