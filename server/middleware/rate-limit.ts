import rateLimit from 'express-rate-limit';

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { 
    error: "Too many requests", 
    message: "Rate limit exceeded. Please try again later.",
    retryAfter: "15 minutes"
  }
});

export const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { 
    error: "Too many requests", 
    message: "Rate limit exceeded for admin endpoints.",
    retryAfter: "1 minute"
  }
});
