// services/cache.service.js
class CacheService {
  constructor() {
    this.cache = new Map();
    this.defaultTTL = 300000; // 5 minutes
  }

  async getInventoryCache(retailerId, filters = {}) {
    const key = `inventory:${retailerId}:${JSON.stringify(filters)}`;
    const cached = this.cache.get(key);
    
    if (cached && Date.now() < cached.expiry) {
      return cached.data;
    }
    
    this.cache.delete(key);
    return null;
  }

  async setInventoryCache(retailerId, data, filters = {}, ttl = this.defaultTTL) {
    const key = `inventory:${retailerId}:${JSON.stringify(filters)}`;
    this.cache.set(key, {
      data,
      expiry: Date.now() + ttl
    });
  }

  async invalidateInventoryCache(retailerId) {
    const prefix = `inventory:${retailerId}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }
}

export default new CacheService();