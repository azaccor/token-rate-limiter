# token-rate-limiter

![Token Limiter with Lakebase](./Token%20Limiter%20with%20Lakebase.png)
[📹 Video Walkthrough](./Compressed%20Video%20Walkthrough.mp4)

# Explanation
One of the cornerstones of the Databricks value-add in AI is that we are a model provider neutral platform. We offer native pay-per-token hosting for open source model families like Llama, Gemma, and GPT OSS and we have first party connections with Claude, OpenAI, and by the time you're watching this hopefully Gemini as well. However, if you want to control costs, our current AI Gateway offering only allows you to do so via QPM or TPM rate limiting. QPM and TPM certainly have their use cases, but the majority of companies don't care how many times or tokens per minute their employees or end users hit a model; they care about how much it's going to cost them.

# How it Works
Introducing token-based rate limiting powered by Lakebase. The idea and implementation are simple: a user submits a request, which is then validated by the endpoint via queries to two Lakebase tables, the first to determine that user's token limits and the second to determine how far into those limits they already are. If the user is out of tokens, a cutoff message is returned and the request does not hit the FM. Otherwise, the request is passed to the FM and the payload is written back to Lakebase so that the user's total token count is updated. Finally, the response is returned to the end user with a message noting their remaining token balance.

# Why is it Interesting?
For as little as 28 cents an hour in Model Serving, plus the cost of using Lakebase, we now have a highly configurable rate limiter that can be set per user, per user per model, per user per model per unit time, and so on. Anything you can configure in a SQL query is now an achievable rate limit you can set in Databricks!

# Repo Contents

| File / Folder | Description |
|---|---|
| `Token Based Rate Limiter Notebook.ipynb` | End-to-end notebook: Lakebase setup, schema creation, `TokenRateLimiterAgent`, MLflow registration, and serving endpoint deployment |
| `rate_limiter_agent.py` | Standalone `TokenRateLimiterAgent` class — import directly into your own code to enforce limits and log usage without the notebook |
| `token-rate-limiter-ui/` | Full-stack Databricks App (React + FastAPI) for managing limits and monitoring usage — see below |

## token-rate-limiter-ui

A Databricks App that provides an admin UI on top of the Lakebase backend. Deploy it alongside the serving endpoint to give administrators a no-code interface for configuring rate limits and viewing usage.

```
token-rate-limiter-ui/
├── app.yaml                  # Databricks App config (command, env vars, secret resources)
├── requirements.txt          # Python dependencies
├── api/                      # FastAPI backend
│   ├── main.py               # App entry point, static file serving
│   ├── db.py                 # Lakebase connection pool (native Postgres role + SDK secret fallback)
│   └── routes/
│       ├── limits.py         # CRUD for user_token_limits
│       ├── pricing.py        # GET/PUT for model_pricing
│       ├── models.py         # Lists FM serving endpoints, auto-seeds pricing table
│       ├── usage.py          # Usage analytics (timeseries, top consumers, near-limit alerts)
│       └── users.py          # Workspace identity (users, service principals, groups)
└── frontend/                 # React + Ant Design SPA
    ├── src/
    │   ├── pages/
    │   │   ├── LimitManager.tsx        # CRUD table for rate limits
    │   │   └── MonitoringDashboard.tsx # Usage charts and near-limit alerts
    │   ├── components/
    │   │   ├── LimitForm.tsx           # Create/edit limit modal with multi-model select
    │   │   └── EntitySelect.tsx        # Live search for users/SPs/groups
    │   ├── hooks/useModels.ts          # Fetches available FM endpoints
    │   └── lib/api.ts                  # Typed API client
    └── package.json
```

### Features
- **Limit Manager** — create, edit, and delete rate limits per user, service principal, or group; supports token or dollar limits with hourly/daily/weekly/monthly/total windows; per-model or across all models; override flag for per-user exceptions
- **Monitoring Dashboard** — time-series usage charts sliceable by user, model, and metric (tokens or dollars); top consumers leaderboard; near-limit alerts
- **Advanced Settings** — inline-editable model pricing table seeded from live FM serving endpoints
- **Live identity search** — entity dropdowns pull users, service principals, and groups directly from the workspace via the Databricks SDK

### Deployment

#### 1. Lakebase setup
Create the three required tables (`user_token_limits`, `token_usage`, `model_pricing`) by running the setup cells in the notebook. Then create a native Postgres role for the app and store its password in Databricks Secrets:

```sql
-- Run as your admin Lakebase user
CREATE ROLE token_rate_limiter_app WITH LOGIN PASSWORD '<your-password>';
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO token_rate_limiter_app;
```

```bash
databricks secrets create-scope <YOUR_SECRET_SCOPE>
databricks secrets put-secret <YOUR_SECRET_SCOPE> <YOUR_SECRET_KEY> --string-value '<your-password>'
```

#### 2. Configure app.yaml
Fill in the placeholder values in `token-rate-limiter-ui/app.yaml`:
- `<YOUR_WORKSPACE_URL>` — your Databricks workspace URL
- `<YOUR_LAKEBASE_HOST>` — the read/write DNS of your Lakebase autoscaling instance
- `<YOUR_SECRET_SCOPE>` / `<YOUR_SECRET_KEY>` — the secret scope and key from step 1

#### 3. Build the frontend
```bash
cd token-rate-limiter-ui/frontend
npm install
npm run build
# Output lands in api/static/ (configured in vite.config.ts)
```

#### 4. Deploy
```bash
databricks workspace import-dir token-rate-limiter-ui \
  /Workspace/Users/<you>/token-rate-limiter-ui --overwrite

databricks apps create token-rate-limiter-ui --description "Token rate limiter admin UI"

databricks apps deploy token-rate-limiter-ui \
  --source-code-path /Workspace/Users/<you>/token-rate-limiter-ui
```

# Updates 3/5/2026
- Added `rate_limiter_agent.py` — standalone agent class decoupled from the notebook for easier integration into existing pipelines
- Added `token-rate-limiter-ui/` — full Databricks App with React + FastAPI for no-code limit management and usage monitoring
- DB connection uses a native Postgres role with a static password stored in Databricks Secrets, with an SDK-based fallback for secret resolution at runtime

# Updates 3/2/2026
The newest version of this code features a few important improvements over the original, namely:
- Provisioned Lakebase replaced with Autoscaling
  - This is important because Provisioned is eventually going away and Autoscaling will be the new default solution for Lakebase
- PythonModel model class replaced with ResponsesAgent
- `async def predict_stream()` added with `httpx.AsyncClient` so that multiple FM API requests can be handled simultaneously
  - This is important because we will no longer be blocked waiting for a response from the FM call, and the orchestrator can handle many more in the meantime
