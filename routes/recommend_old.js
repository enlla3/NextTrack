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

async function searchTrack(title, artist) {
    console.log(`[searchTrack] Searching for "${title}" by "${artist}"`);

    try {
        const resp = await axios.get(LASTFM_BASE_URL, {
            params: {
                method: "track.search",
                track: title,
                artist: artist,
                api_key: LASTFM_API_KEY,
                format: "json",
                limit: SEARCH_LIMIT,
                autocorrect: 1,
            },
            timeout: 10000,
        });

        const matches = resp.data?.results?.trackmatches?.track;
        if (!matches || !Array.isArray(matches) || matches.length === 0) {
            return null;
        }

        const best = matches[0];
        const correctedTitle = best.name || title;
        const correctedArtist = best.artist || artist;
        return { correctedTitle, correctedArtist };
    } catch {
        return null;
    }
}

async function fetchSimilarTracks(title, artist) {
    console.log(
        `[fetchSimilarTracks] Fetching similar tracks for "${title}" by "${artist}"`
    );

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

        const data = resp.data;
        if (!data.similartracks || !Array.isArray(data.similartracks.track)) {
            return [];
        }

        return data.similartracks.track.map((t) => ({
            title: t.name,
            artist: t.artist?.name || "",
            matchScore: parseFloat(t.match) || 0,
        }));
    } catch {
        return [];
    }
}

async function fetchTopTags(title, artist) {
    console.log(
        `[fetchTopTags] Fetching top tags for "${title}" by "${artist}"`
    );

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
        if (!tags || !Array.isArray(tags) || tags.length === 0) {
            return null;
        }

        return tags[0].name;
    } catch {
        return null;
    }
}

async function fetchTagTopTracks(tagName) {
    console.log(`[fetchTagTopTracks] Fetching top tracks for tag="${tagName}"`);

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

        const tracks = resp.data?.tracks?.track;
        if (!tracks || !Array.isArray(tracks) || tracks.length === 0) {
            return [];
        }

        return tracks.map((t) => ({
            title: t.name,
            artist: t.artist?.name || "",
        }));
    } catch {
        return [];
    }
}

async function fetchArtistTopTrack(artistName) {
    console.log(
        `[fetchArtistTopTrack] Fetching top track for artist="${artistName}"`
    );

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

        const tracks = resp.data?.toptracks?.track;
        if (!tracks || (Array.isArray(tracks) && tracks.length === 0)) {
            return null;
        }

        const top = Array.isArray(tracks) ? tracks[0] : tracks;
        return {
            title: top.name,
            artist: top.artist?.name || artistName,
        };
    } catch {
        return null;
    }
}

async function fetchGlobalTopTrack() {
    console.log(
        `[fetchGlobalTopTrack] Fetching global top track (chart.getTopTracks)`
    );

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

        const tracks = resp.data?.tracks?.track;
        if (!tracks || (Array.isArray(tracks) && tracks.length === 0)) {
            return null;
        }

        const top = Array.isArray(tracks) ? tracks[0] : tracks;
        return {
            title: top.name,
            artist: top.artist?.name || "",
        };
    } catch {
        return null;
    }
}

function bordaAggregate(seedsMap) {
    const bordaScores = {};

    Object.values(seedsMap).forEach((rankedList) => {
        const L = rankedList.length;
        for (let i = 0; i < L; i++) {
            const key = rankedList[i];
            const points = L - i;
            bordaScores[key] = (bordaScores[key] || 0) + points;
        }
    });

    const candidates = Object.keys(bordaScores);
    if (candidates.length === 0) {
        return null;
    }

    let maxScore = -Infinity;
    candidates.forEach((cand) => {
        if (bordaScores[cand] > maxScore) {
            maxScore = bordaScores[cand];
        }
    });

    const tied = candidates.filter((cand) => bordaScores[cand] === maxScore);
    const winner = tied[Math.floor(Math.random() * tied.length)];
    return winner;
}

router.post("/", async (req, res) => {
    try {
        const { track_ids } = req.body;

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

            let correctedTitle = entry.title;
            let correctedArtist = entry.artist;
            const searchResult = await searchTrack(entry.title, entry.artist);
            if (searchResult) {
                correctedTitle = searchResult.correctedTitle;
                correctedArtist = searchResult.correctedArtist;
            }

            const seedKey = `${correctedArtist}${DELIM}${correctedTitle}`;

            let similarList = await fetchSimilarTracks(
                correctedTitle,
                correctedArtist
            );

            if (!Array.isArray(similarList) || similarList.length === 0) {
                const topTag = await fetchTopTags(
                    correctedTitle,
                    correctedArtist
                );
                if (topTag) {
                    const tagTracks = await fetchTagTopTracks(topTag);
                    similarList = tagTracks.map((t) => ({
                        title: t.title,
                        artist: t.artist,
                        matchScore: 0,
                    }));
                } else {
                    const artistTop = await fetchArtistTopTrack(
                        correctedArtist
                    );
                    if (artistTop) {
                        similarList = [
                            {
                                title: artistTop.title,
                                artist: artistTop.artist,
                                matchScore: 0,
                            },
                        ];
                    } else {
                        similarList = [];
                    }
                }
            }

            const candidateKeys = (similarList || []).map(
                (t) => `${t.artist}${DELIM}${t.title}`
            );
            seedsMap[seedKey] = candidateKeys;
        }

        for (const seed in seedsMap) {
            if (!Array.isArray(seedsMap[seed]) || seedsMap[seed].length === 0) {
                delete seedsMap[seed];
            }
        }

        if (Object.keys(seedsMap).length === 0) {
            const globalTop = await fetchGlobalTopTrack();
            if (globalTop) {
                return res.status(200).json({
                    recommended_track: {
                        title: globalTop.title,
                        artist: globalTop.artist,
                    },
                });
            }
            return res.status(404).json({
                error: "No candidates available (track, tag, artist, or global).",
            });
        }

        const winnerKey = bordaAggregate(seedsMap);
        if (!winnerKey) {
            return res.status(404).json({
                error: "Unable to determine a recommendation via Pura-Borda aggregation.",
            });
        }

        const [winnerArtist, winnerTitle] = winnerKey.split(DELIM);
        return res.status(200).json({
            recommended_track: {
                title: winnerTitle,
                artist: winnerArtist,
            },
        });
    } catch {
        return res.status(500).json({ error: "Internal server error" });
    }
});

module.exports = router;
