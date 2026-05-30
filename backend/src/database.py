from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import asyncpg

from src.config import settings


_pool: asyncpg.Pool | None = None

SCHEMA_COMMAND_TIMEOUT_SECONDS = 60


def _normalize_neon_dsn(dsn: str) -> str:
    parts = urlsplit(dsn)
    query = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if key.lower() != "sslmode"
    ]

    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def _resolve_database_ssl(dsn: str) -> str | bool:
    ssl_setting = (settings.database_ssl or "auto").lower()

    if ssl_setting in {"require", "required", "true", "1"}:
        return "require"

    if ssl_setting in {"disable", "disabled", "false", "0", "off"}:
        return False

    host = (urlsplit(dsn).hostname or "").lower()
    local_hosts = {"", "localhost", "127.0.0.1", "::1", "postgres", "db", "database"}

    if host in local_hosts or host.endswith(".local"):
        return False

    return "require"


async def connect_database() -> None:
    global _pool

    if _pool is not None:
        return

    dsn = settings.resolved_database_url
    if not dsn:
        raise RuntimeError("PULSE_DATABASE_URL or DATABASE_URL is required")

    _pool = await asyncpg.create_pool(
        dsn=_normalize_neon_dsn(dsn),
        ssl=_resolve_database_ssl(dsn),
        min_size=1,
        max_size=5,
        command_timeout=SCHEMA_COMMAND_TIMEOUT_SECONDS,
        max_inactive_connection_lifetime=60,
    )


async def close_database() -> None:
    global _pool

    if _pool is not None:
        await _pool.close()
        _pool = None


def get_database_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool is not initialized")

    return _pool


async def ensure_auth_schema() -> None:
    pool = get_database_pool()

    async with pool.acquire() as connection:
        await connection.execute("create extension if not exists pgcrypto")
        await connection.execute(
            """
            create table if not exists users (
                id uuid primary key default gen_random_uuid(),
                first_name varchar(80) not null,
                last_name varchar(80) not null,
                email varchar(255) not null unique,
                password_hash text not null,
                avatar_url text,
                is_email_verified boolean not null default false,
                created_at timestamptz not null default now(),
                updated_at timestamptz not null default now()
            )
            """
        )
        await connection.execute(
            """
            create table if not exists wallet_connections (
                id uuid primary key default gen_random_uuid(),
                user_id uuid not null references users(id) on delete cascade,
                provider varchar(40) not null,
                provider_label varchar(80) not null,
                api_key text not null,
                api_secret_encrypted text not null,
                permissions jsonb not null default '{}'::jsonb,
                status varchar(30) not null default 'active',
                last_synced_at timestamptz,
                created_at timestamptz not null default now(),
                updated_at timestamptz not null default now()
            )
            """
        )
        await connection.execute(
            """
            create table if not exists ai_trade_history (
                id uuid primary key default gen_random_uuid(),
                user_id uuid not null references users(id) on delete cascade,
                wallet_connection_id uuid references wallet_connections(id) on delete set null,
                asset_type varchar(30) not null,
                asset_symbol varchar(40) not null,
                asset_name varchar(120),
                action varchar(30) not null,
                quantity numeric(24, 10),
                price numeric(24, 10),
                total_amount numeric(24, 10),
                currency varchar(20) not null default 'USD',
                ai_strategy varchar(120),
                ai_reason text,
                status varchar(30) not null default 'completed',
                executed_at timestamptz not null default now(),
                created_at timestamptz not null default now()
            )
            """
        )
        await connection.execute(
            """
            create table if not exists portfolio_snapshots (
                id uuid primary key default gen_random_uuid(),
                user_id uuid not null references users(id) on delete cascade,
                wallet_connection_id uuid references wallet_connections(id) on delete set null,
                total_value numeric(24, 10) not null default 0,
                currency varchar(20) not null default 'USD',
                assets jsonb not null default '[]'::jsonb,
                created_at timestamptz not null default now()
            )
            """
        )
        await connection.execute(
            """
            create table if not exists user_ai_settings (
                user_id uuid primary key references users(id) on delete cascade,
                provider varchar(40) not null default 'openai',
                api_key text,
                model varchar(120) not null default 'gpt-4.1-mini',
                created_at timestamptz not null default now(),
                updated_at timestamptz not null default now()
            )
            """
        )
        await connection.execute(
            """
            create table if not exists ai_asset_scores (
                id uuid primary key default gen_random_uuid(),
                user_id uuid references users(id) on delete cascade,
                asset_type varchar(30) not null,
                symbol varchar(40) not null,
                figi varchar(64),
                score numeric(6, 2) not null,
                signal varchar(20) not null,
                confidence numeric(6, 2) not null,
                target_price numeric(24, 10),
                horizon varchar(30) not null default '7d',
                model varchar(120),
                summary text,
                factors jsonb not null default '{}'::jsonb,
                source_manifest jsonb not null default '[]'::jsonb,
                data_quality_flags jsonb not null default '[]'::jsonb,
                created_at timestamptz not null default now()
            )
            """
        )
        await connection.execute(
            """
            create table if not exists ai_paper_strategy_runs (
                id uuid primary key default gen_random_uuid(),
                user_id uuid not null references users(id) on delete cascade,
                strategy_id varchar(80) not null,
                run_date date not null,
                start_capital numeric(24, 10) not null default 100000,
                current_capital numeric(24, 10) not null default 100000,
                roi numeric(12, 6) not null default 0,
                accuracy numeric(12, 6) not null default 0,
                max_drawdown numeric(12, 6) not null default 0,
                chart jsonb not null default '[]'::jsonb,
                trades jsonb not null default '[]'::jsonb,
                metadata jsonb not null default '{}'::jsonb,
                created_at timestamptz not null default now(),
                unique(user_id, strategy_id, run_date)
            )
            """
        )
        await connection.execute(
            """
            create table if not exists ai_strategy_connections (
                id uuid primary key default gen_random_uuid(),
                user_id uuid not null references users(id) on delete cascade,
                strategy_id varchar(80) not null,
                virtual_capital numeric(24, 10) not null default 100000,
                universe varchar(30) not null default 'mixed',
                risk_profile varchar(30) not null default 'balanced',
                capital_currency varchar(12) not null default 'RUB',
                margin_enabled boolean not null default false,
                margin_mode varchar(30) not null default 'none',
                leverage numeric(8, 3) not null default 1,
                is_active boolean not null default true,
                connected_at timestamptz not null default now(),
                updated_at timestamptz not null default now(),
                unique(user_id, strategy_id)
            )
            """
        )
        await connection.execute(
            """
            create table if not exists ai_strategy_events (
                id uuid primary key default gen_random_uuid(),
                user_id uuid not null references users(id) on delete cascade,
                strategy_id varchar(80) not null,
                event_key varchar(255) not null,
                asset_symbol varchar(40) not null,
                event_type varchar(60) not null,
                severity numeric(8, 4) not null default 0,
                result_percent numeric(12, 6) not null default 0,
                result_amount numeric(24, 10) not null default 0,
                close_reason varchar(80),
                context jsonb not null default '{}'::jsonb,
                lesson jsonb not null default '{}'::jsonb,
                created_at timestamptz not null default now(),
                unique(user_id, event_key)
            )
            """
        )
        await connection.execute(
            """
            create table if not exists ai_strategy_memory (
                id uuid primary key default gen_random_uuid(),
                user_id uuid not null references users(id) on delete cascade,
                strategy_id varchar(80) not null,
                asset_symbol varchar(40) not null,
                trades_count integer not null default 0,
                wins_count integer not null default 0,
                losses_count integer not null default 0,
                net_result_amount numeric(24, 10) not null default 0,
                avg_result_percent numeric(12, 6) not null default 0,
                memory_score numeric(8, 4) not null default 0,
                last_event_type varchar(60),
                last_lesson jsonb not null default '{}'::jsonb,
                gpt_review jsonb not null default '{}'::jsonb,
                last_reviewed_at timestamptz,
                created_at timestamptz not null default now(),
                updated_at timestamptz not null default now(),
                unique(user_id, strategy_id, asset_symbol)
            )
            """
        )
        await connection.execute(
            """
            create table if not exists ai_strategy_audit_logs (
                id uuid primary key default gen_random_uuid(),
                user_id uuid not null references users(id) on delete cascade,
                strategy_id varchar(80) not null,
                run_date date,
                audit_key varchar(255) not null,
                severity varchar(20) not null default 'warning',
                code varchar(80) not null,
                message text not null,
                payload jsonb not null default '{}'::jsonb,
                created_at timestamptz not null default now(),
                unique(user_id, audit_key)
            )
            """
        )
        await connection.execute(
            """
            create table if not exists ai_trade_decisions (
                id uuid primary key default gen_random_uuid(),
                user_id uuid not null references users(id) on delete cascade,
                strategy_id varchar(80),
                symbol varchar(40) not null,
                asset varchar(120),
                asset_type varchar(30) not null default 'crypto',
                strategy_type varchar(30) not null,
                final_action varchar(40) not null,
                confidence numeric(8, 6) not null default 0,
                probability_tp_before_sl numeric(8, 6) not null default 0,
                probability_long_success numeric(8, 6),
                probability_short_success numeric(8, 6),
                market_regime varchar(40) not null default 'UNKNOWN',
                technical_score numeric(8, 6) not null default 0,
                news_score numeric(8, 6),
                sentiment_score numeric(8, 6),
                risk_score numeric(8, 6) not null default 0,
                liquidity_score numeric(8, 6) not null default 0,
                volatility_score numeric(8, 6) not null default 0,
                entry_price numeric(24, 10) not null default 0,
                take_profit numeric(24, 10) not null default 0,
                stop_loss numeric(24, 10) not null default 0,
                risk_reward numeric(12, 6) not null default 0,
                expected_value_percent numeric(12, 6) not null default 0,
                estimated_fees_percent numeric(12, 6) not null default 0,
                estimated_slippage_percent numeric(12, 6) not null default 0,
                position_size_percent numeric(12, 6) not null default 0,
                max_risk_percent_of_deposit numeric(12, 6) not null default 0,
                validator_passed boolean not null default false,
                risk_manager_passed boolean not null default false,
                rejection_reason text,
                reasons_for jsonb not null default '[]'::jsonb,
                reasons_against jsonb not null default '[]'::jsonb,
                raw_features jsonb not null default '{}'::jsonb,
                decision_payload jsonb not null default '{}'::jsonb,
                result varchar(40),
                pnl_percent numeric(12, 6),
                pnl_amount numeric(24, 10),
                max_favorable_excursion numeric(12, 6),
                max_adverse_excursion numeric(12, 6),
                time_to_exit_seconds integer,
                exit_reason varchar(40),
                created_by varchar(80) not null default 'ai_brain_v1',
                created_at timestamptz not null default now()
            )
            """
        )
        strategy_connection_columns = {
            row["column_name"]
            for row in await connection.fetch(
                """
                select column_name
                from information_schema.columns
                where table_schema = current_schema()
                  and table_name = 'ai_strategy_connections'
                """
            )
        }
        strategy_connection_migrations = {
            "virtual_capital": "alter table ai_strategy_connections add column virtual_capital numeric(24, 10) not null default 100000",
            "universe": "alter table ai_strategy_connections add column universe varchar(30) not null default 'mixed'",
            "risk_profile": "alter table ai_strategy_connections add column risk_profile varchar(30) not null default 'balanced'",
            "capital_currency": "alter table ai_strategy_connections add column capital_currency varchar(12) not null default 'RUB'",
            "margin_enabled": "alter table ai_strategy_connections add column margin_enabled boolean not null default false",
            "margin_mode": "alter table ai_strategy_connections add column margin_mode varchar(30) not null default 'none'",
            "leverage": "alter table ai_strategy_connections add column leverage numeric(8, 3) not null default 1",
            "is_active": "alter table ai_strategy_connections add column is_active boolean not null default true",
            "connected_at": "alter table ai_strategy_connections add column connected_at timestamptz not null default now()",
            "updated_at": "alter table ai_strategy_connections add column updated_at timestamptz not null default now()",
        }

        for column_name, statement in strategy_connection_migrations.items():
            if column_name not in strategy_connection_columns:
                await connection.execute(statement)
        await connection.execute(
            """
            create table if not exists password_reset_codes (
                id uuid primary key default gen_random_uuid(),
                user_id uuid not null references users(id) on delete cascade,
                email varchar(255) not null,
                code_hash text not null,
                expires_at timestamptz not null,
                used_at timestamptz,
                created_at timestamptz not null default now()
            )
            """
        )
        await connection.execute(
            """
            create index if not exists idx_password_reset_codes_email
            on password_reset_codes(email)
            """
        )
        await connection.execute(
            """
            create index if not exists idx_password_reset_codes_user_created
            on password_reset_codes(user_id, created_at desc)
            """
        )
        await connection.execute("create index if not exists idx_users_email on users(email)")
        await connection.execute(
            "create index if not exists idx_wallet_connections_user_id on wallet_connections(user_id)"
        )
        await connection.execute(
            "create index if not exists idx_ai_trade_history_user_id on ai_trade_history(user_id)"
        )
        await connection.execute(
            "create index if not exists idx_portfolio_snapshots_user_id on portfolio_snapshots(user_id)"
        )
        await connection.execute(
            "create index if not exists idx_ai_asset_scores_user_symbol on ai_asset_scores(user_id, asset_type, symbol, created_at desc)"
        )
        await connection.execute(
            "create index if not exists idx_ai_paper_strategy_runs_user_date on ai_paper_strategy_runs(user_id, run_date desc)"
        )
        await connection.execute(
            "create index if not exists idx_ai_strategy_connections_user on ai_strategy_connections(user_id, is_active)"
        )
        await connection.execute(
            "create index if not exists idx_ai_strategy_events_user_strategy on ai_strategy_events(user_id, strategy_id, created_at desc)"
        )
        await connection.execute(
            "create index if not exists idx_ai_strategy_memory_user_strategy on ai_strategy_memory(user_id, strategy_id, memory_score desc)"
        )
        await connection.execute(
            "create index if not exists idx_ai_strategy_audit_logs_user_strategy on ai_strategy_audit_logs(user_id, strategy_id, created_at desc)"
        )
        await connection.execute(
            "create index if not exists idx_ai_trade_decisions_user_created on ai_trade_decisions(user_id, created_at desc)"
        )
        await connection.execute(
            "create index if not exists idx_ai_trade_decisions_user_symbol on ai_trade_decisions(user_id, symbol, created_at desc)"
        )
