import type { Ref } from 'vue'
import type { SyncFlowDocument } from '@vue-flow-sync/shared'
import { resetSeedFlow } from '../../api'
import type { FlowEditorServices } from '../../app/flowEditorServices'
import type { FlowRuntime } from '../../flowRuntime'

type FlowResetOptions = {
  applyFlowDocument: (document: SyncFlowDocument, fit?: boolean) => void
  cleanupRealtimeSync: () => void
}

export const createFlowReset = (
  runtime: FlowRuntime,
  services: FlowEditorServices,
  isResettingFlow: Ref<boolean>,
  options: FlowResetOptions
) => {
  const resetFlowToSeed = async () => {
    if (isResettingFlow.value) {
      return
    }

    options.cleanupRealtimeSync()
    isResettingFlow.value = true
    runtime.isFlowLoading.value = true
    runtime.errorMessage.value = ''
    runtime.pendingCreate.value = null
    runtime.selectedNodeIds.value = new Set()
    runtime.status.value = 'Resetting'
    services.closeContextMenu()
    services.updatePresenceSelection()

    try {
      const flow = await resetSeedFlow('main')

      options.applyFlowDocument(flow)
      runtime.status.value = 'Live'
    } catch (error) {
      runtime.errorMessage.value =
        error instanceof Error ? error.message : 'Could not reset the flowchart.'
      runtime.isFlowLoading.value = false
      runtime.status.value = 'Error'
    } finally {
      isResettingFlow.value = false
    }
  }

  return {
    resetFlowToSeed
  }
}
