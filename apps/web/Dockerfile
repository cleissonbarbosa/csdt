# syntax=docker/dockerfile:1

# ---- build -----------------------------------------------------------------
FROM node:24-slim AS build
RUN npm install --global pnpm@12.18.0
WORKDIR /src

# Manifests first, so dependency installation is cached across source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN pnpm --filter @aegis/web build

# ---- runtime ---------------------------------------------------------------
# Static files behind an unprivileged nginx that also proxies /api to the
# AEGIS server, so the browser only ever talks to one origin.
FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /src/apps/web/dist /usr/share/nginx/html

ENV AEGIS_UPSTREAM=server:8787
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=3s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
