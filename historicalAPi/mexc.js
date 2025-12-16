const axios = require("axios");
const url = "/api/v3/capital/withdraw/history";
function generateSignature(queryString) {
  return crypto
    .createHmac("sha256", CONFIG.SECRET_KEY)
    .update(queryString)
    .digest("hex");
}
const response = await axios.get(url);
