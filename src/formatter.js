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
  const platformName = escapeHtml(launch.platformName || 'Launchpad');
  const chainName = escapeHtml(launch.chainName || 'Ethereum Mainnet');
  const isPangea = launch.platformKey === 'pangea';

  const makeMaestroUrl = (addr) => {
    const start = settings.maestroRef ? `${addr}-${settings.maestroRef}` : addr;
    return `https://t.me/maestro?start=${start}`;
  };

  const lines = [];
  lines.push(`<b>${name}</b> (<code>$${symbol}</code>) · <a href="${launch.platformUrl}">${platformName}</a>`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━`);

  if (isPangea) {
    if (launch.isSameEvmAddress) {
      lines.push(`CA    <code>${ca}</code>  <a href="${makeMaestroUrl(ca)}">[Maestro]</a>`);
      lines.push(`<i>Omnichain: ETH · Base · BSC · Robinhood</i>`);
      if (launch.solanaAddress && launch.solanaAddress !== ca) {
        lines.push(`SOL   <code>${launch.solanaAddress}</code>  <a href="${makeMaestroUrl(launch.solanaAddress)}">[Maestro]</a>`);
      }
    } else {
      if (launch.ethAddress) lines.push(`ETH   <code>${launch.ethAddress}</code>  <a href="${makeMaestroUrl(launch.ethAddress)}">[Maestro]</a>`);
      if (launch.baseAddress) lines.push(`BASE  <code>${launch.baseAddress}</code>  <a href="${makeMaestroUrl(launch.baseAddress)}">[Maestro]</a>`);
      if (launch.bscAddress) lines.push(`BSC   <code>${launch.bscAddress}</code>  <a href="${makeMaestroUrl(launch.bscAddress)}">[Maestro]</a>`);
      if (launch.rhAddress) lines.push(`RH    <code>${launch.rhAddress}</code>  <a href="${makeMaestroUrl(launch.rhAddress)}">[Maestro]</a>`);
      if (launch.solanaAddress) lines.push(`SOL   <code>${launch.solanaAddress}</code>  <a href="${makeMaestroUrl(launch.solanaAddress)}">[Maestro]</a>`);
    }
  } else {
    lines.push(`CA    <code>${ca}</code>  <a href="${makeMaestroUrl(ca)}">[Maestro]</a>`);
  }

  lines.push(``);

  // Clean, classic Metrics Line
  const mcVal = Number(launch.marketCapUsd);
  const mcStr = mcVal > 0 ? formatUsd(mcVal) : 'Fresh Launch';
  const metrics = [`MC: <b>${mcStr}</b>`];

  const volVal = Number(launch.volumeUsd);
  if (volVal > 0) {
    metrics.push(`Vol: <b>${formatUsd(volVal)}</b>`);
  }

  const buysCount = launch.buys ?? 0;
  const sellsCount = launch.sells ?? 0;
  const totalTrades = launch.trades || buysCount + sellsCount || 0;
  if (totalTrades > 0) {
    metrics.push(`Trades: <b>${totalTrades}</b>`);
  }
  if (!isPangea && launch.chainName) {
    metrics.push(`Chain: <b>${escapeHtml(chainName.replace(/\s*\(.*\)/, ''))}</b>`);
  }
  lines.push(metrics.join(' · '));

  // Clean Links Bar
  const links = [];
  if (launch.socials?.website) {
    links.push(`<a href="${escapeHtml(launch.socials.website)}">Website</a>`);
  } else if (launch.platformUrl) {
    links.push(`<a href="${escapeHtml(launch.platformUrl)}">Website</a>`);
  }

  if (launch.socials?.twitter) {
    const tw = launch.socials.twitter.startsWith('http')
      ? launch.socials.twitter
      : `https://x.com/${launch.socials.twitter.replace(/^@/, '')}`;
    links.push(`<a href="${escapeHtml(tw)}">Twitter</a>`);
  } else {
    links.push(`<a href="https://x.com/search?q=${encodeURIComponent(ca)}">Twitter</a>`);
  }

  if (launch.socials?.telegram) {
    const tg = launch.socials.telegram.startsWith('http')
      ? launch.socials.telegram
      : `https://t.me/${launch.socials.telegram.replace(/^@/, '')}`;
    links.push(`<a href="${escapeHtml(tg)}">Telegram</a>`);
  }

  if (launch.dexScreenerUrl) {
    links.push(`<a href="${escapeHtml(launch.dexScreenerUrl)}">DexScreener</a>`);
  }

  lines.push(links.join(' · '));

  if (launch.lore && launch.lore.trim().length > 0) {
    const cleanLore = escapeHtml(launch.lore.trim()).slice(0, 140);
    lines.push(`<i>"${cleanLore}${launch.lore.length > 140 ? '...' : ''}"</i>`);
  }

  const caption = lines.join('\n');

  // Trading bot deep links
  const maestroUrl = makeMaestroUrl(ca);
  const sigmaStart = settings.sigmaRef ? `x-${settings.sigmaRef}-${ca}` : `x-${ca}`;
  const sigmaUrl = `https://t.me/Sigma_buyBot?start=${sigmaStart}`;

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: 'Maestro', url: maestroUrl },
        { text: 'Sigma', url: sigmaUrl },
      ],
      [
        { text: 'DexScreener', url: launch.dexScreenerUrl },
        {
          text: isPangea ? 'Pangea App' : 'Platform App',
          url: launch.platformUrl,
        },
      ],
    ],
  };

  return {
    caption,
    replyMarkup,
    tradingLinks: {
      maestroUrl,
      sigmaUrl,
      dexScreenerUrl: launch.dexScreenerUrl,
    },
  };
}

module.exports = {
  buildTelegramAlert,
  buildLoreMessage,
  shortAddr,
  formatUsd,
};
