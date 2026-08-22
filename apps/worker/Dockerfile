# marinex360-worker — BullMQ workers + Puppeteer.  Build from REPO ROOT:
#   docker build -f apps/worker/Dockerfile -t marinex-worker .
#
# Not alpine: Puppeteer/Chromium needs glibc. We install Debian's `chromium` package
# (pulls its own runtime libs), add CJK + base fonts for correct PDF rendering, and point
# Puppeteer at the system binary via PUPPETEER_EXECUTABLE_PATH — so puppeteer-core never
# downloads a second browser. ("Chrome deps baked into the image" — SRS §9.)
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/storage/package.json packages/storage/
RUN npm ci --ignore-scripts
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.base.json ./
COPY packages/storage ./packages/storage
COPY apps/worker ./apps/worker
RUN npm run build -w @marinex360/storage && npm run build -w @marinex360/worker && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=true
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation fonts-noto-cjk fonts-noto-color-emoji \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN groupadd -r app && useradd -r -g app -G audio,video app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/packages/storage ./packages/storage
COPY --from=build --chown=app:app /app/apps/worker/dist ./apps/worker/dist
COPY --from=build --chown=app:app /app/apps/worker/scripts ./apps/worker/scripts
COPY --from=build --chown=app:app /app/prisma ./prisma
USER app
CMD ["node", "apps/worker/dist/worker.js"]
