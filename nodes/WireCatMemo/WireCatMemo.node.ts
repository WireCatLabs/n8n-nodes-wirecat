import {
  type IDataObject,
  type IExecuteFunctions,
  type IHttpRequestOptions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
  type JsonObject,
  NodeApiError,
  NodeConnectionTypes,
  NodeOperationError,
} from "n8n-workflow"
import {
  accountOf,
  dealRecords,
  deleteRecords,
  type Envelope,
  EnvelopeError,
  envelopeOf,
  type EnvelopeRecord,
  type Kind,
  organizationRecords,
  parseEnvelope,
  personRecords,
  type Stage,
} from "./envelope"
import { McpError, McpSession, type Send } from "./mcp"
import { properties } from "./properties"

const CREDENTIAL = "wireCatMemoOAuth2Api"
const CLIENT = { name: "n8n-nodes-wirecat", version: "0.1.0" }

interface Receipt {
  refused?: number
  errors?: Array<{ pointer?: string; message?: string }>
}

const text = (fn: IExecuteFunctions, name: string, index: number) => String(fn.getNodeParameter(name, index, "") ?? "")

const recordsFor = (fn: IExecuteFunctions, resource: string, operation: string, index: number): EnvelopeRecord[] => {
  const extra = fn.getNodeParameter("additionalFields", index, {}) as IDataObject
  const contact = {
    name: text(fn, "contactName", index),
    email: text(fn, "email", index),
    phone: text(fn, "phone", index),
    company: text(fn, "company", index),
  }
  if (resource === "lead" || resource === "deal") {
    const kind = resource as Kind
    if (operation === "delete") return deleteRecords(kind, text(fn, "id", index))
    const stages = (fn.getNodeParameter("stages.stage", index, []) as Stage[]).map((one) => ({
      id: String(one.id).trim().toLowerCase(),
      name: String(one.name || one.id).trim(),
      outcome: one.outcome,
    }))
    return dealRecords(kind, {
      ...contact,
      id: text(fn, "id", index),
      title: text(fn, "title", index),
      pipelineId: text(fn, "pipelineId", index),
      pipelineName: text(fn, "pipelineName", index),
      stages,
      stage: text(fn, "stage", index),
      amount: extra.amount as string | undefined,
      currency: extra.currency as string | undefined,
      closeDate: extra.closeDate as string | undefined,
      url: extra.url as string | undefined,
    })
  }
  if (resource === "person")
    return personRecords({ ...contact, id: extra.id as string | undefined, position: extra.position as string })
  return organizationRecords({
    name: text(fn, "name", index),
    id: extra.id as string | undefined,
    domain: extra.domain as string | undefined,
  })
}

const envelopeFor = (fn: IExecuteFunctions, resource: string, operation: string, index: number): Envelope => {
  if (resource === "envelope") return parseEnvelope(fn.getNodeParameter("envelope", index))
  const options = fn.getNodeParameter("options", index, {}) as IDataObject
  const batchId = String(options.batchId || `${fn.getExecutionId()}-${index}`)
  return envelopeOf(text(fn, "account", index), batchId, recordsFor(fn, resource, operation, index))
}

const callFor = (fn: IExecuteFunctions, resource: string, operation: string, index: number) => {
  if (resource === "memory") {
    if (operation === "findCommand") return { tool: "memo_tools_search", args: { query: text(fn, "words", index) } }
    if (operation === "search")
      return { tool: "memo_read", args: { command: "search all", arguments: { query: text(fn, "query", index) } } }
    const given = fn.getNodeParameter("arguments", index, {}) as unknown
    const args = typeof given === "string" ? (JSON.parse(given || "{}") as IDataObject) : (given as IDataObject)
    return { tool: "memo_read", args: { command: text(fn, "command", index), arguments: args } }
  }
  const envelope = envelopeFor(fn, resource, operation, index)
  const command = resource === "envelope" && operation === "check" ? "records check" : "records import"
  return { tool: "memo_write", args: { command, arguments: { account: accountOf(envelope), input: envelope } } }
}

const failure = (fn: IExecuteFunctions, error: unknown, itemIndex: number) => {
  if (error instanceof NodeOperationError || error instanceof NodeApiError) return error
  if (error instanceof EnvelopeError || error instanceof SyntaxError)
    return new NodeOperationError(fn.getNode(), error, { itemIndex })
  if (error instanceof McpError) return new NodeApiError(fn.getNode(), { message: error.message }, { itemIndex })
  return new NodeApiError(fn.getNode(), error as JsonObject, { itemIndex })
}

const refusals = (receipt: Receipt) =>
  (receipt.errors ?? []).map((one) => `${one.pointer ?? ""} ${one.message ?? ""}`.trim()).join("; ")

export class WireCatMemo implements INodeType {
  description: INodeTypeDescription = {
    displayName: "WireCat Memo",
    name: "wireCatMemo",
    icon: { light: "file:wirecat.svg", dark: "file:wirecat.dark.svg" },
    group: ["output"],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: "Send leads, deals, people and organizations into WireCat memo, and search what it keeps",
    defaults: { name: "WireCat Memo" },
    usableAsTool: true,
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: CREDENTIAL, required: true }],
    properties,
  }

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData()
    const credentials = await this.getCredentials<{ serverUrl: string }>(CREDENTIAL)
    const url = `${credentials.serverUrl
      .trim()
      .replace(/\/+$/, "")
      .replace(/\/mcp$/, "")}/mcp`
    const send: Send = async ({ method, headers, body }) => {
      const request: IHttpRequestOptions = {
        method,
        url,
        headers,
        ...(body ? { body } : {}),
        json: false,
        encoding: "text",
        returnFullResponse: true,
      }
      const answer = (await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL, request)) as {
        statusCode: number
        headers: Record<string, string>
        body: unknown
      }
      return { status: answer.statusCode, headers: answer.headers, body: answer.body }
    }
    const session = new McpSession(send, CLIENT)
    const output: INodeExecutionData[] = []
    try {
      for (let index = 0; index < items.length; index++) {
        try {
          const resource = this.getNodeParameter("resource", index) as string
          const operation = this.getNodeParameter("operation", index) as string
          const { tool, args } = callFor(this, resource, operation, index)
          const result = await session.call(tool, args)
          const content = result.structuredContent ?? { text: result.text }
          if (result.isError) {
            const error = (content.error ?? {}) as IDataObject
            throw new NodeOperationError(
              this.getNode(),
              String(error.message ?? result.text ?? "memo refused the call"),
              {
                itemIndex: index,
                description: JSON.stringify(content.error ?? content),
              },
            )
          }
          const item = (content.item ?? content) as IDataObject & Receipt
          if (args.command === "records import" && (item.refused ?? 0) > 0)
            throw new NodeOperationError(this.getNode(), `memo refused ${item.refused} record(s): ${refusals(item)}`, {
              itemIndex: index,
            })
          if (Array.isArray(content.items))
            output.push(...(content.items as IDataObject[]).map((one) => ({ json: one, pairedItem: { item: index } })))
          else output.push({ json: item, pairedItem: { item: index } })
        } catch (error) {
          if (this.continueOnFail()) {
            output.push({ json: { error: (error as Error).message }, pairedItem: { item: index } })
            continue
          }
          throw failure(this, error, index)
        }
      }
    } finally {
      await session.close()
    }
    return [output]
  }
}
