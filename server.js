require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;
const adminToken = process.env.ADMIN_TOKEN || "tokoKemayoranJaya1234";
const bankName = process.env.BANK_NAME || "BCA";
const bankAccountNumber = process.env.BANK_ACCOUNT_NUMBER || "1234567890";
const bankAccountHolder = process.env.BANK_ACCOUNT_HOLDER || "Toko Kemayoran";
const sellerWhatsAppNumber = process.env.SELLER_WHATSAPP_NUMBER || "6281234567890";
const binderbyteApiKey = process.env.BINDERBYTE_API_KEY || "";
const binderbyteOrigin = process.env.BINDERBYTE_ORIGIN || "";
const binderbyteCouriers = String(process.env.BINDERBYTE_COURIERS || "jne,sicepat,pos,tiki,anteraja")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);
const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/+$/, "");
const supabaseServiceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const supabaseRestUrl = `${supabaseUrl}/rest/v1`;
const supabaseStorageUrl = `${supabaseUrl}/storage/v1`;
const supabaseProductImageBucket = process.env.SUPABASE_PRODUCT_IMAGE_BUCKET || "product-images";
const supabasePaymentProofBucket = process.env.SUPABASE_PAYMENT_PROOF_BUCKET || "payment-proofs";

const orderStreamClients = new Set();

const upload = multer({
  storage: multer.memoryStorage(),
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
app.use(express.static(path.join(__dirname, "public")));

const requireAdmin = asyncHandler(async (req, res, next) => {
  const token = getAdminTokenFromRequest(req);

  if (!token) {
    res.status(401).json({ message: "Token admin diperlukan." });
    return;
  }

  try {
    const sessionRows = await supabaseJson(`/sessions`, {
      searchParams: {
        select: "id,user_id,expires_at",
        id: `eq.${token}`,
        expires_at: `gt.${new Date().toISOString()}`,
        limit: "1"
      }
    });

    if (!sessionRows.length) {
      res.status(401).json({ message: "Sesi tidak valid atau telah kedaluwarsa." });
      return;
    }

    next();
  } catch (error) {
    res.status(401).json({ message: "Gagal memvalidasi sesi." });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, storage: "supabase" });
});

app.get("/api/wilayah/provinces", asyncHandler(async (_req, res) => {
  const provinces = await fetchBinderByteWilayah("provinsi");
  res.json(provinces);
}));

app.get("/api/wilayah/regencies/:provinceId", asyncHandler(async (req, res) => {
  const regencies = await fetchBinderByteWilayah("kabupaten", {
    id_provinsi: req.params.provinceId
  });
  res.json(regencies);
}));

app.get("/api/wilayah/districts/:regencyId", asyncHandler(async (req, res) => {
  const districts = await fetchBinderByteWilayah("kecamatan", {
    id_kabupaten: req.params.regencyId
  });
  res.json(districts);
}));

app.get("/api/wilayah/villages/:districtId", asyncHandler(async (req, res) => {
  const villages = await fetchBinderByteWilayah("kelurahan", {
    id_kecamatan: req.params.districtId
  });
  res.json(villages);
}));

app.get("/api/locations/search", asyncHandler(async (req, res) => {
  const search = String(req.query.search || "").trim();

  if (!binderbyteApiKey) {
    res.status(500).json({ message: "BINDERBYTE_API_KEY belum diatur." });
    return;
  }

  if (search.length < 3) {
    res.status(400).json({ message: "Masukkan minimal 3 karakter untuk mencari lokasi." });
    return;
  }

  const url = new URL("https://api.binderbyte.com/v1/locations");
  url.searchParams.set("api_key", binderbyteApiKey);
  url.searchParams.set("search", search);

  const response = await fetch(url);
  const data = await parseResponseBody(response);
  const isSuccess =
    response.ok &&
    String(data?.code || "") === "200" &&
    Array.isArray(data?.data);

  if (!isSuccess) {
    res.status(400).json({ message: data?.message || "Gagal mencari lokasi." });
    return;
  }

  res.json(data.data.map((entry) => ({
    id: String(entry.id || "").trim(),
    type: String(entry.type || "").trim(),
    label: String(entry.label || "").trim(),
    destinationQuery: buildDestinationQueryFromLocationLabel(entry.label)
  })));
}));

app.post("/api/shipping/options", asyncHandler(async (req, res) => {
  const {
    destinationRegencyName,
    destinationDistrictName,
    destinationId,
    destinationQuery,
    weightGrams,
    couriers,
    courierCode
  } = req.body || {};

  const normalizedWeightGrams = Number(weightGrams);
  const normalizedCourierCode = String(courierCode || "").trim().toLowerCase();
  const requestedCouriers = Array.isArray(couriers)
    ? couriers.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const activeCouriers = normalizedCourierCode
    ? [normalizedCourierCode]
    : requestedCouriers.length
      ? requestedCouriers
      : binderbyteCouriers;

  if (!binderbyteApiKey) {
    res.status(500).json({ message: "BINDERBYTE_API_KEY belum diatur." });
    return;
  }

  if (!binderbyteOrigin) {
    res.status(500).json({ message: "BINDERBYTE_ORIGIN belum diatur." });
    return;
  }

  if ((!destinationId && !destinationQuery && !destinationRegencyName) || Number.isNaN(normalizedWeightGrams) || normalizedWeightGrams <= 0) {
    res.status(400).json({ message: "Tujuan pengiriman dan berat pesanan wajib valid." });
    return;
  }

  if (!activeCouriers.length) {
    res.status(400).json({ message: "Belum ada ekspedisi yang dikonfigurasi." });
    return;
  }

  const destination = String(destinationId || "").trim() || String(destinationQuery || "").trim() || [destinationDistrictName, destinationRegencyName]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");

  let weightKg = Math.max(1, Math.ceil(normalizedWeightGrams / 1000));
  if (weightKg < 1) {
    weightKg = 1
  }

  const payload = new URLSearchParams({
    api_key: binderbyteApiKey,
    origin: binderbyteOrigin,
    destination,
    courier: activeCouriers.join(","),
    weight: String(weightKg)
  });

  const binderbyteResponse = await fetch("https://api.binderbyte.com/v1/cost", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: payload.toString()
  });
  const binderbyteData = await parseResponseBody(binderbyteResponse);

  if (!binderbyteResponse.ok || String(binderbyteData?.code || "") !== "200") {
    const message = binderbyteData?.message || "Gagal mengambil ongkir dari BinderByte.";
    throw new Error(message);
  }

  const options = Array.isArray(binderbyteData?.data?.results)
    ? binderbyteData.data.results.flatMap((courierEntry) => {
      const courierName = String(courierEntry.name || "").trim() || courierEntry.code;
      return Array.isArray(courierEntry.costs)
        ? courierEntry.costs.map((service) => ({
          courierCode: String(courierEntry.code || "").trim().toLowerCase(),
          courierName,
          service: String(service.service || service.type || "").trim(),
          description: String(service.description || service.name || "").trim(),
          etd: String(service.etd || service.estimated || "").trim(),
          cost: Number(service.cost || service.price || 0)
        }))
        : [];
    }).filter((entry) => entry.service && entry.cost > 0)
    : [];

  res.json({
    origin: binderbyteData.data.origin,
    destination: binderbyteData.data.destination,
    weightKg,
    weightGrams: normalizedWeightGrams,
    couriers: activeCouriers,
    options: options.sort((left, right) => left.cost - right.cost)
  });
}));

app.get("/api/admin/verify", requireAdmin, (_req, res) => {
  res.json({ ok: true, authenticated: true });
});

app.post("/api/admin/login", asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ message: "Username dan password wajib diisi." });
    return;
  }

  const token = await supabaseJson(`/rpc/login_user`, {
    method: "POST",
    body: {
      p_username: String(username).trim(),
      p_password: String(password)
    }
  });

  if (!token) {
    res.status(401).json({ message: "Username atau password salah." });
    return;
  }

  res.json({ token });
}));

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
    sellerWhatsAppNumber,
    shippingOrigin: binderbyteOrigin,
    availableCouriers: binderbyteCouriers
  });
});

app.get("/api/products", asyncHandler(async (_req, res) => {
  const products = await fetchProducts();
  res.json(products);
}));

app.post("/api/products", requireAdmin, upload.single("image"), asyncHandler(async (req, res) => {
  const { name, description, category, variants } = req.body;
  const normalizedVariants = normalizeVariants(variants);

  if (!name || !normalizedVariants.length) {
    res.status(400).json({ message: "Nama produk dan minimal satu varian wajib valid." });
    return;
  }

  let imageUrl = "";

  try {
    if (req.file) {
      imageUrl = await uploadStorageObject(supabaseProductImageBucket, req.file, "products");
    }

    const createdRows = await supabaseJson(`/products`, {
      method: "POST",
      headers: {
        Prefer: "return=representation"
      },
      body: [
        {
          id: cryptoRandomId(),
          name: String(name).trim(),
          description: String(description || "").trim(),
          category: String(category || "Umum").trim() || "Umum",
          image_url: imageUrl
        }
      ]
    });

    const productRow = createdRows[0];
    await replaceProductVariants(productRow.id, normalizedVariants);
    const product = await fetchProductById(productRow.id);
    res.status(201).json(product);
  } catch (error) {
    if (imageUrl) {
      await deleteStorageObjectByPublicUrl(imageUrl).catch(() => { });
    }
    throw error;
  }
}));

app.patch("/api/products/:id", requireAdmin, upload.single("image"), asyncHandler(async (req, res) => {
  const { name, description, category, variants } = req.body;
  const normalizedVariants = normalizeVariants(variants);

  if (!name || !normalizedVariants.length) {
    res.status(400).json({ message: "Nama produk dan minimal satu varian wajib valid." });
    return;
  }

  const existingProduct = await fetchProductById(req.params.id);
  if (!existingProduct) {
    res.status(404).json({ message: "Produk tidak ditemukan." });
    return;
  }

  let nextImageUrl = existingProduct.imageUrl || "";

  try {
    if (req.file) {
      nextImageUrl = await uploadStorageObject(supabaseProductImageBucket, req.file, "products");
    }

    await supabaseJson(`/products`, {
      method: "PATCH",
      searchParams: {
        id: `eq.${req.params.id}`
      },
      headers: {
        Prefer: "return=minimal"
      },
      body: {
        name: String(name).trim(),
        description: String(description || "").trim(),
        category: String(category || "Umum").trim() || "Umum",
        image_url: nextImageUrl
      }
    });

    await replaceProductVariants(req.params.id, normalizedVariants);

    if (req.file && existingProduct.imageUrl) {
      await deleteStorageObjectByPublicUrl(existingProduct.imageUrl).catch(() => { });
    }

    const product = await fetchProductById(req.params.id);
    res.json(product);
  } catch (error) {
    if (req.file && nextImageUrl && nextImageUrl !== existingProduct.imageUrl) {
      await deleteStorageObjectByPublicUrl(nextImageUrl).catch(() => { });
    }
    throw error;
  }
}));

app.post("/api/orders", upload.single("paymentProof"), asyncHandler(async (req, res) => {
  const {
    customerName,
    phone,
    address,
    addressDetail,
    provinceId,
    provinceName,
    regencyId,
    regencyName,
    districtId,
    districtName,
    villageId,
    villageName,
    notes,
    items,
    paymentMethod,
    senderName,
    transferNote,
    shippingCost,
    shippingCourierCode,
    shippingCourierName,
    shippingService,
    shippingServiceDescription,
    shippingEtd,
    totalWeightGrams
  } = req.body;
  const parsedItems = safeJsonParse(items);
  const normalizedPaymentMethod = String(paymentMethod || "").trim();
  const normalizedShippingCost = Number(shippingCost);
  const normalizedTotalWeightGrams = Number(totalWeightGrams);
  const isBankTransfer = normalizedPaymentMethod === "Transfer Bank";
  const isWhatsAppOrder = normalizedPaymentMethod === "WhatsApp Penjual";
  const hasShippingSelection =
    !Number.isNaN(normalizedShippingCost) &&
    normalizedShippingCost >= 0 &&
    String(shippingCourierCode || "").trim() &&
    String(shippingCourierName || "").trim() &&
    String(shippingService || "").trim();

  if (
    !customerName ||
    !phone ||
    !address ||
    !addressDetail ||
    !villageId ||
    !villageName ||
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

  if (Number.isNaN(normalizedTotalWeightGrams) || normalizedTotalWeightGrams <= 0) {
    res.status(400).json({ message: "Berat total pesanan belum valid." });
    return;
  }

  if (isBankTransfer && !hasShippingSelection) {
    res.status(400).json({ message: "Opsi pengiriman belum valid." });
    return;
  }

  let paymentProofUrl = "";

  try {
    if (req.file) {
      paymentProofUrl = await uploadStorageObject(supabasePaymentProofBucket, req.file, "payment-proofs");
    }

    const orderId = await supabaseJson(`/rpc/create_order_with_items`, {
      method: "POST",
      body: {
        payload: {
          id: cryptoRandomId(),
          customer_name: String(customerName).trim(),
          phone: String(phone).trim(),
          address: String(address).trim(),
          address_detail: String(addressDetail).trim(),
          recipient_province_id: String(provinceId).trim(),
          recipient_province_name: String(provinceName).trim(),
          recipient_regency_id: String(regencyId).trim(),
          recipient_regency_name: String(regencyName).trim(),
          recipient_district_id: String(districtId).trim(),
          recipient_district_name: String(districtName).trim(),
          recipient_village_id: String(villageId).trim(),
          recipient_village_name: String(villageName).trim(),
          notes: String(notes || "").trim(),
          payment_method: normalizedPaymentMethod,
          sender_name: String(senderName || customerName).trim(),
          transfer_note: String(transferNote || "").trim(),
          payment_proof_url: paymentProofUrl,
          payment_status: isBankTransfer ? "Menunggu Verifikasi" : "Menunggu Konfirmasi",
          shipping_cost: hasShippingSelection ? normalizedShippingCost : 0,
          shipping_courier_code: hasShippingSelection ? String(shippingCourierCode).trim().toLowerCase() : "",
          shipping_courier_name: hasShippingSelection ? String(shippingCourierName).trim() : "",
          shipping_service: hasShippingSelection ? String(shippingService).trim() : "",
          shipping_service_description: String(shippingServiceDescription || "").trim(),
          shipping_etd: hasShippingSelection ? String(shippingEtd || "").trim() : "",
          total_weight_grams: normalizedTotalWeightGrams,
          status: "Baru",
          items: parsedItems.map((item) => ({
            id: String(item.id || "").trim(),
            variantId: String(item.variantId || "").trim(),
            quantity: Number(item.quantity)
          }))
        }
      }
    });

    const order = await fetchOrderById(orderId);
    broadcastOrderEvent("order:created", { orderId });
    res.status(201).json(order);
  } catch (error) {
    if (paymentProofUrl) {
      await deleteStorageObjectByPublicUrl(paymentProofUrl).catch(() => { });
    }
    throw error;
  }
}));

app.get("/api/orders", requireAdmin, asyncHandler(async (_req, res) => {
  const orders = await fetchOrders();
  res.json(orders);
}));

app.patch("/api/orders/:id/status", requireAdmin, asyncHandler(async (req, res) => {
  const { status } = req.body;
  const allowedStatuses = ["Baru", "Diproses", "Selesai", "Ditolak"];

  if (!allowedStatuses.includes(status)) {
    res.status(400).json({ message: "Status order tidak valid." });
    return;
  }

  const order = await fetchOrderById(req.params.id);
  if (!order) {
    res.status(404).json({ message: "Order tidak ditemukan." });
    return;
  }

  const canProcessWithoutVerification =
    order.paymentMethod === "WhatsApp Penjual" && order.paymentStatus === "Menunggu Konfirmasi";

  if ((status !== "Baru" && status !== "Ditolak") && order.paymentStatus !== "Sudah Dibayar" && !canProcessWithoutVerification) {
    res.status(400).json({ message: "Pembayaran belum diverifikasi." });
    return;
  }

  await supabaseJson(`/orders`, {
    method: "PATCH",
    searchParams: {
      id: `eq.${req.params.id}`
    },
    headers: {
      Prefer: "return=minimal"
    },
    body: {
      status
    }
  });

  const updatedOrder = await fetchOrderById(req.params.id);
  broadcastOrderEvent("order:updated", { orderId: req.params.id, type: "status" });
  res.json(updatedOrder);
}));

app.patch("/api/orders/:id/payment-status", requireAdmin, asyncHandler(async (req, res) => {
  const { paymentStatus } = req.body;
  const allowedStatuses = ["Menunggu Verifikasi", "Menunggu Konfirmasi", "Sudah Dibayar", "Ditolak"];

  if (!allowedStatuses.includes(paymentStatus)) {
    res.status(400).json({ message: "Status pembayaran tidak valid." });
    return;
  }

  const order = await fetchOrderById(req.params.id);
  if (!order) {
    res.status(404).json({ message: "Order tidak ditemukan." });
    return;
  }

  await supabaseJson(`/orders`, {
    method: "PATCH",
    searchParams: {
      id: `eq.${req.params.id}`
    },
    headers: {
      Prefer: "return=minimal"
    },
    body: {
      payment_status: paymentStatus,
      paid_at: paymentStatus === "Sudah Dibayar" ? new Date().toISOString() : null
    }
  });

  const updatedOrder = await fetchOrderById(req.params.id);
  broadcastOrderEvent("order:updated", { orderId: req.params.id, type: "payment-status" });
  res.json(updatedOrder);
}));

app.delete("/api/products/:id", requireAdmin, asyncHandler(async (req, res) => {
  const product = await fetchProductById(req.params.id);
  if (!product) {
    res.status(404).json({ message: "Produk tidak ditemukan." });
    return;
  }

  await supabaseJson(`/products`, {
    method: "DELETE",
    searchParams: {
      id: `eq.${req.params.id}`
    },
    headers: {
      Prefer: "return=minimal"
    }
  });

  if (product.imageUrl) {
    await deleteStorageObjectByPublicUrl(product.imageUrl).catch(() => { });
  }

  res.json({ message: "Produk dihapus." });
}));

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

if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Server jalan di http://localhost:${port}`);
  });
}

module.exports = app;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} wajib diisi.`);
  }
  return value;
}

function getAdminTokenFromRequest(req) {
  return req.header("x-admin-token") || req.query.token;
}



function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
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

async function fetchProducts() {
  const [productRows, variantRows] = await Promise.all([
    supabaseJson(`/products`, {
      searchParams: {
        select: "*",
        order: "created_at.desc"
      }
    }),
    supabaseJson(`/product_variants`, {
      searchParams: {
        select: "*",
        order: "created_at.asc"
      }
    })
  ]);

  const variantsByProductId = groupBy(variantRows, "product_id");
  return productRows.map((row) => mapProductRow(row, variantsByProductId.get(row.id) || []));
}

async function fetchProductById(id) {
  const productRows = await supabaseJson(`/products`, {
    searchParams: {
      select: "*",
      id: `eq.${id}`,
      limit: "1"
    }
  });

  const productRow = productRows[0];
  if (!productRow) {
    return null;
  }

  const variantRows = await supabaseJson(`/product_variants`, {
    searchParams: {
      select: "*",
      product_id: `eq.${id}`,
      order: "created_at.asc"
    }
  });

  return mapProductRow(productRow, variantRows);
}

async function fetchProductVariants(productId) {
  return supabaseJson(`/product_variants`, {
    searchParams: {
      select: "*",
      product_id: `eq.${productId}`,
      order: "created_at.asc"
    }
  });
}

async function replaceProductVariants(productId, variants) {
  const existingVariants = await fetchProductVariants(productId);
  const nextVariantIds = new Set(variants.map((variant) => String(variant.id)));

  await supabaseJson(`/product_variants`, {
    method: "POST",
    searchParams: {
      on_conflict: "id"
    },
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation"
    },
    body: variants.map((variant) => ({
      id: String(variant.id),
      product_id: productId,
      label: variant.label,
      price: variant.price,
      stock: variant.stock,
      weight_grams: variant.weightGrams
    }))
  });

  for (const existingVariant of existingVariants) {
    if (!nextVariantIds.has(String(existingVariant.id))) {
      await supabaseJson(`/product_variants`, {
        method: "DELETE",
        searchParams: {
          id: `eq.${existingVariant.id}`
        },
        headers: {
          Prefer: "return=minimal"
        }
      });
    }
  }
}

async function fetchOrders() {
  const orderRows = await supabaseJson(`/orders`, {
    searchParams: {
      select: "*",
      order: "created_at.desc"
    }
  });

  if (!orderRows.length) {
    return [];
  }

  const orderItems = await supabaseJson(`/order_items`, {
    searchParams: {
      select: "*",
      order: "created_at.asc"
    }
  });

  const itemsByOrderId = groupBy(orderItems, "order_id");
  return orderRows.map((row) => mapOrderRow(row, itemsByOrderId.get(row.id) || []));
}

async function fetchOrderById(id) {
  const orderRows = await supabaseJson(`/orders`, {
    searchParams: {
      select: "*",
      id: `eq.${id}`,
      limit: "1"
    }
  });

  const orderRow = orderRows[0];
  if (!orderRow) {
    return null;
  }

  const itemRows = await supabaseJson(`/order_items`, {
    searchParams: {
      select: "*",
      order_id: `eq.${id}`,
      order: "created_at.asc"
    }
  });

  return mapOrderRow(orderRow, itemRows);
}

function mapProductRow(row, variants) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    category: row.category || "Umum",
    imageUrl: row.image_url || "",
    createdAt: row.created_at,
    variants: variants.map((variant) => ({
      id: variant.id,
      label: variant.label,
      price: Number(variant.price || 0),
      stock: Number(variant.stock || 0),
      weightGrams: Number(variant.weight_grams || 250)
    }))
  };
}

function mapOrderRow(row, items) {
  return {
    id: row.id,
    customerName: row.customer_name,
    phone: row.phone,
    address: row.address,
    addressDetail: row.address_detail || "",
    recipientProvinceId: row.recipient_province_id || "",
    recipientProvinceName: row.recipient_province_name || "",
    recipientRegencyId: row.recipient_regency_id || "",
    recipientRegencyName: row.recipient_regency_name || "",
    recipientDistrictId: row.recipient_district_id || "",
    recipientDistrictName: row.recipient_district_name || "",
    recipientVillageId: row.recipient_village_id || "",
    recipientVillageName: row.recipient_village_name || "",
    notes: row.notes || "",
    paymentMethod: row.payment_method,
    senderName: row.sender_name || "",
    transferNote: row.transfer_note || "",
    paymentProofUrl: row.payment_proof_url || "",
    paymentStatus: row.payment_status,
    paidAt: row.paid_at,
    subtotal: Number(row.subtotal || 0),
    shippingCost: Number(row.shipping_cost || 0),
    shippingCourierCode: row.shipping_courier_code || "",
    shippingCourierName: row.shipping_courier_name || "",
    shippingService: row.shipping_service || "",
    shippingServiceDescription: row.shipping_service_description || "",
    shippingEtd: row.shipping_etd || "",
    totalWeightGrams: Number(row.total_weight_grams || 0),
    total: Number(row.total || 0),
    createdAt: row.created_at,
    status: row.status,
    items: items.map((item) => ({
      id: item.id,
      productId: item.product_id,
      variantId: item.variant_id,
      variantLabel: item.variant_label,
      name: item.name,
      price: Number(item.price || 0),
      quantity: Number(item.quantity || 0),
      subtotal: Number(item.subtotal || 0)
    }))
  };
}

function groupBy(rows, key) {
  const grouped = new Map();

  for (const row of rows) {
    const groupKey = row[key];
    const current = grouped.get(groupKey) || [];
    current.push(row);
    grouped.set(groupKey, current);
  }

  return grouped;
}

async function uploadStorageObject(bucket, file, folder) {
  const extension = path.extname(file.originalname || "").toLowerCase();
  const baseName = path
    .basename(file.originalname || "file", extension)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "file";
  const objectPath = `${folder}/${Date.now()}-${baseName}${extension || inferExtension(file.mimetype)}`;

  await supabaseJson(`/object/${bucket}/${objectPath}`, {
    baseUrl: supabaseStorageUrl,
    method: "POST",
    body: file.buffer,
    headers: {
      "Content-Type": file.mimetype,
      "x-upsert": "false"
    }
  });

  return `${supabaseStorageUrl}/object/public/${bucket}/${objectPath}`;
}

async function deleteStorageObjectByPublicUrl(fileUrl) {
  const parsed = extractBucketAndObjectPath(fileUrl);
  if (!parsed) {
    return;
  }

  await supabaseJson(`/object/${parsed.bucket}/${parsed.objectPath}`, {
    baseUrl: supabaseStorageUrl,
    method: "DELETE"
  });
}

function extractBucketAndObjectPath(fileUrl) {
  if (!fileUrl || !fileUrl.startsWith(supabaseStorageUrl)) {
    return null;
  }

  const publicPrefix = `${supabaseStorageUrl}/object/public/`;
  if (!fileUrl.startsWith(publicPrefix)) {
    return null;
  }

  const relativePath = fileUrl.slice(publicPrefix.length);
  const [bucket, ...rest] = relativePath.split("/");
  if (!bucket || !rest.length) {
    return null;
  }

  return {
    bucket,
    objectPath: rest.join("/")
  };
}

async function supabaseJson(pathname, options = {}) {
  const {
    baseUrl = supabaseRestUrl,
    searchParams,
    headers = {},
    body,
    method = "GET"
  } = options;
  const url = new URL(pathname.replace(/^\//, ""), `${baseUrl}/`);

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    }
  }

  const isBinaryBody = Buffer.isBuffer(body);
  const requestHeaders = {
    apikey: supabaseServiceRoleKey,
    Authorization: `Bearer ${supabaseServiceRoleKey}`,
    ...headers
  };

  if (body !== undefined && body !== null && !isBinaryBody && !requestHeaders["Content-Type"]) {
    requestHeaders["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: body === undefined || body === null
      ? undefined
      : isBinaryBody
        ? body
        : JSON.stringify(body)
  });
  const parsedBody = await parseResponseBody(response);

  if (!response.ok) {
    const message = parsedBody && typeof parsedBody === "object"
      ? parsedBody.message || parsedBody.error_description || parsedBody.error
      : parsedBody;
    throw new Error(message || `Supabase request gagal (${response.status}).`);
  }

  return parsedBody;
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (_error) {
    return text;
  }
}

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
      const weightGrams = Number(variant.weightGrams);
      const label = String(variant.label || "").trim();

      if (
        !label ||
        Number.isNaN(price) ||
        price <= 0 ||
        Number.isNaN(stock) ||
        stock < 0 ||
        Number.isNaN(weightGrams) ||
        weightGrams <= 0
      ) {
        return null;
      }

      return {
        id: String(variant.id || cryptoRandomId()),
        label,
        price,
        stock,
        weightGrams
      };
    })
    .filter(Boolean);
}

async function fetchBinderByteWilayah(endpoint, params = {}) {
  try {
    if (!binderbyteApiKey) {
      throw new Error("BINDERBYTE_API_KEY belum diatur.");
    }

    const url = new URL(`https://api.binderbyte.com/wilayah/${endpoint}`);
    url.searchParams.set("api_key", binderbyteApiKey);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url);
    const data = await parseResponseBody(response);
    const isSuccessfulWilayahResponse =
      response.ok &&
      Array.isArray(data?.value) &&
      (
        data?.result === true ||
        String(data?.code || "") === "200"
      );

    if (!isSuccessfulWilayahResponse) {
      throw new Error(data?.message || data?.messages || `Gagal memuat data wilayah ${endpoint}.`);
    }

    return Array.isArray(data.value) ? data.value : [];
  } catch (_error) {
    return fetchFallbackWilayah(endpoint, params);
  }
}

function buildDestinationQueryFromLocationLabel(label) {
  const normalized = String(label || "")
    .replace(/\([^)]*\)/g, "")
    .trim();
  const parts = normalized
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (!parts.length) {
    return "";
  }

  if (parts.length >= 2) {
    return `${parts[Math.max(parts.length - 2, 0)]}, ${parts[parts.length - 1]}`;
  }

  return parts[0];
}

async function fetchFallbackWilayah(endpoint, params = {}) {
  const fallbackUrl = resolveFallbackWilayahUrl(endpoint, params);
  if (!fallbackUrl) {
    throw new Error(`Fallback wilayah untuk ${endpoint} tidak tersedia.`);
  }

  const response = await fetch(fallbackUrl);
  const data = await parseResponseBody(response);

  if (!response.ok || !Array.isArray(data)) {
    throw new Error(`Gagal memuat data wilayah ${endpoint}.`);
  }

  return data;
}

function resolveFallbackWilayahUrl(endpoint, params = {}) {
  const baseUrl = "https://emsifa.github.io/api-wilayah-indonesia/api";

  switch (endpoint) {
    case "povinsi":
      return `${baseUrl}/provinces.json`;
    case "kabupaten":
      return params.id_provinsi ? `${baseUrl}/regencies/${params.id_provinsi}.json` : "";
    case "kecamatan":
      return params.id_kabupaten ? `${baseUrl}/districts/${params.id_kabupaten}.json` : "";
    case "kelurahan":
      return params.id_kecamatan ? `${baseUrl}/villages/${params.id_kecamatan}.json` : "";
    default:
      return "";
  }
}

function inferExtension(mimeType) {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/svg+xml":
      return ".svg";
    default:
      return "";
  }
}
