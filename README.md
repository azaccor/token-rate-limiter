# token-rate-limiter

![Token Limiter with Lakebase](./Token%20Limiter%20with%20Lakebase.png)
[📹 Video Walkthrough](./Compressed%20Video%20Walkthrough.mp4)

# Explanation
One of the cornerstones of the Databricks value-add in AI is that we are a model provider neutral platform. We offer native pay-per-token hosting for open source model families like Llama, Gemma, and GPT OSS and we have first party connections with Claude, OpenAI, and by the time you’re watching this hopefully Gemini as well. However, if you want to control costs, our current AI Gateway offering only allows you to do so via QPM or TPM rate limiting. QPM and TPM certainly have their use cases, but the majority of companies don’t care how many times or tokens per minute their employees or end users hit a model; they care about how much it’s going to cost them. 

# How it Works
Introducing token-based rate limiting powered by Lakebase. The idea and implementation are simple: a user submits a request, which is then validated by the endpoint via queries to two Lakebase tables, the first to determine that user’s token limits and the second to determine how far into those limits they already are. If the user is out of tokens, a cutoff message is returned and the request does not hit the FM. Otherwise, the request is passed to the FM and the payload is written back to Lakebase so that the user’s total token count is updated. Finally, the response is returned to the end user with a message noting their remaining token balance.

# Why is it Interesting?
For as little as 28 cents an hour in Model Serving, plus the cost of using Lakebase, we now have a highly configurable rate limiter that be set per user, per user per model, per user per model per unit time, and so on. Anything you can configure in a SQL query is now an achievable rate limit you can set in Databricks!

# Updates 3/2/2026
The newest version of this code features a few important improvements over the original, namely:
- Provisioned Lakebase replaced with Autoscaling
  - This is important because Provisioned is eventually going away and Autoscaling will be the new default solution for Lakebase
- PythonModel model class replaced with ResponsesAgent
- `async def predict_stream()` added with `httpx.AsyncClient` so that multiple FM API requests can be handled simultaneously
  - This is important because we will no longer be blocked waiting for a response from the FM call, and the orchestrator can handle many more in the meantime
