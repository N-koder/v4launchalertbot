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

function fetchRawFast(urlStr, timeoutMs = 4500) {
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
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms: ${urlStr}`));
    });
    req.on('error', reject);
  });
}

async function fetchJsonFast(urlStr, timeoutMs = 4500) {
  const raw = await fetchRawFast(urlStr, timeoutMs);
  return JSON.parse(raw);
}

function postJsonFast(urlStr, bodyObj, timeoutMs = 3500) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(bodyObj);
    const u = new URL(urlStr);
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'POST',
        agent: keepAliveAgent,
        headers: {
          ...HEADERS,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('RPC timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Decodes Programmable.market on-chain token `metadata()` -> (string description, string website, string imageURI, bytes socialData)
 * Selector: 0x392f37e9
 */
const progMetaCache = new Map();

function decodeAbiTuple4(hexResult) {
  if (!hexResult || !hexResult.startsWith('0x') || hexResult.length < 258) return null;
  const buf = Buffer.from(hexResult.slice(2), 'hex');
  // Check if wrapped in outer tuple offset (0x20) or direct 4 offsets (0x80...)
  const firstWord = Number(BigInt('0x' + buf.subarray(0, 32).toString('hex')));
  const baseOffset = firstWord === 32 && buf.length >= 160 ? 32 : 0;

  const readField = (idx) => {
    const ptrPos = baseOffset + idx * 32;
    if (ptrPos + 32 > buf.length) return Buffer.alloc(0);
    const relOffset = Number(BigInt('0x' + buf.subarray(ptrPos, ptrPos + 32).toString('hex')));
    const lenPos = baseOffset + relOffset;
    if (lenPos + 32 > buf.length) return Buffer.alloc(0);
    const byteLen = Number(BigInt('0x' + buf.subarray(lenPos, lenPos + 32).toString('hex')));
    if (byteLen <= 0 || lenPos + 32 + byteLen > buf.length) return Buffer.alloc(0);
    return buf.subarray(lenPos + 32, lenPos + 32 + byteLen);
  };

  const description = readField(0).toString('utf8').trim();
  const website = readField(1).toString('utf8').trim();
  const imageURI = readField(2).toString('utf8').trim();
  const socialRaw = readField(3).toString('utf8').trim();

  let socials = {};
  if (socialRaw && socialRaw.startsWith('{')) {
    try {
      const parsed = JSON.parse(socialRaw);
      if (parsed.x || parsed.twitter) socials.twitter = parsed.x || parsed.twitter;
      if (parsed.telegram || parsed.tg) socials.telegram = parsed.telegram || parsed.tg;
      if (parsed.discord) socials.discord = parsed.discord;
      if (parsed.github) socials.github = parsed.github;
    } catch {}
  }
  if (website) socials.website = website;

  return {
    description,
    website,
    imageURI,
    socials,
  };
}

async function resolveProgrammableOnChainMetadata(tokenAddress, chainId = 1) {
  const key = `${chainId}:${String(tokenAddress).toLowerCase()}`;
  if (progMetaCache.has(key)) return progMetaCache.get(key);

  const rpcUrl =
    chainId === 4663 ? 'https://rpc.mainnet.chain.robinhood.com' : 'https://ethereum-rpc.publicnode.com';

  try {
    const rpcRes = await postJsonFast(
      rpcUrl,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: tokenAddress, data: '0x392f37e9' }, 'latest'],
      },
      2500
    );
    if (rpcRes && rpcRes.result && rpcRes.result !== '0x') {
      const decoded = decodeAbiTuple4(rpcRes.result);
      if (decoded) {
        progMetaCache.set(key, decoded);
        return decoded;
      }
    }
  } catch {}
  return null;
}

/**
 * Resolves Stockereum token page metadata (creator, lore/description, web, x, tg)
 */
const stockMetaCache = new Map();

async function resolveStockereumMeta(tokenAddress) {
  const key = String(tokenAddress).toLowerCase();
  if (stockMetaCache.has(key)) return stockMetaCache.get(key);

  try {
    const html = await fetchRawFast(`https://stockereum.com/t/${tokenAddress}`, 2800);
    const metaMatch = html.match(/\\"metadataUri\\":\\"(\{.*?\})\\"/);
    const creatorMatch = html.match(/\\"creator\\":\\"(0x[a-fA-F0-9]{40})\\"/);
    const hookMatch = html.match(/\\"hook\\":\\"(0x[a-fA-F0-9]{40})\\"/);

    const out = {
      creator: creatorMatch ? creatorMatch[1] : null,
      hookAddress: hookMatch ? hookMatch[1] : null,
      lore: '',
      socials: {},
    };

    if (metaMatch && metaMatch[1]) {
      const unescaped = metaMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      const parsed = JSON.parse(unescaped);
      if (parsed.description) out.lore = parsed.description.trim();
      if (parsed.web) out.socials.website = parsed.web.trim();
      if (parsed.x) out.socials.twitter = parsed.x.trim();
      if (parsed.tg) out.socials.telegram = parsed.tg.trim();
    }

    stockMetaCache.set(key, out);
    return out;
  } catch {
    return null;
  }
}

/**
 * 1. Fetch Programmable.market (Ethereum Mainnet)
 */
async function fetchProgrammableEthereum() {
  const url = 'https://programmable.market/api/explore/ethereum?page=1&pageSize=50&sort=newest&mode=all';
  const data = await fetchJsonFast(url);
  if (!data || !Array.isArray(data.items)) return [];

  // Resolve on-chain metadata (Lore, Image, Web, X, TG) in parallel for the newest 8 tokens!
  const items = data.items.filter((item) => item && item.tokenAddress);
  const topAddresses = new Set(items.slice(0, 8).map((x) => x.tokenAddress.toLowerCase()));

  await Promise.allSettled(
    items.slice(0, 8).map((item) => resolveProgrammableOnChainMetadata(item.tokenAddress, 1))
  );

  return items.map((item) => {
    const launchedAtMs = item.launchedAt ? new Date(item.launchedAt).getTime() : Date.now();
    const meta = topAddresses.has(item.tokenAddress.toLowerCase())
      ? progMetaCache.get(`1:${item.tokenAddress.toLowerCase()}`)
      : progMetaCache.get(`1:${item.tokenAddress.toLowerCase()}`);

    const image =
      meta?.imageURI && meta.imageURI.startsWith('http')
        ? meta.imageURI
        : 'https://programmable.market/og/programmable-landing-preview-v2-1200x630.jpg';
    const lore = meta?.description || '';
    const socials = { ...(meta?.socials || {}) };

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
      image,
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
      lore,
      description: lore || `Launched via Programmable (${item.category || 'custom'} module) with Uniswap v4 Hook.`,
      socials,
      platformUrl: `https://programmable.market/modules/${item.tokenAddress}?chainId=1`,
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

  const items = data.items.filter((item) => item && item.tokenAddress);
  await Promise.allSettled(
    items.slice(0, 5).map((item) => resolveProgrammableOnChainMetadata(item.tokenAddress, 4663))
  );

  return items.map((item) => {
    const launchedAtMs = item.launchedAt ? new Date(item.launchedAt).getTime() : Date.now();
    const meta = progMetaCache.get(`4663:${item.tokenAddress.toLowerCase()}`);
    const image =
      meta?.imageURI && meta.imageURI.startsWith('http')
        ? meta.imageURI
        : 'https://programmable.market/og/programmable-landing-preview-v2-1200x630.jpg';
    const lore = meta?.description || '';
    const socials = { ...(meta?.socials || {}) };

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
      image,
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
      lore,
      description: lore || `Launched on Programmable Robinhood Chain V4.`,
      socials,
      platformUrl: `https://programmable.market/modules/${item.tokenAddress}`,
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

  const sorted = data.items
    .filter((item) => item && item.token)
    .sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0));

  // Resolve off-chain lore, creator & socials for the 6 newest Stockereum tokens in parallel
  await Promise.allSettled(sorted.slice(0, 6).map((item) => resolveStockereumMeta(item.token)));

  return sorted.map((item) => {
    const launchedAtMs = item.openedAt ? item.openedAt * 1000 : Date.now();
    const feePct = item.feePpm ? `${(item.feePpm / 10000).toFixed(2)}%` : '1.00%';
    const quoteBadge =
      item.quoteKind === 'stock'
        ? `📈 Stock RWA (${item.quoteSymbol || 'ETH'})`
        : item.quoteKind === 'meme'
        ? `🐸 Meme Pair (${item.quoteSymbol || 'ETH'})`
        : `💎 Crypto Pair (${item.quoteSymbol || 'ETH'})`;

    const extra = stockMetaCache.get(String(item.token).toLowerCase());
    const lore = extra?.lore || '';
    const socials = { ...(extra?.socials || {}) };

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
      creator: extra?.creator || null,
      hookAddress: extra?.hookAddress || null,
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
      lore,
      description:
        lore ||
        `Paired with ${item.quoteSymbol || 'ETH'} (${item.quoteKind || 'crypto'}) on Stockereum • Pool Fee: ${feePct}${
          item.feesToHolders ? ' (Fees to Holders)' : ''
        }`,
      socials,
      platformUrl: `https://stockereum.com/t/${item.token}`,
      explorerUrl: `https://etherscan.io/token/${item.token}`,
      dexScreenerUrl: `https://dexscreener.com/ethereum/${item.token}`,
      dexToolsUrl: `https://www.dextools.io/app/en/ether/pair-explorer/${item.token}`,
      launchedAtMs,
    };
  });
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

  const results = await Promise.all(
    newest.map(async (item) => {
      let image = item.image || null;
      let bio = '';
      const socials = {};

      if (item.description && item.description.startsWith('http')) {
        const meta = await resolveSenderMeta(item.description);
        if (meta) {
          if (meta.image) image = meta.image;
          if (meta.description) bio = meta.description.trim();
          if (meta.x) socials.twitter = meta.x.trim();
          if (meta.telegram) socials.telegram = meta.telegram.trim();
          if (meta.website) socials.website = meta.website.trim();
        }
      } else if (item.description) {
        bio = item.description.trim();
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
        lore: bio,
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

/**
 * 4. Fetch live real-time Market Cap, Volume, Price Change, Buys/Sells AND Socials from DexScreener API
 */
async function fetchDexScreenerStats(tokenAddress) {
  try {
    const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
    const data = await fetchJsonFast(url, 3500);
    if (!data || !Array.isArray(data.pairs) || data.pairs.length === 0) return null;

    // Pick pair where baseToken matches tokenAddress and has highest liquidity/volume
    const matchingPairs = data.pairs.filter(
      (p) => p.baseToken?.address?.toLowerCase() === String(tokenAddress).toLowerCase()
    );
    const pair = (matchingPairs.length > 0 ? matchingPairs : data.pairs)[0];

    const buys = pair.txns?.h24?.buys ?? 0;
    const sells = pair.txns?.h24?.sells ?? 0;
    const socials = {};
    if (pair.info?.websites?.[0]?.url) {
      socials.website = pair.info.websites[0].url;
    }
    if (Array.isArray(pair.info?.socials)) {
      for (const s of pair.info.socials) {
        if (s.type === 'twitter' && s.url) socials.twitter = s.url;
        if (s.type === 'telegram' && s.url) socials.telegram = s.url;
        if (s.type === 'discord' && s.url) socials.discord = s.url;
      }
    }

    return {
      marketCapUsd: pair.marketCap || pair.fdv || null,
      volumeUsd: pair.volume?.h24 ?? null,
      volume5mUsd: pair.volume?.m5 ?? null,
      priceChange5m: pair.priceChange?.m5 ?? null,
      priceChange24h: pair.priceChange?.h24 ?? null,
      buys,
      sells,
      trades: buys + sells,
      liquidityUsd: pair.liquidity?.usd ?? null,
      poolQuoteEth: pair.liquidity?.quote ?? null,
      image: pair.info?.imageUrl || null,
      socials,
    };
  } catch {
    return null;
  }
}

module.exports = {
  fetchProgrammableEthereum,
  fetchProgrammableRobinhood,
  fetchStockereum,
  fetchSender,
  fetchDexScreenerStats,
  resolveProgrammableOnChainMetadata,
  resolveStockereumMeta,
};
