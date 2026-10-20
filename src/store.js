const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const DEFAULT_STATE = {
  initializedPlatforms: {
    programmable: false,
    programmable_robinhood: false,
    stockereum: false,
    sender: false,
  },
  subscribers: {}, // chatId -> { chatId, username, firstName, subscribedAt, active: true, platforms: { programmable: true, stockereum: true, sender: true } }
  seenTokens: {}, // key: `${platform}:${address.toLowerCase()}` -> timestamp
  recentLaunches: [], // array of normalized token objects (up to 100)
  stats: {
    totalAlertsSent: 0,
    programmableCount: 0,
    stockereumCount: 0,
    senderCount: 0,
    lastPollAt: null,
    errors: 0,
  },
  settings: {
    enableProgrammable: process.env.ENABLE_PROGRAMMABLE !== 'false',
    enableProgrammableRobinhood: process.env.ENABLE_PROGRAMMABLE_ROBINHOOD !== 'false',
    enableStockereum: process.env.ENABLE_STOCKEREUM !== 'false',
    enableSender: process.env.ENABLE_SENDER !== 'false',
    maestroRef: process.env.MAESTRO_REF || '',
    bananaRef: process.env.BANANA_REF || '',
    sigmaRef: process.env.SIGMA_REF || '',
    channelId: process.env.TELEGRAM_CHANNEL_ID || '',
  },
};

class Store {
  constructor() {
    this.ensureDir();
    this.state = this.load();
    this.seedInitialSubscribers();
  }

  /**
   * Ensures that when Render redeploys a fresh container:
   * 1. ADMIN_USER_ID is automatically subscribed immediately on startup (no need to type /start again!)
   * 2. Any comma-separated IDs in INITIAL_SUBSCRIBERS env var are also auto-restored
   */
  seedInitialSubscribers() {
    const idsToSeed = new Set();
    if (process.env.ADMIN_USER_ID && process.env.ADMIN_USER_ID.trim() !== '') {
      idsToSeed.add(process.env.ADMIN_USER_ID.trim());
    }
    if (process.env.INITIAL_SUBSCRIBERS) {
      process.env.INITIAL_SUBSCRIBERS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((id) => idsToSeed.add(id));
    }

    let changed = false;
    for (const id of idsToSeed) {
      if (!this.state.subscribers[id]) {
        this.state.subscribers[id] = {
          chatId: String(id),
          username: id === process.env.ADMIN_USER_ID?.trim() ? 'Admin (Owner)' : '',
          firstName: id === process.env.ADMIN_USER_ID?.trim() ? 'Admin' : 'Subscriber',
          lastName: '',
          subscribedAt: Date.now(),
          lastActiveAt: Date.now(),
          lastAction: 'Auto-Restored on Boot',
          interactionsCount: 1,
          alertsReceived: 0,
          active: true,
          platforms: {
            programmable: true,
            stockereum: true,
            sender: true,
          },
        };
        changed = true;
      }
    }
    if (changed) this.save();
  }

  ensureDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  load() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return {
          ...DEFAULT_STATE,
          ...parsed,
          initializedPlatforms: {
            ...DEFAULT_STATE.initializedPlatforms,
            ...(parsed.initializedPlatforms || {}),
          },
          subscribers: {
            ...(parsed.subscribers || {}),
          },
          stats: {
            ...DEFAULT_STATE.stats,
            ...(parsed.stats || {}),
          },
          settings: {
            ...DEFAULT_STATE.settings,
            ...(parsed.settings || {}),
            // Override with .env if explicitly provided
            channelId: process.env.TELEGRAM_CHANNEL_ID || parsed.settings?.channelId || '',
            maestroRef: process.env.MAESTRO_REF || parsed.settings?.maestroRef || '',
            bananaRef: process.env.BANANA_REF || parsed.settings?.bananaRef || '',
            sigmaRef: process.env.SIGMA_REF || parsed.settings?.sigmaRef || '',
          },
        };
      }
    } catch (err) {
      console.error('[Store] Failed to load state.json, starting fresh:', err.message);
    }
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  save() {
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (err) {
      console.error('[Store] Failed to save state.json:', err.message);
    }
  }

  makeKey(platformKey, address) {
    return `${platformKey}:${String(address).toLowerCase()}`;
  }

  hasSeen(platformKey, address) {
    const key = this.makeKey(platformKey, address);
    return Boolean(this.state.seenTokens[key]);
  }

  markSeen(platformKey, address) {
    const key = this.makeKey(platformKey, address);
    this.state.seenTokens[key] = Date.now();
  }

  isPlatformInitialized(platformKey) {
    return Boolean(this.state.initializedPlatforms[platformKey]);
  }

  setPlatformInitialized(platformKey, value = true) {
    this.state.initializedPlatforms[platformKey] = value;
    this.save();
  }

  addRecentLaunch(launch, alerted = false) {
    const existsIdx = this.state.recentLaunches.findIndex(
      (x) => x.address.toLowerCase() === launch.address.toLowerCase() && x.platformKey === launch.platformKey
    );
    const existing = existsIdx !== -1 ? this.state.recentLaunches[existsIdx] : {};
    // Preserve non-null live stats (marketCapUsd, volumeUsd, buys, sells, liquidityUsd) so a null API poll never flickers them back to null!
    const entry = {
      ...existing,
      ...launch,
      marketCapUsd: launch.marketCapUsd ?? existing.marketCapUsd ?? null,
      volumeUsd: launch.volumeUsd ?? existing.volumeUsd ?? null,
      volumeCoin: launch.volumeCoin ?? existing.volumeCoin ?? null,
      poolQuoteEth: launch.poolQuoteEth ?? existing.poolQuoteEth ?? null,
      liquidityUsd: launch.liquidityUsd ?? existing.liquidityUsd ?? null,
      priceChange5m: launch.priceChange5m ?? existing.priceChange5m ?? null,
      buys: launch.buys ?? existing.buys,
      sells: launch.sells ?? existing.sells,
      trades: launch.trades || existing.trades || 0,
      alerted: alerted || Boolean(existing.alerted),
      discoveredAt: existing.discoveredAt || Date.now(),
    };
    if (existsIdx !== -1) {
      this.state.recentLaunches[existsIdx] = entry;
    } else {
      this.state.recentLaunches.unshift(entry);
    }
    // Keep top 120 most recent launches
    this.state.recentLaunches.sort((a, b) => (b.launchedAtMs || 0) - (a.launchedAtMs || 0));
    if (this.state.recentLaunches.length > 120) {
      this.state.recentLaunches = this.state.recentLaunches.slice(0, 120);
    }
    this.save();
  }

  incrementAlertStat(platformKey) {
    this.state.stats.totalAlertsSent = (this.state.stats.totalAlertsSent || 0) + 1;
    if (platformKey.startsWith('programmable')) {
      this.state.stats.programmableCount = (this.state.stats.programmableCount || 0) + 1;
    } else if (platformKey === 'stockereum') {
      this.state.stats.stockereumCount = (this.state.stats.stockereumCount || 0) + 1;
    } else if (platformKey === 'sender') {
      this.state.stats.senderCount = (this.state.stats.senderCount || 0) + 1;
    }
    this.save();
  }

  updateSettings(partial) {
    this.state.settings = {
      ...this.state.settings,
      ...partial,
    };
    this.save();
    return this.state.settings;
  }

  upsertSubscriber(chatId, userInfo = {}) {
    const key = String(chatId);
    const existing = this.state.subscribers[key];
    this.state.subscribers[key] = {
      chatId: key,
      username: userInfo.username ?? existing?.username ?? '',
      firstName: userInfo.firstName ?? existing?.firstName ?? 'User',
      lastName: userInfo.lastName ?? existing?.lastName ?? '',
      subscribedAt: existing?.subscribedAt || Date.now(),
      lastActiveAt: Date.now(),
      lastAction: userInfo.lastAction || existing?.lastAction || '/start',
      interactionsCount: (existing?.interactionsCount || 0) + 1,
      alertsReceived: existing?.alertsReceived || 0,
      active: userInfo.active !== undefined ? userInfo.active : existing ? existing.active : true,
      platforms: existing?.platforms || {
        programmable: true,
        stockereum: true,
        sender: true,
      },
    };
    this.save();
    return this.state.subscribers[key];
  }

  recordUserAction(chatId, fromUser = {}, action = 'command') {
    const key = String(chatId);
    const existing = this.state.subscribers[key];
    if (!existing) {
      return this.upsertSubscriber(chatId, {
        username: fromUser.username || '',
        firstName: fromUser.first_name || 'User',
        lastName: fromUser.last_name || '',
        lastAction: action,
        active: true,
      });
    }
    if (fromUser.username) existing.username = fromUser.username;
    if (fromUser.first_name) existing.firstName = fromUser.first_name;
    if (fromUser.last_name) existing.lastName = fromUser.last_name;
    existing.lastActiveAt = Date.now();
    existing.lastAction = action;
    existing.interactionsCount = (existing.interactionsCount || 0) + 1;
    this.save();
    return existing;
  }

  incrementUserAlertsReceived(chatId) {
    const key = String(chatId);
    if (this.state.subscribers[key]) {
      this.state.subscribers[key].alertsReceived = (this.state.subscribers[key].alertsReceived || 0) + 1;
    }
  }

  toggleSubscriberPlatform(chatId, platformGroup) {
    const key = String(chatId);
    const sub = this.state.subscribers[key] || this.upsertSubscriber(chatId);
    sub.platforms[platformGroup] = !sub.platforms[platformGroup];
    this.save();
    return sub;
  }

  setSubscriberActive(chatId, active) {
    const key = String(chatId);
    if (this.state.subscribers[key]) {
      this.state.subscribers[key].active = Boolean(active);
      this.save();
    }
    return this.state.subscribers[key];
  }

  getActiveSubscribersForPlatform(platformKey) {
    const group = platformKey.startsWith('programmable') ? 'programmable' : platformKey;
    return Object.values(this.state.subscribers || {}).filter(
      (sub) => sub && sub.active && sub.platforms?.[group] !== false
    );
  }
}

module.exports = new Store();
