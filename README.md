# 🚀 Multi-Launchpad Telegram Alert Bot & Live Dashboard

Real-time token launch detector and Telegram Channel Alert Bot for:
1. **🟣 Programmable.market** (`https://programmable.market/explore` — Ethereum & Robinhood Chain V4)
2. **🟢 Stockereum.com** (`https://stockereum.com/` — RWA Stock, Meme & Crypto Pairs)
3. **🔵 Sender.family** (`https://sender.family/` — Fixed-supply Uniswap v4 Locked Markets)

---

## ✨ Features

- **Instant Platform Identification**: Every alert clearly badges which platform launched the token (`🟣 PROGRAMMABLE`, `🟢 STOCKEREUM`, or `🔵 SENDER.FAMILY`) with direct links to the platform page.
- **1-Tap Copiable Contract Address (`CA`)**: Formatted in Telegram `<code>` blocks so mobile & desktop users copy the CA in a single tap.
- **1-Click Trading Bot Deep-Links**: Pre-loads the token's Contract Address directly into:
  - ⚡ **Maestro** (`t.me/maestro?start=...`)
  - 🍌 **Banana Gun** (`t.me/BananaGunSniper_bot?start=snp_...`)
  - ∑ **Sigma Bot** (`t.me/Sigma_buyBot?start=x-...`)
  - 🤖 **Unibot**, 🐂 **BullX**, and 🦄 **Uniswap**
  - 📈 **DexScreener**, 📊 **DexTools**, 🔍 **Etherscan**
  - 📤 **1-Click Share Alert Button** (`t.me/share/url`)
- **Built-in Live Web Dashboard & Telegram Alert Simulator** (`http://localhost:3080`):
  - Preview the exact Telegram message & buttons in real time
  - Filter live launches across all 3 platforms
  - Configure your Telegram Channel ID and Bot Referral codes in 1 click

---

## 🛠️ Quick Setup

### 1. Install Dependencies
```bash
cd C:\Users\webwo\Desktop\Codevault\telegram\launch_Alert_bot
npm install
```

### 2. Configure Your Telegram Bot (`.env`)
Open [`.env`](file:///C:/Users/webwo/Desktop/Codevault/telegram/launch_Alert_bot/.env) and add:
```env
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
TELEGRAM_CHANNEL_ID=@your_channel_username_or_id
```
*(Make sure your Bot is added as an **Administrator** in your Telegram Channel with permission to Post Messages!)*

### 3. Start the Bot + Web Interface
```bash
npm start
```
Then open **http://localhost:3080** in your browser to view the Live Launch Feed & Interactive Telegram Alert Preview!

---

## 🤖 Telegram Admin Commands
Send these commands to your bot in Telegram:
- `/start` — Show help menu
- `/status` — Check scanner status & total alerts sent per launchpad
- `/latest` — Preview the newest detected launch in your DM
- `/test` — Push a test launch alert to your configured Telegram channel
- `/setchannel @your_channel` — Change the target Telegram channel on the fly
- `/setref maestro YOUR_REF` — Set your referral code for Maestro, BananaGun (`banana`), or Sigma (`sigma`)
