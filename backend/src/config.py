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
    masive_key: str | None = None
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
    ai_trading_enabled: bool = True
    ai_auto_execution_enabled: bool = False
    min_probability_tp_before_sl: float = 0.58
    min_risk_reward: float = 1.2
    min_expected_value_percent: float = 0.05
    max_spread_percent: float = 0.25
    min_liquidity_score: float = 0.45
    max_risk_per_trade_percent: float = 1.0
    max_daily_drawdown_percent: float = 3.0
    max_open_positions: int = 4
    dca_enabled: bool = False
    max_dca_count: int = 1
    dca_require_positive_ev: bool = True
    default_fee_percent: float = 0.20
    default_slippage_percent: float = 0.05
    counter_trend_probability_multiplier: float = 1.08
    high_volatility_position_size_multiplier: float = 0.55

    @property
    def resolved_database_url(self) -> str | None:
        return self.pulse_database_url or self.database_url

    @property
    def resolved_jwt_secret(self) -> str:
        return self.jwt_secret if self.jwt_secret != DEFAULT_JWT_SECRET else (self.masive_key or self.jwt_secret)

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
        jwt_secret = self.resolved_jwt_secret

        if self.is_production and (
            not jwt_secret
            or jwt_secret == DEFAULT_JWT_SECRET
            or len(jwt_secret) < 32
        ):
            raise RuntimeError(
                "JWT_SECRET or legacy MASIVE_KEY must be set to a unique 32+ character value in production"
            )


settings = Settings()
