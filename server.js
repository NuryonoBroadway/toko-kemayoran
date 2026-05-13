require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;
const adminToken = process.env.ADMIN_TOKEN || "tokoKemayoranJaya1234";
const bankName = process.env.BANK_NAME || "BCA";
const bankAccountNumber = process.env.BANK_ACCOUNT_NUMBER || "1234567890";
const bankAccountHolder = process.env.BANK_ACCOUNT_HOLDER || "Toko Kemayoran";
const sellerWhatsAppNumber = process.env.SELLER_WHATSAPP_NUMBER || "6281234567890";

const dataDir = path.join(__dirname, "data");
const uploadDir = path.join(__dirname, "uploads");
const productsFile = path.join(dataDir, "products.json");
const ordersFile = path.join(dataDir, "orders.json");

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(productsFile)) {
  fs.writeFileSync(productsFile, "[]");
}
if (!fs.existsSync(ordersFile)) {
  fs.writeFileSync(ordersFile, "[]");
}

const orderStreamClients = new Set();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const baseName = path
      .basename(file.originalname, ext)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    cb(null, `${Date.now()}-${baseName}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
      return;
    }
    cb(new Error("File harus berupa gambar."));
  }
});

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(uploadDir));
app.use(express.static(path.join(__dirname, "public")));

function readProducts() {
  try {
    return JSON.parse(fs.readFileSync(productsFile, "utf8"));
  } catch (_error) {
    return [];
  }
}

function writeProducts(products) {
  fs.writeFileSync(productsFile, JSON.stringify(products, null, 2));
}

function readOrders() {
  try {
    return JSON.parse(fs.readFileSync(ordersFile, "utf8"));
  } catch (_error) {
    return [];
  }
}

function writeOrders(orders) {
  fs.writeFileSync(ordersFile, JSON.stringify(orders, null, 2));
}

function getAdminTokenFromRequest(req) {
  return req.header("x-admin-token") || req.query.token;
}

function requireAdmin(req, res, next) {
  const token = getAdminTokenFromRequest(req);
  if (token !== adminToken) {
    res.status(401).json({ message: "Token admin tidak valid." });
    return;
  }
  next();
}

function sendOrderStreamEvent(client, event, payload) {
  client.write(`event: ${event}\n`);
  client.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcastOrderEvent(event, payload) {
  for (const client of orderStreamClients) {
    sendOrderStreamEvent(client, event, payload);
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/admin/verify", requireAdmin, (_req, res) => {
  res.json({ ok: true, authenticated: true });
});

app.get("/api/orders/stream", requireAdmin, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write(": connected\n\n");
  orderStreamClients.add(res);

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 30000);

  req.on("close", () => {
    clearInterval(heartbeat);
    orderStreamClients.delete(res);
  });
});

app.get("/api/payment-info", (_req, res) => {
  res.json({
    bankName,
    bankAccountNumber,
    bankAccountHolder,
    sellerWhatsAppNumber
  });
});

app.get("/api/products", (_req, res) => {
  const products = readProducts().sort((a, b) => b.createdAt - a.createdAt);
  res.json(products);
});

app.post("/api/products", requireAdmin, upload.single("image"), (req, res) => {
  const { name, description, category, variants } = req.body;
  const normalizedVariants = normalizeVariants(variants);

  if (!name || !normalizedVariants.length) {
    res.status(400).json({ message: "Nama produk dan minimal satu varian wajib valid." });
    return;
  }

  const products = readProducts();
  const product = {
    id: cryptoRandomId(),
    name: String(name).trim(),
    description: String(description || "").trim(),
    category: String(category || "Umum").trim() || "Umum",
    imageUrl: req.file ? `/uploads/${req.file.filename}` : "",
    variants: normalizedVariants,
    createdAt: Date.now()
  };

  products.push(product);
  writeProducts(products);
  res.status(201).json(product);
});

app.patch("/api/products/:id", requireAdmin, upload.single("image"), (req, res) => {
  const { name, description, category, variants } = req.body;
  const normalizedVariants = normalizeVariants(variants);

  if (!name || !normalizedVariants.length) {
    res.status(400).json({ message: "Nama produk dan minimal satu varian wajib valid." });
    return;
  }

  const products = readProducts();
  const product = products.find((item) => item.id === req.params.id);

  if (!product) {
    res.status(404).json({ message: "Produk tidak ditemukan." });
    return;
  }

  if (req.file && product.imageUrl && product.imageUrl.startsWith("/uploads/")) {
    const previousImagePath = path.join(__dirname, product.imageUrl.replace(/^\//, ""));
    if (fs.existsSync(previousImagePath)) {
      fs.unlinkSync(previousImagePath);
    }
  }

  product.name = String(name).trim();
  product.description = String(description || "").trim();
  product.category = String(category || "Umum").trim() || "Umum";
  product.variants = normalizedVariants;
  if (req.file) {
    product.imageUrl = `/uploads/${req.file.filename}`;
  }

  writeProducts(products);
  res.json(product);
});

app.post("/api/orders", upload.single("paymentProof"), (req, res) => {
  const { customerName, phone, address, notes, items, paymentMethod, senderName, transferNote } = req.body;
  const parsedItems = safeJsonParse(items);
  const normalizedPaymentMethod = String(paymentMethod || "").trim();
  const isBankTransfer = normalizedPaymentMethod === "Transfer Bank";
  const isWhatsAppOrder = normalizedPaymentMethod === "WhatsApp Penjual";

  if (
    !customerName ||
    !phone ||
    !address ||
    !normalizedPaymentMethod ||
    !Array.isArray(parsedItems) ||
    !parsedItems.length
  ) {
    res.status(400).json({ message: "Data checkout belum lengkap." });
    return;
  }

  if (!isBankTransfer && !isWhatsAppOrder) {
    res.status(400).json({ message: "Metode pembayaran tidak valid." });
    return;
  }

  if (isBankTransfer && (!senderName || !req.file)) {
    res.status(400).json({ message: "Transfer bank wajib isi nama pengirim dan bukti transfer." });
    return;
  }

  const products = readProducts();
  const normalizedItems = [];

  for (const item of parsedItems) {
    const quantity = Number(item.quantity);
    if (!item.id || Number.isNaN(quantity) || quantity <= 0) {
      res.status(400).json({ message: "Item checkout tidak valid." });
      return;
    }

    const product = products.find((entry) => entry.id === item.id);
    if (!product) {
      res.status(404).json({ message: `Produk tidak ditemukan untuk item ${item.id}.` });
      return;
    }

    const productVariant = getProductVariant(product, item.variantId);
    if (!productVariant) {
      res.status(404).json({ message: `Varian produk tidak ditemukan untuk item ${item.id}.` });
      return;
    }

    if (productVariant.stock < quantity) {
      res.status(400).json({ message: `Stok ${product.name} varian ${productVariant.label} tidak mencukupi.` });
      return;
    }

    normalizedItems.push({
      productId: product.id,
      variantId: productVariant.id,
      variantLabel: productVariant.label,
      name: product.name,
      price: productVariant.price,
      quantity,
      subtotal: productVariant.price * quantity
    });
  }

  for (const item of normalizedItems) {
    const product = products.find((entry) => entry.id === item.productId);
    const productVariant = getProductVariant(product, item.variantId);
    productVariant.stock -= item.quantity;
  }

  writeProducts(products);

  const orders = readOrders();
  const order = {
    id: cryptoRandomId(),
    customerName: String(customerName).trim(),
    phone: String(phone).trim(),
    address: String(address).trim(),
    notes: String(notes || "").trim(),
    paymentMethod: normalizedPaymentMethod,
    senderName: String(senderName || customerName).trim(),
    transferNote: String(transferNote || "").trim(),
    paymentProofUrl: req.file ? `/uploads/${req.file.filename}` : "",
    paymentStatus: isBankTransfer ? "Menunggu Verifikasi" : "Menunggu Konfirmasi",
    paidAt: null,
    items: normalizedItems,
    total: normalizedItems.reduce((sum, item) => sum + item.subtotal, 0),
    createdAt: Date.now(),
    status: "Baru"
  };

  orders.push(order);
  writeOrders(orders);
  broadcastOrderEvent("order:created", { orderId: order.id });
  res.status(201).json(order);
});

app.get("/api/orders", requireAdmin, (_req, res) => {
  const orders = readOrders().sort((a, b) => b.createdAt - a.createdAt);
  res.json(orders);
});

app.patch("/api/orders/:id/status", requireAdmin, (req, res) => {
  const { status } = req.body;
  const allowedStatuses = ["Baru", "Diproses", "Selesai"];

  if (!allowedStatuses.includes(status)) {
    res.status(400).json({ message: "Status order tidak valid." });
    return;
  }

  const orders = readOrders();
  const order = orders.find((entry) => entry.id === req.params.id);

  if (!order) {
    res.status(404).json({ message: "Order tidak ditemukan." });
    return;
  }

  const canProcessWithoutVerification =
    order.paymentMethod === "WhatsApp Penjual" && order.paymentStatus === "Menunggu Konfirmasi";

  if (status !== "Baru" && order.paymentStatus !== "Sudah Dibayar" && !canProcessWithoutVerification) {
    res.status(400).json({ message: "Pembayaran belum diverifikasi." });
    return;
  }

  order.status = status;
  writeOrders(orders);
  broadcastOrderEvent("order:updated", { orderId: order.id, type: "status" });
  res.json(order);
});

app.patch("/api/orders/:id/payment-status", requireAdmin, (req, res) => {
  const { paymentStatus } = req.body;
  const allowedStatuses = ["Menunggu Verifikasi", "Menunggu Konfirmasi", "Sudah Dibayar", "Ditolak"];

  if (!allowedStatuses.includes(paymentStatus)) {
    res.status(400).json({ message: "Status pembayaran tidak valid." });
    return;
  }

  const orders = readOrders();
  const order = orders.find((entry) => entry.id === req.params.id);

  if (!order) {
    res.status(404).json({ message: "Order tidak ditemukan." });
    return;
  }

  order.paymentStatus = paymentStatus;
  order.paidAt = paymentStatus === "Sudah Dibayar" ? Date.now() : null;
  writeOrders(orders);
  broadcastOrderEvent("order:updated", { orderId: order.id, type: "payment-status" });
  res.json(order);
});

app.delete("/api/products/:id", requireAdmin, (req, res) => {
  const products = readProducts();
  const product = products.find((item) => item.id === req.params.id);

  if (!product) {
    res.status(404).json({ message: "Produk tidak ditemukan." });
    return;
  }

  const nextProducts = products.filter((item) => item.id !== req.params.id);
  writeProducts(nextProducts);

  if (product.imageUrl) {
    const imagePath = path.join(__dirname, product.imageUrl.replace(/^\//, ""));
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
    }
  }

  res.json({ message: "Produk dihapus." });
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    res.status(400).json({ message: err.message });
    return;
  }
  if (err) {
    res.status(400).json({ message: err.message || "Terjadi kesalahan." });
    return;
  }
  res.status(500).json({ message: "Terjadi kesalahan server." });
});

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) {
    next();
    return;
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(port, () => {
  console.log(`Server jalan di http://localhost:${port}`);
});

function cryptoRandomId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function normalizeVariants(rawVariants) {
  const parsedVariants = safeJsonParse(rawVariants);
  if (!Array.isArray(parsedVariants)) {
    return [];
  }

  return parsedVariants
    .map((variant) => {
      const price = Number(variant.price);
      const stock = Number(variant.stock);
      const label = String(variant.label || "").trim();

      if (!label || Number.isNaN(price) || price <= 0 || Number.isNaN(stock) || stock < 0) {
        return null;
      }

      return {
        id: String(variant.id || cryptoRandomId()),
        label,
        price,
        stock
      };
    })
    .filter(Boolean);
}

function getProductVariant(product, variantId) {
  const variants = Array.isArray(product.variants) && product.variants.length
    ? product.variants
    : [
        {
          id: "default",
          label: "Reguler",
          price: Number(product.price || 0),
          stock: Number(product.stock || 0)
        }
      ];

  return variants.find((variant) => variant.id === variantId) || null;
}
