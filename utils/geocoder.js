/**
 * Standalone Geocoder Utility for Synq
 * 
 * Drop this file directly into your existing Synq backend
 * Works with your existing MongoDB connection
 * 
 * Usage:
 *   const { reverseGeocode, initGeocoder } = require('./utils/geocoder');
 *   
 *   // Initialize once on server start
 *   await initGeocoder();
 *   
 *   // Use anywhere
 *   const location = await reverseGeocode(26.7606, 83.3732);
 *   console.log(location.displayName); // "Gorakhpur, Uttar Pradesh, India"
 */

const geocoder = require('local-reverse-geocoder');
const mongoose = require('mongoose');

// ============ SCHEMA ============

const geoCacheSchema = new mongoose.Schema({
  cacheKey: { type: String, required: true, unique: true, index: true },
  latitude: Number,
  longitude: Number,
  location: {
    name: String,
    adminName1: String,      // State
    adminName2: String,      // District
    countryCode: String,
    countryName: String,
    displayName: String,
    population: Number
  },
  hitCount: { type: Number, default: 1 },
  lastAccessedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const GeoCache = mongoose.models.GeoCache || mongoose.model('GeoCache', geoCacheSchema);

// ============ COUNTRY CODES ============

const COUNTRY_NAMES = {
  'IN': 'India', 'US': 'United States', 'GB': 'United Kingdom',
  'CA': 'Canada', 'AU': 'Australia', 'DE': 'Germany', 'FR': 'France',
  'JP': 'Japan', 'CN': 'China', 'BR': 'Brazil', 'RU': 'Russia',
  'AE': 'UAE', 'SG': 'Singapore', 'NL': 'Netherlands', 'IT': 'Italy',
  'ES': 'Spain', 'MX': 'Mexico', 'ID': 'Indonesia', 'PK': 'Pakistan',
  'BD': 'Bangladesh', 'NP': 'Nepal', 'LK': 'Sri Lanka'
};

// ============ STATE ============

let isInitialized = false;
let initPromise = null;

// ============ PUBLIC FUNCTIONS ============

/**
 * Initialize the geocoder (call once on server start)
 * Downloads ~2GB of data on first run
 */
async function initGeocoder(options = {}) {
  if (isInitialized) return true;
  if (initPromise) return initPromise;

  initPromise = new Promise((resolve, reject) => {
    console.log('🌍 Initializing offline geocoder...');
    
    geocoder.init({
      load: {
        admin1: true,
        admin2: true,
        admin3: options.loadAdmin3 ?? true,
        admin4: options.loadAdmin4 ?? true,
        alternateNames: false
      },
      dumpDirectory: options.dataDir || './geocoder-data'
    }, (err) => {
      if (err) {
        console.error('❌ Geocoder init failed:', err);
        reject(err);
      } else {
        console.log('✅ Offline geocoder ready!');
        isInitialized = true;
        resolve(true);
      }
    });
  });

  return initPromise;
}

/**
 * Check if geocoder is initialized
 */
function isGeocoderReady() {
  return isInitialized;
}

/**
 * Generate cache key from coordinates
 * 3 decimal places = ~100m precision
 */
function getCacheKey(lat, lng) {
  return `${Math.round(lat * 1000) / 1000},${Math.round(lng * 1000) / 1000}`;
}

/**
 * Reverse geocode coordinates to location name
 * 
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude  
 * @param {Object} options - { skipCache: boolean }
 * @returns {Object} { name, adminName1, adminName2, countryCode, countryName, displayName, source }
 */
async function reverseGeocode(lat, lng, options = {}) {
  if (!isInitialized) {
    throw new Error('Geocoder not initialized. Call initGeocoder() first.');
  }

  const cacheKey = getCacheKey(lat, lng);

  // Check cache first
  if (!options.skipCache) {
    try {
      const cached = await GeoCache.findOneAndUpdate(
        { cacheKey },
        { $inc: { hitCount: 1 }, $set: { lastAccessedAt: new Date() } },
        { new: true }
      ).lean();

      if (cached) {
        return { ...cached.location, source: 'cache', cacheKey };
      }
    } catch (err) {
      console.warn('Cache lookup error:', err.message);
    }
  }

  // Local lookup
  const result = await new Promise((resolve, reject) => {
    geocoder.lookUp({ latitude: lat, longitude: lng }, 1, (err, res) => {
      if (err) reject(err);
      else resolve(res);
    });
  });

  // Format result
  const location = formatLocation(result);

  // Cache it
  if (location.name !== 'Unknown') {
    try {
      await GeoCache.findOneAndUpdate(
        { cacheKey },
        { cacheKey, latitude: lat, longitude: lng, location, hitCount: 1, lastAccessedAt: new Date() },
        { upsert: true }
      );
    } catch (err) {
      console.warn('Cache save error:', err.message);
    }
  }

  return { ...location, source: 'local', cacheKey };
}

/**
 * Batch reverse geocode multiple coordinates
 */
async function reverseGeocodeBatch(coordinates) {
  const results = [];
  for (const { lat, lng } of coordinates) {
    try {
      const location = await reverseGeocode(lat, lng);
      results.push({ lat, lng, location, success: true });
    } catch (err) {
      results.push({ lat, lng, error: err.message, success: false });
    }
  }
  return results;
}

/**
 * Get just the city/place name (shorthand)
 */
async function getLocationName(lat, lng) {
  const result = await reverseGeocode(lat, lng);
  return result.displayName;
}

/**
 * Get location with specific fields only
 */
async function getLocationShort(lat, lng) {
  const result = await reverseGeocode(lat, lng);
  return {
    city: result.name,
    state: result.adminName1,
    country: result.countryName
  };
}

// ============ HELPER FUNCTIONS ============

function formatLocation(rawResult) {
  if (!rawResult?.[0]?.[0]) {
    return { name: 'Unknown', displayName: 'Unknown Location' };
  }

  const data = rawResult[0][0];
  const location = {
    name: data.name || '',
    adminName1: data.admin1Code?.name || data.admin1Code || '',
    adminName2: data.admin2Code?.name || data.admin2Code || '',
    countryCode: data.countryCode || '',
    countryName: COUNTRY_NAMES[data.countryCode] || data.countryCode,
    population: data.population || 0
  };

  // Build display name
  const parts = [location.name];
  if (location.adminName2 && location.adminName2 !== location.name) {
    parts.push(location.adminName2);
  }
  if (location.adminName1) parts.push(location.adminName1);
  if (location.countryName) parts.push(location.countryName);
  
  location.displayName = parts.filter(Boolean).join(', ');
  return location;
}

// ============ CACHE MANAGEMENT ============

async function getCacheStats() {
  const [totalEntries, hitStats] = await Promise.all([
    GeoCache.countDocuments(),
    GeoCache.aggregate([{ $group: { _id: null, totalHits: { $sum: '$hitCount' } } }])
  ]);
  
  return {
    totalEntries,
    totalHits: hitStats[0]?.totalHits || 0,
    avgHitsPerEntry: totalEntries > 0 ? (hitStats[0]?.totalHits || 0) / totalEntries : 0
  };
}

async function clearOldCache(daysOld = 90) {
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  const result = await GeoCache.deleteMany({ lastAccessedAt: { $lt: cutoff } });
  return result.deletedCount;
}

// ============ EXPORTS ============

module.exports = {
  initGeocoder,
  isGeocoderReady,
  reverseGeocode,
  reverseGeocodeBatch,
  getLocationName,
  getLocationShort,
  getCacheStats,
  clearOldCache,
  GeoCache  // Export model for direct queries if needed
};
