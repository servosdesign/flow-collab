import { ref } from 'vue'
import type { FlowEditorServices } from '../../app/flowEditorServices'
import type { FlowRuntime } from '../../flowRuntime'
import { createFlowReset } from './resetFlow'
import { createRemoteDocumentSync } from './remoteDocument'
import { createRealtimeSnapshotSync } from './snapshotSync'

export const useRealtimeSync = (runtime: FlowRuntime, services: FlowEditorServices) => {
  const isResettingFlow = ref(false)
  const remoteDocument = createRemoteDocumentSync(runtime, services)
  const snapshots = createRealtimeSnapshotSync(runtime, services)
  const reset = createFlowReset(runtime, services, isResettingFlow, {
    applyFlowDocument: remoteDocument.applyFlowDocument,
    cleanupRealtimeSync: snapshots.cleanupRealtimeSync
  })

  return {
    commands: {
      resetFlowToSeed: reset.resetFlowToSeed
    },
    document: {
      applyFlowDocument: remoteDocument.applyFlowDocument,
      applyRemoteOperation: remoteDocument.applyRemoteOperation,
      documentMatchesLocal: snapshots.documentMatchesLocal
    },
    lifecycle: {
      cleanup: snapshots.cleanupRealtimeSync
    },
    operations: {
      submitOperation: snapshots.submitOperation
    },
    snapshots: {
      scheduleGraphSnapshot: snapshots.scheduleGraphSnapshot,
      scheduleViewportSnapshot: snapshots.scheduleViewportSnapshot,
      submitGraphReplacement: snapshots.submitGraphReplacement,
      submitGraphSnapshot: snapshots.submitGraphSnapshot,
      submitViewportSnapshot: snapshots.submitViewportSnapshot
    },
    state: {
      isResettingFlow
    }
  }
}
