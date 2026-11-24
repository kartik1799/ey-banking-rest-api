"use strict";

const { protect } = require("../lib/auth");

const {
  parseJsonBody,
  ok,
  badRequest,
  serverError,
  notFound,
  conflict,
} = require("../lib/response");

const { docClient, TABLES } = require("../lib/dynamodb");

const {
  GetCommand,
  UpdateCommand,
  TransactWriteCommand,
} = require("@aws-sdk/lib-dynamodb");

/**
 * POST /accounts/{accountId}/deposits
 *
 * STRETCH (mid-senior): Credit the account balance.
 * - Validate amount > 0 and currency matches the account
 * - Update balance in DynamoDB
 * - Return 200 with updated Account
 */

async function deposit(event) {
  try {
    // Step 1: Extract accountId
    const accountId = event.pathParameters?.accountId?.trim();

    if (!accountId) {
      return badRequest("accountId is required");
    }

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

    const { amount, currency } = parsed.data;

    // Step 3: Validate amount
    if (
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return badRequest("amount must be greater than 0");
    }

    // Step 4: Validate currency
    if (!["CAD", "USD"].includes(currency)) {
      return badRequest("currency must be CAD or USD");
    }

    // Step 5: Check whether account exists
    const getCommand = new GetCommand({
      TableName: TABLES.accounts,
      Key: {
        accountId,
      },
    });

    const accountResult = await docClient.send(getCommand);

    if (!accountResult.Item) {
      return notFound(`Account ${accountId} not found`);
    }

    // Step 6: Validate account currency
    if (accountResult.Item.currency !== currency) {
      return badRequest("Currency does not match account currency");
    }

    // Step 7: Atomically update account balance
    const updateCommand = new UpdateCommand({
      TableName: TABLES.accounts,
      Key: {
        accountId,
      },
      UpdateExpression: "SET balance = balance + :amount",
      ConditionExpression: "attribute_exists(accountId) AND currency = :currency",
      ExpressionAttributeValues: {
        ":amount": amount,
        ":currency": currency,
      },
      ReturnValues: "ALL_NEW",
    });

    const updatedResult = await docClient.send(updateCommand);

    // Step 8: Return updated account
    return ok(updatedResult.Attributes);

  } catch (error) {
    console.error("Error processing deposit:", error);
    return serverError();
  }
}


/**
 * POST /accounts/{accountId}/withdrawals
 *
 * STRETCH (mid-senior): Debit the account balance.
 * - Reject with 409 if insufficient funds
 * - Return 200 with updated Account
 */

async function withdraw(event) {
  try {
    // Step 1: Extract accountId
    const accountId = event.pathParameters?.accountId?.trim();

    if (!accountId) {
      return badRequest("accountId is required");
    }

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

    const { amount, currency } = parsed.data;

    // Step 3: Validate amount
    if (
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return badRequest("amount must be greater than 0");
    }

    // Step 4: Validate currency
    if (!["CAD", "USD"].includes(currency)) {
      return badRequest("currency must be CAD or USD");
    }

    // Step 5: Check account existence
    const getCommand = new GetCommand({
      TableName: TABLES.accounts,
      Key: { accountId },
    });

    const accountResult = await docClient.send(getCommand);

    if (!accountResult.Item) {
      return notFound(`Account ${accountId} not found`);
    }

    // Step 6: Validate currency
    if (accountResult.Item.currency !== currency) {
      return badRequest("Currency does not match account currency");
    }

    // Step 7: Atomically withdraw amount
    const updateCommand = new UpdateCommand({
      TableName: TABLES.accounts,
      Key: { accountId },

      UpdateExpression: "SET balance = balance - :amount",

      ConditionExpression:
        "attribute_exists(accountId) AND balance >= :amount AND currency = :currency",

      ExpressionAttributeValues: {
        ":amount": amount,
        ":currency": currency,
      },

      ReturnValues: "ALL_NEW",
    });

    const updatedResult = await docClient.send(updateCommand);

    // Step 8: Return updated account
    return ok(updatedResult.Attributes);

  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      return conflict("Insufficient funds or account condition not satisfied");
    }

    console.error("Error processing withdrawal:", error);
    return serverError();
  }
}


/**
 * POST /transfers
 *
 * STRETCH (mid-senior): Move funds between two accounts.
 * - Same currency required
 * - Insufficient funds → 409
 * - Think about partial-failure / consistency (document your approach)
 * - Return 200: { fromAccount, toAccount }
 */

async function transfer(event) {
  try {
    // Step 1: Parse request body
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

    const {
      fromAccountId,
      toAccountId,
      amount,
      currency,
    } = parsed.data;

    // Step 2: Validate account IDs
    if (
      typeof fromAccountId !== "string" ||
      !fromAccountId.trim()
    ) {
      return badRequest("fromAccountId is required");
    }

    if (
      typeof toAccountId !== "string" ||
      !toAccountId.trim()
    ) {
      return badRequest("toAccountId is required");
    }

    const sourceId = fromAccountId.trim();
    const destinationId = toAccountId.trim();

    // Step 3: Prevent self-transfer
    if (sourceId === destinationId) {
      return badRequest("Source and destination accounts must be different");
    }

    // Step 4: Validate amount
    if (
      typeof amount !== "number" ||
      !Number.isFinite(amount) ||
      amount <= 0
    ) {
      return badRequest("amount must be greater than 0");
    }

    // Step 5: Validate currency
    if (!["CAD", "USD"].includes(currency)) {
      return badRequest("currency must be CAD or USD");
    }

    // Step 6: Fetch both accounts
    const [sourceResult, destinationResult] = await Promise.all([
      docClient.send(
        new GetCommand({
          TableName: TABLES.accounts,
          Key: { accountId: sourceId },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: TABLES.accounts,
          Key: { accountId: destinationId },
        })
      ),
    ]);

    const sourceAccount = sourceResult.Item;
    const destinationAccount = destinationResult.Item;

    // Step 7: Check account existence
    if (!sourceAccount) {
      return notFound(`Source account ${sourceId} not found`);
    }

    if (!destinationAccount) {
      return notFound(`Destination account ${destinationId} not found`);
    }

    // Step 8: Validate currency
    if (
      sourceAccount.currency !== currency ||
      destinationAccount.currency !== currency
    ) {
      return badRequest("Both accounts must have the requested currency");
    }

    // Step 9: Validate account status
    if (
      sourceAccount.status !== "OPEN" ||
      destinationAccount.status !== "OPEN"
    ) {
      return conflict("Both accounts must be OPEN");
    }

    // Step 10: Execute debit and credit atomically
    const transactionCommand = new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: TABLES.accounts,
            Key: { accountId: sourceId },
            UpdateExpression: "SET balance = balance - :amount",
            ConditionExpression:
              "attribute_exists(accountId) AND balance >= :amount AND currency = :currency AND #status = :open",
            ExpressionAttributeNames: {
              "#status": "status",
            },
            ExpressionAttributeValues: {
              ":amount": amount,
              ":currency": currency,
              ":open": "OPEN",
            },
          },
        },
        {
          Update: {
            TableName: TABLES.accounts,
            Key: { accountId: destinationId },
            UpdateExpression: "SET balance = balance + :amount",
            ConditionExpression:
              "attribute_exists(accountId) AND currency = :currency AND #status = :open",
            ExpressionAttributeNames: {
              "#status": "status",
            },
            ExpressionAttributeValues: {
              ":amount": amount,
              ":currency": currency,
              ":open": "OPEN",
            },
          },
        },
      ],
    });

    await docClient.send(transactionCommand);

    // Step 11: Fetch updated accounts
    const [updatedSource, updatedDestination] = await Promise.all([
      docClient.send(
        new GetCommand({
          TableName: TABLES.accounts,
          Key: { accountId: sourceId },
        })
      ),
      docClient.send(
        new GetCommand({
          TableName: TABLES.accounts,
          Key: { accountId: destinationId },
        })
      ),
    ]);

    // Step 12: Return transfer result
    return ok({
      fromAccount: updatedSource.Item,
      toAccount: updatedDestination.Item,
    });

  } catch (error) {
    if (
      error.name === "TransactionCanceledException" ||
      error.name === "ConditionalCheckFailedException"
    ) {
      return conflict(
        "Transfer failed due to insufficient funds or account conditions"
      );
    }

    console.error("Error processing transfer:", error);
    return serverError();
  }
}


module.exports = {
  deposit,
  withdraw,
  transfer,
  depositProtected: protect(deposit),
  withdrawProtected: protect(withdraw),
  transferProtected: protect(transfer),
};
