# ISell Store — Complete Telegram Selling Marketplace

A database-backed, single-bot Telegram digital marketplace built from scratch with Node.js and designed specifically for **Vercel Serverless Functions** and **MySQL**.

---

## 1. System Requirements & Stack
- **Runtime:** Node.js 18+ (ES Modules)
- **Deployment Platform:** Vercel Serverless Functions
- **Database:** MySQL 8.0+ (PlanetScale, Aiven, Railway, TiDB, AWS RDS, etc.)
- **Telegram Bot API:** HTTPS Webhook mode (no long-running polling daemon)

---

## 2. Environment Variables Setup

Create a `.env` file locally or configure these inside your **Vercel Project Settings > Environment Variables**:

| Variable | Description | Example |
| :--- | :--- | :--- |
| `BOT_TOKEN` | Telegram Bot Token from `@BotFather` | `123456789:ABCdefGhIJKlmNo...` |
| `ADMIN_ID` | Telegram numeric ID of store owner | `7695407294` |
| `DATABASE_URL` | Cloud MySQL connection string | `mysql://user:pass@host:3306/db?ssl={"rejectUnauthorized":true}` |
| `BINANCE_ID` | Binance Pay ID for manual transfers | `898551245` |
| `USDT_BEP20_ADDRESS` | BSC BEP20 USDT wallet address | `0xa271f85cc7340aceec7d3f7711feae8925bd50fb` |
| `SUPPORT_USERNAME` | Support Telegram handle | `@ezrani` |
| `STORE_NAME` | Display name of the store | `ISell Store` |
| `WEBHOOK_SECRET` | Optional random secret string | `4d2c88f71295b9c1` |

---

## 3. Database Initialization

The database schema and initial catalog of 45 products are created **automatically** on the very first execution (`CREATE TABLE IF NOT EXISTS` and `INSERT IGNORE`). 

- **Catalog Products Initial State:** All seeded products start with **0 stock** (`❌ OUT OF STOCK`).
- **No Fake Stock:** A product only becomes purchasable when the Administrator creates an active plan and uploads inventory.
- **Financial Precision:** All wallet balances and transactions use `DECIMAL(12, 2)` to eliminate JavaScript floating-point errors.

---

## 4. Vercel Deployment Instructions

### Step 1: Install Dependencies
```bash
npm install