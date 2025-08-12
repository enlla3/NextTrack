const request = require("supertest");
const axios = require("axios");
const app = require("../server");

jest.mock("axios");

describe("POST /api/find-tracks", () => {
	beforeEach(() => {
		axios.get.mockReset();
	});

	it("400 when neither or both of title/artist are provided", async () => {
		// neither
		let res = await request(app).post("/api/find-tracks").send({});
		expect(res.status).toBe(400);
		expect(res.body.error).toMatch(/exactly one/i);

		// both
		res = await request(app)
			.post("/api/find-tracks")
			.send({ title: "Song", artist: "Artist" });
		expect(res.status).toBe(400);
		expect(res.body.error).toMatch(/exactly one/i);
	});

	it("title-only: returns matches from track.search", async () => {
		// 1) track.search
		axios.get.mockResolvedValueOnce({
			data: {
				results: {
					trackmatches: {
						track: [
							{ name: "T1", artist: "A1" },
							{ name: "T2", artist: "A2" },
							{ name: "T3", artist: "A3" },
						],
					},
				},
			},
		});

		const res = await request(app)
			.post("/api/find-tracks")
			.send({ title: "remembered title" });

		expect(res.status).toBe(200);
		expect(res.body.results).toEqual([
			{ title: "T1", artist: "A1" },
			{ title: "T2", artist: "A2" },
			{ title: "T3", artist: "A3" },
		]);
	});

	it("title-only + language filter: keeps only tracks whose top tags include the language", async () => {
		// 1) track.search (2 results)
		axios.get
			.mockResolvedValueOnce({
				data: {
					results: {
						trackmatches: {
							track: [
								{ name: "SongE", artist: "BandE" },
								{ name: "SongX", artist: "BandX" },
							],
						},
					},
				},
			})
			// 2) track.getTopTags for SongE
			.mockResolvedValueOnce({
				data: {
					toptags: { tag: [{ name: "english" }, { name: "pop" }] },
				},
			})
			// 3) track.getTopTags for SongX
			.mockResolvedValueOnce({
				data: { toptags: { tag: [{ name: "spanish" }] } },
			});

		const res = await request(app)
			.post("/api/find-tracks")
			.send({ title: "title only", language: "English" }); // case-insensitive

		expect(res.status).toBe(200);
		expect(res.body.results).toEqual([{ title: "SongE", artist: "BandE" }]);
	});

	it("artist-only: resolves artist then returns top tracks", async () => {
		// 1) artist.search -> best match "The Weeknd"
		axios.get
			.mockResolvedValueOnce({
				data: {
					results: {
						artistmatches: {
							artist: [{ name: "The Weeknd" }],
						},
					},
				},
			})
			// 2) artist.getTopTracks
			.mockResolvedValueOnce({
				data: {
					toptracks: {
						track: [
							{
								name: "Blinding Lights",
								artist: { name: "The Weeknd" },
							},
							{
								name: "Save Your Tears",
								artist: { name: "The Weeknd" },
							},
						],
					},
				},
			});

		const res = await request(app)
			.post("/api/find-tracks")
			.send({ artist: "weeknd" });

		expect(res.status).toBe(200);
		expect(res.body.results).toEqual([
			{ title: "Blinding Lights", artist: "The Weeknd" },
			{ title: "Save Your Tears", artist: "The Weeknd" },
		]);
	});

	it("artist-only + language filter: filters top tracks by language tag", async () => {
		// 1) artist.search
		axios.get
			.mockResolvedValueOnce({
				data: {
					results: {
						artistmatches: { artist: [{ name: "Artist Z" }] },
					},
				},
			})
			// 2) artist.getTopTracks (2 tracks)
			.mockResolvedValueOnce({
				data: {
					toptracks: {
						track: [
							{ name: "Z-One", artist: { name: "Artist Z" } },
							{ name: "Z-Two", artist: { name: "Artist Z" } },
						],
					},
				},
			})
			// 3) track.getTopTags for Z-One
			.mockResolvedValueOnce({
				data: {
					toptags: { tag: [{ name: "english" }, { name: "pop" }] },
				},
			})
			// 4) track.getTopTags for Z-Two
			.mockResolvedValueOnce({
				data: { toptags: { tag: [{ name: "french" }] } },
			});

		const res = await request(app)
			.post("/api/find-tracks")
			.send({ artist: "Artist Z", language: "english" });

		expect(res.status).toBe(200);
		expect(res.body.results).toEqual([
			{ title: "Z-One", artist: "Artist Z" },
		]);
	});

	it("respects the limit parameter", async () => {
		// 1) track.search returns 4 tracks
		axios.get.mockResolvedValueOnce({
			data: {
				results: {
					trackmatches: {
						track: [
							{ name: "T1", artist: "A" },
							{ name: "T2", artist: "A" },
							{ name: "T3", artist: "A" },
							{ name: "T4", artist: "A" },
						],
					},
				},
			},
		});

		const res = await request(app)
			.post("/api/find-tracks")
			.send({ title: "anything", limit: 2 });

		expect(res.status).toBe(200);
		expect(res.body.results).toHaveLength(2);
		expect(res.body.results).toEqual([
			{ title: "T1", artist: "A" },
			{ title: "T2", artist: "A" },
		]);
	});

	it("language filter + tag fetch errors: returns empty results (graceful)", async () => {
		// 1) track.search -> 2 tracks
		axios.get
			.mockResolvedValueOnce({
				data: {
					results: {
						trackmatches: {
							track: [
								{ name: "X1", artist: "B1" },
								{ name: "X2", artist: "B2" },
							],
						},
					},
				},
			})
			// 2) track.getTopTags throws for first
			.mockRejectedValueOnce(new Error("Network"))
			// 3) track.getTopTags throws for second
			.mockRejectedValueOnce(new Error("Network"));

		const res = await request(app)
			.post("/api/find-tracks")
			.send({ title: "x", language: "english" });

		// fetchTopTags() catches and returns [], so filter removes both
		expect(res.status).toBe(200);
		expect(res.body.results).toEqual([]);
	});

	it("artist-only with no search match yields empty list (200)", async () => {
		// 1) artist.search -> no hits
		axios.get
			.mockResolvedValueOnce({
				data: { results: { artistmatches: { artist: [] } } },
			})
			// 2) artist.getTopTracks will still be attempted with original artist name
			.mockResolvedValueOnce({
				data: { toptracks: { track: [] } },
			});

		const res = await request(app)
			.post("/api/find-tracks")
			.send({ artist: "Nonexistent" });

		expect(res.status).toBe(200);
		expect(res.body.results).toEqual([]);
	});
});
