# Build from the REPO ROOT context:  docker build -f apps/portal/Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY .npmrc pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/portal/package.json apps/portal/
COPY apps/kiosk/package.json apps/kiosk/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# NEXT_PUBLIC_* are build-time inlined by Next; Coolify passes these as
# build variables. Sentry stays empty on staging (shadowed off).
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SENTRY_DSN=""
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    BUILD_STANDALONE=1 \
    # Next's "Collecting page data" IMPORTS API route modules at build time;
    # module-scope env getters (lib/supabase/admin) must not throw. Routes are
    # never EXECUTED at build — the run stage gets real values from Coolify's
    # runtime env, and this build stage is discarded. Not a secret.
    SUPABASE_SERVICE_ROLE_KEY="build-time-dummy"
RUN pnpm --filter @lc/portal build

FROM node:22-alpine AS run
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /repo
COPY --from=build --chown=node:node /repo/apps/portal/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/portal/.next/static ./apps/portal/.next/static
COPY --from=build --chown=node:node /repo/apps/portal/public ./apps/portal/public
USER node
EXPOSE 3000
CMD ["node", "apps/portal/server.js"]
