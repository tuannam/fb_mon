const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

// Setup paths relative to src directory
const BASE_DIR = __dirname;
// DATA_DIR: where runtime files live (matches server.js logic)
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(BASE_DIR, "..");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");
const HISTORY_PATH = path.join(DATA_DIR, "history.json");

// Path for status file read by server.js webhook handler
const STATUS_PATH = path.join(DATA_DIR, "status.json");

function writeStatus(data) {
  try {
    fs.writeFileSync(STATUS_PATH, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    log(`Failed to write status.json: ${e.message}`, "WARNING");
  }
}

// Color logs helper
function log(message, level = "INFO") {
  const timestamp = new Date().toLocaleString("sv-SE", { hour12: false }).substring(0, 19);
  const colors = {
    INFO: "\x1b[94m", // Blue
    SUCCESS: "\x1b[92m", // Green
    WARNING: "\x1b[93m", // Yellow
    ERROR: "\x1b[91m", // Red
    RESET: "\x1b[0m",
  };
  const color = colors[level] || colors.RESET;
  console.log(`[${timestamp}] ${color}${level.padEnd(8)}${colors.RESET} | ${message}`);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    log(`Config file not found at ${CONFIG_PATH}. Creating default config.`, "WARNING");
    const defaultConfig = {
      keywords: ["rtx 3090"],
      location_id: "melbourne",
      max_price: 100,
      check_interval_min: 15,
      user_data_dir: "./fb_profile",
      headless: true,
      telegram_token: "YOUR_TELEGRAM_BOT_TOKEN",
      telegram_chat_id: "YOUR_TELEGRAM_CHAT_ID",
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2), "utf-8");
    return defaultConfig;
  }

  try {
    const data = fs.readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(data);
  } catch (e) {
    log(`Error loading config: ${e.message}`, "ERROR");
    process.exit(1);
  }
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_PATH)) {
    return [];
  }
  try {
    const data = fs.readFileSync(HISTORY_PATH, "utf-8");
    return JSON.parse(data);
  } catch (e) {
    log(`Error reading history.json: ${e.message}. Starting fresh.`, "WARNING");
    return [];
  }
}

function saveHistory(history) {
  try {
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), "utf-8");
  } catch (e) {
    log(`Error saving history.json: ${e.message}`, "ERROR");
  }
}

function cleanAndParsePrice(priceStr) {
  if (!priceStr) return 0;
  const pClean = priceStr.toLowerCase().trim();
  if (pClean.includes("miễn phí") || pClean.includes("free")) {
    return 0;
  }
  const digits = priceStr.replace(/\D/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

function parseCardText(lines) {
  const filtered = [];
  const badgeWords = ["được tài trợ", "sponsored", "mới", "new", "cửa hàng", "shop", "đã bán", "sold"];
  for (const line of lines) {
    if (!line) continue;
    if (badgeWords.some((bw) => line.toLowerCase().includes(bw)) && line.length < 15) {
      continue;
    }
    filtered.push(line);
  }

  if (filtered.length === 0) {
    return [null, null];
  }

  let priceStr = null;
  let titleStr = null;

  for (let idx = 0; idx < filtered.length; idx++) {
    const val = filtered[idx];
    const hasDigit = /\d/.test(val);
    const hasCurrency = ["₫", "$", "đ", "đ", "vnd", "usd", "€", "£"].some((c) => val.toLowerCase().includes(c));
    const isFree = val.toLowerCase().includes("miễn phí") || val.toLowerCase().includes("free");

    if ((hasDigit || isFree || hasCurrency) && val.length < 25) {
      priceStr = val;
      if (idx + 1 < filtered.length) {
        titleStr = filtered[idx + 1];
      }
      break;
    }
  }

  if (!priceStr && filtered.length >= 2) {
    priceStr = filtered[0];
    titleStr = filtered[1];
  }

  return [priceStr, titleStr];
}

async function sendTelegramNotification(token, chatId, text) {
  if (!token || !chatId || token.includes("YOUR_TELEGRAM") || chatId.includes("YOUR_TELEGRAM")) {
    log("Telegram credentials not configured properly. Skipping message.", "WARNING");
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "HTML",
      }),
    });
    const resJson = await response.json();
    if (resJson.ok) {
      log("Telegram notification sent successfully!", "SUCCESS");
      return true;
    } else {
      log(`Telegram API returned error: ${JSON.stringify(resJson)}`, "ERROR");
      return false;
    }
  } catch (e) {
    log(`Failed to send Telegram notification: ${e.message}`, "ERROR");
    return false;
  }
}

async function handleLogin(userDataDir) {
  log("Starting manual login flow. Opening browser...", "INFO");

  // Remove stale Chromium lock files (including broken symlinks) from previous crashed sessions
  const lockFiles = ["SingletonLock", "SingletonCookie", "SingletonSocket"];
  lockFiles.forEach((f) => {
    const lockPath = path.join(userDataDir, f);
    try {
      fs.unlinkSync(lockPath);
    } catch (_) {} // unlinkSync handles symlinks; ignore if not found
  });
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: ["--disable-blink-features=AutomationControlled", "--disable-infobars"],
  });

  const page = await context.newPage();
  await page.goto("https://www.facebook.com");

  console.log("*".repeat(60));
  console.log("ACTION REQUIRED:");
  console.log("1. Log in to your Facebook account in the browser window.");
  console.log("2. Complete 2FA / CAPTCHA if prompted.");
  console.log("3. Once you see the Facebook home feed, go back to the");
  console.log("   dashboard and click 'Logged in - Save Session'.");
  console.log("*".repeat(60));

  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", () => {
      resolve();
    });
  });

  await page.waitForTimeout(2000);
  await context.close();
  log("Manual login session completed and saved successfully!", "SUCCESS");
  process.exit(0);
}

async function monitorKeywords(config, history, dryRun = false) {
  const configUserDir = config.user_data_dir || "./fb_profile";
  // Resolve user_data_dir relative to the project root (one level up from src)
  const userDataDir = path.isAbsolute(configUserDir) ? configUserDir : path.resolve(BASE_DIR, "..", configUserDir);

  const headless = config.headless !== undefined ? config.headless : true;
  const keywords = config.keywords || [];
  const maxPrice = config.max_price;
  const locationId = config.location_id;
  const telegramToken = config.telegram_token || "";
  const telegramChatId = config.telegram_chat_id || "";

  if (keywords.length === 0) {
    log("No keywords specified in config.json.", "ERROR");
    return;
  }

  log(`Starting FB Marketplace monitor with {${keywords.length}} keywords.`, "INFO");
  if (dryRun) {
    log("Running in DRY-RUN mode. No Telegram notifications will be sent.", "WARNING");
  }

  log(`Loading persistent profile from: ${userDataDir} (Headless: ${headless})`, "INFO");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: headless,
    viewport: { width: 1280, height: 800 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-infobars"],
  });

  const page = await context.newPage();

  log("Navigating to Facebook to verify login status...", "INFO");
  await page.goto("https://www.facebook.com", { waitUntil: "load" });
  await page.waitForTimeout(2000);

  const currentUrl = page.url();
  const pageHtml = await page.content();
  const isLoggedOut =
    currentUrl.includes("/login") || currentUrl.includes("login.php") || pageHtml.includes('id="loginbutton"') || pageHtml.includes('name="login"');

  if (isLoggedOut) {
    log("User is not logged in! Please use the 'Facebook Login' button on the dashboard to authenticate first.", "ERROR");
    await context.close();
    return;
  }

  log("Login status verified. Session is active.", "SUCCESS");

  for (const keyword of keywords) {
    log(`Searching Marketplace for keyword: '${keyword}'`, "INFO");

    const encodedQuery = encodeURIComponent(keyword);
    let searchUrl = `https://www.facebook.com/marketplace/search/?query=${encodedQuery}`;
    if (locationId) {
      searchUrl = `https://www.facebook.com/marketplace/${locationId}/search/?query=${encodedQuery}`;
    }

    try {
      await page.goto(searchUrl, { waitUntil: "load", timeout: 60000 });
      await page.waitForTimeout(3000 + Math.random() * 2000);
    } catch (e) {
      log(`Error loading search results for '${keyword}': ${e.message}`, "ERROR");
      continue;
    }

    log("Scrolling page to fetch more results...", "INFO");
    for (let scrollIdx = 0; scrollIdx < 3; scrollIdx++) {
      await page.mouse.wheel(0, 1000);
      await page.waitForTimeout(1500 + Math.random() * 1000);
    }

    const itemLinks = page.locator('a[href*="/marketplace/item/"]');
    const linkCount = await itemLinks.count();
    log(`Found ${linkCount} potential item cards.`, "INFO");

    const foundListings = [];
    for (let i = 0; i < linkCount; i++) {
      try {
        const link = itemLinks.nth(i);
        const href = await link.getAttribute("href");
        if (!href) continue;

        const match = href.match(/\/marketplace\/item\/(\d+)/);
        if (!match) continue;
        const itemId = match[1];

        if (foundListings.some((item) => item.id === itemId)) {
          continue;
        }

        const text = await link.innerText();
        const lines = text
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l);

        const [priceStr, titleStr] = parseCardText(lines);
        const priceVal = cleanAndParsePrice(priceStr);

        foundListings.push({
          id: itemId,
          title: titleStr || `Item ${itemId}`,
          priceStr: priceStr || "Unknown",
          price: priceVal,
          url: `https://www.facebook.com/marketplace/item/${itemId}/`,
        });
      } catch (e) {
        // Ignore single card errors
      }
    }

    log(`Parsed ${foundListings.length} unique listings.`, "INFO");

    // Collect qualifying new items first
    const newItems = [];
    for (const item of foundListings) {
      if (history.includes(item.id)) continue;
      if (maxPrice && item.price > maxPrice) {
        log(`  Skipping: ${item.title} | AU$${item.price} exceeds budget limit of AU$${maxPrice}.`, "INFO");
        continue;
      }
      newItems.push(item);
    }

    if (newItems.length === 0) {
      log(`No new items found for '${keyword}'.`, "INFO");
    } else {
      log(`----------------- (${newItems.length} new item${newItems.length > 1 ? "s" : ""} found for '${keyword}') -----------------`, "INFO");

      // Send summary header to Telegram first
      const summaryLines = newItems.map((it, i) => `${i + 1}. ${it.title} — ${it.priceStr}`).join("\n");
      const summaryMsg =
        `🔔 <b>[Marketplace Monitor] ${newItems.length} new listing${newItems.length > 1 ? "s" : ""} for "${keyword}"</b>\n\n` + `${summaryLines}`;
      if (!dryRun) {
        await sendTelegramNotification(telegramToken, telegramChatId, summaryMsg);
      } else {
        log(`[DRY-RUN] Would send summary: ${newItems.length} items for '${keyword}'`, "SUCCESS");
      }

      // Send individual messages per item
      for (const item of newItems) {
        log(`  → ${item.title} | ${item.priceStr} (${item.price} AUD) | ID: ${item.id}`, "INFO");

        const tgMsg = `📦 <b>${item.title}</b>\n` + `💰 <b>Price:</b> ${item.priceStr}\n` + `🔗 <a href="${item.url}">View on Facebook Marketplace</a>`;

        let success = false;
        if (dryRun) {
          log(`[DRY-RUN] Would send: ${item.title}`, "SUCCESS");
          success = true;
        } else {
          success = await sendTelegramNotification(telegramToken, telegramChatId, tgMsg);
        }

        if (success) {
          if (!dryRun) {
            history.push(item.id);
            saveHistory(history);
          }
          await page.waitForTimeout(500 + Math.random() * 1000);
        } else {
          log("Failed to send notification for this item.", "WARNING");
          await page.waitForTimeout(2000 + Math.random() * 2000);
        }
      }

      log(`----------------- (done) -----------------`, "INFO");
    }
  }

  await context.close();
  log("Search run completed successfully.", "SUCCESS");
}

async function main() {
  const args = process.argv.slice(2);
  const isLogin = args.includes("--login");
  const isDryRun = args.includes("--dry-run");
  const isTestTelegram = args.includes("--test-telegram");
  const keywordIndex = args.indexOf("--keyword");
  const overrideKeyword = keywordIndex !== -1 && args[keywordIndex + 1] ? args[keywordIndex + 1] : null;

  const config = loadConfig();
  const history = loadHistory();

  if (overrideKeyword) {
    config.keywords = [overrideKeyword];
  }

  if (isLogin) {
    const configUserDir = config.user_data_dir || "./fb_profile";
    const userDataDir = path.isAbsolute(configUserDir) ? configUserDir : path.resolve(BASE_DIR, "..", configUserDir);
    await handleLogin(userDataDir);
    return;
  }

  if (isTestTelegram) {
    const token = config.telegram_token || "";
    const chatId = config.telegram_chat_id || "";
    const testMsg = "🔔 <b>Marketplace Monitor Test</b>\n\nSuccess! Your Telegram bot is connected and working correctly.";
    await sendTelegramNotification(token, chatId, testMsg);
    process.exit(0);
  }

  try {
    while (true) {
      const config = loadConfig(); // reload config each cycle so dashboard changes take effect
      const history = loadHistory();
      await monitorKeywords(config, history, isDryRun);
      const baseMin = config.check_interval_min || 15;
      const jitterMin = 1 + Math.random() * 2; // random 1–3 min
      const sign = Math.random() < 0.5 ? 1 : -1;
      const actualMin = Math.max(1, baseMin + sign * jitterMin);
      const intervalMs = actualMin * 60 * 1000;
      const nextScanAt = Date.now() + intervalMs;

      // Write status for webhook handler to read
      writeStatus({
        running: true,
        keywords: config.keywords || [],
        location_id: config.location_id || "",
        max_price: config.max_price || null,
        check_interval_min: baseMin,
        nextScanAt,
        lastScanAt: Date.now(),
      });

      log(`Next scan in ${actualMin.toFixed(1)} minutes (base: ${baseMin} min, jitter: ${sign > 0 ? "+" : ""}${(sign * jitterMin).toFixed(1)} min)...`, "INFO");
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  } catch (e) {
    log(`An unexpected error occurred: ${e.message}`, "ERROR");
  }
}

main();
