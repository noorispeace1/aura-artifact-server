import express, { Request, Response } from "express";
import cors from "cors";
import { MongoClient, ServerApiVersion, ObjectId } from "mongodb";
import "dotenv/config";
import nodemailer from "nodemailer";

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

if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
}

export default app;