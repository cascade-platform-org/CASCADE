# CASCADE web image — Caddy serving the static frontend + reverse-proxying the
# API and the identity provider. Caddy is the ONLY internet-facing process; it
# also obtains and renews TLS certificates automatically.
#
# Build context is the REPO ROOT (see deploy/docker-compose.yml).

# --- Stage 1: build the static frontend ------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Install deps against the lockfile first (cached until the lockfile changes).
# .npmrc carries legacy-peer-deps so npm ci tolerates madge's TS-5 peer.
COPY CASCADE-app/package.json CASCADE-app/package-lock.json CASCADE-app/.npmrc ./
RUN npm ci

COPY CASCADE-app/ .

# The app is served same-origin behind Caddy (/api proxied to the backend), so
# the client should call the API with a relative URL. Empty base => "/api/...".
# NEXT_PUBLIC_* values are baked in at build time for a static export.
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

# The site's public origin, used for the absolute URLs in page metadata
# (og:image, twitter:image — link previews). Unset is fine for local builds:
# the app falls back to localhost. It cannot be a runtime env var, because a
# static export has already baked the <meta> tags by the time Caddy serves them.
ARG NEXT_PUBLIC_SITE_URL=""
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

# Browser-side error/performance reporting (lib/observability.ts), same
# build-time-only reasoning as NEXT_PUBLIC_SITE_URL above. Empty => the SDK is
# never initialised.
ARG NEXT_PUBLIC_SENTRY_DSN=""
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN

# With output:'export' in next.config.ts, `next build` writes the static site
# to ./out.
RUN npm run build

# --- Stage 2: build Caddy with the rate-limit plugin -----------------------
# This stage compiles Caddy from source (several minutes on a small VM) and is
# fully layer-cached afterwards. Both the builder tag and the plugin are PINNED:
# a floating `caddy:2-builder` tag would silently bust the cache on every new
# Caddy release and re-trigger the whole compile. Bump both pins together,
# deliberately (same rule as ZITADEL_VERSION in deployment.md).
FROM caddy:2.11.4-builder AS caddybuild
RUN xcaddy build --with github.com/mholt/caddy-ratelimit@v0.1.0 --output /usr/bin/caddy

# --- Stage 3: Caddy serves the built site ----------------------------------
FROM caddy:2.11.4-alpine
# Use the custom Caddy (with rate_limit) instead of the stock binary.
COPY --from=caddybuild /usr/bin/caddy /usr/bin/caddy
COPY --from=build /app/out /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
