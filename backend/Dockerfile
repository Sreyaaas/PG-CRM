# PG-CRM API image (BE-52). Provider-neutral: configure everything with PGCRM_* environment variables.
#
#   docker build -f backend/Dockerfile -t pgcrm-api .          # from the repo root (needs db/migrations)
#   docker run --rm -p 8000:8000 --env-file prod.env pgcrm-api # serve
#   docker run --rm --env-file migrate.env pgcrm-api python scripts/migrate.py   # release step (as pgcrm_migrator)
#
# See docs/DEPLOY.md.

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:$PATH"

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Dependencies first, so code changes don't reinstall them.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/app ./app
COPY backend/scripts ./scripts
# scripts/migrate.py reads <repo>/db/migrations, i.e. /db/migrations here.
COPY db/migrations /db/migrations

# Never run as root.
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin pgcrm
USER pgcrm

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"

# --no-access-log: uvicorn's own access log prints raw paths, which can contain receipt tokens. Our middleware
# (app/logs.py) logs one redacted JSON line per request instead.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--no-access-log"]
