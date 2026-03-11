# Next.js App Specification

This document defines the technical requirements for Next.js applications in Genvis skills directory.

## Required Files and Directories

- `package.json` - Must include `dev` script
- `next.config.js` or `next.config.ts` or `next.config.mjs`
- `tsconfig.json` - TypeScript configuration
- `app/` or `src/app/` - App Router directory (Next.js 15 requirement)

## Technical Requirements

- **Framework Version**: Next.js 15+
- **Routing Mode**: App Router (Pages Router not supported)
- **Language**: TypeScript or JavaScript
- **Package Manager**: npm, pnpm, yarn, or bun (auto-detected via lockfile)

## Recommended Configuration

```json
{
  "scripts": {
    "dev": "node scripts/run-dev.js",
    "build": "next build",
    "start": "next start",
    "type-check": "tsc --noEmit",
    "lint": "next lint"
  }
}
```

## Environment Variables and Database

- **Environment Variables**: Only provide `.env.example`, no real keys
- **Database Path** (Prisma): Must use relative path `file:./sub_dev.db`
- **Prohibited**: Absolute paths, parent directory paths (`../`), main platform database paths

### Correct Database Configuration

```env
# ✅ Correct: relative path, database in project directory
DATABASE_URL="file:./sub_dev.db"

# ❌ Wrong: absolute path
DATABASE_URL="file:///C:/absolute/path/to/prod.db"

# ❌ Wrong: parent directory path
DATABASE_URL="file:../../../main_db/prod.db"
```

### .env.example Template

```env
# Database
DATABASE_URL="file:./sub_dev.db"

# App URL (auto-configured by platform)
NEXT_PUBLIC_APP_URL="http://localhost:3100"
```

## Installation Flow

### 1. Package Manager Auto-Detection

System detects in this order:
1. Check `packageManager` field in `package.json`
2. Look for lockfile: `pnpm-lock.yaml` → `yarn.lock` → `bun.lockb` → `package-lock.json`
3. Default to `npm`

### 2. Installation Retry Mechanism

- **Retry count**: 3 times
- **Retry intervals**: 5s → 10s → 20s (exponential backoff)
- **Cleanup strategy**:
  - 1st retry: Clean `.next/`
  - 2nd retry: Clean `node_modules/` + `.next/`

### 3. Prisma Auto-Initialization

If `prisma/schema.prisma` detected:
1. Run `prisma generate` - Generate Prisma Client
2. Check if database exists (`sub_dev.db`)
3. If not exists, run `prisma db push` - Create database schema

### 4. Static Checks (Non-blocking)

- `npm run type-check` - TypeScript type checking
- `npm run lint` - ESLint code checking
- **Note**: Failures won't interrupt preview, only logged as warnings

## Preview Flow

### 1. Port Allocation

- **Port range**: Environment variables `PREVIEW_PORT_START` - `PREVIEW_PORT_END` (default 3100-3999)
- **Auto-detection**: Start from beginning, find available port

### 2. Start Command

```bash
npm run dev -- --port <allocated-port>
```

### 3. Environment Variable Injection

- `PORT` - Port number
- `WEB_PORT` - Web port number
- `NEXT_PUBLIC_APP_URL` - Preview URL (e.g., `http://localhost:3100`)
- `DATABASE_URL` - Database path (`file:./sub_dev.db`)
- `NODE_ENV` - Fixed to `development`

### 4. Health Check

- Access preview URL, check for normal page response
- Timeout: 30 seconds
- Check interval: 1 second

## Project Cleanup Checklist

### Must Delete

- ❌ `.env`, `.env.local`, `.env.*.local` - Contains sensitive information
- ❌ `node_modules/` - Dependencies (~300+MB)
- ❌ `.next/` - Build artifacts
- ❌ `*.db`, `*.sqlite`, `*.db-journal` - Database files
- ❌ `.pnpm-store/`, `.turbo/` - Cache directories
- ❌ Old version files (e.g., `page.tsx.bak`, `layout.tsx.old`)

### Must Keep

- ✅ `.env.example` - Environment variable template
- ✅ `.gitignore` - Version control ignore file
- ✅ `README.md` - Project usage documentation
- ✅ `package.json`, `package-lock.json` - Dependency configuration
- ✅ `next.config.js`, `tsconfig.json`, `tailwind.config.js` - Configuration files
- ✅ `app/`, `components/`, `lib/`, `public/` - Source code and assets
- ✅ `prisma/schema.prisma` - Prisma database model (if any)

## Security Requirements

### Environment Variable Cleanup

**Prohibited**:
- Do not include real API keys, tokens in app template
- Do not include production database connections
- Do not include third-party service credentials (e.g., AWS, Alibaba Cloud keys)

## Common Issues

### Q: Dependency installation takes too long?

**A**: This is normal. First-time installation downloads hundreds of MB:
- Next.js projects: ~300-500MB

**Suggestion**: Do not include `node_modules/` in app template, let system auto-install.

### Q: How to make app template support fast preview?

**A**: Platform currently handles installation and preview automatically, no special configuration needed. Future may support:
- Standalone mode (pre-built version, ~50-80MB)
- Static preview page (HTML + mock data, few hundred KB)

### Q: Can app template include Git repository?

**A**: Yes, `.git/` directory will be preserved. But recommended:
- Clean sensitive information in `.git/`
- Or delete `.git/`, let users initialize themselves

### Q: How to test if app template meets specifications?

**A**: Test steps:
1. Place app template in `skills/` directory
2. Restart platform or wait for cache expiry (1 minute)
3. Select this app template in Skills to create/run project
4. Observe installation logs and preview success

**Check points**:
- Dependencies install successfully
- Preview server starts automatically
- Preview URL is accessible
- No errors in console

## Related Documents

- [Python FastAPI App Specification](./README-python-app.md)
- [Skills Integration Guide](./README.md)
