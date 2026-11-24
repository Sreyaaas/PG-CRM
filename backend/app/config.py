from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_JWT_SECRET = "dev-only-change-me-dev-only-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="PGCRM_", extra="ignore")

    environment: str = "dev"  # dev | test | prod
    # The API connects as a login role and switches to pgcrm_app (RLS-bound)
    # inside every transaction. In prod this login role must NOT be a superuser.
    database_url: str = "postgresql://pgcrm:pgcrm@localhost:5432/pgcrm"
    db_pool_min: int = 1
    db_pool_max: int = 10

    jwt_secret: str = DEV_JWT_SECRET
    # Short-lived access token; the app keeps the session alive with the refresh token (POST /auth/refresh).
    jwt_ttl_minutes: int = 15
    refresh_ttl_days: int = 30
    cors_origins: list[str] = ["http://localhost:5173"]

    # Error + performance monitoring. Off when no DSN is set (dev, tests).
    sentry_dsn: str | None = None
    sentry_traces_sample_rate: float = 0.1
    log_level: str = "INFO"

    @model_validator(mode="after")
    def _prod_safety(self) -> "Settings":
        if self.environment == "prod":
            if self.jwt_secret == DEV_JWT_SECRET:
                raise ValueError("PGCRM_JWT_SECRET must be set in production")
            bad = [o for o in self.cors_origins if o == "*" or not o.startswith("https://") or "localhost" in o]
            if not self.cors_origins or bad:
                raise ValueError(f"PGCRM_CORS_ORIGINS must list only the real https frontend origin(s), got {bad}")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
