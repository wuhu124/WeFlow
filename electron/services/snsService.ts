import { wcdbService } from './wcdbService'
import { ConfigService } from './config'
import { ContactCacheService } from './contactCacheService'

export interface SnsLivePhoto {
    url: string
    thumb: string
    md5?: string
    token?: string
    key?: string
    encIdx?: string
}

export interface SnsMedia {
    url: string
    thumb: string
    md5?: string
    token?: string
    key?: string
    encIdx?: string
    livePhoto?: SnsLivePhoto
}

export interface SnsPost {
    id: string
    username: string
    nickname: string
    avatarUrl?: string
    createTime: number
    contentDesc: string
    type?: number
    media: SnsMedia[]
    likes: string[]
    comments: { id: string; nickname: string; content: string; refCommentId: string; refNickname?: string }[]
    rawXml?: string  // 原始 XML 数据
}

const fixSnsUrl = (url: string, token?: string) => {
    if (!url) return url;

    // 1. 统一使用 https
    // 2. 将 /150 (缩略图) 强制改为 /0 (原图)
    let fixedUrl = url.replace('http://', 'https://').replace(/\/150($|\?)/, '/0$1');

    if (!token || fixedUrl.includes('token=')) return fixedUrl;

    const connector = fixedUrl.includes('?') ? '&' : '?';
    return `${fixedUrl}${connector}token=${token}&idx=1`;
};

class SnsService {
    private contactCache: ContactCacheService

    constructor() {
        const config = new ConfigService()
        this.contactCache = new ContactCacheService(config.get('cachePath') as string)
    }

    async getTimeline(limit: number = 20, offset: number = 0, usernames?: string[], keyword?: string, startTime?: number, endTime?: number): Promise<{ success: boolean; timeline?: SnsPost[]; error?: string }> {
        console.log('[SnsService] getTimeline called with:', { limit, offset, usernames, keyword, startTime, endTime })

        const result = await wcdbService.getSnsTimeline(limit, offset, usernames, keyword, startTime, endTime)

        console.log('[SnsService] getSnsTimeline result:', {
            success: result.success,
            timelineCount: result.timeline?.length,
            error: result.error
        })

        if (result.success && result.timeline) {
            const enrichedTimeline = result.timeline.map((post: any, index: number) => {
                const contact = this.contactCache.get(post.username)

                // 修复媒体 URL
                const fixedMedia = post.media.map((m: any, mIdx: number) => {
                    const base = {
                        url: fixSnsUrl(m.url, m.token),
                        thumb: fixSnsUrl(m.thumb, m.token),
                        md5: m.md5,
                        token: m.token,
                        key: m.key,
                        encIdx: m.encIdx || m.enc_idx, // 兼容不同命名
                        livePhoto: m.livePhoto ? {
                            ...m.livePhoto,
                            url: fixSnsUrl(m.livePhoto.url, m.livePhoto.token),
                            thumb: fixSnsUrl(m.livePhoto.thumb, m.livePhoto.token),
                            token: m.livePhoto.token,
                            key: m.livePhoto.key
                        } : undefined
                    }

                    // [MOCK] 模拟数据：如果后端没返回 key (说明 DLL 未更新)，注入一些 Mock 数据以便前端开发
                    if (!base.key) {
                        base.key = 'mock_key_for_dev'
                        if (!base.token) {
                            base.token = 'mock_token_for_dev'
                            base.url = fixSnsUrl(base.url, base.token)
                            base.thumb = fixSnsUrl(base.thumb, base.token)
                        }
                        base.encIdx = '1'

                        // 强制给第一个帖子的第一张图加 LivePhoto 模拟
                        if (index === 0 && mIdx === 0 && !base.livePhoto) {
                            base.livePhoto = {
                                url: fixSnsUrl('https://tm.sh/d4cb0.mp4', 'mock_live_token'),
                                thumb: base.thumb,
                                token: 'mock_live_token',
                                key: 'mock_live_key'
                            }
                        }
                    }

                    return base
                })

                return {
                    ...post,
                    avatarUrl: contact?.avatarUrl,
                    nickname: post.nickname || contact?.displayName || post.username,
                    media: fixedMedia
                }
            })

            console.log('[SnsService] Returning enriched timeline with', enrichedTimeline.length, 'posts')
            return { ...result, timeline: enrichedTimeline }
        }

        console.log('[SnsService] Returning result:', result)
        return result
    }
    async debugResource(url: string): Promise<{ success: boolean; status?: number; headers?: any; error?: string }> {
        return new Promise((resolve) => {
            try {
                const { app, net } = require('electron')
                // Remove mocking 'require' if it causes issues, but here we need 'net' or 'https'
                // implementing with 'https' for reliability if 'net' is main-process only special
                const https = require('https')
                const urlObj = new URL(url)

                const options = {
                    hostname: urlObj.hostname,
                    path: urlObj.pathname + urlObj.search,
                    method: 'GET',
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) WindowsWechat(0x63090719) XWEB/8351",
                        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                        "Accept-Encoding": "gzip, deflate, br",
                        "Accept-Language": "zh-CN,zh;q=0.9",
                        "Referer": "https://servicewechat.com/",
                        "Connection": "keep-alive",
                        "Range": "bytes=0-10" // Keep our range check
                    }
                }

                const req = https.request(options, (res: any) => {
                    resolve({
                        success: true,
                        status: res.statusCode,
                        headers: {
                            'x-enc': res.headers['x-enc'],
                            'content-length': res.headers['content-length'],
                            'content-type': res.headers['content-type']
                        }
                    })
                    req.destroy() // We only need headers
                })

                req.on('error', (e: any) => {
                    resolve({ success: false, error: e.message })
                })

                req.end()
            } catch (e: any) {
                resolve({ success: false, error: e.message })
            }
        })
    }

    private imageCache = new Map<string, string>()

    async proxyImage(url: string): Promise<{ success: boolean; dataUrl?: string; error?: string }> {
        // Check cache
        if (this.imageCache.has(url)) {
            return { success: true, dataUrl: this.imageCache.get(url) }
        }

        return new Promise((resolve) => {
            try {
                const https = require('https')
                const zlib = require('zlib')
                const urlObj = new URL(url)

                const options = {
                    hostname: urlObj.hostname,
                    path: urlObj.pathname + urlObj.search,
                    method: 'GET',
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) WindowsWechat(0x63090719) XWEB/8351",
                        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                        "Accept-Encoding": "gzip, deflate, br",
                        "Accept-Language": "zh-CN,zh;q=0.9",
                        "Referer": "https://servicewechat.com/",
                        "Connection": "keep-alive"
                    }
                }

                const req = https.request(options, (res: any) => {
                    if (res.statusCode !== 200) {
                        resolve({ success: false, error: `HTTP ${res.statusCode}` })
                        return
                    }

                    const chunks: Buffer[] = []
                    let stream = res

                    // Handle gzip compression
                    const encoding = res.headers['content-encoding']
                    if (encoding === 'gzip') {
                        stream = res.pipe(zlib.createGunzip())
                    } else if (encoding === 'deflate') {
                        stream = res.pipe(zlib.createInflate())
                    } else if (encoding === 'br') {
                        stream = res.pipe(zlib.createBrotliDecompress())
                    }

                    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
                    stream.on('end', () => {
                        const buffer = Buffer.concat(chunks)
                        const contentType = res.headers['content-type'] || 'image/jpeg'
                        const base64 = buffer.toString('base64')
                        const dataUrl = `data:${contentType};base64,${base64}`

                        // Cache
                        this.imageCache.set(url, dataUrl)

                        resolve({ success: true, dataUrl })
                    })
                    stream.on('error', (e: any) => {
                        resolve({ success: false, error: e.message })
                    })
                })

                req.on('error', (e: any) => {
                    resolve({ success: false, error: e.message })
                })

                req.end()
            } catch (e: any) {
                resolve({ success: false, error: e.message })
            }
        })
    }
}

export const snsService = new SnsService()
