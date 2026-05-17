import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { Router } from 'express'
import { connectDatabase } from '../db.js'
import { UserModel } from '../models/User.js'

const scrypt = promisify(scryptCallback)
const colors = ['#0f766e', '#2563eb', '#dc2626', '#9333ea', '#d97706', '#0891b2']

const normalizeUsername = (username: unknown) => {
  return String(username ?? '').trim().toLowerCase()
}

const normalizeDisplayName = (username: string) => {
  return username
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ')
}

const hashPassword = async (password: string, salt: string) => {
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer

  return derivedKey.toString('hex')
}

const verifyPassword = async (password: string, salt: string, expectedHash: string) => {
  const actualHash = Buffer.from(await hashPassword(password, salt), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')

  return actualHash.length === expected.length && timingSafeEqual(actualHash, expected)
}

export const authRouter = Router()

authRouter.post('/login', async (request, response, next) => {
  try {
    await connectDatabase()

    const username = normalizeUsername(request.body?.username)
    const password = String(request.body?.password ?? '')

    if (username.length < 2) {
      response.status(400).json({ message: 'Username must be at least 2 characters.' })
      return
    }

    if (password.length < 4) {
      response.status(400).json({ message: 'Password must be at least 4 characters.' })
      return
    }

    const existingUser = await UserModel.findOne({ username })

    if (existingUser) {
      const passwordMatches = await verifyPassword(
        password,
        existingUser.passwordSalt,
        existingUser.passwordHash
      )

      if (!passwordMatches) {
        response.status(401).json({ message: 'Wrong username or password.' })
        return
      }

      response.json(existingUser.toJSON())
      return
    }

    const salt = randomBytes(16).toString('hex')
    const passwordHash = await hashPassword(password, salt)
    const color = colors[Math.floor(Math.random() * colors.length)]
    const user = await UserModel.create({
      username,
      displayName: normalizeDisplayName(username),
      passwordHash,
      passwordSalt: salt,
      color
    })

    response.status(201).json(user.toJSON())
  } catch (error) {
    next(error)
  }
})
