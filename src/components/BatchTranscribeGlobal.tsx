import React from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { useBatchTranscribeStore } from '../stores/batchTranscribeStore'
import '../styles/batchTranscribe.scss'

/**
 * 全局批量转写进度浮窗 + 结果弹窗
 * 挂载在 App 层，切换页面时不会消失
 */
export const BatchTranscribeGlobal: React.FC = () => {
  const {
    isBatchTranscribing,
    progress,
    showToast,
    showResult,
    result,
    setShowToast,
    setShowResult
  } = useBatchTranscribeStore()

  return (
    <>
      {/* 批量转写进度浮窗（非阻塞） */}
      {showToast && isBatchTranscribing && createPortal(
        <div className="batch-progress-toast">
          <div className="batch-progress-toast-header">
            <div className="batch-progress-toast-title">
              <Loader2 size={14} className="spin" />
              <span>批量转写中</span>
            </div>
            <button className="batch-progress-toast-close" onClick={() => setShowToast(false)} title="最小化">
              <X size={14} />
            </button>
          </div>
          <div className="batch-progress-toast-body">
            <div className="progress-text">
              <span>{progress.current} / {progress.total}</span>
              <span className="progress-percent">
                {progress.total > 0
                  ? Math.round((progress.current / progress.total) * 100)
                  : 0}%
              </span>
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{
                  width: `${progress.total > 0
                    ? (progress.current / progress.total) * 100
                    : 0}%`
                }}
              />
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 批量转写结果对话框 */}
      {showResult && createPortal(
        <div className="batch-modal-overlay" onClick={() => setShowResult(false)}>
          <div className="batch-modal-content batch-result-modal" onClick={(e) => e.stopPropagation()}>
            <div className="batch-modal-header">
              <CheckCircle size={20} />
              <h3>转写完成</h3>
            </div>
            <div className="batch-modal-body">
              <div className="result-summary">
                <div className="result-item success">
                  <CheckCircle size={18} />
                  <span className="label">成功:</span>
                  <span className="value">{result.success} 条</span>
                </div>
                {result.fail > 0 && (
                  <div className="result-item fail">
                    <XCircle size={18} />
                    <span className="label">失败:</span>
                    <span className="value">{result.fail} 条</span>
                  </div>
                )}
              </div>
              {result.fail > 0 && (
                <div className="result-tip">
                  <AlertCircle size={16} />
                  <span>部分语音转写失败，可能是语音文件损坏或网络问题</span>
                </div>
              )}
            </div>
            <div className="batch-modal-footer">
              <button className="btn-primary" onClick={() => setShowResult(false)}>
                确定
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
