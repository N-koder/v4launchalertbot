const https = require('https');

// Persistent HTTP/1.1 Keep-Alive Agent — eliminates TCP & TLS handshake latency on every poll!
const keepAliveAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 32,
  maxFreeSockets: 16,
  timeout: 8000,
});

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  Pragma: 'no-cache',
  Connection: 'keep-alive',
};

function fetchJsonFast(urlStr, timeoutMs = 4500) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      urlStr,
      {
        agent: keepAliveAgent,
        headers: HEADERS,
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} from ${urlStr}`));
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf8');
            resolve(JSON.parse(raw));
          } catch (err) {
            reject(err);
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms: ${urlStr}`));
    });
    req.on('error', reject);
  });
}

/**
 * 1. Fetch Programmable.market (Ethereum Mainnet) — Smallest pageSize=6 for fastest response
 */
async function fetchProgrammableEthereum() {
  const url = 'https://programmable.market/api/explore/ethereum?page=1&pageSize=6&sort=newest&mode=all';
  const data = await fetchJsonFast(url);
  if (!data || !Array.isArray(data.items)) return [];

  return data.items
    .filter((item) => item && item.tokenAddress)
    .map((item) => {
      const launchedAtMs = item.launchedAt ? new Date(item.launchedAt).getTime() : Date.now();
      return {
        platformKey: 'programmable',
        platformName: 'Programmable.market',
        platformBadge: '🟣 PROGRAMMABLE',
        platformColor: '#a855f7',
        chainName: 'Ethereum Mainnet (Uni v4)',
        chainId: 1,
        address: item.tokenAddress,
        name: item.name || 'Unknown',
        symbol: item.symbol || '???',
        image: 'https://programmable.market/og/programmable-landing-preview-v2-1200x630.jpg',
        creator: item.creator || null,
        hookAddress: item.hookAddress || null,
        routerAddress: item.provenance?.routerAddress || item.routerAddress || null,
        transactionHash: item.transactionHash || null,
        blockNumber: item.blockNumber || null,
        category: item.category ? item.category.toUpperCase() : 'CUSTOM HOOK',
        quoteSymbol: 'ETH',
        quoteKind: 'Uniswap v4 Hook',
        marketCapUsd: null,
        volumeUsd: null,
        poolQuoteEth: null,
        graduated: true,
        description: `Launched via Programmable (${item.category || 'custom'} module) with Uniswap v4 Hook.`,
        socials: {},
        platformUrl: `https://programmable.market/token/${item.tokenAddress}`,
        explorerUrl: `https://etherscan.io/token/${item.tokenAddress}`,
        dexScreenerUrl: `https://dexscreener.com/ethereum/${item.tokenAddress}`,
        dexToolsUrl: `https://www.dextools.io/app/en/ether/pair-explorer/${item.tokenAddress}`,
        launchedAtMs,
      };
    });
}

/**
 * 1b. Fetch Programmable.market (Robinhood Chain V4)
 */
async function fetchProgrammableRobinhood() {
  const url = 'https://programmable.market/api/explore/robinhood?page=1&pageSize=6&sort=newest';
  const data = await fetchJsonFast(url);
  if (!data || !Array.isArray(data.items)) return [];

  return data.items
    .filter((item) => item && item.tokenAddress)
    .map((item) => {
      const launchedAtMs = item.launchedAt ? new Date(item.launchedAt).getTime() : Date.now();
      return {
        platformKey: 'programmable_robinhood',
        platformName: 'Programmable (Robinhood Chain)',
        platformBadge: '🟣 PROGRAMMABLE (RH)',
        platformColor: '#c084fc',
        chainName: 'Robinhood Chain (Uni v4)',
        chainId: 4663,
        address: item.tokenAddress,
        name: item.name || 'Unknown',
        symbol: item.symbol || '???',
        image: 'https://programmable.market/og/programmable-landing-preview-v2-1200x630.jpg',
        creator: item.creator || null,
        hookAddress: item.hookAddress || null,
        routerAddress: item.routerAddress || null,
        transactionHash: item.transactionHash || null,
        blockNumber: item.blockNumber || null,
        category: 'ROBINHOOD V4',
        quoteSymbol: 'ETH',
        quoteKind: 'Robinhood v4 Hook',
        marketCapUsd: null,
        volumeUsd: null,
        poolQuoteEth: null,
        graduated: true,
        description: `Launched on Programmable Robinhood Chain V4.`,
        socials: {},
        platformUrl: `https://programmable.market/token/${item.tokenAddress}`,
        explorerUrl: `https://etherscan.io/token/${item.tokenAddress}`,
        dexScreenerUrl: item.poolId
          ? `https://dexscreener.com/robinhood/${item.poolId}`
          : `https://dexscreener.com/ethereum/${item.tokenAddress}`,
        dexToolsUrl: `https://www.dextools.io/app/en/ether/pair-explorer/${item.tokenAddress}`,
        launchedAtMs,
      };
    });
}

/**
 * 2. Fetch Stockereum.com
 */
async function fetchStockereum() {
  const url = 'https://stockereum.com/api/board?sort=new&page=1';
  const data = await fetchJsonFast(url);
  if (!data || !Array.isArray(data.items)) return [];

  return data.items
    .filter((item) => item && item.token)
    .map((item) => {
      const launchedAtMs = item.openedAt ? item.openedAt * 1000 : Date.now();
      const feePct = item.feePpm ? `${(item.feePpm / 10000).toFixed(2)}%` : '1.00%';
      const quoteBadge =
        item.quoteKind === 'stock'
          ? `📈 Stock RWA (${item.quoteSymbol || 'ETH'})`
          : item.quoteKind === 'meme'
          ? `🐸 Meme Pair (${item.quoteSymbol || 'ETH'})`
          : `💎 Crypto Pair (${item.quoteSymbol || 'ETH'})`;

      return {
        platformKey: 'stockereum',
        platformName: 'Stockereum.com',
        platformBadge: '🟢 STOCKEREUM',
        platformColor: '#22c55e',
        chainName: 'Ethereum Mainnet (Uni v4)',
        chainId: 1,
        address: item.token,
        name: item.name || 'Unknown',
        symbol: item.symbol || '???',
        image: item.image || null,
        creator: null,
        hookAddress: null,
        transactionHash: null,
        blockNumber: null,
        category: quoteBadge,
        quoteSymbol: item.quoteSymbol || 'ETH',
        quoteKind: item.quoteKind || 'crypto',
        marketCapUsd: item.marketCapUsd ?? null,
        volumeUsd: item.volumeUsd ?? null,
        volume24Usd: item.volume24Usd ?? null,
        volumeCoin: null,
        trades: item.trades ?? 0,
        poolQuoteEth: item.poolQuoteEth ?? null,
        feePct,
        feesToHolders: Boolean(item.feesToHolders),
        graduated: Boolean(item.graduated),
        description: `Paired with ${item.quoteSymbol || 'ETH'} (${item.quoteKind || 'crypto'}) on Stockereum • Pool Fee: ${feePct}${
          item.feesToHolders ? ' (Fees to Holders)' : ''
        }`,
        socials: {},
        platformUrl: `https://stockereum.com/t/${item.token}`,
        explorerUrl: `https://etherscan.io/token/${item.token}`,
        dexScreenerUrl: `https://dexscreener.com/ethereum/${item.token}`,
        dexToolsUrl: `https://www.dextools.io/app/en/ether/pair-explorer/${item.token}`,
        launchedAtMs,
      };
    })
    .sort((a, b) => b.launchedAtMs - a.launchedAtMs);
}

/**
 * 3. Fetch Sender.family
 * Resolves Cloudinary off-chain metadata in PARALLEL with a 1.5s fast timeout so it never delays an alert!
 */
const senderMetaCache = new Map();

async function resolveSenderMeta(metaUrl) {
  if (!metaUrl || !metaUrl.startsWith('http')) return null;
  if (senderMetaCache.has(metaUrl)) return senderMetaCache.get(metaUrl);
  try {
    const meta = await fetchJsonFast(metaUrl, 1500);
    senderMetaCache.set(metaUrl, meta);
    return meta;
  } catch {
    return null;
  }
}

async function fetchSender() {
  const url = 'https://sender.family/api/markets';
  const data = await fetchJsonFast(url);
  if (!data || !Array.isArray(data.markets)) return [];

  const newest = [...data.markets]
    .filter((m) => m && m.address)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 10);

  // Resolve all off-chain metadata in parallel instead of sequentially!
  const results = await Promise.all(
    newest.map(async (item) => {
      let image = item.image || null;
      let bio = '';
      const socials = {};

      if (item.description && item.description.startsWith('http')) {
        const meta = await resolveSenderMeta(item.description);
        if (meta) {
          if (meta.image) image = meta.image;
          if (meta.description) bio = meta.description;
          if (meta.x) socials.twitter = meta.x;
          if (meta.telegram) socials.telegram = meta.telegram;
          if (meta.website) socials.website = meta.website;
        }
      } else if (item.description) {
        bio = item.description;
      }

      const launchedAtMs = item.createdAt ? item.createdAt * 1000 : Date.now();
      const mcapUsd =
        item.analyticsFdv && item.quoteUsd ? item.analyticsFdv * item.quoteUsd : item.analyticsFdv || null;

      return {
        platformKey: 'sender',
        platformName: 'Sender.family',
        platformBadge: '🔵 SENDER.FAMILY',
        platformColor: '#3b82f6',
        chainName: 'Ethereum Mainnet (Uni v4)',
        chainId: 1,
        address: item.address,
        name: item.name || 'Unknown',
        symbol: item.symbol || '???',
        image: image || 'https://sender.family/icon.png',
        creator: item.creator || null,
        factory: item.factory || null,
        locker: item.locker || null,
        category: `Sender ${item.generation || 'v2'} (${item.quoteSymbol || 'ETH'})`,
        quoteSymbol: item.quoteSymbol || 'ETH',
        quoteKind: 'Uniswap v4 Locked',
        marketCapUsd: mcapUsd,
        volumeUsd: item.volume24hEth && item.quoteUsd ? item.volume24hEth * item.quoteUsd : null,
        volumeCoin: item.volume24hEth ?? null,
        poolQuoteEth: item.ethInPool ?? null,
        holders: item.holders ?? 0,
        graduated: Boolean(item.graduated),
        description:
          bio ||
          `Fixed-supply Uniswap v4 launch on Sender.family (${item.generation || 'v2'}) • Liquidity Locked`,
        socials,
        platformUrl: `https://sender.family/market/${String(item.address).toLowerCase()}`,
        explorerUrl: `https://etherscan.io/token/${item.address}`,
        dexScreenerUrl: `https://dexscreener.com/ethereum/${item.address}`,
        dexToolsUrl: `https://www.dextools.io/app/en/ether/pair-explorer/${item.address}`,
        launchedAtMs,
      };
    })
  );

  return results;
}

module.exports = {
  fetchProgrammableEthereum,
  fetchProgrammableRobinhood,
  fetchStockereum,
  fetchSender,
};
