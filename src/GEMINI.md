# Gemini Customization File for src/

This file provides context specific to the `src/` directory, which contains the core source code for the application.

## Directory Structure Overview

The `src/` directory is organized into frontend (client) and backend (server) code, with some shared components.

- **Client-Side (Frontend):**
  - `main.ts`: The main entry point for the Vite frontend application.
  - `components/`: Reusable Lit web components.
  - `lib/client/`: Client-specific logic, including the Replicache client, routing, and state management.
  - `styles/`: Global CSS styles.

- **Server-Side (Backend):**
  - `features/`: Contains the primary business logic for different domains of the application, implemented using Effect-TS. Each feature typically has handlers and services.
  - `db/`: Manages the database layer, including the Kysely query builder, schema definitions, migrations, and seeding scripts.
  - `lib/server/`: Server-specific utilities and services, such as authentication, configuration, and session management.

- **Shared Code:**
  - `lib/shared/`: Contains code that is used by both the client and the server, such as API schemas, type definitions, and permissions logic.
  - `types/`: Contains generated types, especially for the database schema.

## Key Conventions

- **Frontend:** The frontend is built with Lit and follows standard web component practices. State is managed locally or synchronized via Replicache.
- **Backend:** The backend is built with Effect-TS, emphasizing a functional, type-safe, and composable approach. Business logic is encapsulated within services in the `features/` directory.
- **Data Sync:** Replicache is used for real-time data synchronization between the client and server. The relevant schemas are defined in `src/lib/shared/replicache-schemas.ts`.
