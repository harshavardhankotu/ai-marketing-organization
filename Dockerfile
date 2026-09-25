# Multi-stage production build
FROM node:22-alpine AS builder
WORKDIR /app

# Copy package descriptors
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY packages/backend/package*.json ./packages/backend/
COPY packages/frontend/package*.json ./packages/frontend/

# Install all dependencies
RUN npm ci

# Copy full source
COPY . .

# Build all packages
RUN npm run build

# Production runtime stage
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Copy built artifacts and production dependencies
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/packages/shared/package*.json ./packages/shared/
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/backend/package*.json ./packages/backend/
COPY --from=builder /app/packages/backend/dist ./packages/backend/dist
COPY --from=builder /app/packages/backend/schema.sql ./packages/backend/schema.sql
COPY --from=builder /app/packages/frontend/dist ./packages/frontend/dist
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3001

CMD ["node", "packages/backend/dist/index.js"]
