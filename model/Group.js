const mongoose = require('mongoose');

const GroupSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        groupName: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100,
            alias: 'name',
        },
        businessIds: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Business',
                alias: 'addBusinessToGroup',
            },
        ],
    },
    {
        timestamps: true,
    }
);

GroupSchema.index({ userId: 1, groupName: 1 }, { unique: true });

const Group = mongoose.model('Group', GroupSchema);

module.exports = Group;