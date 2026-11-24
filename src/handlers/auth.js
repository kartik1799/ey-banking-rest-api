"use strict";

const { docClient, TABLES } = require("../lib/dynamodb");
const { PutCommand, GetCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const { parseJsonBody, created, ok, badRequest, notFound, conflict, serverError } = require("../lib/response");
const { hashPassword, verifyPassword, issueTokenPair, verifyToken, unauthorized } = require("../lib/auth");


async function register(event) {
    try {
        const parsed = parseJsonBody(event);
        if (!parsed.ok) return parsed.response;
        const { username, password, customerId, accountId } = parsed.data || {};
        if (typeof username !== "string" || !/^[a-zA-Z0-9._-]{4,40}$/.test(username)) return badRequest("username must be 4-40 characters and contain only letters, numbers, dot, underscore or hyphen");
        if (typeof password !== "string" || password.length < 12) return badRequest("password must contain at least 12 characters");
        if (typeof customerId !== "string" || !customerId.trim()) return badRequest("customerId is required");
        if (typeof accountId !== "string" || !accountId.trim()) return badRequest("accountId is required");
        const customer = await docClient.send(new GetCommand({ TableName: TABLES.customers, Key: { customerId: customerId.trim() } }));
        if (!customer.Item) return notFound("Customer not found");
        const account = await docClient.send(new GetCommand({ TableName: TABLES.accounts, Key: { accountId: accountId.trim() } }));
        if (!account.Item || account.Item.customerId !== customerId.trim()) return badRequest("accountId must belong to the supplied customerId");
        const passwordHash = await hashPassword(password);
        await docClient.send(new PutCommand({ TableName: TABLES.users, Item: { username: username.toLowerCase(), customerId: customerId.trim(), accountId: accountId.trim(), passwordHash, status: "ACTIVE", createdAt: new Date().toISOString() }, ConditionExpression: "attribute_not_exists(username)" }));
        return created({ username: username.toLowerCase(), customerId: customerId.trim(), accountId: accountId.trim(), message: "User registered. You can now log in." });
    } catch (error) {
        if (error.name === "ConditionalCheckFailedException") return conflict("Username is already registered");
        console.error("Registration error:", error);
        return serverError();
    }
}

async function login(event) {
    try {
        const parsed = parseJsonBody(event);
        if (!parsed.ok) return parsed.response;
        const { username, password, accountId } = parsed.data || {};
        if (typeof username !== "string" || typeof password !== "string" || typeof accountId !== "string") return badRequest("username, password and accountId are required");
        const result = await docClient.send(new GetCommand({ TableName: TABLES.users, Key: { username: username.toLowerCase() } }));
        const user = result.Item;
        if (!user || user.status !== "ACTIVE" || user.accountId !== accountId.trim() || !(await verifyPassword(password, user.passwordHash))) return unauthorized("Invalid username, account ID or password");
        return ok(issueTokenPair(user));
    } catch (error) {
        console.error("Login error:", error);
        return serverError();
    }
}

async function refresh(event) {
    try {
        const parsed = parseJsonBody(event);
        if (!parsed.ok) return parsed.response;
        const refreshToken = parsed.data?.refreshToken;
        let claims;
        try { claims = verifyToken(refreshToken, "refresh"); } catch (error) { return unauthorized(error.message.includes("expired") ? "Refresh token expired; please log in again" : "Invalid refresh token"); }
        const result = await docClient.send(new GetCommand({ TableName: TABLES.users, Key: { username: claims.sub } }));
        const user = result.Item;
        if (!user || user.status !== "ACTIVE" || user.customerId !== claims.customerId || user.accountId !== claims.accountId) return unauthorized("User is no longer active");
        return ok(issueTokenPair(user));
    } catch (error) {
        console.error("Token refresh error:", error);
        return serverError();
    }
}

module.exports = { register, login, refresh };
