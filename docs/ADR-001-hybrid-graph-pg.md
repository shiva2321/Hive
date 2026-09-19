# ADR-001: Hybrid Graph & Vector Architecture via PostgreSQL and SQLite

## Status
Accepted

## Context
When designing an enterprise memory graph capable of storing millions of developer conversations, decisions, and guardrails, we evaluated three distinct architectural approaches:
1. **Dedicated Graph Database (Neo4j / Memgraph) + Dedicated Vector DB (Pinecone / Qdrant)**.
2. **Pure Document Store (MongoDB) with embedded graph traversal**.
3. **Unified Relational Core with Vector Extension & Adjacency Graph (PostgreSQL 16 + pgvector / Embedded SQLite-vec)**.

## Decision
We chose **Option 3: Unified Relational Core with Adjacency Graph & Vector Index**.

### Rationale
1. **Multi-Tenancy & Security**:
   - Native Row-Level Security (RLS) in PostgreSQL allows cryptographic separation of tenants at the kernel database level (`current_setting('app.current_tenant_id')`).
   - Maintaining separate multi-tenant boundaries across two distinct distributed systems (e.g. Neo4j + Pinecone) introduces high synchronization overhead, two-phase commits, and risk of security divergence.
2. **Operational Simplicity**:
   - Running a single database engine drastically simplifies backups, point-in-time recovery (PITR), and disaster recovery.
3. **Sub-10ms Graph Traversal**:
   - Software project graphs are dense but typically 2 to 4 hops deep (Project $\rightarrow$ Decision $\rightarrow$ Solution $\rightarrow$ Guardrail).
   - Recursive Common Table Expressions (CTEs) on compound B-Tree indexes `(tenant_id, source_node_id, status)` benchmark within 3–8ms, easily matching native graph engine latency for these query patterns.
4. **Zero-Dependency Local Portability**:
   - SQLite uses the exact same schema design locally, allowing the exact same software to run offline on a developer's laptop or at massive multi-tenant scale in the cloud.

## Consequences
- Complex N-hop graph cycles require recursive query optimizations.
- Relational schema migrations require disciplined forward-compatibility.
