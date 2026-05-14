# ========== Stage 1: build ==========
FROM node:20-alpine AS builder

WORKDIR /app

# Copia manifests primeiro pra aproveitar cache de layer
COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ========== Stage 2: runtime ==========
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Só prod deps
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Código compilado
COPY --from=builder /app/dist ./dist

# Usuário não-root por segurança
RUN addgroup -S app && adduser -S app -G app
USER app

# Railway define $PORT dinamicamente
EXPOSE 2567

CMD ["node", "dist/index.js"]
