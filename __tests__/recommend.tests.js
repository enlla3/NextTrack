const request = require("supertest");
const axios = require("axios");
const app = require("../server");

jest.mock("axios");

describe("POST /api/recommend", () => {
	beforeEach(() => {
		axios.get.mockReset();
	});

	it("returns 400 for missing track_ids", async () => {
		const res = await request(app).post("/api/recommend").send({});
		expect(res.status).toBe(400);
		expect(res.body).toEqual({
			error: "track_ids (non-empty array) is required",
		});
	});

	it("falls back to global top track when no candidates", async () => {
		// searchTrack => no results
		axios.get.mockResolvedValueOnce({ data: {} });
		// fetchSimilarTracks => no similar
		axios.get.mockResolvedValueOnce({ data: {} });
		// fetchTopTags(returnAll=false) => no tags
		axios.get.mockResolvedValueOnce({ data: { toptags: { tag: [] } } });
		// fetchArtistTopTrack => no toptracks
		axios.get.mockResolvedValueOnce({ data: { toptracks: { track: [] } } });
		// fetchGlobalTopTrack => one global hit
		axios.get.mockResolvedValueOnce({
			data: {
				tracks: {
					track: [
						{ name: "GlobalHit", artist: { name: "WorldStar" } },
					],
				},
			},
		});

		const res = await request(app)
			.post("/api/recommend")
			.send({ track_ids: [{ title: "NoSong", artist: "NoArtist" }] });

		expect(res.status).toBe(200);
		expect(res.body).toEqual({
			recommended_tracks: [{ title: "GlobalHit", artist: "WorldStar" }],
		});
	});

	it("returns top 3 ranked results with preferences", async () => {
		// 1) searchTrack autocorrects
		axios.get.mockResolvedValueOnce({
			data: {
				results: {
					trackmatches: { track: [{ name: "A", artist: "X" }] },
				},
			},
		});
		// 2) fetchSimilarTracks returns 4 items
		axios.get.mockResolvedValueOnce({
			data: {
				similartracks: {
					track: [
						{ name: "T1", artist: { name: "X" }, match: "0.9" },
						{ name: "T2", artist: { name: "Y" }, match: "0.8" },
						{ name: "T3", artist: { name: "Z" }, match: "0.7" },
						{ name: "T4", artist: { name: "W" }, match: "0.6" },
					],
				},
			},
		});
		// 3) fetchTopTags(returnAll=false), unused branch
		axios.get.mockResolvedValue({ data: { toptags: { tag: [] } } });
		// 4=>7) fetchTopTags(returnAll=true) ×4 for scoring
		axios.get
			.mockResolvedValueOnce({
				data: { toptags: { tag: [{ name: "pop" }] } },
			})
			.mockResolvedValueOnce({
				data: { toptags: { tag: [{ name: "rock" }] } },
			})
			.mockResolvedValueOnce({
				data: { toptags: { tag: [{ name: "pop" }] } },
			})
			.mockResolvedValueOnce({
				data: { toptags: { tag: [{ name: "jazz" }] } },
			});

		const res = await request(app)
			.post("/api/recommend")
			.send({
				track_ids: [{ title: "A", artist: "X" }],
				preferences: {
					favorite_artists: ["Y"],
					preferred_genres: ["pop"],
					preferred_languages: ["english"],
				},
			});

		expect(res.status).toBe(200);
		expect(Array.isArray(res.body.recommended_tracks)).toBe(true);
		expect(res.body.recommended_tracks).toHaveLength(3);

		const titles = res.body.recommended_tracks.map((t) => t.title);
		// T1 and T3 should appear (they match "pop")
		expect(titles).toEqual(expect.arrayContaining(["T1", "T3"]));
	});

	it("ignores invalid track objects and falls back to global", async () => {
		// Only global fallback should fire
		axios.get.mockResolvedValueOnce({
			data: {
				tracks: { track: [{ name: "GT", artist: { name: "GA" } }] },
			},
		});

		const res = await request(app)
			.post("/api/recommend")
			.send({ track_ids: [{ name: "MissingFields" }] });

		expect(res.status).toBe(200);
		expect(res.body).toEqual({
			recommended_tracks: [{ title: "GT", artist: "GA" }],
		});
	});

	it("uses tag-based fallback when similar tracks missing but tag present", async () => {
		// searchTrack => no changes
		axios.get.mockResolvedValueOnce({ data: {} });
		// fetchSimilarTracks => empty
		axios.get.mockResolvedValueOnce({ data: {} });
		// fetchTopTags(returnAll=false) => returns a tag
		axios.get.mockResolvedValueOnce({
			data: { toptags: { tag: [{ name: "indie" }] } },
		});
		// fetchTagTopTracks => returns two tracks
		axios.get.mockResolvedValueOnce({
			data: {
				tracks: {
					track: [
						{ name: "Tag1", artist: { name: "A1" } },
						{ name: "Tag2", artist: { name: "A2" } },
					],
				},
			},
		});
		// fetchTopTags(returnAll=true) for scoring on those two
		axios.get.mockResolvedValue({
			data: { toptags: { tag: [{ name: "indie" }] } },
		});

		const res = await request(app)
			.post("/api/recommend")
			.send({ track_ids: [{ title: "X", artist: "Y" }] });

		expect(res.status).toBe(200);
		expect(res.body.recommended_tracks).toHaveLength(2);
		expect(res.body.recommended_tracks).toEqual([
			{ title: "Tag1", artist: "A1" },
			{ title: "Tag2", artist: "A2" },
		]);
	});

	it("falls back to artist's top track when no tag info", async () => {
		// searchTrack => no changes
		axios.get.mockResolvedValueOnce({ data: {} });
		// fetchSimilarTracks => empty
		axios.get.mockResolvedValueOnce({ data: {} });
		// fetchTopTags(returnAll=false) => no tags
		axios.get.mockResolvedValueOnce({ data: { toptags: { tag: [] } } });
		// fetchArtistTopTrack => returns one track
		axios.get.mockResolvedValueOnce({
			data: {
				toptracks: {
					track: { name: "ArtistHit", artist: { name: "Artist" } },
				},
			},
		});

		const res = await request(app)
			.post("/api/recommend")
			.send({ track_ids: [{ title: "X", artist: "Artist" }] });

		expect(res.status).toBe(200);
		expect(res.body.recommended_tracks).toEqual([
			{ title: "ArtistHit", artist: "Artist" },
		]);
	});

	it("handles axios errors and ultimately falls back to global", async () => {
		// searchTrack throws
		axios.get.mockRejectedValueOnce(new Error("Network error"));
		// fetchSimilarTracks throws
		axios.get.mockRejectedValueOnce(new Error("Network error"));
		// fetchTopTags throws
		axios.get.mockRejectedValueOnce(new Error("Network error"));
		// fetchArtistTopTrack throws
		axios.get.mockRejectedValueOnce(new Error("Network error"));
		// fetchGlobalTopTrack returns a track
		axios.get.mockResolvedValueOnce({
			data: {
				tracks: {
					track: [{ name: "SafeGlobal", artist: { name: "SG" } }],
				},
			},
		});

		const res = await request(app)
			.post("/api/recommend")
			.send({ track_ids: [{ title: "Err", artist: "Err" }] });

		expect(res.status).toBe(200);
		expect(res.body.recommended_tracks).toEqual([
			{ title: "SafeGlobal", artist: "SG" },
		]);
	});

	it("returns direct similar-track results when fetchSimilarTracks yields items", async () => {
		// 1) searchTrack => autocorrect to same
		axios.get.mockResolvedValueOnce({
			data: {
				results: {
					trackmatches: { track: [{ name: "Orig", artist: "Orig" }] },
				},
			},
		});
		// 2) fetchSimilarTracks => exactly 3 items
		axios.get.mockResolvedValueOnce({
			data: {
				similartracks: {
					track: [
						{ name: "S1", artist: { name: "A1" }, match: "0.5" },
						{ name: "S2", artist: { name: "A2" }, match: "0.4" },
						{ name: "S3", artist: { name: "A3" }, match: "0.3" },
					],
				},
			},
		});
		// scoring fetchTopTags(returnAll=true) ×3
		axios.get
			.mockResolvedValueOnce({
				data: { toptags: { tag: [{ name: "t" }] } },
			})
			.mockResolvedValueOnce({
				data: { toptags: { tag: [{ name: "t" }] } },
			})
			.mockResolvedValueOnce({
				data: { toptags: { tag: [{ name: "t" }] } },
			});

		const res = await request(app)
			.post("/api/recommend")
			.send({ track_ids: [{ title: "X", artist: "Y" }] });

		expect(res.status).toBe(200);
		expect(res.body.recommended_tracks).toEqual([
			{ title: "S1", artist: "A1" },
			{ title: "S2", artist: "A2" },
			{ title: "S3", artist: "A3" },
		]);
	});

	it("returns 404 when global fallback yields no track", async () => {
		// searchTrack, fetchSimilar, fetchTopTags, fetchArtist → all empty
		axios.get.mockResolvedValueOnce({ data: {} });
		axios.get.mockResolvedValueOnce({ data: {} });
		axios.get.mockResolvedValueOnce({ data: { toptags: { tag: [] } } });
		axios.get.mockResolvedValueOnce({ data: { toptracks: { track: [] } } });
		// global fallback returns empty
		axios.get.mockResolvedValueOnce({ data: { tracks: { track: [] } } });

		const res = await request(app)
			.post("/api/recommend")
			.send({ track_ids: [{ title: "No", artist: "One" }] });

		expect(res.status).toBe(404);
		expect(res.body).toEqual({ error: "No recommendations available." });
	});

	it("boosts by language preference when only language matches", async () => {
		// searchTrack
		axios.get.mockResolvedValueOnce({
			data: {
				results: {
					trackmatches: { track: [{ name: "T", artist: "U" }] },
				},
			},
		});
		// fetchSimilarTracks => two items
		axios.get.mockResolvedValueOnce({
			data: {
				similartracks: {
					track: [
						{ name: "L1", artist: { name: "LangA" }, match: "0.6" },
						{ name: "L2", artist: { name: "LangB" }, match: "0.7" },
					],
				},
			},
		});
		// scoring tags:
		axios.get
			.mockResolvedValueOnce({
				data: { toptags: { tag: [{ name: "english" }] } },
			}) // L1
			.mockResolvedValueOnce({
				data: { toptags: { tag: [{ name: "spanish" }] } },
			}); // L2

		const res = await request(app)
			.post("/api/recommend")
			.send({
				track_ids: [{ title: "T", artist: "U" }],
				preferences: { preferred_languages: ["english"] },
			});

		expect(res.status).toBe(200);
		const out = res.body.recommended_tracks;
		expect(out[0]).toEqual({ title: "L1", artist: "LangA" });
		expect(out[1]).toEqual({ title: "L2", artist: "LangB" });
	});

	// NEW: same-artist-only filters similar tracks to the seed artist
	it("honors same_artist_only=true by filtering to the seed artist", async () => {
		// searchTrack => no correction
		axios.get.mockResolvedValueOnce({ data: {} });
		// fetchSimilarTracks => mixed artists
		axios.get.mockResolvedValueOnce({
			data: {
				similartracks: {
					track: [
						{ name: "S1", artist: { name: "X" }, match: "0.9" },
						{ name: "S2", artist: { name: "Y" }, match: "0.8" },
						{ name: "S3", artist: { name: "X" }, match: "0.7" },
					],
				},
			},
		});
		// scoring toptags for kept items (S1, S3)
		axios.get.mockResolvedValue({ data: { toptags: { tag: [] } } });

		const res = await request(app)
			.post("/api/recommend")
			.send({
				track_ids: [{ title: "Seed", artist: "X" }],
				preferences: { same_artist_only: true },
			});

		expect(res.status).toBe(200);
		expect(res.body.recommended_tracks).toEqual([
			{ title: "S1", artist: "X" },
			{ title: "S3", artist: "X" },
		]);
	});

	// same-artist-only falls back to artist top track when filter empties list
	it("same_artist_only falls back to the artist's top track if none match", async () => {
		// searchTrack => no correction
		axios.get.mockResolvedValueOnce({ data: {} });
		// fetchSimilarTracks => empty (or all filtered out)
		axios.get.mockResolvedValueOnce({ data: {} });
		// fetchArtistTopTrack => returns one track
		axios.get.mockResolvedValueOnce({
			data: {
				toptracks: {
					track: { name: "XHit", artist: { name: "X" } },
				},
			},
		});
		// scoring tags for that one track
		axios.get.mockResolvedValue({ data: { toptags: { tag: [] } } });

		const res = await request(app)
			.post("/api/recommend")
			.send({
				track_ids: [{ title: "Seed", artist: "X" }],
				preferences: { same_artist_only: true },
			});

		expect(res.status).toBe(200);
		expect(res.body.recommended_tracks).toEqual([
			{ title: "XHit", artist: "X" },
		]);
	});

	it("aggregates across multiple seeds correctly", async () => {
		// Seed A
		axios.get.mockResolvedValueOnce({
			data: {
				results: {
					trackmatches: { track: [{ name: "A", artist: "X" }] },
				},
			},
		});
		axios.get.mockResolvedValueOnce({
			data: {
				similartracks: {
					track: [
						{ name: "R1", artist: { name: "X" }, match: "0.5" },
					],
				},
			},
		});
		axios.get.mockResolvedValueOnce({
			data: { toptags: { tag: [{ name: "tag1" }] } },
		});

		// Seed B
		axios.get.mockResolvedValueOnce({
			data: {
				results: {
					trackmatches: { track: [{ name: "B", artist: "Y" }] },
				},
			},
		});
		axios.get.mockResolvedValueOnce({
			data: {
				similartracks: {
					track: [
						{ name: "R2", artist: { name: "Y" }, match: "0.6" },
					],
				},
			},
		});
		axios.get.mockResolvedValueOnce({
			data: { toptags: { tag: [{ name: "tag2" }] } },
		});

		const res = await request(app)
			.post("/api/recommend")
			.send({
				track_ids: [
					{ title: "A", artist: "X" },
					{ title: "B", artist: "Y" },
				],
			});

		expect(res.status).toBe(200);
		expect(res.body.recommended_tracks).toEqual([
			{ title: "R2", artist: "Y" },
			{ title: "R1", artist: "X" },
		]);
	});
});
