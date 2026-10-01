// ============================================================================
// ISELL STORE — PREMIUM TELEGRAM SELLING MARKETPLACE
// Optimized for Vercel Serverless & Cloud MySQL (TiDB / PlanetScale / Aiven)
// ============================================================================

import mysql from 'mysql2/promise';

// ============================================================================
// 1. CONFIGURATION & CONSTANTS
// ============================================================================
const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
const ADMIN_ID = Number(process.env.ADMIN_ID || '7695407294');
const STORE_NAME = process.env.STORE_NAME || 'ISell Store';
const SUPPORT_USERNAME = (process.env.SUPPORT_USERNAME || '@ezrani').replace(/^@/, '');
const BINANCE_ID = process.env.BINANCE_ID || '898551245';
const USDT_BEP20_ADDRESS = process.env.USDT_BEP20_ADDRESS || '0xa271f85cc7340aceec7d3f7711feae8925bd50fb';
const DATABASE_URL = process.env.DATABASE_URL || '';

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ============================================================================
// 2. DATABASE POOL (WITH AUTOMATIC RECONNECT & TLS)
// ============================================================================
let pool = null;

function getPool() {
  if (!pool) {
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is missing.');
    }

    const config = {
      waitForConnections: true,
      connectionLimit: 10,
      maxIdle: 5,
      idleTimeout: 30000,
      queueLimit: 0,
      decimalNumbers: true,
      ssl: {
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true
      }
    };

    try {
      const url = new URL(DATABASE_URL);
      config.host = url.hostname;
      config.port = Number(url.port || 4000);
      config.user = decodeURIComponent(url.username);
      config.password = decodeURIComponent(url.password);
      const dbName = url.pathname.replace(/^\//, '');
      config.database = dbName || 'test';
    } catch {
      config.uri = DATABASE_URL;
    }

    pool = mysql.createPool(config);
  }
  return pool;
}

let dbInitialized = false;

async function initDatabase() {
  if (dbInitialized) return;
  const db = getPool();

  const queries = [
    `CREATE TABLE IF NOT EXISTS processed_updates (
      update_id BIGINT PRIMARY KEY,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;`,

    `CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY,
      username VARCHAR(255) NULL,
      first_name VARCHAR(255) NULL,
      last_name VARCHAR(255) NULL,
      is_banned TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;`,

    `CREATE TABLE IF NOT EXISTS wallets (
      user_id BIGINT PRIMARY KEY,
      balance DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT chk_wallet_non_negative CHECK (balance >= 0.00)
    ) ENGINE=InnoDB;`,

    `CREATE TABLE IF NOT EXISTS user_states (
      user_id BIGINT PRIMARY KEY,
      state VARCHAR(100) NOT NULL,
      data JSON NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;`,

    `CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL UNIQUE,
      emoji VARCHAR(16) NOT NULL DEFAULT '📦',
      description TEXT NULL,
      is_active TINYINT(1) DEFAULT 1,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;`,

    `CREATE TABLE IF NOT EXISTS plans (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      name VARCHAR(150) NOT NULL,
      details TEXT NULL,
      price DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
      currency VARCHAR(10) NOT NULL DEFAULT 'USD',
      duration_text VARCHAR(100) NOT NULL DEFAULT '30 Days',
      warranty_text VARCHAR(255) NOT NULL DEFAULT '30 day warranty',
      delivery_type VARCHAR(50) NOT NULL DEFAULT 'MANUAL',
      is_active TINYINT(1) DEFAULT 1,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;`,

    `CREATE TABLE IF NOT EXISTS inventory (
      id INT AUTO_INCREMENT PRIMARY KEY,
      plan_id INT NOT NULL,
      content TEXT NOT NULL,
      item_type VARCHAR(50) NOT NULL DEFAULT 'MANUAL',
      status VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
      order_id BIGINT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
      INDEX idx_plan_status (plan_id, status)
    ) ENGINE=InnoDB;`,

    `CREATE TABLE IF NOT EXISTS orders (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      plan_id INT NOT NULL,
      amount DECIMAL(12, 2) NOT NULL,
      currency VARCHAR(10) NOT NULL DEFAULT 'USD',
      payment_method VARCHAR(50) NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'PENDING_PAYMENT',
      payment_reference VARCHAR(255) NULL,
      telegram_file_id VARCHAR(255) NULL,
      delivery_content TEXT NULL,
      admin_note TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (plan_id) REFERENCES plans(id)
    ) ENGINE=InnoDB;`,

    `CREATE TABLE IF NOT EXISTS deposits (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      amount DECIMAL(12, 2) NOT NULL,
      payment_method VARCHAR(50) NOT NULL,
      transaction_ref VARCHAR(255) NULL,
      telegram_file_id VARCHAR(255) NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
      admin_id BIGINT NULL,
      admin_note VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB;`,

    `CREATE TABLE IF NOT EXISTS wallet_transactions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      type VARCHAR(50) NOT NULL,
      amount DECIMAL(12, 2) NOT NULL,
      balance_after DECIMAL(12, 2) NOT NULL,
      reference_id VARCHAR(100) NULL,
      description VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB;`,

    `CREATE TABLE IF NOT EXISTS notification_subscriptions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT NOT NULL,
      product_id INT NOT NULL,
      plan_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user_plan_notif (user_id, plan_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;`,

    `CREATE TABLE IF NOT EXISTS admin_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      admin_id BIGINT NOT NULL,
      action VARCHAR(100) NOT NULL,
      details TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;`
  ];

  for (const q of queries) {
    await db.query(q);
  }

  dbInitialized = true;
}

// Reset store products and plans (Called on-demand or manually)
async function wipeStoreData() {
  const db = getPool();
  try {
    await db.query('SET FOREIGN_KEY_CHECKS = 0');
    await db.query('TRUNCATE TABLE inventory');
    await db.query('TRUNCATE TABLE plans');
    await db.query('TRUNCATE TABLE products');
    await db.query('SET FOREIGN_KEY_CHECKS = 1');
  } catch (e) {
    console.error('Wipe error:', e.message);
  }
}

// ============================================================================
// 3. TELEGRAM BOT API UTILITIES
// ============================================================================
async function callTelegram(method, payload = {}) {
  try {
    const res = await fetch(`${TELEGRAM_API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`Telegram API error [${method}]:`, data.description);
    }
    return data;
  } catch (err) {
    console.error(`Fetch error [${method}]:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendMessage(chatId, text, replyMarkup = null, parseMode = 'HTML') {
  const payload = { chat_id: chatId, text, parse_mode: parseMode };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return await callTelegram('sendMessage', payload);
}

async function editMessageText(chatId, messageId, text, replyMarkup = null, parseMode = 'HTML') {
  const payload = { chat_id: chatId, message_id: messageId, text, parse_mode: parseMode };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return await callTelegram('editMessageText', payload);
}

async function answerCallbackQuery(callbackQueryId, text = null, showAlert = false) {
  const payload = { callback_query_id: callbackQueryId };
  if (text) {
    payload.text = text;
    payload.show_alert = showAlert;
  }
  return await callTelegram('answerCallbackQuery', payload);
}

async function sendPhoto(chatId, fileId, caption = '', replyMarkup = null) {
  const payload = { chat_id: chatId, photo: fileId, caption, parse_mode: 'HTML' };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  return await callTelegram('sendPhoto', payload);
}

// In-Memory Stream Delivery for Credentials (.txt)
async function sendCredentialsFile(chatId, filename, textContent, caption = '') {
  try {
    const formData = new FormData();
    formData.append('chat_id', String(chatId));
    formData.append('caption', caption);
    formData.append('parse_mode', 'HTML');

    const fileBlob = new Blob([textContent], { type: 'text/plain' });
    formData.append('document', fileBlob, filename);

    const res = await fetch(`${TELEGRAM_API}/sendDocument`, {
      method: 'POST',
      body: formData
    });
    return await res.json();
  } catch (err) {
    console.error('sendCredentialsFile error:', err);
    return { ok: false };
  }
}

// ============================================================================
// 4. USER & WALLET SYSTEM
// ============================================================================
async function syncUser(user) {
  const db = getPool();
  await db.query(
    `INSERT INTO users (id, username, first_name, last_name)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       username = VALUES(username),
       first_name = VALUES(first_name),
       last_name = VALUES(last_name)`,
    [user.id, user.username || null, user.first_name || null, user.last_name || null]
  );
  await db.query(`INSERT IGNORE INTO wallets (user_id, balance) VALUES (?, 0.00)`, [user.id]);
}

async function getWalletBalance(userId) {
  const db = getPool();
  const [rows] = await db.query('SELECT balance FROM wallets WHERE user_id = ?', [userId]);
  if (rows.length === 0) {
    await db.query('INSERT IGNORE INTO wallets (user_id, balance) VALUES (?, 0.00)', [userId]);
    return '0.00';
  }
  return Number(rows[0].balance).toFixed(2);
}

async function logAdminAction(adminId, action, details) {
  const db = getPool();
  await db.query(
    'INSERT INTO admin_logs (admin_id, action, details) VALUES (?, ?, ?)',
    [adminId, action, typeof details === 'object' ? JSON.stringify(details) : String(details)]
  );
}

async function setUserState(userId, state, data = {}) {
  const db = getPool();
  await db.query(
    `INSERT INTO user_states (user_id, state, data)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE state = VALUES(state), data = VALUES(data)`,
    [userId, state, JSON.stringify(data)]
  );
}

async function getUserState(userId) {
  const db = getPool();
  const [rows] = await db.query('SELECT state, data FROM user_states WHERE user_id = ?', [userId]);
  if (rows.length === 0) return { state: null, data: {} };
  return {
    state: rows[0].state,
    data: typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : (rows[0].data || {})
  };
}

async function clearUserState(userId) {
  const db = getPool();
  await db.query('DELETE FROM user_states WHERE user_id = ?', [userId]);
}

// ============================================================================
// 5. NAVIGATION KEYBOARDS
// ============================================================================
function getCustomerMainMenuKeyboard(userId) {
  const buttons = [
    [{ text: '📁 Browse Categories / Store', callback_data: 'store_page:0' }],
    [{ text: '💰 My Wallet', callback_data: 'wallet_main' }, { text: '📦 My Orders', callback_data: 'my_orders:0' }],
    [{ text: '👤 Profile', callback_data: 'user_profile' }, { text: '🔎 Search', callback_data: 'store_search' }],
    [{ text: '📞 Support', callback_data: 'store_support' }, { text: 'ℹ️ FAQ & Help', callback_data: 'store_help' }]
  ];
  if (Number(userId) === ADMIN_ID) {
    buttons.push([{ text: '⚙️ Admin Panel', callback_data: 'admin_dashboard' }]);
  }
  return { inline_keyboard: buttons };
}

function getAdminPanelKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '📊 Dashboard Overview', callback_data: 'admin_dashboard' }, { text: '🛍 Products & Plans', callback_data: 'admin_products:0' }],
      [{ text: '➕ Add Product', callback_data: 'adm_prod_add_start' }, { text: '📦 Stock Warehouse', callback_data: 'admin_stock_list:0' }],
      [{ text: '💳 Pending Payments', callback_data: 'admin_payments:0' }, { text: '💰 Pending Deposits', callback_data: 'admin_deposits:0' }],
      [{ text: '📢 Send Broadcast', callback_data: 'admin_broadcast_prompt' }, { text: '🗑 Wipe Store Clean', callback_data: 'adm_wipe_confirm' }],
      [{ text: '🛍 Open Customer View', callback_data: 'store_page:0' }],
      [{ text: '🏠 Home', callback_data: 'main_home' }]
    ]
  };
}

// ============================================================================
// 6. EXPANDED CATEGORY LAYOUT (LARGE VIEW: 50 ITEMS, FULL BLUE/RED COLOR BLOCKS)
// ============================================================================
async function renderStorePage(chatId, messageId = null, page = 0) {
  const db = getPool();
  const PAGE_SIZE = 50; // Large layout so all products appear together without pagination
  const offset = page * PAGE_SIZE;

  // Real-time calculated available inventory count per product
  const [products] = await db.query(
    `SELECT p.id, p.name, p.emoji,
      (SELECT COUNT(i.id) 
       FROM inventory i 
       JOIN plans pl ON i.plan_id = pl.id 
       WHERE pl.product_id = p.id 
         AND pl.is_active = 1 
         AND UPPER(i.status) = 'AVAILABLE') AS stock_count
     FROM products p
     WHERE p.is_active = 1
     ORDER BY p.sort_order ASC, p.id ASC
     LIMIT ? OFFSET ?`,
    [PAGE_SIZE, offset]
  );

  const [totalRow] = await db.query('SELECT COUNT(*) as count FROM products WHERE is_active = 1');
  const totalProducts = totalRow[0]?.count || 0;
  const totalPages = Math.ceil(totalProducts / PAGE_SIZE) || 1;

  if (totalProducts === 0) {
    const emptyText =
      `📁 <b>Categories</b>\n\n` +
      `<i>The store is currently empty.</i>\n\n` +
      (Number(chatId) === ADMIN_ID ? `👉 <b>Admin:</b> Click <b>➕ Add First Product</b> below to start!` : `Please check back shortly!`);

    const emptyKeyboard = {
      inline_keyboard: [
        Number(chatId) === ADMIN_ID ? [{ text: '➕ Add First Product', callback_data: 'adm_prod_add_start' }] : [],
        [{ text: '🏠 Home', callback_data: 'main_home' }]
      ].filter(r => r.length > 0)
    };

    if (messageId) {
      await editMessageText(chatId, messageId, emptyText, emptyKeyboard);
    } else {
      await sendMessage(chatId, emptyText, emptyKeyboard);
    }
    return;
  }

  // 2-Column Grid with Full-Width Color Blocks
  const inlineGrid = [];
  let currentRow = [];

  for (const item of products) {
    const stock = Number(item.stock_count || 0);
    const hasStock = stock > 0;

    // Full Blue Block for In-Stock; Full Red Block for Out-of-Stock
    const label = hasStock
      ? `🟦 ${item.emoji} ${item.name} (${stock}) 🟦`
      : `🟥 ${item.emoji} ${item.name} (Sold Out) 🟥`;

    currentRow.push({
      text: label,
      callback_data: `view_prod:${item.id}:${page}`
    });

    if (currentRow.length === 2) {
      inlineGrid.push(currentRow);
      currentRow = [];
    }
  }
  if (currentRow.length > 0) {
    inlineGrid.push(currentRow);
  }

  // Navigation rows (only shown if exceeding 50 products)
  const navRow = [];
  if (page > 0) navRow.push({ text: '◀️ Prev', callback_data: `store_page:${page - 1}` });
  if (totalPages > 1) navRow.push({ text: `Page ${page + 1}/${totalPages}`, callback_data: `store_page:${page}` });
  if (page + 1 < totalPages) navRow.push({ text: 'Next ▶️', callback_data: `store_page:${page + 1}` });
  if (navRow.length > 0) inlineGrid.push(navRow);

  inlineGrid.push([
    { text: '🔎 Search', callback_data: 'store_search' },
    { text: '💰 Wallet', callback_data: 'wallet_main' },
    { text: '🏠 Home', callback_data: 'main_home' }
  ]);

  const text =
    `📁 <b>Categories</b>\n\n` +
    `<i>Pick a product below to view available packages:</i>\n\n` +
    `🟦 <b>Blue</b> = In Stock & Ready for Instant Delivery\n` +
    `🟥 <b>Red</b> = Out of Stock`;

  const keyboard = { inline_keyboard: inlineGrid };

  if (messageId) {
    await editMessageText(chatId, messageId, text, keyboard);
  } else {
    await sendMessage(chatId, text, keyboard);
  }
}

// ============================================================================
// 7. PRODUCT PLANS UI (FULL GREEN FOR AVAILABLE | FULL RED FOR SOLD OUT)
// ============================================================================
async function renderProductPlans(chatId, messageId, productId, returnPage = 0) {
  const db = getPool();
  const [prods] = await db.query('SELECT * FROM products WHERE id = ?', [productId]);
  if (prods.length === 0) {
    await editMessageText(chatId, messageId, '❌ Product not found.', {
      inline_keyboard: [[{ text: '👈 Back', callback_data: `store_page:${returnPage}` }]]
    });
    return;
  }
  const prod = prods[0];

  // Live stock evaluation per plan
  const [plans] = await db.query(
    `SELECT pl.*, 
      (SELECT COUNT(i.id) 
       FROM inventory i 
       WHERE i.plan_id = pl.id 
         AND UPPER(i.status) = 'AVAILABLE') AS available_stock
     FROM plans pl
     WHERE pl.product_id = ? AND pl.is_active = 1
     ORDER BY pl.sort_order ASC, pl.id ASC`,
    [productId]
  );

  const totalAvailableStock = plans.reduce((acc, p) => acc + Number(p.available_stock || 0), 0);
  const isInStock = totalAvailableStock > 0;

  let msg = `<b>${prod.emoji} ${prod.name}</b>\n`;
  if (isInStock) {
    msg += `<b>❝ ${prod.name} Subscriptions Are In Stock 🔥 ❞</b>\n\n`;
  } else {
    msg += `<b>❝ Currently Sold Out ⏳ Check back soon! ❞</b>\n\n`;
  }

  msg += `<i>Tap an active green option to see details:</i>`;

  const keyboard = [];
  if (plans.length === 0) {
    msg += `\n\n❌ <i>No plans added yet for this product.</i>`;
  } else {
    for (const pl of plans) {
      const stock = Number(pl.available_stock || 0);
      if (stock > 0) {
        // Full Green Banner for in-stock plan
        const label = `🟩 ${pl.name} | $${Number(pl.price).toFixed(2)} | ${stock} Avail 🟩`;
        keyboard.push([{ text: label, callback_data: `view_plan:${pl.id}:${returnPage}` }]);
      } else {
        // Full Red Banner for sold out plan
        const label = `🟥 ${pl.name} | $${Number(pl.price).toFixed(2)} | Sold Out 🟥`;
        keyboard.push([{ text: label, callback_data: `view_plan:${pl.id}:${returnPage}` }]);
      }
    }
  }

  keyboard.push([
    { text: '👈 Back', callback_data: `store_page:${returnPage}` },
    { text: '🏠 Home', callback_data: 'main_home' }
  ]);

  await editMessageText(chatId, messageId, msg, { inline_keyboard: keyboard });
}

// ============================================================================
// 8. PLAN DETAILS & ATOMIC PURCHASE WITH AUTOMATIC STOCK DECREMENT
// ============================================================================
async function renderPlanDetails(chatId, messageId, planId, returnPage = 0, userId = null) {
  const db = getPool();
  const [plans] = await db.query(
    `SELECT pl.*, p.name as product_name, p.emoji as product_emoji,
      (SELECT COUNT(i.id) FROM inventory i WHERE i.plan_id = pl.id AND UPPER(i.status) = 'AVAILABLE') as available_stock
     FROM plans pl
     JOIN products p ON pl.product_id = p.id
     WHERE pl.id = ?`,
    [planId]
  );

  if (plans.length === 0) {
    await editMessageText(chatId, messageId, '❌ Plan not found.', {
      inline_keyboard: [[{ text: '👈 Back', callback_data: `store_page:${returnPage}` }]]
    });
    return;
  }
  const pl = plans[0];
  const stock = Number(pl.available_stock || 0);
  const inStock = stock > 0;

  let msg =
    `<b>${pl.product_emoji} ${pl.product_name} — ${pl.name}</b>\n\n` +
    `📋 <b>DETAILS:</b>\n` +
    `${pl.details || 'Instant digital fulfillment upon purchase.'}\n\n` +
    `💵 <b>Price:</b> $${Number(pl.price).toFixed(2)} ${pl.currency}\n` +
    `⏱️ <b>Duration:</b> ${pl.duration_text}\n` +
    `🛡️ <b>Warranty:</b> ${pl.warranty_text}\n` +
    `📦 <b>Stock:</b> ${inStock ? `🟩 ${stock} Available` : '🟥 Sold Out'}\n`;

  const buttons = [];
  if (inStock) {
    buttons.push([{ text: '🛒 BUY NOW', callback_data: `order_prep:${pl.id}:${returnPage}` }]);
  } else {
    buttons.push([{ text: '🔔 Notify Me On Restock', callback_data: `notif_sub:${pl.id}:${returnPage}` }]);
  }

  buttons.push([
    { text: '👈 Back', callback_data: `view_prod:${pl.product_id}:${returnPage}` },
    { text: '🏠 Home', callback_data: 'main_home' }
  ]);

  await editMessageText(chatId, messageId, msg, { inline_keyboard: buttons });
}

async function renderOrderCheckout(chatId, messageId, planId, returnPage, userId) {
  const db = getPool();
  const [plans] = await db.query(
    `SELECT pl.*, p.name as product_name, p.emoji as product_emoji,
      (SELECT COUNT(i.id) FROM inventory i WHERE i.plan_id = pl.id AND UPPER(i.status) = 'AVAILABLE') as stock_count
     FROM plans pl
     JOIN products p ON pl.product_id = p.id
     WHERE pl.id = ? AND pl.is_active = 1`,
    [planId]
  );

  if (plans.length === 0 || Number(plans[0].stock_count || 0) <= 0) {
    await editMessageText(chatId, messageId, '❌ Sorry, this item is sold out or unavailable.', {
      inline_keyboard: [[{ text: '👈 Back', callback_data: `view_prod:${plans[0]?.product_id || 1}:${returnPage}` }]]
    });
    return;
  }

  const pl = plans[0];
  const walletBal = await getWalletBalance(userId);
  const cost = Number(pl.price).toFixed(2);

  const msg =
    `💳 <b>CHECKOUT & PAYMENT</b>\n\n` +
    `Item: <b>${pl.product_emoji} ${pl.product_name} (${pl.name})</b>\n` +
    `Duration: <b>${pl.duration_text}</b>\n` +
    `Warranty: <b>${pl.warranty_text}</b>\n\n` +
    `💰 <b>Your Wallet Balance:</b> $${walletBal}\n` +
    `💵 <b>Order Total:</b> $${cost}\n\n` +
    `Select your payment method below:`;

  const buttons = [];
  buttons.push([{ text: `💰 Pay From Wallet ($${walletBal})`, callback_data: `pay_wallet:${pl.id}` }]);
  buttons.push([
    { text: '🟡 Binance Pay', callback_data: `pay_manual:Binance:${pl.id}` },
    { text: '₮ USDT BEP20', callback_data: `pay_manual:USDT_BEP20:${pl.id}` }
  ]);
  buttons.push([{ text: '👈 Cancel & Back', callback_data: `view_plan:${pl.id}:${returnPage}` }]);

  await editMessageText(chatId, messageId, msg, { inline_keyboard: buttons });
}

// ATOMIC WALLET PURCHASE & IMMEDIATE LIVE STOCK DECREMENT
async function executeWalletPurchase(chatId, messageId, planId, userId) {
  const pool = getPool();
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // 1. Lock user's wallet
    const [wallets] = await conn.query('SELECT balance FROM wallets WHERE user_id = ? FOR UPDATE', [userId]);
    if (wallets.length === 0) {
      await conn.rollback();
      return await editMessageText(chatId, messageId, '❌ Wallet not found.');
    }
    const currentBalance = Number(wallets[0].balance);

    // 2. Lock plan
    const [plans] = await conn.query(
      `SELECT pl.*, p.name as product_name, p.emoji as product_emoji 
       FROM plans pl 
       JOIN products p ON pl.product_id = p.id 
       WHERE pl.id = ? AND pl.is_active = 1`,
      [planId]
    );
    if (plans.length === 0) {
      await conn.rollback();
      return await editMessageText(chatId, messageId, '❌ Plan unavailable.');
    }
    const pl = plans[0];
    const orderCost = Number(pl.price);

    if (currentBalance < orderCost) {
      await conn.rollback();
      const needed = (orderCost - currentBalance).toFixed(2);
      return await editMessageText(
        chatId,
        messageId,
        `❌ <b>INSUFFICIENT BALANCE</b>\n\n` +
        `Wallet Balance: $${currentBalance.toFixed(2)}\n` +
        `Required Total: $${orderCost.toFixed(2)}\n` +
        `You need: <b>$${needed}</b> more.\n\n` +
        `Please top up your wallet balance first.`,
        {
          inline_keyboard: [
            [{ text: '➕ Top Up Wallet', callback_data: 'wallet_deposit' }],
            [{ text: '👈 Back', callback_data: 'store_page:0' }]
          ]
        }
      );
    }

    // 3. Atomically Lock 1 Available Inventory Item
    const [invRows] = await conn.query(
      `SELECT id, content FROM inventory 
       WHERE plan_id = ? AND UPPER(status) = 'AVAILABLE' 
       LIMIT 1 FOR UPDATE`,
      [planId]
    );

    if (invRows.length === 0) {
      await conn.rollback();
      return await editMessageText(
        chatId,
        messageId,
        '❌ <b>OUT OF STOCK</b>\n\nSorry, someone just bought the last available stock item!',
        { inline_keyboard: [[{ text: '👈 Back to Store', callback_data: 'store_page:0' }]] }
      );
    }

    const selectedInv = invRows[0];
    const newBalance = (currentBalance - orderCost).toFixed(2);

    // 4. Deduct wallet balance
    await conn.query('UPDATE wallets SET balance = balance - ? WHERE user_id = ?', [orderCost, userId]);

    // 5. Create Completed Order Record
    const [orderRes] = await conn.query(
      `INSERT INTO orders (user_id, plan_id, amount, payment_method, status, delivery_content)
       VALUES (?, ?, ?, 'WALLET', 'DELIVERED', ?)`,
      [userId, planId, orderCost, selectedInv.content]
    );
    const orderId = orderRes.insertId;

    // 6. IMMEDIATELY update inventory status to SOLD
    await conn.query(`UPDATE inventory SET status = 'SOLD', order_id = ? WHERE id = ?`, [orderId, selectedInv.id]);

    // 7. Record transaction in wallet history
    await conn.query(
      `INSERT INTO wallet_transactions (user_id, type, amount, balance_after, reference_id, description)
       VALUES (?, 'PURCHASE', ?, ?, ?, ?)`,
      [userId, orderCost, newBalance, `ORD#${orderId}`, `${pl.product_emoji} ${pl.product_name} - ${pl.name}`]
    );

    await conn.commit();

    // 8. Deliver credentials as formatted Text
    const successMsg =
      `🎉 <b>ORDER COMPLETED & DELIVERED!</b>\n\n` +
      `Order: <b>#ORD${orderId}</b>\n` +
      `Product: <b>${pl.product_emoji} ${pl.product_name} (${pl.name})</b>\n` +
      `Warranty: <b>${pl.warranty_text}</b>\n` +
      `Total Paid: <b>$${orderCost.toFixed(2)}</b> (from Wallet)\n` +
      `Remaining Balance: <b>$${newBalance}</b>\n\n` +
      `📦 <b>CREDENTIALS (TEXT FORM):</b>\n` +
      `<code>${selectedInv.content}</code>\n\n` +
      `<i>A backup .txt file with these credentials has also been attached below!</i>`;

    await editMessageText(chatId, messageId, successMsg, {
      inline_keyboard: [
        [{ text: '📦 View in My Orders', callback_data: `view_order:${orderId}` }],
        [{ text: '🛍 Continue Shopping', callback_data: 'store_page:0' }]
      ]
    });

    // 9. Deliver credentials as Downloadable .txt Document
    const fileHeader =
      `============================================================\n` +
      `${STORE_NAME} - OFFICIAL ORDER DELIVERY\n` +
      `============================================================\n` +
      `Order ID: #ORD${orderId}\n` +
      `Product:  ${pl.product_name} (${pl.name})\n` +
      `Warranty: ${pl.warranty_text}\n` +
      `Date:     ${new Date().toISOString()}\n` +
      `------------------------------------------------------------\n` +
      `ACCESS CREDENTIALS / LICENSE:\n\n` +
      `${selectedInv.content}\n` +
      `------------------------------------------------------------\n` +
      `Support: @${SUPPORT_USERNAME}\n` +
      `============================================================\n`;

    await sendCredentialsFile(
      chatId,
      `order_ORD${orderId}_credentials.txt`,
      fileHeader,
      `📁 <b>Order #ORD${orderId} Backup File Attached.</b>`
    );

    sendMessage(
      ADMIN_ID,
      `🛍 <b>NEW STORE PURCHASE</b>\n\n` +
      `Order: #ORD${orderId}\n` +
      `User: <a href="tg://user?id=${userId}">${userId}</a>\n` +
      `Item: ${pl.product_name} - ${pl.name}\n` +
      `Amount: $${orderCost.toFixed(2)} (Wallet)`
    );

  } catch (err) {
    await conn.rollback();
    console.error('Wallet purchase rollback error:', err);
    await editMessageText(chatId, messageId, '❌ An error occurred during transaction. Balance unchanged.');
  } finally {
    conn.release();
  }
}

// ============================================================================
// 9. MANUAL ORDER PAYMENT
// ============================================================================
async function initiateManualOrderPayment(chatId, messageId, method, planId, userId) {
  const db = getPool();
  const [plans] = await db.query(
    `SELECT pl.*, p.name as product_name, p.emoji as product_emoji 
     FROM plans pl 
     JOIN products p ON pl.product_id = p.id 
     WHERE pl.id = ? AND pl.is_active = 1`,
    [planId]
  );
  if (plans.length === 0) {
    return editMessageText(chatId, messageId, '❌ Plan unavailable.');
  }
  const pl = plans[0];

  const [res] = await db.query(
    `INSERT INTO orders (user_id, plan_id, amount, payment_method, status)
     VALUES (?, ?, ?, ?, 'PENDING_PAYMENT')`,
    [userId, planId, pl.price, method]
  );
  const orderId = res.insertId;

  let payInfo = '';
  if (method === 'Binance') {
    payInfo =
      `🟡 <b>BINANCE PAY INSTRUCTIONS:</b>\n\n` +
      `Binance Pay ID: <code>${BINANCE_ID}</code>\n` +
      `Recipient: <b>${STORE_NAME}</b>\n` +
      `Exact Amount: <b>$${Number(pl.price).toFixed(2)} USD</b>`;
  } else {
    payInfo =
      `₮ <b>USDT BEP20 (BNB Smart Chain) INSTRUCTIONS:</b>\n\n` +
      `Address: <code>${USDT_BEP20_ADDRESS}</code>\n` +
      `Network: <b>BEP20 (BSC)</b>\n` +
      `Exact Amount: <b>$${Number(pl.price).toFixed(2)} USDT</b>`;
  }

  const promptMsg =
    `🧾 <b>ORDER #ORD${orderId}</b>\n\n` +
    `Product: <b>${pl.product_emoji} ${pl.product_name} (${pl.name})</b>\n` +
    `Amount Due: <b>$${Number(pl.price).toFixed(2)}</b>\n\n` +
    `${payInfo}\n\n` +
    `⚠️ <b>NEXT STEPS:</b>\n` +
    `1. Send the exact amount above.\n` +
    `2. Click <b>"I Have Paid"</b> below.\n` +
    `3. Send your Transaction Hash/ID or a Payment Screenshot.`;

  await editMessageText(chatId, messageId, promptMsg, {
    inline_keyboard: [
      [{ text: '✅ I Have Paid', callback_data: `order_paid_prompt:${orderId}` }],
      [{ text: '❌ Cancel Order', callback_data: `order_cancel:${orderId}` }]
    ]
  });
}

// ============================================================================
// 10. WALLET & DEPOSITS
// ============================================================================
async function renderWalletMenu(chatId, messageId, userId) {
  const balance = await getWalletBalance(userId);

  const text =
    `💰 <b>MY WALLET</b>\n\n` +
    `Account Holder: <a href="tg://user?id=${userId}">${userId}</a>\n` +
    `Available Balance: <b>$${balance} USD</b>\n\n` +
    `Use your balance for instant, 1-click purchases on all catalog items.`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '➕ Top Up Balance', callback_data: 'wallet_deposit' }, { text: '📊 History', callback_data: 'wallet_history:0' }],
      [{ text: '🔄 Refresh', callback_data: 'wallet_main' }, { text: '🏠 Home', callback_data: 'main_home' }]
    ]
  };

  if (messageId) {
    await editMessageText(chatId, messageId, text, keyboard);
  } else {
    await sendMessage(chatId, text, keyboard);
  }
}

async function renderWalletHistory(chatId, messageId, userId, page = 0) {
  const db = getPool();
  const PAGE_SIZE = 8;
  const offset = page * PAGE_SIZE;

  const [txs] = await db.query(
    `SELECT * FROM wallet_transactions 
     WHERE user_id = ? 
     ORDER BY id DESC 
     LIMIT ? OFFSET ?`,
    [userId, PAGE_SIZE, offset]
  );

  const [totalRows] = await db.query('SELECT COUNT(*) as count FROM wallet_transactions WHERE user_id = ?', [userId]);
  const total = totalRows[0]?.count || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  let msg = `📊 <b>WALLET TRANSACTION HISTORY</b>\n\n`;
  if (txs.length === 0) {
    msg += `<i>No transactions recorded yet.</i>`;
  } else {
    for (const t of txs) {
      const sign = (t.type === 'DEPOSIT' || t.type === 'REFUND') ? '+' : '-';
      const formattedDate = new Date(t.created_at).toISOString().replace('T', ' ').substring(0, 16);
      msg += `<b>${sign} $${Number(t.amount).toFixed(2)}</b> — ${t.type}\n`;
      msg += `Note: ${t.description || 'N/A'}\n`;
      msg += `Bal: $${Number(t.balance_after).toFixed(2)} | <i>${formattedDate}</i>\n`;
      msg += `────────────────────\n`;
    }
  }

  const nav = [];
  if (page > 0) nav.push({ text: '◀️ Prev', callback_data: `wallet_history:${page - 1}` });
  if (page + 1 < totalPages) nav.push({ text: 'Next ▶️️', callback_data: `wallet_history:${page + 1}` });

  const keyboard = [];
  if (nav.length > 0) keyboard.push(nav);
  keyboard.push([{ text: '👈 Back to Wallet', callback_data: 'wallet_main' }]);

  await editMessageText(chatId, messageId, msg, { inline_keyboard: keyboard });
}

async function renderDepositMethodSelection(chatId, messageId) {
  const text =
    `💰 <b>DEPOSIT FUNDS</b>\n\n` +
    `Select your deposit payment method:\n` +
    `• Binance Pay (Zero fee transfer)\n` +
    `• USDT BEP20 (Binance Smart Chain)`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '🟡 Binance Pay', callback_data: 'dep_method:Binance' }],
      [{ text: '₮ USDT BEP20', callback_data: 'dep_method:USDT_BEP20' }],
      [{ text: '👈 Back to Wallet', callback_data: 'wallet_main' }]
    ]
  };
  await editMessageText(chatId, messageId, text, keyboard);
}

async function approveDeposit(depositId, adminId) {
  const pool = getPool();
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [rows] = await conn.query('SELECT * FROM deposits WHERE id = ? FOR UPDATE', [depositId]);
    if (rows.length === 0) {
      await conn.rollback();
      return { success: false, message: 'Deposit not found.' };
    }
    const dep = rows[0];
    if (dep.status !== 'PENDING') {
      await conn.rollback();
      return { success: false, message: `Deposit already ${dep.status}.` };
    }

    await conn.query('UPDATE wallets SET balance = balance + ? WHERE user_id = ?', [dep.amount, dep.user_id]);

    const [w] = await conn.query('SELECT balance FROM wallets WHERE user_id = ?', [dep.user_id]);
    const newBal = Number(w[0].balance).toFixed(2);

    await conn.query(`UPDATE deposits SET status = 'APPROVED', admin_id = ? WHERE id = ?`, [adminId, depositId]);

    await conn.query(
      `INSERT INTO wallet_transactions (user_id, type, amount, balance_after, reference_id, description)
       VALUES (?, 'DEPOSIT', ?, ?, ?, ?)`,
      [dep.user_id, dep.amount, newBal, `DEP#${depositId}`, `Wallet Deposit (${dep.payment_method})`]
    );

    await conn.commit();

    sendMessage(
      dep.user_id,
      `✅ <b>DEPOSIT APPROVED!</b>\n\n` +
      `Your deposit of <b>$${Number(dep.amount).toFixed(2)} USD</b> via ${dep.payment_method} has been credited.\n` +
      `💰 Current Wallet Balance: <b>$${newBal} USD</b>`
    );

    return { success: true, message: `Deposit #${depositId} approved and credited.` };
  } catch (err) {
    await conn.rollback();
    return { success: false, message: err.message };
  } finally {
    conn.release();
  }
}

async function rejectDeposit(depositId, adminId, reason = 'Payment unverified') {
  const db = getPool();
  const [rows] = await db.query('SELECT * FROM deposits WHERE id = ?', [depositId]);
  if (rows.length === 0) return { success: false, message: 'Deposit not found.' };

  await db.query(
    `UPDATE deposits SET status = 'REJECTED', admin_id = ?, admin_note = ? WHERE id = ?`,
    [adminId, reason, depositId]
  );

  sendMessage(
    rows[0].user_id,
    `❌ <b>DEPOSIT REJECTED</b>\n\n` +
    `Your deposit of <b>$${Number(rows[0].amount).toFixed(2)}</b> could not be verified.\n` +
    `Reason: ${reason}\n\n` +
    `If you believe this is an error, please contact Support: @${SUPPORT_USERNAME}`
  );

  return { success: true, message: `Deposit #${depositId} has been rejected.` };
}

// ============================================================================
// 11. MANUAL ORDER APPROVAL WITH TEXT + FILE DELIVERY
// ============================================================================
async function approveManualPayment(orderId, adminId) {
  const pool = getPool();
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [orders] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [orderId]);
    if (orders.length === 0) {
      await conn.rollback();
      return { success: false, message: 'Order not found.' };
    }
    const ord = orders[0];
    if (ord.status !== 'PAYMENT_SUBMITTED') {
      await conn.rollback();
      return { success: false, message: `Order status is ${ord.status}, expected PAYMENT_SUBMITTED.` };
    }

    const [inv] = await conn.query(
      `SELECT id, content FROM inventory 
       WHERE plan_id = ? AND UPPER(status) = 'AVAILABLE' 
       LIMIT 1 FOR UPDATE`,
      [ord.plan_id]
    );

    if (inv.length > 0) {
      const item = inv[0];
      await conn.query('UPDATE orders SET status = "DELIVERED", delivery_content = ? WHERE id = ?', [item.content, orderId]);
      await conn.query('UPDATE inventory SET status = "SOLD", order_id = ? WHERE id = ?', [orderId, item.id]);
      await conn.commit();

      sendMessage(
        ord.user_id,
        `✅ <b>PAYMENT APPROVED & ORDER DELIVERED!</b>\n\n` +
        `Order: <b>#ORD${orderId}</b>\n` +
        `Status: <b>Delivered</b>\n\n` +
        `📦 <b>CREDENTIALS (TEXT FORM):</b>\n` +
        `<code>${item.content}</code>\n\n` +
        `<i>A backup .txt file with these credentials has also been attached below!</i>`
      );

      await sendCredentialsFile(
        ord.user_id,
        `order_ORD${orderId}_credentials.txt`,
        `ISell Store - Order #ORD${orderId}\nCredentials:\n${item.content}\n\nSupport: @${SUPPORT_USERNAME}`,
        `📁 <b>Order #ORD${orderId} Backup File Attached.</b>`
      );

      return { success: true, message: `Order #${orderId} approved and fulfilled instantly.` };
    } else {
      await conn.query('UPDATE orders SET status = "PAID" WHERE id = ?', [orderId]);
      await conn.commit();

      sendMessage(
        ord.user_id,
        `✅ <b>PAYMENT APPROVED!</b>\n\n` +
        `Order: <b>#ORD${orderId}</b>\n` +
        `Your payment has been confirmed. The administrator will deliver your credentials shortly.`
      );
      return { success: true, message: `Payment approved for #ORD${orderId}. Manual fulfillment required.` };
    }
  } catch (err) {
    await conn.rollback();
    return { success: false, message: err.message };
  } finally {
    conn.release();
  }
}

async function rejectManualPayment(orderId, adminId, reason = 'Unverified transaction') {
  const db = getPool();
  const [orders] = await db.query('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (orders.length === 0) return { success: false, message: 'Order not found.' };

  await db.query('UPDATE orders SET status = "PAYMENT_REJECTED", admin_note = ? WHERE id = ?', [reason, orderId]);

  sendMessage(
    orders[0].user_id,
    `❌ <b>PAYMENT VERIFICATION FAILED</b>\n\n` +
    `Your payment for Order <b>#ORD${orderId}</b> could not be validated.\n` +
    `Reason: ${reason}\n\n` +
    `Need help? Contact @${SUPPORT_USERNAME}`
  );
  return { success: true, message: `Order #${orderId} payment rejected.` };
}

// ============================================================================
// 12. AUTOMATIC RESTOCK BROADCAST TO ALL USERS
// ============================================================================
async function broadcastRestockToAllUsers(planId, addedCount) {
  const db = getPool();
  const [plans] = await db.query(
    `SELECT pl.*, p.name as product_name, p.emoji as product_emoji 
     FROM plans pl 
     JOIN products p ON pl.product_id = p.id 
     WHERE pl.id = ?`,
    [planId]
  );
  if (plans.length === 0) return;
  const pl = plans[0];

  const [users] = await db.query('SELECT id FROM users WHERE is_banned = 0');

  const alertMsg =
    `🔥 <b>STOCK ADDED! NEW PACKAGES AVAILABLE</b>\n\n` +
    `<b>${pl.product_emoji} ${pl.product_name}</b>\n` +
    `Plan: <b>${pl.name}</b>\n` +
    `💵 Price: <b>$${Number(pl.price).toFixed(2)} USD</b>\n` +
    `⏱️ Duration: <b>${pl.duration_text}</b>\n` +
    `🛡️ Warranty: <b>${pl.warranty_text}</b>\n` +
    `📦 Newly Added Stock: <b>+${addedCount}</b>\n\n` +
    `<i>Grab yours before it sells out again!</i>`;

  const buyKeyboard = {
    inline_keyboard: [[{ text: '🛒 BUY NOW', callback_data: `view_plan:${pl.id}:0` }]]
  };

  let sent = 0;
  for (const u of users) {
    try {
      await sendMessage(u.id, alertMsg, buyKeyboard);
      sent++;
      await new Promise(r => setTimeout(r, 35));
    } catch (e) {
      // Ignored
    }
  }

  await sendMessage(ADMIN_ID, `📢 <b>AUTOMATIC RESTOCK BROADCAST COMPLETE</b>\nDelivered alert to <b>${sent}</b> users for ${pl.product_name} (${pl.name}).`);
}

// ============================================================================
// 13. ADMIN DASHBOARD (IMMEDIATE & DEFENSIVE)
// ============================================================================
async function renderAdminDashboard(chatId, messageId = null) {
  const db = getPool();

  try {
    const [usersCount] = await db.query('SELECT COUNT(*) as count FROM users');
    const [ordersCount] = await db.query('SELECT COUNT(*) as count FROM orders');
    const [pendingOrders] = await db.query('SELECT COUNT(*) as count FROM orders WHERE status = "PAYMENT_SUBMITTED"');
    const [pendingDeposits] = await db.query('SELECT COUNT(*) as count FROM deposits WHERE status = "PENDING"');
    const [revenueRow] = await db.query('SELECT COALESCE(SUM(amount), 0) as total FROM orders WHERE status IN ("PAID", "DELIVERED")');
    const [liabilityRow] = await db.query('SELECT COALESCE(SUM(balance), 0) as total FROM wallets');
    const [availPlans] = await db.query(
      `SELECT COUNT(DISTINCT pl.id) as count 
       FROM plans pl 
       JOIN inventory i ON pl.id = i.plan_id 
       WHERE UPPER(i.status) = 'AVAILABLE'`
    );
    const [totalPlans] = await db.query('SELECT COUNT(*) as count FROM plans WHERE is_active = 1');

    const totalUsers = usersCount[0]?.count || 0;
    const totalOrders = ordersCount[0]?.count || 0;
    const pendOrd = pendingOrders[0]?.count || 0;
    const pendDep = pendingDeposits[0]?.count || 0;
    const rev = Number(revenueRow[0]?.total || 0).toFixed(2);
    const liab = Number(liabilityRow[0]?.total || 0).toFixed(2);
    const inStockPlans = availPlans[0]?.count || 0;
    const totPlans = totalPlans[0]?.count || 0;

    const text =
      `👑 <b>ISELL STORE — ADMIN DASHBOARD</b>\n\n` +
      `👥 <b>Total Customers:</b> ${totalUsers}\n` +
      `🧾 <b>Total Orders:</b> ${totalOrders}\n` +
      `⏳ <b>Pending Order Payments:</b> ${pendOrd}\n` +
      `💳 <b>Pending Wallet Deposits:</b> ${pendDep}\n` +
      `💰 <b>Total Verified Revenue:</b> $${rev} USD\n` +
      `💵 <b>Total Customer Wallet Liability:</b> $${liab} USD\n` +
      `🟢 <b>Active In-Stock Plans:</b> ${inStockPlans} / ${totPlans}\n`;

    const keyboard = getAdminPanelKeyboard();

    if (messageId) {
      await editMessageText(chatId, messageId, text, keyboard);
    } else {
      await sendMessage(chatId, text, keyboard);
    }
  } catch (err) {
    console.error('Error in renderAdminDashboard:', err);
    const fallbackText = `👑 <b>ADMIN PANEL</b>\n\nLoaded with default values.\nStatus: Ready.`;
    const keyboard = getAdminPanelKeyboard();
    if (messageId) {
      await editMessageText(chatId, messageId, fallbackText, keyboard);
    } else {
      await sendMessage(chatId, fallbackText, keyboard);
    }
  }
}

// ============================================================================
// 14. TEXT & PHOTO INPUT HANDLERS (FSM)
// ============================================================================
async function handleUserTextInput(chatId, userId, text, photoFileId = null) {
  const { state, data } = await getUserState(userId);
  if (!state) return false;

  if (state === 'DEPOSIT_AMOUNT') {
    const amount = parseFloat(text.replace('$', '').trim());
    if (isNaN(amount) || amount <= 0 || !/^\d+(\.\d{1,2})?$/.test(text.replace('$', '').trim())) {
      await sendMessage(chatId, '❌ Please enter a valid positive number with up to 2 decimal places (e.g. 10.00).');
      return true;
    }
    if (amount < 1.00) {
      await sendMessage(chatId, '❌ Minimum deposit amount is $1.00.');
      return true;
    }

    const method = data.method;
    let payInstructions = '';
    if (method === 'Binance') {
      payInstructions =
        `🟡 <b>BINANCE PAY DETAILS:</b>\n\n` +
        `Binance Pay ID: <code>${BINANCE_ID}</code>\n` +
        `Amount: <b>$${amount.toFixed(2)} USD</b>`;
    } else {
      payInstructions =
        `₮ <b>USDT BEP20 DETAILS:</b>\n\n` +
        `Address: <code>${USDT_BEP20_ADDRESS}</code>\n` +
        `Network: <b>BEP20 (Binance Smart Chain)</b>\n` +
        `Amount: <b>$${amount.toFixed(2)} USDT</b>`;
    }

    const db = getPool();
    const [depRes] = await db.query(
      `INSERT INTO deposits (user_id, amount, payment_method, status) VALUES (?, ?, ?, 'PENDING')`,
      [userId, amount, method]
    );
    const depositId = depRes.insertId;

    await setUserState(userId, 'DEPOSIT_PROOF', { depositId, amount, method });

    await sendMessage(
      chatId,
      `💰 <b>DEPOSIT #${depositId} CREATED</b>\n\n` +
      `${payInstructions}\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `<b>VERIFICATION INSTRUCTIONS:</b>\n` +
      `Please make the payment now, then reply here with your <b>Transaction Hash / ID</b> or send a <b>Payment Screenshot</b>.`,
      { inline_keyboard: [[{ text: '❌ Cancel Deposit', callback_data: `dep_cancel:${depositId}` }]] }
    );
    return true;
  }

  if (state === 'DEPOSIT_PROOF') {
    const depositId = data.depositId;
    const db = getPool();

    let txRef = text || 'Photo Attachment';
    let fileId = photoFileId || null;

    await db.query(
      `UPDATE deposits SET transaction_ref = ?, telegram_file_id = ? WHERE id = ?`,
      [txRef, fileId, depositId]
    );

    await clearUserState(userId);

    await sendMessage(
      chatId,
      `✅ <b>PAYMENT PROOF SUBMITTED!</b>\n\n` +
      `Deposit <b>#D${depositId}</b> for <b>$${Number(data.amount).toFixed(2)}</b> is now under admin review.\n` +
      `Your wallet will be credited automatically as soon as it is confirmed.`,
      { inline_keyboard: [[{ text: '💰 View Wallet', callback_data: 'wallet_main' }]] }
    );

    const adminNotice =
      `━━━━━━━━━━━━━━━━━━\n` +
      `💰 <b>NEW WALLET DEPOSIT</b>\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `Deposit: <b>#D${depositId}</b>\n` +
      `User ID: <code>${userId}</code>\n` +
      `Amount: <b>$${Number(data.amount).toFixed(2)} USD</b>\n` +
      `Method: <b>${data.method}</b>\n` +
      `Transaction: <code>${txRef}</code>\n` +
      `Status: ⏳ Pending`;

    const adminKeyboard = {
      inline_keyboard: [
        [
          { text: '✅ APPROVE', callback_data: `adm_dep_appr:${depositId}` },
          { text: '❌ REJECT', callback_data: `adm_dep_rej:${depositId}` }
        ]
      ]
    };

    if (fileId) {
      await sendPhoto(ADMIN_ID, fileId, adminNotice, adminKeyboard);
    } else {
      await sendMessage(ADMIN_ID, adminNotice, adminKeyboard);
    }
    return true;
  }

  if (state === 'ORDER_PAY_PROOF') {
    const orderId = data.orderId;
    const db = getPool();

    const txRef = text || 'Screenshot Attached';
    const fileId = photoFileId || null;

    await db.query(
      `UPDATE orders SET status = 'PAYMENT_SUBMITTED', payment_reference = ?, telegram_file_id = ? WHERE id = ?`,
      [txRef, fileId, orderId]
    );

    await clearUserState(userId);

    await sendMessage(
      chatId,
      `✅ <b>PAYMENT SUBMITTED FOR ORDER #ORD${orderId}</b>\n\n` +
      `Our administration team is verifying your payment. Your digital credentials will be delivered here upon confirmation.`,
      { inline_keyboard: [[{ text: '📦 View Order', callback_data: `view_order:${orderId}` }]] }
    );

    const [ord] = await db.query(
      `SELECT o.*, pl.name as plan_name, p.name as product_name 
       FROM orders o 
       JOIN plans pl ON o.plan_id = pl.id 
       JOIN products p ON pl.product_id = p.id 
       WHERE o.id = ?`,
      [orderId]
    );

    if (ord.length > 0) {
      const o = ord[0];
      const adminNotice =
        `💰 <b>PAYMENT REVIEW REQUIRED</b>\n\n` +
        `Order: <b>#ORD${o.id}</b>\n` +
        `User ID: <code>${userId}</code>\n` +
        `Product: <b>${o.product_name}</b>\n` +
        `Plan: <b>${o.plan_name}</b>\n` +
        `Amount: <b>$${Number(o.amount).toFixed(2)}</b>\n` +
        `Method: <b>${o.payment_method}</b>\n` +
        `Transaction: <code>${txRef}</code>`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '✅ Approve', callback_data: `adm_ord_appr:${o.id}` },
            { text: '❌ Reject', callback_data: `adm_ord_rej:${o.id}` }
          ],
          [{ text: '📦 Fulfill Manually', callback_data: `adm_fulfill_prompt:${o.id}` }]
        ]
      };

      if (fileId) {
        await sendPhoto(ADMIN_ID, fileId, adminNotice, keyboard);
      } else {
        await sendMessage(ADMIN_ID, adminNotice, keyboard);
      }
    }
    return true;
  }

  if (state === 'STORE_SEARCH_INPUT') {
    const db = getPool();
    const [results] = await db.query(
      `SELECT p.id, p.name, p.emoji,
        (SELECT COUNT(i.id) FROM inventory i JOIN plans pl ON i.plan_id = pl.id WHERE pl.product_id = p.id AND pl.is_active = 1 AND UPPER(i.status) = 'AVAILABLE') as stock_count
       FROM products p
       WHERE p.is_active = 1 AND LOWER(p.name) LIKE LOWER(?)
       ORDER BY p.name ASC
       LIMIT 15`,
      [`%${text.trim()}%`]
    );

    await clearUserState(userId);

    if (results.length === 0) {
      await sendMessage(
        chatId,
        `❌ No products found matching "<b>${text}</b>".`,
        { inline_keyboard: [[{ text: '🔎 Try Another Search', callback_data: 'store_search' }, { text: '👈 Back', callback_data: 'store_page:0' }]] }
      );
      return true;
    }

    const buttons = [];
    for (const r of results) {
      const hasStock = Number(r.stock_count || 0) > 0;
      buttons.push([{
        text: hasStock ? `🟦 ${r.emoji} ${r.name} (${r.stock_count}) 🟦` : `🟥 ${r.emoji} ${r.name} (Sold Out) 🟥`,
        callback_data: `view_prod:${r.id}:0`
      }]);
    }
    buttons.push([{ text: '👈 Back to Categories', callback_data: 'store_page:0' }]);

    await sendMessage(chatId, `🔎 <b>SEARCH RESULTS FOR "${text}":</b>`, { inline_keyboard: buttons });
    return true;
  }

  if (Number(userId) === ADMIN_ID) {
    if (state === 'ADM_ADD_PROD_NAME') {
      await setUserState(userId, 'ADM_ADD_PROD_EMOJI', { name: text.trim() });
      await sendMessage(chatId, `Enter an emoji for <b>${text.trim()}</b> (e.g. 🤖, 🎨, 🎵, 🎬, 🔥):`);
      return true;
    }

    if (state === 'ADM_ADD_PROD_EMOJI') {
      const db = getPool();
      const emoji = text.trim() || '📦';
      const [res] = await db.query(
        `INSERT INTO products (name, emoji, is_active) VALUES (?, ?, 1)`,
        [data.name, emoji]
      );
      await clearUserState(userId);

      await sendMessage(
        chatId,
        `✅ <b>Product Created: ${emoji} ${data.name}</b>\n\nNow add subscription plans and stock to it!`,
        {
          inline_keyboard: [
            [{ text: '➕ Add Plan to this Product', callback_data: `adm_plan_add_start:${res.insertId}` }],
            [{ text: '◀️ Admin Panel', callback_data: 'admin_dashboard' }]
          ]
        }
      );
      return true;
    }

    if (state === 'ADM_ADD_PLAN_NAME') {
      await setUserState(userId, 'ADM_ADD_PLAN_DETAILS', { ...data, name: text.trim() });
      await sendMessage(chatId, '📝 <b>Step 2/5:</b> Enter the <b>Plan Details / Features</b> (supports multiline text):');
      return true;
    }

    if (state === 'ADM_ADD_PLAN_DETAILS') {
      await setUserState(userId, 'ADM_ADD_PLAN_PRICE', { ...data, details: text.trim() });
      await sendMessage(chatId, '💵 <b>Step 3/5:</b> Enter the <b>Price in USD</b> (e.g. 15.50):');
      return true;
    }

    if (state === 'ADM_ADD_PLAN_PRICE') {
      const price = parseFloat(text.replace('$', '').trim());
      if (isNaN(price) || price < 0) {
        await sendMessage(chatId, '❌ Invalid price. Enter a valid number (e.g. 15.50):');
        return true;
      }
      await setUserState(userId, 'ADM_ADD_PLAN_DURATION', { ...data, price });
      await sendMessage(chatId, '⏱️ <b>Step 4/5:</b> Enter the <b>Duration Text</b> (e.g. 30 Days, 1 Month, 2 Years, Lifetime):');
      return true;
    }

    if (state === 'ADM_ADD_PLAN_DURATION') {
      await setUserState(userId, 'ADM_ADD_PLAN_WARRANTY', { ...data, duration_text: text.trim() });
      await sendMessage(chatId, '🛡️ <b>Step 5/5:</b> Enter the <b>Warranty Text</b> (e.g. Full Warranty, 30 day warranty, No Warranty):');
      return true;
    }

    if (state === 'ADM_ADD_PLAN_WARRANTY') {
      const finalData = { ...data, warranty_text: text.trim() };
      const db = getPool();

      const [res] = await db.query(
        `INSERT INTO plans (product_id, name, details, price, duration_text, warranty_text, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [finalData.productId, finalData.name, finalData.details, finalData.price, finalData.duration_text, finalData.warranty_text]
      );

      await clearUserState(userId);
      await logAdminAction(ADMIN_ID, 'PLAN_CREATED', `Created plan #${res.insertId} (${finalData.name})`);

      await sendMessage(
        chatId,
        `✅ <b>PLAN CREATED SUCCESSFULLY!</b>\n\n` +
        `Plan ID: #${res.insertId}\n` +
        `Name: <b>${finalData.name}</b>\n` +
        `Price: $${finalData.price.toFixed(2)}\n` +
        `Duration: ${finalData.duration_text}\n` +
        `Warranty: ${finalData.warranty_text}\n\n` +
        `<i>Plan currently has ZERO stock. Add stock to make it available to customers.</i>`,
        {
          inline_keyboard: [
            [{ text: '➕ Add Stock to this Plan', callback_data: `adm_stock_add_prompt:${res.insertId}` }],
            [{ text: '◀️ Admin Panel', callback_data: 'admin_dashboard' }]
          ]
        }
      );
      return true;
    }

    if (state === 'ADM_ADD_STOCK_ITEMS') {
      const planId = data.planId;
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

      if (lines.length === 0) {
        await sendMessage(chatId, '❌ No items detected. Please paste at least one line:');
        return true;
      }

      const db = getPool();
      let added = 0;
      for (const line of lines) {
        await db.query(
          `INSERT INTO inventory (plan_id, content, status) VALUES (?, ?, 'AVAILABLE')`,
          [planId, line]
        );
        added++;
      }

      await clearUserState(userId);
      await logAdminAction(ADMIN_ID, 'STOCK_ADDED', `Added ${added} items to plan #${planId}`);

      await sendMessage(chatId, `✅ Successfully added <b>${added}</b> inventory items to Plan #${planId}!`);

      await broadcastRestockToAllUsers(planId, added);
      return true;
    }

    if (state === 'ADM_FULFILL_INPUT') {
      const orderId = data.orderId;
      const db = getPool();

      await db.query(
        `UPDATE orders SET status = 'DELIVERED', delivery_content = ? WHERE id = ?`,
        [text.trim(), orderId]
      );

      const [ord] = await db.query('SELECT * FROM orders WHERE id = ?', [orderId]);
      await clearUserState(userId);

      if (ord.length > 0) {
        await sendMessage(
          ord[0].user_id,
          `📦 <b>ORDER #ORD${orderId} FULFILLED!</b>\n\n` +
          `Your order has been delivered by the administrator.\n\n` +
          `<b>ACCESS CREDENTIALS (TEXT FORM):</b>\n` +
          `<code>${text.trim()}</code>\n\n` +
          `<i>A backup .txt file with these credentials has also been attached below!</i>`
        );

        await sendCredentialsFile(
          ord[0].user_id,
          `order_ORD${orderId}_credentials.txt`,
          `ISell Store - Order #ORD${orderId}\nCredentials:\n${text.trim()}\n\nSupport: @${SUPPORT_USERNAME}`,
          `📁 <b>Order #ORD${orderId} Backup File Attached.</b>`
        );
      }

      await logAdminAction(ADMIN_ID, 'ORDER_FULFILLED', `Order #${orderId} fulfilled manually.`);
      await sendMessage(chatId, `✅ Order #ORD${orderId} fulfilled and delivered to customer.`);
      return true;
    }

    if (state === 'ADM_BROADCAST_TEXT') {
      const db = getPool();
      const [uRows] = await db.query('SELECT COUNT(*) as count FROM users WHERE is_banned = 0');
      const totalRecipients = uRows[0]?.count || 0;

      await setUserState(userId, 'ADM_BROADCAST_CONFIRM', { text: text.trim(), totalRecipients });

      const preview =
        `📢 <b>BROADCAST PREVIEW</b>\n\n` +
        `${text.trim()}\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `Total Active Recipients: <b>${totalRecipients}</b>\n` +
        `Are you sure you want to broadcast this message?`;

      await sendMessage(chatId, preview, {
        inline_keyboard: [
          [{ text: '🚀 CONFIRM & SEND', callback_data: 'adm_broadcast_dispatch' }],
          [{ text: '❌ Cancel', callback_data: 'admin_dashboard' }]
        ]
      });
      return true;
    }
  }

  return false;
}

// ============================================================================
// 15. USER PROFILE & MY ORDERS
// ============================================================================
async function renderUserProfile(chatId, messageId, user) {
  const db = getPool();
  const balance = await getWalletBalance(user.id);

  const [totalOrders] = await db.query('SELECT COUNT(*) as count FROM orders WHERE user_id = ?', [user.id]);
  const [compOrders] = await db.query('SELECT COUNT(*) as count FROM orders WHERE user_id = ? AND status = "DELIVERED"', [user.id]);

  const text =
    `👤 <b>MY PROFILE</b>\n\n` +
    `Name: <b>${user.first_name || 'Customer'}</b>\n` +
    `Username: ${user.username ? `@${user.username}` : '<i>Not set</i>'}\n` +
    `Telegram ID: <code>${user.id}</code>\n\n` +
    `💰 <b>Wallet Balance:</b> $${balance} USD\n` +
    `🧾 <b>Total Orders:</b> ${totalOrders[0]?.count || 0}\n` +
    `✅ <b>Completed Orders:</b> ${compOrders[0]?.count || 0}`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '💰 Open Wallet', callback_data: 'wallet_main' }, { text: '📦 View Orders', callback_data: 'my_orders:0' }],
      [{ text: '🏠 Home', callback_data: 'main_home' }]
    ]
  };

  if (messageId) {
    await editMessageText(chatId, messageId, text, keyboard);
  } else {
    await sendMessage(chatId, text, keyboard);
  }
}

async function renderUserOrders(chatId, messageId, userId, page = 0) {
  const db = getPool();
  const PAGE_SIZE = 5;
  const offset = page * PAGE_SIZE;

  const [orders] = await db.query(
    `SELECT o.*, pl.name as plan_name, p.name as product_name, p.emoji as product_emoji 
     FROM orders o 
     JOIN plans pl ON o.plan_id = pl.id 
     JOIN products p ON pl.product_id = p.id 
     WHERE o.user_id = ? 
     ORDER BY o.id DESC 
     LIMIT ? OFFSET ?`,
    [userId, PAGE_SIZE, offset]
  );

  const [totalRows] = await db.query('SELECT COUNT(*) as count FROM orders WHERE user_id = ?', [userId]);
  const total = totalRows[0]?.count || 0;
  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  let msg = `📦 <b>MY ORDERS (${total} Total)</b>\n\n`;
  const keyboard = [];

  if (orders.length === 0) {
    msg += `<i>You have not placed any orders yet.</i>`;
  } else {
    for (const o of orders) {
      msg += `<b>Order #ORD${o.id}</b> — ${o.product_emoji} ${o.product_name}\n`;
      msg += `Plan: ${o.plan_name} | $${Number(o.amount).toFixed(2)}\n`;
      msg += `Status: <b>${o.status}</b> | ${new Date(o.created_at).toISOString().substring(0, 10)}\n\n`;

      keyboard.push([{ text: `🔎 View Order #ORD${o.id}`, callback_data: `view_order:${o.id}` }]);
    }
  }

  const nav = [];
  if (page > 0) nav.push({ text: '◀️ Prev', callback_data: `my_orders:${page - 1}` });
  if (page + 1 < totalPages) nav.push({ text: 'Next ▶️', callback_data: `my_orders:${page + 1}` });

  if (nav.length > 0) keyboard.push(nav);
  keyboard.push([{ text: '🏠 Home', callback_data: 'main_home' }]);

  await editMessageText(chatId, messageId, msg, { inline_keyboard: keyboard });
}

async function renderSingleOrder(chatId, messageId, orderId, userId) {
  const db = getPool();
  const [orders] = await db.query(
    `SELECT o.*, pl.name as plan_name, pl.warranty_text, pl.duration_text, p.name as product_name, p.emoji as product_emoji 
     FROM orders o 
     JOIN plans pl ON o.plan_id = pl.id 
     JOIN products p ON pl.product_id = p.id 
     WHERE o.id = ? AND (o.user_id = ? OR ? = ?)`,
    [orderId, userId, Number(userId), ADMIN_ID]
  );

  if (orders.length === 0) {
    return editMessageText(chatId, messageId, '❌ Order not found.');
  }

  const o = orders[0];
  let msg =
    `🧾 <b>ORDER #ORD${o.id}</b>\n\n` +
    `Product: <b>${o.product_emoji} ${o.product_name}</b>\n` +
    `Plan: <b>${o.plan_name}</b>\n` +
    `Duration: <b>${o.duration_text}</b>\n` +
    `Warranty: <b>${o.warranty_text}</b>\n` +
    `Amount Paid: <b>$${Number(o.amount).toFixed(2)} ${o.currency}</b>\n` +
    `Payment Method: <b>${o.payment_method}</b>\n` +
    `Status: <b>${o.status}</b>\n` +
    `Date: ${new Date(o.created_at).toISOString().replace('T', ' ').substring(0, 19)}\n\n`;

  if (o.status === 'DELIVERED' && o.delivery_content) {
    msg += `📦 <b>DELIVERY INFORMATION / CREDENTIALS:</b>\n`;
    msg += `<code>${o.delivery_content}</code>\n\n`;
  }

  const buttons = [[{ text: '👈 Back to Orders', callback_data: 'my_orders:0' }]];
  await editMessageText(chatId, messageId, msg, { inline_keyboard: buttons });
}

// ============================================================================
// 16. CALLBACK QUERY ROUTER
// ============================================================================
async function handleCallbackQuery(callbackQuery) {
  const queryId = callbackQuery.id;
  const data = callbackQuery.data;
  const fromUser = callbackQuery.from;
  const userId = fromUser.id;
  const message = callbackQuery.message;
  const chatId = message?.chat?.id || userId;
  const messageId = message?.message_id;

  // Immediate callback acknowledgment to prevent Telegram button freeze
  await answerCallbackQuery(queryId);

  await syncUser(fromUser);

  // Admin access guard
  if ((data.startsWith('admin_') || data.startsWith('adm_')) && Number(userId) !== ADMIN_ID) {
    return await sendMessage(chatId, '🚫 Unauthorized: Admin access only.');
  }

  if (data === 'main_home') {
    await clearUserState(userId);
    if (Number(userId) === ADMIN_ID) {
      return await editMessageText(
        chatId,
        messageId,
        `👑 <b>Welcome Admin</b>\n\n${STORE_NAME} Administration Panel`,
        {
          inline_keyboard: [
            [{ text: '⚙️ Admin Panel', callback_data: 'admin_dashboard' }],
            [{ text: '📁 Browse Store', callback_data: 'store_page:0' }]
          ]
        }
      );
    }
    return await editMessageText(
      chatId,
      messageId,
      `🛍 <b>Welcome to ${STORE_NAME}</b>\n\nPremium digital tools, subscriptions, and accounts with instant delivery and guaranteed warranty.`,
      getCustomerMainMenuKeyboard(userId)
    );
  }

  if (data.startsWith('store_page:')) {
    const page = parseInt(data.split(':')[1], 10) || 0;
    return await renderStorePage(chatId, messageId, page);
  }

  if (data.startsWith('view_prod:')) {
    const parts = data.split(':');
    const productId = parseInt(parts[1], 10);
    const returnPage = parseInt(parts[2], 10) || 0;
    return await renderProductPlans(chatId, messageId, productId, returnPage);
  }

  if (data.startsWith('view_plan:')) {
    const parts = data.split(':');
    const planId = parseInt(parts[1], 10);
    const returnPage = parseInt(parts[2], 10) || 0;
    return await renderPlanDetails(chatId, messageId, planId, returnPage, userId);
  }

  if (data.startsWith('order_prep:')) {
    const parts = data.split(':');
    const planId = parseInt(parts[1], 10);
    const returnPage = parseInt(parts[2], 10) || 0;
    return await renderOrderCheckout(chatId, messageId, planId, returnPage, userId);
  }

  if (data.startsWith('pay_wallet:')) {
    const planId = parseInt(data.split(':')[1], 10);
    return await executeWalletPurchase(chatId, messageId, planId, userId);
  }

  if (data.startsWith('pay_manual:')) {
    const [, method, planIdStr] = data.split(':');
    const planId = parseInt(planIdStr, 10);
    return await initiateManualOrderPayment(chatId, messageId, method, planId, userId);
  }

  if (data.startsWith('order_paid_prompt:')) {
    const orderId = parseInt(data.split(':')[1], 10);
    await setUserState(userId, 'ORDER_PAY_PROOF', { orderId });
    return await editMessageText(
      chatId,
      messageId,
      `📩 <b>SUBMIT PROOF FOR ORDER #ORD${orderId}</b>\n\n` +
      `Please reply with your <b>Transaction ID / Hash</b> or send a <b>screenshot of payment</b> right now.`
    );
  }

  if (data.startsWith('order_cancel:')) {
    const orderId = parseInt(data.split(':')[1], 10);
    const db = getPool();
    await db.query('UPDATE orders SET status = "CANCELLED" WHERE id = ? AND user_id = ?', [orderId, userId]);
    return await renderStorePage(chatId, messageId, 0);
  }

  if (data.startsWith('notif_sub:')) {
    const parts = data.split(':');
    const planId = parseInt(parts[1], 10);
    const db = getPool();
    const [p] = await db.query('SELECT product_id FROM plans WHERE id = ?', [planId]);
    if (p.length > 0) {
      await db.query(
        `INSERT IGNORE INTO notification_subscriptions (user_id, product_id, plan_id) VALUES (?, ?, ?)`,
        [userId, p[0].product_id, planId]
      );
    }
    return await sendMessage(chatId, '🔔 Subscribed! You will be alerted the second stock is added.');
  }

  if (data === 'wallet_main') {
    return await renderWalletMenu(chatId, messageId, userId);
  }

  if (data.startsWith('wallet_history:')) {
    const page = parseInt(data.split(':')[1], 10) || 0;
    return await renderWalletHistory(chatId, messageId, userId, page);
  }

  if (data === 'wallet_deposit') {
    return await renderDepositMethodSelection(chatId, messageId);
  }

  if (data.startsWith('dep_method:')) {
    const method = data.split(':')[1];
    await setUserState(userId, 'DEPOSIT_AMOUNT', { method });
    return await editMessageText(
      chatId,
      messageId,
      `💵 <b>ENTER DEPOSIT AMOUNT (${method})</b>\n\n` +
      `Please reply with the exact amount in USD you want to deposit (e.g. <code>10.00</code>):`,
      { inline_keyboard: [[{ text: '👈 Cancel', callback_data: 'wallet_main' }]] }
    );
  }

  if (data.startsWith('dep_cancel:')) {
    const depId = parseInt(data.split(':')[1], 10);
    const db = getPool();
    await db.query('UPDATE deposits SET status = "REJECTED", admin_note = "Cancelled by user" WHERE id = ? AND user_id = ?', [depId, userId]);
    await clearUserState(userId);
    return await renderWalletMenu(chatId, messageId, userId);
  }

  if (data === 'user_profile') {
    return await renderUserProfile(chatId, messageId, fromUser);
  }

  if (data.startsWith('my_orders:')) {
    const page = parseInt(data.split(':')[1], 10) || 0;
    return await renderUserOrders(chatId, messageId, userId, page);
  }

  if (data.startsWith('view_order:')) {
    const orderId = parseInt(data.split(':')[1], 10);
    return await renderSingleOrder(chatId, messageId, orderId, userId);
  }

  if (data === 'store_search') {
    await setUserState(userId, 'STORE_SEARCH_INPUT');
    return await editMessageText(
      chatId,
      messageId,
      `🔎 <b>SEARCH PRODUCTS</b>\n\n` +
      `Type the name of the service or product you are looking for (e.g. <code>ChatGPT</code>, <code>Netflix</code>):`,
      { inline_keyboard: [[{ text: '👈 Back', callback_data: 'store_page:0' }]] }
    );
  }

  if (data === 'store_support') {
    return await editMessageText(
      chatId,
      messageId,
      `📞 <b>CUSTOMER SUPPORT</b>\n\n` +
      `For help with orders, activation, or deposits, message our official support:\n\n` +
      `👤 Support Agent: <b>@${SUPPORT_USERNAME}</b>\n` +
      `⚡ Response Time: Usually under 15 minutes.`,
      { inline_keyboard: [[{ text: '👈 Back', callback_data: 'store_page:0' }]] }
    );
  }

  if (data === 'store_help') {
    return await editMessageText(
      chatId,
      messageId,
      `ℹ️ <b>STORE HELP & FAQ</b>\n\n` +
      `• <b>How do I buy?</b> Top up your wallet for instant 1-click purchases, or choose manual payment.\n` +
      `• <b>Where are my credentials?</b> Delivered immediately in chat and permanently accessible in 'My Orders'.\n` +
      `• <b>Is warranty included?</b> Every product includes its specified replacement warranty.`,
      { inline_keyboard: [[{ text: '👈 Back', callback_data: 'store_page:0' }]] }
    );
  }

  // Admin Dashboard Overview
  if (data === 'admin_dashboard') {
    return await renderAdminDashboard(chatId, messageId);
  }

  if (data === 'adm_wipe_confirm') {
    return await editMessageText(
      chatId,
      messageId,
      `⚠️ <b>CONFIRM COMPLETE STORE WIPE</b>\n\nAre you sure you want to delete ALL products, plans, and inventory?`,
      {
        inline_keyboard: [
          [{ text: '🔴 YES, WIPE STORE CLEAN', callback_data: 'adm_wipe_execute' }],
          [{ text: '👈 Cancel', callback_data: 'admin_dashboard' }]
        ]
      }
    );
  }

  if (data === 'adm_wipe_execute') {
    await wipeStoreData();
    return await editMessageText(
      chatId,
      messageId,
      `✅ <b>STORE WIPED CLEAN!</b>\n\nAll existing products, plans, and inventory have been deleted.`,
      { inline_keyboard: [[{ text: '➕ Add First Product', callback_data: 'adm_prod_add_start' }]] }
    );
  }

  if (data === 'adm_prod_add_start') {
    await setUserState(userId, 'ADM_ADD_PROD_NAME');
    return await editMessageText(
      chatId,
      messageId,
      `➕ <b>CREATE NEW PRODUCT</b>\n\n` +
      `Reply with the name of the product (e.g. <code>ChatGPT</code>, <code>Claude</code>, <code>Capcut</code>):`,
      { inline_keyboard: [[{ text: '👈 Cancel', callback_data: 'admin_dashboard' }]] }
    );
  }

  if (data.startsWith('admin_products:')) {
    const page = parseInt(data.split(':')[1], 10) || 0;
    const db = getPool();
    const [prods] = await db.query('SELECT * FROM products ORDER BY name ASC LIMIT 10 OFFSET ?', [page * 10]);

    let text = `🛍 <b>ADMIN PRODUCT MANAGEMENT (Page ${page + 1})</b>\n\n`;
    const buttons = [];
    for (const p of prods) {
      buttons.push([{ text: `${p.emoji} ${p.name}`, callback_data: `adm_prod_mgt:${p.id}` }]);
    }
    buttons.push([
      { text: '➕ Add Product', callback_data: 'adm_prod_add_start' },
      { text: '👈 Back', callback_data: 'admin_dashboard' }
    ]);
    return await editMessageText(chatId, messageId, text, { inline_keyboard: buttons });
  }

  if (data.startsWith('adm_prod_mgt:')) {
    const prodId = parseInt(data.split(':')[1], 10);
    const db = getPool();
    const [p] = await db.query('SELECT * FROM products WHERE id = ?', [prodId]);
    if (p.length === 0) return;
    const prod = p[0];

    const [plans] = await db.query('SELECT * FROM plans WHERE product_id = ?', [prodId]);
    let text = `<b>${prod.emoji} ${prod.name} Management</b>\n\nPlans (${plans.length}):\n`;
    for (const pl of plans) {
      text += `• ${pl.name} — $${Number(pl.price).toFixed(2)}\n`;
    }

    const buttons = [
      [{ text: '➕ Add Plan to this Product', callback_data: `adm_plan_add_start:${prodId}` }],
      [{ text: '👈 Back to Products', callback_data: 'admin_products:0' }]
    ];
    return await editMessageText(chatId, messageId, text, { inline_keyboard: buttons });
  }

  if (data.startsWith('adm_plan_add_start:')) {
    const prodId = parseInt(data.split(':')[1], 10);
    await setUserState(userId, 'ADM_ADD_PLAN_NAME', { productId: prodId });
    return await editMessageText(
      chatId,
      messageId,
      `📝 <b>Step 1/5: Enter Plan Name</b>\n\n(e.g. <code>Plus 1M - FW</code>, <code>Pro 1 Year</code>):`
    );
  }

  if (data.startsWith('adm_stock_add_prompt:')) {
    const planId = parseInt(data.split(':')[1], 10);
    await setUserState(userId, 'ADM_ADD_STOCK_ITEMS', { planId });
    return await sendMessage(
      chatId,
      `📦 <b>ADD STOCK TO PLAN #${planId}</b>\n\n` +
      `Paste the credentials/accounts below.\n` +
      `Each line represents <b>ONE</b> individual stock item:\n\n` +
      `<code>email:pass\nemail2:pass2\nLICENSE-KEY-XXXX</code>\n\n` +
      `<i>Note: Adding stock will automatically broadcast an alert to all registered users!</i>`
    );
  }

  if (data.startsWith('admin_stock_list:')) {
    const db = getPool();
    const [plans] = await db.query(
      `SELECT pl.id, pl.name, p.name as product_name, p.emoji as product_emoji,
        (SELECT COUNT(*) FROM inventory i WHERE i.plan_id = pl.id AND UPPER(i.status) = 'AVAILABLE') as count
       FROM plans pl
       JOIN products p ON pl.product_id = p.id
       ORDER BY p.name ASC LIMIT 25`
    );

    let text = `📦 <b>WAREHOUSE INVENTORY OVERVIEW</b>\n\n`;
    const buttons = [];
    for (const pl of plans) {
      buttons.push([{
        text: `${pl.product_emoji} ${pl.product_name} (${pl.name}): ${pl.count} In Stock`,
        callback_data: `adm_stock_add_prompt:${pl.id}`
      }]);
    }
    buttons.push([{ text: '👈 Admin Panel', callback_data: 'admin_dashboard' }]);
    return await editMessageText(chatId, messageId, text, { inline_keyboard: buttons });
  }

  if (data.startsWith('adm_dep_appr:')) {
    const depId = parseInt(data.split(':')[1], 10);
    await approveDeposit(depId, userId);
    return await renderAdminDashboard(chatId, messageId);
  }

  if (data.startsWith('adm_dep_rej:')) {
    const depId = parseInt(data.split(':')[1], 10);
    await rejectDeposit(depId, userId);
    return await renderAdminDashboard(chatId, messageId);
  }

  if (data.startsWith('adm_ord_appr:')) {
    const orderId = parseInt(data.split(':')[1], 10);
    await approveManualPayment(orderId, userId);
    return await renderAdminDashboard(chatId, messageId);
  }

  if (data.startsWith('adm_ord_rej:')) {
    const orderId = parseInt(data.split(':')[1], 10);
    await rejectManualPayment(orderId, userId);
    return await renderAdminDashboard(chatId, messageId);
  }

  if (data.startsWith('adm_fulfill_prompt:')) {
    const orderId = parseInt(data.split(':')[1], 10);
    await setUserState(userId, 'ADM_FULFILL_INPUT', { orderId });
    return await sendMessage(
      chatId,
      `📦 <b>ENTER DELIVERY CREDENTIALS FOR #ORD${orderId}</b>\n\n` +
      `Reply with the account login, license key, or instructions to deliver to the customer:`
    );
  }

  if (data === 'admin_broadcast_prompt') {
    await setUserState(userId, 'ADM_BROADCAST_TEXT');
    return await editMessageText(
      chatId,
      messageId,
      `📢 <b>CREATE STORE BROADCAST</b>\n\n` +
      `Reply with the exact text or announcement you want to send to all users. (HTML supported):`,
      { inline_keyboard: [[{ text: '👈 Cancel', callback_data: 'admin_dashboard' }]] }
    );
  }

  if (data === 'adm_broadcast_dispatch') {
    const { state: bState, data: bData } = await getUserState(userId);
    if (bState !== 'ADM_BROADCAST_CONFIRM' || !bData?.text) {
      return await sendMessage(chatId, 'Broadcast expired.');
    }
    await sendMessage(chatId, 'Broadcasting started...');
    await clearUserState(userId);

    const db = getPool();
    const [users] = await db.query('SELECT id FROM users WHERE is_banned = 0');
    let sent = 0;
    for (const u of users) {
      try {
        await sendMessage(u.id, bData.text);
        sent++;
        await new Promise(r => setTimeout(r, 35));
      } catch (e) {
        // Ignored
      }
    }
    await logAdminAction(userId, 'BROADCAST_SENT', `Broadcast sent to ${sent} users.`);
    return await sendMessage(ADMIN_ID, `✅ Broadcast delivered to <b>${sent}</b> users.`);
  }

  if (data.startsWith('admin_logs:')) {
    const db = getPool();
    const [logs] = await db.query('SELECT * FROM admin_logs ORDER BY id DESC LIMIT 10');
    let text = `📝 <b>RECENT ADMIN LOGS:</b>\n\n`;
    for (const l of logs) {
      text += `[${new Date(l.created_at).toISOString().substring(11, 19)}] <b>${l.action}</b>\n${l.details}\n\n`;
    }
    return await editMessageText(chatId, messageId, text, {
      inline_keyboard: [[{ text: '👈 Back', callback_data: 'admin_dashboard' }]]
    });
  }
}

// ============================================================================
// 17. MAIN VERCEL SERVERLESS HANDLER
// ============================================================================
export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      await initDatabase();
      const db = getPool();
      const [tables] = await db.query('SHOW TABLES');

      const tgRes = await fetch(`${TELEGRAM_API}/getMe`);
      const tgData = await tgRes.json();

      return res.status(200).json({
        status: 'SUCCESS! Bot backend is 100% operational.',
        database: 'Connected and SSL Verified',
        tables_created: tables.length,
        telegram_bot: tgData.ok ? `@${tgData.result.username} (Connected)` : tgData,
        admin_id: ADMIN_ID,
        instruction: 'Open Telegram and send /start to your bot!'
      });
    } catch (err) {
      return res.status(500).json({
        status: 'DATABASE OR SERVER ERROR',
        error_message: err.message,
        error_code: err.code || 'UNKNOWN',
        sql_message: err.sqlMessage || 'None'
      });
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const update = req.body;
  if (!update || typeof update !== 'object') {
    return res.status(400).json({ error: 'Invalid update payload.' });
  }

  try {
    await initDatabase();
    const db = getPool();

    // 1. Handle Callback Queries
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
      return res.status(200).json({ ok: true });
    }

    // 2. Handle Messages
    if (update.message) {
      const msg = update.message;
      const fromUser = msg.from;
      if (!fromUser) return res.status(200).json({ ok: true });

      const chatId = msg.chat.id;
      const userId = fromUser.id;
      const text = msg.text ? msg.text.trim() : '';

      await syncUser(fromUser);

      let photoFileId = null;
      if (msg.photo && msg.photo.length > 0) {
        photoFileId = msg.photo[msg.photo.length - 1].file_id;
      }

      const handled = await handleUserTextInput(chatId, userId, text, photoFileId);
      if (handled) {
        return res.status(200).json({ ok: true });
      }

      // Commands
      if (text.startsWith('/start')) {
        await clearUserState(userId);
        if (Number(userId) === ADMIN_ID) {
          await sendMessage(
            chatId,
            `👑 <b>Welcome Admin</b>\n\n${STORE_NAME} Administration Panel`,
            {
              inline_keyboard: [
                [{ text: '⚙️ Admin Panel', callback_data: 'admin_dashboard' }],
                [{ text: '📁 Browse Store', callback_data: 'store_page:0' }]
              ]
            }
          );
        } else {
          await sendMessage(
            chatId,
            `🛍 <b>Welcome to ${STORE_NAME}</b>\n\n` +
            `Your digital marketplace for AI tools, streaming, accounts, and licenses with instant delivery and guaranteed warranty.\n\n` +
            `Select an option below to get started:`,
            getCustomerMainMenuKeyboard(userId)
          );
        }
        return res.status(200).json({ ok: true });
      }

      if (text === '/admin' || text === '/dashboard') {
        if (Number(userId) !== ADMIN_ID) {
          await sendMessage(chatId, '❌ Unauthorized command.');
        } else {
          await renderAdminDashboard(chatId);
        }
        return res.status(200).json({ ok: true });
      }

      if (text === '/store') {
        await renderStorePage(chatId, null, 0);
        return res.status(200).json({ ok: true });
      }

      if (text === '/wallet') {
        await renderWalletMenu(chatId, null, userId);
        return res.status(200).json({ ok: true });
      }

      if (text === '/orders') {
        await renderUserOrders(chatId, null, userId, 0);
        return res.status(200).json({ ok: true });
      }

      if (text === '/profile') {
        await renderUserProfile(chatId, null, fromUser);
        return res.status(200).json({ ok: true });
      }

      if (text === '/help') {
        await sendMessage(
          chatId,
          `ℹ️ <b>ISell Store Help</b>\n\n` +
          `• Use /store to explore our software catalog.\n` +
          `• Use /wallet to deposit and check your balance.\n` +
          `• Use /orders to view your past purchases.\n` +
          `• Contact @${SUPPORT_USERNAME} for support.`,
          getCustomerMainMenuKeyboard(userId)
        );
        return res.status(200).json({ ok: true });
      }

      // Default fallback
      await sendMessage(
        chatId,
        `👋 Hello! Please use the menu below to navigate <b>${STORE_NAME}</b>:`,
        getCustomerMainMenuKeyboard(userId)
      );
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Unhandled webhook error:', err);
    return res.status(200).json({ error: err.message });
  }
}