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
const SIMILAR_LIMIT = 100;
const SEARCH_LIMIT = 1;
const DELIM = "|||";

// 1) Autocorrect via track.search
async function searchTrack(title, artist) {
	console.log(`[searchTrack] Searching for "${title}" by "${artist}"`);
	try {
		const resp = await axios.get(LASTFM_BASE_URL, {
			params: {
				method: "track.search",
				track: title,
				artist,
				api_key: LASTFM_API_KEY,
				format: "json",
				limit: SEARCH_LIMIT,
				autocorrect: 1,
			},
			timeout: 10000,
		});
		const matches = resp.data?.results?.trackmatches?.track;
		if (!matches || !Array.isArray(matches) || matches.length === 0) {
			console.warn(
				`[searchTrack] No matches for "${title}" by "${artist}"`
			);
			return null;
		}
		const best = matches[0];
		return {
			correctedTitle: best.name || title,
			correctedArtist: best.artist || artist,
		};
	} catch (err) {
		console.warn(`[searchTrack] Error:`, err.response?.data || err.message);
		return null;
	}
}

// 2) Get similar tracks
async function fetchSimilarTracks(title, artist) {
	console.log(`[fetchSimilarTracks] "${title}" by "${artist}"`);
	try {
		const resp = await axios.get(LASTFM_BASE_URL, {
			params: {
				method: "track.getSimilar",
				artist,
				track: title,
				api_key: LASTFM_API_KEY,
				format: "json",
				limit: SIMILAR_LIMIT,
				autocorrect: 1,
			},
			timeout: 10000,
		});
		const list = resp.data?.similartracks?.track;
		if (!Array.isArray(list)) {
			return [];
		}
		return list.map((t) => ({
			title: t.name,
			artist: t.artist?.name || "",
			matchScore: parseFloat(t.match) || 0,
		}));
	} catch (err) {
		console.warn(
			`[fetchSimilarTracks] Error:`,
			err.response?.data || err.message
		);
		return [];
	}
}

// 3) Fetch top tags (optionally all)
async function fetchTopTags(title, artist, returnAll = false) {
	console.log(`[fetchTopTags] "${title}" by "${artist}"`);
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
			timeout: 10000,
		});
		const tags = resp.data?.toptags?.tag;
		if (!Array.isArray(tags) || tags.length === 0) {
			return returnAll ? [] : null;
		}
		return returnAll
			? tags.map((t) => t.name.toLowerCase())
			: tags[0].name.toLowerCase();
	} catch (err) {
		console.warn(
			`[fetchTopTags] Error:`,
			err.response?.data || err.message
		);
		return returnAll ? [] : null;
	}
}

// 4) Fetch top tracks for a tag
async function fetchTagTopTracks(tagName) {
	console.log(`[fetchTagTopTracks] tag="${tagName}"`);
	try {
		const resp = await axios.get(LASTFM_BASE_URL, {
			params: {
				method: "tag.getTopTracks",
				tag: tagName,
				api_key: LASTFM_API_KEY,
				format: "json",
				limit: SIMILAR_LIMIT,
			},
			timeout: 10000,
		});
		const list = resp.data?.tracks?.track;
		if (!Array.isArray(list)) {
			return [];
		}
		return list.map((t) => ({
			title: t.name,
			artist: t.artist?.name || "",
		}));
	} catch (err) {
		console.warn(
			`[fetchTagTopTracks] Error:`,
			err.response?.data || err.message
		);
		return [];
	}
}

// 5) Fetch artist's top track
async function fetchArtistTopTrack(artistName) {
	console.log(`[fetchArtistTopTrack] artist="${artistName}"`);
	try {
		const resp = await axios.get(LASTFM_BASE_URL, {
			params: {
				method: "artist.getTopTracks",
				artist: artistName,
				api_key: LASTFM_API_KEY,
				format: "json",
				limit: SIMILAR_LIMIT,
				autocorrect: 1,
			},
			timeout: 10000,
		});
		const list = resp.data?.toptracks?.track;
		if (!list || (Array.isArray(list) && list.length === 0)) {
			return null;
		}
		const top = Array.isArray(list) ? list[0] : list;
		return { title: top.name, artist: top.artist?.name || artistName };
	} catch (err) {
		console.warn(
			`[fetchArtistTopTrack] Error:`,
			err.response?.data || err.message
		);
		return null;
	}
}

// 6) Fetch global top track
async function fetchGlobalTopTrack() {
	console.log(`[fetchGlobalTopTrack]`);
	try {
		const resp = await axios.get(LASTFM_BASE_URL, {
			params: {
				method: "chart.getTopTracks",
				api_key: LASTFM_API_KEY,
				format: "json",
				limit: SIMILAR_LIMIT,
			},
			timeout: 10000,
		});
		const list = resp.data?.tracks?.track;
		if (!list || (Array.isArray(list) && list.length === 0)) {
			return null;
		}
		const top = Array.isArray(list) ? list[0] : list;
		return { title: top.name, artist: top.artist?.name || "" };
	} catch (err) {
		console.warn(
			`[fetchGlobalTopTrack] Error:`,
			err.response?.data || err.message
		);
		return null;
	}
}

// 7) Preference scoring
function applyPreferenceBoost(track, preferences, tags) {
	let scoreBoost = 0;
	const tagSet = new Set(tags.map((t) => t.toLowerCase()));
	if (
		preferences.favorite_artists?.some(
			(a) => a.toLowerCase() === track.artist.toLowerCase()
		)
	) {
		scoreBoost += 5;
	}
	if (
		preferences.preferred_genres?.some((g) => tagSet.has(g.toLowerCase()))
	) {
		scoreBoost += 3;
	}
	if (
		preferences.preferred_languages?.some((l) =>
			tagSet.has(l.toLowerCase())
		)
	) {
		scoreBoost += 2;
	}
	return scoreBoost;
}

// 8) Borda aggregation
function bordaAggregate(seedsMap) {
	const scores = {};
	for (const list of Object.values(seedsMap)) {
		const L = list.length;
		list.forEach((key, i) => {
			scores[key] = (scores[key] || 0) + (L - i);
		});
	}
	const maxScore = Math.max(...Object.values(scores));
	const tied = Object.keys(scores).filter((k) => scores[k] === maxScore);
	const winner = tied[Math.floor(Math.random() * tied.length)];
	console.log(`[BordaAggregate] Winner: ${winner}`);
	return winner;
}

// === MAIN ROUTE ===
router.post("/", async (req, res) => {
	try {
		const { track_ids, preferences = {} } = req.body;
		if (!Array.isArray(track_ids) || track_ids.length === 0) {
			return res
				.status(400)
				.json({ error: "track_ids (non-empty array) is required" });
		}

		const seedsMap = {};
		for (const entry of track_ids) {
			if (
				!entry ||
				typeof entry.title !== "string" ||
				typeof entry.artist !== "string"
			) {
				continue;
			}

			// Autocorrect
			let { title, artist } = entry;
			const found = await searchTrack(title, artist);
			if (found) {
				title = found.correctedTitle;
				artist = found.correctedArtist;
			}

			const seedKey = `${artist}${DELIM}${title}`;
			let similarList = await fetchSimilarTracks(title, artist);

			// Fallback to tags → artist
			if (similarList.length === 0) {
				const topTag = await fetchTopTags(title, artist);
				if (topTag) {
					const tagTracks = await fetchTagTopTracks(topTag);
					similarList = tagTracks.map((t) => ({
						...t,
						matchScore: 0,
					}));
				} else {
					const topArtist = await fetchArtistTopTrack(artist);
					similarList = topArtist
						? [{ ...topArtist, matchScore: 0 }]
						: [];
				}
			}

			// Preference scoring
			const enhanced = [];
			for (const t of similarList) {
				const tags = await fetchTopTags(t.title, t.artist, true);
				const boost = applyPreferenceBoost(t, preferences, tags);
				enhanced.push({ ...t, scoreBoost: boost });
			}
			enhanced.sort((a, b) =>
				b.scoreBoost !== a.scoreBoost
					? b.scoreBoost - a.scoreBoost
					: b.matchScore - a.matchScore
			);

			seedsMap[seedKey] = enhanced.map(
				(t) => `${t.artist}${DELIM}${t.title}`
			);
		}

		// Remove any seeds with zero candidates
		for (const key of Object.keys(seedsMap)) {
			if (!Array.isArray(seedsMap[key]) || seedsMap[key].length === 0) {
				delete seedsMap[key];
			}
		}

		// Fallback to global top track
		if (Object.keys(seedsMap).length === 0) {
			const globalTop = await fetchGlobalTopTrack();
			if (globalTop) {
				return res.status(200).json({ recommended_track: globalTop });
			}
			return res
				.status(404)
				.json({ error: "No recommendations available." });
		}

		// Borda aggregation
		const winnerKey = bordaAggregate(seedsMap);
		if (!winnerKey) {
			return res
				.status(404)
				.json({ error: "No recommendations available." });
		}

		const [winnerArtist, winnerTitle] = winnerKey.split(DELIM);
		return res.status(200).json({
			recommended_track: { artist: winnerArtist, title: winnerTitle },
		});
	} catch (err) {
		console.error("[route] Internal error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
});

module.exports = router;
