# CORE

> High-throughput multi-tenant object storage, document intelligence, and conversational RAG platform.

CORE is an enterprise-grade, multi-tenant document management and conversational AI system. It provides direct S3/MinIO pre-signed object uploads, distributed background document parsing and OCR, hybrid semantic vector search (`pgvector`) with full-text search (FTS), interactive conversational AI with verifiable citations, comprehensive activity auditing, and workspace analytics.

---

## Architecture Overview

```mermaid
flowchart TD
    subgraph Client ["Client Layer"]
        Web["Next.js 16 Web Console<br/>(Tailwind CSS, React 19)"]
    end

    subgraph API ["API & Routing Layer"]
        Express["Express 5 REST & SSE Server<br/>(JWT, RBAC, RLS Context)"]
    end

    subgraph StorageInfra ["Storage & Message Broker"]
        MinIO["MinIO / AWS S3<br/>(Object Store & Presigned URLs)"]
        Redis["Redis 7<br/>(BullMQ Queues & Events)"]
        Postgres["PostgreSQL 17 + pgvector<br/>(Prisma ORM, RLS, FTS)"]
    end

    subgraph Processing ["Background Workers"]
        Worker["BullMQ Document Worker<br/>(PDF, DOCX, PPTX, XLSX, OCR)"]
        AI["AI Engine<br/>(Gemini & Mistral with Fallback)"]
    end

    Web -->|"Direct Presigned PUT / GET"| MinIO
    Web -->|"REST API & SSE Streams"| Express
    Express -->|"Database Queries & Vector Search"| Postgres
    Express -->|"Enqueue Processing Jobs"| Redis
    Redis -->|"Consume Ingestion Tasks"| Worker
    Worker -->|"Stream File & Extract"| MinIO
    Worker -->|"Chunk & Embed"| AI
    Worker -->|"Persist Chunks & Embeddings"| Postgres
    Express -->|"RAG Hybrid Retrieval & Streaming Chat"| AI
```

---

## Key Features

### 1. Multi-Tenant Workspace Isolation
- **Role-Based Access Control (RBAC)**: Strict role tiers (**OWNER**, **ADMIN**, and **MEMBER**) enforced across API endpoints and database queries.
- **PostgreSQL Row-Level Security (RLS)**: Enforced tenant boundaries at the database layer.
- **Workspace Switcher**: Seamlessly switch between multiple workspaces without re-authenticating.
- **Team Invitations**: Secure, tokenized invitation system with role assignments.

### 2. High-Performance Object Storage
- **Direct S3 / MinIO Uploads**: Client-side uploads directly to storage via pre-signed URLs, bypassing API server proxy bottlenecks.
- **Resumable Multipart Uploads**: Upload multi-gigabyte files with automatic chunking and retry mechanisms.
- **Advanced Object Browser**: Multi-criteria filtering by file type, processing status, upload date range, and uploader.
- **Bulk Operations**: Select multiple documents for batch downloading or role-authorized deletion.

### 3. Asynchronous Document Processing Pipeline
- **Distributed Queues**: Decoupled BullMQ background workers driven by Redis.
- **Multi-Format Extraction**: Native text extraction for PDF, DOCX, PPTX, and XLSX files.
- **Optical Character Recognition (OCR)**: Integrated Tesseract OCR for scanned documents and images.
- **Semantic Chunking**: Configurable token-aware chunking with sliding context windows.
- **Real-Time Progress Tracking**: Server-Sent Events (SSE) stream ingestion and embedding progress live to the console.

### 4. Hybrid RAG & Conversational AI
- **Dual Retrieval Engine**: Combines cosine similarity vector search (`pgvector`) with PostgreSQL Full-Text Search (FTS) for optimal precision and recall.
- **Multi-Model Provider with Fallback**: Primary Gemini integration (`gemini-2.5-flash` / `gemini-3.8-flash`) with automatic fallback to Mistral (`open-mistral-7b`).
- **Verifiable Citations**: Inspect exact source citations with document names, page numbers, extracted text, and highlighted matching passages.
- **Document-Targeted Inquiries**: Scope queries to all documents, a single file, or custom multi-document subsets.
- **Conversation Management**: Rename, pin, search, and export conversational threads.

### 5. Activity & Audit Trail
- Comprehensive audit records for security and compliance:
  - Document uploads, downloads, and deletions.
  - Member invitations, removals, and role modifications.
- Searchable and filterable audit view available to workspace administrators and owners.

### 6. Workspace Analytics
- **Document Processing Statistics**: Total documents, status distributions, ingestion success rates, processing durations, and 7-day ingestion trends.
- **Storage Consumption**: Total bytes consumed, average file sizes, category percentage breakdowns, and largest files.
- **AI & Vector Usage**: Chunk counts, indexed tokens, vector embeddings count, and model telemetry.
- **Query & Event Metrics**: Live tracking of member activity and conversational retrieval sessions.

---

## Monorepo Structure

```
CORE/
├── apps/
│   ├── api/                     # Fastify API (REST, SSE, RAG, Auth, Workspaces)
│   └── web/                     # Next.js 16 Web Dashboard (React 19, Tailwind CSS v4)
├── packages/
│   ├── ai/                      # Gemini & Mistral LLM + Fallback AI providers
│   ├── chunking/                # Semantic text chunking & token counting
│   ├── database/                # Prisma ORM, migrations, RLS policies, PostgreSQL client
│   ├── extraction/              # Document parsers (PDF, DOCX, PPTX, XLSX, OCR)
│   ├── indexing/                # Ingestion orchestrator & pipeline coordinator
│   ├── jobs/                    # BullMQ Redis queues & worker connection definitions
│   ├── shared/                  # Common TypeScript types & Zod validation schemas
│   └── storage/                 # MinIO / AWS S3 client, presigned URLs & multipart logic
├── workers/
│   └── document-processing/     # Background BullMQ ingestion worker
├── docker-compose.yml           # Local dev services (PostgreSQL 17, Redis 7, MinIO)
├── turbo.json                   # Turborepo task pipeline configuration
└── pnpm-workspace.yaml          # Monorepo workspace configuration
```

---

## Tech Stack

| Domain | Technologies |
|---|---|
| **Frontend** | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4 |
| **Backend API** | Fastify, TypeScript, Server-Sent Events (SSE), Zod |
| **Database & Search** | PostgreSQL 17, `pgvector`, Full-Text Search (tsvector), Prisma ORM |
| **Background Processing** | Redis 7, BullMQ |
| **Object Storage** | MinIO / AWS S3 with Pre-signed URLs & CORS |
| **AI / LLM** | Google Gemini API, Mistral AI API |
| **Document Processing** | Tesseract OCR, pdf-parse, officeparser, xlsx |
| **Tooling & Monorepo** | pnpm, Turborepo, Vitest |

---

## Getting Started

### Prerequisites

Ensure you have the following installed locally:
- **Node.js** >= 20.x
- **pnpm** >= 10.x / 11.x
- **Docker** and **Docker Compose**

### 1. Clone the Repository

```bash
git clone https://github.com/Nihir-Soni/CORE.git
cd CORE
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Configure Environment Variables

Copy the example environment configuration:

```bash
cp .env.example .env
```

Configure your `.env` values:

```env
# Database (PostgreSQL with pgvector)
DATABASE_URL="postgresql://core:core@localhost:5432/core?schema=public"

# Authentication
JWT_SECRET="your-super-secret-jwt-signing-key"

# S3 / MinIO Storage
S3_ENDPOINT="http://localhost:9000"
S3_ACCESS_KEY="core"
S3_SECRET_KEY="coreminio"
S3_BUCKET="chie-documents"

# AI Providers
GEMINI_API_KEY="your-gemini-api-key"
GEMINI_CHAT_MODEL="gemini-2.5-flash"
MISTRAL_API_KEY="your-mistral-api-key"
MISTRAL_CHAT_MODEL="open-mistral-7b"
```

### 4. Start Infrastructure Containers

Launch PostgreSQL (with `pgvector`), Redis, and MinIO via Docker Compose:

```bash
docker compose up -d
```

### 5. Run Database Migrations

Apply Prisma database schema migrations:

```bash
pnpm --filter database prisma migrate deploy
```

*(Optional) Generate Prisma client if needed:*
```bash
pnpm --filter database prisma generate
```

### 6. Start the Development Environment

Launch all applications (API, Web console, and Background Worker) concurrently using Turborepo:

```bash
pnpm dev
```

The services will be accessible at:
- **Web Console**: [http://localhost:3000](http://localhost:3000)
- **API Server**: [http://localhost:4000](http://localhost:4000)
- **MinIO Console**: [http://localhost:9001](http://localhost:9001) (`core` / `coreminio`)

---

## Production Deployment

CORE is architected for zero-friction containerized deployment:

### 1. Quick Launch with Docker Compose (Single Server / VPS)
```bash
# Clone the repository
git clone https://github.com/Nihir-Soni/CORE.git
cd CORE

# Setup environment variables
cp .env.example .env
# Edit .env with your GEMINI_API_KEY, JWT_SECRET, and domain origins

# Launch all production services (PostgreSQL + pgvector, Redis, MinIO, API, Worker, Web)
docker compose -f docker-compose.prod.yml up -d --build
```

### 2. Multi-Cloud & PaaS (Railway / Render / Fly.io / Vercel)
CORE supports containerized deployment on any modern cloud platform:
* **Web (`apps/web`)**: Deploy to Vercel or as a Docker container (`Dockerfile.web`).
* **API (`apps/api`)**: Deploy as a container (`Dockerfile.api`) with auto-scaling.
* **Worker (`workers/document-processing`)**: Deploy as a background worker daemon (`Dockerfile.worker`).
* **Databases**: Compatible with Neon, Supabase, AWS RDS (PostgreSQL with `pgvector`), Upstash Redis, and AWS S3 / Cloudflare R2.

For in-depth step-by-step instructions, see the complete [Deployment Guide](DEPLOYMENT.md).

---

## Running Tests

Run the complete test suite across all monorepo packages and applications:

```bash
# Run all unit and integration tests
pnpm test

# Run tests with type checking
pnpm typecheck
```

To run tests for a specific workspace:

```bash
# Web application tests
pnpm --filter web test

# API service tests
pnpm --filter api test

# Database package tests
pnpm --filter database test
```

---

## License

This project is licensed under the [ISC License](LICENSE).
