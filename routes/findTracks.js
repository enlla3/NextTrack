const express = require("express");
const axios = require("axios");

const router = express.Router();

const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
if (!LASTFM_API_KEY) {
	console.error(
		"ERROR: Environment variable LASTFM_API_KEY must be set before running."
	);
	process.exit(1);
}

const LASTFM_BASE_URL = "http://ws.audioscrobbler.com/2.0/";
const SEARCH_FETCH_LIMIT = 30;
const TOPTRACKS_LIMIT = 50;
const OUTPUT_LIMIT_MAX = 50;
const TAG_LOOKUPS_MAX = 25;
const TIMEOUT_MS = 10000;

const toL = (s) => (s || "").trim().toLowerCase();

async function searchByTitleOnly(
	title,
	{ page = 1, limit = SEARCH_FETCH_LIMIT }
) {
	try {
		const resp = await axios.get(LASTFM_BASE_URL, {
			params: {
				method: "track.search",
				track: title,
				api_key: LASTFM_API_KEY,
				format: "json",
				limit,
				page,
				autocorrect: 1,
			},
			timeout: TIMEOUT_MS,
		});
		const matches = resp.data?.results?.trackmatches?.track;
		const arr = Array.isArray(matches) ? matches : matches ? [matches] : [];
		return arr.map((t) => ({ title: t.name, artist: t.artist }));
	} catch {
		return [];
	}
}

async function topTracksByArtistOnly(
	artist,
	{ page = 1, limit = TOPTRACKS_LIMIT }
) {
	try {
		const search = await axios.get(LASTFM_BASE_URL, {
			params: {
				method: "artist.search",
				artist,
				api_key: LASTFM_API_KEY,
				format: "json",
				limit: 1,
			},
			timeout: TIMEOUT_MS,
		});
		const hits = search.data?.results?.artistmatches?.artist;
		const best = Array.isArray(hits) ? hits[0] : hits;
		const resolvedArtist = best?.name || artist;

		const top = await axios.get(LASTFM_BASE_URL, {
			params: {
				method: "artist.getTopTracks",
				artist: resolvedArtist,
				api_key: LASTFM_API_KEY,
				format: "json",
				limit,
				page,
				autocorrect: 1,
			},
			timeout: TIMEOUT_MS,
		});
		const list = top.data?.toptracks?.track;
		const arr = Array.isArray(list) ? list : list ? [list] : [];
		return arr.map((t) => ({
			title: t.name,
			artist: t.artist?.name || resolvedArtist,
		}));
	} catch {
		return [];
	}
}

async function fetchTopTags(title, artist) {
	try {
		const resp = await axios.get(LASTFM_BASE_URL, {
			params: {
				method: "track.getTopTags",
				artist,
				track: title,
				api_key: LASTFM_API_KEY,
				format: "json",
				autocorrect: 1,
			},
			timeout: TIMEOUT_MS,
		});
		const tags = resp.data?.toptags?.tag;
		const arr = Array.isArray(tags) ? tags : tags ? [tags] : [];
		return arr.map((t) => toL(t.name));
	} catch {
		return [];
	}
}

async function filterByLanguage(tracks, language) {
	const wanted = toL(language);
	if (!wanted) {
		return tracks;
	}

	const limited = tracks.slice(0, TAG_LOOKUPS_MAX);
	const checks = await Promise.all(
		limited.map(async (t) => {
			const tags = await fetchTopTags(t.title, t.artist);
			return { t, ok: tags.includes(wanted) };
		})
	);

	return checks.filter((c) => c.ok).map((c) => c.t);
}

router.post("/", async (req, res) => {
	try {
		const {
			title,
			artist,
			language,
			limit = 10,
			page = 1,
		} = req.body || {};
		const outLimit = Math.max(
			1,
			Math.min(OUTPUT_LIMIT_MAX, Number(limit) || 10)
		);
		const pageNum = Math.max(1, Number(page) || 1);

		if ((!title && !artist) || (title && artist)) {
			return res.status(400).json({
				error: "Provide exactly one of 'title' or 'artist'. Optional: 'language', 'limit', 'page'.",
			});
		}

		let candidates = [];
		if (title) {
			candidates = await searchByTitleOnly(title, {
				page: pageNum,
				limit: outLimit,
			});
		} else {
			candidates = await topTracksByArtistOnly(artist, {
				page: pageNum,
				limit: outLimit,
			});
		}

		if (language) {
			candidates = await filterByLanguage(candidates, language);
		}

		const results = candidates.slice(0, outLimit);
		return res
			.status(200)
			.json({ results, page: pageNum, limit: outLimit });
	} catch (err) {
		console.error("[find-tracks] Internal error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
});

module.exports = router;
