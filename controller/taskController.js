const mongoose = require('mongoose');
const Task = require('../model/Task');
const Notification = require('../model/Notification');
const Business = require('../model/Business');
const User = require('../model/user');
const { sendNotification, broadcastTaskUpdate } = require('../services/socketService');

// Helper to create and broadcast notification
const notifyUser = async ({ recipientId, title, message, type = 'task_assigned', businessId = null, triggeredByUserId = null }) => {
    if (!recipientId || (triggeredByUserId && recipientId.toString() === triggeredByUserId.toString())) {
        return null;
    }
    try {
        const notif = await Notification.create({
            user_id: recipientId,
            title,
            message,
            type,
            business_id: businessId || null,
            triggered_by_user_id: triggeredByUserId || null,
        });

        const populated = await Notification.findById(notif._id)
            .populate({ path: 'triggered_by_user_id', model: User, select: 'username email' })
            .populate({ path: 'business_id', model: Business, select: 'business_name location' })
            .lean();

        sendNotification(recipientId, populated);
        return populated;
    } catch (err) {
        console.error('Error sending task notification:', err.message);
        return null;
    }
};

// Create a new task
const createTask = async (req, res) => {
    try {
        const {
            title,
            description,
            business_id,
            assigned_to,
            assigned_team,
            priority,
            due_date,
            checklist,
            tags,
            links,
            estimated_hours,
            actual_hours,
            color_label,
            notes,
        } = req.body;

        if (!title || !title.trim()) {
            return res.status(400).json({ error: 'Task title is required' });
        }

        // Format assignees
        let assigneeIds = [];
        if (Array.isArray(assigned_to)) {
            assigneeIds = assigned_to
                .filter(id => mongoose.Types.ObjectId.isValid(id))
                .map(id => new mongoose.Types.ObjectId(id));
        } else if (assigned_to && mongoose.Types.ObjectId.isValid(assigned_to)) {
            assigneeIds = [new mongoose.Types.ObjectId(assigned_to)];
        }

        // Format checklist
        let formattedChecklist = [];
        if (Array.isArray(checklist)) {
            formattedChecklist = checklist
                .filter(item => typeof item === 'string' ? item.trim().length > 0 : item?.item?.trim()?.length > 0)
                .map(item => ({
                    item: typeof item === 'string' ? item.trim() : item.item.trim(),
                    is_completed: false,
                }));
        }

        // Format tags
        let formattedTags = [];
        if (Array.isArray(tags)) {
            formattedTags = tags.map(t => String(t).trim()).filter(Boolean);
        } else if (typeof tags === 'string' && tags.trim()) {
            formattedTags = tags.split(',').map(t => t.trim()).filter(Boolean);
        }

        // Format links
        let formattedLinks = [];
        if (Array.isArray(links)) {
            formattedLinks = links
                .filter(l => l && l.url && typeof l.url === 'string' && l.url.trim().length > 0)
                .map(l => ({
                    title: l.title ? String(l.title).trim() : '',
                    url: String(l.url).trim(),
                    added_by: req.user._id,
                    added_at: new Date(),
                }));
        }

        const task = await Task.create({
            title: title.trim(),
            description: description ? description.trim() : '',
            business_id: business_id && mongoose.Types.ObjectId.isValid(business_id) ? business_id : null,
            assigned_to: assigneeIds,
            assigned_team: assigned_team || 'all',
            created_by: req.user._id,
            priority: ['low', 'medium', 'high', 'urgent'].includes(priority) ? priority : 'medium',
            due_date: due_date ? new Date(due_date) : null,
            estimated_hours: (estimated_hours !== undefined && estimated_hours !== null && estimated_hours !== '') ? Number(estimated_hours) : null,
            actual_hours: (actual_hours !== undefined && actual_hours !== null && actual_hours !== '') ? Number(actual_hours) : null,
            color_label: typeof color_label === 'string' ? color_label.trim() : '',
            notes: typeof notes === 'string' ? notes.trim() : '',
            links: formattedLinks,
            checklist: formattedChecklist,
            tags: formattedTags,
            history: [{
                action: 'created',
                details: `Task created by ${req.user.username || req.user.email}`,
                performed_by: req.user._id,
                performed_at: new Date(),
            }],
        });

        const populatedTask = await Task.findById(task._id)
            .populate({ path: 'assigned_to', model: User, select: 'username email role team_type' })
            .populate({ path: 'business_id', model: Business, select: 'business_name location short_code' })
            .populate({ path: 'created_by', model: User, select: 'username email' })
            .populate({ path: 'links.added_by', model: User, select: 'username email' })
            .lean();

        // Notify assignees
        const actorName = req.user.username || req.user.email;
        for (const assigneeId of assigneeIds) {
            await notifyUser({
                recipientId: assigneeId,
                title: 'New Task Assigned',
                message: `${actorName} assigned you a task: "${task.title}"`,
                type: 'task_assigned',
                businessId: task.business_id,
                triggeredByUserId: req.user._id,
            });
        }

        // Broadcast real-time update
        broadcastTaskUpdate({ action: 'created', task: populatedTask, taskId: task._id });

        return res.status(201).json({
            message: 'Task created successfully',
            task: populatedTask,
        });
    } catch (err) {
        console.error('Error creating task:', err);
        return res.status(500).json({ error: 'Failed to create task' });
    }
};

// Get tasks with filtering, search, and pagination
const getTasks = async (req, res) => {
    try {
        const {
            status,
            priority,
            assigned_team,
            business_id,
            assigned_to,
            view, // 'all', 'my_tasks', 'team_tasks', 'archived'
            search,
            page = 1,
            limit = 50,
            is_archived,
        } = req.query;

        const isArchived = view === 'archived' || is_archived === 'true';
        const query = {
            is_archived: isArchived,
        };

        const isAdmin = ['admin', 'super_admin'].includes(req.user.role);

        // Visibility restrictions for non-admin users
        if (!isAdmin) {
            const userBusinesses = req.user.assigned_businesses || [];
            const userTeam = req.user.team_type;

            if (view === 'my_tasks') {
                query.assigned_to = req.user._id;
            } else if (view === 'team_tasks') {
                query.$or = [
                    { assigned_team: userTeam },
                    { assigned_team: 'all' },
                ];
            } else {
                // Default visibility for normal user:
                // Assigned to user OR assigned to user's team OR created by user OR related to assigned business
                query.$or = [
                    { assigned_to: req.user._id },
                    { created_by: req.user._id },
                    ...(userTeam && userTeam !== 'all' ? [{ assigned_team: userTeam }] : [{ assigned_team: 'all' }]),
                    ...(userBusinesses.length > 0 ? [{ business_id: { $in: userBusinesses } }] : []),
                ];
            }
        } else {
            // Admin filters
            if (view === 'my_tasks') {
                query.assigned_to = req.user._id;
            } else if (view === 'team_tasks' && req.user.team_type && req.user.team_type !== 'all') {
                query.assigned_team = req.user.team_type;
            }
        }

        // Additional filter params
        if (status) {
            if (status.includes(',')) {
                query.status = { $in: status.split(',').map(s => s.trim()) };
            } else {
                query.status = status;
            }
        }

        if (priority) {
            query.priority = priority;
        }

        if (assigned_team && assigned_team !== 'all') {
            query.assigned_team = assigned_team;
        }

        if (business_id && mongoose.Types.ObjectId.isValid(business_id)) {
            query.business_id = new mongoose.Types.ObjectId(business_id);
        }

        if (assigned_to && mongoose.Types.ObjectId.isValid(assigned_to)) {
            query.assigned_to = new mongoose.Types.ObjectId(assigned_to);
        }

        if (search && search.trim()) {
            const searchRegex = new RegExp(search.trim(), 'i');
            query.$or = (query.$or ? query.$or : []).length > 0
                ? [{ $and: [{ $or: query.$or }, { $or: [{ title: searchRegex }, { description: searchRegex }, { tags: searchRegex }] }] }]
                : [{ title: searchRegex }, { description: searchRegex }, { tags: searchRegex }];
        }

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
        const skip = (pageNum - 1) * limitNum;

        const [tasks, total] = await Promise.all([
            Task.find(query)
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(limitNum)
                .populate({ path: 'assigned_to', model: User, select: 'username email role team_type' })
                .populate({ path: 'business_id', model: Business, select: 'business_name location short_code' })
                .populate({ path: 'created_by', model: User, select: 'username email' })
                .populate({ path: 'comments.user_id', model: User, select: 'username email' })
                .populate({ path: 'links.added_by', model: User, select: 'username email' })
                .populate({ path: 'checklist.completed_by', model: User, select: 'username email role' })
                .lean(),
            Task.countDocuments(query),
        ]);

        return res.status(200).json({
            tasks,
            total,
            page: pageNum,
            totalPages: Math.ceil(total / limitNum) || 1,
        });
    } catch (err) {
        console.error('Error fetching tasks:', err);
        return res.status(500).json({ error: 'Failed to fetch tasks' });
    }
};

// Get task metrics summary (counts by status, overdue, due today)
const getTaskStats = async (req, res) => {
    try {
        const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
        const baseQuery = { is_archived: false };

        if (!isAdmin) {
            const userBusinesses = req.user.assigned_businesses || [];
            const userTeam = req.user.team_type;
            baseQuery.$or = [
                { assigned_to: req.user._id },
                { created_by: req.user._id },
                ...(userTeam && userTeam !== 'all' ? [{ assigned_team: userTeam }] : [{ assigned_team: 'all' }]),
                ...(userBusinesses.length > 0 ? [{ business_id: { $in: userBusinesses } }] : []),
            ];
        }

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

        const archivedQuery = { is_archived: true };
        if (!isAdmin) {
            const userBusinesses = req.user.assigned_businesses || [];
            const userTeam = req.user.team_type;
            archivedQuery.$or = [
                { assigned_to: req.user._id },
                { created_by: req.user._id },
                ...(userTeam && userTeam !== 'all' ? [{ assigned_team: userTeam }] : [{ assigned_team: 'all' }]),
                ...(userBusinesses.length > 0 ? [{ business_id: { $in: userBusinesses } }] : []),
            ];
        }

        const [total, todo, inProgress, inReview, completed, overdue, dueToday, archived] = await Promise.all([
            Task.countDocuments(baseQuery),
            Task.countDocuments({ ...baseQuery, status: 'todo' }),
            Task.countDocuments({ ...baseQuery, status: 'in_progress' }),
            Task.countDocuments({ ...baseQuery, status: 'in_review' }),
            Task.countDocuments({ ...baseQuery, status: 'completed' }),
            Task.countDocuments({ ...baseQuery, due_date: { $lt: startOfToday }, status: { $ne: 'completed' } }),
            Task.countDocuments({ ...baseQuery, due_date: { $gte: startOfToday, $lte: endOfToday }, status: { $ne: 'completed' } }),
            Task.countDocuments(archivedQuery),
        ]);

        return res.status(200).json({
            total,
            todo,
            inProgress,
            inReview,
            completed,
            overdue,
            dueToday,
            archived,
        });
    } catch (err) {
        console.error('Error fetching task stats:', err);
        return res.status(500).json({ error: 'Failed to fetch task metrics' });
    }
};

// Get single task by ID
const getTaskById = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid task ID' });
        }

        const task = await Task.findById(id)
            .populate({ path: 'assigned_to', model: User, select: 'username email role team_type' })
            .populate({ path: 'business_id', model: Business, select: 'business_name location short_code' })
            .populate({ path: 'created_by', model: User, select: 'username email' })
            .populate({ path: 'comments.user_id', model: User, select: 'username email' })
            .populate({ path: 'links.added_by', model: User, select: 'username email' })
            .populate({ path: 'checklist.completed_by', model: User, select: 'username email role' })
            .populate({ path: 'history.performed_by', model: User, select: 'username email' })
            .lean();

        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        return res.status(200).json({ task });
    } catch (err) {
        console.error('Error fetching task by ID:', err);
        return res.status(500).json({ error: 'Failed to fetch task' });
    }
};

// Update task details
const updateTask = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid task ID' });
        }

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
        const isCreator = task.created_by.toString() === req.user._id.toString();
        const isAssignee = task.assigned_to.some(a => a.toString() === req.user._id.toString());

        if (!isAdmin && !isCreator && !isAssignee) {
            return res.status(403).json({ error: 'Access denied: You cannot edit this task' });
        }

        const {
            title,
            description,
            business_id,
            assigned_to,
            assigned_team,
            priority,
            due_date,
            tags,
            checklist,
            links,
            estimated_hours,
            actual_hours,
            color_label,
            notes,
        } = req.body;

        const previousAssignees = task.assigned_to.map(a => a.toString());

        if (title !== undefined && title.trim()) task.title = title.trim();
        if (description !== undefined) task.description = description ? description.trim() : '';
        if (business_id !== undefined) {
            task.business_id = business_id && mongoose.Types.ObjectId.isValid(business_id) ? business_id : null;
        }
        if (assigned_team !== undefined) task.assigned_team = assigned_team;
        if (priority !== undefined && ['low', 'medium', 'high', 'urgent'].includes(priority)) {
            task.priority = priority;
        }
        if (due_date !== undefined) {
            task.due_date = due_date ? new Date(due_date) : null;
        }
        if (estimated_hours !== undefined) {
            task.estimated_hours = estimated_hours !== null && estimated_hours !== '' ? Number(estimated_hours) : null;
        }
        if (actual_hours !== undefined) {
            task.actual_hours = actual_hours !== null && actual_hours !== '' ? Number(actual_hours) : null;
        }
        if (color_label !== undefined) {
            task.color_label = color_label || '';
        }
        if (notes !== undefined) {
            task.notes = notes || '';
        }

        if (Array.isArray(assigned_to) && (isAdmin || isCreator)) {
            task.assigned_to = assigned_to
                .filter(a => mongoose.Types.ObjectId.isValid(a))
                .map(a => new mongoose.Types.ObjectId(a));
        }

        if (Array.isArray(tags)) {
            task.tags = tags.map(t => String(t).trim()).filter(Boolean);
        } else if (typeof tags === 'string') {
            task.tags = tags.split(',').map(t => t.trim()).filter(Boolean);
        }

        if (Array.isArray(checklist)) {
            task.checklist = checklist.map(item => ({
                item: typeof item === 'string' ? item.trim() : item.item?.trim() || '',
                is_completed: item.is_completed || false,
                completed_at: item.is_completed ? (item.completed_at || new Date()) : null,
                completed_by: item.is_completed ? (item.completed_by || req.user._id) : null,
            })).filter(c => c.item.length > 0);
        }

        if (Array.isArray(links)) {
            task.links = links.map(l => ({
                title: (l.title || '').trim(),
                url: (l.url || '').trim(),
                added_by: l.added_by || req.user._id,
                added_at: l.added_at || new Date(),
            })).filter(l => l.url.length > 0);
        }

        task.history.push({
            action: 'updated',
            details: `Task updated by ${req.user.username || req.user.email}`,
            performed_by: req.user._id,
            performed_at: new Date(),
        });

        await task.save();

        const updatedTask = await Task.findById(id)
            .populate({ path: 'assigned_to', model: User, select: 'username email role team_type' })
            .populate({ path: 'business_id', model: Business, select: 'business_name location short_code' })
            .populate({ path: 'created_by', model: User, select: 'username email' })
            .populate({ path: 'comments.user_id', model: User, select: 'username email' })
            .populate({ path: 'links.added_by', model: User, select: 'username email' })
            .populate({ path: 'checklist.completed_by', model: User, select: 'username email role' })
            .lean();

        // Check for newly added assignees to notify
        const currentAssignees = task.assigned_to.map(a => a.toString());
        const newlyAdded = currentAssignees.filter(a => !previousAssignees.includes(a));
        const actorName = req.user.username || req.user.email;

        for (const newAssigneeId of newlyAdded) {
            await notifyUser({
                recipientId: newAssigneeId,
                title: 'Task Assigned To You',
                message: `${actorName} assigned you to task: "${task.title}"`,
                type: 'task_assigned',
                businessId: task.business_id,
                triggeredByUserId: req.user._id,
            });
        }

        // Broadcast real-time update
        broadcastTaskUpdate({ action: 'updated', task: updatedTask, taskId: id });

        return res.status(200).json({
            message: 'Task updated successfully',
            task: updatedTask,
        });
    } catch (err) {
        console.error('Error updating task:', err);
        return res.status(500).json({ error: 'Failed to update task' });
    }
};

// Quick status update (e.g. for drag-and-drop or status selector)
const updateTaskStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid task ID' });
        }

        const validStatuses = ['todo', 'in_progress', 'in_review', 'completed', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
        }

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const oldStatus = task.status;
        task.status = status;
        task.history.push({
            action: 'status_changed',
            details: `Status changed from "${oldStatus}" to "${status}" by ${req.user.username || req.user.email}`,
            performed_by: req.user._id,
            performed_at: new Date(),
        });

        await task.save();

        const updatedTask = await Task.findById(id)
            .populate({ path: 'assigned_to', model: User, select: 'username email role team_type' })
            .populate({ path: 'business_id', model: Business, select: 'business_name location short_code' })
            .populate({ path: 'created_by', model: User, select: 'username email' })
            .lean();

        // Notify creator if completed by someone else
        const actorName = req.user.username || req.user.email;
        if (status === 'completed' && task.created_by.toString() !== req.user._id.toString()) {
            await notifyUser({
                recipientId: task.created_by,
                title: 'Task Completed',
                message: `${actorName} marked task "${task.title}" as completed`,
                type: 'task_status_changed',
                businessId: task.business_id,
                triggeredByUserId: req.user._id,
            });
        }

        // Broadcast real-time update
        broadcastTaskUpdate({ action: 'status_changed', task: updatedTask, taskId: id, newStatus: status });

        return res.status(200).json({
            message: 'Task status updated successfully',
            task: updatedTask,
        });
    } catch (err) {
        console.error('Error updating task status:', err);
        return res.status(500).json({ error: 'Failed to update task status' });
    }
};

// Toggle or update a checklist subtask item
const toggleChecklistItem = async (req, res) => {
    try {
        const { id, itemId } = req.params;
        const { is_completed } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid task ID' });
        }

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const item = task.checklist.id(itemId);
        if (!item) {
            return res.status(404).json({ error: 'Checklist item not found' });
        }

        item.is_completed = typeof is_completed === 'boolean' ? is_completed : !item.is_completed;
        item.completed_at = item.is_completed ? new Date() : null;
        item.completed_by = item.is_completed ? req.user._id : null;

        await task.save();

        const updatedTask = await Task.findById(id)
            .populate({ path: 'checklist.completed_by', model: User, select: 'username email role' })
            .lean();

        // Broadcast real-time update
        broadcastTaskUpdate({ action: 'checklist_toggled', taskId: id, itemId, is_completed: item.is_completed, task: updatedTask });

        return res.status(200).json({
            message: 'Checklist item updated',
            checklist: updatedTask.checklist,
            task: updatedTask,
        });
    } catch (err) {
        console.error('Error toggling checklist item:', err);
        return res.status(500).json({ error: 'Failed to update checklist item' });
    }
};

// Add a discussion comment to the task
const addTaskComment = async (req, res) => {
    try {
        const { id } = req.params;
        const { comment } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid task ID' });
        }

        if (!comment || !comment.trim()) {
            return res.status(400).json({ error: 'Comment text is required' });
        }

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        task.comments.push({
            user_id: req.user._id,
            comment: comment.trim(),
        });

        task.history.push({
            action: 'comment_added',
            details: `Comment added by ${req.user.username || req.user.email}`,
            performed_by: req.user._id,
            performed_at: new Date(),
        });

        await task.save();

        const updatedTask = await Task.findById(id)
            .populate({ path: 'comments.user_id', model: User, select: 'username email' })
            .lean();

        // Notify creator & assignees (except commenter)
        const recipientSet = new Set([
            task.created_by.toString(),
            ...task.assigned_to.map(a => a.toString()),
        ]);
        recipientSet.delete(req.user._id.toString());

        const actorName = req.user.username || req.user.email;
        for (const recipientId of recipientSet) {
            await notifyUser({
                recipientId,
                title: 'New Comment on Task',
                message: `${actorName} commented on "${task.title}": ${comment.slice(0, 50)}...`,
                type: 'task_comment',
                businessId: task.business_id,
                triggeredByUserId: req.user._id,
            });
        }

        // Broadcast real-time update
        broadcastTaskUpdate({ action: 'comment_added', taskId: id, comments: updatedTask.comments });

        return res.status(200).json({
            message: 'Comment added successfully',
            comments: updatedTask.comments,
        });
    } catch (err) {
        console.error('Error adding task comment:', err);
        return res.status(500).json({ error: 'Failed to add comment' });
    }
};

// Delete or archive a task
const deleteTask = async (req, res) => {
    try {
        const { id } = req.params;
        const { hard_delete } = req.query;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid task ID' });
        }

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
        const isCreator = task.created_by.toString() === req.user._id.toString();

        if (!isAdmin && !isCreator) {
            return res.status(403).json({ error: 'Access denied: You cannot delete this task' });
        }

        if (hard_delete === 'true') {
            await Task.findByIdAndDelete(id);
            broadcastTaskUpdate({ action: 'deleted', taskId: id, hard_delete: true });
            return res.status(200).json({ message: 'Task permanently deleted' });
        }

        task.is_archived = true;
        task.history.push({
            action: 'archived',
            details: `Task archived by ${req.user.username || req.user.email}`,
            performed_by: req.user._id,
            performed_at: new Date(),
        });
        await task.save();

        broadcastTaskUpdate({ action: 'archived', taskId: id, hard_delete: false });

        return res.status(200).json({ message: 'Task archived successfully' });
    } catch (err) {
        console.error('Error deleting task:', err);
        return res.status(500).json({ error: 'Failed to delete task' });
    }
};

// Restore an archived task
const restoreTask = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid task ID' });
        }

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
        const isCreator = task.created_by.toString() === req.user._id.toString();

        if (!isAdmin && !isCreator) {
            return res.status(403).json({ error: 'Access denied: You cannot restore this task' });
        }

        task.is_archived = false;
        task.history.push({
            action: 'restored',
            details: `Task restored from archive by ${req.user.username || req.user.email}`,
            performed_by: req.user._id,
            performed_at: new Date(),
        });
        await task.save();

        const updatedTask = await Task.findById(id)
            .populate({ path: 'assigned_to', model: User, select: 'username email role team_type' })
            .populate({ path: 'business_id', model: Business, select: 'business_name location short_code' })
            .populate({ path: 'created_by', model: User, select: 'username email' })
            .lean();

        broadcastTaskUpdate({ action: 'restored', taskId: id, task: updatedTask });

        return res.status(200).json({
            message: 'Task restored successfully',
            task: updatedTask,
        });
    } catch (err) {
        console.error('Error restoring task:', err);
        return res.status(500).json({ error: 'Failed to restore task' });
    }
};

// Add a link / attachment to task
const addTaskLink = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, url } = req.body;

        if (!url || !url.trim()) {
            return res.status(400).json({ error: 'URL is required' });
        }

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const newLink = {
            title: title ? title.trim() : '',
            url: url.trim(),
            added_by: req.user._id,
            added_at: new Date(),
        };

        task.links.push(newLink);
        task.history.push({
            action: 'updated',
            details: `Link "${newLink.title || newLink.url}" added by ${req.user.username || req.user.email}`,
            performed_by: req.user._id,
            performed_at: new Date(),
        });

        await task.save();

        const updatedTask = await Task.findById(id)
            .populate({ path: 'assigned_to', model: User, select: 'username email role team_type' })
            .populate({ path: 'business_id', model: Business, select: 'business_name location short_code' })
            .populate({ path: 'created_by', model: User, select: 'username email' })
            .populate({ path: 'comments.user_id', model: User, select: 'username email' })
            .populate({ path: 'links.added_by', model: User, select: 'username email' })
            .populate({ path: 'checklist.completed_by', model: User, select: 'username email role' })
            .lean();

        broadcastTaskUpdate({ action: 'updated', taskId: id, task: updatedTask });

        return res.status(200).json({
            message: 'Link added successfully',
            task: updatedTask,
        });
    } catch (err) {
        console.error('Error adding task link:', err);
        return res.status(500).json({ error: 'Failed to add link' });
    }
};

// Remove a link from task
const removeTaskLink = async (req, res) => {
    try {
        const { id, linkId } = req.params;

        const task = await Task.findById(id);
        if (!task) {
            return res.status(404).json({ error: 'Task not found' });
        }

        task.links = task.links.filter(l => l._id.toString() !== linkId);
        task.history.push({
            action: 'updated',
            details: `Link removed by ${req.user.username || req.user.email}`,
            performed_by: req.user._id,
            performed_at: new Date(),
        });

        await task.save();

        const updatedTask = await Task.findById(id)
            .populate({ path: 'assigned_to', model: User, select: 'username email role team_type' })
            .populate({ path: 'business_id', model: Business, select: 'business_name location short_code' })
            .populate({ path: 'created_by', model: User, select: 'username email' })
            .populate({ path: 'comments.user_id', model: User, select: 'username email' })
            .populate({ path: 'links.added_by', model: User, select: 'username email' })
            .populate({ path: 'checklist.completed_by', model: User, select: 'username email role' })
            .lean();

        broadcastTaskUpdate({ action: 'updated', taskId: id, task: updatedTask });

        return res.status(200).json({
            message: 'Link removed successfully',
            task: updatedTask,
        });
    } catch (err) {
        console.error('Error removing task link:', err);
        return res.status(500).json({ error: 'Failed to remove link' });
    }
};

module.exports = {
    createTask,
    getTasks,
    getTaskStats,
    getTaskById,
    updateTask,
    updateTaskStatus,
    toggleChecklistItem,
    addTaskComment,
    deleteTask,
    restoreTask,
    addTaskLink,
    removeTaskLink,
};
