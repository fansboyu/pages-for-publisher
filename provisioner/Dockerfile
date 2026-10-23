FROM caddy:2-alpine AS caddy
FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY provisioner ./provisioner
COPY agent ./agent
COPY pilot/archive.mjs ./pilot/archive.mjs
COPY --from=caddy /usr/bin/caddy /opt/bootstrap/caddy
ENV PROVISIONER_HOST=0.0.0.0 PROVISIONER_PORT=4431
USER node
EXPOSE 4431
HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:4431/health',{headers:{Authorization:'Bearer '+process.env.PROVISIONER_TOKEN}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","provisioner/server.mjs"]
