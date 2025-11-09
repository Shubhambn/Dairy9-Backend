// services/cache.service.js
class CacheService {
  constructor() {
    this.cache = new Map();
    this.defaultTTL = 10 * 60 * 1000; // 10 minutes
  }

  async get(key) {
    try {
      const item = this.cache.get(key);
      if (!item) return null;
      
      if (Date.now() > item.expiry) {
        this.cache.delete(key);
        return null;
      }
      
      return item.value;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  async set(key, value, ttl = this.defaultTTL) {
    try {
      this.cache.set(key, {
        value,
        expiry: Date.now() + ttl
      });
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  async del(key) {
    try {
      return this.cache.delete(key);
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  }

  async clearPattern(pattern) {
    try {
      const keys = Array.from(this.cache.keys()).filter(key => 
        key.includes(pattern)
      );
      keys.forEach(key => this.cache.delete(key));
      return true;
    } catch (error) {
      console.error('Cache clear pattern error:', error);
      return false;
    }
  }

  // Inventory-specific methods
  async getInventoryCache(retailerId, filters = {}) {
    const key = `inventory:${retailerId}:${JSON.stringify(filters)}`;
    return this.get(key);
  }

  async setInventoryCache(retailerId, data, filters = {}) {
    const key = `inventory:${retailerId}:${JSON.stringify(filters)}`;
    return this.set(key, data, 5 * 60 * 1000); // 5 minutes for inventory
  }

  async invalidateInventoryCache(retailerId) {
    return this.clearPattern(`inventory:${retailerId}`);
  }
}

export default new CacheService();