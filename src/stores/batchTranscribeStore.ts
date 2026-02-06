import { create } from 'zustand'

export interface BatchTranscribeState {
  /** 是否正在批量转写 */
  isBatchTranscribing: boolean
  /** 转写进度 */
  progress: { current: number; total: number }
  /** 是否显示进度浮窗 */
  showToast: boolean
  /** 是否显示结果弹窗 */
  showResult: boolean
  /** 转写结果 */
  result: { success: number; fail: number }

  // Actions
  startTranscribe: (total: number) => void
  updateProgress: (current: number, total: number) => void
  finishTranscribe: (success: number, fail: number) => void
  setShowToast: (show: boolean) => void
  setShowResult: (show: boolean) => void
  reset: () => void
}

export const useBatchTranscribeStore = create<BatchTranscribeState>((set) => ({
  isBatchTranscribing: false,
  progress: { current: 0, total: 0 },
  showToast: false,
  showResult: false,
  result: { success: 0, fail: 0 },

  startTranscribe: (total) => set({
    isBatchTranscribing: true,
    showToast: true,
    progress: { current: 0, total },
    showResult: false,
    result: { success: 0, fail: 0 }
  }),

  updateProgress: (current, total) => set({
    progress: { current, total }
  }),

  finishTranscribe: (success, fail) => set({
    isBatchTranscribing: false,
    showToast: false,
    showResult: true,
    result: { success, fail }
  }),

  setShowToast: (show) => set({ showToast: show }),
  setShowResult: (show) => set({ showResult: show }),

  reset: () => set({
    isBatchTranscribing: false,
    progress: { current: 0, total: 0 },
    showToast: false,
    showResult: false,
    result: { success: 0, fail: 0 }
  })
}))
