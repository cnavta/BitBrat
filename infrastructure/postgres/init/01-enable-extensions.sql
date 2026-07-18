-- Enable PostgreSQL extensions
-- This script runs automatically on first container startup via docker-entrypoint-initdb.d

-- Enable pgvector extension for vector similarity search (context packs)
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable pg_trgm for fuzzy text search (if needed)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable uuid-ossp for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

SELECT 'PostgreSQL extensions enabled successfully' AS status;
