import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 3, // 3 requests per IP per minute
  message: { message: 'Too many requests, try later' }
});

export default limiter;
