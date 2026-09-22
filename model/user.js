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

    password_hash: {
      type: String,
      select: false,
    },

    role: {
      type: String,
      enum: ['super_admin', 'admin', 'user'],
      default: 'user',
    },

    failed_login_attempts: {
      type: Number,
      default: 0,
    },

    last_failed_login: {
      type: Date,
    },

    // New fields for team management
    team_type:{
      type: String,
      enum: ['social media team', 'jd team', 'review management team', 'gbp record management team', 'leads management team', 'it development team', 'all'],
      default: 'all',
    },

    scopes: {
      type: [String],
      enum: ['review_management', 'gbp_record_management', 'social_media_management', 'jd_management', 'leads_management', 'web_dev_management'],
      default: ['review_management'],
    },

    is_active: {
      type: Boolean,
      default: true,
    },

    is_deleted: {
      type: Boolean,
      default: false,
    },

    ai_review_access: {
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
    managed_by: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    assigned_businesses: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Business',
      },
    ],
  },
  {
    timestamps: true, // gives createdAt & updatedAt
  }
)

// Auto-migration: Clean, flatten, and convert managed_by to array of ObjectIds on startup
mongoose.connection.on('open', async () => {
  try {
    const db = mongoose.connection.db;

    const users = await db.collection('users').find({}).toArray();

    let migratedCount = 0;
    for (const user of users) {
      let flatList = [];
      const flatten = (val) => {
        if (Array.isArray(val)) {
          val.forEach(flatten);
        } else if (val) {
          const strVal = val.toString().trim();
          if (mongoose.Types.ObjectId.isValid(strVal)) {
            flatList.push(new mongoose.Types.ObjectId(strVal));
          }
        }
      };
      flatten(user.managed_by);

      // Unique ObjectIds
      const uniqueIds = [];
      const seen = new Set();
      for (const id of flatList) {
        const idStr = id.toString();
        if (!seen.has(idStr)) {
          seen.add(idStr);
          uniqueIds.push(id);
        }
      }

      // Check if we actually need to update (compare lengths and elements)
      const currentRaw = Array.isArray(user.managed_by) ? user.managed_by : (user.managed_by ? [user.managed_by] : []);
      const currentStrList = currentRaw.map(id => id?.toString());
      const newStrList = uniqueIds.map(id => id.toString());
      
      const needsUpdate = !Array.isArray(user.managed_by) ||
                          currentStrList.length !== newStrList.length ||
                          currentStrList.some((val, idx) => val !== newStrList[idx]);

      if (needsUpdate) {
        await db.collection('users').updateOne(
          { _id: user._id },
          { $set: { managed_by: uniqueIds } }
        );
        migratedCount++;
      }
    }
    if (migratedCount > 0) {
      console.log(`Migrated/Cleaned ${migratedCount} users' managed_by fields`);
    }
  } catch (err) {
    console.error('User schema migration error:', err);
  }
})

// Optional indexes
user_schema.index({ role: 1 })
user_schema.index({ is_deleted: 1, is_active: 1, role: 1 })
user_schema.index({ managed_by: 1, is_deleted: 1, is_active: 1, role: 1 })

module.exports = mongoose.model('User', user_schema)
