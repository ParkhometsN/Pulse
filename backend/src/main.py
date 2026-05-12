from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.router import router as router_crypto
from src.stocks_router import router as router_stocks
from src.news_router import router as router_news
from src.auth_router import router as router_auth
from src.database import close_database, connect_database, ensure_auth_schema
from src.init import bybit_client, coingecko_client, moex_client


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_database()
    await ensure_auth_schema()
    yield
    await close_database()
    await bybit_client.close()
    await moex_client.close()
    await coingecko_client.close()


app = FastAPI(lifespan=lifespan)

app.include_router(router_crypto)
app.include_router(router_stocks)
app.include_router(router_news)
app.include_router(router_auth)

# Health check endpoint
@app.get("/health")
async def health_check():
    return {"status": "healthy"}

origins = [
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
    "http://frontend:5173",  # Docker container
    "http://localhost:8000",  # Docker localhost
    "http://127.0.0.1:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# python3 -m uvicorn src.main:app --reload
# lsof -i :8000 
# kill -9
