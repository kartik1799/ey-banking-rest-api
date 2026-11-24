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
  PutCommand,
  GetCommand,
} = require("@aws-sdk/lib-dynamodb");

const { v4: uuidv4 } = require("uuid");

/**
 * POST /customers
 *
 * TODO: Create a customer in DynamoDB.
 * - Validate fullName and email (see openapi/openapi.yaml)
 * - Generate a customerId
 * - Persist to Customers table
 * - Return 201 with the Customer object
 */

async function create(event) {
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

    // Step 2: Extract fields
    const { fullName, email } = parsed.data;

    // Step 3: Validate fullName
    if (
      typeof fullName !== "string" ||
      fullName.trim().length === 0
    ) {
      return badRequest("fullName is required");
    }

    // Step 4: Validate email
    if (
      typeof email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
    ) {
      return badRequest("A valid email is required");
    }

    // Step 5: Create customer object
    const customer = {
      customerId: uuidv4(),
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    };

    // Step 6: Save customer in DynamoDB
    const command = new PutCommand({
      TableName: TABLES.customers,
      Item: customer,
      ConditionExpression: "attribute_not_exists(customerId)",
    });

    await docClient.send(command);

    // Step 7: Return success response
    return created(customer);

  } catch (error) {
    console.error("Error creating customer:", error);
    return serverError();
  }
}


/**
 * GET /customers/{customerId}
 *
 * TODO: Load a customer by id from DynamoDB.
 * - Read customerId from event.pathParameters
 * - Return 200 with Customer, or 404 if missing
 */

async function get(event) {
  try {
    // Step 1: Extract customerId from URL
    const rawCustomerId = event.pathParameters?.customerId;

    // Step 2: Validate customerId
    if (
      typeof rawCustomerId !== "string" ||
      rawCustomerId.trim().length === 0
    ) {
      return badRequest("customerId is required");
    }

    const customerId = rawCustomerId.trim();

    // Step 3: Prepare DynamoDB query
    const command = new GetCommand({
      TableName: TABLES.customers,
      Key: {
        customerId: customerId,
      },
    });

    // Step 4: Fetch customer from DynamoDB
    const result = await docClient.send(command);

    // Step 5: Handle customer not found
    if (!result.Item) {
      return notFound(`Customer ${customerId} not found`);
    }

    // Step 6: Return customer
    return ok(result.Item);

  } catch (error) {
    console.error("Error fetching customer:", error);
    return serverError();
  }
}


module.exports = {
  create,
  get,
  getProtected: protect(get),
};
