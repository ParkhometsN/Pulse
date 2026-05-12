from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import asyncpg

from src.config import settings


_pool: asyncpg.Pool | None = None


def _normalize_neon_dsn(dsn: str) -> str:
    parts = urlsplit(dsn)
    query = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if key.lower() != "sslmode"
    ]

    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


async def connect_database() -> None:
    global _pool

    if _pool is not None:
        return

    dsn = settings.resolved_database_url
    if not dsn:
        raise RuntimeError("PULSE_DATABASE_URL or DATABASE_URL is required")

    _pool = await asyncpg.create_pool(
        dsn=_normalize_neon_dsn(dsn),
        ssl="require",
        min_size=1,
        max_size=5,
        command_timeout=15,
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
