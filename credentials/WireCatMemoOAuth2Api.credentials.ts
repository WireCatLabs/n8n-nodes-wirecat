import type { Icon, ICredentialType, INodeProperties } from "n8n-workflow"

/**
 * wcat registers each app itself (OAuth dynamic client registration) and lets it in with the one-time login code
 * wcat shows. n8n's OAuth2 flow does both for any credential that extends oAuth2Api and turns the registration on,
 * as n8n's own MCP credential does.
 */
export class WireCatMemoOAuth2Api implements ICredentialType {
  name = "wireCatMemoOAuth2Api"

  displayName = "WireCat OAuth2 API"

  extends = ["oAuth2Api"]

  icon: Icon = { light: "file:wirecat.svg", dark: "file:wirecat.dark.svg" }

  documentationUrl = "https://github.com/WireCatLabs/n8n-nodes-wirecat#credentials"

  properties: INodeProperties[] = [
    {
      displayName: "Use Dynamic Client Registration",
      name: "useDynamicClientRegistration",
      type: "hidden",
      default: true,
    },
    {
      displayName: "WireCat Address",
      name: "serverUrl",
      type: "string",
      default: "",
      required: true,
      placeholder: "https://laptop.example.ts.net",
      description:
        "The address wcat mcp server status prints, without /mcp at the end. When you connect, type the login code wcat shows.",
    },
  ]
}
