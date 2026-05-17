import { Schema, model } from 'mongoose'

const userSchema = new Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      lowercase: true
    },
    displayName: {
      type: String,
      required: true,
      trim: true
    },
    passwordHash: {
      type: String,
      required: true
    },
    passwordSalt: {
      type: String,
      required: true
    },
    color: {
      type: String,
      required: true
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
)

userSchema.set('toJSON', {
  transform(_document, ret) {
    const json = ret as Record<string, unknown>
    json.id = String(json._id)
    delete json._id
    delete json.passwordHash
    delete json.passwordSalt
    return ret
  }
})

export const UserModel = model('User', userSchema)
