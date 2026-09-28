# Storyboard Studio — single image for Synology Container Manager (and any Docker host).
#
# The API serves the built web app from the same origin, so one container and one port
# is the whole deployment. Postgres is external (see deploy/synology/README.md).
#
#   docker build -t storyboard-studio:latest .

# ---------- build: install everything, build vocabularies + web ----------
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/vocabularies/package.json packages/vocabularies/
COPY packages/models/package.json packages/models/
COPY packages/compiler/package.json packages/compiler/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY packages/vocabularies packages/vocabularies
COPY packages/models packages/models
COPY packages/compiler packages/compiler
COPY apps/web apps/web
COPY apps/api apps/api

RUN npm run build -w @storyboard/vocabularies \
 && npm run build -w @storyboard/models \
 && npm run build -w @storyboard/compiler \
 && npm run build -w @storyboard/web \
 && npm run build -w @storyboard/api

# Drop dev dependencies so the runtime image only carries what the API needs.
RUN npm prune --omit=dev

# ---------- runtime ----------
FROM node:24-alpine
# ffmpeg for poster frames and the final render (plan D36); libx264 and aac are in the alpine build.
RUN apk add --no-cache ffmpeg
# Stamped by deploy/release.mjs; surfaced by GET /health so a release can prove what is live.
ARG BUILD_TAG=dev
ARG APP_VERSION=0.0.0-dev
ARG GIT_COMMIT=unknown
ENV BUILD_TAG=${BUILD_TAG} APP_VERSION=${APP_VERSION} GIT_COMMIT=${GIT_COMMIT}
# Lets the release prune only this app's leftover images on a shared Docker host.
LABEL app=storyboard-studio
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    WEB_ROOT=/app/apps/web/dist \
    STORAGE_ROOT=/data/storage \
    RUN_MIGRATIONS=true
WORKDIR /app

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/vocabularies/package.json packages/vocabularies/
COPY --from=build /app/packages/vocabularies/dist packages/vocabularies/dist
COPY --from=build /app/packages/vocabularies/vocabularies.json packages/vocabularies/
COPY --from=build /app/packages/models/package.json packages/models/
COPY --from=build /app/packages/models/dist packages/models/dist
COPY --from=build /app/packages/models/models.json packages/models/
COPY --from=build /app/packages/compiler/package.json packages/compiler/
COPY --from=build /app/packages/compiler/dist packages/compiler/dist
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/src apps/api/src
COPY --from=build /app/apps/api/drizzle apps/api/drizzle
COPY --from=build /app/apps/web/dist apps/web/dist
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && chown -R node:node /app \
 && mkdir -p /data/storage && chown -R node:node /data

USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
