import type { IDataObject, IExecuteFunctions } from "n8n-workflow"
import {
  accountOf,
  clean,
  dealRecords,
  deleteRecords,
  type Envelope,
  envelopeOf,
  type EnvelopeRecord,
  type Kind,
  type Known,
  organizationKey,
  organizationRecords,
  parseEnvelope,
  personRecords,
  type Stage,
  type Stored,
} from "./envelope"
import type { McpSession } from "./mcp"

/** wcat answered, but refused what was asked: the message is wcat's own. */
export class MemoRefusal extends Error {
  constructor(
    message: string,
    readonly detail: unknown,
  ) {
    super(message)
  }
}

interface Receipt extends IDataObject {
  refused?: number
  errors?: Array<{ pointer?: string; code?: string; message?: string }>
}

const text = (fn: IExecuteFunctions, name: string, index: number) => clean(fn.getNodeParameter(name, index, "")) ?? ""

const extra = (fields: IDataObject, name: string) => clean(fields[name])

const call = async (session: McpSession, tool: string, args: Record<string, unknown>) => {
  const result = await session.call(tool, args)
  const content = (result.structuredContent ?? { text: result.text }) as IDataObject
  if (!result.isError) return { content }
  const error = (content.error ?? {}) as IDataObject
  return { content, error: { code: String(error.code ?? ""), message: String(error.message ?? result.text) } }
}

const refused = (content: IDataObject, fallback: string) =>
  new MemoRefusal(String((content.error as IDataObject | undefined)?.message ?? fallback), content.error ?? content)

const LIST_LIMIT = 500

interface Listed {
  byId: Map<string, Stored>
  complete: boolean
}

/**
 * The pipelines and organizations wcat keeps for an account, read once an execution with `records list` (wcat's MCP
 * offers no lookup of one record). Past the newest 500 the node cannot tell, and says so with undefined.
 */
export class KeptRecords {
  private readonly lists = new Map<string, Promise<Listed>>()

  constructor(private readonly session: McpSession) {}

  private list(account: string, type: string): Promise<Listed> {
    const key = `${account}|${type}`
    let listed = this.lists.get(key)
    if (!listed) {
      listed = this.read(account, type)
      this.lists.set(key, listed)
    }
    return listed
  }

  private async read(account: string, type: string): Promise<Listed> {
    const { content, error } = await call(this.session, "wcat_read", {
      command: "records list",
      arguments: { account, query: [`type:${type}`], limit: LIST_LIMIT },
    })
    if (error?.code === "not_found") return { byId: new Map(), complete: true }
    if (error) throw refused(content, `wcat would not list the ${type} records of ${account}`)
    const items = (content.items ?? []) as IDataObject[]
    const byId = new Map<string, Stored>()
    for (const one of items)
      if (!one.deleted_at) byId.set(String(one.external_id), { fields: (one.fields ?? {}) as Stored["fields"] })
    return { byId, complete: !(content.page as IDataObject | undefined)?.has_more }
  }

  async find(account: string, type: string, id: string): Promise<Stored | undefined> {
    return (await this.list(account, type)).byId.get(id)
  }

  async exists(account: string, type: string, id: string): Promise<boolean | undefined> {
    const listed = await this.list(account, type)
    return listed.byId.has(id) ? true : listed.complete ? false : undefined
  }

  /** What this execution just imported, so the next item does not send it again. */
  async remember(account: string, records: EnvelopeRecord[]) {
    for (const one of records)
      if (one.operation === "upsert" && this.lists.has(`${account}|${one.type}`))
        (await this.list(account, one.type)).byId.set(one.external_id, { fields: one.fields ?? {} })
  }
}

const stagesOf = (fn: IExecuteFunctions, index: number): Stage[] =>
  (fn.getNodeParameter("stages.stage", index, []) as IDataObject[]).map((one) => ({
    id: (clean(one.id) ?? "").toLowerCase(),
    name: clean(one.name) ?? clean(one.id) ?? "",
    outcome: (clean(one.outcome) ?? "open") as Stage["outcome"],
  }))

const recordsFor = async (
  fn: IExecuteFunctions,
  kept: KeptRecords,
  account: string,
  resource: string,
  operation: string,
  index: number,
): Promise<EnvelopeRecord[]> => {
  const fields = fn.getNodeParameter("additionalFields", index, {}) as IDataObject
  const contact = {
    name: text(fn, "contactName", index),
    email: text(fn, "email", index),
    phone: text(fn, "phone", index),
    company: text(fn, "company", index),
  }
  const company = contact.company ? organizationKey(contact.company) : undefined
  const companyExists = () => (company ? kept.exists(account, "organization", company) : Promise.resolve(undefined))
  if (resource === "lead" || resource === "deal") {
    const kind = resource as Kind
    if (operation === "delete") return deleteRecords(kind, text(fn, "id", index))
    const input = {
      ...contact,
      id: text(fn, "id", index),
      title: text(fn, "title", index),
      pipelineId: text(fn, "pipelineId", index),
      pipelineName: text(fn, "pipelineName", index),
      stages: stagesOf(fn, index),
      stage: text(fn, "stage", index),
      amount: fields.amount,
      currency: extra(fields, "currency"),
      closeDate: extra(fields, "closeDate"),
      url: extra(fields, "url"),
    }
    const known: Known = {
      pipeline: input.stages.length ? undefined : await kept.find(account, "pipeline", input.pipelineId),
      organization: await companyExists(),
    }
    return dealRecords(kind, input, known)
  }
  if (resource === "person") {
    const person = { ...contact, id: extra(fields, "id"), position: extra(fields, "position") }
    return personRecords(person, { organization: await companyExists() })
  }
  return organizationRecords({
    name: text(fn, "name", index),
    id: extra(fields, "id"),
    domain: extra(fields, "domain"),
  })
}

const notFound = (receipt: Receipt) =>
  (receipt.refused ?? 0) > 0 && (receipt.errors ?? []).every((one) => one.code === "record.not-found")

/** One item's call to wcat, as the output items it gives. */
export const runItem = async (
  fn: IExecuteFunctions,
  session: McpSession,
  kept: KeptRecords,
  index: number,
): Promise<IDataObject | IDataObject[]> => {
  const resource = fn.getNodeParameter("resource", index) as string
  const operation = fn.getNodeParameter("operation", index) as string

  if (resource === "memory") {
    const [tool, args] =
      operation === "findCommand"
        ? ["wcat_tools_search", { query: text(fn, "words", index) }]
        : operation === "search"
          ? ["wcat_read", { command: "search all", arguments: { query: text(fn, "query", index) } }]
          : ["wcat_read", { command: text(fn, "command", index), arguments: argumentsOf(fn, index) }]
    const { content, error } = await call(session, tool as string, args as Record<string, unknown>)
    if (error) throw refused(content, "wcat refused the call")
    return Array.isArray(content.items) ? (content.items as IDataObject[]) : ((content.item ?? content) as IDataObject)
  }

  let envelope: Envelope
  if (resource === "envelope") envelope = parseEnvelope(fn.getNodeParameter("envelope", index))
  else {
    const account = text(fn, "account", index)
    const options = fn.getNodeParameter("options", index, {}) as IDataObject
    const batchId = extra(options, "batchId") ?? `${fn.getExecutionId()}-${index}`
    envelope = envelopeOf(account, batchId, [])
    envelope.records = await recordsFor(fn, kept, account, resource, operation, index)
  }
  const command = resource === "envelope" && operation === "check" ? "records check" : "records import"
  const { content, error } = await call(session, "wcat_write", {
    command,
    arguments: { account: accountOf(envelope), input: envelope },
  })
  if (error) throw refused(content, "wcat refused the import")
  const receipt = (content.item ?? content) as Receipt
  if (command === "records import" && !receipt.refused) await kept.remember(accountOf(envelope), envelope.records)
  if (operation === "delete" && notFound(receipt)) {
    const record = envelope.records[0]
    return { status: "not_found", type: record.type, external_id: record.external_id, account: accountOf(envelope) }
  }
  if (command === "records import" && (receipt.refused ?? 0) > 0) {
    const why = (receipt.errors ?? []).map((one) => `${one.pointer ?? ""} ${one.message ?? ""}`.trim()).join("; ")
    throw new MemoRefusal(`wcat refused ${receipt.refused} record(s): ${why}`, receipt)
  }
  return receipt
}

const argumentsOf = (fn: IExecuteFunctions, index: number): IDataObject => {
  const given = fn.getNodeParameter("arguments", index, {}) as unknown
  return typeof given === "string" ? (JSON.parse(given || "{}") as IDataObject) : (given as IDataObject)
}
