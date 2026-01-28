const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const geocoderService = require('./geocoderService');

const app = express();
app.use(cors());
app.use(express.json());

// Configuration
const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://krsaurabh8954:oJCaCSRJ8kzjV5fp@cluster0.zr0aeq2.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

/**
 * Connect to MongoDB and initialize geocoder
 */
async function initialize() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Initialize local geocoder (this downloads data on first run)
    await geocoderService.init();
    
    console.log('🚀 Geocoder service ready!');
  } catch (err) {
    console.error('❌ Initialization failed:', err);
    process.exit(1);
  }
}

// ============ API ROUTES ============

/**
 * GET /geocode
 * Reverse geocode a single coordinate
 * 
 * Query params:
 *   - lat: Latitude (required)
 *   - lng: Longitude (required)
 *   - skipCache: Force fresh lookup (optional, default: false)
 * 
 * Example: GET /geocode?lat=26.7606&lng=83.3732
 */
app.get('/geocode', async (req, res) => {
  try {
    const { lat, lng, skipCache } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        error: 'lat and lng query parameters are required'
      });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    if (isNaN(latitude) || isNaN(longitude)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid lat/lng values'
      });
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return res.status(400).json({
        success: false,
        error: 'Coordinates out of range'
      });
    }

    const location = await geocoderService.getLocation(
      latitude,
      longitude,
      skipCache === 'true'
    );

    res.json({
      success: true,
      data: location
    });

  } catch (err) {
    console.error('Geocode error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * POST /geocode/batch
 * Reverse geocode multiple coordinates at once
 * 
 * Body: { coordinates: [{ lat: number, lng: number }, ...] }
 * Max: 100 coordinates per request
 * 
 * Example:
 * POST /geocode/batch
 * { "coordinates": [{ "lat": 26.7606, "lng": 83.3732 }, { "lat": 28.6139, "lng": 77.2090 }] }
 */
app.post('/geocode/batch', async (req, res) => {
  try {
    const { coordinates } = req.body;

    if (!Array.isArray(coordinates) || coordinates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'coordinates array is required'
      });
    }

    if (coordinates.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 100 coordinates per request'
      });
    }

    // Validate all coordinates
    for (let i = 0; i < coordinates.length; i++) {
      const { lat, lng } = coordinates[i];
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return res.status(400).json({
          success: false,
          error: `Invalid coordinate at index ${i}`
        });
      }
    }

    const results = await geocoderService.getLocations(coordinates);

    res.json({
      success: true,
      count: results.length,
      data: results
    });

  } catch (err) {
    console.error('Batch geocode error:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * GET /geocode/stats
 * Get cache statistics
 */
app.get('/geocode/stats', async (req, res) => {
  try {
    const stats = await geocoderService.getCacheStats();
    res.json({
      success: true,
      data: stats
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * DELETE /geocode/cache
 * Clear old cache entries
 * Query: daysOld (default: 90)
 */
app.delete('/geocode/cache', async (req, res) => {
  try {
    const daysOld = parseInt(req.query.daysOld) || 90;
    const deletedCount = await geocoderService.clearOldCache(daysOld);
    res.json({
      success: true,
      deletedCount
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

/**
 * Health check
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    geocoderInitialized: geocoderService.isInitialized,
    mongoConnected: mongoose.connection.readyState === 1
  });
});

// ============ START SERVER ============

initialize().then(() => {
  app.listen(PORT, () => {
    console.log(`🌐 Geocoder API running on http://localhost:${PORT}`);
    console.log(`
    Available endpoints:
    - GET  /geocode?lat=XX&lng=XX     - Single coordinate lookup
    - POST /geocode/batch             - Batch lookup (max 100)
    - GET  /geocode/stats             - Cache statistics
    - DELETE /geocode/cache           - Clear old cache
    - GET  /health                    - Health check
    `);
  });
});

module.exports = app;
