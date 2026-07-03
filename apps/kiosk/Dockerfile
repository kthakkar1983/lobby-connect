# Build from the REPO ROOT context:  docker build -f apps/kiosk/Dockerfile .
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY .npmrc pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/portal/package.json apps/portal/
COPY apps/kiosk/package.json apps/kiosk/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile
COPY . .
# VITE_* are build-time inlined; `pnpm build` also runs tsc --noEmit (type gate).
ARG VITE_PORTAL_API_URL
ENV VITE_PORTAL_API_URL=$VITE_PORTAL_API_URL
RUN pnpm --filter @lc/kiosk build

FROM nginx:alpine AS run
COPY apps/kiosk/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/kiosk/dist /usr/share/nginx/html
EXPOSE 80
