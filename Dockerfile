# Single image used for BOTH the web app (`npm run start`) and the worker
# (`npm run worker`). The worker runs TypeScript via tsx, so we keep the full
# dependency set (no standalone trim) for a simple, reliable image.
#
# Debian "slim" (not Alpine) is used because Prisma's query engine is far less
# fussy about OpenSSL/glibc there — fewer "could not locate the query engine"
# surprises on a developer's machine.
FROM node:22-slim AS build
WORKDIR /app

# OpenSSL + CA certs are required by Prisma.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies (no lockfile committed yet, so use install, not ci).
COPY package.json ./
RUN npm install

# Build. A dummy DATABASE_URL keeps `prisma generate` / `next build` happy;
# real values are injected at runtime by docker-compose.
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://user:pass@db:5432/socials?schema=public"
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
