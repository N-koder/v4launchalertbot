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
  const badge = escapeHtml(launch.platformBadge || '🚀 NEW LAUNCH');
  const chainName = escapeHtml(launch.chainName || 'Ethereum Mainnet');
  const isPangea = launch.platformKey === 'pangea';

  const lines = [];
  lines.push(`<b>${badge} — NEW TOKEN LAUNCH!</b>`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`🪙 <b>Token:</b> ${name} (<b>$${symbol}</b>)`);
  lines.push(`🏛 <b>Platform:</b> <a href="${launch.platformUrl}">${platformName}</a>`);

  if (isPangea) {
    lines.push(`⛓ <b>Chains:</b> 🌐 <b>Omnichain</b> (${escapeHtml(launch.chainsList || 'ETH • Base • BSC • Robinhood')})`);
    lines.push(``);

    if (launch.isSameEvmAddress) {
      lines.push(`📋 <b>Universal Multi-Chain CA (Tap to Copy):</b>`);
      lines.push(`<code>${ca}</code>`);
      lines.push(`🔄 <i>Same CA on ETH, Base, BSC & Robinhood!</i>`);
      lines.push(`💡 <i>In Maestro / Sigma, tap refresh (🔄) to cycle through chains.</i>`);
      if (launch.solanaAddress && launch.solanaAddress !== ca) {
        lines.push(``);
        lines.push(`🟣 <b>Solana Address:</b> <code>${launch.solanaAddress}</code>`);
      }
    } else {
      lines.push(`📋 <b>Contract Addresses by Chain (Tap to Copy):</b>`);
      if (launch.ethAddress) lines.push(`🔹 <b>Ethereum:</b> <code>${launch.ethAddress}</code>`);
      if (launch.baseAddress) lines.push(`🔵 <b>Base:</b> <code>${launch.baseAddress}</code>`);
      if (launch.bscAddress) lines.push(`🟡 <b>BSC:</b> <code>${launch.bscAddress}</code>`);
      if (launch.rhAddress) lines.push(`🟣 <b>Robinhood:</b> <code>${launch.rhAddress}</code>`);
      if (launch.solanaAddress) lines.push(`🟣 <b>Solana:</b> <code>${launch.solanaAddress}</code>`);
      lines.push(`💡 <i>Tap any chain address above to copy and trade on that chain!</i>`);
    }
  } else {
    lines.push(`⛓ <b>Chain:</b> ${chainName}`);
    lines.push(``);
    lines.push(`📋 <b>Contract Address (Tap to Copy):</b>`);
    lines.push(`<code>${ca}</code>`);
  }
  lines.push(``);
  lines.push(`📊 <b>Launch Details (Live):</b>`);
  const detailLines = [];
  detailLines.push(`🧩 <b>Type / Pair:</b> ${escapeHtml(launch.category || launch.quoteSymbol || 'ETH')}`);

  if (launch.marketCapUsd !== null && launch.marketCapUsd !== undefined && Number(launch.marketCapUsd) > 0) {
    const chg =
      launch.priceChange5m !== undefined && launch.priceChange5m !== null
        ? ` (${launch.priceChange5m >= 0 ? '🟢 +' : '🔴 '}${launch.priceChange5m}%)`
        : '';
    detailLines.push(`💰 <b>Market Cap:</b> ${formatUsd(launch.marketCapUsd)}${chg}`);
  } else {
    detailLines.push(`💰 <b>Market Cap:</b> Indexing...`);
  }

  const hasUsdVol = launch.volumeUsd !== null && launch.volumeUsd !== undefined && Number(launch.volumeUsd) > 0;
  const hasCoinVol = launch.volumeCoin !== null && launch.volumeCoin !== undefined && Number(launch.volumeCoin) > 0;

  if (hasUsdVol || hasCoinVol) {
    const volParts = [];
    if (hasUsdVol) {
      volParts.push(formatUsd(launch.volumeUsd));
    }
    if (hasCoinVol) {
      volParts.push(`${Number(launch.volumeCoin).toFixed(3)} ${escapeHtml(launch.quoteSymbol || 'ETH')}`);
    }
    detailLines.push(`📊 <b>Live Volume (24h):</b> ${volParts.join(' • ')}`);
  } else {
    detailLines.push(`📊 <b>Live Volume (24h):</b> $0.00 (Fresh Launch)`);
  }

  const buysCount = launch.buys ?? 0;
  const sellsCount = launch.sells ?? 0;
  const totalTrades = launch.trades || buysCount + sellsCount || 0;
  if (buysCount > 0 || sellsCount > 0) {
    detailLines.push(`🔄 <b>Transactions:</b> 🟢 ${buysCount} Buys  |  🔴 ${sellsCount} Sells (${totalTrades} txns)`);
  } else {
    detailLines.push(`🔄 <b>Transactions:</b> ${totalTrades} Trades`);
  }

  if (launch.hookAddress) {
    detailLines.push(
      `🪝 <b>Uni v4 Hook:</b> <a href="https://etherscan.io/address/${launch.hookAddress}">${shortAddr(
        launch.hookAddress
      )}</a>`
    );
  }
  if (launch.creator) {
    detailLines.push(
      `👤 <b>Creator:</b> <a href="https://etherscan.io/address/${launch.creator}">${shortAddr(
        launch.creator
      )}</a>`
    );
  }
  if (launch.blockNumber) {
    detailLines.push(`🧱 <b>Block:</b> #${escapeHtml(String(launch.blockNumber))}`);
  }

  detailLines.forEach((dLine, idx) => {
    const prefix = idx === detailLines.length - 1 ? '└' : '├';
    lines.push(`${prefix} ${dLine}`);
  });

  // Phanes-style Socials & Lore bar: 🌐 Web | 𝕏 X | ✈️ TG | 📖 Lore
  const socialBar = [];
  if (launch.socials?.website) {
    socialBar.push(`<a href="${escapeHtml(launch.socials.website)}">🌐 Web</a>`);
  } else {
    socialBar.push(`<a href="${escapeHtml(launch.platformUrl)}">🌐 Web</a>`);
  }

  if (launch.socials?.twitter) {
    const tw = launch.socials.twitter.startsWith('http')
      ? launch.socials.twitter
      : `https://x.com/${launch.socials.twitter.replace(/^@/, '')}`;
    socialBar.push(`<a href="${escapeHtml(tw)}">𝕏 Twitter</a>`);
  } else {
    const searchX = `https://x.com/search?q=${encodeURIComponent(ca)}`;
    socialBar.push(`<a href="${searchX}">𝕏 Search</a>`);
  }

  if (launch.socials?.telegram) {
    const tg = launch.socials.telegram.startsWith('http')
      ? launch.socials.telegram
      : `https://t.me/${launch.socials.telegram.replace(/^@/, '')}`;
    socialBar.push(`<a href="${escapeHtml(tg)}">✈️ TG</a>`);
  }

  const loreDeepLink = botUsername
    ? `https://t.me/${botUsername}?start=lore_${ca}`
    : launch.platformUrl;
  socialBar.push(`<a href="${loreDeepLink}">📖 Lore</a>`);

  lines.push(``);
  lines.push(`🔗 <b>Links:</b> ${socialBar.join('  •  ')}`);

  if (launch.lore && launch.lore.trim().length > 0) {
    const cleanLore = escapeHtml(launch.lore.trim()).slice(0, 180);
    lines.push(`📖 <b>Lore:</b> <i>"${cleanLore}${launch.lore.length > 180 ? '...' : ''}"</i>`);
  }

  const caption = lines.join('\n');

  // Trading bot deep links (pre-loaded with the token's Contract Address!)
  const maestroStart = settings.maestroRef ? `${ca}-${settings.maestroRef}` : ca;
  const maestroUrl = `https://t.me/maestro?start=${maestroStart}`;

  const sigmaStart = settings.sigmaRef ? `x-${settings.sigmaRef}-${ca}` : `x-${ca}`;
  const sigmaUrl = `https://t.me/Sigma_buyBot?start=${sigmaStart}`;

  let inlineKeyboard = [
    [
      { text: '⚡ Maestro', url: maestroUrl },
      { text: '∑ Sigma Bot', url: sigmaUrl },
    ],
    [
      { text: '📈 DexScreener', url: launch.dexScreenerUrl },
      { text: '📖 Lore', callback_data: `lore:${ca}` },
    ],
  ];

  // If Pangea has distinct CAs on different chains, provide direct chain-specific Maestro trading buttons!
  if (isPangea && !launch.isSameEvmAddress) {
    const chainButtons = [];
    if (launch.ethAddress) {
      const s = settings.maestroRef ? `${launch.ethAddress}-${settings.maestroRef}` : launch.ethAddress;
      chainButtons.push({ text: '⚡ Maestro (ETH)', url: `https://t.me/maestro?start=${s}` });
    }
    if (launch.baseAddress) {
      const s = settings.maestroRef ? `${launch.baseAddress}-${settings.maestroRef}` : launch.baseAddress;
      chainButtons.push({ text: '⚡ Maestro (Base)', url: `https://t.me/maestro?start=${s}` });
    }
    if (launch.bscAddress && chainButtons.length < 2) {
      const s = settings.maestroRef ? `${launch.bscAddress}-${settings.maestroRef}` : launch.bscAddress;
      chainButtons.push({ text: '⚡ Maestro (BSC)', url: `https://t.me/maestro?start=${s}` });
    }

    if (chainButtons.length > 0) {
      inlineKeyboard = [
        chainButtons,
        [
          { text: '∑ Sigma Bot', url: sigmaUrl },
          { text: '📈 DexScreener', url: launch.dexScreenerUrl },
        ],
        [
          { text: '🏛 Pangea App', url: launch.platformUrl },
        ],
      ];
    }
  }

  const replyMarkup = {
    inline_keyboard: inlineKeyboard,
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
