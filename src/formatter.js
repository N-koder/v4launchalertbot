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
  lines.push(`<b>${name} ($${symbol})</b>`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`🏛 <b>Platform:</b> <a href="${launch.platformUrl}">${platformName}</a>`);

  if (isPangea) {
    lines.push(``);
    if (launch.isSameEvmAddress) {
      lines.push(`🔗 <b>Multi-Chain Contracts:</b>`);
      lines.push(`<code>${ca}</code>  <a href="${makeMaestroUrl(ca)}">[Maestro]</a>`);
      lines.push(`<i>Omnichain: ETH · Base · BSC · Robinhood</i>`);
      if (launch.solanaAddress && launch.solanaAddress !== ca) {
        lines.push(`<b>SOL:</b>  <code>${launch.solanaAddress}</code>  <a href="${makeMaestroUrl(launch.solanaAddress)}">[Maestro]</a>`);
      }
    } else {
      lines.push(`🔗 <b>Multi-Chain Contracts:</b>`);
      if (launch.ethAddress) lines.push(`<b>ETH:</b>  <code>${launch.ethAddress}</code>  <a href="${makeMaestroUrl(launch.ethAddress)}">[Maestro]</a>`);
      if (launch.baseAddress) lines.push(`<b>BASE:</b> <code>${launch.baseAddress}</code>  <a href="${makeMaestroUrl(launch.baseAddress)}">[Maestro]</a>`);
      if (launch.bscAddress) lines.push(`<b>BSC:</b>  <code>${launch.bscAddress}</code>  <a href="${makeMaestroUrl(launch.bscAddress)}">[Maestro]</a>`);
      if (launch.rhAddress) lines.push(`<b>RH:</b>   <code>${launch.rhAddress}</code>  <a href="${makeMaestroUrl(launch.rhAddress)}">[Maestro]</a>`);
      if (launch.solanaAddress) lines.push(`<b>SOL:</b>  <code>${launch.solanaAddress}</code>  <a href="${makeMaestroUrl(launch.solanaAddress)}">[Maestro]</a>`);
    }
  } else {
    // Single-chain launches: clean CA without [Maestro] link beside it (the Maestro button is below!)
    lines.push(``);
    lines.push(`📋 <b>Contract Address:</b>`);
    lines.push(`<code>${ca}</code>`);
  }

  // Lore / Story / Description
  const loreText = (launch.lore || launch.description || '').trim();
  if (
    loreText &&
    !loreText.startsWith('Launched on') &&
    !loreText.startsWith('Create a fixed-supply')
  ) {
    const cleanLore = escapeHtml(loreText).slice(0, 240);
    lines.push(``);
    lines.push(`📖 <b>Lore:</b>`);
    lines.push(`<i>"${cleanLore}${loreText.length > 240 ? '...' : ''}"</i>`);
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
    metrics.push(`Txns: <b>${totalTrades}</b>`);
  }
  if (!isPangea && launch.chainName) {
    metrics.push(`Chain: <b>${escapeHtml(chainName.replace(/\s*\(.*\)/, ''))}</b>`);
  }
  lines.push(`📊 <b>Stats:</b>`);
  lines.push(metrics.join('  •  '));

  // Distance between Stats and Links
  lines.push(``);

  // Clean Links Bar (DexScreener removed since dedicated button exists!)
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
    links.push(`<a href="${escapeHtml(tw)}">𝕏 Twitter</a>`);
  } else {
    links.push(`<a href="https://x.com/search?q=${encodeURIComponent(ca)}">𝕏 Twitter</a>`);
  }

  if (launch.socials?.telegram) {
    const tg = launch.socials.telegram.startsWith('http')
      ? launch.socials.telegram
      : `https://t.me/${launch.socials.telegram.replace(/^@/, '')}`;
    links.push(`<a href="${escapeHtml(tg)}">Telegram</a>`);
  }

  lines.push(`🔗 <b>Links:</b> ${links.join('  •  ')}`);

  const caption = lines.join('\n');

  // Trading bot deep links
  const maestroUrl = makeMaestroUrl(ca);
  const sigmaStart = settings.sigmaRef ? `x-${settings.sigmaRef}-${ca}` : `x-${ca}`;
  const sigmaUrl = `https://t.me/Sigma_buyBot?start=${sigmaStart}`;

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '⚡ Maestro ↗', url: maestroUrl },
        { text: '∑ Sigma ↗', url: sigmaUrl },
      ],
      [
        { text: '📈 DexScreener ↗', url: launch.dexScreenerUrl },
        {
          text: isPangea ? '🏛 Pangea App ↗' : '🏛 App ↗',
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
