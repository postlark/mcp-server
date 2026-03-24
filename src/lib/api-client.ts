const API_BASE = process.env.POSTLARK_API_BASE || 'https://api.postlark.ai/v1'

export class PostlarkApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'PostlarkApiError'
  }
}

/** Postlark API 호출 래퍼 — MCP 도구에서 사용 */
export async function apiCall<T>(
  path: string,
  opts: {
    method?: string
    body?: unknown
  } = {},
): Promise<T> {
  const apiKey = process.env.POSTLARK_API_KEY
  if (!apiKey) {
    throw new PostlarkApiError(
      401,
      'POSTLARK_API_KEY 환경변수가 설정되지 않았습니다. claude mcp add postlark 실행 시 환경변수를 추가하세요.',
    )
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'unknown', message: res.statusText }))
    const msg = (body as { message?: string }).message
      || (body as { error?: string }).error
      || res.statusText
    throw new PostlarkApiError(res.status, formatError(res.status, msg))
  }

  return res.json() as Promise<T>
}

function formatError(status: number, msg: string): string {
  switch (status) {
    case 401:
      return `인증 실패: API Key가 유효하지 않습니다. POSTLARK_API_KEY를 확인하세요.`
    case 403:
      return `권한 부족: ${msg}`
    case 404:
      return `찾을 수 없음: ${msg}`
    case 429:
      return `Rate limit 초과: 잠시 후 다시 시도하세요.`
    default:
      return `API 오류 (${status}): ${msg}`
  }
}
