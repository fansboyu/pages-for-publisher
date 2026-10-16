FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY pilot ./pilot
COPY agent ./agent
COPY scripts ./scripts
COPY html.mjs storage-adapter.mjs ./
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_ROOT=/data SERVE_FRONTEND=false
CMD ["node","pilot/server.mjs"]
