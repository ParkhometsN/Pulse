from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import secrets
import smtplib
import re
import asyncpg
from uuid import UUID
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field

from src.config import settings
from src.database import get_database_pool


router = APIRouter(prefix="/auth", tags=["auth"])

PASSWORD_ITERATIONS = 180_000
RESET_CODE_TTL_MINUTES = 15
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class RegisterRequest(BaseModel):
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    password_confirm: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=1, max_length=128)


class CheckEmailRequest(BaseModel):
    email: str = Field(min_length=5, max_length=255)


class ForgotPasswordRequest(BaseModel):
    email: str = Field(min_length=5, max_length=255)


class ResetPasswordRequest(BaseModel):
    email: str = Field(min_length=5, max_length=255)
    code: str = Field(min_length=4, max_length=12)
    password: str = Field(min_length=8, max_length=128)
    password_confirm: str = Field(min_length=8, max_length=128)


class UpdateProfileRequest(BaseModel):
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=8, max_length=128)
    password_confirm: str = Field(min_length=8, max_length=128)


class DeleteAccountRequest(BaseModel):
    password: str = Field(min_length=1, max_length=128)


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _validate_email(email: str) -> str:
    normalized_email = _normalize_email(email)
    if not EMAIL_RE.match(normalized_email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Введите корректную почту.",
        )

    return normalized_email


def _hash_password(password: str) -> str:
    salt = secrets.token_urlsafe(18)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        PASSWORD_ITERATIONS,
    )

    return (
        f"pbkdf2_sha256${PASSWORD_ITERATIONS}${salt}$"
        f"{base64.urlsafe_b64encode(digest).decode('utf-8')}"
    )


def _verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, iterations_raw, salt, stored_digest = password_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False

        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            int(iterations_raw),
        )
        calculated_digest = base64.urlsafe_b64encode(digest).decode("utf-8")

        return hmac.compare_digest(calculated_digest, stored_digest)
    except (ValueError, TypeError):
        return False


def _base64_url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("utf-8")


def _base64_url_decode(value: str) -> bytes:
    padded = value + "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(padded.encode("utf-8"))


def _create_access_token(user_id: str, email: str) -> str:
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=settings.jwt_expires_minutes)
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": user_id,
        "email": email,
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    signing_input = ".".join(
        [
            _base64_url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8")),
            _base64_url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")),
        ]
    )
    signature = hmac.new(
        settings.resolved_jwt_secret.encode("utf-8"),
        signing_input.encode("utf-8"),
        hashlib.sha256,
    ).digest()

    return f"{signing_input}.{_base64_url_encode(signature)}"


def _decode_access_token(token: str) -> dict[str, Any]:
    try:
        header_raw, payload_raw, signature_raw = token.split(".", 2)
        signing_input = f"{header_raw}.{payload_raw}"
        expected_signature = hmac.new(
            settings.resolved_jwt_secret.encode("utf-8"),
            signing_input.encode("utf-8"),
            hashlib.sha256,
        ).digest()

        if not hmac.compare_digest(_base64_url_decode(signature_raw), expected_signature):
            raise ValueError("Invalid signature")

        payload = json.loads(_base64_url_decode(payload_raw))
        if int(payload.get("exp", 0)) < int(datetime.now(timezone.utc).timestamp()):
            raise ValueError("Token expired")

        return payload
    except (ValueError, json.JSONDecodeError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Сессия истекла. Войдите заново.",
        ) from None


def _public_user(row) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "firstName": row["first_name"],
        "lastName": row["last_name"],
        "email": row["email"],
        "avatarUrl": row["avatar_url"],
        "isEmailVerified": row["is_email_verified"],
    }


async def get_current_user(authorization: str | None = Header(default=None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Нужно войти в аккаунт.",
        )

    payload = _decode_access_token(authorization.split(" ", 1)[1])
    pool = get_database_pool()
    user = None

    for attempt in range(2):
        try:
            async with pool.acquire() as connection:
                user = await connection.fetchrow(
                    """
                    select id, first_name, last_name, email, avatar_url, is_email_verified
                    from users
                    where id = $1
                    """,
                    UUID(payload["sub"]),
                )
            break
        except (asyncpg.ConnectionDoesNotExistError, asyncpg.InterfaceError):
            if attempt == 1:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Соединение с базой данных временно недоступно. Повторите запрос.",
                ) from None

            await asyncio.sleep(0.1)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Аккаунт не найден.",
        )

    return user


def _hash_reset_code(code: str) -> str:
    return hmac.new(
        settings.resolved_jwt_secret.encode("utf-8"),
        code.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


async def _send_reset_code(email: str, code: str) -> bool:
    if not settings.smtp_host or not settings.smtp_from_email:
        return False

    def send_message() -> None:
        message = EmailMessage()
        message["Subject"] = "Код восстановления Pulse"
        message["From"] = settings.smtp_from_email
        message["To"] = email
        message.set_content(
            "Ваш код восстановления Pulse: "
            f"{code}\n\nКод действует {RESET_CODE_TTL_MINUTES} минут."
        )

        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=12) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            if settings.smtp_username and settings.smtp_password:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)

    await asyncio.to_thread(send_message)
    return True


@router.post("/register")
async def register(payload: RegisterRequest):
    if payload.password != payload.password_confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пароли не совпадают.",
        )

    pool = get_database_pool()
    email = _validate_email(payload.email)

    async with pool.acquire() as connection:
        existing_user = await connection.fetchval(
            "select id from users where email = $1",
            email,
        )
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Аккаунт с такой почтой уже существует.",
            )

        user = await connection.fetchrow(
            """
            insert into users (first_name, last_name, email, password_hash)
            values ($1, $2, $3, $4)
            returning id, first_name, last_name, email, avatar_url, is_email_verified
            """,
            payload.first_name.strip(),
            payload.last_name.strip(),
            email,
            _hash_password(payload.password),
        )

    token = _create_access_token(str(user["id"]), user["email"])
    return {"accessToken": token, "user": _public_user(user)}


@router.post("/login")
async def login(payload: LoginRequest):
    pool = get_database_pool()
    email = _validate_email(payload.email)

    async with pool.acquire() as connection:
        user = await connection.fetchrow(
            """
            select id, first_name, last_name, email, password_hash, avatar_url, is_email_verified
            from users
            where email = $1
            """,
            email,
        )

    if not user or not _verify_password(payload.password, user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверная почта или пароль.",
        )

    token = _create_access_token(str(user["id"]), user["email"])
    return {"accessToken": token, "user": _public_user(user)}


@router.post("/check-email")
async def check_email(payload: CheckEmailRequest):
    pool = get_database_pool()
    email = _validate_email(payload.email)

    async with pool.acquire() as connection:
        exists = await connection.fetchval(
            "select exists(select 1 from users where email = $1)",
            email,
        )

    return {"exists": bool(exists)}


@router.get("/me")
async def me(current_user=Depends(get_current_user)):
    return {"user": _public_user(current_user)}


@router.patch("/me")
async def update_me(payload: UpdateProfileRequest, current_user=Depends(get_current_user)):
    pool = get_database_pool()

    async with pool.acquire() as connection:
        user = await connection.fetchrow(
            """
            update users
            set first_name = $1,
                last_name = $2,
                updated_at = now()
            where id = $3
            returning id, first_name, last_name, email, avatar_url, is_email_verified
            """,
            payload.first_name.strip(),
            payload.last_name.strip(),
            current_user["id"],
        )

    return {"user": _public_user(user)}


@router.patch("/password")
async def change_password(payload: ChangePasswordRequest, current_user=Depends(get_current_user)):
    if payload.password != payload.password_confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пароли не совпадают.",
        )

    pool = get_database_pool()

    async with pool.acquire() as connection:
        password_hash = await connection.fetchval(
            "select password_hash from users where id = $1",
            current_user["id"],
        )

        if not password_hash or not _verify_password(payload.current_password, password_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Текущий пароль указан неверно.",
            )

        await connection.execute(
            """
            update users
            set password_hash = $1,
                updated_at = now()
            where id = $2
            """,
            _hash_password(payload.password),
            current_user["id"],
        )

    return {"message": "Пароль обновлён."}


@router.delete("/me")
async def delete_me(payload: DeleteAccountRequest, current_user=Depends(get_current_user)):
    pool = get_database_pool()

    async with pool.acquire() as connection:
        password_hash = await connection.fetchval(
            "select password_hash from users where id = $1",
            current_user["id"],
        )

        if not password_hash or not _verify_password(payload.password, password_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Пароль указан неверно.",
            )

        await connection.execute("delete from users where id = $1", current_user["id"])

    return {"message": "Аккаунт удалён."}


@router.post("/password/forgot")
async def forgot_password(payload: ForgotPasswordRequest):
    pool = get_database_pool()
    email = _validate_email(payload.email)
    code = f"{secrets.randbelow(900000) + 100000}"
    dev_code = None

    async with pool.acquire() as connection:
        user = await connection.fetchrow(
            "select id, email from users where email = $1",
            email,
        )
        if user:
            await connection.execute(
                """
                insert into password_reset_codes (user_id, email, code_hash, expires_at)
                values ($1, $2, $3, $4)
                """,
                user["id"],
                email,
                _hash_reset_code(code),
                datetime.now(timezone.utc) + timedelta(minutes=RESET_CODE_TTL_MINUTES),
            )

            sent = await _send_reset_code(email, code)
            if not sent and not settings.is_production:
                dev_code = code

    response = {
        "message": "Если аккаунт существует, мы отправили код восстановления.",
    }
    if dev_code:
        response["devCode"] = dev_code

    return response


@router.post("/password/reset")
async def reset_password(payload: ResetPasswordRequest):
    if payload.password != payload.password_confirm:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Пароли не совпадают.",
        )

    pool = get_database_pool()
    email = _validate_email(payload.email)
    code_hash = _hash_reset_code(payload.code.strip())

    async with pool.acquire() as connection:
        reset_code = await connection.fetchrow(
            """
            select id, user_id
            from password_reset_codes
            where email = $1
              and code_hash = $2
              and used_at is null
              and expires_at > now()
            order by created_at desc
            limit 1
            """,
            email,
            code_hash,
        )

        if not reset_code:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Код неверный или уже истёк.",
            )

        await connection.execute(
            """
            update users
            set password_hash = $1, updated_at = now()
            where id = $2
            """,
            _hash_password(payload.password),
            reset_code["user_id"],
        )
        await connection.execute(
            "update password_reset_codes set used_at = now() where id = $1",
            reset_code["id"],
        )

    return {"message": "Пароль обновлён. Теперь можно войти."}
