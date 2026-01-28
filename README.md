# Offline Geocoder Service for Synq

**Zero API costs** reverse geocoding using local data + MongoDB caching.

## Quick Start

### Option 1: Standalone Utility (Recommended for Synq)

Copy `utils/geocoder.js` to your project:

```bash
cp utils/geocoder.js /path/to/synq-backend/utils/
```

Install dependency:
```bash
npm install local-reverse-geocoder
```

Use in your code:
```javascript
const { initGeocoder, reverseGeocode } = require('./utils/geocoder');

// Initialize once on server start
await initGeocoder();

// Use anywhere - completely FREE!
const location = await reverseGeocode(26.7606, 83.3732);
console.log(location.displayName);  // "Gorakhpur, Uttar Pradesh, India"
```

### Option 2: Standalone API Server

```bash
npm install
MONGODB_URI=mongodb://localhost:27017/synq npm start
```

API endpoints:
- `GET /geocode?lat=26.7606&lng=83.3732`
- `POST /geocode/batch` with `{ coordinates: [{lat, lng}, ...] }`
- `GET /geocode/stats`

---

## First Run Setup

On first run, the geocoder downloads ~2GB of geographic data:
- GeoNames cities database
- Admin boundaries (states, districts)

This takes 5-10 minutes depending on internet speed. Data is stored in `./geocoder-data/`.

**Requirements:**
- ~2.5GB disk space
- Node.js 16+
- MongoDB (for caching)

---

## How It Works

```
Request: reverseGeocode(26.7606, 83.3732)
                    │
                    ▼
         ┌──────────────────┐
         │  Round to 3      │
         │  decimal places  │  (26.761, 83.373)
         └────────┬─────────┘
                  │
                  ▼
         ┌──────────────────┐
         │  Check MongoDB   │──── HIT ───▶ Return cached result
         │     Cache        │             (< 1ms)
         └────────┬─────────┘
                  │ MISS
                  ▼
         ┌──────────────────┐
         │  Local Geocoder  │
         │  (offline data)  │  (~ 1-5ms)
         └────────┬─────────┘
                  │
                  ▼
         ┌──────────────────┐
         │  Save to Cache   │
         │  + Return        │
         └──────────────────┘
```

**Cache key precision:** 3 decimal places (~100m)
- All coordinates within 100m return same cached result
- Dramatically reduces storage needs

---

## API Reference

### `initGeocoder(options?)`

Initialize the geocoder. Call once on server start.

```javascript
await initGeocoder({
  dataDir: './geocoder-data',  // Where to store offline data
  loadAdmin3: true,            // Load sub-districts
  loadAdmin4: true             // Load localities
});
```

### `reverseGeocode(lat, lng, options?)`

Get location from coordinates.

```javascript
const location = await reverseGeocode(26.7606, 83.3732);
// {
//   name: "Gorakhpur",
//   adminName1: "Uttar Pradesh",      // State
//   adminName2: "Gorakhpur",          // District
//   countryCode: "IN",
//   countryName: "India",
//   displayName: "Gorakhpur, Uttar Pradesh, India",
//   source: "local" | "cache",
//   cacheKey: "26.761,83.373"
// }

// Skip cache (force fresh lookup)
await reverseGeocode(lat, lng, { skipCache: true });
```

### `reverseGeocodeBatch(coordinates)`

Batch process multiple coordinates.

```javascript
const results = await reverseGeocodeBatch([
  { lat: 26.7606, lng: 83.3732 },
  { lat: 28.6139, lng: 77.2090 },
  { lat: 19.0760, lng: 72.8777 }
]);
// [{lat, lng, location, success}, ...]
```

### `getLocationName(lat, lng)`

Shorthand - returns just the display name.

```javascript
const name = await getLocationName(26.7606, 83.3732);
// "Gorakhpur, Uttar Pradesh, India"
```

### `getLocationShort(lat, lng)`

Returns simplified object.

```javascript
const loc = await getLocationShort(26.7606, 83.3732);
// { city: "Gorakhpur", state: "Uttar Pradesh", country: "India" }
```

### `getCacheStats()`

```javascript
const stats = await getCacheStats();
// { totalEntries: 1523, totalHits: 45230, avgHitsPerEntry: 29.7 }
```

### `clearOldCache(daysOld?)`

Remove entries not accessed in N days.

```javascript
const deleted = await clearOldCache(90);  // Default: 90 days
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGODB_URI` | `mongodb://localhost:27017/synq` | MongoDB connection string |
| `PORT` | `3001` | API server port |
| `GEOCODER_DATA_DIR` | `./geocoder-data` | Offline data storage |

---

## Cost Comparison

| Service | Free Tier | Cost After | 10K users × 5 posts/day |
|---------|-----------|------------|------------------------|
| Google Maps | 40K/month | $5/1000 | ~$250/month |
| Mapbox | 100K/month | $0.75/1000 | ~$37/month |
| **This Solution** | **Unlimited** | **$0** | **$0** |

**Annual savings: $3000+**

---

## MongoDB Schema

```javascript
{
  cacheKey: "26.761,83.373",        // Rounded coordinates
  latitude: 26.7606,
  longitude: 83.3732,
  location: {
    name: "Gorakhpur",
    adminName1: "Uttar Pradesh",
    adminName2: "Gorakhpur", 
    countryCode: "IN",
    countryName: "India",
    displayName: "Gorakhpur, Uttar Pradesh, India"
  },
  hitCount: 47,                     // Cache hit counter
  lastAccessedAt: ISODate(...),
  createdAt: ISODate(...)
}
```

---

## Files

```
geocoder-service/
├── utils/
│   └── geocoder.js          # ⭐ Drop-in utility (use this!)
├── models/
│   └── GeoCache.js          # MongoDB schema
├── geocoderService.js       # Full service class
├── server.js                # Express API server
├── examples/
│   └── integration.js       # Synq integration examples
├── package.json
└── README.md
```

---

## Troubleshooting

**"Geocoder not initialized"**
- Call `await initGeocoder()` before using reverseGeocode

**First run is slow**
- Normal - downloading ~2GB of data
- Subsequent runs load from disk (~10 seconds)

**Memory usage high**
- The geocoder loads data into RAM (~500MB-1GB)
- Consider running as separate microservice if RAM is limited

**Results not accurate**
- OpenStreetMap data may have gaps in remote areas
- Consider falling back to a paid API for "Unknown" results
