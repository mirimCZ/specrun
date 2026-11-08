# specrun

Runs implementation specs task by task with Claude, unattended: each task in a fresh Agent SDK
session, dependencies first, waiting out plan usage limits, verifying and committing on green,
and recording run analytics and deviations from the brief for later feedback.

Status: skeleton. The design is being written as a spec in [`docs/`](docs/); the Agent SDK
spike is in [`docs/spikes/agent-sdk.md`](docs/spikes/agent-sdk.md).

## Development

```sh
npm install
npm run typecheck
npm test
npm run build      # → dist/, bin `specrun` = dist/cli/main.js
npm run spike      # Agent SDK spike (uses a few cents of the plan's usage)
```

Node ≥ 22, TypeScript strict, ESM, vitest, zod, Prettier (100 columns).
