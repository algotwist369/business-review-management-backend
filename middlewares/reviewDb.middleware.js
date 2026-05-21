const { connectReviewDB, isReviewDbReady } = require('../config/reviewDb');

const reviewDbMiddleware = async (req, res, next) => {
    try {
        await connectReviewDB();

        if (!isReviewDbReady()) {
            return res.status(503).json({ error: 'Review database is not configured' });
        }

        next();
    } catch (error) {
        console.error('Review DB Error:', error);
        return res.status(503).json({ error: 'Review database is unavailable' });
    }
};

module.exports = reviewDbMiddleware;
