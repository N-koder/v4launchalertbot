const express = require('express');
const path = require('path');
const store = require('./store');
const alertBot = require('./bot');
const scanner = require('./scanner');
const { buildTelegramAlert } = require('./formatter');

function startServer(port = 3080) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Lightweight /health endpoint for UptimeRobot / Cron-Job.org to keep free cloud hosts awake 24/7
  app.get('/health', (req, res) => {
    res.status(200).json({
      ok: true,
      uptimeSeconds: Math.round(process.uptime()),
      lastPollAt: store.state.stats.lastPollAt,
    });
  });

  // Get live state, recent launches, and formatted Telegram preview for each
  app.get('/api/status', (req, res) => {
    const recentWithPreview = store.state.recentLaunches.slice(0, 50).map((launch) => {
      const formatted = buildTelegramAlert(launch, store.state.settings, alertBot.botUsername || '');
      return {
        ...launch,
        telegramPreview: formatted,
      };
    });

    const subscribersList = Object.values(store.state.subscribers || {}).sort(
      (a, b) => (b.lastActiveAt || b.subscribedAt || 0) - (a.lastActiveAt || a.subscribedAt || 0)
    );

    res.json({
      botConnected: alertBot.isConnected,
      botUsername: alertBot.botUsername,
      stats: store.state.stats,
      settings: store.state.settings,
      subscribersCount: subscribersList.filter((s) => s.active).length,
      subscribersTotal: subscribersList.length,
      subscribers: subscribersList,
      trackedTotal: Object.keys(store.state.seenTokens).length,
      recentLaunches: recentWithPreview,
    });
  });

  // Trigger manual poll now
  app.post('/api/poll-now', async (req, res) => {
    await scanner.pollAll();
    res.json({ ok: true, lastPollAt: store.state.stats.lastPollAt });
  });

  // Update settings (channel ID, referrals, platform toggles)
  app.post('/api/settings', (req, res) => {
    const allowed = [
      'channelId',
      'maestroRef',
      'bananaRef',
      'sigmaRef',
      'enableProgrammable',
      'enableProgrammableRobinhood',
      'enableStockereum',
      'enableSender',
    ];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        update[key] = req.body[key];
      }
    }
    const settings = store.updateSettings(update);
    res.json({ ok: true, settings });
  });

  // Send a specific launch (or test alert) to the configured Telegram channel
  app.post('/api/send-test', async (req, res) => {
    const { address, platformKey } = req.body || {};
    let target = store.state.recentLaunches[0];
    if (address) {
      target =
        store.state.recentLaunches.find(
          (x) =>
            x.address.toLowerCase() === String(address).toLowerCase() &&
            (!platformKey || x.platformKey === platformKey)
        ) || target;
    }

    if (!target) {
      return res.status(404).json({ ok: false, error: 'No launch found to send.' });
    }

    if (!alertBot.isConnected) {
      return res.status(400).json({
        ok: false,
        error: 'Telegram Bot is not connected yet. Add TELEGRAM_BOT_TOKEN in .env and restart.',
      });
    }

    const sent = await alertBot.sendLaunchAlert(target);
    if (sent) {
      store.incrementAlertStat(target.platformKey);
      return res.json({
        ok: true,
        message: `Broadcasted ${target.name} ($${target.symbol}) to your Channel & active Personal DM subscribers!`,
      });
    }
    return res.status(400).json({
      ok: false,
      error:
        'No destination found! Either send /start to your Bot in Telegram for Personal DM Alerts, or set TELEGRAM_CHANNEL_ID.',
    });
  });

  app.listen(port, () => {
    console.log(`[Dashboard] 🌐 Live Interface & Alert Preview running at: http://localhost:${port}`);
  });
}

module.exports = { startServer };
