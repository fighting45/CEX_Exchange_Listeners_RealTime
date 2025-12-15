const crypto = require("crypto");
const WebSocket = require("ws");
const axios = require("axios");
require("dotenv").config();

// Configuration
const CONFIG = {
  API_KEY: process.env.ACCESS_KEY,
  SECRET_KEY: process.env.SECRET_KEY,
  BASE_URL: "https://api.mexc.com",
  WS_URL: "wss://wbs.mexc.com/ws",
  KEEPALIVE_INTERVAL: 30 * 60 * 1000, // 30 minutes (keepalive before 60min expiry)
};

class MEXCListener {
  constructor() {
    this.listenKey = null;
    this.ws = null;
    this.keepaliveTimer = null;
    this.heartbeatTimer = null;
    this.connectionTime = null;
  }

  // Generate signature for signed requests
  generateSignature(queryString) {
    return crypto
      .createHmac("sha256", CONFIG.SECRET_KEY)
      .update(queryString)
      .digest("hex");
  }

  // Create listen key
  async createListenKey() {
    try {
      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}`;
      const signature = this.generateSignature(queryString);

      const response = await axios.post(
        `${CONFIG.BASE_URL}/api/v3/userDataStream?${queryString}&signature=${signature}`,
        {},
        {
          headers: {
            "X-MEXC-APIKEY": CONFIG.API_KEY,
          },
        }
      );

      this.listenKey = response.data.listenKey;
      console.log("✅ Listen Key created:", this.listenKey);
      return this.listenKey;
    } catch (error) {
      console.error(
        "❌ Error creating listen key:",
        error.response?.data || error.message
      );
      throw error;
    }
  }

  // Keep listen key alive
  async keepAliveListenKey() {
    try {
      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}&listenKey=${this.listenKey}`;
      const signature = this.generateSignature(queryString);

      await axios.put(
        `${CONFIG.BASE_URL}/api/v3/userDataStream?${queryString}&signature=${signature}`,
        {},
        {
          headers: {
            "X-MEXC-APIKEY": CONFIG.API_KEY,
          },
        }
      );

      console.log("🔄 Listen Key kept alive at", new Date().toISOString());
    } catch (error) {
      console.error(
        "❌ Error keeping listen key alive:",
        error.response?.data || error.message
      );
      // Try to recreate connection if keepalive fails
      await this.reconnect();
    }
  }

  // Delete listen key
  async deleteListenKey() {
    try {
      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}&listenKey=${this.listenKey}`;
      const signature = this.generateSignature(queryString);

      await axios.delete(
        `${CONFIG.BASE_URL}/api/v3/userDataStream?${queryString}&signature=${signature}`,
        {
          headers: {
            "X-MEXC-APIKEY": CONFIG.API_KEY,
          },
        }
      );

      console.log("🗑️  Listen Key deleted");
    } catch (error) {
      console.error(
        "❌ Error deleting listen key:",
        error.response?.data || error.message
      );
    }
  }

  // Connect to WebSocket
  async connectWebSocket() {
    if (!this.listenKey) {
      await this.createListenKey();
    }

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${CONFIG.WS_URL}?listenKey=${this.listenKey}`);

      this.ws.on("open", () => {
        this.connectionTime = Date.now();
        console.log("🔌 WebSocket connected at", new Date().toISOString());
        this.startKeepalive();
        this.startHeartbeat();
        resolve();
      });

      this.ws.on("message", async (data) => {
        try {
          const message = JSON.parse(data);
          console.log("📨 Received:", message);
          await this.saveToDatabase(message);
        } catch (error) {
          console.error("❌ Error processing message:", error);
        }
      });

      this.ws.on("error", (error) => {
        console.error("❌ WebSocket error:", error);
        reject(error);
      });

      this.ws.on("close", (code, reason) => {
        const duration = this.connectionTime
          ? Math.floor((Date.now() - this.connectionTime) / 1000)
          : 0;
        console.log(
          `🔌 WebSocket disconnected after ${duration}s - Code: ${code}, Reason: ${
            reason || "No reason provided"
          }`
        );
        this.stopKeepalive();
        this.stopHeartbeat();
        // Auto-reconnect after 5 seconds
        setTimeout(() => this.reconnect(), 5000);
      });

      this.ws.on("ping", (data) => {
        console.log("🏓 Received ping from server");
        this.ws.pong(data);
      });

      this.ws.on("pong", () => {
        console.log("🏓 Received pong from server");
      });
    });
  }

  // Start keepalive timer
  startKeepalive() {
    this.keepaliveTimer = setInterval(() => {
      this.keepAliveListenKey();
    }, CONFIG.KEEPALIVE_INTERVAL);
  }

  // Stop keepalive timer
  stopKeepalive() {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  // Start heartbeat (client-side ping)
  startHeartbeat() {
    // Send ping every 20 seconds to keep connection alive
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.log("💓 Sending heartbeat ping");
        this.ws.ping();
      }
    }, 20000); // 20 seconds
  }

  // Stop heartbeat timer
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // Reconnect
  async reconnect() {
    console.log("🔄 Reconnecting...");
    this.stopKeepalive();
    this.stopHeartbeat();

    if (this.ws) {
      this.ws.terminate();
      this.ws = null;
    }

    if (this.listenKey) {
      await this.deleteListenKey();
      this.listenKey = null;
    }

    try {
      await this.connectWebSocket();
    } catch (error) {
      console.error("❌ Reconnection failed:", error);
      setTimeout(() => this.reconnect(), 10000); // Retry after 10 seconds
    }
  }

  // Start the listener
  async start() {
    console.log("🚀 Starting MEXC Listener...");
    await this.connectWebSocket();
  }

  // Stop the listener
  async stop() {
    console.log("🛑 Stopping MEXC Listener...");
    this.stopKeepalive();
    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close();
    }

    if (this.listenKey) {
      await this.deleteListenKey();
    }
  }
}

// Main execution
const listener = new MEXCListener();

// Handle graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n👋 Shutting down gracefully...");
  await listener.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n👋 Shutting down gracefully...");
  await listener.stop();
  process.exit(0);
});

// Start the listener
listener.start().catch((error) => {
  console.error("❌ Failed to start listener:", error);
  process.exit(1);
});
