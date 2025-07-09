const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const recommendRoute = require("./routes/recommend");
const ytSearchRoute = require("./routes/ytSearch");

const app = express();

// Trust Render’s proxy so express-rate-limit can read X-Forwarded-For
app.set("trust proxy", 1);

// Basic rate‐limiting
app.use(
	rateLimit({
		windowMs: 60_000, // 1 minute
		max: 60, // limit each IP to 60 requests per window
	})
);

app.use(cors());
app.use(express.json());

// Mount the routes
app.use("/api/recommend", recommendRoute);
app.use("/api/yt-search", ytSearchRoute);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`API listening on port ${PORT}`);
});
