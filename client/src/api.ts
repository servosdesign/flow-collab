import type { FlowPayload, FlowRecord } from '@vue-flow-sync/shared'

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

const request = async <T>(path: string, init?: RequestInit) : Promise<T> => {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers
    }
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string
    } | null

    throw new Error(body?.message ?? `Request failed with ${response.status}`)
  }

  return response.json() as Promise<T>
}

export const loadFlow = async (slug: string) => {
  return request<FlowRecord>(`/api/flows/${slug}`)
}

export const saveFlow = async (slug: string, payload: FlowPayload) => {
  return request<FlowRecord>(`/api/flows/${slug}`, {
    method: 'PUT',
    body: JSON.stringify(payload)
  })
}

export const resetSeedFlow = async (slug: string) => {
  return request<FlowPayload & { slug: string }>(`/api/flows/${slug}/reset-seed`, {
    method: 'POST'
  })
}

export const uploadNodeImage = async (file: File) => {
  const formData = new FormData()
  formData.append('image', file)

  const response = await fetch(`${apiUrl}/api/images`, {
    method: 'POST',
    body: formData
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string
    } | null

    throw new Error(body?.message ?? `Upload failed with ${response.status}`)
  }

  return response.json() as Promise<{ url: string }>
}

export const loginUser = async (username: string, password: string) => {
  return request<{
    id: string
    username: string
    displayName: string
    color: string
  }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  })
}
