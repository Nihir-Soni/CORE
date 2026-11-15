import pg from "pg";

async function test() {
  console.log("Testing single Client connection...");
  const client = new pg.Client({
    host: "127.0.0.1",
    port: 5432,
    user: "core",
    password: "core",
    database: "core",
    connectionTimeoutMillis: 3000,
  });

  try {
    await client.connect();
    console.log("CLIENT CONNECTED SUCCESS!");
    const res = await client.query("SELECT 1");
    console.log("Query:", res.rows);
    await client.end();
  } catch (e) {
    console.error("Connection Error:", e);
  }
}

test();
