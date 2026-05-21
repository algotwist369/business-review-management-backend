const jwt = require('jsonwebtoken');
const User = require('../model/user');

const authMiddleware = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');

        const user = await User.findById(decoded.id)
            .select('_id email username role is_active is_deleted assigned_businesses managed_by ai_review_access');

        if (!user || !user.is_active || user.is_deleted) {
            return res.status(401).json({ error: 'Invalid or inactive user' });
        }

        req.user = user;
        next();

    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

module.exports = authMiddleware;
