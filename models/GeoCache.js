const mongoose = require('mongoose');

const geoCacheSchema = new mongoose.Schema({
  // Rounded coordinates as cache key (3 decimal places = ~100m precision)
  cacheKey: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Original coordinates
  latitude: {
    type: Number,
    required: true
  },
  longitude: {
    type: Number,
    required: true
  },
  
  // Location data
  location: {
    name: String,           // City/Town name
    adminName1: String,     // State/Province
    adminName2: String,     // District/County
    countryCode: String,    // IN, US, etc.
    countryName: String,    // India, United States, etc.
    displayName: String,    // Full formatted address
    population: Number,
    featureCode: String     // PPL, PPLA, etc.
  },
  
  // Raw response from geocoder (for debugging)
  rawResponse: mongoose.Schema.Types.Mixed,
  
  // Metadata
  createdAt: {
    type: Date,
    default: Date.now
  },
  hitCount: {
    type: Number,
    default: 1
  },
  lastAccessedAt: {
    type: Date,
    default: Date.now
  }
});

// Index for geo queries (optional - for nearby lookups)
geoCacheSchema.index({ latitude: 1, longitude: 1 });

// TTL index - auto-delete after 90 days of no access (optional)
// geoCacheSchema.index({ lastAccessedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('GeoCache', geoCacheSchema);
