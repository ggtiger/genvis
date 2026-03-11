# Python FastAPI App Specification

This document defines the technical requirements for Python FastAPI applications in Genvis skills directory.

## Required Files and Structure

```
app-name/
├── app/
│   ├── __init__.py
│   └── main.py          # Must contain FastAPI instance and /health endpoint
├── requirements.txt     # Python dependencies
└── .env.example         # Environment variable template
```

## main.py Required Content

```python
from fastapi import FastAPI

app = FastAPI()  # This instance is required

@app.get("/health")
async def health_check():
    """Health check endpoint (required)"""
    return {"status": "ok"}
```

## Technical Requirements

- **Python Version**: 3.11+
- **Framework**: FastAPI + Uvicorn
- **Database**: Only SQLite supported (use relative path `sqlite:///./python_dev.db`)

## Dependency Package Restrictions

### Prohibited Packages

The following packages requiring compilation tools or external services are **not supported**:
- tensorflow, torch, keras, scikit-learn (large ML frameworks, big size, complex compilation)
- opencv-python (requires system libraries)
- mysql-connector, psycopg2, pymongo (require external database services)

### Directly Usable (Pre-compiled Wheels)

- numpy, pandas, scipy, matplotlib, pillow (mainstream platforms have pre-compiled packages)

### Recommended Dependencies

```txt
fastapi==0.104.1
uvicorn[standard]==0.24.0
pydantic==2.5.0
aiosqlite==0.19.0
```

## Installation Flow

### 1. Python Version Detection

- Detect system Python version (requires 3.11+)
- Detection order: `python3` → `python`

### 2. Virtual Environment Creation

```bash
python -m venv .venv
```

### 3. Dependency Installation

Use pip in virtual environment:

```bash
.venv/Scripts/pip install -r requirements.txt  # Windows
.venv/bin/pip install -r requirements.txt      # macOS/Linux
```

### 4. Installation Retry Mechanism

- **Retry count**: 3 times
- **Retry intervals**: 5s → 10s → 20s

## Preview Flow

### 1. Start Command

```bash
# Windows
.venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port <port> --reload

# macOS/Linux
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port <port> --reload
```

### 2. Health Check

- Access `/health` endpoint
- Timeout: 60 seconds (Python starts slower)

### 3. Default Preview Page

- Open `/docs` - Swagger UI interactive documentation

## Database Configuration

### Correct Configuration

```env
# ✅ Correct: relative path
DATABASE_URL="sqlite:///./python_dev.db"

# ❌ Wrong: absolute path
DATABASE_URL="sqlite:////var/db/prod.db"

# ❌ Wrong: parent directory path
DATABASE_URL="sqlite:///../../../prod.db"
```

### .env.example Template

```env
# Database
DATABASE_URL="sqlite:///./python_dev.db"

# Application
DEBUG=True
```

## Project Cleanup Checklist

### Must Delete

- ❌ `.env`, `.env.local` - Contains sensitive information
- ❌ `.venv/`, `venv/`, `__pycache__/` - Virtual environment and cache
- ❌ `*.pyc`, `*.pyo`, `*.pyd` - Python compiled files
- ❌ `*.db`, `*.sqlite`, `*.sqlite3` - Database files

### Must Keep

- ✅ `.env.example` - Environment variable template
- ✅ `.gitignore` - Version control ignore file
- ✅ `README.md` - Project usage documentation
- ✅ `requirements.txt` - Dependency configuration
- ✅ `app/` - Source code directory

### Important Notes

**Windows Compatibility**: `requirements.txt` should not contain Chinese comments. pip on some Windows environments parses text files by local encoding (e.g., GBK), Chinese comments may cause dependency installation failures. Use pure ASCII comments or remove comments.

## Security Requirements

### Environment Variable Cleanup

**Prohibited**:
- Do not include real API keys, tokens in app template
- Do not include production database connections
- Do not include third-party service credentials (e.g., AWS, Alibaba Cloud keys)

## Common Issues

### Q: Data science packages (numpy/pandas) usable?

**A**: Yes. numpy, pandas, scipy, matplotlib, pillow and other packages have pre-compiled wheels on mainstream platforms, can be pip installed directly.

**Still not supported**: tensorflow, torch and other large ML frameworks (big size, complex compilation).

### Q: Dependency installation takes too long?

**A**: This is normal. First-time installation downloads 50-100MB packages.

**Suggestion**: Do not include `.venv/` in app template, let system auto-install.

### Q: How to test if app template meets specifications?

**A**: Test steps:
1. Place app template in `skills/` directory
2. Restart platform or wait for cache expiry (1 minute)
3. Select this app template in Skills to create/run project
4. Observe installation logs and preview success

**Check points**:
- Virtual environment creates successfully
- Dependencies install successfully
- Preview server starts automatically
- `/health` endpoint is accessible
- `/docs` Swagger UI is accessible
- No errors in console

### Q: Can app template include Git repository?

**A**: Yes, `.git/` directory will be preserved. But recommended:
- Clean sensitive information in `.git/`
- Or delete `.git/`, let users initialize themselves

## Port Allocation

- **Port range**: Environment variables `PREVIEW_PORT_START` - `PREVIEW_PORT_END` (default 3100-3999)
- **Auto-detection**: Start from beginning, find available port

## Environment Variable Injection

During preview, platform auto-injects:
- `PORT` - Port number
- `DATABASE_URL` - Database path (from .env.example)
- Other custom variables from .env.example

## Related Documents

- [Next.js App Specification](./README-nextjs-app.md)
- [Skills Integration Guide](./README.md)
