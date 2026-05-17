import type { FlowPayload } from '@vue-flow-sync/shared'
import { Router } from 'express'
import { FlowModel } from '../models/Flow.js'
import { resetSeedFlowDocument } from '../realtime.js'

const router = Router()

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const parseFlowPayload = (value: unknown): FlowPayload => {
  if (!isRecord(value)) {
    throw new Error('Request body must be an object.')
  }

  if (typeof value.name !== 'string' || value.name.trim().length === 0) {
    throw new Error('Flow name is required.')
  }

  if (!Array.isArray(value.nodes)) {
    throw new Error('Flow nodes must be an array.')
  }

  if (!Array.isArray(value.edges)) {
    throw new Error('Flow edges must be an array.')
  }

  return {
    name: value.name.trim(),
    nodes: value.nodes,
    edges: value.edges,
    viewport: isRecord(value.viewport)
      ? {
        x: Number(value.viewport.x ?? 0),
        y: Number(value.viewport.y ?? 0),
        zoom: Number(value.viewport.zoom ?? 1)
      }
      : {
        x: 0,
        y: 0,
        zoom: 1
      }
  }
}

router.get('/:slug', async (req, res, next) => {
  try {
    const flow = await FlowModel.findOne({ slug: req.params.slug })
      .select('-_id')
      .lean()

    if (!flow) {
      res.status(404).json({ message: 'Flow not found.' })
      return
    }

    res.json(flow)
  } catch (error) {
    next(error)
  }
})

router.put('/:slug', async (req, res, next) => {
  try {
    const payload = parseFlowPayload(req.body)
    const flow = await FlowModel.findOneAndUpdate(
      { slug: req.params.slug },
      {
        slug: req.params.slug,
        ...payload
      },
      {
        new: true,
        upsert: true
      }
    )
      .select('-_id')
      .lean()

    res.json(flow)
  } catch (error) {
    next(error)
  }
})

router.post('/:slug/reset-seed', async (req, res, next) => {
  try {
    const flow = await resetSeedFlowDocument(req.params.slug)

    res.json({
      slug: req.params.slug,
      ...flow
    })
  } catch (error) {
    next(error)
  }
})

export const flowsRouter = router
