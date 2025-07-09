require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const recommendRouter = require("./routes/recommend.js");

const app = express();

app.use(cors());

app.options("*", cors());
app.use(express.json());

// Rate limiter
const limiter = rateLimit({
	windowMs: 60 * 1000,
	max: parseInt(process.env.RATE_LIMIT_PER_MINUTE, 10) || 60,
	message: { error: "Too many requests, please try again later." },
});
app.use(limiter);

// Mount our recommendation route
app.use("/api/recommend", recommendRouter);

const PORT = process.env.PORT || 3000;
if (require.main === module) {
	app.listen(PORT, () => {
		console.log(`NextTrack prototype running on port ${PORT}`);
	});
}

module.exports = app; // Export for testing
