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
    jwt_ttl_minutes: int = 12 * 60  # one caretaker shift
    cors_origins: list[str] = ["http://localhost:5173"]

    @model_validator(mode="after")
    def _no_dev_secret_in_prod(self) -> "Settings":
        if self.environment == "prod" and self.jwt_secret == DEV_JWT_SECRET:
            raise ValueError("PGCRM_JWT_SECRET must be set in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
