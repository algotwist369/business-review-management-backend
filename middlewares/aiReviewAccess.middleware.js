const aiReviewAccessMiddleware = (req, res, next) => {
    if (req.user.role === 'super_admin' || req.user.ai_review_access) {
        return next();
    }

    return res.status(403).json({ error: 'AI review access is not enabled' });
};

module.exports = aiReviewAccessMiddleware;
