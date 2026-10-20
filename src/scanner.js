const store = require('./store');
const alertBot = require('./bot');
const {
  fetchProgrammableEthereum,
  fetchProgrammableRobinhood,
  fetchStockereum,
  fetchSender,
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

          // Fire Telegram broadcast immediately in parallel without blocking the next token!
          alertBot
            .sendLaunchAlert(launch)
            .then((sent) => {
              store.addRecentLaunch(launch, sent);
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
