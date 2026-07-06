const mongoose = require('mongoose');
const User = require('../model/user');
const Business = require('../model/Business');
const Notification = require('../model/Notification');
const SupportFeatureAccess = require('../model/SupportFeatureAccess');
const SupportCategory = require('../model/supportCategory');
const SupportIssueType = require('../model/supportIssueType');
const SupportTicket = require('../model/supportTicket');
const { sendNotification } = require('../services/socketService');

const VALID_SCOPES = [
    'review_management',
    'gbp_record_management',
    'social_media_management',
    'jd_management',
    'leads_management',
    'web_dev_management',
];

const VALID_PRIORITIES = ['high', 'medium', 'low'];
const VALID_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

const toId = (value) => value?._id?.toString?.() || value?.toString?.();

const actorSnapshot = (user) => ({
    id: user._id,
    name: user.username || user.email || '',
    email: user.email || '',
});

const historyEntry = (action, message, actor, extra = {}) => ({
    action,
    message: message || '',
    performed_by: actor._id,
    performed_by_name: actor.username || actor.email || '',
    performed_by_email: actor.email || '',
    performed_at: new Date(),
    ...extra,
});

const parsePagination = (query) => {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    return { page, limit, skip: (page - 1) * limit };
};

const formatTicketDate = (date = new Date()) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
};

const generateTicketId = async () => {
    const datePart = formatTicketDate();
    const prefix = `SUP-${datePart}`;
    const todayCount = await SupportTicket.countDocuments({
        ticket_id: { $regex: `^${prefix}-` },
    });
    return `${prefix}-${String(todayCount + 1).padStart(4, '0')}`;
};

const getSupportAccess = async (userId) => {
    const access = await SupportFeatureAccess.findOne({ user_id: userId }).lean();
    return access || {
        user_id: userId,
        allowed_scopes: [],
        can_raise: true,
        can_manage: false,
    };
};

const getManagedUserIds = async (adminId) => {
    const users = await User.find({ managed_by: adminId, is_deleted: false })
        .select('_id')
        .lean();
    return users.map(user => user._id);
};

const getVisibleTicketFilter = async (user) => {
    if (user.role === 'super_admin') return {};

    if (user.role === 'admin') {
        const managedUserIds = await getManagedUserIds(user._id);
        return { raised_by: { $in: [user._id, ...managedUserIds] } };
    }

    const access = await getSupportAccess(user._id);
    const visibleScopes = Array.from(new Set([
        ...(user.scopes || []),
        ...(access.allowed_scopes || []),
    ].filter(scope => VALID_SCOPES.includes(scope))));

    if (visibleScopes.length > 0) {
        return {
            $or: [
                { raised_by: user._id },
                { scope_key: { $in: visibleScopes } },
            ],
        };
    }

    return { raised_by: user._id };
};

const canRaiseInScope = async (user, scopeKey) => {
    if (user.role === 'super_admin' || user.role === 'admin') return true;
    const scopes = user.scopes || [];
    if (scopes.includes(scopeKey)) return true;
    const access = await getSupportAccess(user._id);
    return !!access.can_raise && access.allowed_scopes.includes(scopeKey);
};

const canManageTicket = async (user, ticket) => {
    if (!ticket) return false;
    if (user.role === 'super_admin') return true;

    if (user.role === 'admin') {
        if (toId(ticket.raised_by) === toId(user._id)) return true;
        const managedUser = await User.findOne({
            _id: ticket.raised_by,
            managed_by: user._id,
            is_deleted: false,
        }).select('_id').lean();
        return !!managedUser;
    }

    const userScopes = user.scopes || [];
    if (userScopes.includes(ticket.scope_key)) return true;

    const access = await getSupportAccess(user._id);
    return (access.allowed_scopes || []).includes(ticket.scope_key);
};

const canParticipateInTicket = async (user, ticket) => {
    if (toId(ticket?.raised_by) === toId(user._id)) return true;
    return canManageTicket(user, ticket);
};

const populateTicketRefs = (query) => query
    .populate('category_id', 'name scope_key is_active')
    .populate('issue_type_id', 'title priority_default is_active');

const createAndSendNotification = async ({ recipientId, title, message, type, businessId, triggeredByUserId }) => {
    if (!recipientId) return null;

    const notification = await Notification.create({
        user_id: recipientId,
        title,
        message,
        type,
        business_id: businessId || null,
        triggered_by_user_id: triggeredByUserId || null,
    });

    const populated = await Notification.findById(notification._id)
        .populate('triggered_by_user_id', 'username email')
        .populate('business_id', 'business_name location')
        .lean();

    sendNotification(recipientId, populated);
    return populated;
};

const getScopeManagerRecipientIds = async (scopeKey, actorId) => {
    const [accessRows, superAdmins] = await Promise.all([
        SupportFeatureAccess.find({
            can_manage: true,
            allowed_scopes: scopeKey,
        }).select('user_id').lean(),
        User.find({ role: 'super_admin', is_deleted: false, is_active: true }).select('_id').lean(),
    ]);

    const ids = [
        ...accessRows.map(row => row.user_id?.toString()),
        ...superAdmins.map(user => user._id.toString()),
    ].filter(Boolean);

    return Array.from(new Set(ids)).filter(id => id !== actorId?.toString());
};

const getScopeUserRecipientIds = async (scopeKey, actorId) => {
    const [scopeUsers, accessRows] = await Promise.all([
        User.find({
            role: 'user',
            scopes: scopeKey,
            is_deleted: false,
            is_active: true,
        }).select('_id').lean(),
        SupportFeatureAccess.find({
            allowed_scopes: scopeKey,
            $or: [{ can_raise: true }, { can_manage: true }],
        }).select('user_id').lean(),
    ]);

    const ids = [
        ...scopeUsers.map(user => user._id.toString()),
        ...accessRows.map(row => row.user_id?.toString()),
    ].filter(Boolean);

    return Array.from(new Set(ids)).filter(id => id !== actorId?.toString());
};

const getRaisedUserAdminRecipientIds = async (raisedByUserId) => {
    const user = await User.findById(raisedByUserId).select('managed_by').lean();
    return (user?.managed_by || []).map(id => id.toString());
};

const notifyTicketEvent = async (ticket, actor, eventType, messageOverride = '') => {
    const actorId = actor._id.toString();
    const baseMessage = messageOverride || `${ticket.issue_title_snapshot} for ${ticket.business_name_snapshot}`;
    let title = 'Support Ticket Update';
    let type = 'support_issue_status_changed';
    let recipientIds = [];

    if (eventType === 'created') {
        title = 'New Support Issue Raised';
        type = 'support_issue_raised';
        recipientIds = [
            ...await getScopeUserRecipientIds(ticket.scope_key, actor._id),
            ...await getScopeManagerRecipientIds(ticket.scope_key, actor._id),
            ...await getRaisedUserAdminRecipientIds(ticket.raised_by),
        ];
    } else if (eventType === 'remark') {
        title = 'Support Issue Remark Added';
        type = 'support_issue_remark';
        const participantIds = (ticket.history || []).map(entry => entry.performed_by?.toString()).filter(Boolean);
        recipientIds = [
            ticket.raised_by?.toString(),
            ...participantIds,
            ...await getScopeUserRecipientIds(ticket.scope_key, actor._id),
            ...await getScopeManagerRecipientIds(ticket.scope_key, actor._id),
        ];
    } else if (eventType === 'resolved') {
        title = 'Support Issue Resolved';
        type = 'support_issue_resolved';
        recipientIds = [
            ticket.raised_by?.toString(),
            ...await getScopeUserRecipientIds(ticket.scope_key, actor._id),
            ...await getRaisedUserAdminRecipientIds(ticket.raised_by),
            ...await getScopeManagerRecipientIds(ticket.scope_key, actor._id),
        ];
    } else if (eventType === 'reopened') {
        title = 'Support Issue Reopened';
        type = 'support_issue_reopened';
        recipientIds = [
            ticket.resolved_by?.toString(),
            ticket.raised_by?.toString(),
            ...await getScopeUserRecipientIds(ticket.scope_key, actor._id),
            ...await getRaisedUserAdminRecipientIds(ticket.raised_by),
            ...await getScopeManagerRecipientIds(ticket.scope_key, actor._id),
        ];
    } else {
        recipientIds = [
            ticket.raised_by?.toString(),
            ...await getScopeUserRecipientIds(ticket.scope_key, actor._id),
            ...await getScopeManagerRecipientIds(ticket.scope_key, actor._id),
        ];
    }

    const uniqueRecipientIds = Array.from(new Set(recipientIds.filter(Boolean)))
        .filter(id => id !== actorId);

    await Promise.all(uniqueRecipientIds.map(recipientId => createAndSendNotification({
        recipientId,
        title,
        message: baseMessage,
        type,
        businessId: ticket.business_id,
        triggeredByUserId: actor._id,
    })));
};

const getBusinessOptions = async (req, res) => {
    try {
        const businesses = await Business.find({ is_active: true })
            .select('business_name location short_code')
            .sort({ business_name: 1 })
            .lean();

        return res.status(200).json(businesses);
    } catch (error) {
        console.error('[Support] getBusinessOptions error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const getCategories = async (req, res) => {
    try {
        let filter = {};
        if (req.user.role !== 'super_admin' || req.query.include_inactive !== 'true') {
            filter.is_active = true;
        }

        if (req.user.role === 'user') {
            const access = await getSupportAccess(req.user._id);
            const allowedScopes = Array.from(new Set([...(req.user.scopes || []), ...(access.allowed_scopes || [])]));
            filter.scope_key = { $in: allowedScopes };
        }

        const categories = await SupportCategory.find(filter)
            .sort({ name: 1 })
            .lean();

        return res.status(200).json(categories);
    } catch (error) {
        console.error('[Support] getCategories error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const createCategory = async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Super admin only' });
        }

        const { name, scope_key, is_active = true } = req.body;
        if (!name || !VALID_SCOPES.includes(scope_key)) {
            return res.status(400).json({ error: 'Valid name and scope_key are required' });
        }

        const category = await SupportCategory.create({
            name,
            scope_key,
            is_active,
            created_by: req.user._id,
            updated_by: req.user._id,
        });

        return res.status(201).json(category);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ error: 'Category already exists for this scope' });
        }
        console.error('[Support] createCategory error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const updateCategory = async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Super admin only' });
        }

        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid category ID' });
        }

        const update = {};
        ['name', 'scope_key', 'is_active'].forEach(field => {
            if (req.body[field] !== undefined) update[field] = req.body[field];
        });

        if (update.scope_key && !VALID_SCOPES.includes(update.scope_key)) {
            return res.status(400).json({ error: 'Invalid scope_key' });
        }

        update.updated_by = req.user._id;

        const category = await SupportCategory.findByIdAndUpdate(
            id,
            { $set: update },
            { returnDocument: 'after', runValidators: true }
        ).lean();

        if (!category) return res.status(404).json({ error: 'Category not found' });
        return res.status(200).json(category);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ error: 'Category already exists for this scope' });
        }
        console.error('[Support] updateCategory error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const deleteCategory = async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Super admin only' });
        }

        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid category ID' });
        }

        const category = await SupportCategory.findByIdAndDelete(id).lean();
        if (!category) return res.status(404).json({ error: 'Category not found' });

        await SupportIssueType.deleteMany({ category_id: id });

        return res.status(200).json({ message: 'Category deleted permanently' });
    } catch (error) {
        console.error('[Support] deleteCategory error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const getIssueTypes = async (req, res) => {
    try {
        const { category_id } = req.query;
        const filter = {};
        if (category_id) {
            if (!mongoose.Types.ObjectId.isValid(category_id)) {
                return res.status(400).json({ error: 'Invalid category_id' });
            }
            filter.category_id = category_id;
        }

        if (req.user.role !== 'super_admin' || req.query.include_inactive !== 'true') {
            filter.is_active = true;
        }

        const issueTypes = await SupportIssueType.find(filter)
            .populate('category_id', 'name scope_key is_active')
            .sort({ title: 1 })
            .lean();

        return res.status(200).json(issueTypes);
    } catch (error) {
        console.error('[Support] getIssueTypes error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const createIssueType = async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Super admin only' });
        }

        const { category_id, title, priority_default = 'medium', is_active = true } = req.body;
        if (!mongoose.Types.ObjectId.isValid(category_id) || !title || !VALID_PRIORITIES.includes(priority_default)) {
            return res.status(400).json({ error: 'Valid category_id, title and priority_default are required' });
        }

        const category = await SupportCategory.findById(category_id).lean();
        if (!category) return res.status(404).json({ error: 'Category not found' });

        const issueType = await SupportIssueType.create({
            category_id,
            title,
            priority_default,
            is_active,
            created_by: req.user._id,
            updated_by: req.user._id,
        });

        return res.status(201).json(issueType);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ error: 'Issue type already exists in this category' });
        }
        console.error('[Support] createIssueType error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const updateIssueType = async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Super admin only' });
        }

        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid issue type ID' });
        }

        const update = {};
        ['category_id', 'title', 'priority_default', 'is_active'].forEach(field => {
            if (req.body[field] !== undefined) update[field] = req.body[field];
        });

        if (update.category_id && !mongoose.Types.ObjectId.isValid(update.category_id)) {
            return res.status(400).json({ error: 'Invalid category_id' });
        }
        if (update.priority_default && !VALID_PRIORITIES.includes(update.priority_default)) {
            return res.status(400).json({ error: 'Invalid priority_default' });
        }

        update.updated_by = req.user._id;

        const issueType = await SupportIssueType.findByIdAndUpdate(
            id,
            { $set: update },
            { returnDocument: 'after', runValidators: true }
        ).lean();

        if (!issueType) return res.status(404).json({ error: 'Issue type not found' });
        return res.status(200).json(issueType);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ error: 'Issue type already exists in this category' });
        }
        console.error('[Support] updateIssueType error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const deleteIssueType = async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Super admin only' });
        }

        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid issue type ID' });
        }

        const issueType = await SupportIssueType.findByIdAndDelete(id).lean();
        if (!issueType) return res.status(404).json({ error: 'Issue type not found' });

        return res.status(200).json({ message: 'Issue type deleted permanently' });
    } catch (error) {
        console.error('[Support] deleteIssueType error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const getTickets = async (req, res) => {
    try {
        const { page, limit, skip } = parsePagination(req.query);
        const filter = await getVisibleTicketFilter(req.user);

        if (req.query.status && VALID_STATUSES.includes(req.query.status)) filter.status = req.query.status;
        if (req.query.priority && VALID_PRIORITIES.includes(req.query.priority)) filter.priority = req.query.priority;
        if (req.query.scope_key && VALID_SCOPES.includes(req.query.scope_key)) filter.scope_key = req.query.scope_key;
        if (req.query.category_id && mongoose.Types.ObjectId.isValid(req.query.category_id)) filter.category_id = req.query.category_id;
        if (req.query.business_id && mongoose.Types.ObjectId.isValid(req.query.business_id)) filter.business_id = req.query.business_id;

        if (req.query.search) {
            const searchRegex = { $regex: req.query.search, $options: 'i' };
            const searchFilter = {
                $or: [
                    { business_name_snapshot: searchRegex },
                    { business_short_code_snapshot: searchRegex },
                    { ticket_id: searchRegex },
                    { issue_title_snapshot: searchRegex },
                    { category_name_snapshot: searchRegex },
                    { raised_by_name_snapshot: searchRegex },
                    { raised_by_email_snapshot: searchRegex },
                ],
            };

            if (filter.$or) {
                filter.$and = [{ $or: filter.$or }, searchFilter];
                delete filter.$or;
            } else {
                Object.assign(filter, searchFilter);
            }
        }

        const [tickets, total] = await Promise.all([
            populateTicketRefs(SupportTicket.find(filter))
                .select('-history')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            SupportTicket.countDocuments(filter),
        ]);

        return res.status(200).json({ total, page, limit, data: tickets });
    } catch (error) {
        console.error('[Support] getTickets error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const getTicketById = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid ticket ID' });
        }

        const ticket = await populateTicketRefs(SupportTicket.findById(id)).lean();
        if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

        const hasAccess = await canParticipateInTicket(req.user, ticket);
        if (!hasAccess) return res.status(403).json({ error: 'Access denied' });

        return res.status(200).json(ticket);
    } catch (error) {
        console.error('[Support] getTicketById error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const createTicket = async (req, res) => {
    try {
        const { business_id, category_id, issue_type_id, priority, remark } = req.body;
        if (!mongoose.Types.ObjectId.isValid(business_id) ||
            !mongoose.Types.ObjectId.isValid(category_id) ||
            !mongoose.Types.ObjectId.isValid(issue_type_id)) {
            return res.status(400).json({ error: 'Valid business, category and issue type are required' });
        }
        if (!remark || !remark.trim()) {
            return res.status(400).json({ error: 'Remark is required' });
        }

        const [business, category, issueType] = await Promise.all([
            Business.findOne({ _id: business_id, is_active: true }).select('business_name location short_code').lean(),
            SupportCategory.findOne({ _id: category_id, is_active: true }).lean(),
            SupportIssueType.findOne({ _id: issue_type_id, category_id, is_active: true }).lean(),
        ]);

        if (!business) return res.status(404).json({ error: 'Business not found' });
        if (!category) return res.status(404).json({ error: 'Category not found' });
        if (!issueType) return res.status(404).json({ error: 'Issue type not found' });

        const allowedToRaise = await canRaiseInScope(req.user, category.scope_key);
        if (!allowedToRaise) {
            return res.status(403).json({ error: 'You do not have access to raise this category issue' });
        }

        const actor = actorSnapshot(req.user);
        let ticket;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                ticket = await SupportTicket.create({
                    ticket_id: await generateTicketId(),
                    business_id: business._id,
                    business_name_snapshot: business.business_name,
                    business_location_snapshot: business.location || '',
                    business_short_code_snapshot: business.short_code || '',
                    category_id: category._id,
                    category_name_snapshot: category.name,
                    issue_type_id: issueType._id,
                    issue_title_snapshot: issueType.title,
                    scope_key: category.scope_key,
                    priority: VALID_PRIORITIES.includes(priority) ? priority : issueType.priority_default,
                    status: 'open',
                    remark,
                    raised_by: req.user._id,
                    raised_by_name_snapshot: actor.name,
                    raised_by_email_snapshot: actor.email,
                    history: [historyEntry('created', remark, req.user, { to_status: 'open' })],
                });
                break;
            } catch (error) {
                if (error.code !== 11000 || attempt === 2) throw error;
            }
        }

        const populated = await populateTicketRefs(SupportTicket.findById(ticket._id)).lean();
        await notifyTicketEvent(populated, req.user, 'created', `New issue raised for ${populated.business_name_snapshot}: ${populated.issue_title_snapshot}`);

        return res.status(201).json(populated);
    } catch (error) {
        console.error('[Support] createTicket error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const addRemark = async (req, res) => {
    try {
        const { id } = req.params;
        const { message } = req.body;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid ticket ID' });
        }
        if (!message || !message.trim()) {
            return res.status(400).json({ error: 'Remark message is required' });
        }

        const ticket = await SupportTicket.findById(id);
        if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

        const hasAccess = await canParticipateInTicket(req.user, ticket);
        if (!hasAccess) return res.status(403).json({ error: 'Access denied' });

        ticket.last_remark = message;
        ticket.last_remark_by = req.user._id;
        ticket.last_remark_by_name = req.user.username || req.user.email || '';
        ticket.last_remark_at = new Date();
        ticket.history.push(historyEntry('remark_added', message, req.user));
        await ticket.save();

        const populated = await populateTicketRefs(SupportTicket.findById(ticket._id)).lean();
        await notifyTicketEvent(populated, req.user, 'remark', `New remark on ${populated.business_name_snapshot}: ${populated.issue_title_snapshot}`);

        return res.status(200).json(populated);
    } catch (error) {
        console.error('[Support] addRemark error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const updateTicketStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, message = '' } = req.body;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid ticket ID' });
        }
        if (!VALID_STATUSES.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const ticket = await SupportTicket.findById(id);
        if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

        const hasAccess = await canManageTicket(req.user, ticket);
        if (!hasAccess) return res.status(403).json({ error: 'Access denied' });

        const previousStatus = ticket.status;
        ticket.status = status;

        if (status === 'resolved' || status === 'closed') {
            ticket.resolved_by = req.user._id;
            ticket.resolved_by_name = req.user.username || req.user.email || '';
            ticket.resolved_by_email = req.user.email || '';
            ticket.resolved_at = new Date();
            ticket.resolve_message = message || ticket.resolve_message || '';
            ticket.history.push(historyEntry('resolved', message || ticket.resolve_message, req.user, {
                from_status: previousStatus,
                to_status: status,
            }));
        } else if (previousStatus === 'resolved' && status !== 'resolved') {
            ticket.history.push(historyEntry('reopened', message, req.user, {
                from_status: previousStatus,
                to_status: status,
            }));
        } else {
            ticket.history.push(historyEntry('status_changed', message, req.user, {
                from_status: previousStatus,
                to_status: status,
            }));
        }

        await ticket.save();

        const populated = await populateTicketRefs(SupportTicket.findById(ticket._id)).lean();
        const eventType = status === 'resolved' || status === 'closed'
            ? 'resolved'
            : previousStatus === 'resolved'
                ? 'reopened'
                : 'status';
        await notifyTicketEvent(populated, req.user, eventType, `Support issue ${status.replace('_', ' ')} for ${populated.business_name_snapshot}: ${populated.issue_title_snapshot}`);

        return res.status(200).json(populated);
    } catch (error) {
        console.error('[Support] updateTicketStatus error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const updateTicketPriority = async (req, res) => {
    try {
        const { id } = req.params;
        const { priority } = req.body;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid ticket ID' });
        }
        if (!VALID_PRIORITIES.includes(priority)) {
            return res.status(400).json({ error: 'Invalid priority' });
        }

        const ticket = await SupportTicket.findById(id);
        if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

        const hasAccess = await canManageTicket(req.user, ticket);
        if (!hasAccess) return res.status(403).json({ error: 'Access denied' });

        ticket.priority = priority;
        ticket.history.push(historyEntry('priority_changed', `Priority changed to ${priority}`, req.user));
        await ticket.save();

        const populated = await populateTicketRefs(SupportTicket.findById(ticket._id)).lean();
        return res.status(200).json(populated);
    } catch (error) {
        console.error('[Support] updateTicketPriority error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const getAccessList = async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Super admin only' });
        }

        const accessList = await SupportFeatureAccess.find({})
            .populate('user_id', 'username email role scopes is_active')
            .populate('granted_by', 'username email')
            .sort({ updatedAt: -1 })
            .lean();

        return res.status(200).json(accessList);
    } catch (error) {
        console.error('[Support] getAccessList error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const getMyAccess = async (req, res) => {
    try {
        if (req.user.role === 'super_admin' || req.user.role === 'admin') {
            return res.status(200).json({
                allowed_scopes: VALID_SCOPES,
                can_raise: true,
                can_manage: true,
            });
        }

        const access = await getSupportAccess(req.user._id);
        return res.status(200).json(access);
    } catch (error) {
        console.error('[Support] getMyAccess error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const updateAccess = async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Super admin only' });
        }

        const { userId } = req.params;
        const { allowed_scopes = [], can_raise = true, can_manage = false } = req.body;

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        const sanitizedScopes = Array.from(new Set(allowed_scopes.filter(scope => VALID_SCOPES.includes(scope))));
        const targetUser = await User.findById(userId).select('_id role').lean();
        if (!targetUser) return res.status(404).json({ error: 'User not found' });

        const access = await SupportFeatureAccess.findOneAndUpdate(
            { user_id: userId },
            {
                $set: {
                    allowed_scopes: sanitizedScopes,
                    can_raise: !!can_raise,
                    can_manage: !!can_manage,
                    granted_by: req.user._id,
                },
            },
            { upsert: true, returnDocument: 'after', runValidators: true }
        ).lean();

        return res.status(200).json(access);
    } catch (error) {
        console.error('[Support] updateAccess error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = {
    VALID_SCOPES,
    getBusinessOptions,
    getCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    getIssueTypes,
    createIssueType,
    updateIssueType,
    deleteIssueType,
    getTickets,
    getTicketById,
    createTicket,
    addRemark,
    updateTicketStatus,
    updateTicketPriority,
    getAccessList,
    getMyAccess,
    updateAccess,
};
