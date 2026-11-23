export interface HttpAnswer {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: unknown
}

export type Send = (request: {
  method: "POST" | "DELETE"
  headers: Record<string, string>
  body?: string
}) => Promise<HttpAnswer>

export interface ToolResult {
  isError: boolean
  structuredContent?: Record<string, unknown>
  text: string
}

export class McpError extends Error {}

interface Answered {
  answer: HttpAnswer
  result: Record<string, unknown>
}

// The 2025 protocol with a session is what memo serves to every app's MCP client, n8n's own included.
const PROTOCOL = "2025-06-18"

const header = (headers: HttpAnswer["headers"], name: string) => {
  const found = Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1]
  return Array.isArray(found) ? found[0] : found
}

const textOf = (body: unknown) => {
  if (typeof body === "string") return body
  if (body instanceof Uint8Array) return new TextDecoder().decode(body)
  return JSON.stringify(body ?? "")
}

/** A Streamable HTTP answer is one JSON message or a server-sent event stream holding it. */
export const messagesOf = (answer: HttpAnswer): Array<Record<string, unknown>> => {
  if (answer.body !== null && typeof answer.body === "object" && !(answer.body instanceof Uint8Array))
    return [answer.body as Record<string, unknown>]
  const text = textOf(answer.body).trim()
  if (!text) return []
  if (!(header(answer.headers, "content-type") ?? "").includes("text/event-stream")) return [JSON.parse(text)]
  return text
    .split(/\r?\n\r?\n/)
    .map((event) =>
      event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n"),
    )
    .filter(Boolean)
    .map((data) => JSON.parse(data) as Record<string, unknown>)
}

export class McpSession {
  private id?: string
  private next = 1

  constructor(
    private readonly send: Send,
    private readonly client: { name: string; version: string },
  ) {}

  private headers() {
    return {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": PROTOCOL,
      ...(this.id ? { "mcp-session-id": this.id } : {}),
    }
  }

  private async request(method: string, params: Record<string, unknown>, again = true): Promise<Answered> {
    const id = this.next++
    const answer = await this.send({
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    })
    // memo keeps 20 sessions and drops the oldest, or one idle for an hour: a new one, and the call once more.
    if (answer.status === 404 && this.id && again) {
      this.id = undefined
      await this.open()
      return this.request(method, params, false)
    }
    const reply = messagesOf(answer).find((message) => message.id === id)
    if (!reply) throw new McpError(`memo gave no answer to ${method} (HTTP ${answer.status})`)
    const error = reply.error as { message?: string } | undefined
    if (error) throw new McpError(`memo refused ${method}: ${error.message ?? JSON.stringify(error)}`)
    return { answer, result: reply.result as Record<string, unknown> }
  }

  async open() {
    if (this.id) return
    const { answer } = await this.request("initialize", {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: this.client,
    })
    this.id = header(answer.headers, "mcp-session-id")
    await this.send({
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    })
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    await this.open()
    const { result } = await this.request("tools/call", { name, arguments: args })
    const content = Array.isArray(result.content) ? (result.content as Array<{ type?: string; text?: string }>) : []
    return {
      isError: result.isError === true,
      ...(result.structuredContent ? { structuredContent: result.structuredContent as Record<string, unknown> } : {}),
      text: content
        .filter((one) => one.type === "text")
        .map((one) => one.text ?? "")
        .join("\n"),
    }
  }

  async close() {
    if (!this.id) return
    const headers = this.headers()
    this.id = undefined
    await this.send({ method: "DELETE", headers }).catch(() => undefined)
  }
}
