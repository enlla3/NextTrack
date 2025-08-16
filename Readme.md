# NextTrack (Backend API)

**Live base URL:** https://nexttrack.onrender.com
_All endpoints are under `/api`._

A **Express.js** service that recommends a “next track” from seed songs using Last.fm metadata. It also exposes a helper endpoint to fetch a playable YouTube video for the frontend.

## Tech stack

-   Node.js + Express
-   axios (Last.fm + auxiliary HTTP calls)
-   express-rate-limit + cors (basic hardening)
-   mathjs (lightweight scoring/aggregation)
-   yt-search (YouTube helper)
-   Jest + Supertest (endpoint tests)

## Endpoints

### `GET /api/yt-search?q=<query>`

Returns a simplified video record for embedding/playback.

-   **200** → `{ videoId, title, author, thumbnail }`
-   **400** → when `q` is missing
-   **502** → when the underlying search fails

Example:

```bash
curl "https://nexttrack.onrender.com/api/yt-search?q=ed sheeran shape of you"
```

---

### `POST /api/find-tracks`

Find candidate songs by **exactly one** of `artist` or `title`.

**Request bodies**

-   By artist:
    ```json
    { "artist": "Taylor Swift", "limit": 20 }
    ```
-   By title:
    ```json
    { "title": "Blinding Lights", "limit": 20 }
    ```

**Behavior (code):**

-   If `artist` is given → `artist.search` to resolve name → `artist.getTopTracks`
-   If `title` is given → `track.search` to resolve → `track.getTopTags` for tag-based exploration
-   Returns a de-duplicated, normalized list of tracks.

**Errors**

-   **400** when both/neither `artist`/`title` provided.

Example:

```bash
curl -X POST https://nexttrack.onrender.com/api/find-tracks   -H "Content-Type: application/json"   -d '{ "artist": "Taylor Swift", "limit": 10 }'
```

---

### `POST /api/recommend`

Return a ranked list of recommendations based on seed songs and optional preferences.

**Request body**

```json
{
	"track_ids": [
		{ "title": "Bad Habit", "artist": "Steve Lacy" },
		{ "title": "As It Was", "artist": "Harry Styles" }
	],
	"preferences": {
		"favorite_artists": ["The Weeknd"],
		"preferred_genres": ["pop"],
		"preferred_languages": ["english"]
	}
}
```

**Behavior (code):**

-   Queries Last.fm (`track.getSimilar`, `tag.getTopTracks`, `artist.getTopTracks`, and as-needed `chart.getTopTracks`).
-   Aggregates candidates with a simple point-based ranking (via **mathjs**) and de-dupes by normalized title/artist.
-   Falls back gracefully (e.g., artist top or global charts) if sources are sparse.

**Response (200)**

```json
{
	"recommended_tracks": [
		{ "title": "Track 1", "artist": "Artist 1" },
		{ "title": "Track 2", "artist": "Artist 2" }
	]
}
```

**Errors**

-   **400** when `track_ids` is missing or empty.

Example:

```bash
curl -X POST https://nexttrack.onrender.com/api/recommend   -H "Content-Type: application/json"   -d '{
        "track_ids": [
          { "title": "Bad Habit", "artist": "Steve Lacy" },
          { "title": "As It Was", "artist": "Harry Styles" }
        ],
        "preferences": { "preferred_genres": ["pop"], "preferred_languages": ["english"] }
      }'
```

## Environment

Create a `.env` file in the project root:

```
PORT=3000
LASTFM_API_KEY=YOUR_LASTFM_API_KEY
NODE_ENV=test
```

> `LASTFM_API_KEY` is required at startup (the server will exit if missing).

## Scripts

```json
{
	"start": "nodemon server.js",
	"test": "jest"
}
```

## Local development

```bash
npm install
npm start          # http://localhost:3000 (or PORT)
npm test
```

## Code map (high level)

-   `server.js` — Express app, CORS, rate-limit, mounts:
    -   `/api/recommend` → `routes/recommend.js` (main recommender: similar tracks, tags, artist top, chart fallback; simple scoring)
    -   `/api/find-tracks` → `routes/findTracks.js` (single-axis search by artist OR title; de-duplication)
    -   `/api/yt-search` → `routes/ytSearch.js` (thin wrapper over `yt-search`)
-   `routes/recommend_1track.js`, `routes/recommend_old.js` — alternate/legacy variants
-   `__tests__/` — Supertest suites covering common and edge cases
