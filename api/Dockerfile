FROM docker.m.daocloud.io/library/node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --registry=https://registry.npmmirror.com
COPY . .
RUN npm run build
FROM docker.m.daocloud.io/library/node:22-alpine
WORKDIR /app
RUN apk add --no-cache git openssh-client
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund --registry=https://registry.npmmirror.com
COPY --from=build /app/dist ./dist
CMD ["node","dist/main.js"]
