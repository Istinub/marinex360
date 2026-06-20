# marinex360-api — Fastify API.  Build from REPO ROOT:
#   docker build -f apps/api/Dockerfile -t marinex-api .
FROM node:22-alpine AS build
WORKDIR /app
# Workspace manifests first for layer caching
COPY package*.json ./
COPY apps/api/package.json apps/api/
COPY packages/storage/package.json packages/storage/
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.base.json ./
COPY packages/storage ./packages/storage
COPY apps/api ./apps/api
RUN npm run build -w @marinex360/storage && npm run build -w @marinex360/api \
    && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=app:app /app/packages/storage/dist ./packages/storage/dist
COPY --from=build --chown=app:app /app/prisma ./prisma
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/server.js"]
