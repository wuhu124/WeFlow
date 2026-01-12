import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'

export default defineConfig({
  base: './',
  server: {
    port: 3000,
    strictPort: false  // 如果3000被占用，自动尝试下一个
  },
  build: {
    commonjsOptions: {
      ignoreDynamicRequires: true
    }
  },
  optimizeDeps: {
    exclude: [
      '@lancedb/lancedb',
      '@lancedb/lancedb-win32-x64-msvc',
      'node-llama-cpp',
      'onnxruntime-node',
      '@xenova/transformers',
      '@huggingface/transformers'
    ]
  },
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
          rollupOptions: {
              external: [
                'better-sqlite3',
                'koffi',
                'node-llama-cpp',
                '@lancedb/lancedb',
                '@lancedb/lancedb-win32-x64-msvc',
                'onnxruntime-node',
                '@xenova/transformers',
                '@huggingface/transformers',
                'fsevents'
              ]
            }
          }
        }
      },
      {
        entry: 'electron/annualReportWorker.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: [
                'koffi',
                'node-llama-cpp',
                '@lancedb/lancedb',
                '@lancedb/lancedb-win32-x64-msvc',
                'onnxruntime-node',
                '@xenova/transformers',
                '@huggingface/transformers',
                'fsevents'
              ],
              output: {
                entryFileNames: 'annualReportWorker.js',
                inlineDynamicImports: true
              }
            }
          }
        }
      },
      {
        entry: 'electron/cloneEmbeddingWorker.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: [
                'koffi',
                'node-llama-cpp',
                '@lancedb/lancedb',
                '@lancedb/lancedb-win32-x64-msvc',
                'onnxruntime-node',
                '@xenova/transformers',
                '@huggingface/transformers',
                'fsevents'
              ],
              output: {
                entryFileNames: 'cloneEmbeddingWorker.js',
                inlineDynamicImports: true
              }
            }
          }
        }
      },
      {
        entry: 'electron/imageSearchWorker.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              output: {
                entryFileNames: 'imageSearchWorker.js',
                inlineDynamicImports: true
              }
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron'
          }
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  }
})
