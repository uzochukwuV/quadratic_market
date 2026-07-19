# AWS Guidance

- Prefer the AWS MCP Server for AWS interactions. If unavailable, use the AWS CLI directly.
- Before starting a task, check whether a relevant AWS skill is available. Load the skill with `retrieve_skill` and prefer its guidance over general knowledge.
- When uncertain about AWS details such as API parameters, permissions, limits, or error codes, verify against official documentation rather than guessing.
- When creating infrastructure, prefer infrastructure as code with AWS CDK or CloudFormation over ad hoc console work.
- Follow AWS Well-Architected principles when working with infrastructure.
- Do not use em dashes in AWS resource names or descriptions. Use hyphens instead.

## Secret Safety

- Load the `aws-secrets-manager` skill first for any secret, credential, API key, token, or password task.
- Do not call `secretsmanager get-secret-value` or `batch-get-secret-value` directly.
- Use `{{resolve:secretsmanager:secret-id:SecretString:json-key}}` with `asm-exec` so secrets resolve at runtime without entering context.
holla