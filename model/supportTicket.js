const mongoose = require('mongoose');
const { supportConnection } = require('../config/supportDb');

const ticketHistorySchema = new mongoose.Schema({
    action: {
        type: String,
        enum: ['created', 'remark_added', 'status_changed', 'resolved', 'reopened', 'priority_changed'],
        required: true,
    },
    message: {
        type: String,
        trim: true,
        default: '',
    },
    from_status: {
        type: String,
        default: null,
    },
    to_status: {
        type: String,
        default: null,
    },
    performed_by: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
    },
    performed_by_name: {
        type: String,
        trim: true,
        default: '',
    },
    performed_by_email: {
        type: String,
        trim: true,
        default: '',
    },
    performed_at: {
        type: Date,
        default: Date.now,
    },
}, { _id: false });

const SupportTicketSchema = new mongoose.Schema({
    ticket_id: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true,
    },
    business_id: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
    },
    business_name_snapshot: {
        type: String,
        required: true,
        trim: true,
    },
    business_location_snapshot: {
        type: String,
        trim: true,
        default: '',
    },
    business_short_code_snapshot: {
        type: String,
        trim: true,
        default: '',
    },
    category_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SupportCategory',
        required: true,
        index: true,
    },
    category_name_snapshot: {
        type: String,
        required: true,
        trim: true,
    },
    issue_type_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SupportIssueType',
        required: true,
        index: true,
    },
    issue_title_snapshot: {
        type: String,
        required: true,
        trim: true,
    },
    scope_key: {
        type: String,
        required: true,
        trim: true,
        index: true,
    },
    priority: {
        type: String,
        enum: ['high', 'medium', 'low'],
        default: 'medium',
        index: true,
    },
    status: {
        type: String,
        enum: ['open', 'in_progress', 'resolved', 'closed'],
        default: 'open',
        index: true,
    },
    remark: {
        type: String,
        required: true,
        trim: true,
    },
    raised_by: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        index: true,
    },
    raised_by_name_snapshot: {
        type: String,
        trim: true,
        default: '',
    },
    raised_by_email_snapshot: {
        type: String,
        trim: true,
        default: '',
    },
    last_remark: {
        type: String,
        trim: true,
        default: '',
    },
    last_remark_by: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },
    last_remark_by_name: {
        type: String,
        trim: true,
        default: '',
    },
    last_remark_at: {
        type: Date,
        default: null,
    },
    resolved_by: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
    },
    resolved_by_name: {
        type: String,
        trim: true,
        default: '',
    },
    resolved_by_email: {
        type: String,
        trim: true,
        default: '',
    },
    resolved_at: {
        type: Date,
        default: null,
    },
    resolve_message: {
        type: String,
        trim: true,
        default: '',
    },
    history: {
        type: [ticketHistorySchema],
        default: [],
    },
}, { timestamps: true });

SupportTicketSchema.index({ scope_key: 1, status: 1, createdAt: -1 });
SupportTicketSchema.index({ scope_key: 1, priority: 1, createdAt: -1 });
SupportTicketSchema.index({ scope_key: 1, status: 1, priority: 1, createdAt: -1 });
SupportTicketSchema.index({ raised_by: 1, createdAt: -1 });
SupportTicketSchema.index({ business_id: 1, createdAt: -1 });

module.exports = supportConnection.model('SupportTicket', SupportTicketSchema);
