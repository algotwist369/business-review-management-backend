const gbpRecordManagementMiddleware = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    if (req.user.role === 'super_admin' || req.user.role === 'admin') {
        return next();
    }

    if (req.user.role === 'user') {
        const scopes = req.user.scopes || ['review_management'];
        if (scopes.includes('gbp_record_management')) {
            return next();
        }
    }

    return res.status(403).json({ error: 'Access denied: GBP record management scope required' });
};

module.exports = gbpRecordManagementMiddleware;
