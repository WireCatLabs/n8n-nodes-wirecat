@AGENTS.md

# n8n-nodes-wirecat — working rules

The WireCat CLI standards (`@wirecat/cli-base` docs/standards) apply where they fit a node package: commit messages,
comments, the changelog and docs style. n8n's own rules win for everything n8n checks: `pnpm lint` (`n8n-node lint`),
no runtime dependencies, no file or environment access in node code, MIT license, English UI text.

## Local rules

- **The node talks MCP to wcat by hand** (`nodes/WireCatMemo/mcp.ts`): a verified community node may not depend on
  the MCP SDK. It speaks the 2025-06-18 protocol with a session, as n8n's own MCP Client node does.
- **The envelope builders stay pure** (`nodes/WireCatMemo/envelope.ts`), so tests check them against wcat's schema
  (`test/fixtures/records-envelope.v1.schema.json`, copied from `@wirecat/cli-core/schemas`) and with
  `wcat records check` on a throwaway store. Refresh the schema copy when cli-core changes it.
- **Tests are `.mts` files.** `n8n-node lint` checks every `.ts` file with the node rules (no `child_process`, no
  `fs`, no `process`), and its strict mode refuses a changed `eslint.config.mjs`.
- **Never test against the owner's wcat or n8n.** Use a throwaway wcat (`MESSAGING_STORE`, `WCAT_*_DIR`,
  `WIRECAT_STATE_DIR` moved, `DBUS_SESSION_BUS_ADDRESS=disabled:`) and a throwaway n8n container.
- Plans and journals go to `WireCatLabs/cli-private`, not here.
