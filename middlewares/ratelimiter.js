// Rate limiting middleware

const rateLimitMap = new Map();

export const rateLimiter = (windowMs = 15 * 60 * 1000, maxRequests = 100) => {
  return (req, res, next) => {
    const clientId = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Clean up old entries
    if (rateLimitMap.has(clientId)) {
      const requests = rateLimitMap.get(clientId);
      const validRequests = requests.filter(timestamp => timestamp > windowStart);
      
      if (validRequests.length === 0) {
        rateLimitMap.delete(clientId);
      } else {
        rateLimitMap.set(clientId, validRequests);
      }
    }

    // Check current request count
    const currentRequests = rateLimitMap.get(clientId) || [];
    
    if (currentRequests.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        message: 'Too many requests, please try again later',
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }

    // Add current request
    currentRequests.push(now);
    rateLimitMap.set(clientId, currentRequests);

    // Set rate limit headers
    res.set({
      'X-RateLimit-Limit': maxRequests,
      'X-RateLimit-Remaining': Math.max(0, maxRequests - currentRequests.length),
      'X-RateLimit-Reset': new Date(now + windowMs).toISOString()
    });

    next();
  };
};

// Specific rate limiters for different endpoints
export const authRateLimit = rateLimiter(15 * 60 * 1000, 5); // 5 requests per 15 minutes for auth
export const generalRateLimit = rateLimiter(15 * 60 * 1000, 100); // 100 requests per 15 minutes for general API
export const uploadRateLimit = rateLimiter(60 * 60 * 1000, 10); // 10 uploads per hour