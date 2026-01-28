const geocoder = require('local-reverse-geocoder');
const GeoCache = require('./models/GeoCache');

class GeocoderService {
  constructor() {
    this.isInitialized = false;
    this.initPromise = null;
  }

  /**
   * Initialize the local geocoder (downloads ~2GB data on first run)
   * Call this once when your server starts
   */
  async init() {
    if (this.isInitialized) return;
    
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise((resolve, reject) => {
      console.log('🌍 Initializing local geocoder... (first run downloads ~2GB)');
      
      geocoder.init(
        {
          load: {
            admin1: true,   // States/Provinces
            admin2: true,   // Districts/Counties
            admin3: true,   // Sub-districts
            admin4: true,   // Localities
            alternateNames: false  // Skip to save memory
          },
          dumpDirectory: process.env.GEOCODER_DATA_DIR || './geocoder-data'
        },
        (err) => {
          if (err) {
            console.error('❌ Geocoder init failed:', err);
            reject(err);
          } else {
            console.log('✅ Local geocoder initialized successfully!');
            this.isInitialized = true;
            resolve();
          }
        }
      );
    });

    return this.initPromise;
  }

  /**
   * Generate cache key from coordinates
   * Rounds to 3 decimal places (~100m precision)
   */
  generateCacheKey(lat, lng) {
    const roundedLat = Math.round(lat * 1000) / 1000;
    const roundedLng = Math.round(lng * 1000) / 1000;
    return `${roundedLat},${roundedLng}`;
  }

  /**
   * Lookup location from local geocoder
   */
  lookupLocal(lat, lng) {
    return new Promise((resolve, reject) => {
      geocoder.lookUp({ latitude: lat, longitude: lng }, 1, (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });
  }

  /**
   * Format the raw geocoder response into clean location object
   */
  formatLocation(rawResult) {
    if (!rawResult || !rawResult[0] || !rawResult[0][0]) {
      return null;
    }

    const data = rawResult[0][0];
    
    const location = {
      name: data.name || '',
      adminName1: data.admin1Code?.name || data.admin1Code || '',
      adminName2: data.admin2Code?.name || data.admin2Code || '',
      countryCode: data.countryCode || '',
      countryName: this.getCountryName(data.countryCode),
      population: data.population || 0,
      featureCode: data.featureCode || ''
    };

    // Build display name
    const parts = [location.name];
    if (location.adminName2 && location.adminName2 !== location.name) {
      parts.push(location.adminName2);
    }
    if (location.adminName1) {
      parts.push(location.adminName1);
    }
    if (location.countryName) {
      parts.push(location.countryName);
    }
    location.displayName = parts.filter(Boolean).join(', ');

    return location;
  }

  /**
   * Get country name from country code
   */
  getCountryName(code) {
    const countries = {
      'IN': 'India',
      'US': 'United States',
      'GB': 'United Kingdom',
      'CA': 'Canada',
      'AU': 'Australia',
      'DE': 'Germany',
      'FR': 'France',
      'JP': 'Japan',
      'CN': 'China',
      'BR': 'Brazil',
      // Add more as needed
    };
    return countries[code] || code;
  }

  /**
   * Main method: Get location from coordinates
   * Uses MongoDB cache first, falls back to local geocoder
   * 
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @param {boolean} skipCache - Force fresh lookup (default: false)
   * @returns {Object} Location data
   */
  async getLocation(lat, lng, skipCache = false) {
    if (!this.isInitialized) {
      throw new Error('Geocoder not initialized. Call init() first.');
    }

    const cacheKey = this.generateCacheKey(lat, lng);
    
    // Step 1: Check MongoDB cache
    if (!skipCache) {
      try {
        const cached = await GeoCache.findOneAndUpdate(
          { cacheKey },
          { 
            $inc: { hitCount: 1 },
            $set: { lastAccessedAt: new Date() }
          },
          { new: true }
        );

        if (cached) {
          console.log(`📦 Cache HIT for ${cacheKey}`);
          return {
            ...cached.location,
            source: 'cache',
            cacheKey,
            hitCount: cached.hitCount
          };
        }
      } catch (err) {
        console.error('Cache lookup error:', err.message);
        // Continue to local lookup
      }
    }

    // Step 2: Local geocoder lookup
    console.log(`🔍 Cache MISS for ${cacheKey}, looking up locally...`);
    
    const rawResult = await this.lookupLocal(lat, lng);
    const location = this.formatLocation(rawResult);

    if (!location) {
      return {
        name: 'Unknown',
        displayName: 'Unknown Location',
        source: 'local',
        cacheKey
      };
    }

    // Step 3: Save to MongoDB cache
    try {
      await GeoCache.findOneAndUpdate(
        { cacheKey },
        {
          cacheKey,
          latitude: lat,
          longitude: lng,
          location,
          rawResponse: rawResult,
          hitCount: 1,
          lastAccessedAt: new Date()
        },
        { upsert: true, new: true }
      );
      console.log(`💾 Cached location for ${cacheKey}`);
    } catch (err) {
      console.error('Cache save error:', err.message);
      // Don't fail - just return the result
    }

    return {
      ...location,
      source: 'local',
      cacheKey
    };
  }

  /**
   * Batch lookup multiple coordinates
   * Efficient for processing multiple locations at once
   */
  async getLocations(coordinates) {
    const results = [];
    
    for (const coord of coordinates) {
      try {
        const result = await this.getLocation(coord.lat, coord.lng);
        results.push({ ...coord, location: result });
      } catch (err) {
        results.push({ ...coord, location: null, error: err.message });
      }
    }
    
    return results;
  }

  /**
   * Get cache statistics
   */
  async getCacheStats() {
    const totalEntries = await GeoCache.countDocuments();
    const totalHits = await GeoCache.aggregate([
      { $group: { _id: null, total: { $sum: '$hitCount' } } }
    ]);
    
    return {
      totalEntries,
      totalHits: totalHits[0]?.total || 0,
      avgHitsPerEntry: totalEntries > 0 ? (totalHits[0]?.total || 0) / totalEntries : 0
    };
  }

  /**
   * Clear old cache entries (utility method)
   */
  async clearOldCache(daysOld = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    
    const result = await GeoCache.deleteMany({
      lastAccessedAt: { $lt: cutoffDate }
    });
    
    return result.deletedCount;
  }
}

// Export singleton instance
module.exports = new GeocoderService();
