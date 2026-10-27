-- =============================================================================
-- Vaaad AI (vaaadai.com) - Production PostgreSQL 16 + pgvector Database Schema
-- Complete Clean-Room SaaS Blueprint (Supabase / AWS RDS / Self-hosted PG)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 1. Tenants (Workspaces)
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    slug VARCHAR(120) UNIQUE NOT NULL,
    plan VARCHAR(40) NOT NULL DEFAULT 'trial',
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    onboarding_completed BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Users & RBAC
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    name VARCHAR(120),
    role VARCHAR(40) NOT NULL DEFAULT 'client', -- super_admin, admin, owner, member, client
    password_hash TEXT,
    clerk_user_id VARCHAR(120) UNIQUE,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

-- 3. Calling Wallets & Billing Ledgers
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID UNIQUE NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    balance_paise BIGINT NOT NULL DEFAULT 2000, -- Rs 20.00 default trial
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- trial_grant, recharge, usage, refund
    amount_paise BIGINT NOT NULL,
    description TEXT,
    meta JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ledger_tenant ON ledger_entries(tenant_id);

-- 4. Voice Agents
CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    persona TEXT NOT NULL,
    greeting TEXT,
    language VARCHAR(40) NOT NULL DEFAULT 'hi-IN',
    tts_voice VARCHAR(60) NOT NULL DEFAULT 'sarvam_hindi_female',
    stt_model VARCHAR(60) NOT NULL DEFAULT 'nova-3-general',
    did_id VARCHAR(60),
    rag_knowledge TEXT,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents(tenant_id);

-- 5. RAG Document Embeddings (pgvector)
CREATE TABLE IF NOT EXISTS document_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw ON document_embeddings USING hnsw (embedding vector_cosine_ops);

-- 6. Calls, Audio & Synced Transcripts
CREATE TABLE IF NOT EXISTS calls (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    phone_number VARCHAR(30) NOT NULL,
    direction VARCHAR(20) NOT NULL DEFAULT 'outbound', -- inbound, outbound
    duration_sec INT NOT NULL DEFAULT 0,
    cost_paise BIGINT NOT NULL DEFAULT 0,
    sentiment VARCHAR(30), -- positive, neutral, negative
    summary TEXT,
    disposition VARCHAR(50),
    recording_url TEXT,
    transcript JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_calls_tenant ON calls(tenant_id);

-- 7. CRM Contacts
CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    phone VARCHAR(30) NOT NULL,
    name VARCHAR(120),
    email VARCHAR(255),
    company VARCHAR(120),
    deal_value NUMERIC(12, 2) DEFAULT 0,
    stage VARCHAR(60) DEFAULT 'Lead',
    tags TEXT[] DEFAULT ARRAY[]::TEXT[],
    custom_vars JSONB DEFAULT '{}'::jsonb,
    last_contacted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, phone)
);

-- 8. Campaigns & Batch Dialer
CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'draft', -- draft, running, paused, completed, stopped
    daily_cap INT NOT NULL DEFAULT 100,
    interval_seconds INT NOT NULL DEFAULT 45,
    retry_limit INT NOT NULL DEFAULT 2,
    active_days INT[] DEFAULT ARRAY[1,2,3,4,5],
    schedule_start_hour INT NOT NULL DEFAULT 9,
    schedule_end_hour INT NOT NULL DEFAULT 21,
    dialed INT NOT NULL DEFAULT 0,
    connected INT NOT NULL DEFAULT 0,
    failed INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Appointments & Bookings
CREATE TABLE IF NOT EXISTS bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    lead_phone VARCHAR(30) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'confirmed', -- confirmed, cancelled, no_show
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bookings_time ON bookings(tenant_id, start_time);

-- 10. Developer API Keys
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    key_hash VARCHAR(128) NOT NULL,
    key_prefix VARCHAR(30) NOT NULL,
    permissions JSONB DEFAULT '["*"]'::jsonb,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- 11. Outbound Webhooks
CREATE TABLE IF NOT EXISTS outbound_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    target_url TEXT NOT NULL,
    secret VARCHAR(128) NOT NULL,
    events JSONB NOT NULL DEFAULT '["call.completed"]'::jsonb,
    status VARCHAR(30) NOT NULL DEFAULT 'active',
    failure_count INT NOT NULL DEFAULT 0,
    last_delivered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. TRAI National DND Registry Cache
CREATE TABLE IF NOT EXISTS dnd_registry (
    phone VARCHAR(30) PRIMARY KEY,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
