from src.http_client import BybitHTTPClient, CoinGeckoHTTPClient, MoexHTTPClient
from src.tbank_client import TBankInvestClient

bybit_client = BybitHTTPClient(
    base_url="https://api.bybit.com"
)

moex_client = MoexHTTPClient(
    base_url="https://iss.moex.com"
)

coingecko_client = CoinGeckoHTTPClient(
    base_url="https://api.coingecko.com"
)

tbank_client = TBankInvestClient(
    base_url="https://invest-public-api.tinkoff.ru"
)
