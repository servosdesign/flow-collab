import mongoose from 'mongoose'
import { config } from './config.js'

let connectionPromise: Promise<typeof mongoose> | null = null

export const connectDatabase = async () => {
  mongoose.set('strictQuery', true)

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(config.mongoUri)
  }

  await connectionPromise
}
