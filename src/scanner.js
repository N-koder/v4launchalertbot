const store = require('./store');
const alertBot = require('./bot');
const {
  fetchProgrammableEthereum,
  fetchProgrammableRobinhood,
  fetchStockereum,
  fetchSender,
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
    this.intervalMs = 2000;
    this.activeStreams = new Map();
    this.lastLatencyMs = {};
  }

  start(intervalSeconds = 2) {
    this.intervalMs = Math.max(1000, Math.round(Number(intervalSeconds) * 1000));
    this.running = true;
    console.log(
      `[Scanner] ⚡ ULTRA-FAST STREAM ENGINE ACTIVE (Polling each launchpad independently every ${this.intervalMs}ms with Keep-Alive TLS)`
    );

    this.launchIndependentStream('programmable', () => store.state.settings.enableProgrammable, fetchProgrammableEthereum);
    this.launchIndependentStream(
      'programmable_robinhood',
      () => store.state.settings.enableProgrammableRobinhood,
      fetchProgrammableRobinhood
    );
    this.launchIndependentStream('stockereum', () => store.state.settings.enableStockereum, fetchStockereum);
    this.launchIndependentStream('sender', () => store.state.settings.enableSender, fetchSender);

    // Background Live Volume & MarketCap Updater (ticks every 6 seconds to live-edit active Telegram alerts!)
    setInterval(() => this.refreshLiveTrackedDexStats(), 6000);
  }

  async refreshLiveTrackedDexStats() {
    if (!alertBot.liveTrackedAlerts || alertBot.liveTrackedAlerts.size === 0) return;

    for (const [trackKey, entry] of alertBot.liveTrackedAlerts.entries()) {
      if (Date.now() - entry.sentAt > 30 * 60 * 1000) {
        alertBot.liveTrackedAlerts.delete(trackKey);
        continue;
      }
      const dexStats = await fetchDexScreenerStats(entry.launch.address);
      if (dexStats) {
        const merged = {
          ...entry.launch,
          marketCapUsd: dexStats.marketCapUsd ?? entry.launch.marketCapUsd,
          volumeUsd: dexStats.volumeUsd ?? entry.launch.volumeUsd,
          priceChange5m: dexStats.priceChange5m,
          buys: dexStats.buys,
          sells: dexStats.sells,
          trades: dexStats.trades || entry.launch.trades,
          liquidityUsd: dexStats.liquidityUsd,
        };
        store.addRecentLaunch(merged, true);
        await alertBot.updateLiveAlertMessages(merged);
      }
    }
  }

  launchIndependentStream(platformKey, isEnabledFn, fetcherFn) {
    const loop = async () => {
      if (!this.running) return;
      const t0 = Date.now();
      try {
        if (isEnabledFn()) {
          await this.processPlatform(platformKey, fetcherFn);
          this.lastLatencyMs[platformKey] = Date.now() - t0;
          store.state.stats.lastPollAt = Date.now();
          store.state.stats.latencies = this.lastLatencyMs;
        }
      } catch (err) {
        store.state.stats.errors = (store.state.stats.errors || 0) + 1;
      } finally {
        const elapsed = Date.now() - t0;
        const nextDelay = Math.max(400, this.intervalMs - elapsed);
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
    await Promise.allSettled(tasks);
    store.state.stats.lastPollAt = Date.now();
  }

  async processPlatform(platformKey, fetcherFn) {
    const items = await fetcherFn();
    if (!Array.isArray(items) || items.length === 0) return;

    const isInitialized = store.isPlatformInitialized(platformKey);
    const chronological = [...items].sort((a, b) => (a.launchedAtMs || 0) - (b.launchedAtMs || 0));

    // Only alert on genuinely fresh launches (launched within the last 10 minutes)
    // This prevents old tokens from triggering alerts if an API source temporarily resets or re-indexes
    const MAX_LAUNCH_AGE_MS = 10 * 60 * 1000;

    let newFound = 0;
    for (const launch of chronological) {
      if (!launch.address) continue;

      const alreadySeen = store.hasSeen(platformKey, launch.address);
      if (alreadySeen) {
        // If this token has an active Telegram message, live-update its Volume, Market Cap & Trades!
        const trackKey = `${platformKey}:${String(launch.address).toLowerCase()}`;
        if (alertBot.liveTrackedAlerts && alertBot.liveTrackedAlerts.has(trackKey)) {
          store.addRecentLaunch(launch, true);
          alertBot.updateLiveAlertMessages(launch).catch(() => {});
        }
        continue;
      }
      if (!alreadySeen) {
        store.markSeen(platformKey, launch.address);
        const ageMs = launch.launchedAtMs ? Date.now() - launch.launchedAtMs : 0;

        if (!isInitialized || ageMs > MAX_LAUNCH_AGE_MS) {
          store.addRecentLaunch(launch, false);
        } else {
          newFound++;
          const detectLagMs = Math.max(0, ageMs);
          console.log(
            `[Scanner] ⚡ INSTANT LAUNCH DETECTED on ${launch.platformName} (${detectLagMs}ms): ${launch.name} ($${launch.symbol}) -> ${launch.address}`
          );

          // Enrich with DexScreener stats immediately if already indexed, then fire Telegram alert
          fetchDexScreenerStats(launch.address)
            .then((dex) => {
              const enriched = dex
                ? {
                    ...launch,
                    marketCapUsd: dex.marketCapUsd ?? launch.marketCapUsd,
                    volumeUsd: dex.volumeUsd ?? launch.volumeUsd,
                    priceChange5m: dex.priceChange5m,
                    buys: dex.buys,
                    sells: dex.sells,
                    trades: dex.trades || launch.trades,
                    liquidityUsd: dex.liquidityUsd,
                    poolQuoteEth: dex.poolQuoteEth ?? launch.poolQuoteEth,
                  }
                : launch;
              return alertBot.sendLaunchAlert(enriched).then((sent) => {
                store.addRecentLaunch(enriched, sent);
                if (sent) store.incrementAlertStat(platformKey);
              });
            })
            .catch((e) => console.error('[Scanner] Alert dispatch error:', e.message));
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
