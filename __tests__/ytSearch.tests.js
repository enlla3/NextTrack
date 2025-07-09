/**
 * @jest-environment node
 */

const request = require("supertest");
const express = require("express");

// --- 1) MOCK console.error to suppress route errors in test logs ---
beforeAll(() => {
	jest.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(() => {
	console.error.mockRestore();
});

// --- 2) MOCK yt-search ---
jest.mock("yt-search");
const ytSearch = require("yt-search");

// --- 3) CREATE A MINI APP that only mounts ytSearchRoute ---
const app = express();
app.use(express.json());
const ytSearchRoute = require("../routes/ytSearch");
app.use("/api/yt-search", ytSearchRoute);

describe("GET /api/yt-search", () => {
	beforeEach(() => {
		jest.resetAllMocks();
	});

	it("400 if q is missing", async () => {
		const res = await request(app).get("/api/yt-search");
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: "q query parameter is required" });
	});

	it("200 + payload when yt-search returns a video", async () => {
		ytSearch.mockImplementation((q, cb) => {
			cb(null, {
				videos: [
					{
						videoId: "ID123",
						title: "My Video",
						author: { name: "AuthorX" },
						thumbnail: "thumb.jpg",
					},
				],
			});
		});

		const res = await request(app)
			.get("/api/yt-search")
			.query({ q: "foo" });

		expect(res.status).toBe(200);
		expect(res.body).toEqual({
			videoId: "ID123",
			title: "My Video",
			author: "AuthorX",
			thumbnail: "thumb.jpg",
		});
		expect(ytSearch).toHaveBeenCalledWith("foo", expect.any(Function));
	});

	it("200 + { videoId: null } when no videos found", async () => {
		ytSearch.mockImplementation((q, cb) => {
			cb(null, { videos: [] });
		});

		const res = await request(app)
			.get("/api/yt-search")
			.query({ q: "nothing" });

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ videoId: null });
	});

	it("502 + error JSON when yt-search errors", async () => {
		ytSearch.mockImplementation((q, cb) => {
			cb(new Error("boom"), null);
		});

		const res = await request(app)
			.get("/api/yt-search")
			.query({ q: "oops" });

		expect(res.status).toBe(502);
		expect(res.body).toEqual({ error: "Failed to fetch from yt-search" });
	});
});
