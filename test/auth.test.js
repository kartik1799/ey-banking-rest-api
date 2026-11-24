"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-hmac-signing";
const { hashPassword, verifyPassword, issueTokenPair, verifyToken } = require("../src/lib/auth");

test("password hash verifies correct password and rejects incorrect password", async () => {
    const hash = await hashPassword("Correct-Horse-Battery-42");
    assert.equal(await verifyPassword("Correct-Horse-Battery-42", hash), true);
    assert.equal(await verifyPassword("wrong-password", hash), false);
});

test("access and refresh JWTs contain expected claims and token types", () => {
    const pair = issueTokenPair({ username: "demo.user", customerId: "cust_001", accountId: "acct_001" });
    const access = verifyToken(pair.accessToken, "access");
    const refresh = verifyToken(pair.refreshToken, "refresh");
    assert.equal(access.sub, "demo.user");
    assert.equal(access.customerId, "cust_001");
    assert.equal(access.accountId, "acct_001");
    assert.equal(refresh.type, "refresh");
    assert.equal(pair.expiresIn, 900);
});

test("JWT verification rejects a token used for the wrong purpose or tampered token", () => {
    const pair = issueTokenPair({ username: "demo.user", customerId: "cust_001", accountId: "acct_001" });
    assert.throws(() => verifyToken(pair.refreshToken, "access"), /claims/);
    const tampered = `${pair.accessToken.slice(0, -1)}x`;
    assert.throws(() => verifyToken(tampered, "access"), /signature/);
});
