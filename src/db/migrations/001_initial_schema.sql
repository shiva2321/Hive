-- PostgreSQL 16 Production Multi-Tenant Schema with Row-Level Security (RLS) & pgvector
-- Enable vector extension for embeddings
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tenants & Workspaces
CREATE TABLE IF NOT EXISTS tenants (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    plan VARCHAR(32) DEFAULT 'standard',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Conversations
CREATE TABLE IF NOT EXISTS conversations (
    id VARCHAR(128) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source VARCHAR(32) NOT NULL,
    source_id VARCHAR(128) NOT NULL,
    title TEXT NOT NULL,
    title_blind_index VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    metadata_json JSONB DEFAULT '{}'::jsonb
);

-- 3. Messages (Encrypted at Rest)
CREATE TABLE IF NOT EXISTS messages (
    id VARCHAR(128) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    conversation_id VARCHAR(128) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR(16) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    encrypted_payload JSONB NOT NULL, -- { iv, ciphertext, tag, algorithm }
    code_snippets_json JSONB DEFAULT '[]'::jsonb,
    token_count INT DEFAULT 0,
    embedding vector(1536) -- Optional pgvector HNSW column for semantic retrieval
);

-- 4. Isolated Projects
CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(128) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    confidence REAL DEFAULT 0.5,
    tech_stack_json JSONB DEFAULT '[]'::jsonb,
    decisions_json JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS project_conversations (
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id VARCHAR(128) NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    conversation_id VARCHAR(128) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, conversation_id)
);

-- 5. Knowledge Graph Nodes
CREATE TABLE IF NOT EXISTS graph_nodes (
    id VARCHAR(128) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    type VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_blind_index VARCHAR(64),
    summary TEXT,
    attributes_json JSONB DEFAULT '{}'::jsonb,
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    confidence REAL DEFAULT 0.8
);

-- 6. Knowledge Graph Edges (Temporal & Adjacency)
CREATE TABLE IF NOT EXISTS graph_edges (
    id VARCHAR(128) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source_node_id VARCHAR(128) NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
    target_node_id VARCHAR(128) NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
    relation VARCHAR(64) NOT NULL,
    context TEXT,
    timestamp TIMESTAMPTZ NOT NULL,
    valid_from TIMESTAMPTZ NOT NULL,
    valid_to TIMESTAMPTZ,
    status VARCHAR(32) DEFAULT 'active', -- active, superseded, deprecated
    evidence_json JSONB DEFAULT '[]'::jsonb
);

-- 7. Behavioral Insights
CREATE TABLE IF NOT EXISTS insights (
    id VARCHAR(128) PRIMARY KEY,
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    category VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    detail TEXT NOT NULL,
    evidence_count INT DEFAULT 1,
    evidence_json JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 8. Immutable Audit Trail (SOC2 Compliance)
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(64) NOT NULL,
    actor_id VARCHAR(128) NOT NULL,
    action VARCHAR(64) NOT NULL,
    resource_type VARCHAR(64) NOT NULL,
    resource_id VARCHAR(128),
    ip_address VARCHAR(45),
    timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- High-Performance Indexes
CREATE INDEX IF NOT EXISTS idx_conversations_tenant ON conversations(tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_convo ON messages(tenant_id, conversation_id, timestamp ASC);
CREATE INDEX IF NOT EXISTS idx_projects_tenant ON projects(tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_nodes_tenant_type ON graph_nodes(tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_edges_lookup ON graph_edges(tenant_id, source_node_id, status);
CREATE INDEX IF NOT EXISTS idx_edges_target ON graph_edges(tenant_id, target_node_id);

-- Row-Level Security (RLS) Isolation Policies
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_conversations ON conversations 
    FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''));

CREATE POLICY tenant_isolation_messages ON messages 
    FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''));

CREATE POLICY tenant_isolation_projects ON projects 
    FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''));

CREATE POLICY tenant_isolation_graph_nodes ON graph_nodes 
    FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''));

CREATE POLICY tenant_isolation_graph_edges ON graph_edges 
    FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''));

CREATE POLICY tenant_isolation_insights ON insights 
    FOR ALL USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), ''));
