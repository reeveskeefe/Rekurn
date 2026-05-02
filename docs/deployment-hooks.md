# Deployment Hooks

Configure hooks per environment:

```bash
rekurn config deploy-hook production https://example.com/deploy/prod
rekurn config deploy-hook preview https://example.com/deploy/preview
rekurn config list
```

Deploy current `HEAD`:

```bash
rekurn deploy
```

Deploy a snapshot or branch:

```bash
rekurn deploy production @v2.1.0
rekurn deploy --env staging main
```

Hook payloads include `commitHash`, `ref`, `message`, `author`, `timestamp`, `environment`, and `rollback`.
