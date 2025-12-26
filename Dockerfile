# Stage 1: Install dependencies
FROM oven/bun:1 as deps
WORKDIR /usr/src/app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Stage 2: Build the app
FROM deps as build
WORKDIR /usr/src/app
COPY . .

# ✅ NEW: Accept build arguments for Vite
ARG VITE_ROOT_DOMAIN
ENV VITE_ROOT_DOMAIN=$VITE_ROOT_DOMAIN

# This assumes your Vite build command is named "build" in package.json
RUN bun run build

# Stage 3: Setup the final production image
FROM oven/bun:1 as production
WORKDIR /usr/src/app
ENV NODE_ENV=production

# Copy only the necessary files from previous stages
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist ./dist
COPY --from=build /usr/src/app/src ./src
COPY --from=build /usr/src/app/package.json ./package.json

# Expose the port your server listens on
EXPOSE 42069

# The command to start your server
CMD ["bun", "run", "start"]
