"use strict";

const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { mock } = require("node:test");

const { PutCommand, GetCommand } = require("@aws-sdk/lib-dynamodb");

const { docClient } = require("../src/lib/dynamodb");
const customers = require("../src/handlers/customers");

describe("Customer API Tests", () => {

    beforeEach(() => {
        mock.restoreAll();
    });

    test("Should create a customer successfully", async () => {
        mock.method(docClient, "send", async (command) => {
            assert.ok(command instanceof PutCommand);
            return {};
        });

        const event = {
            body: JSON.stringify({
                fullName: "Test Customer",
                email: "test@example.com",
            }),
        };

        const response = await customers.create(event);
        const body = JSON.parse(response.body);

        assert.equal(response.statusCode, 201);
        assert.equal(body.fullName, "Test Customer");
        assert.equal(body.email, "test@example.com");
        assert.equal(body.status, "ACTIVE");
        assert.ok(body.customerId);
        assert.ok(body.createdAt);
    });

    test("Should return 400 for invalid email", async () => {
        const event = {
            body: JSON.stringify({
                fullName: "Test Customer",
                email: "invalid-email",
            }),
        };

        const response = await customers.create(event);
        const body = JSON.parse(response.body);

        assert.equal(response.statusCode, 400);
        assert.equal(body.error, "BAD_REQUEST");
    });

    test("Should return 404 when customer does not exist", async () => {
        mock.method(docClient, "send", async (command) => {
            assert.ok(command instanceof GetCommand);
            return {};
        });

        const event = {
            pathParameters: {
                customerId: "invalid_customer",
            },
        };

        const response = await customers.get(event);
        const body = JSON.parse(response.body);

        assert.equal(response.statusCode, 404);
        assert.equal(body.error, "NOT_FOUND");
    });

});
