from src.http_client import BybitHTTPClient, CoinGeckoHTTPClient, MoexHTTPClient

bybit_client = BybitHTTPClient(
    base_url="https://api.bybit.com"
)

moex_client = MoexHTTPClient(
    base_url="https://iss.moex.com"
)

coingecko_client = CoinGeckoHTTPClient(
    base_url="https://api.coingecko.com"
)
