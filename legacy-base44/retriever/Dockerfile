# Isolated retrieval service. No shell, no package install at runtime, non-root.
FROM node:22-alpine

RUN addgroup -S retriever && adduser -S -G retriever retriever
WORKDIR /srv

COPY package.json ./
COPY src ./src

USER retriever
ENV NODE_ENV=production
EXPOSE 8443

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8443)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]