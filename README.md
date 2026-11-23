# WireCat Memo for n8n

**Every lead, deal and contact your n8n workflows see, in the memory you keep on your own computer.**

[memo](https://github.com/WireCatLabs/cli-memo) is WireCat's local store for your notes, mail, messages and business
records, which you and your AI agents search with a link to every source. This node lets any n8n workflow write into
it: a form fills in a lead, a CRM sends its deals, a webhook adds a person. Nothing goes to a cloud database in
between. n8n talks to memo directly, and memo keeps the data on your machine.

- **No JSON to build by hand.** Pick a lead, a deal, a person or an organization and map the fields. The node builds
  memo's records envelope, with the pipeline, the contact and the company linked.
- **Safe to send twice.** The same ID sent again updates the record and changes nothing else, so you can turn on
  **Retry On Fail** and let n8n repeat a call it is unsure about.
- **One login, no API key.** n8n registers itself with memo. You type the one-time code memo shows, as you would for
  ChatGPT or Claude.
- **Reads too.** Search what memo keeps or run a reading command such as `leads list`. n8n also lists the node as
  **WireCat Memo Tool**, for an AI Agent node.

## Contents

- [Installation](#installation)
- [Credentials](#credentials)
- [What it does](#what-it-does)
- [Examples](#examples)
- [Compatibility](#compatibility)
- [Remove test data](#remove-test-data)

## Installation

In n8n, open **Settings → Community Nodes → Install** and enter `@wirecat/n8n-nodes-wirecat`. The
[n8n guide](https://docs.n8n.io/integrations/community-nodes/installation/) has the other ways.

You also need memo on your computer, serving MCP over HTTP behind an HTTPS tunnel that n8n can reach, such as
Tailscale Funnel. [memo's remote guide](https://github.com/WireCatLabs/cli-memo/blob/main/docs/remote.md) sets it up:

```sh
memo mcp server start --public-url https://laptop.example.ts.net
memo mcp server status   # the address and the current login code
```

## Credentials

Create a **WireCat Memo OAuth2 API** credential:

1. In **Memo Address**, enter the address `memo mcp server status` prints, without `/mcp` at the end.
2. Click **Connect my account**. A memo page opens.
3. Type the login code that `memo mcp server status` or WireCat Desktop shows, and click **Allow**.

n8n then keeps its token and renews it by itself. If memo's
[saved permissions](https://github.com/WireCatLabs/cli-memo/blob/main/docs/configuration.md#permissions) block a
command, the node stops with memo's reason. `memo mcp revoke` logs every app out, n8n included.

**Moving memo to a new address? Create a new credential.** n8n keeps the token when you edit only **Memo Address**
and sends it to the new address. Checked with n8n 2.9.4. A token for one memo must not reach another server.

## What it does

| Resource     | Operation        | What memo gets                                                                    |
| ------------ | ---------------- | --------------------------------------------------------------------------------- |
| Lead         | Create or Update | The lead in its pipeline and stage, its contact, and a link to the company        |
| Lead         | Delete           | The lead marked deleted at the source                                             |
| Deal         | Create or Update | The same as a lead, plus the amount, currency, close date and the stage's outcome |
| Deal         | Delete           | The deal marked deleted at the source                                             |
| Person       | Create or Update | The person, keyed on the e-mail, else the phone, with their company and position  |
| Organization | Create or Update | The organization, keyed on its name, with its domain                              |
| Envelope     | Import           | A [records envelope][envelope] you built yourself                                 |
| Envelope     | Check            | What that import would do, writing nothing                                        |
| Memory       | Search           | `search all`: one output item for each hit                                        |
| Memory       | Run Read Command | Any command that only reads, such as `leads list`, with its arguments as JSON     |
| Memory       | Find Command     | The commands memo offers, and the arguments of the ones that match your words     |

[envelope]: https://github.com/WireCatLabs/cli-memo/blob/main/docs/business.md#bring-data-in-from-another-system

A few things to know:

- **Account.** Everything goes to the account you name, such as `n8n:site`. Use one account a workflow, so
  `memo records clear --account n8n:site` can remove a test import whole.
- **ID.** The ID decides whether a send adds a record or updates one, so it is required. Map the ID your form or CRM
  gives. Then a second send, or n8n's **Retry execution**, updates the record instead of adding a copy.
- **Amount.** Send a number, with a dot for decimals: `1500.00`. `1,500.00` and `1500,50` are read too. `1,500` and
  `1.500,00` stop the node, because they mean different amounts in different countries.
- **Pipeline.** A lead or deal sits in a pipeline stage. Without your own stages, a lead has `new`; a deal has
  `new`, `proposal`, `won` and `lost`. The node sends the pipeline the first time, and again only when you set
  **Stages**. Stages set elsewhere for the same pipeline stay as they are.
- **Contact and company.** A lead's contact goes into a person record of the lead's own. Memo links it to the one
  person who already has that exact e-mail or phone, and never by name. So a lead never overwrites the name or
  position a Person node sent. The company is sent only when memo has no record for it yet; otherwise the lead is
  only linked to it, so a domain an Organization node sent stays. A company's key is its name in lower case, the same
  as the Organization node's.
- **Person and Organization nodes** send what the source says now. A field left empty is dropped from that record.
- **Delete** tells memo the source deleted the record. Memo keeps it, marked deleted. A record memo never had gives
  an item with `status: "not_found"` instead of an error.
- **Review.** Anything that feeds money totals waits for you in `memo review`, as from any other source.
- **When memo is off.** The node fails when the computer is off or the server is stopped, and nothing is kept.
  Turn on **Retry On Fail**, or keep the items in n8n until memo answers.
- **AI agents.** n8n also lists the node as **WireCat Memo Tool**. The model can't change the resource or the
  operation; it runs the one you picked. So don't give an agent a Delete or Envelope Import node unless it should
  write that.

## Examples

Import a file from [examples](examples) with **Workflow → Import from File**, then pick your credential in each
WireCat Memo node.

The two webhooks check a header: create a **Header Auth** credential with a header name and a long random value,
pick it in the webhook node, and have the sender add that header. Without it, anyone who finds the address can write
into your memo. They answer `{"ok": true}`, not memo's receipt.

- [webhook-lead.json](examples/webhook-lead.json): `POST /webhook/wirecat-lead` with `id`, `name`, `email`, `phone`,
  `company` and `message`.
- [form-lead.json](examples/form-lead.json): an n8n form with Name, Email, Phone and Message. The lead's ID is a hash
  of the answers and the time sent, so a retried execution updates the same lead.
- [crm-deal.json](examples/crm-deal.json): `POST /webhook/wirecat-deal` with `id` and `title`, and optionally
  `stage`, `amount`, `currency`, `close_date`, `contact`, `email`, `phone` and `company`. `"deleted": true` marks
  the deal deleted.

```sh
curl -X POST https://n8n.example.com/webhook/wirecat-lead \
  -H 'content-type: application/json' \
  -H "x-wirecat-key: $WIRECAT_WEBHOOK_KEY" \
  -d '{"id":"web-17","name":"Anna Example","email":"anna@example.com","message":"Call me back"}'
```

## Compatibility

Tested with n8n 2.9.4 and memo 0.149.0. The credential needs an n8n with OAuth dynamic client registration, which
n8n's own MCP credential uses too.

## Remove test data

A test import goes whole with:

```sh
memo records clear --account n8n:test --yes
```

## Development

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm dev   # n8n on http://localhost:5678 with this node loaded
```

`pnpm test` checks every envelope the node builds against memo's schema and, when `memo` is installed, with
`memo records check` on a throwaway store.

To release, bump the version in `package.json` and `CHANGELOG.md` on `main` and run `bin/release`. It pushes the
version tag, and [release.yml](.github/workflows/release.yml) publishes to npm with provenance, which n8n's
verification requires.

## License

[MIT](LICENSE)
