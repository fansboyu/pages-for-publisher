FROM node:24-bookworm-slim AS vendor
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM caddy:2-alpine
COPY frontend/Caddyfile /etc/caddy/Caddyfile
COPY public /srv
COPY --from=vendor /build/node_modules/jodit/es2021/jodit.fat.min.js /srv/vendor/jodit.js
COPY --from=vendor /build/node_modules/jodit/es2021/jodit.min.css /srv/vendor/jodit.css
ENV API_UPSTREAM=api:3000
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/frontend-health || exit 1
