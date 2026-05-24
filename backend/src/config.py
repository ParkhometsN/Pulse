from pydantic_settings import BaseSettings, SettingsConfigDict


DEFAULT_JWT_SECRET = "pulse-development-secret-change-me"
DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:5176",
    "http://127.0.0.1:5176",
    "http://91.229.11.184",
    "http://pulse-investment.ru",
    "https://pulse-investment.ru",
    "http://www.pulse-investment.ru",
    "https://www.pulse-investment.ru",
    "http://frontend:5173",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "backend/.env"), extra="ignore")

    environment: str = "development"
    pulse_database_url: str | None = None
    database_url: str | None = None
    database_ssl: str = "auto"
    cors_origins: str | None = None

    jwt_secret: str = DEFAULT_JWT_SECRET
    jwt_expires_minutes: int = 60 * 24 * 7

    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str | None = None
    smtp_use_tls: bool = True
    openai_api_key: str | None = None
    chatgpt_api_key: str | None = None
    tocken_chatgpt_api: str | None = None
    openai_model: str = "gpt-4.1-mini"

    @property
    def resolved_database_url(self) -> str | None:
        return self.pulse_database_url or self.database_url

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    @property
    def resolved_openai_api_key(self) -> str | None:
        return self.openai_api_key or self.chatgpt_api_key or self.tocken_chatgpt_api

    @property
    def resolved_cors_origins(self) -> list[str]:
        if not self.cors_origins:
            return list(DEFAULT_CORS_ORIGINS)

        return [
            origin.strip()
            for origin in self.cors_origins.split(",")
            if origin.strip()
        ]

    def validate_runtime(self) -> None:
        if self.is_production and (
            not self.jwt_secret
            or self.jwt_secret == DEFAULT_JWT_SECRET
            or len(self.jwt_secret) < 32
        ):
            raise RuntimeError(
                "JWT_SECRET must be set to a unique 32+ character value in production"
            )


settings = Settings()
