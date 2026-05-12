from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "backend/.env"), extra="ignore")

    environment: str = "development"
    pulse_database_url: str | None = None
    database_url: str | None = None

    jwt_secret: str = "pulse-development-secret-change-me"
    jwt_expires_minutes: int = 60 * 24 * 7

    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str | None = None
    smtp_use_tls: bool = True

    @property
    def resolved_database_url(self) -> str | None:
        return self.pulse_database_url or self.database_url

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"


settings = Settings()
