const { MongoClient } = require("mongodb");
require("dotenv").config();

async function checkUser() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db("aura_artifact");
  
  const user = await db.collection("user").findOne({ email: "nflow@gmail.com" });
  console.log("nflow@gmail.com User in 'user' collection:", user ? "EXISTS" : "NOT FOUND");
  
  const allUsers = await db.collection("user").find({}).toArray();
  console.log("All registered emails:", allUsers.map(u => u.email));
  
  const account = await db.collection("account").find({}).toArray();
  console.log("All better-auth accounts:", account.length);
  
  await client.close();
}

checkUser().catch(console.error);
