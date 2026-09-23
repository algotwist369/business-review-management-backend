const mongoose = require('mongoose');
const { taskConnection } = require('../config/taskDb');

const checklistItemSchema = new mongoose.Schema({
    item: {
        type: String,
        required: true,
        trim: true,
    },
    is_completed: {
        type: Boolean,
        default: false,
    },
    completed_at: {
        type: Date,
        default: null,
    },
    completed_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
    },
}, { timestamps: true });

const commentSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    comment: {
        type: String,
        required: true,
        trim: true,
    },
}, { timestamps: true });

const linkSchema = new mongoose.Schema({
    title: {
        type: String,
        trim: true,
        default: '',
    },
    url: {
        type: String,
        required: true,
        trim: true,
    },
    added_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
    },
    added_at: {
        type: Date,
        default: Date.now,
    },
}, { timestamps: true });

const taskHistorySchema = new mongoose.Schema({
    action: {
        type: String,
        required: true,
    },
    details: {
        type: String,
        default: '',
    },
    performed_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    performed_at: {
        type: Date,
        default: Date.now,
    },
}, { _id: false });

const TaskSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 300,
        index: true,
    },
    description: {
        type: String,
        trim: true,
        default: '',
    },
    business_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Business',
        index: true,
        default: null,
    },
    assigned_to: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true,
    }],
    assigned_team: {
        type: String,
        enum: ['social media team', 'jd team', 'review management team', 'gbp record management team', 'leads management team', 'it development team', 'all'],
        default: 'all',
        index: true,
    },
    created_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    status: {
        type: String,
        enum: ['todo', 'in_progress', 'in_review', 'completed', 'cancelled'],
        default: 'todo',
        index: true,
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'medium',
        index: true,
    },
    due_date: {
        type: Date,
        default: null,
        index: true,
    },
    estimated_hours: {
        type: Number,
        min: 0,
        default: null,
    },
    actual_hours: {
        type: Number,
        min: 0,
        default: null,
    },
    color_label: {
        type: String,
        trim: true,
        default: '',
    },
    notes: {
        type: String,
        trim: true,
        default: '',
    },
    links: [linkSchema],
    checklist: [checklistItemSchema],
    comments: [commentSchema],
    history: [taskHistorySchema],
    tags: [{
        type: String,
        trim: true,
    }],
    is_archived: {
        type: Boolean,
        default: false,
        index: true,
    },
}, { timestamps: true });

// Compound indexes
TaskSchema.index({ assigned_to: 1, status: 1, is_archived: 1 });
TaskSchema.index({ assigned_team: 1, status: 1, is_archived: 1 });
TaskSchema.index({ business_id: 1, status: 1, is_archived: 1 });
TaskSchema.index({ created_by: 1, is_archived: 1 });
TaskSchema.index({ status: 1, due_date: 1 });

module.exports = taskConnection.model('Task', TaskSchema);
