/**
 * Obtém o IP público de forma compatível com browsers e WebViews modernos.
 * Usa JSONP (ipify) como fallback quando fetch falha por CORS.
 */

const IP_TIMEOUT_MS = 10000

/**
 * Obtém IP via JSONP (ipify) - funciona em browsers sem CORS.
 */
function getPublicIpJsonp (): Promise<string> {
  return new Promise((resolve, reject) => {
    const callbackName = 'webdrop_ip_' + Date.now() + '_' + Math.random().toString(36).slice(2)
    let resolved = false

    const cleanup = () => {
      if (script.parentNode) {
        script.remove()
      }
      try {
        delete (window as any)[callbackName]
      } catch (_) {}
    }

    const done = (ip: string | null, err?: Error) => {
      if (resolved) return
      resolved = true
      clearTimeout(timer)
      cleanup()
      if (ip) resolve(ip)
      else reject(err || new Error('Could not get IP'))
    }

    (window as any)[callbackName] = (data: { ip?: string }) => {
      if (data && typeof data.ip === 'string' && data.ip.length > 0) {
        done(data.ip)
      } else {
        done(null, new Error('Invalid response'))
      }
    }

    const timer = setTimeout(() => {
      done(null, new Error('Timeout'))
    }, IP_TIMEOUT_MS)

    const script = document.createElement('script')
    script.src = `https://api.ipify.org?format=jsonp&callback=${callbackName}`
    script.onerror = () => done(null, new Error('Script load failed'))
    document.head.appendChild(script)
  })
}

/**
 * Tenta obter IP via fetch (pode falhar por CORS em alguns ambientes).
 */
async function getPublicIpFetch (): Promise<string> {
  const urls = [
    'https://api64.ipify.org?format=json',
    'https://api.ipify.org?format=json'
  ]
  for (const url of urls) {
    try {
      const res = await fetch(url, { method: 'GET', mode: 'cors' })
      if (!res.ok) continue
      const data = await res.json()
      if (data && typeof data.ip === 'string' && data.ip.length > 0) {
        return data.ip
      }
    } catch (_) {
      continue
    }
  }
  throw new Error('Fetch failed')
}

/**
 * Obtém o IP público. Tenta fetch primeiro (rápido onde CORS permite),
 * depois JSONP (funciona em WebView/Android e browsers restritivos).
 */
export async function getPublicIp (): Promise<string> {
  // 1) Tentar fetch (funciona em alguns browsers com CORS)
  try {
    return await getPublicIpFetch()
  } catch (_) {
    // ignorar
  }
  // 2) JSONP (ipify) - funciona sem CORS
  return getPublicIpJsonp()
}
