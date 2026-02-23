const superAdminMiddleware = (req, res, next) => {
    if (req.user.role !== 'super_admin') {
        return res.status(403).json({ error: 'Super Admin only' });
    }
    next();
};

module.exports = superAdminMiddleware;
