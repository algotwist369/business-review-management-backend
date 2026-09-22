const mongoose = require('mongoose');
const ChatMessage = require('../model/ChatMessage');
const User = require('../model/user');
const ChatGroup = require('../model/ChatGroup');
const GroupMessage = require('../model/GroupMessage');
const { sendChatMessage, sendGroupChatMessage, sendGroupCreated } = require('../services/socketService');

// Helper to check if two users are allowed to communicate
const validateMessagingAccess = async (senderId, recipientId) => {
    if (senderId.toString() === recipientId.toString()) {
        return false; // Can't message oneself
    }

    const [sender, recipient] = await Promise.all([
        User.findById(senderId).lean(),
        User.findById(recipientId).lean()
    ]);

    if (!sender || !recipient || recipient.is_deleted || !recipient.is_active) {
        return false;
    }

    // Super Admin rules
    if (sender.role === 'super_admin') {
        // Super admins can message every active user/admin/super admin.
        return ['user', 'admin', 'super_admin'].includes(recipient.role);
    }
    if (recipient.role === 'super_admin') {
        if (['admin', 'super_admin'].includes(sender.role)) return true;

        if (sender.role === 'user') {
            const invitedBySuperAdmin = await ChatMessage.exists({
                sender_id: recipientId,
                recipient_id: senderId,
            });
            return !!invitedBySuperAdmin;
        }

        return false;
    }

    // Admins can message their managed users
    if (sender.role === 'admin') {
        if (recipient.role === 'user') {
            const isManaged = (recipient.managed_by || []).some(id => id.toString() === senderId.toString());
            return isManaged;
        }
        return false;
    }

    // Regular users can message their managing admins (cannot message super admins, which is handled above)
    if (sender.role === 'user') {
        if (recipient.role === 'admin') {
            const isManaging = (sender.managed_by || []).some(id => id.toString() === recipientId.toString());
            return isManaging;
        }
        return false;
    }

    return false;
};

// Fetch list of available chat contacts with unread badges and last message previews
const getContacts = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).lean();
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        let contactFilter = {
            is_deleted: false,
            is_active: true,
            _id: { $ne: user._id }
        };

        if (user.role === 'super_admin') {
            // Super admins see all active users/admins/super admins.
            contactFilter.role = { $in: ['user', 'admin', 'super_admin'] };
        } else if (user.role === 'admin') {
            // Admins see their managed users and super admins
            contactFilter.$or = [
                { role: 'super_admin' },
                { role: 'user', managed_by: user._id }
            ];
        } else if (user.role === 'user') {
            // Users see their managing admins. Super admins appear only after they message this user first.
            const managingAdminIds = (user.managed_by || [])
                .map(id => id?.toString())
                .filter(id => mongoose.Types.ObjectId.isValid(id))
                .map(id => new mongoose.Types.ObjectId(id));

            const superAdminSenderIds = await ChatMessage.distinct('sender_id', {
                recipient_id: user._id,
            });

            const invitedSuperAdminIds = superAdminSenderIds.length
                ? (await User.find({
                    _id: { $in: superAdminSenderIds },
                    role: 'super_admin',
                    is_deleted: false,
                    is_active: true,
                }).select('_id').lean()).map(admin => admin._id)
                : [];

            contactFilter.$or = [
                { role: 'admin', _id: { $in: managingAdminIds } },
                { role: 'super_admin', _id: { $in: invitedSuperAdminIds } },
            ];
        }

        const contacts = await User.find(contactFilter)
            .select('_id username email role')
            .lean();

        const contactIds = contacts.map(contact => contact._id);
        const messageStats = contactIds.length
            ? await ChatMessage.aggregate([
                {
                    $match: {
                        $or: [
                            { sender_id: user._id, recipient_id: { $in: contactIds } },
                            { sender_id: { $in: contactIds }, recipient_id: user._id },
                        ],
                    },
                },
                { $sort: { createdAt: -1 } },
                {
                    $addFields: {
                        contact_id: {
                            $cond: [{ $eq: ['$sender_id', user._id] }, '$recipient_id', '$sender_id'],
                        },
                    },
                },
                {
                    $group: {
                        _id: '$contact_id',
                        lastMessage: { $first: '$$ROOT' },
                        unreadCount: {
                            $sum: {
                                $cond: [
                                    { $and: [{ $eq: ['$recipient_id', user._id] }, { $eq: ['$is_read', false] }] },
                                    1,
                                    0,
                                ],
                            },
                        },
                    },
                },
            ])
            : [];

        const statsByContactId = new Map(messageStats.map(stat => [stat._id.toString(), stat]));

        const populatedContacts = contacts.map((contact) => {
            const stat = statsByContactId.get(contact._id.toString());
            const lastMessage = stat?.lastMessage;

            return {
                ...contact,
                lastMessage: lastMessage ? {
                    text: lastMessage.text,
                    priority: lastMessage.priority,
                    createdAt: lastMessage.createdAt,
                    sender_id: lastMessage.sender_id,
                } : null,
                unreadCount: stat?.unreadCount || 0,
            };
        });

        // Sort contacts by last message time (most recent first)
        populatedContacts.sort((a, b) => {
            const timeA = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
            const timeB = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
            return timeB - timeA;
        });

        return res.status(200).json(populatedContacts);
    } catch (error) {
        console.error('[Chat Controller] getContacts error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Fetch message logs with a selected contact (paginated)
const getMessages = async (req, res) => {
    try {
        const { contactId } = req.params;
        const { page = 1, limit = 50 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        if (!mongoose.Types.ObjectId.isValid(contactId)) {
            return res.status(400).json({ error: 'Invalid contact ID' });
        }

        // Verify access
        const hasAccess = await validateMessagingAccess(req.user._id, contactId);
        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied to message this user' });
        }

        const messages = await ChatMessage.find({
            $or: [
                { sender_id: req.user._id, recipient_id: contactId },
                { sender_id: contactId, recipient_id: req.user._id }
            ]
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate({
            path: 'parent_message_id',
            populate: { path: 'sender_id', select: 'username' }
        })
        .lean();

        // Return reversed to maintain chronological order in feed
        return res.status(200).json(messages.reverse());
    } catch (error) {
        console.error('[Chat Controller] getMessages error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Send a secure messaging dispatch
const sendMessage = async (req, res) => {
    try {
        const { recipient_id, text, priority = 'Medium', parent_message_id = null } = req.body;

        if (!recipient_id || !text) {
            return res.status(400).json({ error: 'recipient_id and text are required' });
        }

        const cleanText = text.trim();
        if (!cleanText) {
            return res.status(400).json({ error: 'Message text cannot be empty or whitespace only' });
        }

        if (cleanText.length > 2000) {
            return res.status(400).json({ error: 'Message text cannot exceed 2000 characters' });
        }

        if (!mongoose.Types.ObjectId.isValid(recipient_id)) {
            return res.status(400).json({ error: 'Invalid recipient ID' });
        }

        if (parent_message_id && !mongoose.Types.ObjectId.isValid(parent_message_id)) {
            return res.status(400).json({ error: 'Invalid parent message ID' });
        }

        if (recipient_id.toString() === req.user._id.toString()) {
            return res.status(400).json({ error: 'Cannot message yourself' });
        }

        if (!['Low', 'Medium', 'High'].includes(priority)) {
            return res.status(400).json({ error: 'Invalid priority level' });
        }

        // Verify access
        const hasAccess = await validateMessagingAccess(req.user._id, recipient_id);
        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied to message this user' });
        }

        // Write to DB (fast write)
        const message = await ChatMessage.create({
            sender_id: req.user._id,
            recipient_id,
            text: cleanText,
            priority,
            parent_message_id: parent_message_id || null
        });

        const populated = await ChatMessage.findById(message._id)
            .populate('sender_id', 'username email role')
            .populate({
                path: 'parent_message_id',
                populate: { path: 'sender_id', select: 'username' }
            })
            .lean();

        // WebSocket instant broadcast (non-blocking dispatch)
        sendChatMessage(recipient_id, populated);

        return res.status(201).json(populated);
    } catch (error) {
        console.error('[Chat Controller] sendMessage error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Mark all unread messages from a specific sender as read
const markChatAsRead = async (req, res) => {
    try {
        const { contactId } = req.params;
        const userId = req.user._id;

        if (!mongoose.Types.ObjectId.isValid(contactId)) {
            return res.status(400).json({ error: 'Invalid contact ID' });
        }

        // Verify access before marking as read
        const hasAccess = await validateMessagingAccess(userId, contactId);
        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const result = await ChatMessage.updateMany(
            { sender_id: contactId, recipient_id: userId, is_read: false },
            { $set: { is_read: true } }
        );

        // Broadcast read event to the original sender
        const { sendMessagesRead } = require('../services/socketService');
        sendMessagesRead(contactId, userId);

        return res.status(200).json({
            message: 'Chat history marked as read',
            modifiedCount: result.modifiedCount
        });
    } catch (error) {
        console.error('[Chat Controller] markChatAsRead error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Group Chat Logic

// Get users eligible to be added to a group chat by the current user
const getGroupCandidates = async (req, res) => {
    try {
        const user = await User.findById(req.user._id).lean();
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.role !== 'admin' && user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Access denied: Only admins and super admins can query group candidates' });
        }

        let filter = {
            is_deleted: false,
            is_active: true,
            _id: { $ne: user._id }
        };

        if (user.role === 'admin') {
            // Admins can only choose from users managed by them
            filter.role = 'user';
            filter.managed_by = user._id;
        } else if (user.role === 'super_admin') {
            // Super admins can choose from all active users and admins (and other super admins)
            filter.role = { $in: ['user', 'admin', 'super_admin'] };
        }

        const candidates = await User.find(filter)
            .select('_id username email role')
            .lean();

        return res.status(200).json(candidates);
    } catch (error) {
        console.error('[Chat Controller] getGroupCandidates error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Create a new group chat
const createGroup = async (req, res) => {
    try {
        const { name, members } = req.body;
        const creatorId = req.user._id;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Group name is required' });
        }

        const cleanName = name.trim();
        if (cleanName.length > 50) {
            return res.status(400).json({ error: 'Group name cannot exceed 50 characters' });
        }

        if (!Array.isArray(members) || members.length === 0) {
            return res.status(400).json({ error: 'At least one group member must be specified' });
        }

        const creator = await User.findById(creatorId).lean();
        if (!creator) {
            return res.status(404).json({ error: 'Creator not found' });
        }

        if (creator.role !== 'admin' && creator.role !== 'super_admin') {
            return res.status(403).json({ error: 'Access denied: Only admins and super admins can create groups' });
        }

        // Ensure creator is in the members list
        const memberIdsSet = new Set(members.map(m => m.toString()));
        memberIdsSet.add(creatorId.toString());

        const finalMemberIds = Array.from(memberIdsSet);

        // Maximum person in group should be 20
        if (finalMemberIds.length > 20) {
            return res.status(400).json({ error: 'Maximum persons in a group is limited to 20' });
        }

        // Validate members existence and active status
        const membersData = await User.find({
            _id: { $in: finalMemberIds },
            is_deleted: false,
            is_active: true
        }).lean();

        if (membersData.length !== finalMemberIds.length) {
            return res.status(400).json({ error: 'One or more selected members are invalid, inactive, or deleted' });
        }

        // Validate that members comply with creator restrictions
        if (creator.role === 'admin') {
            // Admin can only make group with their users only
            const invalidMembers = membersData.filter(m => {
                if (m._id.toString() === creatorId.toString()) return false;
                const isManaged = (m.managed_by || []).some(id => id.toString() === creatorId.toString());
                return m.role !== 'user' || !isManaged;
            });
            if (invalidMembers.length > 0) {
                return res.status(403).json({ error: 'Admins can only create groups containing their managed users' });
            }
        }

        // Create ChatGroup
        const group = await ChatGroup.create({
            name: cleanName,
            created_by: creatorId,
            members: finalMemberIds
        });

        const populatedGroup = await ChatGroup.findById(group._id)
            .populate('created_by', 'username email role')
            .populate('members', 'username email role')
            .lean();

        // Broadcast group creation via WebSocket
        sendGroupCreated(finalMemberIds, populatedGroup);

        return res.status(201).json(populatedGroup);
    } catch (error) {
        console.error('[Chat Controller] createGroup error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Fetch all groups where current user is a member
const getGroups = async (req, res) => {
    try {
        const userId = req.user._id;

        const groups = await ChatGroup.find({ members: userId })
            .populate('created_by', 'username email role')
            .populate('members', 'username email role')
            .sort({ createdAt: -1 })
            .lean();

        const populatedGroups = await Promise.all(groups.map(async (group) => {
            const lastMessage = await GroupMessage.findOne({ group_id: group._id })
                .sort({ createdAt: -1 })
                .populate('sender_id', 'username email role')
                .lean();

            return {
                ...group,
                lastMessage: lastMessage ? {
                    text: lastMessage.text,
                    priority: lastMessage.priority,
                    createdAt: lastMessage.createdAt,
                    sender_id: lastMessage.sender_id
                } : null,
                unreadCount: 0
            };
        }));

        // Sort groups by last message time, falling back to group creation time
        populatedGroups.sort((a, b) => {
            const timeA = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : new Date(a.createdAt).getTime();
            const timeB = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : new Date(b.createdAt).getTime();
            return timeB - timeA;
        });

        return res.status(200).json(populatedGroups);
    } catch (error) {
        console.error('[Chat Controller] getGroups error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Fetch messages for a group (paginated for lazy loading)
const getGroupMessages = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { page = 1, limit = 30 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        if (!mongoose.Types.ObjectId.isValid(groupId)) {
            return res.status(400).json({ error: 'Invalid group ID' });
        }

        // Verify group exists and current user is a member
        const group = await ChatGroup.findById(groupId).lean();
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
        }

        const isMember = group.members.some(id => id.toString() === req.user._id.toString());
        if (!isMember) {
            return res.status(403).json({ error: 'Access denied: You are not a member of this group' });
        }

        const messages = await GroupMessage.find({ group_id: groupId })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(Number(limit))
            .populate('sender_id', 'username email role')
            .populate({
                path: 'parent_message_id',
                populate: { path: 'sender_id', select: 'username' }
            })
            .lean();

        return res.status(200).json(messages.reverse());
    } catch (error) {
        console.error('[Chat Controller] getGroupMessages error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Send a message to a group chat
const sendGroupMessage = async (req, res) => {
    try {
        const { group_id, text, priority = 'Medium', parent_message_id = null } = req.body;
        const senderId = req.user._id;

        if (!group_id || !text) {
            return res.status(400).json({ error: 'group_id and text are required' });
        }

        const cleanText = text.trim();
        if (!cleanText) {
            return res.status(400).json({ error: 'Message text cannot be empty' });
        }

        if (cleanText.length > 2000) {
            return res.status(400).json({ error: 'Message text cannot exceed 2000 characters' });
        }

        if (!mongoose.Types.ObjectId.isValid(group_id)) {
            return res.status(400).json({ error: 'Invalid group ID' });
        }

        if (parent_message_id && !mongoose.Types.ObjectId.isValid(parent_message_id)) {
            return res.status(400).json({ error: 'Invalid parent message ID' });
        }

        if (!['Low', 'Medium', 'High'].includes(priority)) {
            return res.status(400).json({ error: 'Invalid priority level' });
        }

        // Verify group exists and current user is a member
        const group = await ChatGroup.findById(group_id).lean();
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
        }

        const isMember = group.members.some(id => id.toString() === senderId.toString());
        if (!isMember) {
            return res.status(403).json({ error: 'Access denied: You are not a member of this group' });
        }

        // Save to DB
        const message = await GroupMessage.create({
            group_id,
            sender_id: senderId,
            text: cleanText,
            priority,
            parent_message_id: parent_message_id || null,
            seen_by: [senderId]
        });

        const populated = await GroupMessage.findById(message._id)
            .populate('sender_id', 'username email role')
            .populate({
                path: 'parent_message_id',
                populate: { path: 'sender_id', select: 'username' }
            })
            .lean();

        // Broadcast to all group members (non-blocking)
        sendGroupChatMessage(group.members, populated);

        return res.status(201).json(populated);
    } catch (error) {
        console.error('[Chat Controller] sendGroupMessage error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Edit group chat
const editGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const { name, members } = req.body;
        const userId = req.user._id;

        if (!mongoose.Types.ObjectId.isValid(groupId)) {
            return res.status(400).json({ error: 'Invalid group ID' });
        }

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Group name is required' });
        }

        const cleanName = name.trim();
        if (cleanName.length > 50) {
            return res.status(400).json({ error: 'Group name cannot exceed 50 characters' });
        }

        if (!Array.isArray(members) || members.length === 0) {
            return res.status(400).json({ error: 'At least one group member must be specified' });
        }

        const group = await ChatGroup.findById(groupId);
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
        }

        const requester = await User.findById(userId).lean();
        if (!requester) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Only group creator or super_admin can edit
        const isCreator = group.created_by.toString() === userId.toString();
        if (!isCreator && requester.role !== 'super_admin') {
            return res.status(403).json({ error: 'Access denied: Only the group creator or super admins can edit the group' });
        }

        // Ensure creator is in the members list
        const creatorId = group.created_by.toString();
        const memberIdsSet = new Set(members.map(m => m.toString()));
        memberIdsSet.add(creatorId);

        const finalMemberIds = Array.from(memberIdsSet);

        // Maximum person in group should be 20
        if (finalMemberIds.length > 20) {
            return res.status(400).json({ error: 'Maximum persons in a group is limited to 20' });
        }

        // Validate members existence and active status
        const membersData = await User.find({
            _id: { $in: finalMemberIds },
            is_deleted: false,
            is_active: true
        }).lean();

        if (membersData.length !== finalMemberIds.length) {
            return res.status(400).json({ error: 'One or more selected members are invalid, inactive, or deleted' });
        }

        // Validate creator restrictions
        const creator = await User.findById(creatorId).lean();
        if (creator.role === 'admin') {
            // Admin can only make group with their users only
            const invalidMembers = membersData.filter(m => {
                if (m._id.toString() === creatorId) return false;
                const isManaged = (m.managed_by || []).some(id => id.toString() === creatorId);
                return m.role !== 'user' || !isManaged;
            });
            if (invalidMembers.length > 0) {
                return res.status(403).json({ error: 'Admins can only include their managed users' });
            }
        }

        // Capture previous members to notify them as well
        const oldMembers = group.members.map(id => id.toString());

        // Update group
        group.name = cleanName;
        group.members = finalMemberIds;
        await group.save();

        const populatedGroup = await ChatGroup.findById(group._id)
            .populate('created_by', 'username email role')
            .populate('members', 'username email role')
            .lean();

        // Broadcast to both old and new members
        const allUnionMembers = Array.from(new Set([...oldMembers, ...finalMemberIds]));
        const { sendGroupUpdated } = require('../services/socketService');
        sendGroupUpdated(allUnionMembers, populatedGroup);

        return res.status(200).json(populatedGroup);
    } catch (error) {
        console.error('[Chat Controller] editGroup error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Delete group chat
const deleteGroup = async (req, res) => {
    try {
        const { groupId } = req.params;
        const userId = req.user._id;

        if (!mongoose.Types.ObjectId.isValid(groupId)) {
            return res.status(400).json({ error: 'Invalid group ID' });
        }

        const group = await ChatGroup.findById(groupId);
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
        }

        const requester = await User.findById(userId).lean();
        if (!requester) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Only group creator or super_admin can delete
        const isCreator = group.created_by.toString() === userId.toString();
        if (!isCreator && requester.role !== 'super_admin') {
            return res.status(403).json({ error: 'Access denied: Only the group creator or super admins can delete the group' });
        }

        const memberIds = group.members.map(id => id.toString());

        // Delete group and its messages
        await ChatGroup.findByIdAndDelete(groupId);
        await GroupMessage.deleteMany({ group_id: groupId });

        // Broadcast to all members
        const { sendGroupDeleted } = require('../services/socketService');
        sendGroupDeleted(memberIds, groupId);

        return res.status(200).json({ message: 'Group deleted successfully', groupId });
    } catch (error) {
        console.error('[Chat Controller] deleteGroup error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Edit a direct message
const editMessage = async (req, res) => {
    try {
        const { messageId } = req.params;
        const { text } = req.body;
        const userId = req.user._id;

        if (!mongoose.Types.ObjectId.isValid(messageId)) {
            return res.status(400).json({ error: 'Invalid message ID' });
        }

        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'Message text is required' });
        }

        const cleanText = text.trim();
        if (cleanText.length > 2000) {
            return res.status(400).json({ error: 'Message text cannot exceed 2000 characters' });
        }

        const message = await ChatMessage.findById(messageId);
        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }

        if (message.sender_id.toString() !== userId.toString()) {
            return res.status(403).json({ error: 'Access denied: You can only edit your own messages' });
        }

        if (message.is_deleted) {
            return res.status(400).json({ error: 'Cannot edit a deleted message' });
        }

        message.text = cleanText;
        message.is_edited = true;
        await message.save();

        const populated = await ChatMessage.findById(messageId)
            .populate('sender_id', 'username email role')
            .populate({
                path: 'parent_message_id',
                populate: { path: 'sender_id', select: 'username' }
            })
            .lean();

        // Broadcast update via WebSockets to recipient
        const { sendChatMessageUpdate } = require('../services/socketService');
        sendChatMessageUpdate(message.recipient_id, populated);

        return res.status(200).json(populated);
    } catch (error) {
        console.error('[Chat Controller] editMessage error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Soft delete a direct message
const deleteMessage = async (req, res) => {
    try {
        const { messageId } = req.params;
        const userId = req.user._id;

        if (!mongoose.Types.ObjectId.isValid(messageId)) {
            return res.status(400).json({ error: 'Invalid message ID' });
        }

        const message = await ChatMessage.findById(messageId);
        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }

        if (message.sender_id.toString() !== userId.toString()) {
            return res.status(403).json({ error: 'Access denied: You can only delete your own messages' });
        }

        if (message.is_deleted) {
            return res.status(400).json({ error: 'Message is already deleted' });
        }

        // Soft delete: clear sensitive text content in database
        message.text = 'This message was deleted';
        message.is_deleted = true;
        await message.save();

        const populated = await ChatMessage.findById(messageId)
            .populate('sender_id', 'username email role')
            .populate({
                path: 'parent_message_id',
                populate: { path: 'sender_id', select: 'username' }
            })
            .lean();

        // Broadcast delete update to recipient
        const { sendChatMessageUpdate } = require('../services/socketService');
        sendChatMessageUpdate(message.recipient_id, populated);

        return res.status(200).json(populated);
    } catch (error) {
        console.error('[Chat Controller] deleteMessage error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Edit a group message
const editGroupMessage = async (req, res) => {
    try {
        const { messageId } = req.params;
        const { text } = req.body;
        const userId = req.user._id;

        if (!mongoose.Types.ObjectId.isValid(messageId)) {
            return res.status(400).json({ error: 'Invalid message ID' });
        }

        if (!text || !text.trim()) {
            return res.status(400).json({ error: 'Message text is required' });
        }

        const cleanText = text.trim();
        if (cleanText.length > 2000) {
            return res.status(400).json({ error: 'Message text cannot exceed 2000 characters' });
        }

        const message = await GroupMessage.findById(messageId);
        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }

        if (message.sender_id.toString() !== userId.toString()) {
            return res.status(403).json({ error: 'Access denied: You can only edit your own messages' });
        }

        if (message.is_deleted) {
            return res.status(400).json({ error: 'Cannot edit a deleted message' });
        }

        message.text = cleanText;
        message.is_edited = true;
        await message.save();

        const populated = await GroupMessage.findById(messageId)
            .populate('sender_id', 'username email role')
            .populate({
                path: 'parent_message_id',
                populate: { path: 'sender_id', select: 'username' }
            })
            .lean();

        // Broadcast to all group members
        const group = await ChatGroup.findById(message.group_id).lean();
        if (group) {
            const { sendGroupChatMessageUpdate } = require('../services/socketService');
            sendGroupChatMessageUpdate(group.members, populated);
        }

        return res.status(200).json(populated);
    } catch (error) {
        console.error('[Chat Controller] editGroupMessage error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Soft delete a group message
const deleteGroupMessage = async (req, res) => {
    try {
        const { messageId } = req.params;
        const userId = req.user._id;

        if (!mongoose.Types.ObjectId.isValid(messageId)) {
            return res.status(400).json({ error: 'Invalid message ID' });
        }

        const message = await GroupMessage.findById(messageId);
        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }

        if (message.sender_id.toString() !== userId.toString()) {
            return res.status(403).json({ error: 'Access denied: You can only delete your own messages' });
        }

        if (message.is_deleted) {
            return res.status(400).json({ error: 'Message is already deleted' });
        }

        // Soft delete: clear sensitive text content in database
        message.text = 'This message was deleted';
        message.is_deleted = true;
        await message.save();

        const populated = await GroupMessage.findById(messageId)
            .populate('sender_id', 'username email role')
            .populate({
                path: 'parent_message_id',
                populate: { path: 'sender_id', select: 'username' }
            })
            .lean();

        // Broadcast delete update to all members
        const group = await ChatGroup.findById(message.group_id).lean();
        if (group) {
            const { sendGroupChatMessageUpdate } = require('../services/socketService');
            sendGroupChatMessageUpdate(group.members, populated);
        }

        return res.status(200).json(populated);
    } catch (error) {
        console.error('[Chat Controller] deleteGroupMessage error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Mark all messages in a group chat as read/seen by the current user
const markGroupChatAsRead = async (req, res) => {
    try {
        const { groupId } = req.params;
        const userId = req.user._id;

        if (!mongoose.Types.ObjectId.isValid(groupId)) {
            return res.status(400).json({ error: 'Invalid group ID' });
        }

        const group = await ChatGroup.findById(groupId).lean();
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
        }

        const isMember = group.members.some(id => id.toString() === userId.toString());
        if (!isMember) {
            return res.status(403).json({ error: 'Access denied: You are not a member of this group' });
        }

        // Add userId to seen_by for all messages in the group where it's not already present
        const result = await GroupMessage.updateMany(
            { group_id: groupId, seen_by: { $ne: userId } },
            { $addToSet: { seen_by: userId } }
        );

        // Broadcast to group members that this user has seen the messages
        const { sendGroupMessagesRead } = require('../services/socketService');
        sendGroupMessagesRead(group.members, groupId, userId);

        return res.status(200).json({
            message: 'Group chat history marked as read',
            modifiedCount: result.modifiedCount
        });
    } catch (error) {
        console.error('[Chat Controller] markGroupChatAsRead error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = {
    getContacts,
    getMessages,
    sendMessage,
    markChatAsRead,
    getGroupCandidates,
    createGroup,
    getGroups,
    getGroupMessages,
    sendGroupMessage,
    editGroup,
    deleteGroup,
    editMessage,
    deleteMessage,
    editGroupMessage,
    deleteGroupMessage,
    markGroupChatAsRead
};
