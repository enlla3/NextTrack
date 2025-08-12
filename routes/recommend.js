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

// ------------------ helpers ------------------
const toL = (s) => (s || "").trim().toLowerCase();
const sameArtist = (a, b) => toL(a) === toL(b);

// 1) Autocorrect via track.search
async function searchTrack(title, artist) {
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
		if (!Array.isArray(matches) || matches.length === 0) {
			return null;
		}
		const best = matches[0];
		return {
			correctedTitle: best.name || title,
			correctedArtist: best.artist || artist,
		};
	} catch {
		return null;
	}
}

// 2) Fetch similar tracks
async function fetchSimilarTracks(title, artist) {
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
	} catch {
		return [];
	}
}

// 3) Fetch top tags
async function fetchTopTags(title, artist, returnAll = false) {
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
	} catch {
		return returnAll ? [] : null;
	}
}

// 4) Fetch top tracks by tag
async function fetchTagTopTracks(tagName) {
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
	} catch {
		return [];
	}
}

// 5) Fetch artist's top track
async function fetchArtistTopTrack(artistName) {
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
	} catch {
		return null;
	}
}

// 6) Fetch global top track
async function fetchGlobalTopTrack() {
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
	} catch {
		return null;
	}
}

// 7) Apply user preference scoring
function applyPreferenceBoost(track, preferences, tags) {
	let boost = 0;
	const tagSet = new Set((tags || []).map((t) => t.toLowerCase()));
	if (
		preferences.favorite_artists?.some((a) => toL(a) === toL(track.artist))
	) {
		boost += 5;
	}
	if (preferences.preferred_genres?.some((g) => tagSet.has(toL(g)))) {
		boost += 3;
	}
	if (preferences.preferred_languages?.some((l) => tagSet.has(toL(l)))) {
		boost += 2;
	}
	return boost;
}

// 8b) Weighted Borda
function rankByWeightedBorda(seedsMap, weightMap, matchScoreMap) {
	const scores = {};
	for (const list of Object.values(seedsMap)) {
		const L = list.length;
		list.forEach((key, i) => {
			const bordaPoints = L - i;
			const weight = weightMap[key] || 1;
			scores[key] = (scores[key] || 0) + bordaPoints * weight;
		});
	}
	return Object.keys(scores).sort((a, b) => {
		if (scores[b] !== scores[a]) {
			return scores[b] - scores[a];
		}
		return (matchScoreMap[b] || 0) - (matchScoreMap[a] || 0);
	});
}

// ================= Main Route =================
router.post("/", async (req, res) => {
	try {
		const { track_ids, preferences = {} } = req.body;
		if (!Array.isArray(track_ids) || track_ids.length === 0) {
			return res
				.status(400)
				.json({ error: "track_ids (non-empty array) is required" });
		}

		// NEW: same-artist-only flag (default false)
		const sameArtistOnly = !!preferences.same_artist_only;

		const seedsMap = {};
		const matchScoreMap = {};
		const weightMap = {};

		// Track corrected seed artists for filtering
		const allowedArtists = new Set();

		for (const entry of track_ids) {
			if (!entry.title || !entry.artist) {
				continue;
			}

			// Autocorrect
			let title = entry.title;
			let artist = entry.artist;
			const corr = await searchTrack(title, artist);
			if (corr) {
				title = corr.correctedTitle;
				artist = corr.correctedArtist;
			}
			allowedArtists.add(toL(artist)); // record corrected artist
			const seedKey = `${artist}${DELIM}${title}`;

			// Similar (primary)
			let similarList = await fetchSimilarTracks(title, artist);

			// NEW: if sameArtistOnly, filter right away to the seed artist
			if (sameArtistOnly && similarList.length > 0) {
				similarList = similarList.filter((t) =>
					sameArtist(t.artist, artist)
				);
			}

			// Fallbacks
			if (similarList.length === 0) {
				if (sameArtistOnly) {
					// For same-artist mode, prefer artist top tracks (same artist) over tag/global
					const topArtist = await fetchArtistTopTrack(artist);
					similarList = topArtist
						? [{ ...topArtist, matchScore: 0 }]
						: [];
				} else {
					// Original: tag -> artist
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
			}

			// If still in same-artist mode, enforce filter (in case fallback added others)
			if (sameArtistOnly && similarList.length > 0) {
				similarList = similarList.filter((t) =>
					sameArtist(t.artist, artist)
				);
			}

			// Preference scoring + maps
			const enhanced = [];
			for (const t of similarList) {
				const tags = await fetchTopTags(t.title, t.artist, true);
				const scoreBoost = applyPreferenceBoost(t, preferences, tags);
				const key = `${t.artist}${DELIM}${t.title}`;
				matchScoreMap[key] = t.matchScore || 0;
				enhanced.push({
					key,
					scoreBoost,
					matchScore: t.matchScore || 0,
				});
			}

			// Sort by (boost, matchScore)
			enhanced.sort((a, b) =>
				b.scoreBoost !== a.scoreBoost
					? b.scoreBoost - a.scoreBoost
					: b.matchScore - a.matchScore
			);

			// Store per-seed candidate keys
			seedsMap[seedKey] = enhanced.map((e) => e.key);

			// Build weight map for weighted Borda
			for (const e of enhanced) {
				weightMap[e.key] = 1 + e.scoreBoost;
			}
		}

		// Remove empty seeds
		for (const k of Object.keys(seedsMap)) {
			if (!Array.isArray(seedsMap[k]) || seedsMap[k].length === 0) {
				delete seedsMap[k];
			}
		}

		// Global fallback if no seeds produced anything
		if (Object.keys(seedsMap).length === 0) {
			if (sameArtistOnly) {
				// Try each allowed artist's top track
				const fallbacks = [];
				for (const a of allowedArtists) {
					const top = await fetchArtistTopTrack(a);
					if (top) {
						fallbacks.push(top);
					}
				}
				if (fallbacks.length > 0) {
					return res
						.status(200)
						.json({ recommended_tracks: fallbacks.slice(0, 3) });
				}
				return res.status(404).json({
					error: "No same-artist recommendations available.",
				});
			} else {
				const globalTop = await fetchGlobalTopTrack();
				if (globalTop) {
					return res
						.status(200)
						.json({ recommended_tracks: [globalTop] });
				}
				return res
					.status(404)
					.json({ error: "No recommendations available." });
			}
		}

		// Rank by weighted Borda
		let rankedKeys = rankByWeightedBorda(
			seedsMap,
			weightMap,
			matchScoreMap
		);

		// Enforce same-artist filter at the very end too (defense-in-depth)
		if (sameArtistOnly) {
			rankedKeys = rankedKeys.filter((k) => {
				const [artist] = k.split(DELIM);
				return allowedArtists.has(toL(artist));
			});
		}

		// If filtering wiped everything, do same-artist fallback
		if (sameArtistOnly && rankedKeys.length === 0) {
			const fallbacks = [];
			for (const a of allowedArtists) {
				const top = await fetchArtistTopTrack(a);
				if (top) {
					fallbacks.push(top);
				}
			}
			if (fallbacks.length > 0) {
				return res
					.status(200)
					.json({ recommended_tracks: fallbacks.slice(0, 3) });
			}
			return res
				.status(404)
				.json({ error: "No same-artist recommendations available." });
		}

		const top3 = rankedKeys.slice(0, 3).map((k) => {
			const [artist, title] = k.split(DELIM);
			return { artist, title };
		});

		return res.status(200).json({ recommended_tracks: top3 });
	} catch (err) {
		console.error("[route] Internal error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
});

module.exports = router;
