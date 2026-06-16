FROM mcr.microsoft.com/playwright:v1.42.0-jammy

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install

# Install Playwright browsers (Chromium only)
RUN npx playwright install chromium

# Install virtual display + VNC stack for headless login
RUN DEBIAN_FRONTEND=noninteractive apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    xvfb x11vnc novnc websockify && \
    rm -rf /var/lib/apt/lists/*

# Copy application source
COPY . .

EXPOSE 3000 6080

CMD ["npx", "tsx", "src/server.ts"]
