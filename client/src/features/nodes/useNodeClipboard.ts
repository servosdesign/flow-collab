import type { SyncEdge, SyncNode } from '@vue-flow-sync/shared'
import type { FlowEditorServices } from '../../app/flowEditorServices'
import {
  stripParentExtent,
  type FlowEdge,
  type FlowNode
} from '../../domain/graph'
import type { FlowRuntime } from '../../flowRuntime'

export const useNodeClipboard = (runtime: FlowRuntime, services: FlowEditorServices) => {
  const deleteNodesById = (nodeIds: string[]) => {
    const document = runtime.flowDocument.value

    if (!document || nodeIds.length === 0) {
      return
    }

    const removedIds = new Set(nodeIds)

    document.data.nodes.forEach((node) => {
      if (node.parentNode && removedIds.has(node.parentNode)) {
        removedIds.add(node.id)
      }
    })

    const nextNodes = document.data.nodes.filter((node) => !removedIds.has(node.id))
    const nextEdges = document.data.edges.filter(
      (edge) => !removedIds.has(edge.source) && !removedIds.has(edge.target)
    )
    runtime.selectedNodeIds.value = new Set(
      Array.from(runtime.selectedNodeIds.value).filter((nodeId) => !removedIds.has(nodeId))
    )

    runtime.nodes.value = services.withSelectionState(nextNodes.map(stripParentExtent) as FlowNode[])
    runtime.edges.value = nextEdges as FlowEdge[]
    services.submitOperation([
      {
        p: ['nodes'],
        od: document.data.nodes,
        oi: nextNodes
      },
      {
        p: ['edges'],
        od: document.data.edges,
        oi: nextEdges
      }
    ])
    services.closeContextMenu()
  }

  const duplicateNodesById = (nodeIds: string[], count = 1) => {
    const document = runtime.flowDocument.value

    if (!document || nodeIds.length === 0) {
      return
    }

    const selectedIds = new Set(nodeIds)
    const nodesToDuplicate = document.data.nodes.filter((node) => selectedIds.has(node.id))

    if (nodesToDuplicate.length === 0) {
      return
    }

    const copyCount = Math.max(1, Math.min(20, Math.floor(Number(count) || 1)))
    const duplicatedNodes: SyncNode[] = []
    const duplicatedEdges: SyncEdge[] = []
    const internalEdges = document.data.edges.filter(
      (edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target)
    )

    for (let copyIndex = 0; copyIndex < copyCount; copyIndex += 1) {
      const suffix = `${Date.now()}-${copyIndex + 1}`
      const offset = 32 * (copyIndex + 1)
      const idMap = new Map<string, string>()

      nodesToDuplicate.forEach((node) => {
        idMap.set(node.id, `${node.id}-copy-${suffix}`)
      })

      nodesToDuplicate.forEach((node) => {
        const duplicate: SyncNode = {
          ...node,
          id: idMap.get(node.id) ?? `${node.id}-copy-${suffix}`,
          position: {
            x: node.position.x + offset,
            y: node.position.y + offset
          },
          data: {
            ...node.data,
            title: `${node.data.title ?? node.data.text ?? node.id} copy`,
            body: node.data.body ?? ''
          },
          style: node.style ? { ...node.style } : undefined
        }

        if (node.parentNode && idMap.has(node.parentNode)) {
          duplicate.parentNode = idMap.get(node.parentNode)
        }

        duplicatedNodes.push(duplicate)
      })

      internalEdges.forEach((edge) => {
        duplicatedEdges.push({
          ...edge,
          id: `${edge.id}-copy-${suffix}`,
          source: idMap.get(edge.source) ?? edge.source,
          target: idMap.get(edge.target) ?? edge.target
        })
      })
    }

    const nextNodes = [...document.data.nodes, ...duplicatedNodes]
    const nextEdges = [...document.data.edges, ...duplicatedEdges]

    runtime.nodes.value = services.withSelectionState(nextNodes.map(stripParentExtent) as FlowNode[])
    runtime.edges.value = nextEdges as FlowEdge[]
    services.submitOperation([
      {
        p: ['nodes'],
        od: document.data.nodes,
        oi: nextNodes
      },
      {
        p: ['edges'],
        od: document.data.edges,
        oi: nextEdges
      }
    ])
    services.closeContextMenu()
  }

  return {
    deleteNodesById,
    duplicateNodesById
  }
}
