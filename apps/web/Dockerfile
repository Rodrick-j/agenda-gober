# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base
WORKDIR /app

# --- deps ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# --- build ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* se hornea en el bundle del cliente en build-time, no en
# runtime -- por eso viaja como ARG, no como env del contenedor final.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- runner: solo el output standalone (ver next.config.ts: output: 'standalone') ---
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3002
USER node

COPY --chown=node:node --from=build /app/public ./public
COPY --chown=node:node --from=build /app/.next/standalone ./
COPY --chown=node:node --from=build /app/.next/static ./.next/static

EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3002)).then(r=>{if(r.status>=500)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
