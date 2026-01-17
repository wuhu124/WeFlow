import { parentPort, workerData } from 'worker_threads'
import * as fs from 'fs'

interface WorkerParams {
    modelPath: string
    tokensPath: string
    wavData: Buffer
    sampleRate: number
}

async function run() {
    if (!parentPort) {
        return;
    }

    try {
        // 动态加载以捕获可能的加载错误（如 C++ 运行库缺失等）
        let sherpa: any;
        try {
            sherpa = require('sherpa-onnx-node');
            } catch (requireError) {
            parentPort.postMessage({ type: 'error', error: 'Failed to load speech engine: ' + String(requireError) });
            return;
        }

        const { modelPath, tokensPath, wavData: rawWavData, sampleRate } = workerData as WorkerParams
        const wavData = Buffer.from(rawWavData);
        // 1. 初始化识别器 (SenseVoiceSmall)
        const recognizerConfig = {
            modelConfig: {
                senseVoice: {
                    model: modelPath,
                    useInverseTextNormalization: 1
                },
                tokens: tokensPath,
                numThreads: 2,
                debug: 0
            }
        }
        const recognizer = new sherpa.OfflineRecognizer(recognizerConfig)
        // 2. 初始化 VAD (用于流式输出效果)
        const vadPath = modelPath.replace('model.int8.onnx', 'silero_vad.onnx');
        const vadConfig = {
            sileroVad: {
                model: vadPath,
                threshold: 0.5,
                minSilenceDuration: 0.5,
                minSpeechDuration: 0.25,
                windowSize: 512
            },
            sampleRate: sampleRate,
            debug: 0,
            numThreads: 1
        }

        // 检查 VAD 模型是否存在，如果不存在则退回到全量识别
        if (!fs.existsSync(vadPath)) {
            const pcmData = wavData.slice(44)
            const samples = new Float32Array(pcmData.length / 2)
            for (let i = 0; i < samples.length; i++) {
                samples[i] = pcmData.readInt16LE(i * 2) / 32768.0
            }

            const stream = recognizer.createStream()
            stream.acceptWaveform({ sampleRate, samples })
            recognizer.decode(stream)
            const result = recognizer.getResult(stream)

            parentPort.postMessage({ type: 'final', text: result.text })
            return
        }

        const vad = new sherpa.Vad(vadConfig, 60) // 60s max
        // 3. 处理音频数据
        const pcmData = wavData.slice(44)
        const samples = new Float32Array(pcmData.length / 2)
        for (let i = 0; i < samples.length; i++) {
            samples[i] = pcmData.readInt16LE(i * 2) / 32768.0
        }

        // 模拟流式输入：按小块喂给 VAD
        const chunkSize = 1600 // 100ms for 16kHz
        let offset = 0
        let accumulatedText = ''

        let segmentCount = 0;

        while (offset < samples.length) {
            const end = Math.min(offset + chunkSize, samples.length)
            const chunk = samples.subarray(offset, end)

            vad.acceptWaveform(chunk)

            // 检查 ASR 结果
            while (!vad.isEmpty()) {
                const segment = vad.front(false)

                const stream = recognizer.createStream()
                stream.acceptWaveform({ sampleRate, samples: segment.samples })
                recognizer.decode(stream)
                const result = recognizer.getResult(stream)

                if (result.text) {
                    const text = result.text.trim();
                    if (text.length > 0) {
                        accumulatedText += (accumulatedText ? ' ' : '') + text
                        segmentCount++;
                        parentPort.postMessage({ type: 'partial', text: accumulatedText })
                    }
                }
                vad.pop()
            }

            offset = end
            // 让出主循环，保持响应
            await new Promise(resolve => setImmediate(resolve))
        }

        // Ensure any remaining buffer is processed
        vad.flush();
        while (!vad.isEmpty()) {
            const segment = vad.front(false);
            const stream = recognizer.createStream()
            stream.acceptWaveform({ sampleRate, samples: segment.samples })
            recognizer.decode(stream)
            const result = recognizer.getResult(stream)
            if (result.text) {
                accumulatedText += (accumulatedText ? ' ' : '') + result.text.trim()
                parentPort.postMessage({ type: 'partial', text: accumulatedText })
            }
            vad.pop();
        }

        parentPort.postMessage({ type: 'final', text: accumulatedText })

    } catch (error) {
        parentPort.postMessage({ type: 'error', error: String(error) })
    }
}

run();

