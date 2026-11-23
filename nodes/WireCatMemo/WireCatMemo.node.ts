import {
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
import { EnvelopeError } from "./envelope"
import { McpError, McpSession, type Send } from "./mcp"
import { properties } from "./properties"
import { KeptRecords, MemoRefusal, runItem } from "./run"

const CREDENTIAL = "wireCatMemoOAuth2Api"
const CLIENT = { name: "n8n-nodes-wirecat", version: "0.1.0" }

const failure = (fn: IExecuteFunctions, error: unknown, itemIndex: number) => {
  if (error instanceof NodeOperationError || error instanceof NodeApiError) return error
  if (error instanceof EnvelopeError || error instanceof SyntaxError)
    return new NodeOperationError(fn.getNode(), error, { itemIndex })
  if (error instanceof MemoRefusal)
    return new NodeOperationError(fn.getNode(), error.message, { itemIndex, description: JSON.stringify(error.detail) })
  if (error instanceof McpError) return new NodeApiError(fn.getNode(), { message: error.message }, { itemIndex })
  return new NodeApiError(fn.getNode(), error as JsonObject, { itemIndex })
}

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
      try {
        const answer = (await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIAL, request)) as {
          statusCode: number
          headers: Record<string, string>
          body: unknown
        }
        return { status: answer.statusCode, headers: answer.headers, body: answer.body }
      } catch (error) {
        // n8n wraps a failed request in NodeApiError with httpCode; a 401 has already been renewed and retried by then.
        const status = Number((error as { httpCode?: string }).httpCode)
        if (status === 404) return { status, headers: {}, body: "" }
        throw failure(this, error, 0)
      }
    }
    const session = new McpSession(send, CLIENT)
    const kept = new KeptRecords(session)
    const output: INodeExecutionData[] = []
    try {
      for (let index = 0; index < items.length; index++) {
        try {
          const answer = await runItem(this, session, kept, index)
          for (const json of Array.isArray(answer) ? answer : [answer])
            output.push({ json, pairedItem: { item: index } })
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
