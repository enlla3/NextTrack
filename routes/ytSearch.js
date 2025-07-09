const express = require("express");
const ytSearch = require("yt-search");
const router = express.Router();

router.get("/", (req, res) => {
	const q = req.query.q;
	if (!q) {
		return res.status(400).json({ error: "q query parameter is required" });
	}

	// Use the callback API to avoid promise issues in some envs
	ytSearch(q, (err, data) => {
		if (err) {
			console.error("yt-search error:", err);
			return res
				.status(502)
				.json({ error: "Failed to fetch from yt-search" });
		}

		// data.videos is an array of video results
		const top =
			Array.isArray(data.videos) && data.videos.length > 0
				? data.videos[0]
				: null;

		if (!top) {
			return res.json({ videoId: null });
		}

		// Send minimal payload
		return res.json({
			videoId: top.videoId,
			title: top.title,
			author: top.author?.name || null,
			thumbnail: top.thumbnail,
		});
	});
});

module.exports = router;
