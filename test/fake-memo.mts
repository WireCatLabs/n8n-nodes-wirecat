import type { IDataObject, IExecuteFunctions, INodeExecutionData } from "n8n-workflow"

interface Kept {
  fields: Record<string, unknown>
  relations: unknown[]
  deleted: boolean
}

type Records = Array<{ type: string; external_id: string; operation: string; fields?: object; relations?: unknown[] }>

/**
 * memo's MCP over HTTP as the node sees it: a session, then tool calls. Records are kept per account and replaced
 * whole on import, as memo does; `dropSession()` makes the next call answer 404, as memo does for a pushed-out one.
 */
export const fakeMemo = () => {
  const store = new Map<string, Kept>()
  const calls: Array<{ tool: string; command?: string; args: IDataObject }> = []
  let session = 0
  let live = ""
  let listLimit: number | undefined
  const keyOf = (account: string, type: string, id: string) => `${account}|${type}:${id}`

  const importRecords = (account: string, records: Records, dry: boolean) => {
    const receipt = {
      dry_run: dry,
      created: 0,
      updated: 0,
      unchanged: 0,
      deleted: 0,
      refused: 0,
      errors: [] as IDataObject[],
    }
    for (const [index, one] of records.entries()) {
      const key = keyOf(account, one.type, one.external_id)
      const kept = store.get(key)
      if (one.operation === "delete") {
        if (!kept) {
          receipt.refused++
          receipt.errors.push({
            pointer: `/records/${index}/external_id`,
            code: "record.not-found",
            message: `no ${one.type} ${one.external_id} to delete`,
          })
          continue
        }
        receipt.deleted++
        if (!dry) kept.deleted = true
        continue
      }
      const next = { fields: { ...one.fields }, relations: one.relations ?? [], deleted: false }
      if (kept && JSON.stringify(kept) === JSON.stringify(next)) receipt.unchanged++
      else kept ? receipt.updated++ : receipt.created++
      if (!dry) store.set(key, next)
    }
    return receipt
  }

  const tool = (name: string, args: IDataObject): IDataObject => {
    if (name === "memo_tools_search") return { items: [{ command: "leads list", writes: false }] }
    const command = String(args.command)
    const given = (args.arguments ?? {}) as IDataObject
    if (command === "records list") {
      const type = String((given.query as string[])[0]).replace("type:", "")
      const prefix = `${String(given.account)}|${type}:`
      const items = [...store.entries()]
        .filter(([key, one]) => key.startsWith(prefix) && !one.deleted)
        .map(([key, one]) => ({ type, external_id: key.slice(prefix.length), fields: one.fields, deleted_at: null }))
      const limit = listLimit ?? Number(given.limit)
      return { items: items.slice(0, limit), page: { mode: "page", limit, has_more: items.length > limit } }
    }
    if (command === "records import" || command === "records check") {
      const input = given.input as { records: Records }
      return { item: importRecords(String(given.account), input.records, command === "records check") }
    }
    if (command === "search all") return { items: [{ ref: "lead:1" }, { ref: "lead:2" }] }
    if (command === "records delete")
      return {
        isError: true,
        error: { code: "validation_error", message: '"records delete" writes: call it with memo_write' },
      }
    return { items: [] }
  }

  const handle = (request: { method: string; headers?: Record<string, string>; body?: string }) => {
    if (request.method === "DELETE") return { statusCode: 200, headers: {}, body: "" }
    const message = JSON.parse(String(request.body)) as { id?: number; method: string; params: IDataObject }
    const sid = request.headers?.["mcp-session-id"]
    if (message.method === "initialize") {
      live = `s-${++session}`
      return {
        statusCode: 200,
        headers: { "content-type": "application/json", "mcp-session-id": live },
        body: JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} }),
      }
    }
    if (sid !== live) throw Object.assign(new Error("Session not found"), { httpCode: "404" })
    if (message.method !== "tools/call") return { statusCode: 202, headers: {}, body: "" }
    const name = String(message.params.name)
    const args = message.params.arguments as IDataObject
    calls.push({ tool: name, ...(args.command ? { command: String(args.command) } : {}), args })
    const answer = tool(name, args)
    const result = answer.isError
      ? {
          isError: true,
          structuredContent: answer,
          content: [{ type: "text", text: String((answer.error as IDataObject).message) }],
        }
      : { structuredContent: answer, content: [] }
    return {
      statusCode: 200,
      headers: { "content-type": "text/event-stream" },
      body: `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n\n`,
    }
  }

  return {
    store,
    calls,
    handle,
    sessions: () => session,
    limitLists: (limit: number) => {
      listLimit = limit
    },
    dropSession: () => {
      live = "gone"
    },
  }
}

/** The parts of n8n's IExecuteFunctions the node uses, with parameters given per item. */
export const executeContext = (
  memo: ReturnType<typeof fakeMemo>,
  params: IDataObject[],
  options: { continueOnFail?: boolean } = {},
) => {
  const read = (source: IDataObject, path: string): unknown =>
    path.split(".").reduce<unknown>((value, key) => (value as IDataObject | undefined)?.[key], source)
  const fn = {
    getInputData: (): INodeExecutionData[] => params.map(() => ({ json: {} })),
    getNodeParameter: (name: string, index: number, fallback?: unknown) => read(params[index], name) ?? fallback,
    getCredentials: async () => ({ serverUrl: "https://memo.example/" }),
    getNode: () => ({
      id: "1",
      name: "WireCat Memo",
      type: "@wirecat/n8n-nodes-wirecat.wireCatMemo",
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
    }),
    getExecutionId: () => "7",
    continueOnFail: () => options.continueOnFail ?? false,
    helpers: {
      httpRequestWithAuthentication: async (
        _credential: string,
        request: { method: string; url: string; headers?: Record<string, string>; body?: string },
      ) => {
        if (request.url !== "https://memo.example/mcp") throw new Error(`unexpected address ${request.url}`)
        return memo.handle(request)
      },
    },
  }
  return fn as unknown as IExecuteFunctions
}
