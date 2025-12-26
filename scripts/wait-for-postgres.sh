#!/usr/bin/env bash

# Exit immediately if a command exits with a non-zero status.
set -e

# Load .env file to get the database URL
if [ -f ./.env ]; then
    export $(grep -v '^#' ./.env | xargs)
else
    echo "⚠️ .env file not found. Assuming DATABASE_URL_LOCAL is in the environment."
fi

# Check if the required environment variable is set
if [ -z "$DATABASE_URL_LOCAL" ]; then
    echo "❌ Error: DATABASE_URL_LOCAL is not set. Cannot check database status."
    exit 1
fi

echo "⏳ Waiting for PostgreSQL to be ready at ${DATABASE_URL_LOCAL}..."

# `pg_isready` is a utility to check the connection status of a PostgreSQL server.
# The `-d` flag specifies the connection string.
# The `-q` flag runs in quiet mode (no output), we only care about the exit code.
# The `until` loop will continue until the command succeeds (returns exit code 0).
until pg_isready -d "$DATABASE_URL_LOCAL" -q; do
    >&2 echo "Postgres is still unavailable - sleeping for 2 seconds..."
    sleep 2
done

>&2 echo "✅ PostgreSQL is ready - continuing..."

# The script will exit with code 0, allowing the next command in a chain to run.
