const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const {
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
} = require('../controller/taskController');

// All task routes require authentication
router.use(authMiddleware);

// Task stats / metrics
router.get('/stats', getTaskStats);

// Tasks list & create
router.get('/', getTasks);
router.post('/', createTask);

// Task detail, update, delete, restore
router.get('/:id', getTaskById);
router.patch('/:id', updateTask);
router.patch('/:id/restore', restoreTask);
router.delete('/:id', deleteTask);

// Quick status & subtask checklist updates
router.patch('/:id/status', updateTaskStatus);
router.patch('/:id/checklist/:itemId', toggleChecklistItem);

// Task links / attachments
router.post('/:id/links', addTaskLink);
router.delete('/:id/links/:linkId', removeTaskLink);

// Task comments
router.post('/:id/comments', addTaskComment);

module.exports = router;
