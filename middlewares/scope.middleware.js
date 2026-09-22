const requireScope = (requiredScope) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        // Admins and super admins bypass scope checks
        if (req.user.role === 'super_admin' || req.user.role === 'admin') {
            return next();
        }

        // Regular users must have the required scope
        const scopes = req.user.scopes || [];
        if (!scopes.includes(requiredScope)) {
            return res.status(403).json({ error: `Access denied: ${requiredScope} scope required` });
        }

        next();
    };
};

module.exports = { requireScope };
