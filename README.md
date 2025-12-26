# BEDROCK

A local-first, offline-capable Personal Knowledge Management (PKM) application built with Effect, Lit, Bun, and Replicache.

Life IO enables real-time synchronization across devices, rich-text editing with wiki-style linking, and integrated task management, all backed by a robust functional programming architecture.

## 🚀 Features

* Local-First & Real-Time: Built on Replicache for instant UI interactions and background synchronization.
* Rich Text Editor: Powered by Tiptap, supporting Markdown shortcuts, task lists, and custom blocks.
* Wiki-Linking: Connect notes using [[Wiki Links]] syntax with automatic backlink tracking.
* Authentication: Secure email/password authentication using Argon2id, JWT sessions, and email verification flows.
* Functional Architecture: Backend services and error handling built entirely with Effect.
* Reactive UI: Frontend built with Lit Web Components using a custom SAM (State-Action-Model) pattern implementation.
* Media Support: S3-compatible avatar uploads (Cloudflare R2 integration).

## 🛠️ Tech Stack

### Backend
* Runtime: Bun
* Framework: Effect
* Database: PostgreSQL
* Query Builder: Kysely
* Sync: Replicache

### Frontend
* Build Tool: Vite
* Framework: Lit
* State: Preact Signals & Zag.js
* Styling: Tailwind CSS v4
* Routing: Custom Effect router

### Testing
* Vitest
* Web Test Runner
* Playwright

## ⚡ Prerequisites

* Bun
* Docker

## 🏁 Getting Started

### 1. Clone and Install

    git clone <repository-url>
    cd life-io
    bun install

### 2. Environment Setup

Create a `.env` file in the root directory:

    # Server Configuration
    VITE_API_BASE_URL=http://localhost:42069
    VITE_WS_URL=ws://localhost:42069
    NODE_ENV=development
    LOG_LEVEL=debug

    # Database
    DATABASE_URL=postgres://postgres:postgres@localhost:6543/main
    DATABASE_URL_LOCAL=postgres://postgres:postgres@localhost:6543/main
    USE_LOCAL_NEON_PROXY=true

    # Auth Security
    JWT_SECRET=super_secret_dev_key_must_be_long_enough

    # Object Storage
    BUCKET_NAME=life-io
    PUBLIC_AVATAR_URL=https://pub-your-r2-url.r2.dev
    AWS_ENDPOINT_URL_S3=https://your-account-id.r2.cloudflarestorage.com
    AWS_ACCESS_KEY_ID=your_access_key
    AWS_SECRET_ACCESS_KEY=your_secret_key
    AWS_REGION=auto

### 3. Start Infrastructure

    docker-compose up -d

### 4. Database Migration

    bun run migrate

### 5. Run Development Server

    bun run dev

Frontend: https://localhost:3000 
Backend: http://localhost:42069

## 🧪 Testing

Backend tests:

    bun run test:node

Client/component tests:

    bun run test:client
    bun run test:browser

End-to-end tests:

    bun run test:e2e

## 📂 Project Structure

    .
    ├── bun-server.ts
    ├── migrations/
    ├── src/
    │   ├── components/
    │   │   ├── editor/
    │   │   ├── layouts/
    │   │   ├── pages/
    │   │   └── ui/
    │   ├── db/
    │   ├── features/
    │   │   └── replicache/
    │   ├── lib/
    │   │   ├── client/
    │   │   ├── server/
    │   │   └── shared/
    │   └── types/

## 🧩 Architecture Highlights

### SAM Pattern
ReactiveSamController manages state through Actions, reducers, and Effect-powered side effects.

### Effect Backend
* Layer-based DI
* Typed errors (no throwing)
* OpenTelemetry integration

### Replicache Sync
1. Pull: delta computed from client_view_record
2. Push: mutations processed transactionally
3. Poke: WebSockets notify clients

