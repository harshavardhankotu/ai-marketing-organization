# Deployment & Production Runbook

## Cloudflare Native Deployment (Free-Tier Compatible)

### 1. Cloudflare D1 Setup
```bash
# Create D1 database
npx wrangler d1 create ai-marketing-db

# Execute initial schema migration
npx wrangler d1 execute ai-marketing-db --file=packages/backend/src/db/schema.ts
```

### 2. Backend Deployment (Cloudflare Workers)
```bash
cd packages/backend
npx wrangler deploy
```

### 3. Frontend Deployment (Cloudflare Pages)
```bash
cd packages/frontend
npm run build
npx wrangler pages deploy dist --project-name=ai-marketing-organization
```

## Local Production Node Execution
```bash
# Start backend on :3001
npm run dev:backend

# Start frontend on :3000
npm run dev:frontend
```