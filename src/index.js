require('dotenv').config();
const alertBot = require('./bot');
const scanner = require('./scanner');
const { startServer } = require('./server');

async function main() {
  console.log('======================================================');
  console.log(' 🚀 Multi-Launchpad Telegram Alert Bot Starting...    ');
  console.log('    1. Programmable.market (ETH & Robinhood Chain)    ');
  console.log('    2. Stockereum.com                                 ');
  console.log('    3. Sender.family                                  ');
  console.log('======================================================');

  const port = Number(process.env.PORT) || 3080;
  const pollInterval = Number(process.env.POLL_INTERVAL_SECONDS) || 2;

  await alertBot.init();
  startServer(port);
  scanner.start(pollInterval);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
