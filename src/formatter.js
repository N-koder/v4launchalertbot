function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shortAddr(addr) {
  if (!addr || addr.length < 12) return addr || 'N/A';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatUsd(val) {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return null;
  const num = Number(val);
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${(num / 1_000).toFixed(2)}K`;
  return `$${num.toFixed(2)}`;
}

/**
 * Builds the Phanes-style Lore & Token Story card when a user clicks [ 📖 Lore ] or deep-links /start lore_CA
 */
function buildLoreMessage(launch) {
  const name = escapeHtml(launch.name || 'Unknown');
  const symbol = escapeHtml(launch.symbol || '???');
  const ca = launch.address;
  const platformName = escapeHtml(launch.platformName || 'Launchpad');
  const isPangea = launch.platformKey === 'pangea';

  const rawLore = (launch.lore || '').trim();
  const loreBody = rawLore
    ? `<blockquote>"${escapeHtml(rawLore)}"</blockquote>`
    : `<blockquote><i>No custom creator narrative was written on-chain for $${symbol}. Deployed via ${platformName} (${escapeHtml(
        launch.category || 'Uniswap v4'
      )}).</i></blockquote>`;

  const socialItems = [];
  if (launch.socials?.website) {
    socialItems.push(`<a href="${escapeHtml(launch.socials.website)}">🌐 Website</a>`);
  }
  if (launch.socials?.twitter) {
    const tw = launch.socials.twitter.startsWith('http')
      ? launch.socials.twitter
      : `https://x.com/${launch.socials.twitter.replace(/^@/, '')}`;
    socialItems.push(`<a href="${escapeHtml(tw)}">𝕏 Twitter / X</a>`);
  }
  if (launch.socials?.telegram) {
    const tg = launch.socials.telegram.startsWith('http')
      ? launch.socials.telegram
      : `https://t.me/${launch.socials.telegram.replace(/^@/, '')}`;
    socialItems.push(`<a href="${escapeHtml(tg)}">✈️ Telegram</a>`);
  }
  socialItems.push(`<a href="${escapeHtml(launch.platformUrl)}">🏛 ${platformName}</a>`);

  return [
    `📖 <b>TOKEN LORE — ${name} ($${symbol})</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `📋 <b>CA:</b> <code>${ca}</code>`,
    isPangea
      ? `🌐 <i>Universal Omnichain CA (${escapeHtml(launch.chainsList || 'ETH • Base • BSC • Robinhood')})</i>`
      : null,
    ``,
    `📜 <b>Origin & Lore:</b>`,
    loreBody,
    ``,
    `🧩 <b>Launchpad:</b> ${platformName} (${escapeHtml(launch.category || 'Uni v4')})`,
    launch.creator
      ? `👤 <b>Creator Wallet:</b> <a href="https://etherscan.io/address/${launch.creator}">${shortAddr(
          launch.creator
        )}</a>`
      : null,
    launch.hookAddress
      ? `🪝 <b>Uniswap v4 Hook:</b> <a href="https://etherscan.io/address/${launch.hookAddress}">${shortAddr(
          launch.hookAddress
        )}</a>`
      : null,
    `🔗 <b>Links:</b> ${socialItems.join('  •  ')}`,
  ]
    .filter((x) => x !== null)
    .join('\n');
}

/**
 * Build the HTML message body and inline_keyboard for Telegram
 */
function buildTelegramAlert(launch, settings = {}, botUsername = '') {
  const ca = launch.address;
  const name = escapeHtml(launch.name || 'Unknown');
  const symbol = escapeHtml(launch.symbol || '???');
  const pair = escapeHtml(launch.quoteSymbol || 'ETH');
  const block = launch.blockNumber ? String(launch.blockNumber) : 'live';
  const isPangea = launch.platformKey === 'pangea';

  const hashtagMap = {
    pangea: 'PANGEA',
    stockereum: 'STOCKEREUM',
    programmable: 'PROGRAMMABLE',
    programmable_robinhood: 'ROBINHOOD',
    sender: 'SENDER',
    etherstreet: 'ETHERSTREET',
  };
  const hashtag = hashtagMap[launch.platformKey] || 'ETHV4';

  const platformSlugMap = {
    pangea: 'pangea',
    stockereum: 'stocker',
    programmable: 'programmable',
    programmable_robinhood: 'robinhood',
    sender: 'sender',
    etherstreet: 'etherstreet',
  };
  const platformSlug = platformSlugMap[launch.platformKey] || 'pangea';

  const makeMaestroUrl = (addr) => {
    const start = settings.maestroRef ? `${addr}-${settings.maestroRef}` : addr;
    return `https://t.me/maestro?start=${start}`;
  };

  const lines = [];
  // Line 1: Header matching classic Phanes layout
  lines.push(`<b>${name}</b> (<i>${symbol}/${pair}</i>) · blk: ${block} · #${hashtag}`);

  // Line 2: Contract Address(es)
  if (isPangea) {
    if (launch.isSameEvmAddress && launch.ethAddress) {
      lines.push(`CA: <code>${launch.ethAddress}</code>`);
      if (launch.solanaAddress) lines.push(`Sol: <code>${launch.solanaAddress}</code>`);
    } else {
      lines.push(`CA: <code>${launch.ethAddress || ca}</code>`);
      if (launch.baseAddress) lines.push(`Base: <code>${launch.baseAddress}</code>`);
      if (launch.bscAddress) lines.push(`BSC: <code>${launch.bscAddress}</code>`);
      if (launch.rhAddress) lines.push(`RH: <code>${launch.rhAddress}</code>`);
      if (launch.solanaAddress) lines.push(`Sol: <code>${launch.solanaAddress}</code>`);
    }
  } else {
    lines.push(`CA: <code>${ca}</code>`);
  }

  // Line 3: Deployer
  const deployer = launch.creator || launch.deployer || null;
  if (deployer) {
    lines.push(`Deployer: <a href="https://etherscan.io/address/${deployer}">${deployer}</a>`);
  } else {
    lines.push(`Deployer: none`);
  }

  // Line 4: Dev
  lines.push(`Dev: none`);

  // Line 5: Rewards / Fees
  let rewards = '1% trading fee';
  if (isPangea) {
    rewards = '1.6% creator fee (2% trading fee)';
  } else if (launch.platformKey === 'stockereum') {
    rewards = launch.feePct ? `${launch.feePct} for creator` : '67% for creator';
  }
  lines.push(`Rewards: ${rewards}`);

  // Social section (if available)
  const socialItems = [];
  if (launch.socials?.twitter) {
    const tw = launch.socials.twitter.replace(/^https?:\/\/x\.com\//, '').replace(/^https?:\/\/twitter\.com\//, '');
    const twUrl = launch.socials.twitter.startsWith('http') ? launch.socials.twitter : `https://x.com/${tw.replace(/^@/, '')}`;
    socialItems.push(`X: <a href="${twUrl}">${tw.startsWith('@') ? tw : (tw.startsWith('x.com') ? tw : `@${tw}`)}</a>`);
  }
  if (launch.socials?.telegram) {
    const tg = launch.socials.telegram.replace(/^https?:\/\/t\.me\//, '');
    const tgUrl = launch.socials.telegram.startsWith('http') ? launch.socials.telegram : `https://t.me/${tg.replace(/^@/, '')}`;
    socialItems.push(`TG: <a href="${tgUrl}">${tg.startsWith('@') ? tg : `@${tg}`}</a>`);
  }
  if (launch.socials?.website) {
    const webUrl = launch.socials.website.startsWith('http')
      ? launch.socials.website
      : `https://${launch.socials.website}`;
    const webClean = launch.socials.website.replace(/^https?:\/\//, '').replace(/\/$/, '');
    socialItems.push(`Web: <a href="${webUrl}">${webClean}</a>`);
  }

  if (socialItems.length > 0) {
    lines.push(``);
    lines.push(`Social:`);
    socialItems.forEach((item, idx) => {
      const prefix = idx === socialItems.length - 1 ? '└' : '├';
      lines.push(`${prefix} ${item}`);
    });
  }

  lines.push(``);

  // Footer Row 1: Charts & Search
  const dsUrl = launch.dexScreenerUrl || `https://dexscreener.com/ethereum/${ca}`;
  const defUrl = `https://dexview.com/eth/${ca}`;
  const searchXUrl = `https://x.com/search?q=${encodeURIComponent(ca)}`;
  lines.push(
    `📊: <a href="${dsUrl}">DS</a> • <a href="${defUrl}">DEF</a> • <a href="${launch.platformUrl}">${platformSlug}</a> • <a href="${searchXUrl}">Search X</a>`
  );

  // Footer Row 2: Trading Bot Deep Links
  const bananaStart = settings.bananaRef ? `${ca}-${settings.bananaRef}` : ca;
  const bananaUrl = `https://t.me/BananaGunSniper_bot?start=${bananaStart}`;
  const maestroUrl = makeMaestroUrl(ca);
  const sigmaStart = settings.sigmaRef ? `x-${settings.sigmaRef}-${ca}` : `x-${ca}`;
  const sigmaUrl = `https://t.me/Sigma_buyBot?start=${sigmaStart}`;
  const bloomUrl = `https://t.me/BloomSolana_bot?start=${ca}`;
  const fomoUrl = `https://t.me/fomobuybot?start=${ca}`;

  lines.push(
    `🤖: <a href="${bananaUrl}">BSDW</a> • <a href="${maestroUrl}">GM</a> • <a href="${sigmaUrl}">SIG</a> • <a href="${bloomUrl}">BSD</a> • <a href="${fomoUrl}">FOMO</a>`
  );

  const caption = lines.join('\n');

  return {
    caption,
    replyMarkup: undefined,
    tradingLinks: {
      maestroUrl,
      sigmaUrl,
      dexScreenerUrl: dsUrl,
    },
  };
}

module.exports = {
  buildTelegramAlert,
  buildLoreMessage,
  shortAddr,
  formatUsd,
};
