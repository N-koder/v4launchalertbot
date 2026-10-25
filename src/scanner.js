const store = require('./store');
const alertBot = require('./bot');
const {
  fetchProgrammableEthereum,
  fetchProgrammableRobinhood,
  fetchStockereum,
  fetchSender,
  fetchEtherStreet,
  fetchPangea,
  fetchGeckoTerminalStats,
  fetchDexScreenerStats,
} = require('./fetchers');

/**
 * Ultra-Low-Latency Independent Stream Scanner
 * Each launchpad runs in its own continuous loop with Persistent HTTP Keep-Alive sockets,
 * firing alerts the exact millisecond a launch appears without waiting for other platforms.
 */
class LaunchScanner {
  constructor() {
    this.running = false;
    this.intervalMs = 500;
    this.activeStreams = new Map();
    this.lastLatencyMs = {};
  }

  start(intervalSeconds = 1.0) {
    this.intervalMs = Math.max(800, Math.round(Number(intervalSeconds) * 1000));
    this.running = true;
    console.log(
      `[Scanner] ⚡ ULTRA-FAST STREAM ENGINE ACTIVE (Polling launchpads independently with persistent Keep-Alive TLS)`
    );

    // Optimized independent polling streams with anti-WAF rate limit protection:
    this.launchIndependentStream('stockereum', () => store.state.settings.enableStockereum, fetchStockereum, 1200);
    this.launchIndependentStream('sender', () => store.state.settings.enableSender, fetchSender, 1400);
    this.launchIndependentStream('pangea', () => store.state.settings.enablePangea, fetchPangea, 1800);
    this.launchIndependentStream(
      'programmable',
      () => store.state.settings.enableProgrammable,
      fetchProgrammableEthereum,
      2000
    );
    this.launchIndependentStream(
      'programmable_robinhood',
      () => store.state.settings.enableProgrammableRobinhood,
      fetchProgrammableRobinhood,
      2500
    );
    this.launchIndependentStream(
      'etherstreet',
      () => store.state.settings.enableEtherStreet,
      fetchEtherStreet,
      2500
    );

    // Background Live Volume & MarketCap Updater for dashboard tokens (ticks gently every 15s to keep network & event loop 100% free for instant launch detection!)
    setInterval(() => this.refreshLiveTrackedDexStats(), 15000);
  }

  async refreshLiveTrackedDexStats() {
    const targetsMap = new Map();

    // 1. Add all active Telegram alert tokens
    if (alertBot.liveTrackedAlerts && alertBot.liveTrackedAlerts.size > 0) {
      for (const [trackKey, entry] of alertBot.liveTrackedAlerts.entries()) {
        if (Date.now() - entry.sentAt > 30 * 60 * 1000) {
          alertBot.liveTrackedAlerts.delete(trackKey);
          continue;
        }
        targetsMap.set(trackKey, entry.launch);
      }
    }

    // 2. Also add the top 6 most recent launches in the dashboard so the Web UI also shows real-time Market Cap, Volume, and Buys/Sells!
    for (const recent of store.state.recentLaunches.slice(0, 6)) {
      const key = `${recent.platformKey}:${String(recent.address).toLowerCase()}`;
      if (!targetsMap.has(key)) {
        targetsMap.set(key, recent);
      }
    }

    for (const [, baseLaunch] of targetsMap.entries()) {
      // 1. Fetch live GeckoTerminal stats (real-time Uniswap v4 pool indexing)
      const gtStats = await fetchGeckoTerminalStats(baseLaunch.address);

      // 2. Fetch DexScreener stats (for 5m price change, buys/sells, socials)
      const dexStats = await fetchDexScreenerStats(baseLaunch.address);

      // Priority for Market Cap:
      // Keep direct launchpad MC if valid; otherwise use GeckoTerminal live FDV; then DexScreener
      let bestMcap = baseLaunch.marketCapUsd;
      if (!bestMcap || bestMcap <= 0) {
        if (gtStats?.marketCapUsd && gtStats.marketCapUsd > 0) {
          bestMcap = gtStats.marketCapUsd;
        } else if (dexStats?.marketCapUsd && dexStats.marketCapUsd > 0) {
          bestMcap = dexStats.marketCapUsd;
        }
      } else if (gtStats?.marketCapUsd && gtStats.marketCapUsd > 0 && baseLaunch.platformKey === 'programmable') {
        // For programmable, update with live GeckoTerminal FDV as trades happen
        bestMcap = gtStats.marketCapUsd;
      }

      // Best Volume:
      const bestVol =
        gtStats?.volumeUsd || dexStats?.volumeUsd || baseLaunch.volumeUsd || null;

      if (gtStats || dexStats) {
        const merged = {
          ...baseLaunch,
          image:
            baseLaunch.image && !baseLaunch.image.includes('programmable-landing-preview')
              ? baseLaunch.image
              : dexStats?.image || baseLaunch.image,
          socials: {
            ...(dexStats?.socials || {}),
            ...(baseLaunch.socials || {}),
          },
          marketCapUsd: bestMcap,
          volumeUsd: bestVol,
          priceChange5m: dexStats?.priceChange5m ?? baseLaunch.priceChange5m,
          buys: dexStats?.buys ?? baseLaunch.buys,
          sells: dexStats?.sells ?? baseLaunch.sells,
          trades: dexStats?.trades || baseLaunch.trades,
          liquidityUsd: gtStats?.liquidityUsd || dexStats?.liquidityUsd || baseLaunch.liquidityUsd,
          poolQuoteEth: dexStats?.poolQuoteEth ?? baseLaunch.poolQuoteEth,
        };
        store.addRecentLaunch(merged, true);
      }
    }
  }

  launchIndependentStream(platformKey, isEnabledFn, fetcherFn, customIntervalMs = null) {
    const baseInterval = customIntervalMs || this.intervalMs;
    let currentInterval = baseInterval;

    const loop = async () => {
      if (!this.running) return;
      const t0 = Date.now();
      try {
        if (isEnabledFn()) {
          const res = await this.processPlatform(platformKey, fetcherFn);
          this.lastLatencyMs[platformKey] = Date.now() - t0;
          store.state.stats.lastPollAt = Date.now();
          store.state.stats.latencies = this.lastLatencyMs;

          if (res === -1) {
            // WAF challenge detected -> back off for 20 seconds so Vercel challenge expires!
            currentInterval = 20000;
          } else {
            currentInterval = baseInterval;
          }
        }
      } catch (err) {
        store.state.stats.errors = (store.state.stats.errors || 0) + 1;
        currentInterval = Math.min(currentInterval * 1.5, 15000);
      } finally {
        const elapsed = Date.now() - t0;
        const nextDelay = Math.max(100, currentInterval - elapsed);
        setTimeout(loop, nextDelay);
      }
    };
    loop();
  }

  async pollAll() {
    const { settings } = store.state;
    const tasks = [];
    if (settings.enableProgrammable) tasks.push(this.processPlatform('programmable', fetchProgrammableEthereum));
    if (settings.enableProgrammableRobinhood)
      tasks.push(this.processPlatform('programmable_robinhood', fetchProgrammableRobinhood));
    if (settings.enableStockereum) tasks.push(this.processPlatform('stockereum', fetchStockereum));
    if (settings.enableSender) tasks.push(this.processPlatform('sender', fetchSender));
    if (settings.enableEtherStreet) tasks.push(this.processPlatform('etherstreet', fetchEtherStreet));
    if (settings.enablePangea) tasks.push(this.processPlatform('pangea', fetchPangea));
    await Promise.allSettled(tasks);
    store.state.stats.lastPollAt = Date.now();
  }

  async processPlatform(platformKey, fetcherFn) {
    const items = await fetcherFn();
    if (items === -1) return -1;
    if (!Array.isArray(items) || items.length === 0) return 0;

    const isInitialized = store.isPlatformInitialized(platformKey);
    const chronological = [...items].sort((a, b) => (a.launchedAtMs || 0) - (b.launchedAtMs || 0));

    // Allow up to 45 minutes of indexing lag so even if Programmable's Subgraph/Codex or Robinhood indexer lags by 15-30 mins, the alert is NEVER skipped!
    const MAX_LAUNCH_AGE_MS = 45 * 60 * 1000;

    let newFound = 0;
    for (const launch of chronological) {
      if (!launch.address) continue;

      const alreadySeen = store.hasSeen(platformKey, launch.address, launch.slug);
      if (alreadySeen) {
        // Token already alerted — update dashboard stats without spamming Telegram
        store.addRecentLaunch(launch, true);
        continue;
      }
      if (!alreadySeen) {
        const ageMs = launch.launchedAtMs ? Date.now() - launch.launchedAtMs : 0;

        if (!isInitialized || ageMs > MAX_LAUNCH_AGE_MS) {
          store.markSeen(platformKey, launch.address, launch.slug);
          store.addRecentLaunch(launch, false);
        } else {
          newFound++;
          const detectLagMs = Math.max(0, ageMs);
          console.log(
            `[Scanner] ⚡ INSTANT LAUNCH DETECTED on ${launch.platformName} (${detectLagMs}ms): ${launch.name} ($${launch.symbol}) -> ${launch.address}`
          );

          // Mark seen and save to dashboard immediately
          store.markSeen(platformKey, launch.address, launch.slug);
          store.addRecentLaunch(launch, false);

          // ⚡ ZERO-LATENCY INSTANT DISPATCH (0ms delay!)
          // Send the alert IMMEDIATELY so our bot beats competitors like @sendtrench!
          (async () => {
            let sent = await alertBot.sendLaunchAlert(launch);
            if (!sent) {
              await new Promise((r) => setTimeout(r, 2000));
              sent = await alertBot.sendLaunchAlert(launch);
            }
            store.addRecentLaunch(launch, sent);
            if (sent) store.incrementAlertStat(platformKey);

            // In background, query DexScreener to enrich live alert message with volume & market cap once indexed
            fetchDexScreenerStats(launch.address)
              .then((dex) => {
                if (dex) {
                  const enriched = {
                    ...launch,
                    marketCapUsd: dex.marketCapUsd ?? launch.marketCapUsd,
                    volumeUsd: dex.volumeUsd ?? launch.volumeUsd,
                    priceChange5m: dex.priceChange5m,
                    buys: dex.buys,
                    sells: dex.sells,
                    trades: dex.trades || launch.trades,
                    liquidityUsd: dex.liquidityUsd,
                    poolQuoteEth: dex.poolQuoteEth ?? launch.poolQuoteEth,
                  };
                  store.addRecentLaunch(enriched, true);
                }
              })
              .catch(() => {});
          })().catch((e) => console.error('[Scanner] Alert dispatch error:', e.message));
        }
      }
    }

    if (!isInitialized) {
      store.setPlatformInitialized(platformKey, true);
      console.log(`[Scanner] ✅ Baseline indexed for ${platformKey} (${items.length} tokens). Watching in real-time...`);
    } else if (newFound > 0) {
      store.save();
    }
  }
}

module.exports = new LaunchScanner();
