
"use strict";

require("../src/lib/load-env");

const {
    DynamoDBClient,
    CreateTableCommand,
    DescribeTableCommand,
} = require("@aws-sdk/client-dynamodb");

const client = new DynamoDBClient({
    region: process.env.AWS_REGION || "us-east-1",
    endpoint: process.env.DYNAMODB_ENDPOINT || "http://localhost:8000",
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "local",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "local",
    },
});

const tableName = process.env.USERS_TABLE || "Users";

async function main() {
    try {
        await client.send(new DescribeTableCommand({ TableName: tableName }));
        console.log(`${tableName} table already exists.`);
        return;
    } catch (error) {
        if (error.name !== "ResourceNotFoundException") throw error;
    }

    await client.send(
        new CreateTableCommand({
            TableName: tableName,
            AttributeDefinitions: [
                { AttributeName: "username", AttributeType: "S" },
            ],
            KeySchema: [
                { AttributeName: "username", KeyType: "HASH" },
            ],
            BillingMode: "PAY_PER_REQUEST",
        })
    );

    console.log(`${tableName} table created successfully.`);
}

main().catch((error) => {
    console.error("Users table setup failed:", error);
    process.exit(1);
});
