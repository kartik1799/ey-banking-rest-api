# nodejs-api-db-assessment

Take-home template for a Node.js REST API that mimics **API Gateway → Lambda → DynamoDB**.

Candidates implement banking endpoints (customers / accounts / balances) against a provided OpenAPI contract, using DynamoDB Local and serverless-offline.

## Quick start (candidates)

```bash
cp .env.example .env
npm install
npm run setup
npm start
```

- API: http://localhost:3000  
- Swagger UI: http://localhost:3000/docs  
- Contract: [`openapi/openapi.yaml`](openapi/openapi.yaml)  
- Instructions: [`ASSESSMENT.md`](ASSESSMENT.md)

## Stack

| Concern | Local stand-in |
|---------|----------------|
| API Gateway + Lambda | Serverless Framework + `serverless-offline` |
| DynamoDB | DynamoDB Local via Docker (`docker compose`) |
| SDK | AWS SDK v3 (`@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`) |

## Project layout

```
openapi/openapi.yaml          API contract (source of truth)
serverless.yml                Function ↔ HTTP route mapping
src/handlers/                 Lambda-style handlers (stubs → implement)
src/lib/                      DynamoDB client + response helpers
scripts/                      Create tables, seed data, wait-for-db
docker-compose.yml            DynamoDB Local
ASSESSMENT.md                 Candidate brief
```

## Useful commands

| Command | Purpose |
|---------|---------|
| `npm run setup` | Start DB, create tables, seed |
| `npm start` | Run API locally (port 3000) |
| `npm run db:reset` | Recreate tables + reseed |
| `npm run db:down` | Stop DynamoDB Local |

## For assessors

- **Candidate template:** this branch (`501` stubs)
- **Reference solution:** branch `cursor/reference-solution` (full handlers + smoke tests)
- **Grader assets:** [`graders/`](graders/) — Postman collection; smoke script lives on the reference branch

Keep the reference branch / grader materials private; do not share with candidates.

## JWT authentication (added)

The API now includes a small JWT authentication layer for interview/demo purposes:

- `POST /auth/register` — register a username/password against an existing `customerId` and an `accountId` belonging to that customer.
- `POST /auth/login` — validate username, account ID and password hash, then issue an access token (15 minutes) and refresh token (7 days).
- `POST /auth/refresh` — exchange a valid refresh token for a new token pair.
- Customer/account read, account creation, deposit, withdrawal and transfer routes require `Authorization: Bearer <accessToken>`.
- The middleware checks that the token's customer owns the requested customer/account resources.

Set a unique `JWT_SECRET` of at least 32 characters in `.env` before starting the API. Generate one with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`. Never commit `.env` or share the secret. `.env.example` contains only a placeholder.

For a local demo, use a seeded customer/account (or create the customer and account through an authorized setup flow), register with `username`, `password`, `customerId` and `accountId`, log in with `username`, `accountId` and `password`, then pass the returned access token as a Bearer token to protected routes.

**Security scope note:** this is an educational HS256 implementation using Node's built-in crypto and scrypt password hashing. Refresh tokens are stateless in this assessment version, so immediate refresh-token revocation/rotation and logout invalidation are not implemented. For production banking, use a managed identity provider or a hardened auth service, asymmetric signing/managed keys, refresh-token rotation with server-side revocation, MFA, lockout/risk controls, audit logging, TLS, and strict least-privilege IAM. JWT authentication does not replace authorization checks.

### Local authentication walkthrough

The setup script seeds `cust_001` and `acct_001` (owned by `cust_001`). For a quick Swagger demo:

1. `POST /auth/register` with `username`, `password` (12+ chars), `customerId: "cust_001"`, and `accountId: "acct_001"`.
2. `POST /auth/login` with the same `username`, `password`, and `accountId`.
3. Copy `accessToken`; click Swagger **Authorize** and enter the token (Swagger's Bearer scheme may ask for the raw token; do not prefix it twice).
4. Call protected endpoints such as `GET /accounts/acct_001`.
5. When the 15-minute access token expires, call `POST /auth/refresh` with the `refreshToken`, then authorize with the newly returned access token.

The account ID is an additional account/customer binding check, not a replacement for a strong password or a second authentication factor. This demo uses a stateless refresh token; production should persist refresh-token identifiers/hashes, rotate and revoke them, and add MFA, login throttling/lockout, audit trails, and a managed identity provider.
