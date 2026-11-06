FROM node:22-bookworm-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npx vite build

FROM mcr.microsoft.com/playwright:v1.49.0-jammy
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm install --no-save playwright@1.49.0
COPY server ./server
COPY scripts ./scripts
COPY --from=web /web/dist ./web/dist
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "--import", "./server/register.js", "server/index.js"]
