# syntax=docker/dockerfile:1

# Imagen glibc (no alpine) a propósito: bcrypt es un módulo nativo y trae
# binarios precompilados para Debian, no para musl -- en alpine habría que
# compilarlo con python3/make/g++.
FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# Toolchain nativo: bcrypt trae binario precompilado para Debian x64, pero si
# el runner es otra arquitectura node-gyp necesita compilarlo. Solo vive en
# las etapas de dependencias -- la imagen final (runner) queda slim.
FROM base AS native-base
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# --- deps: todas las dependencias (incluye dev) para poder compilar ---
FROM native-base AS deps
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# --- build: nest build -> dist/ ---
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- prod-deps: solo lo necesario en runtime ---
FROM native-base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# --- runner ---
FROM base AS runner
# Usuario sin privilegios (la imagen de node ya trae el uid/gid 1000 "node")
USER node
COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node package.json ./

EXPOSE 3001
# Healthcheck contra el endpoint real (ver src/health.controller.ts)
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>{if(r.status!==200)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/main"]
