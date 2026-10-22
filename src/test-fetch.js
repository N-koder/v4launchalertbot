const {
  fetchProgrammableEthereum,
  fetchProgrammableRobinhood,
  fetchStockereum,
  fetchSender,
  fetchEtherStreet,
} = require('./fetchers');
const { buildTelegramAlert } = require('./formatter');

async function testAll() {
  console.log('Testing live APIs for all 4 launchpads...\n');

  const [progEth, progRh, stock, sender, etherstreet] = await Promise.all([
    fetchProgrammableEthereum(),
    fetchProgrammableRobinhood(),
    fetchStockereum(),
    fetchSender(),
    fetchEtherStreet(),
  ]);

  console.log(`✅ Programmable (ETH): ${progEth.length} recent launches fetched`);
  if (progEth[0]) {
    console.log(`   Newest: ${progEth[0].name} ($${progEth[0].symbol}) -> CA: ${progEth[0].address}`);
  }

  console.log(`✅ Programmable (Robinhood): ${progRh.length} recent launches fetched`);
  if (progRh[0]) {
    console.log(`   Newest: ${progRh[0].name} ($${progRh[0].symbol}) -> CA: ${progRh[0].address}`);
  }

  console.log(`✅ Stockereum.com: ${stock.length} recent launches fetched`);
  if (stock[0]) {
    console.log(`   Newest: ${stock[0].name} ($${stock[0].symbol}) [${stock[0].category}] -> CA: ${stock[0].address}`);
  }

  console.log(`✅ Sender.family: ${sender.length} recent launches fetched`);
  if (sender[0]) {
    console.log(`   Newest: ${sender[0].name} ($${sender[0].symbol}) -> CA: ${sender[0].address}`);
  }

  console.log(`✅ EtherStreet.fun: ${etherstreet.length} recent launches fetched`);
  if (etherstreet[0]) {
    console.log(`   Newest: ${etherstreet[0].name} ($${etherstreet[0].symbol}) [${etherstreet[0].category}] -> CA: ${etherstreet[0].address}`);
  }

  if (etherstreet[0]) {
    console.log('\n--- SAMPLE ETHERSTREET TELEGRAM ALERT CAPTION ---');
    const preview = buildTelegramAlert(etherstreet[0]);
    console.log(preview.caption);
    console.log('\n--- SAMPLE INLINE BUTTONS ---');
    preview.replyMarkup.inline_keyboard.forEach((row, i) => {
      console.log(`Row ${i + 1}: ` + row.map((b) => `[ ${b.text} ]`).join('  '));
    });
  }
}

testAll().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
