const store = require('./store');
const alertBot = require('./bot');
const {
  fetchProgrammableEthereum,
  fetchProgrammableRobinhood,
  fetchStockereum,
  fetchSender,
  fetchEtherStreet,
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
    this.launchIndependentStream(
      'etherstreet',
      () => store.state.settings.enableEtherStreet,
      fetchEtherStreet
    );

    // Background Live Volume & MarketCap Updater (ticks every 5 seconds to live-edit active Telegram alerts AND top dashboard tokens!)
    setInterval(() => this.refreshLiveTrackedDexStats(), 5000);
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
      const dexStats = await fetchDexScreenerStats(baseLaunch.address);
      if (dexStats) {
        const merged = {
          ...baseLaunch,
          image:
            baseLaunch.image && !baseLaunch.image.includes('programmable-landing-preview')
              ? baseLaunch.image
              : dexStats.image || baseLaunch.image,
          socials: {
            ...(dexStats.socials || {}),
            ...(baseLaunch.socials || {}),
          },
          marketCapUsd: dexStats.marketCapUsd ?? baseLaunch.marketCapUsd,
          volumeUsd: dexStats.volumeUsd ?? baseLaunch.volumeUsd,
          priceChange5m: dexStats.priceChange5m,
          buys: dexStats.buys,
          sells: dexStats.sells,
          trades: dexStats.trades || baseLaunch.trades,
          liquidityUsd: dexStats.liquidityUsd,
          poolQuoteEth: dexStats.poolQuoteEth ?? baseLaunch.poolQuoteEth,
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
    if (settings.enableEtherStreet) tasks.push(this.processPlatform('etherstreet', fetchEtherStreet));
    await Promise.allSettled(tasks);
    store.state.stats.lastPollAt = Date.now();
  }

  async processPlatform(platformKey, fetcherFn) {
    const items = await fetcherFn();
    if (!Array.isArray(items) || items.length === 0) return;

    const isInitialized = store.isPlatformInitialized(platformKey);
    const chronological = [...items].sort((a, b) => (a.launchedAtMs || 0) - (b.launchedAtMs || 0));

    // Allow up to 45 minutes of indexing lag so even if Programmable's Subgraph/Codex or Robinhood indexer lags by 15-30 mins, the alert is NEVER skipped!
    const MAX_LAUNCH_AGE_MS = 45 * 60 * 1000;

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
        const ageMs = launch.launchedAtMs ? Date.now() - launch.launchedAtMs : 0;

        if (!isInitialized || ageMs > MAX_LAUNCH_AGE_MS) {
          store.markSeen(platformKey, launch.address);
          store.addRecentLaunch(launch, false);
        } else {
          newFound++;
          const detectLagMs = Math.max(0, ageMs);
          console.log(
            `[Scanner] ⚡ INSTANT LAUNCH DETECTED on ${launch.platformName} (${detectLagMs}ms): ${launch.name} ($${launch.symbol}) -> ${launch.address}`
          );

          // Mark seen and save to dashboard immediately, then dispatch Telegram alert with automatic retry!
          store.markSeen(platformKey, launch.address);
          store.addRecentLaunch(launch, false);

          fetchDexScreenerStats(launch.address)
            .catch(() => null)
            .then(async (dex) => {
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

              let sent = await alertBot.sendLaunchAlert(enriched);
              if (!sent) {
                // Retry once after 3 seconds in case of temporary Telegram rate limit or network blip
                await new Promise((r) => setTimeout(r, 3000));
                sent = await alertBot.sendLaunchAlert(enriched);
              }
              store.addRecentLaunch(enriched, sent);
              if (sent) store.incrementAlertStat(platformKey);
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
