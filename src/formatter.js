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
 * Build the HTML message body and inline_keyboard for Telegram
 */
function buildTelegramAlert(launch, settings = {}) {
  const ca = launch.address;
  const name = escapeHtml(launch.name || 'Unknown');
  const symbol = escapeHtml(launch.symbol || '???');
  const platformName = escapeHtml(launch.platformName || 'Launchpad');
  const badge = escapeHtml(launch.platformBadge || '🚀 NEW LAUNCH');
  const chainName = escapeHtml(launch.chainName || 'Ethereum Mainnet');

  const lines = [];
  lines.push(`<b>${badge} — NEW TOKEN LAUNCH!</b>`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`🪙 <b>Token:</b> ${name} (<b>$${symbol}</b>)`);
  lines.push(`🏛 <b>Platform:</b> <a href="${launch.platformUrl}">${platformName}</a>`);
  lines.push(`⛓ <b>Chain:</b> ${chainName}`);
  lines.push(``);
  lines.push(`📋 <b>Contract Address (Tap to Copy):</b>`);
  lines.push(`<code>${ca}</code>`);
  lines.push(``);
  lines.push(`📊 <b>Launch Details:</b>`);
  lines.push(`├ 🧩 <b>Type / Pair:</b> ${escapeHtml(launch.category || launch.quoteSymbol || 'ETH')}`);

  if (launch.marketCapUsd !== null && launch.marketCapUsd !== undefined && Number(launch.marketCapUsd) > 0) {
    const chg =
      launch.priceChange5m !== undefined && launch.priceChange5m !== null
        ? ` (${launch.priceChange5m >= 0 ? '🟢 +' : '🔴 '}${launch.priceChange5m}%)`
        : '';
    lines.push(`├ 💰 <b>Market Cap:</b> ${formatUsd(launch.marketCapUsd)}${chg}`);
  } else {
    lines.push(`├ 💰 <b>Market Cap:</b> Indexing...`);
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
    lines.push(`├ 📊 <b>Live Volume (24h):</b> ${volParts.join(' • ')}`);
  } else {
    lines.push(`├ 📊 <b>Live Volume (24h):</b> $0.00 (Fresh Launch)`);
  }

  if (launch.buys !== undefined && launch.sells !== undefined && (launch.buys > 0 || launch.sells > 0)) {
    lines.push(`├ 🔄 <b>Transactions:</b> 🟢 ${launch.buys} Buys  |  🔴 ${launch.sells} Sells`);
  } else if (launch.trades && Number(launch.trades) > 0) {
    lines.push(`├ 🔄 <b>Transactions:</b> ${launch.trades} Trades`);
  }

  if (launch.poolQuoteEth !== null && launch.poolQuoteEth !== undefined && Number(launch.poolQuoteEth) > 0) {
    const liqUsdStr = launch.liquidityUsd ? ` (${formatUsd(launch.liquidityUsd)})` : '';
    lines.push(
      `├ 💧 <b>Pool Liquidity:</b> ${Number(launch.poolQuoteEth).toFixed(3)} ${escapeHtml(
        launch.quoteSymbol || 'ETH'
      )}${liqUsdStr}`
    );
  } else if (launch.liquidityUsd) {
    lines.push(`├ 💧 <b>Pool Liquidity:</b> ${formatUsd(launch.liquidityUsd)}`);
  }
  if (launch.hookAddress) {
    lines.push(
      `├ 🪝 <b>Uni v4 Hook:</b> <a href="https://etherscan.io/address/${launch.hookAddress}">${shortAddr(
        launch.hookAddress
      )}</a>`
    );
  }
  if (launch.creator) {
    lines.push(
      `├ 👤 <b>Creator:</b> <a href="https://etherscan.io/address/${launch.creator}">${shortAddr(
        launch.creator
      )}</a>`
    );
  }
  if (launch.blockNumber) {
    lines.push(`├ 🧱 <b>Block:</b> #${escapeHtml(String(launch.blockNumber))}`);
  }

  const launchedTime = launch.launchedAtMs
    ? new Date(launch.launchedAtMs).toUTCString().replace('GMT', 'UTC')
    : 'Just now';
  lines.push(`└ 🕒 <b>Launched:</b> ${escapeHtml(launchedTime)}`);

  if (launch.description) {
    const cleanBio = escapeHtml(launch.description).slice(0, 220);
    lines.push(``);
    lines.push(`📝 <i>${cleanBio}${launch.description.length > 220 ? '...' : ''}</i>`);
  }

  // Social links if present
  const socialLinks = [];
  if (launch.socials?.website) {
    socialLinks.push(`<a href="${escapeHtml(launch.socials.website)}">🌐 Website</a>`);
  }
  if (launch.socials?.twitter) {
    const tw = launch.socials.twitter.startsWith('http')
      ? launch.socials.twitter
      : `https://x.com/${launch.socials.twitter.replace(/^@/, '')}`;
    socialLinks.push(`<a href="${escapeHtml(tw)}">🐦 X / Twitter</a>`);
  }
  if (launch.socials?.telegram) {
    const tg = launch.socials.telegram.startsWith('http')
      ? launch.socials.telegram
      : `https://t.me/${launch.socials.telegram.replace(/^@/, '')}`;
    socialLinks.push(`<a href="${escapeHtml(tg)}">✈️ Telegram</a>`);
  }
  if (socialLinks.length > 0) {
    lines.push(``);
    lines.push(`🔗 <b>Socials:</b> ${socialLinks.join('  |  ')}`);
  }

  const caption = lines.join('\n');

  // Trading bot deep links (pre-loaded with the token's Contract Address!)
  const maestroStart = settings.maestroRef ? `${ca}-${settings.maestroRef}` : ca;
  const maestroUrl = `https://t.me/maestro?start=${maestroStart}`;

  const sigmaStart = settings.sigmaRef ? `x-${settings.sigmaRef}-${ca}` : `x-${ca}`;
  const sigmaUrl = `https://t.me/Sigma_buyBot?start=${sigmaStart}`;

  const replyMarkup = {
    inline_keyboard: [
      [
        { text: '⚡ Maestro', url: maestroUrl },
        { text: '∑ Sigma Bot', url: sigmaUrl },
      ],
      [
        { text: '📈 DexScreener', url: launch.dexScreenerUrl },
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
  shortAddr,
  formatUsd,
};
