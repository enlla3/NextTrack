// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const recommendRoute = require("./routes/recommend");
const ytSearchRoute = require("./routes/ytSearch");

const app = express();

// Trust the first proxy (e.g. Render)
app.set("trust proxy", 1);

// Only install rate‐limiter when NOT testing to avoid open timers
if (process.env.NODE_ENV !== "test") {
	app.use(
		rateLimit({
			windowMs: 60_000,
			max: 60,
		})
	);
}

app.use(cors());
app.use(express.json());

app.use("/api/recommend", recommendRoute);
app.use("/api/yt-search", ytSearchRoute);

// Only start listening when run directly
if (require.main === module) {
	const PORT = process.env.PORT || 3000;
	app.listen(PORT, () => {
		console.log(`API listening on port ${PORT}`);
	});
}

module.exports = app;
