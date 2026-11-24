"use strict";

const { protect } = require("../lib/auth");

const {
  parseJsonBody,
  created,
  badRequest,
  serverError,
  ok,
  notFound,
} = require("../lib/response");

const { docClient, TABLES } = require("../lib/dynamodb");

const {
  GetCommand,
  PutCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");

const { v4: uuidv4 } = require("uuid");

/**
 * POST /customers/{customerId}/accounts
 *
 * TODO: Create an account for an existing customer.
 * - Validate customer exists
 * - Validate type (CHECKING|SAVINGS) and currency (CAD|USD)
 * - initialBalance defaults to 0 and must be >= 0
 * - Persist to Accounts table (include customerId for the GSI)
 * - Return 201 with Account
 */

async function create(event) {
  try {
    // Step 1: Extract customerId
    const rawCustomerId = event.pathParameters?.customerId;

    if (
      typeof rawCustomerId !== "string" ||
      rawCustomerId.trim().length === 0
    ) {
      return badRequest("customerId is required");
    }

    const customerId = rawCustomerId.trim();

    // Step 2: Parse request body
    const parsed = parseJsonBody(event);

    if (!parsed.ok) {
      return parsed.response;
    }

    if (
      !parsed.data ||
      typeof parsed.data !== "object" ||
      Array.isArray(parsed.data)
    ) {
      return badRequest("Request body must be a JSON object");
    }

    const { type, currency } = parsed.data;
    const initialBalance = parsed.data.initialBalance ?? 0;

    // Step 3: Validate account type
    if (!["CHECKING", "SAVINGS"].includes(type)) {
      return badRequest("type must be CHECKING or SAVINGS");
    }

    // Step 4: Validate currency
    if (!["CAD", "USD"].includes(currency)) {
      return badRequest("currency must be CAD or USD");
    }

    // Step 5: Validate initial balance
    if (
      typeof initialBalance !== "number" ||
      !Number.isFinite(initialBalance) ||
      initialBalance < 0
    ) {
      return badRequest("initialBalance must be a number greater than or equal to 0");
    }

    // Step 6: Check whether customer exists
    const customerCommand = new GetCommand({
      TableName: TABLES.customers,
      Key: {
        customerId: customerId,
      },
    });

    const customerResult = await docClient.send(customerCommand);

    if (!customerResult.Item) {
      return notFound(`Customer ${customerId} not found`);
    }

    // Step 7: Create account object
    const account = {
      accountId: uuidv4(),
      customerId: customerId,
      type,
      currency,
      balance: initialBalance,
      status: "OPEN",
      createdAt: new Date().toISOString(),
    };

    // Step 8: Save account in DynamoDB
    const command = new PutCommand({
      TableName: TABLES.accounts,
      Item: account,
      ConditionExpression: "attribute_not_exists(accountId)",
    });

    await docClient.send(command);

    // Step 9: Return created account
    return created(account);

  } catch (error) {
    console.error("Error creating account:", error);
    return serverError();
  }
}


/**
 * GET /customers/{customerId}/accounts
 *
 * TODO: List accounts for a customer.
 * - Prefer Query on the CustomerIdIndex GSI (avoid Scan)
 * - Return 200: { items: Account[] }
 * - Return 404 if the customer does not exist
 */

async function list(event) {
  try {
    // Step 1: Extract customerId
    const rawCustomerId = event.pathParameters?.customerId;

    if (
      typeof rawCustomerId !== "string" ||
      rawCustomerId.trim().length === 0
    ) {
      return badRequest("customerId is required");
    }

    const customerId = rawCustomerId.trim();

    // Step 2: Check whether customer exists
    const customerCommand = new GetCommand({
      TableName: TABLES.customers,
      Key: {
        customerId,
      },
    });

    const customerResult = await docClient.send(customerCommand);

    if (!customerResult.Item) {
      return notFound(`Customer ${customerId} not found`);
    }

    // Step 3: Query accounts using GSI
    const items = [];
    let lastEvaluatedKey;

    do {
      const command = new QueryCommand({
        TableName: TABLES.accounts,
        IndexName: "CustomerIdIndex",
        KeyConditionExpression: "customerId = :customerId",
        ExpressionAttributeValues: {
          ":customerId": customerId,
        },
        ExclusiveStartKey: lastEvaluatedKey,
      });

      // Step 4: Execute query
      const result = await docClient.send(command);

      items.push(...(result.Items || []));
      lastEvaluatedKey = result.LastEvaluatedKey;

    } while (lastEvaluatedKey);

    // Step 5: Return account list
    return ok({ items });

  } catch (error) {
    console.error("Error listing accounts:", error);
    return serverError();
  }
}


/**
 * GET /accounts/{accountId}
 *
 * TODO: Get a single account including balance.
 * - Return 200 with Account, or 404 if missing
 */

async function get(event) {
  try {
    // Step 1: Extract accountId
    const rawAccountId = event.pathParameters?.accountId;

    if (
      typeof rawAccountId !== "string" ||
      rawAccountId.trim().length === 0
    ) {
      return badRequest("accountId is required");
    }

    const accountId = rawAccountId.trim();

    // Step 3: Prepare DynamoDB GetCommand
    const command = new GetCommand({
      TableName: TABLES.accounts,
      Key: {
        accountId,
      },
    });

    // Step 4: Fetch account from DynamoDB
    const result = await docClient.send(command);

    // Step 5: Handle account not found
    if (!result.Item) {
      return notFound(`Account ${accountId} not found`);
    }

    // Step 6: Return account with balance
    return ok(result.Item);

  } catch (error) {
    console.error("Error fetching account:", error);
    return serverError();
  }
}


module.exports = {
  create,
  list,
  get,
  createProtected: protect(create),
  listProtected: protect(list),
  getProtected: protect(get),
};
