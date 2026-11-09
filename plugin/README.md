# specrun plugin

Claude Code skills for authoring the specs that `specrun run <spec>` implements task by task:

| Skill        | Use it to                                                                      |
| ------------ | ------------------------------------------------------------------------------ |
| `refine`     | Stress-test a request or plan and resolve open decisions with the user         |
| `write-spec` | Write `docs/<spec>/` — `spec.json`, README, `TASK_PROMPT.md`, one brief a task |

Project specifics (commit scopes, terminology, test commands) stay in each project's CLAUDE.md;
the skills read them from there.

## Install

The specrun repository is a Claude Code marketplace with this one plugin. In Claude Code:

```
/plugin marketplace add <path or GitHub owner/repo of specrun>
/plugin install specrun@specrun
```

Check the manifests after changing them: `claude plugin validate .` (marketplace) and
`claude plugin validate plugin` (this plugin).
