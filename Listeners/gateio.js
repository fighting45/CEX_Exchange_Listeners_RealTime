const WebSocket = require("ws");

const WS_URL = "wss://api.gateio.ws/ws/v4/";
const CURRENCY_PAIR = "BTC_USDT"; // Change to your preferred pair

function connect() {
  const ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    console.log(
      `Connected to Gate.io - Listening for ${CURRENCY_PAIR} trades\n`
    );

    // Subscribe to spot trades
    const subscribeMsg = {
      time: Math.floor(Date.now() / 1000),
      channel: "spot.trades",
      event: "subscribe",
      payload: [CURRENCY_PAIR],
    };
    ws.send(JSON.stringify(subscribeMsg));

    // Keep connection alive
    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            time: Math.floor(Date.now() / 1000),
            channel: "spot.ping",
          })
        );
      }
    }, 30000);
  });

  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.event === "update" && message.channel === "spot.trades") {
        message.result.forEach((trade) => {
          const time = new Date(trade.create_time * 1000).toISOString();
          const side = trade.side === "sell" ? "🔴 SELL" : "🟢 BUY";
          console.log(`${side} | ${trade.amount} @ $${trade.price} | ${time}`);
        });
      }
    } catch (error) {
      console.error("Error:", error.message);
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error.message);
  });

  ws.on("close", () => {
    console.log("Disconnected. Reconnecting in 5s...");
    setTimeout(connect, 5000);
  });
}

// Start
connect();

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  process.exit(0);
});
