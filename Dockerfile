# Single image used for BOTH the web app (`npm run start`) and the worker
# (`npm run worker`). The worker runs TypeScript via tsx, so we keep the full
# dependency set (no standalone trim) for a simple, reliable image.
FROM node:22-alpine AS build
WORKDIR /app

# System deps Prisma needs on Alpine.
RUN apk add --no-cache openssl

# Install dependencies (no lockfile in repo yet, so use install, not ci).
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
