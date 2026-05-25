import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.router import router as router_crypto
from src.stocks_router import router as router_stocks
from src.news_router import router as router_news
from src.auth_router import router as router_auth
from src.wallets_router import router as router_wallets
from src.ai_router import paper_strategy_scheduler, router as router_ai
from src.config import settings
from src.database import close_database, connect_database, ensure_auth_schema
from src.init import bybit_client, coingecko_client, moex_client, tbank_client


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.validate_runtime()
    await asyncio.wait_for(connect_database(), timeout=30)
    await asyncio.wait_for(ensure_auth_schema(), timeout=90)
    stop_strategy_scheduler = asyncio.Event()
    strategy_scheduler_task = asyncio.create_task(paper_strategy_scheduler(stop_strategy_scheduler))

    try:
        yield
    finally:
        stop_strategy_scheduler.set()
        strategy_scheduler_task.cancel()
        try:
            await strategy_scheduler_task
        except asyncio.CancelledError:
            pass
    await close_database()
    await bybit_client.close()
    await moex_client.close()
    await coingecko_client.close()
    await tbank_client.close()


app = FastAPI(lifespan=lifespan)

app.include_router(router_crypto)
app.include_router(router_stocks)
app.include_router(router_news)
app.include_router(router_auth)
app.include_router(router_wallets)
app.include_router(router_ai)

# Health check endpoint
@app.get("/health")
async def health_check():
    return {"status": "healthy"}

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.resolved_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# python3 -m uvicorn src.main:app --reload
# lsof -i :8000 
# kill -9
