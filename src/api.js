// ── API 호출 (CoinGecko + DeFiLlama) ────────────────────────────────────

const CG_BASE   = 'https://api.coingecko.com/api/v3';
const LLAMA_API = 'https://api.llama.fi';

const COIN_IDS = {
  USDT:  'tether',
  USDC:  'usd-coin',
  DAI:   'dai',
  PYUSD: 'paypal-usd',
};

// rate-limit-aware fetch: 429는 잠시 기다렸다가 1회 재시도
async function safeFetch(url) {
  let res = await fetch(url);
  if (res.status === 429) {
    await new Promise(r => setTimeout(r, 8000));
    res = await fetch(url);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchCurrent() {
  const ids  = Object.values(COIN_IDS).join(',');
  const data = await safeFetch(
    `${CG_BASE}/coins/markets?vs_currency=usd&ids=${ids}`
  );

  const result = {};
  for (const coin of data) {
    const sym = Object.keys(COIN_IDS).find(k => COIN_IDS[k] === coin.id);
    if (sym) {
      result[sym] = {
        price:     coin.current_price,
        volume24h: coin.total_volume,
        supply:    coin.circulating_supply,
      };
    }
  }
  return result;
}

export async function fetchVolumes30d(symbol) {
  const id   = COIN_IDS[symbol];
  const data = await safeFetch(
    `${CG_BASE}/coins/${id}/market_chart?vs_currency=usd&days=30&interval=daily`
  );
  return data.total_volumes.map(v => v[1]);
}

export async function fetchMakerTVL() {
  const data = await safeFetch(`${LLAMA_API}/protocol/makerdao`);
  const tvlList = data.tvl ?? [];
  return tvlList.length > 0 ? tvlList[tvlList.length - 1].totalLiquidityUSD : 0;
}
