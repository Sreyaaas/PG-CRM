from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_JWT_SECRET = "dev-only-change-me-dev-only-change-me"
DEV_S3_SECRET = "pgcrm-dev-secret"


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
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:4173"]
    # Where the PWA is served: public receipt links are {public_app_url}/receipt/<token> (BE-31, BE-35).
    public_app_url: str = "http://localhost:5173"
    # true only when the API runs behind our own reverse proxy, which sets X-Forwarded-For. Then the client IP
    # (rate limits, the IP stored on onboarding requests) is the last address that proxy appended. Never turn it
    # on when clients reach the API directly: they could send any X-Forwarded-For.
    trust_forwarded_for: bool = False

    # Private file storage: any S3-compatible service (RustFS locally; Supabase Storage / AWS S3 / R2 in prod).
    s3_endpoint: str | None = "http://localhost:9000"  # None = AWS S3 itself
    s3_bucket: str = "pgcrm-private"
    s3_access_key: str = "pgcrm"
    s3_secret_key: str = DEV_S3_SECRET
    s3_region: str = "us-east-1"

    # Error + performance monitoring. Off when no DSN is set (dev, tests).
    sentry_dsn: str | None = None
    sentry_traces_sample_rate: float = 0.1
    log_level: str = "INFO"

    @model_validator(mode="after")
    def _prod_safety(self) -> "Settings":
        if self.environment == "prod":
            if self.jwt_secret == DEV_JWT_SECRET:
                raise ValueError("PGCRM_JWT_SECRET must be set in production")
            if self.s3_secret_key == DEV_S3_SECRET:
                raise ValueError("PGCRM_S3_SECRET_KEY must be set in production")
            bad = [o for o in self.cors_origins if o == "*" or not o.startswith("https://") or "localhost" in o]
            if not self.cors_origins or bad:
                raise ValueError(f"PGCRM_CORS_ORIGINS must list only the real https frontend origin(s), got {bad}")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
