const TelegramBot = require('node-telegram-bot-api');
const store = require('./store');
const { buildTelegramAlert, buildLoreMessage } = require('./formatter');

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class AlertBot {
  constructor() {
    this.bot = null;
    this.isConnected = false;
    this.botUsername = null;
    // Tracks sent Telegram messages so we can live-update their Volume & Market Cap in real-time as trades happen!
    // key: `${platformKey}:${address.toLowerCase()}` -> { launch, sentAt, lastCaption, messages: [{ chatId, messageId, isPhoto }] }
    this.liveTrackedAlerts = new Map();
  }

  async init() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || token === 'your_bot_token_here' || token.trim() === '') {
      console.log(
        '[TelegramBot] ⚠️ No TELEGRAM_BOT_TOKEN set in .env yet. Running in Dashboard/Preview mode until configured.'
      );
      return;
    }

    try {
      this.bot = new TelegramBot(token.trim(), {
        polling: true,
        request: {
          agentOptions: {
            keepAlive: true,
            keepAliveMsecs: 30000,
          },
        },
      });
      const me = await this.bot.getMe();
      this.isConnected = true;
      this.botUsername = me.username;
      console.log(`[TelegramBot] ✅ Connected as @${me.username}`);
      await this.hydrateSubscribersFromTelegram();
      await this.setupCommandMenus();
      this.registerCommands();

      // Suppress noisy 409 Conflict logs during Render zero-downtime rolling deploys
      this.bot.on('polling_error', (err) => {
        if (err?.message && err.message.includes('409 Conflict')) return;
        console.warn('[TelegramBot] Polling warning:', err.message);
      });

      // Handle SIGTERM cleanly so Render stops old container's Telegram polling before starting the new one
      const shutdown = async () => {
        if (this.bot) {
          try {
            await this.bot.stopPolling();
          } catch {}
        }
        process.exit(0);
      };
      process.once('SIGTERM', shutdown);
      process.once('SIGINT', shutdown);
    } catch (err) {
      console.error('[TelegramBot] ❌ Failed to connect with TELEGRAM_BOT_TOKEN:', err.message);
      this.bot = null;
      this.isConnected = false;
    }
  }

  /**
   * Strict Admin Check:
   * Only returns true if ADMIN_USER_ID is configured in .env AND matches the sender's Telegram User ID.
   */
  isAdmin(msgOrUser) {
    const adminId = process.env.ADMIN_USER_ID;
    if (!adminId || adminId.trim() === '') return false;
    const userId = msgOrUser?.from ? msgOrUser.from.id : msgOrUser?.id;
    return String(userId) === String(adminId.trim());
  }

  /**
   * Fetches real @username and First/Last name directly from Telegram API for any auto-restored subscriber IDs!
   */
  async hydrateSubscribersFromTelegram() {
    if (!this.bot) return;
    const subs = Object.values(store.state.subscribers || {});
    for (const sub of subs) {
      if (!sub.username || sub.username === 'Admin (Owner)') {
        try {
          const chat = await this.bot.getChat(sub.chatId);
          if (chat) {
            store.upsertSubscriber(sub.chatId, {
              username: chat.username || sub.username || '',
              firstName: chat.first_name || sub.firstName || 'User',
              lastName: chat.last_name || sub.lastName || '',
              lastAction: sub.lastAction || 'Auto-Restored on Boot',
              active: sub.active,
            });
          }
        } catch {
          // Ignore if chat not reachable yet
        }
      }
    }
  }

  /**
   * Registers Telegram's native `/` Command Menu:
   * - Normal users ONLY see User Commands (/start, /help, /settings, /latest, /stop)
   * - The Admin (ADMIN_USER_ID) sees BOTH User Commands AND Admin Commands in their `/` menu!
   */
  async setupCommandMenus() {
    if (!this.bot) return;

    const userCommands = [
      { command: 'start', description: '🚀 Activate personal launch alerts' },
      { command: 'help', description: '📖 Show help & available commands' },
      { command: 'settings', description: '⚙️ Filter launchpads (Programmable, Stockereum, Sender, EtherStreet)' },
      { command: 'latest', description: '🔥 View the newest detected token launch' },
      { command: 'stop', description: '🔕 Pause personal launch alerts' },
    ];

    try {
      // Set default menu for all normal users
      await this.bot.setMyCommands(userCommands, { scope: { type: 'default' } });

      // If ADMIN_USER_ID is set, give ONLY that admin chat the extra Admin commands in their menu
      const adminId = process.env.ADMIN_USER_ID;
      if (adminId && adminId.trim() !== '') {
        const adminCommands = [
          ...userCommands,
          { command: 'admin', description: '👑 [Admin] Open Admin Control Panel' },
          { command: 'users', description: '👥 [Admin] See WHO & HOW users use your bot' },
          { command: 'status', description: '📡 [Admin] Scanner health & stats' },
          { command: 'test', description: '🧪 [Admin] Broadcast test alert' },
        ];
        await this.bot.setMyCommands(adminCommands, {
          scope: { type: 'chat', chat_id: Number(adminId.trim()) },
        });
      }
    } catch (err) {
      console.warn('[TelegramBot] Could not set command menu:', err.message);
    }
  }

  buildSubscriptionKeyboard(sub, isUserAdmin = false) {
    const isSub = sub?.active !== false;
    const pOn = sub?.platforms?.programmable !== false;
    const sOn = sub?.platforms?.stockereum !== false;
    const fOn = sub?.platforms?.sender !== false;
    const eOn = sub?.platforms?.etherstreet !== false;

    const rows = [
      [
        {
          text: isSub ? '🔔 Personal Alerts: ACTIVE (Tap to Pause)' : '🔕 Personal Alerts: PAUSED (Tap to Resume)',
          callback_data: 'toggle_active',
        },
      ],
      [
        { text: `🟣 Programmable: ${pOn ? '✅ ON' : '❌ OFF'}`, callback_data: 'toggle_prog' },
        { text: `🟢 Stockereum: ${sOn ? '✅ ON' : '❌ OFF'}`, callback_data: 'toggle_stock' },
      ],
      [
        { text: `🔵 Sender: ${fOn ? '✅ ON' : '❌ OFF'}`, callback_data: 'toggle_sender' },
        { text: `🟠 EtherStreet: ${eOn ? '✅ ON' : '❌ OFF'}`, callback_data: 'toggle_etherstreet' },
      ],
      [
        { text: '🔥 Latest Launch', callback_data: 'preview_latest' },
      ],
      [{ text: '📖 Help & Commands', callback_data: 'show_help' }],
    ];

    // Only show Admin Panel button if this user is the Admin!
    if (isUserAdmin) {
      rows.push([
        { text: '👑 Admin: View Users (/users)', callback_data: 'admin_users' },
        { text: '📡 Admin: Bot Status', callback_data: 'admin_status' },
      ]);
    }

    return { inline_keyboard: rows };
  }

  buildHelpText(isUserAdmin = false) {
    const userSection = [
      `📖 <b>Launch Alert Bot — Help & Commands</b>`,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `This bot monitors <b>4 Ethereum / Uniswap v4 Launchpads</b> in real-time and sends you instant alerts with a <b>1-tap copiable Contract Address (CA)</b> and <b>1-click trading buttons</b> (Maestro, Sigma Bot, DexScreener).`,
      ``,
      `🏛 <b>Supported Launchpads:</b>`,
      `• 🟣 <b>Programmable.market</b> (ETH & Robinhood Chain)`,
      `• 🟢 <b>Stockereum.com</b> (RWA Stock, Meme & Crypto Pairs)`,
      `• 🔵 <b>Sender.family</b> (Uniswap v4 Locked Liquidity)`,
      `• 🟠 <b>EtherStreet.fun</b> (Uniswap v4 Token Launches)`,
      ``,
      `👤 <b>User Commands:</b>`,
      `• /start — Activate your personal DM launch alerts`,
      `• /help — Show this help guide`,
      `• /settings — Choose which launchpads send you alerts (ON/OFF)`,
      `• /latest — Instantly view the newest token launch`,
      `• /stop — Pause personal DM alerts anytime`,
      ``,
      `💡 <b>Pro Tip:</b> Tap the Contract Address (<code>0x...</code>) inside any alert to copy it in 1 click, or tap <b>⚡ Maestro</b> / <b>∑ Sigma Bot</b> to open the sniper bot with the CA already loaded!`,
    ];

    // Admin commands are strictly hidden from normal users and ONLY appended if isUserAdmin === true
    if (isUserAdmin) {
      userSection.push(
        ``,
        `👑 <b>Admin-Only Commands (Visible only to you):</b>`,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        `• /admin — Open Admin Control Panel`,
        `• /users — See <b>WHO & HOW</b> people are using your bot (<code>@username</code>, Name, ID, active filters, actions & alerts received)`,
        `• /status — Live scanner latency, database count & channel status`,
        `• /test — Broadcast a test alert to channel & subscribers`,
        `• /setchannel <code>@channel_or_none</code> — Set or clear public channel`,
        `• /setref <code>maestro|banana|sigma CODE</code> — Set your referral code to earn trading fees`,
        `• /myid — View your Telegram User ID`
      );
    }

    return userSection.join('\n');
  }

  registerCommands() {
    if (!this.bot) return;

    // /myid — Lets the owner find their numeric Telegram ID to set ADMIN_USER_ID in .env
    this.bot.onText(/^\/myid/, async (msg) => {
      const uid = msg.from?.id;
      const uname = msg.from?.username ? `@${msg.from.username}` : 'No username';
      const isUserAdmin = this.isAdmin(msg);
      await this.bot.sendMessage(
        msg.chat.id,
        `🆔 <b>Your Telegram ID:</b> <code>${uid}</code>\n👤 <b>Username:</b> ${escapeHtml(uname)}\n🔑 <b>Admin Status:</b> ${
          isUserAdmin ? '👑 Recognized as Admin' : '👤 Normal User (Add ADMIN_USER_ID=' + uid + ' in .env to become Admin)'
        }`,
        { parse_mode: 'HTML' }
      );
    });

    // /start — Supports deep-linked Lore (`?start=lore_0x...`) OR subscribes user & shows User Menu
    this.bot.onText(/^\/start(?:\s+(.+))?/, async (msg, match) => {
      const chatId = msg.chat.id;
      const isUserAdmin = this.isAdmin(msg);
      const startParam = match && match[1] ? match[1].trim() : '';

      const sub = store.upsertSubscriber(chatId, {
        username: msg.from?.username || '',
        firstName: msg.from?.first_name || 'Trader',
        lastName: msg.from?.last_name || '',
        lastAction: startParam ? `/start ${startParam}` : '/start (Subscribed)',
        active: true,
      });

      // If user clicked the "📖 Lore" deep link inside an alert!
      if (startParam.toLowerCase().startsWith('lore_')) {
        const ca = startParam.slice(5).trim();
        await this.sendTokenLore(chatId, ca);
        return;
      }

      const welcomeLines = [
        `🚀 <b>Welcome to Multi-Launchpad Alert Bot!</b>`,
        ``,
        `✅ <b>Your Personal DM Alerts are now ACTIVE!</b>`,
        `Whenever a new token launches on <b>Programmable</b>, <b>Stockereum</b>, <b>Sender.family</b>, or <b>EtherStreet</b>, you will receive an instant alert right here with a <b>1-tap copiable CA</b> and <b>1-click Maestro / Sigma / DexScreener buttons</b>.`,
        ``,
        `👤 <b>Quick Commands:</b>`,
        `• /help — How to use & command list`,
        `• /settings — Toggle launchpads ON/OFF`,
        `• /latest — View newest token launch`,
        `• /stop — Pause personal alerts`,
      ];

      if (isUserAdmin) {
        welcomeLines.push(
          ``,
          `👑 <b>Admin Panel Unlocked (Only visible to you):</b>`,
          `• /users — See <b>who & how</b> people use your bot (@username, filters, alerts)`,
          `• /status — Scanner speed & stats`,
          `• /admin — Full Admin command list`
        );
      }

      welcomeLines.push(``, `👇 <b>Customize your launchpad alerts below:</b>`);

      await this.bot.sendMessage(chatId, welcomeLines.join('\n'), {
        parse_mode: 'HTML',
        reply_markup: this.buildSubscriptionKeyboard(sub, isUserAdmin),
      });
    });

    // /help — Shows user commands to normal users, and includes admin commands ONLY for the admin
    this.bot.onText(/^\/help/, async (msg) => {
      const chatId = msg.chat.id;
      const isUserAdmin = this.isAdmin(msg);
      const sub = store.recordUserAction(chatId, msg.from, '/help');

      await this.bot.sendMessage(chatId, this.buildHelpText(isUserAdmin), {
        parse_mode: 'HTML',
        reply_markup: this.buildSubscriptionKeyboard(sub, isUserAdmin),
      });
    });

    // /admin — Strictly for Admin only! Normal users get no access.
    this.bot.onText(/^\/admin/, async (msg) => {
      if (!this.isAdmin(msg)) return; // Silently ignore or block non-admins
      const chatId = msg.chat.id;
      const sub = store.recordUserAction(chatId, msg.from, '/admin');
      await this.bot.sendMessage(chatId, this.buildHelpText(true), {
        parse_mode: 'HTML',
        reply_markup: this.buildSubscriptionKeyboard(sub, true),
      });
    });

    // /stop — Pauses personal DM alerts
    this.bot.onText(/^\/stop/, async (msg) => {
      const chatId = msg.chat.id;
      const isUserAdmin = this.isAdmin(msg);
      store.recordUserAction(chatId, msg.from, '/stop (Paused Alerts)');
      const sub = store.setSubscriberActive(chatId, false);
      await this.bot.sendMessage(
        chatId,
        `🔕 <b>Personal alerts paused.</b>\nSend /start anytime or tap the button below to resume!`,
        {
          parse_mode: 'HTML',
          reply_markup: this.buildSubscriptionKeyboard(sub, isUserAdmin),
        }
      );
    });

    // /settings — Opens personal filter buttons
    this.bot.onText(/^\/settings/, async (msg) => {
      const chatId = msg.chat.id;
      const isUserAdmin = this.isAdmin(msg);
      const sub = store.recordUserAction(chatId, msg.from, '/settings');
      await this.bot.sendMessage(
        chatId,
        `⚙️ <b>Your Personal Alert Preferences</b>\nToggle which launchpads send alerts to your DM:`,
        {
          parse_mode: 'HTML',
          reply_markup: this.buildSubscriptionKeyboard(sub, isUserAdmin),
        }
      );
    });

    // 👑 ADMIN ONLY: /users — Shows WHO is using the bot (@username, name, ID) and HOW they are using it!
    this.bot.onText(/^\/users/, async (msg) => {
      if (!this.isAdmin(msg)) return; // Strictly invisible/blocked for normal users
      await this.sendAdminUsersReport(msg.chat.id);
    });

    // 👑 ADMIN ONLY: /status
    this.bot.onText(/^\/status/, async (msg) => {
      if (!this.isAdmin(msg)) return;
      await this.sendAdminStatusReport(msg.chat.id);
    });

    // /lore <CA> command
    this.bot.onText(/^\/lore(?:\s+(\S+))?/, async (msg, match) => {
      const chatId = msg.chat.id;
      store.recordUserAction(chatId, msg.from, '/lore');
      const ca = match && match[1] ? match[1].trim() : store.state.recentLaunches[0]?.address;
      if (!ca) {
        return this.bot.sendMessage(chatId, 'Usage: <code>/lore 0xTokenAddress</code>', { parse_mode: 'HTML' });
      }
      await this.sendTokenLore(chatId, ca);
    });

    // /latest — Available to all users to preview the latest launch
    this.bot.onText(/^\/latest/, async (msg) => {
      const chatId = msg.chat.id;
      store.recordUserAction(chatId, msg.from, '/latest');
      const latest = store.state.recentLaunches[0];
      if (!latest) {
        return this.bot.sendMessage(chatId, 'No launches cached yet. Wait a few seconds for the scanner.');
      }
      await this.sendToTarget(latest, chatId);
    });

    // 👑 ADMIN ONLY: /test
    this.bot.onText(/^\/test/, async (msg) => {
      if (!this.isAdmin(msg)) return;
      const chatId = msg.chat.id;
      const sample = store.state.recentLaunches[0];
      if (!sample) {
        return this.bot.sendMessage(chatId, 'Still fetching initial launches, try again in 2 seconds.');
      }
      const sentOk = await this.sendLaunchAlert(sample);
      if (!sentOk) {
        await this.sendToTarget(sample, chatId);
      } else {
        await this.bot.sendMessage(
          chatId,
          `✅ Broadcasted test alert for <b>${sample.name}</b> to your Channel & active Personal DM subscribers!`,
          { parse_mode: 'HTML' }
        );
      }
    });

    // 👑 ADMIN ONLY: /setchannel
    this.bot.onText(/^\/setchannel\s+(.+)/, async (msg, match) => {
      if (!this.isAdmin(msg)) return;
      const newChannel = match[1].trim();
      store.updateSettings({ channelId: newChannel === 'none' ? '' : newChannel });
      await this.bot.sendMessage(
        msg.chat.id,
        `✅ Target alert channel updated to: <code>${newChannel}</code>`,
        { parse_mode: 'HTML' }
      );
    });

    // 👑 ADMIN ONLY: /setref
    this.bot.onText(/^\/setref\s+(\S+)\s+(\S+)/, async (msg, match) => {
      if (!this.isAdmin(msg)) return;
      const botName = match[1].toLowerCase();
      const code = match[2].trim();
      if (botName === 'maestro') store.updateSettings({ maestroRef: code });
      else if (botName === 'banana') store.updateSettings({ bananaRef: code });
      else if (botName === 'sigma') store.updateSettings({ sigmaRef: code });
      else {
        return this.bot.sendMessage(msg.chat.id, 'Usage: /setref maestro|banana|sigma YOUR_CODE');
      }
      await this.bot.sendMessage(msg.chat.id, `✅ Updated <b>${botName}</b> referral code to <code>${code}</code>`, {
        parse_mode: 'HTML',
      });
    });

    // Interactive callback buttons
    this.bot.on('callback_query', async (query) => {
      const chatId = query.message?.chat?.id;
      if (!chatId) return;

      const isUserAdmin = this.isAdmin(query);
      let sub = store.recordUserAction(chatId, query.from, `Button: ${query.data}`);

      if (query.data && query.data.startsWith('lore:')) {
        const ca = query.data.slice(5).trim();
        await this.bot.answerCallbackQuery(query.id, { text: '📖 Loading Token Lore...' });
        await this.sendTokenLore(chatId, ca);
        return;
      }

      if (query.data === 'toggle_active') {
        sub = store.setSubscriberActive(chatId, !sub.active);
      } else if (query.data === 'toggle_prog') {
        sub = store.toggleSubscriberPlatform(chatId, 'programmable');
      } else if (query.data === 'toggle_stock') {
        sub = store.toggleSubscriberPlatform(chatId, 'stockereum');
      } else if (query.data === 'toggle_sender') {
        sub = store.toggleSubscriberPlatform(chatId, 'sender');
      } else if (query.data === 'toggle_etherstreet') {
        sub = store.toggleSubscriberPlatform(chatId, 'etherstreet');
      } else if (query.data === 'preview_latest') {
        await this.bot.answerCallbackQuery(query.id, { text: 'Sending latest launch...' });
        const latest = store.state.recentLaunches[0];
        if (latest) {
          await this.sendToTarget(latest, chatId);
        }
        return;
      } else if (query.data === 'show_help') {
        await this.bot.answerCallbackQuery(query.id);
        await this.bot.sendMessage(chatId, this.buildHelpText(isUserAdmin), { parse_mode: 'HTML' });
        return;
      } else if (query.data === 'admin_users') {
        if (!isUserAdmin) {
          return this.bot.answerCallbackQuery(query.id, { text: '⛔ Admin only', show_alert: true });
        }
        await this.bot.answerCallbackQuery(query.id);
        await this.sendAdminUsersReport(chatId);
        return;
      } else if (query.data === 'admin_status') {
        if (!isUserAdmin) {
          return this.bot.answerCallbackQuery(query.id, { text: '⛔ Admin only', show_alert: true });
        }
        await this.bot.answerCallbackQuery(query.id);
        await this.sendAdminStatusReport(chatId);
        return;
      }

      try {
        await this.bot.editMessageReplyMarkup(this.buildSubscriptionKeyboard(sub, isUserAdmin), {
          chat_id: chatId,
          message_id: query.message.message_id,
        });
        await this.bot.answerCallbackQuery(query.id, { text: 'Preferences updated!' });
      } catch {
        await this.bot.answerCallbackQuery(query.id);
      }
    });
  }

  async sendAdminUsersReport(chatId) {
    const subs = Object.values(store.state.subscribers || {}).sort(
      (a, b) => (b.lastActiveAt || b.subscribedAt || 0) - (a.lastActiveAt || a.subscribedAt || 0)
    );

    if (subs.length === 0) {
      return this.bot.sendMessage(
        chatId,
        '👥 <b>No users have started the bot yet.</b>\nSend /start to register yourself!',
        { parse_mode: 'HTML' }
      );
    }

    const activeCount = subs.filter((s) => s.active).length;
    const lines = [
      `👑 <b>ADMIN USER ANALYTICS — WHO & HOW USING BOT</b>`,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `👥 <b>Total Users:</b> ${subs.length}  |  🟢 <b>Active:</b> ${activeCount}  |  🔕 <b>Paused:</b> ${
        subs.length - activeCount
      }`,
      ``,
    ];

    subs.slice(0, 30).forEach((u, idx) => {
      const uname = u.username ? `@${escapeHtml(u.username)}` : '<i>No @username</i>';
      const fullName = escapeHtml(`${u.firstName || ''} ${u.lastName || ''}`.trim() || 'User');
      const statusIcon = u.active ? '🟢 Active' : '🔕 Paused';
      const p = u.platforms || { programmable: true, stockereum: true, sender: true, etherstreet: true };
      const filters =
        [
          p.programmable !== false ? '🟣Prog' : '',
          p.stockereum !== false ? '🟢Stock' : '',
          p.sender !== false ? '🔵Sender' : '',
          p.etherstreet !== false ? '🟠EtherStreet' : '',
        ]
          .filter(Boolean)
          .join(', ') || 'None';

      const lastSeen = u.lastActiveAt
        ? new Date(u.lastActiveAt).toUTCString().replace('GMT', 'UTC')
        : new Date(u.subscribedAt).toUTCString().replace('GMT', 'UTC');

      lines.push(
        `<b>${idx + 1}. ${fullName}</b> (${uname}) — <code>${u.chatId}</code>`,
        `   ├ 📡 <b>Status:</b> ${statusIcon} | 🎯 <b>Watching:</b> ${filters}`,
        `   ├ 📊 <b>Usage:</b> ${u.interactionsCount || 1} actions | 📩 <b>Alerts Sent:</b> ${
          u.alertsReceived || 0
        }`,
        `   └ 🕒 <b>Last Action:</b> <code>${escapeHtml(u.lastAction || '/start')}</code> (${lastSeen})`,
        ``
      );
    });

    await this.bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML' });
  }

  async sendAdminStatusReport(chatId) {
    const { stats, settings, subscribers } = store.state;
    const allSubs = Object.values(subscribers || {});
    const activeSubs = allSubs.filter((s) => s.active).length;
    const lats = stats.latencies || {};
    const statusMsg = [
      `👑 <b>ADMIN SCANNER STATUS: ULTRA-FAST MODE</b>`,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `👥 <b>Total Bot Users:</b> ${allSubs.length} (${activeSubs} active) — /users`,
      `📢 <b>Public Channel:</b> <code>${settings.channelId || 'None (Personal DM Mode)'}</code>`,
      `⏱ <b>Last Scan:</b> ${stats.lastPollAt ? new Date(stats.lastPollAt).toUTCString() : 'Pending'}`,
      ``,
      `⚡ <b>Live Stream Speed (Keep-Alive TLS):</b>`,
      `• 🟣 Programmable (ETH): ${settings.enableProgrammable ? '✅ ON' : '❌ OFF'} (${lats.programmable || '--'}ms)`,
      `• 🟣 Programmable (RH): ${settings.enableProgrammableRobinhood ? '✅ ON' : '❌ OFF'} (${
        lats.programmable_robinhood || '--'
      }ms)`,
      `• 🟢 Stockereum: ${settings.enableStockereum ? '✅ ON' : '❌ OFF'} (${lats.stockereum || '--'}ms)`,
      `• 🔵 Sender.family: ${settings.enableSender ? '✅ ON' : '❌ OFF'} (${lats.sender || '--'}ms)`,
      `• 🟠 EtherStreet: ${settings.enableEtherStreet ? '✅ ON' : '❌ OFF'} (${lats.etherstreet || '--'}ms)`,
      ``,
      `📊 <b>Alerts Broadcasted:</b> ${stats.totalAlertsSent}`,
      `• Tracked CAs in DB: ${Object.keys(store.state.seenTokens).length}`,
    ].join('\n');

    await this.bot.sendMessage(chatId, statusMsg, { parse_mode: 'HTML' });
  }

  async sendTokenLore(chatId, ca) {
    if (!this.bot || !this.isConnected) return;
    const cleanCa = String(ca).toLowerCase();
    let launch = store.state.recentLaunches.find((x) => x.address.toLowerCase() === cleanCa);

    // If not in recentLaunches or missing lore, try resolving on-chain / Stockereum metadata on the fly
    if (!launch || (!launch.lore && (!launch.socials || Object.keys(launch.socials).length === 0))) {
      const {
        resolveProgrammableOnChainMetadata,
        resolveStockereumMeta,
        fetchDexScreenerStats,
      } = require('./fetchers');

      const [progMeta, stockMeta, dexStats] = await Promise.all([
        resolveProgrammableOnChainMetadata(ca, 1),
        resolveStockereumMeta(ca),
        fetchDexScreenerStats(ca),
      ]);

      launch = {
        platformName: launch?.platformName || 'Ethereum Launchpad',
        platformUrl: launch?.platformUrl || `https://etherscan.io/token/${ca}`,
        address: ca,
        name: launch?.name || 'Token',
        symbol: launch?.symbol || 'TOKEN',
        category: launch?.category || 'Uniswap v4',
        creator: launch?.creator || stockMeta?.creator || null,
        hookAddress: launch?.hookAddress || stockMeta?.hookAddress || null,
        lore: launch?.lore || progMeta?.description || stockMeta?.lore || '',
        socials: {
          ...(dexStats?.socials || {}),
          ...(stockMeta?.socials || {}),
          ...(progMeta?.socials || {}),
          ...(launch?.socials || {}),
        },
      };
    }

    const loreHtml = buildLoreMessage(launch);
    await this.bot.sendMessage(chatId, loreHtml, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  }

  async sendToTarget(launch, targetChatId) {
    if (!this.bot || !this.isConnected || !targetChatId) return false;

    const { caption, replyMarkup } = buildTelegramAlert(launch, store.state.settings, this.botUsername);
    const trackKey = `${launch.platformKey}:${String(launch.address).toLowerCase()}`;

    const recordMessage = (msgObj, isPhoto) => {
      if (!msgObj || !msgObj.message_id) return;
      if (!this.liveTrackedAlerts.has(trackKey)) {
        this.liveTrackedAlerts.set(trackKey, {
          launch: { ...launch },
          sentAt: Date.now(),
          lastCaption: caption,
          messages: [],
        });
      }
      const entry = this.liveTrackedAlerts.get(trackKey);
      entry.messages.push({
        chatId: targetChatId,
        messageId: msgObj.message_id,
        isPhoto,
      });
    };

    try {
      let sentMsg = null;
      let sentAsPhoto = false;

      if (launch.image && launch.image.startsWith('http')) {
        try {
          // Convert .webp URLs via wsrv.nl proxy so Telegram sendPhoto never rejects WebP images!
          const photoUrl = launch.image.toLowerCase().endsWith('.webp')
            ? `https://wsrv.nl/?url=${encodeURIComponent(launch.image)}&output=jpg`
            : launch.image;

          // Race sendPhoto against a 1200ms timer so slow external image hosts never delay message delivery
          sentMsg = await Promise.race([
            this.bot.sendPhoto(targetChatId, photoUrl, {
              caption,
              parse_mode: 'HTML',
              reply_markup: replyMarkup,
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Photo download timed out (>1200ms)')), 1200)
            ),
          ]);
          sentAsPhoto = true;
        } catch (photoErr) {
          // Fall back to instant text message
        }
      }

      if (!sentMsg) {
        sentMsg = await this.bot.sendMessage(targetChatId, caption, {
          parse_mode: 'HTML',
          disable_web_page_preview: false,
          reply_markup: replyMarkup,
        });
        sentAsPhoto = false;
      }

      recordMessage(sentMsg, sentAsPhoto);
      store.incrementUserAlertsReceived(targetChatId);
      return true;
    } catch (err) {
      if (err.message && (err.message.includes('403') || err.message.includes('blocked'))) {
        store.setSubscriberActive(targetChatId, false);
      }
      console.error(`[TelegramBot] ❌ Failed to send alert to ${targetChatId}:`, err.message);
      return false;
    }
  }

  /**
   * Live-edits already-sent Telegram alert messages in place when Volume, Market Cap, or Trades change!
   */
  async updateLiveAlertMessages(updatedLaunch) {
    if (!this.bot || !this.isConnected || !updatedLaunch?.address) return;

    const trackKey = `${updatedLaunch.platformKey}:${String(updatedLaunch.address).toLowerCase()}`;
    const tracked = this.liveTrackedAlerts.get(trackKey);
    if (!tracked || tracked.messages.length === 0) return;

    // Expire live tracking after 30 minutes to keep Telegram rate limits clean
    if (Date.now() - tracked.sentAt > 30 * 60 * 1000) {
      this.liveTrackedAlerts.delete(trackKey);
      return;
    }

    // Merge new live stats into the tracked launch WITHOUT overwriting valid stats with null or lower trade counts!
    const prev = tracked.launch;
    const pickPositive = (nextVal, prevVal) => {
      if (nextVal !== null && nextVal !== undefined && Number(nextVal) > 0) return Number(nextVal);
      if (prevVal !== null && prevVal !== undefined && Number(prevVal) > 0) return Number(prevVal);
      return nextVal ?? prevVal ?? null;
    };

    tracked.launch = {
      ...prev,
      ...updatedLaunch,
      image:
        updatedLaunch.image && !updatedLaunch.image.includes('programmable-landing-preview')
          ? updatedLaunch.image
          : prev.image || updatedLaunch.image,
      creator: updatedLaunch.creator || prev.creator || null,
      hookAddress: updatedLaunch.hookAddress || prev.hookAddress || null,
      lore: updatedLaunch.lore || prev.lore || '',
      socials: {
        ...(prev.socials || {}),
        ...(updatedLaunch.socials || {}),
      },
      marketCapUsd: pickPositive(updatedLaunch.marketCapUsd, prev.marketCapUsd),
      volumeUsd: Math.max(Number(updatedLaunch.volumeUsd || 0), Number(prev.volumeUsd || 0)) || null,
      volumeCoin: Math.max(Number(updatedLaunch.volumeCoin || 0), Number(prev.volumeCoin || 0)) || null,
      poolQuoteEth: pickPositive(updatedLaunch.poolQuoteEth, prev.poolQuoteEth),
      liquidityUsd: pickPositive(updatedLaunch.liquidityUsd, prev.liquidityUsd),
      priceChange5m: updatedLaunch.priceChange5m ?? prev.priceChange5m ?? null,
      buys: Math.max(Number(updatedLaunch.buys || 0), Number(prev.buys || 0)),
      sells: Math.max(Number(updatedLaunch.sells || 0), Number(prev.sells || 0)),
      trades: Math.max(Number(updatedLaunch.trades || 0), Number(prev.trades || 0)),
    };

    const { caption, replyMarkup } = buildTelegramAlert(
      tracked.launch,
      store.state.settings,
      this.botUsername
    );
    if (caption === tracked.lastCaption) return; // Nothing changed yet
    // Throttle Telegram message edits to at most once every 3.5s per token for smooth, non-flickering updates
    const now = Date.now();
    if (tracked.lastEditedAt && now - tracked.lastEditedAt < 3500) return;
    tracked.lastEditedAt = now;
    tracked.lastCaption = caption;

    await Promise.allSettled(
      tracked.messages.map(async (m) => {
        try {
          if (m.isPhoto) {
            await this.bot.editMessageCaption(caption, {
              chat_id: m.chatId,
              message_id: m.messageId,
              parse_mode: 'HTML',
              reply_markup: replyMarkup,
            });
          } else {
            await this.bot.editMessageText(caption, {
              chat_id: m.chatId,
              message_id: m.messageId,
              parse_mode: 'HTML',
              disable_web_page_preview: false,
              reply_markup: replyMarkup,
            });
          }
        } catch {
          // Ignore 'message is not modified' or rate limit warnings
        }
      })
    );
  }

  async sendLaunchAlert(launch, overrideChatId = null) {
    if (!this.bot || !this.isConnected) return false;

    if (overrideChatId) {
      return this.sendToTarget(launch, overrideChatId);
    }

    const targets = new Set();

    const channelId = store.state.settings.channelId;
    if (channelId && channelId !== '@your_channel_here' && channelId.trim() !== '') {
      targets.add(channelId.trim());
    }

    // Seed default subscribers right here in case INITIAL_SUBSCRIBERS wasn't set in Render env
    const defaultAdminIds = ['1947158378', '1314470665', '7834050828', '1032627697'];
    for (const defaultId of defaultAdminIds) {
      if (!store.state.subscribers[defaultId]) {
        store.upsertSubscriber(defaultId, { active: true });
      }
    }

    const subs = store.getActiveSubscribersForPlatform(launch.platformKey);
    for (const sub of subs) {
      targets.add(String(sub.chatId));
    }

    if (targets.size === 0) {
      return false;
    }

    const results = await Promise.allSettled(
      Array.from(targets).map((chatId) => this.sendToTarget(launch, chatId))
    );
    const successCount = results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
    store.save();

    return successCount > 0;
  }
}

module.exports = new AlertBot();
