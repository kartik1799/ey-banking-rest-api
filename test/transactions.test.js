"use strict";

const { test, describe, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");

const {
    GetCommand,
    UpdateCommand,
    TransactWriteCommand,
} = require("@aws-sdk/lib-dynamodb");

const { docClient } = require("../src/lib/dynamodb");
const transactions = require("../src/handlers/transactions");

describe("Transaction API Tests", () => {

    beforeEach(() => {
        mock.restoreAll();
    });

    test("Should deposit successfully", async () => {
        mock.method(docClient, "send", async (command) => {
            if (command instanceof GetCommand) {
                return {
                    Item: {
                        accountId: "acct_001",
                        currency: "CAD",
                        balance: 500,
                    },
                };
            }

            if (command instanceof UpdateCommand) {
                return {
                    Attributes: {
                        accountId: "acct_001",
                        currency: "CAD",
                        balance: 600,
                    },
                };
            }

            throw new Error("Unexpected DynamoDB command");
        });

        const response = await transactions.deposit({
            pathParameters: { accountId: "acct_001" },
            body: JSON.stringify({
                amount: 100,
                currency: "CAD",
            }),
        });

        const body = JSON.parse(response.body);

        assert.equal(response.statusCode, 200);
        assert.equal(body.balance, 600);
    });

    test("Should reject deposit with currency mismatch", async () => {
        mock.method(docClient, "send", async () => ({
            Item: {
                accountId: "acct_001",
                currency: "CAD",
                balance: 500,
            },
        }));

        const response = await transactions.deposit({
            pathParameters: { accountId: "acct_001" },
            body: JSON.stringify({
                amount: 100,
                currency: "USD",
            }),
        });

        const body = JSON.parse(response.body);

        assert.equal(response.statusCode, 400);
        assert.equal(body.error, "BAD_REQUEST");
    });

    test("Should withdraw successfully", async () => {
        mock.method(docClient, "send", async (command) => {
            if (command instanceof GetCommand) {
                return {
                    Item: {
                        accountId: "acct_001",
                        currency: "CAD",
                        balance: 500,
                    },
                };
            }

            if (command instanceof UpdateCommand) {
                return {
                    Attributes: {
                        accountId: "acct_001",
                        currency: "CAD",
                        balance: 450,
                    },
                };
            }

            throw new Error("Unexpected DynamoDB command");
        });

        const response = await transactions.withdraw({
            pathParameters: { accountId: "acct_001" },
            body: JSON.stringify({
                amount: 50,
                currency: "CAD",
            }),
        });

        const body = JSON.parse(response.body);

        assert.equal(response.statusCode, 200);
        assert.equal(body.balance, 450);
    });

    test("Should return 409 for insufficient withdrawal funds", async () => {
        mock.method(docClient, "send", async (command) => {
            if (command instanceof GetCommand) {
                return {
                    Item: {
                        accountId: "acct_001",
                        currency: "CAD",
                        balance: 50,
                    },
                };
            }

            if (command instanceof UpdateCommand) {
                const error = new Error("Conditional check failed");
                error.name = "ConditionalCheckFailedException";
                throw error;
            }

            throw new Error("Unexpected DynamoDB command");
        });

        const response = await transactions.withdraw({
            pathParameters: { accountId: "acct_001" },
            body: JSON.stringify({
                amount: 100,
                currency: "CAD",
            }),
        });

        const body = JSON.parse(response.body);

        assert.equal(response.statusCode, 409);
        assert.equal(body.error, "CONFLICT");
    });

    test("Should transfer funds successfully", async () => {
        let getCount = 0;

        mock.method(docClient, "send", async (command) => {
            if (command instanceof GetCommand) {
                getCount++;

                if (getCount === 1) {
                    return {
                        Item: {
                            accountId: "acct_001",
                            currency: "CAD",
                            status: "OPEN",
                            balance: 500,
                        },
                    };
                }

                if (getCount === 2) {
                    return {
                        Item: {
                            accountId: "acct_002",
                            currency: "CAD",
                            status: "OPEN",
                            balance: 1000,
                        },
                    };
                }

                if (getCount === 3) {
                    return {
                        Item: {
                            accountId: "acct_001",
                            currency: "CAD",
                            status: "OPEN",
                            balance: 400,
                        },
                    };
                }

                return {
                    Item: {
                        accountId: "acct_002",
                        currency: "CAD",
                        status: "OPEN",
                        balance: 1100,
                    },
                };
            }

            if (command instanceof TransactWriteCommand) {
                return {};
            }

            throw new Error("Unexpected DynamoDB command");
        });

        const response = await transactions.transfer({
            body: JSON.stringify({
                fromAccountId: "acct_001",
                toAccountId: "acct_002",
                amount: 100,
                currency: "CAD",
            }),
        });

        const body = JSON.parse(response.body);

        assert.equal(response.statusCode, 200);
        assert.equal(body.fromAccount.balance, 400);
        assert.equal(body.toAccount.balance, 1100);
    });

    test("Should return 409 when transfer has insufficient funds", async () => {
        mock.method(docClient, "send", async (command) => {
            if (command instanceof GetCommand) {
                const accountId = command.input.Key.accountId;

                return {
                    Item: {
                        accountId,
                        currency: "CAD",
                        status: "OPEN",
                        balance: accountId === "acct_001" ? 50 : 1000,
                    },
                };
            }

            if (command instanceof TransactWriteCommand) {
                const error = new Error("Transaction cancelled");
                error.name = "TransactionCanceledException";
                throw error;
            }

            throw new Error("Unexpected DynamoDB command");
        });

        const response = await transactions.transfer({
            body: JSON.stringify({
                fromAccountId: "acct_001",
                toAccountId: "acct_002",
                amount: 100,
                currency: "CAD",
            }),
        });

        const body = JSON.parse(response.body);

        assert.equal(response.statusCode, 409);
        assert.equal(body.error, "CONFLICT");
    });

    test("Should return 404 when source account does not exist", async () => {
        mock.method(docClient, "send", async (command) => {
            if (command instanceof GetCommand) {
                const accountId = command.input.Key.accountId;

                return accountId === "acct_001"
                    ? {}
                    : {
                        Item: {
                            accountId: "acct_002",
                            currency: "CAD",
                            status: "OPEN",
                            balance: 1000,
                        },
                    };
            }

            throw new Error("Unexpected DynamoDB command");
        });

        const response = await transactions.transfer({
            body: JSON.stringify({
                fromAccountId: "acct_001",
                toAccountId: "acct_002",
                amount: 100,
                currency: "CAD",
            }),
        });

        const body = JSON.parse(response.body);

        assert.equal(response.statusCode, 404);
        assert.equal(body.error, "NOT_FOUND");
    });

    test("Should reject transfer to the same account", async () => {
        const response = await transactions.transfer({
            body: JSON.stringify({
                fromAccountId: "acct_001",
                toAccountId: "acct_001",
                amount: 100,
                currency: "CAD",
            }),
        });

        const body = JSON.parse(response.body);

        assert.equal(response.statusCode, 400);
        assert.equal(body.error, "BAD_REQUEST");
    });

});
