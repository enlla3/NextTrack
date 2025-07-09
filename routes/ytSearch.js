const express = require("express");
const ytsr = require("yt-search");
const router = express.Router();

router.get("/", async (req, res) => {
	const q = req.query.q;
	if (!q) {
		return res.status(400).json({ error: "q query parameter is required" });
	}

	try {
		const result = await ytsr(q, { limit: 1 });
		const top = result.videos?.[0] || null;

		if (!top) {
			return res.json({ videoId: null });
		}

		return res.json({
			videoId: top.videoId,
			title: top.title,
			author: top.author.name,
			thumbnail: top.thumbnail,
		});
	} catch (err) {
		console.error("yt-search error:", err);
		res.status(502).json({ error: "Failed to fetch from yt-search" });
	}
});

module.exports = router;
