# Changelog

Notable changes to `@wirecat/n8n-nodes-wirecat`, one section per version, newest first. Versions follow
[semantic versioning](https://semver.org/); before `1.0.0` a minor release may change the node's parameters.

## Unreleased

### Added

- **The WireCat Memo node sends leads, deals, people and organizations into memo.** Each item becomes one records
  envelope with its pipeline, contact and company, and the same ID sent again updates the record instead of adding
  another. A lead never overwrites what a Person or Organization node sent, a pipeline's stages change only when you
  set them, and an amount like `1,500` that reads two ways stops the node. See [What it does](README.md#what-it-does).
- **Delete tells memo the source deleted a lead or deal.** A record memo never had gives `status: "not_found"`.
- **A records envelope goes in as it is**, to import or only to check what an import would do.
- **Search memo, run a command that only reads, and list the commands** from a workflow or an AI agent.
- **The WireCat Memo OAuth2 API credential** registers n8n with memo by itself; you type the login code memo shows.
- **Three example workflows** to import: a webhook lead, a form lead and a CRM deal. The webhooks check a header and
  answer only `{"ok": true}`. See [examples](examples).
