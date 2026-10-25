const https = require('https');
const zlib = require('zlib');

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
  'Accept-Encoding': 'gzip, deflate, br',
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
          const buffer = Buffer.concat(chunks);
          const enc = res.headers['content-encoding'];
          try {
            if (enc === 'br') {
              resolve(zlib.brotliDecompressSync(buffer).toString('utf8'));
            } else if (enc === 'gzip') {
              resolve(zlib.gunzipSync(buffer).toString('utf8'));
            } else if (enc === 'deflate') {
              resolve(zlib.inflateSync(buffer).toString('utf8'));
            } else {
              resolve(buffer.toString('utf8'));
            }
          } catch (decompErr) {
            reject(decompErr);
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

async function fetchJsonFast(urlStr, timeoutMs = 8000) {
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
    const metaMatch = html.match(/\\"metadataUri\\":\\"(\{\\"[\s\S]*?\})\\"/);
    const creatorMatch = html.match(/\\"creator\\":\\"(0x[a-fA-F0-9]{40})\\"/);
    const hookMatch = html.match(/\\"hook\\":\\"(0x[a-fA-F0-9]{40})\\"/);
    const webMatch = html.match(/\\"web\\":\\"(https?:\/\/[^"\\]+)\\"/);
    const xMatch = html.match(/\\"x\\":\\"(https?:\/\/[^"\\]+)\\"/);
    const tgMatch = html.match(/\\"tg\\":\\"(https?:\/\/[^"\\]+)\\"/);
    const descMatch = html.match(/\\\\\\"description\\\\\\":\\\\\\"([^\\"]*)\\\\\\"/) || html.match(/\\"description\\":\\"([^"\\]+)\\"/);

    const out = {
      creator: creatorMatch ? creatorMatch[1] : null,
      hookAddress: hookMatch ? hookMatch[1] : null,
      lore: descMatch && descMatch[1] && !descMatch[1].startsWith('Create a fixed-supply') ? descMatch[1].trim() : '',
      socials: {},
    };

    if (webMatch && webMatch[1]) out.socials.website = webMatch[1].trim();
    if (xMatch && xMatch[1]) out.socials.twitter = xMatch[1].trim();
    if (tgMatch && tgMatch[1]) out.socials.telegram = tgMatch[1].trim();

    if (metaMatch && metaMatch[1]) {
      try {
        const unescaped = metaMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        const parsed = JSON.parse(unescaped);
        if (parsed.description) out.lore = parsed.description.trim();
        if (parsed.web) out.socials.website = parsed.web.trim();
        if (parsed.x) out.socials.twitter = parsed.x.trim();
        if (parsed.tg) out.socials.telegram = parsed.tg.trim();
      } catch {}
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
  const url = 'https://programmable.market/api/explore/ethereum';
  let data;
  try {
    data = await fetchJsonFast(url, 7000);
  } catch (err) {
    console.warn('[Programmable ETH] Fetch error:', err.message);
    return [];
  }
  if (!data || !Array.isArray(data.items)) return [];

  // Index presentations for immediate high-res image, description & socials
  const presMap = new Map();
  if (Array.isArray(data.presentations)) {
    data.presentations.forEach((p) => {
      if (p && p.tokenAddress) presMap.set(p.tokenAddress.toLowerCase(), p);
    });
  }

  const items = data.items.filter((item) => item && item.tokenAddress);

  // Background fetch GeckoTerminal stats for top items
  items.slice(0, 5).forEach((item) => {
    fetchGeckoTerminalStats(item.tokenAddress, 'eth').catch(() => {});
  });

  return items.map((item) => {
    const addr = item.tokenAddress.toLowerCase();
    const pres = presMap.get(addr);
    const gt = gtStatsCache.get(`eth:${addr}`)?.data;

    const launchedAtMs = item.launchedAt ? new Date(item.launchedAt).getTime() : Date.now();
    const meta = progMetaCache.get(`1:${addr}`);

    let image = pres?.imageUrl || meta?.imageURI;
    if (!image || !image.startsWith('http')) {
      image = 'https://programmable.market/og/programmable-landing-preview-v2-1200x630.jpg';
    }

    const lore = pres?.description || meta?.description || '';
    const socials = { ...(meta?.socials || {}) };
    if (Array.isArray(pres?.links)) {
      pres.links.forEach((l) => {
        if (l.label === 'website' && l.url) socials.website = l.url;
        if ((l.label === 'x' || l.label === 'twitter') && l.url) socials.twitter = l.url;
        if (l.label === 'telegram' && l.url) socials.telegram = l.url;
      });
    }

    // Live GeckoTerminal Uniswap v4 FDV, or standard Uni v4 curve initial valuation ($5.0K)
    const mcapUsd = gt?.marketCapUsd || 4995;

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
      marketCapUsd: mcapUsd,
      volumeUsd: gt?.volumeUsd || null,
      liquidityUsd: gt?.liquidityUsd || null,
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
  const url = 'https://programmable.market/api/explore/robinhood';
  let data;
  try {
    data = await fetchJsonFast(url, 7000);
  } catch (err) {
    console.warn('[Programmable RH] Fetch error:', err.message);
    return [];
  }
  if (!data || !Array.isArray(data.items)) return [];

  const items = data.items.filter((item) => item && item.tokenAddress);

  return items.map((item) => {
    const addr = item.tokenAddress.toLowerCase();
    const launchedAtMs = item.launchedAt ? new Date(item.launchedAt).getTime() : Date.now();
    const meta = progMetaCache.get(`4663:${addr}`);
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
      marketCapUsd: 5000,
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

  // Trigger off-chain metadata resolution in background without blocking this poll cycle
  sorted.slice(0, 6).forEach((item) => {
    if (!stockMetaCache.has(String(item.token).toLowerCase())) {
      resolveStockereumMeta(item.token).catch(() => {});
    }
  });

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

  const results = newest.map((item) => {
    let image = item.image || null;
    let bio = '';
    const socials = {};

    if (item.description && item.description.startsWith('http')) {
      if (senderMetaCache.has(item.description)) {
        const meta = senderMetaCache.get(item.description);
        if (meta) {
          if (meta.image) image = meta.image;
          if (meta.description) bio = meta.description.trim();
          if (meta.x) socials.twitter = meta.x.trim();
          if (meta.telegram) socials.telegram = meta.telegram.trim();
          if (meta.website) socials.website = meta.website.trim();
        }
      } else {
        // Trigger background resolution so future live-edits have full bio
        resolveSenderMeta(item.description).catch(() => {});
      }
    } else if (item.description) {
      bio = item.description.trim();
    }

      const launchedAtMs = item.createdAt ? item.createdAt * 1000 : Date.now();
      let mcapUsd = null;
      if (item.analyticsFdv && item.quoteUsd) {
        const rawFdv = Number(item.analyticsFdv) * Number(item.quoteUsd);
        // Sanity check: If an extreme opening tick produces an astronomical FDV (> $5M) with negligible liquidity (< 1 ETH in pool),
        // fallback to standard initial Sender curve valuation (~$7.68K) so the alert is 100% realistic!
        if (rawFdv > 5_000_000 && (!item.ethInPool || Number(item.ethInPool) < 1)) {
          mcapUsd = 7680;
        } else {
          mcapUsd = rawFdv;
        }
      } else if (item.analyticsFdv) {
        mcapUsd = item.analyticsFdv;
      }

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
    });

  return results;
}

const etherstreetMetaCache = new Map();

async function resolveEtherStreetMeta(metadataURI) {
  if (!metadataURI) return null;
  const cleanUri = String(metadataURI).trim();
  if (etherstreetMetaCache.has(cleanUri)) {
    return etherstreetMetaCache.get(cleanUri);
  }

  let hash = cleanUri;
  if (hash.startsWith('ipfs://')) {
    hash = hash.replace('ipfs://', '');
  }
  if (hash.startsWith('/ipfs/')) {
    hash = hash.replace('/ipfs/', '');
  }

  const gateways = [
    `https://ipfs.filebase.io/ipfs/${hash}`,
    `https://ipfs.io/ipfs/${hash}`,
  ];

  for (const gw of gateways) {
    try {
      const data = await fetchJsonFast(gw, 3500);
      if (data && typeof data === 'object') {
        let image = data.image || null;
        if (image && image.startsWith('ipfs://')) {
          image = `https://ipfs.filebase.io/ipfs/${image.replace('ipfs://', '')}`;
        }

        const socials = {};
        if (data.external_url) socials.website = data.external_url.trim();
        if (data.twitter) socials.twitter = data.twitter.trim();
        if (data.telegram) socials.telegram = data.telegram.trim();

        const result = {
          description: data.description ? data.description.trim() : '',
          image,
          socials,
        };
        etherstreetMetaCache.set(cleanUri, result);
        return result;
      }
    } catch {
      // Try next gateway
    }
  }

  return null;
}

/**
 * 4. EtherStreet.fun Uniswap v4 Launches (Ethereum Mainnet)
 * API: https://etherstreet.fun/api/launched-tokens?limit=15&offset=0
 */
async function fetchEtherStreet() {
  const url = 'https://etherstreet.fun/api/launched-tokens?limit=15&offset=0';
  let list;
  try {
    list = await fetchJsonFast(url, 6000);
  } catch (err) {
    if (err.message && err.message.includes('403')) {
      console.warn('[EtherStreet] ⚠️ Vercel challenge/403 detected. Backing off to clear challenge...');
      return -1;
    }
    console.warn('[EtherStreet] API fetch error:', err.message);
    return [];
  }

  if (!Array.isArray(list) || list.length === 0) return [];

  const results = list.map((item) => {
    let image = null;
    let bio = '';
    const socials = {};

    if (item.metadataURI) {
      if (etherstreetMetaCache.has(item.metadataURI)) {
        const meta = etherstreetMetaCache.get(item.metadataURI);
        if (meta) {
          if (meta.image) image = meta.image;
          if (meta.description) bio = meta.description;
          if (meta.socials?.website) socials.website = meta.socials.website;
          if (meta.socials?.twitter) socials.twitter = meta.socials.twitter;
          if (meta.socials?.telegram) socials.telegram = meta.socials.telegram;
        }
      } else {
        // Resolve IPFS metadata in background without blocking this poll cycle
        resolveEtherStreetMeta(item.metadataURI).catch(() => {});
      }
    }

      const launchedAtMs = item.launchedAt ? item.launchedAt * 1000 : Date.now();
      const mcapUsd =
        item.gt?.fdvUsd && item.gt.fdvUsd > 0
          ? Number(item.gt.fdvUsd)
          : item.mcapEth && item.base?.usd
          ? Number(item.mcapEth) * Number(item.base.usd)
          : null;
      const volUsd = item.gt?.volume24Usd || item.market?.volumeUsd || null;
      const buys = item.market?.buys ?? 0;
      const sells = item.market?.sells ?? 0;
      const trades = (item.market?.swaps ?? item.gt?.txns24) || buys + sells || 0;

      return {
        platformKey: 'etherstreet',
        platformName: 'EtherStreet.fun',
        platformBadge: '🟠 ETHERSTREET',
        platformColor: '#f97316',
        chainName: 'Ethereum Mainnet (Uni v4)',
        chainId: 1,
        address: item.address,
        name: item.name || 'Unknown',
        symbol: item.symbol || '???',
        image: image || 'https://etherstreet.fun/favicon.ico',
        creator: item.deployer || null,
        poolId: item.poolId || null,
        category: `EtherStreet (${item.quoteSymbol || 'ETH'})`,
        quoteSymbol: item.quoteSymbol || 'ETH',
        quoteKind: 'Uniswap v4',
        metadataURI: item.metadataURI || null,
        marketCapUsd: mcapUsd,
        volumeUsd: volUsd,
        volumeCoin: item.volume24Eth ?? null,
        poolQuoteEth: item.quoteSideEth ?? null,
        holders: item.rewards?.holders ?? 0,
        graduated: false,
        buys,
        sells,
        trades,
        lore: bio,
        description:
          bio || `Uniswap v4 token launch on EtherStreet.fun paired with ${item.quoteSymbol || 'ETH'}`,
        socials,
        platformUrl: `https://etherstreet.fun/#/token/${String(item.address).toLowerCase()}`,
        explorerUrl: `https://etherscan.io/token/${item.address}`,
        dexScreenerUrl: `https://dexscreener.com/ethereum/${item.address}`,
        dexToolsUrl: `https://www.dextools.io/app/en/ether/pair-explorer/${item.address}`,
        launchedAtMs,
        blockNumber: item.launchBlock ? Number(item.launchBlock) : null,
      };
    });

  return results;
}

const pangeaMetaCache = new Map();

async function resolvePangeaMeta(metadataURI) {
  if (!metadataURI) return null;
  const cleanUri = String(metadataURI).trim();
  if (pangeaMetaCache.has(cleanUri)) {
    return pangeaMetaCache.get(cleanUri);
  }

  let hash = cleanUri;
  if (hash.startsWith('ipfs://')) {
    hash = hash.replace('ipfs://', '');
  }
  if (hash.startsWith('/ipfs/')) {
    hash = hash.replace('/ipfs/', '');
  }

  const gateways = [
    `https://ipfs.filebase.io/ipfs/${hash}`,
    `https://ipfs.io/ipfs/${hash}`,
  ];

  for (const gw of gateways) {
    try {
      const data = await fetchJsonFast(gw, 3000);
      if (data && typeof data === 'object') {
        let image = data.image || null;
        if (image && image.startsWith('ipfs://')) {
          image = `https://ipfs.filebase.io/ipfs/${image.replace('ipfs://', '')}`;
        }

        const socials = {};
        if (data.external_url) socials.website = data.external_url.trim();
        if (data.extensions?.website) socials.website = data.extensions.website.trim();
        if (data.twitter || data.extensions?.twitter)
          socials.twitter = (data.twitter || data.extensions.twitter).trim();
        if (data.telegram || data.extensions?.telegram)
          socials.telegram = (data.telegram || data.extensions.telegram).trim();

        const result = {
          description: data.description ? data.description.trim() : '',
          image,
          socials,
        };
        pangeaMetaCache.set(cleanUri, result);
        return result;
      }
    } catch {
      // Try next gateway
    }
  }

  return null;
}

/**
 * 5. Pangea.trade Omnichain Uniswap v4 Launches
 * API: https://www.pangea.trade/api/pools
 */
async function fetchPangea() {
  const url = 'https://www.pangea.trade/api/pools';
  let data;
  try {
    data = await fetchJsonFast(url, 6000);
  } catch (err) {
    console.warn('[Pangea] API fetch error:', err.message);
    return [];
  }

  if (!data || !Array.isArray(data.launches)) return [];

  // Filter out test launches and take top 25 newest
  const newest = data.launches
    .filter((l) => l && !l.test && l.slug)
    .sort((a, b) => (b.listedAt || 0) - (a.listedAt || 0))
    .slice(0, 25);

  const results = newest.map((item) => {
    // Find canonical EVM token address (0x...) across ethereum, base, bsc, robinhood
    const evmPool = item.pools?.find(
      (p) =>
        (p.chain === 'ethereum' || p.chain === 'base' || p.chain === 'bsc' || p.chain === 'robinhood') &&
        p.token?.startsWith('0x')
    );
    const mainPool = evmPool || item.pools?.find((p) => p.token) || item.pools?.[0];
    const ca = evmPool?.token || mainPool?.token || item.slug;

    // Build human-friendly multi-chain display (ETH, Base, BSC, Robinhood, Solana)
    const rawChains = item.launchChains?.length
      ? item.launchChains
      : item.pools?.map((p) => p.chain).filter(Boolean) || ['ethereum', 'base', 'bsc', 'robinhood'];

    const mappedChains = rawChains.map((c) => {
      const lower = String(c).toLowerCase();
      if (lower === 'ethereum' || lower === 'eth') return 'ETH';
      if (lower === 'base') return 'Base';
      if (lower === 'bsc' || lower === 'binance') return 'BSC';
      if (lower === 'robinhood' || lower === 'rh') return 'Robinhood';
      if (lower === 'solana' || lower === 'sol') return 'Solana';
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    });
    const uniqueChains = [...new Set(mappedChains)];
    const chainsList = uniqueChains.join(' • ') || 'ETH • Base • BSC • Robinhood';

    const solanaPool = item.pools?.find((p) => p.chain === 'solana' && p.token);
    const solanaAddress = solanaPool?.token || null;

    const priceUsd = mainPool?.priceUsd || item.cheapest?.usd || null;
    const supply = Number(item.capSupply || item.supply?.total || 1000000000);
    const mcapUsd = priceUsd && supply ? priceUsd * supply : null;

    let image = null;
    let bio = '';
    const socials = {};

    if (item.metadataURI) {
      if (pangeaMetaCache.has(item.metadataURI)) {
        const meta = pangeaMetaCache.get(item.metadataURI);
        if (meta) {
          if (meta.image) image = meta.image;
          if (meta.description) bio = meta.description;
          if (meta.socials?.website) socials.website = meta.socials.website;
          if (meta.socials?.twitter) socials.twitter = meta.socials.twitter;
          if (meta.socials?.telegram) socials.telegram = meta.socials.telegram;
        }
      } else {
        // Resolve in background without blocking this poll cycle
        resolvePangeaMeta(item.metadataURI).catch(() => {});
      }
    }

    const launchedAtMs = item.listedAt ? item.listedAt * 1000 : Date.now();

    return {
      platformKey: 'pangea',
      platformName: 'Pangea.trade',
      platformBadge: '🌐 PANGEA',
      platformColor: '#06b6d4',
      chainName: `🌐 Omnichain (${chainsList})`,
      chainsList,
      solanaAddress,
      chainId: 1,
      address: ca,
      name: item.name || 'Unknown',
      symbol: item.symbol || '???',
      image: image || 'https://www.pangea.trade/branding/pangea-mark-256.png',
      creator: null,
      hookAddress: mainPool?.locker || null,
      poolId: mainPool?.poolId || null,
      category: `Omnichain v4 (${chainsList})`,
      quoteSymbol: mainPool?.quoteSymbol || 'ETH',
      quoteKind: 'Uniswap v4 Omnichain',
      metadataURI: item.metadataURI || null,
      marketCapUsd: mcapUsd,
      volumeUsd: null,
      volumeCoin: null,
      poolQuoteEth: mainPool?.reserves ?? null,
      holders: 0,
      graduated: false,
      buys: 0,
      sells: 0,
      trades: 0,
      lore: bio,
      description: bio || `Omnichain Uniswap v4 launch on Pangea.trade deployed across ${chainsList}.`,
      socials,
      platformUrl: `https://www.pangea.trade/app/t/${item.slug}`,
      explorerUrl: `https://etherscan.io/token/${ca}`,
      dexScreenerUrl: `https://dexscreener.com/ethereum/${ca}`,
      dexToolsUrl: `https://www.dextools.io/app/en/ether/pair-explorer/${ca}`,
      launchedAtMs,
      blockNumber: mainPool?.launchBlock || null,
    };
  });

  return results;
}

const gtStatsCache = new Map();

/**
 * 6. Fetch live real-time Uniswap v4 Market Cap, Volume, and Liquidity from GeckoTerminal API
 * GeckoTerminal has immediate indexing for Uniswap v4 on Ethereum Mainnet!
 */
async function fetchGeckoTerminalStats(tokenAddress, network = 'eth') {
  if (!tokenAddress) return null;
  const key = `${network}:${String(tokenAddress).toLowerCase()}`;

  if (gtStatsCache.has(key)) {
    const cached = gtStatsCache.get(key);
    if (Date.now() - cached.cachedAt < 3000) {
      return cached.data;
    }
  }

  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${tokenAddress}`;
    const res = await fetchJsonFast(url, 3000);
    const attrs = res?.data?.attributes;
    if (!attrs) return null;

    const fdv = Number(attrs.fdv_usd || attrs.market_cap_usd || 0);
    const price = Number(attrs.price_usd || 0);
    const vol24 = Number(attrs.volume_usd?.h24 || 0);
    const reserve = Number(attrs.total_reserve_in_usd || 0);

    const stats = {
      marketCapUsd: fdv > 0 ? fdv : null,
      priceUsd: price > 0 ? price : null,
      volumeUsd: vol24 > 0 ? vol24 : null,
      liquidityUsd: reserve > 0 ? reserve : null,
    };

    gtStatsCache.set(key, { data: stats, cachedAt: Date.now() });
    return stats;
  } catch {
    return null;
  }
}

/**
 * 7. Fetch live real-time Price Change, Volume, Buys/Sells AND Socials from DexScreener API
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
  fetchEtherStreet,
  fetchPangea,
  fetchGeckoTerminalStats,
  fetchDexScreenerStats,
  resolveProgrammableOnChainMetadata,
  resolveStockereumMeta,
  resolveEtherStreetMeta,
  resolvePangeaMeta,
};
