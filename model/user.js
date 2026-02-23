const mongoose = require('mongoose')

const user_schema = new mongoose.Schema(
  {
    username: {
      type: String,
      trim: true,
      minlength: 3,
      maxlength: 50,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    google_id: {
      type: String,
      unique: true,
      sparse: true,
    },

    role: {
      type: String,
      enum: ['super_admin', 'admin', 'user'],
      default: 'user',
    },

    is_active: {
      type: Boolean,
      default: true,
    },

    is_deleted: {
      type: Boolean,
      default: false,
    },

    total_reviews: {
      type: Number,
      default: 0,
    },

    last_login: {
      type: Date,
    },
    managed_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true, // gives createdAt & updatedAt
  }
)

// Optional indexes
user_schema.index({ role: 1 })

module.exports = mongoose.model('User', user_schema)
