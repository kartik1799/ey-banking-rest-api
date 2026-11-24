"use strict";

require("./load-env");

const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { docClient, TABLES } = require("./dynamodb");
const { GetCommand } = require("@aws-sdk/lib-dynamodb");
const scrypt = promisify(crypto.scrypt);

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;
const SECRET = process.env.JWT_SECRET;

function getSecret() {
  if (!SECRET || SECRET.length < 32) {
    throw new Error("JWT_SECRET must be configured with at least 32 characters");
  }
  return SECRET;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function signToken(payload, expiresInSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSeconds }));
  const unsigned = `${header}.${body}`;
  const signature = crypto.createHmac("sha256", getSecret()).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

function verifyToken(token, expectedType = "access") {
  if (typeof token !== "string") throw new Error("Invalid token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token");
  const [headerPart, payloadPart, signature] = parts;
  const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8"));
  if (header.alg !== "HS256" || header.typ !== "JWT") throw new Error("Invalid token algorithm");
  const unsigned = `${headerPart}.${payloadPart}`;
  const expected = crypto.createHmac("sha256", getSecret()).update(unsigned).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error("Invalid token signature");
  const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) throw new Error("Token expired");
  if (payload.type !== expectedType || !payload.sub || !payload.customerId || !payload.accountId) throw new Error("Invalid token claims");
  return payload;
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== "string" || !storedHash.includes(":")) return false;
  const [salt, hash] = storedHash.split(":");
  const derived = await scrypt(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

function issueTokenPair(user) {
  const claims = { sub: user.username, customerId: user.customerId, accountId: user.accountId };
  return {
    tokenType: "Bearer",
    accessToken: signToken({ ...claims, type: "access" }, ACCESS_TTL_SECONDS),
    expiresIn: ACCESS_TTL_SECONDS,
    refreshToken: signToken({ ...claims, type: "refresh" }, REFRESH_TTL_SECONDS),
    refreshExpiresIn: REFRESH_TTL_SECONDS,
  };
}

function unauthorized(message = "Authentication required") {
  return { statusCode: 401, headers: { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" }, body: JSON.stringify({ error: "UNAUTHORIZED", message }) };
}

function forbidden(message = "You are not allowed to access this resource") {
  return { statusCode: 403, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "FORBIDDEN", message }) };
}

function protect(handler) {
  return async (event, context) => {
    try {
      const header = event.headers?.authorization || event.headers?.Authorization || "";
      const match = /^Bearer\s+(.+)$/i.exec(header);
      if (!match) return unauthorized("Bearer access token is required");
      const claims = verifyToken(match[1], "access");
      event.auth = claims;

      const customerId = event.pathParameters?.customerId;
      if (customerId && customerId !== claims.customerId) return forbidden();

      const accountIds = [];
      if (event.pathParameters?.accountId) accountIds.push(event.pathParameters.accountId);
      if (event.httpMethod === "POST" && event.path === "/transfers") {
        let body;
        try { body = JSON.parse(event.body || "{}"); } catch { return handler(event, context); }
        if (body.fromAccountId) accountIds.push(body.fromAccountId);
        if (body.toAccountId) accountIds.push(body.toAccountId);
      }
      for (const accountId of accountIds) {
        const result = await docClient.send(new GetCommand({ TableName: TABLES.accounts, Key: { accountId } }));
        if (!result.Item) continue; // Existing handler returns the appropriate 404.
        if (result.Item.customerId !== claims.customerId) return forbidden();
      }
      return handler(event, context);
    } catch (error) {
      if (/expired/i.test(error.message)) return unauthorized("Access token has expired; use the refresh token");
      if (/token|JWT_SECRET/i.test(error.message)) return unauthorized("Invalid or unverifiable access token");
      console.error("Authentication middleware error:", error);
      return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "INTERNAL_SERVER_ERROR", message: "Authentication service unavailable" }) };
    }
  };
}

module.exports = { ACCESS_TTL_SECONDS, REFRESH_TTL_SECONDS, hashPassword, verifyPassword, issueTokenPair, verifyToken, protect, unauthorized };
