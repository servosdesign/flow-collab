import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import multer from 'multer'
import { config } from '../config.js'

const uploadRoot = path.resolve(config.uploadDir)

fs.mkdirSync(uploadRoot, { recursive: true })

const storage = multer.diskStorage({
  destination(_request, _file, callback) {
    callback(null, uploadRoot)
  },
  filename(_request, file, callback) {
    const extension = path.extname(file.originalname).toLowerCase()
    callback(null, `${Date.now()}-${randomUUID()}${extension}`)
  }
})

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter(_request, file, callback) {
    if (!file.mimetype.startsWith('image/')) {
      callback(new Error('Only image uploads are allowed.'))
      return
    }

    callback(null, true)
  }
})

export const imagesRouter = Router()

imagesRouter.post('/', upload.single('image'), (request, response) => {
  if (!request.file) {
    response.status(400).json({ message: 'Image file is required.' })
    return
  }

  response.json({
    url: `http://localhost:${config.port}/uploads/${request.file.filename}`
  })
})
