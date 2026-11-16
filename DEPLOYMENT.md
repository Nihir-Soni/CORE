# CORE — Deployment Guide

This guide covers production deployment strategies for the **CORE** multi-tenant object store and AI RAG platform.

---

## 1. System Architecture & Components

CORE is a monorepo consisting of three runtime services and three infrastructure dependencies:

```mermaid
flowchart TD
    subgraph Clients
        Browser["Web Browser (User)"]
    end

    subgraph "Application Layer"
        Web["Web Frontend (Next.js 16) :3000"]
        API["Backend API (Express Node.js) :4000"]
        Worker["Document Ingestion Worker (BullMQ)"]
    end

    subgraph "Storage & Infrastructure"
        PG[("PostgreSQL 17 + pgvector\n(RLS + HNSW Indices)")]
        Redis[("Redis 7\n(BullMQ Queues)")]
        S3[("AWS S3 / MinIO\n(Presigned Direct Uploads)")]
        AI["Google Gemini / Mistral API"]
    end

    Browser -->|HTTP / SSE / HTML| Web
    Browser -->|Direct Presigned PUT| S3
    Web -->|REST / SSE / Auth| API
    API -->|Read / Write SQL| PG
    API -->|Enqueue Jobs| Redis
    API -->|Presign URLs| S3
    Worker -->|Consume Jobs| Redis
    Worker -->|Extract / OCR / Embed| AI
    Worker -->|Fetch Raw Documents| S3
    Worker -->|Store Chunks & Embeddings| PG
    API -->|Generate RAG Answers| AI
```

### Components Summary

| Service | Technology | Port | Responsibilities |
|---|---|---|---|
| **Web** (`apps/web`) | Next.js 16 (Turbopack) | `3000` | UI, Document Viewer, SSE Streaming Chat, Analytics, Audit Log |
| **API** (`apps/api`) | Express 5, Node 22 | `4000` | Auth, Workspace & Member RBAC, Presigned Upload URLs, Chat SSE |
| **Worker** (`workers/document-processing`) | BullMQ, Node 22 | — | Tesseract OCR / Gemini Vision, chunking, pgvector embeddings |
| **Database** | PostgreSQL 17 + `pgvector` | `5432` | Relational tables, multi-tenant Row-Level Security (RLS), vector embeddings |
| **Cache & Queue** | Redis 7 | `6379` | BullMQ background job queues |
| **Object Storage** | AWS S3 / Cloudflare R2 / MinIO | `9000` | Direct-to-bucket file uploads via S3 presigned URLs |

---

## 2. Environment Variables Checklist

Ensure these variables are configured in your production deployment environment:

| Variable | Required | Description | Example / Default |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | PostgreSQL connection string (must have `pgvector` enabled) | `postgresql://core:password@postgres:5432/core?sslmode=require` |
| `JWT_SECRET` | **Yes** | Cryptographic key for JWT tokens (minimum 32 characters) | `openssl rand -hex 32` |
| `REDIS_HOST` | **Yes** | Redis host name or IP address | `redis` or `localhost` |
| `REDIS_PORT` | No | Redis port | `6379` |
| `S3_ENDPOINT` | No | S3 endpoint URL (omit for standard AWS S3, set for MinIO/R2) | `https://s3.us-east-1.amazonaws.com` |
| `S3_ACCESS_KEY` | **Yes** | AWS / MinIO Access Key ID | `AKIAIOSFODNN7EXAMPLE` |
| `S3_SECRET_KEY` | **Yes** | AWS / MinIO Secret Access Key | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` |
| `S3_BUCKET` | **Yes** | Target S3 bucket name | `core-production-documents` |
| `GEMINI_API_KEY` | **Yes** | Google Gemini API Key for embeddings & chat | `AIzaSy...` |
| `GEMINI_CHAT_MODEL` | No | Gemini chat model | `gemini-3.5-flash` |
| `MISTRAL_API_KEY` | No | Mistral API key (used for automatic failover) | `...` |
| `MISTRAL_CHAT_MODEL` | No | Mistral fallback model | `open-mistral-7b` |
| `CORS_ORIGIN` | **Yes** | Allowed web origin for API requests | `https://app.yourdomain.com` |
| `NEXT_PUBLIC_API_URL` | **Yes** | Public-facing API URL accessed by the browser | `https://api.yourdomain.com` |

---

## 3. Deployment Method A: Full Docker Compose (VPS / Single Server)

Best for deploying on a single virtual machine (AWS EC2, DigitalOcean Droplet, Hetzner, Linode, GCP Compute Engine).

### Step 1: Clone Repository on Server
```bash
git clone https://github.com/Nihir-Soni/CORE.git
cd CORE
```

### Step 2: Configure Production Environment
Create a `.env` file from the template:
```bash
cp .env.example .env
```
Generate a strong JWT secret and add your API keys:
```bash
# Generate 32-byte secret
openssl rand -hex 32
```
Edit `.env` and fill in `JWT_SECRET`, `GEMINI_API_KEY`, and set:
```env
CORS_ORIGIN=http://YOUR_SERVER_IP:3000
NEXT_PUBLIC_API_URL=http://YOUR_SERVER_IP:4000
```

### Step 3: Build & Launch All Services
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

### Step 4: Verify Deployment Health
Check running container statuses:
```bash
docker compose -f docker-compose.prod.yml ps
```
Inspect logs for each component:
```bash
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f worker
```
Access the services:
* **Web Application**: `http://YOUR_SERVER_IP:3000`
* **API Health Check**: `http://YOUR_SERVER_IP:4000/health`
* **MinIO Console**: `http://YOUR_SERVER_IP:9001`

---

## 4. Deployment Method B: Managed Cloud & PaaS (Railway / Render / Fly.io)

For high-availability production environments without managing server infrastructure directly.

### 1. Managed Databases
* **PostgreSQL with `pgvector`**:
  * Recommended: **Neon**, **Supabase**, or **AWS RDS PostgreSQL 16+**.
  * Enable the extension if not pre-installed:
    ```sql
    CREATE EXTENSION IF NOT EXISTS vector;
    ```
* **Redis**:
  * Recommended: **Upstash Redis** or **Redis Cloud** (Serverless).
* **Object Storage**:
  * Recommended: **AWS S3** or **Cloudflare R2**.
  * Ensure CORS is configured on your S3 bucket to allow PUT and GET requests from your web domain:
    ```json
    [
      {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["PUT", "GET", "HEAD"],
        "AllowedOrigins": ["https://app.yourdomain.com"],
        "ExposeHeaders": ["ETag"]
      }
    ]
    ```

### 2. Deploy Services on Railway or Render

#### Service 1: Database Migration Job
* **Type**: One-off Job / Pre-deploy Command
* **Command**: `pnpm --filter @core/database deploy`
* **Environment**: `DATABASE_URL`

#### Service 2: CORE Backend API
* **Docker Context**: Root (`.`)
* **Dockerfile**: `Dockerfile.api`
* **Port**: `4000`
* **Health Check Path**: `/health`
* **Environment Variables**:
  * `DATABASE_URL`, `JWT_SECRET`, `REDIS_HOST`, `REDIS_PORT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `GEMINI_API_KEY`, `CORS_ORIGIN=https://app.yourdomain.com`

#### Service 3: Document Processing Worker
* **Docker Context**: Root (`.`)
* **Dockerfile**: `Dockerfile.worker`
* **Type**: Background Worker / Daemon (no public port required)
* **Environment Variables**:
  * Same as API (`DATABASE_URL`, `REDIS_HOST`, `REDIS_PORT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `GEMINI_API_KEY`)

#### Service 4: Next.js Web Frontend
* **Docker Context**: Root (`.`)
* **Dockerfile**: `Dockerfile.web`
* **Build Argument**: `NEXT_PUBLIC_API_URL=https://api.yourdomain.com`
* **Port**: `3000`

---

## 5. Deployment Method C: Vercel (Frontend) + Managed Backend

For teams that prefer Vercel's Edge Network for Next.js:

1. **Deploy Frontend on Vercel**:
   * Root Directory: `apps/web`
   * Framework Preset: `Next.js`
   * Environment Variable: `NEXT_PUBLIC_API_URL=https://api.yourdomain.com`
2. **Deploy Backend & Worker**:
   * Deploy `Dockerfile.api` and `Dockerfile.worker` on Railway / Render / AWS ECS.
   * Set `CORS_ORIGIN=https://your-vercel-domain.vercel.app` on the API service.

---

## 6. Production Maintenance & Scaling

### Database Backups
Automate daily PostgreSQL backups:
```bash
pg_dump -U core -d core -F c -b -v -f /backups/core_$(date +%Y%m%d).dump
```

### Worker Scaling
If document upload throughput increases:
```bash
docker compose -f docker-compose.prod.yml up -d --scale worker=3
```
BullMQ automatically balances tasks across available worker instances via Redis.

### Rolling Updates
To deploy code updates with zero downtime:
```bash
git pull origin main
docker compose -f docker-compose.prod.yml up -d --build --no-deps api worker web
```
