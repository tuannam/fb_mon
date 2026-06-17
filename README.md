# FB Marketplace Monitor

A self-hosted Facebook Marketplace watcher that scans for listings matching your keywords and sends Telegram alerts when new matches appear.

The app includes a browser dashboard for configuration, Facebook login, monitor controls, Telegram testing, and live logs. After setup, normal operation can be managed from the dashboard or through Telegram bot commands.

![Dashboard screenshot](docs/screenshot.png)

## What It Does

- Monitors Facebook Marketplace search results with Playwright.
- Filters listings by keyword, location, and maximum price.
- Sends Telegram notifications for new matching listings.
- Tracks seen listing IDs in `history.json` to avoid duplicate alerts.
- Persists Facebook login state in `fb_profile/`.
- Provides a web dashboard at `http://localhost:3000`.
- Supports Docker deployment with noVNC login access on port `6080`.

## Requirements

For local or Raspberry Pi usage:

- Node.js 18+
- npm
- Playwright Chromium

For Docker usage:

- Docker
- Docker Compose

## Quick Start

### 1. Install Dependencies

```bash
npm install
npx playwright install chromium
```

On Linux or Raspberry Pi, install Playwright's system dependencies too:

```bash
npx playwright install-deps
```

### 2. Start the Dashboard

```bash
npm start
```

For development with automatic restart:

```bash
npm run dev
```

Open the dashboard:

```text
http://localhost:3000
```

From another device on the same network, use:

```text
http://<server-ip>:3000
```

### 3. Log In to Facebook

1. Open the **Facebook Login** section in the dashboard.
2. Click **Open Facebook Login**.
3. Log in to Facebook and complete any 2FA or CAPTCHA prompts.
4. When Facebook is fully loaded, click **Logged in - Save Session**.

The saved browser profile is stored in `fb_profile/` and reused on future runs.

For a headless server, log in on a local machine first, then copy `fb_profile/` to the server. Docker deployments can also use the noVNC browser at:

```text
http://<server-ip>:6080/vnc.html
```

### 4. Configure the Monitor

In the dashboard, set:

- Keywords to search for
- Marketplace location
- Maximum price in AUD
- Scan interval
- Telegram bot token and chat ID

Click **Save settings**, then **Start monitor**.

## Configuration Files

Runtime files are created automatically on first run.

| File | Local path | Docker path | Purpose |
| --- | --- | --- | --- |
| Config | `config.json` | `data/config.json` | Keywords, location, price limit, Telegram credentials |
| History | `history.json` | `data/history.json` | Seen listing IDs |
| Logs | `monitor.log` | `data/monitor.log` | Monitor and dashboard logs |
| Facebook profile | `fb_profile/` | `fb_profile/` | Saved Facebook session |

The app bootstraps `config.json` from `config.example.json` if no config exists.

Example config:

```json
{
  "keywords": ["rtx 3090"],
  "location_id": "melbourne",
  "max_price": 2000,
  "check_interval_min": 15,
  "user_data_dir": "./fb_profile",
  "headless": true,
  "telegram_token": "YOUR_TELEGRAM_BOT_TOKEN",
  "telegram_chat_id": "YOUR_TELEGRAM_CHAT_ID",
  "telegram_webhook_url": ""
}
```

## Telegram Setup

1. Open Telegram and message `@BotFather`.
2. Send `/newbot` and follow the prompts.
3. Copy the bot token.
4. Send any message to your new bot, such as `hello`.
5. In the dashboard, use the Telegram setup helper to fetch your chat ID.
6. Save the bot token and chat ID.
7. Click **Test Telegram**.

### Telegram Commands

Telegram commands require a webhook. See the webhook section below.

| Command | Description |
| --- | --- |
| `/status` or `/s` | Show monitor status, keywords, max price, and next scan time |
| `/start` | Start monitoring |
| `/stop` | Stop monitoring |
| `/keyword <text>` or `/k <text>` | Replace the current keyword |
| `/maxprice <amount>` or `/mp <amount>` | Set max price in AUD. Use `0` for no limit |
| `/help` or `/h` | Show available commands |

Examples:

```text
/k rtx 4090
/mp 1500
/status
```

## Telegram Webhook

Telegram commands require Telegram to reach this app over HTTPS. Expose only the webhook route publicly.

Example nginx configuration:

```nginx
server {
    listen 80;
    server_name static.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name static.yourdomain.com;

    ssl_certificate /path/to/fullchain.cer;
    ssl_certificate_key /path/to/yourdomain.key;

    location /telegram-webhook {
        proxy_pass http://localhost:3000/telegram-webhook;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location / {
        return 404;
    }
}
```

Then set this value in the dashboard:

```text
https://static.yourdomain.com/telegram-webhook
```

Save the configuration. The app registers the webhook with Telegram automatically.

## Docker Deployment

Build and start the app:

```bash
docker compose up -d --build
```

Dashboard:

```text
http://<server-ip>:3000
```

noVNC login browser:

```text
http://<server-ip>:6080/vnc.html
```

The Docker Compose setup mounts:

| Host path | Container path | Purpose |
| --- | --- | --- |
| `./data` | `/app/data` | Config, history, status, logs |
| `./fb_profile` | `/app/fb_profile` | Facebook browser profile |
| `./src` | `/app/src` | Mounted source code |

The container runs `tsx src/server.ts`. After changing source files or running `git pull`, restart the container:

```bash
docker compose restart
```

Rebuild only when package dependencies or the Dockerfile change:

```bash
docker compose up -d --build
```

## PM2 Deployment

For a non-Docker server:

```bash
sudo npm install pm2 -g
pm2 start --interpreter tsx src/server.ts --name fb-monitor
pm2 startup
pm2 save
```

## Project Structure

```text
.
├── src/
│   ├── server.ts        # Express app bootstrap and startup
│   ├── routes.ts        # Route mappings
│   ├── handlers.ts      # Dashboard, monitor, login, and webhook handlers
│   ├── telegram.ts      # Telegram API helpers
│   ├── utils.ts         # App state, logs, login session helpers
│   ├── monitor.js       # Playwright scraper and Telegram notifier
│   └── public/
│       ├── index.html   # Dashboard UI
│       ├── app.js       # Dashboard frontend logic
│       └── style.css    # Dashboard styles
├── docs/
│   └── screenshot.png
├── config.example.json
├── Dockerfile
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

## Useful Commands

```bash
npm start          # Start dashboard
npm run dev        # Start dashboard with auto-reload
npm run build      # Type-check and compile TypeScript
docker compose logs -f
docker compose restart
```

## Troubleshooting

If Telegram test fails:

- Confirm the bot token is copied exactly.
- Send a message to the bot before fetching the chat ID.
- Confirm the saved chat ID matches your Telegram account or group.

If Facebook login does not save:

- Wait until the Facebook home page is fully loaded before saving.
- Clear profile lock files from the dashboard if a previous browser crashed.
- Restart the dashboard and try the login flow again.

If no listings appear:

- Run a dry run from the dashboard.
- Check that the Marketplace location and keyword return results in a normal browser.
- Review `monitor.log` from the dashboard or the local file.

## Disclaimer

Automation against Facebook may violate Facebook's Terms of Service. Use this project only for personal monitoring, keep scan intervals reasonable, and understand the risk of account restrictions.
