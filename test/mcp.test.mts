import { describe, expect, it } from "vitest"
import { type HttpAnswer, McpError, McpSession, messagesOf, type Send } from "../nodes/WireCatMemo/mcp"

const sse = (message: unknown): HttpAnswer => ({
  status: 200,
  headers: { "Content-Type": "text/event-stream" },
  body: `event: message\ndata: ${JSON.stringify(message)}\n\n`,
})

const fakeMemo = (toolAnswer: (id: number) => HttpAnswer) => {
  const sent: Array<{ method: string; headers: Record<string, string>; body?: Record<string, unknown> }> = []
  const send: Send = async (request) => {
    const body = request.body ? (JSON.parse(request.body) as Record<string, unknown>) : undefined
    sent.push({ method: request.method, headers: request.headers, ...(body ? { body } : {}) })
    if (body?.method === "initialize")
      return {
        status: 200,
        headers: { "content-type": "application/json", "mcp-session-id": "s-1" },
        body: JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } }),
      }
    if (body?.method === "tools/call") return toolAnswer(body.id as number)
    return { status: 202, headers: {}, body: "" }
  }
  return { send, sent }
}

describe("McpSession", () => {
  it("opens one session, calls tools in it and ends it", async () => {
    const memo = fakeMemo((id) =>
      sse({ jsonrpc: "2.0", id, result: { structuredContent: { item: { created: 2 } }, content: [] } }),
    )
    const session = new McpSession(memo.send, { name: "test", version: "1" })
    expect(await session.call("memo_write", { command: "records import" })).toEqual({
      isError: false,
      structuredContent: { item: { created: 2 } },
      text: "",
    })
    await session.call("memo_read", { command: "leads list" })
    await session.close()

    expect(memo.sent.map((one) => one.body?.method ?? one.method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/call",
      "tools/call",
      "DELETE",
    ])
    expect(memo.sent[0].headers["mcp-session-id"]).toBeUndefined()
    expect(memo.sent.slice(1).every((one) => one.headers["mcp-session-id"] === "s-1")).toBe(true)
    expect(memo.sent[2].body?.params).toEqual({ name: "memo_write", arguments: { command: "records import" } })
  })

  it("reports memo's refusal of a tool as a result, and a protocol error as McpError", async () => {
    const refused = fakeMemo((id) =>
      sse({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: "permission_error" }] } }),
    )
    const result = await new McpSession(refused.send, { name: "test", version: "1" }).call("memo_write", {})
    expect(result).toEqual({ isError: true, text: "permission_error" })

    const broken = fakeMemo((id) => sse({ jsonrpc: "2.0", id, error: { code: -32602, message: "bad params" } }))
    await expect(new McpSession(broken.send, { name: "test", version: "1" }).call("memo_write", {})).rejects.toThrow(
      new McpError("memo refused tools/call: bad params"),
    )
  })

  it("reads an answer n8n already parsed, plain JSON text and a stream of several events", () => {
    expect(messagesOf({ status: 200, headers: {}, body: { id: 1 } })).toEqual([{ id: 1 }])
    expect(messagesOf({ status: 200, headers: { "content-type": "application/json" }, body: '{"id":2}' })).toEqual([
      { id: 2 },
    ])
    expect(
      messagesOf({
        status: 200,
        headers: { "content-type": "text/event-stream" },
        body: 'data: {"method":"notifications/progress"}\r\n\r\ndata: {"id":3}\r\n\r\n',
      }),
    ).toEqual([{ method: "notifications/progress" }, { id: 3 }])
  })
})

describe("a session memo dropped", () => {
  it("is opened again once and the call repeated; a second 404 is an error", async () => {
    const memo = fakeMemo((id) => sse({ jsonrpc: "2.0", id, result: { structuredContent: { ok: true } } }))
    let gone = 1
    const send: Send = async (request) => {
      const body = request.body ? (JSON.parse(request.body) as { method?: string }) : {}
      if (body.method === "tools/call" && gone-- > 0) return { status: 404, headers: {}, body: "" }
      return memo.send(request)
    }
    const session = new McpSession(send, { name: "test", version: "1" })
    await session.open()
    expect(await session.call("memo_read", {})).toMatchObject({ isError: false })
    expect(memo.sent.filter((one) => one.body?.method === "initialize")).toHaveLength(2)

    gone = 2
    await expect(session.call("memo_read", {})).rejects.toThrow(/no answer to tools\/call \(HTTP 404\)/)
  })
})
