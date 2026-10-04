const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,
  message: {
    success: false,
    message: 'Too many authentication attempts. Please try again after 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = (req, res, next) => {
  if (process.env.NODE_ENV === 'test') {
    return next();
  }
  return limiter(req, res, next);
};

module.exports = { authLimiter };
