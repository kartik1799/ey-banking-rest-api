"use strict";

const { test, describe, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");

const {
    GetCommand,
    PutCommand,
    QueryCommand,
} = require("@aws-sdk/lib-dynamodb");

const { docClient } = require("../src/lib/dynamodb");
const accounts = require("../src/handlers/accounts");

describe("Account API Tests", () => {

    beforeEach(() => {
        mock.restoreAll();
    });

    test("Should create an account successfully", async () => {
        mock.method(docClient, "send", async (command) => {
            if (command instanceof GetCommand) {
                return {
                    Item: { customerId: "cust_001" },
                };
            }

            if (command instanceof PutCommand) {
                return {};
            }

            throw new Error("Unexpected DynamoDB command");
        });

        const event = {
            pathParameters: {
                customerId: "cust_001",
            },
            body: JSON.stringify({
                type: "SAVINGS",
                currency: "CAD",
                initialBalance: 500,
            }),
        };

        const response = await accounts.create(event);
        const body = JSON.parse(response.body);

        assert.equal(response.statusCode, 201);
        assert.equal(body.customerId, "cust_001");
        assert.equal(body.type, "SAVINGS");
        assert.equal(body.currency, "CAD");
        assert.equal(body.balance, 500);
        assert.equal(body.status, "OPEN");
        assert.ok(body.accountId);
    });

    test("Should return 404 when customer does not exist", async () => {
        mock.method(docClient, "send", async () => {
            return {};
        });

        const event = {
            pathParameters: {
                customerId: "invalid_customer",
            },
            body: JSON.stringify({
                type: "SAVINGS",
                currency: "CAD",
                initialBalance: 100,
            }),
        };

        const response = await accounts.create(event);
        const body = JSON.parse(response.body);

        assert.equal(response.statusCode, 404);
        assert.equal(body.error, "NOT_FOUND");
    });

    test("Should list accounts successfully", async () => {
        mock.method(docClient, "send", async (command) => {
            if (command instanceof GetCommand) {
                return {
                    Item: { customerId: "cust_001" },
                };
            }

            if (command instanceof QueryCommand) {
                return {
                    Items: [
                        {
                            accountId: "acct_001",
                            customerId: "cust_001",
                            type: "CHECKING",
                            currency: "CAD",
                            balance: 250,
                        },
                        {
                            accountId: "acct_002",
                            customerId: "cust_001",
                            type: "SAVINGS",
                            currency: "CAD",
                            balance: 1000,
                        },
                    ],
                };
            }

            throw new Error("Unexpected DynamoDB command");
        });

        const event = {
            pathParameters: {
                customerId: "cust_001",
            },
        };

        const response = await accounts.list(event);
        const body = JSON.parse(response.body);

        assert.equal(response.statusCode, 200);
        assert.equal(body.items.length, 2);
        assert.equal(body.items[0].accountId, "acct_001");
        assert.equal(body.items[1].accountId, "acct_002");
    });

});
