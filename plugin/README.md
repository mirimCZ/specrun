# specrun plugin

Claude Code skills for authoring the specs that `specrun run <spec>` implements task by task:

| Skill         | Use it to                                                                             |
| ------------- | ------------------------------------------------------------------------------------- |
| `refine`      | Stress-test a request or plan and resolve open decisions with the user                |
| `write-spec`  | Write `<specsDir>/<spec>/` — `tasks.yaml`, README, `TASK_PROMPT.md`, one brief a task |
| `plan`        | Run the whole planning sequence in one session (started by `specrun plan`)            |
| `feature-map` | Create and update the feature docs and overview graph in `featuresDir`                |
| `feedback`    | Turn `specrun stats` / `deviations` / `analyze` data into reviewed edit proposals     |

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
