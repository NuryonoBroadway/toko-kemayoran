require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs/promises");
const os = require("os");
const { execFile } = require("child_process");
const { promisify } = require("util");

const app = express();
const execFileAsync = promisify(execFile);
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
const useApiCoIdKey = process.env.USE_API_CO_ID_KEY || "ZOSOWwmrGkROCwcDQrqnENd48qT9fMtoMW6uI9CM6o6FhdbDKE";
const supabaseUrl = requireEnv("SUPABASE_URL").replace(/\/+$/, "");
const supabaseServiceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const supabaseRestUrl = `${supabaseUrl}/rest/v1`;
const supabaseStorageUrl = `${supabaseUrl}/storage/v1`;
const supabaseProductImageBucket = process.env.SUPABASE_PRODUCT_IMAGE_BUCKET || "product-images";
const supabasePaymentProofBucket = process.env.SUPABASE_PAYMENT_PROOF_BUCKET || "payment-proofs";
const receiptPdfCache = new Map();
const receiptPdfCacheTtlMs = 5 * 60 * 1000;

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

const requireAuth = (role) => asyncHandler(async (req, res, next) => {
  const token = getAdminTokenFromRequest(req);

  if (!token) {
    res.status(401).json({ message: "Login diperlukan." });
    return;
  }

  try {
    const sessionRows = await supabaseJson(`/sessions`, {
      searchParams: {
        select: "id,user_id,expires_at,users(id,username,role)",
        id: `eq.${token}`,
        expires_at: `gt.${new Date().toISOString()}`,
        limit: "1"
      }
    });

    if (!sessionRows.length || !sessionRows[0].users) {
      res.status(401).json({ message: "Sesi tidak valid atau telah kedaluwarsa." });
      return;
    }

    const session = sessionRows[0];
    const user = session.users;

    // Admin can access everything, others must match the required role
    if (role && user.role !== role && user.role !== 'admin') {
      res.status(403).json({ message: "Anda tidak memiliki akses ke fitur ini." });
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: "Gagal memvalidasi sesi." });
  }
});

const requireAdmin = requireAuth('admin');
const requireAffiliate = requireAuth('affiliate');

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

  if (!useApiCoIdKey) {
    res.status(500).json({ message: "USE_API_CO_ID_KEY belum diatur." });
    return;
  }

  if (search.length < 3) {
    res.status(400).json({ message: "Masukkan minimal 3 karakter untuk mencari lokasi." });
    return;
  }

  const url = new URL("https://use.api.co.id/regional/indonesia/villages");
  url.searchParams.set("name", search);
  url.searchParams.set("page", "1");

  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "x-api-co-id": useApiCoIdKey
    }
  });
  const data = await parseResponseBody(response);
  const isSuccess = response.ok && data?.is_success === true && Array.isArray(data?.data);

  if (!isSuccess) {
    res.status(400).json({ message: data?.message || "Gagal mencari lokasi." });
    return;
  }

  res.json(data.data.map((entry) => {
    const label = [entry.name, entry.district, entry.regency, entry.province]
      .map(v => String(v || "").trim())
      .filter(Boolean)
      .join(", ");

    return {
      id: String(entry.code || "").trim(),
      type: "village",
      label: label,
      destinationQuery: `${entry.district}, ${entry.regency}`
    };
  }));
}));

app.post("/api/shipping/options", asyncHandler(async (req, res) => {
  const {
    destinationId,
    weightGrams
  } = req.body || {};

  const normalizedWeightGrams = Number(weightGrams);

  if (!useApiCoIdKey) {
    res.status(500).json({ message: "USE_API_CO_ID_KEY belum diatur." });
    return;
  }

  // Gunakan origin dari env (biasanya BINDERBYTE_ORIGIN atau tambahkan baru)
  const originRaw = process.env.BINDERBYTE_ORIGIN || "";
  const originCode = originRaw.replace("village_", "").replace(/\./g, "").trim();

  if (!originCode) {
    res.status(500).json({ message: "Origin pengiriman belum dikonfigurasi (SHIPPING_ORIGIN_CODE)." });
    return;
  }

  const destinationCode = String(destinationId || "").trim();
  if (!destinationCode || Number.isNaN(normalizedWeightGrams) || normalizedWeightGrams <= 0) {
    res.status(400).json({ message: "Tujuan pengiriman dan berat pesanan wajib valid." });
    return;
  }

  let weightKg = Math.max(1, Math.ceil(normalizedWeightGrams / 1000));

  const url = new URL("https://use.api.co.id/expedition/shipping-cost");
  url.searchParams.set("origin_village_code", originCode);
  url.searchParams.set("destination_village_code", destinationCode);
  url.searchParams.set("weight", String(weightKg));

  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "x-api-co-id": useApiCoIdKey
    }
  });
  const data = await parseResponseBody(response);

  if (!response.ok || data?.is_success !== true) {
    const message = data?.message || "Gagal mengambil ongkir.";
    res.status(400).json({ message });
    return;
  }

  const results = data.data?.couriers || [];
  const options = results.map((item) => ({
    courierCode: String(item.courier_code || "").trim().toLowerCase(),
    courierName: String(item.courier_name || "").trim(),
    service: String(item.courier_name || "").trim(),
    description: "",
    etd: String(item.estimation || "").trim(),
    cost: Number(item.price || 0)
  })).filter(opt => opt.cost > 0);

  const filteredOptions = options.filter(opt =>
    binderbyteCouriers.some(c => opt.courierCode.toLowerCase() == c.toLowerCase())
  );

  res.json({
    origin: originCode,
    destination: destinationCode,
    weightKg,
    weightGrams: normalizedWeightGrams,
    options: filteredOptions.sort((left, right) => left.cost - right.cost)
  });
}));

app.get("/api/auth/me", requireAuth(), (req, res) => {
  res.json({ ok: true, user: req.user });
});

app.post("/api/auth/login", asyncHandler(async (req, res) => {
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

  // Fetch role
  const sessionRows = await supabaseJson(`/sessions`, {
    searchParams: {
      select: "users(role)",
      id: `eq.${token}`,
      limit: "1"
    }
  });

  const role = sessionRows[0]?.users?.role || 'affiliate';

  res.json({ token, role });
}));

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
          affiliate_code: req.body.affiliateCode ? String(req.body.affiliateCode).trim() : null,
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

app.get("/api/orders/:id/receipt", requireAdmin, asyncHandler(async (req, res) => {
  const order = await fetchOrderById(req.params.id);
  if (!order) {
    res.status(404).send("Order tidak ditemukan.");
    return;
  }

  if (!(order.status === "Diproses" || order.status === "Selesai")) {
    res.status(400).send("Struk hanya tersedia untuk order Diproses atau Selesai.");
    return;
  }

  res.type("html").send(buildReceiptHtmlDocument(order));
}));

app.get("/api/orders/:id/receipt-links", requireAdmin, asyncHandler(async (req, res) => {
  const order = await fetchOrderById(req.params.id);
  if (!order) {
    res.status(404).json({ message: "Order tidak ditemukan." });
    return;
  }

  // Karena di Vercel/Serverless sulit menjalankan Chrome untuk PDF, 
  // kita arahkan unduhan ke versi HTML yang memicu print otomatis.
  res.json({
    viewUrl: `/api/orders/${order.id}/receipt`,
    downloadUrl: `/api/orders/${order.id}/receipt?print=true`
  });
}));

app.get("/api/orders/:id/receipt.pdf", requireAdmin, asyncHandler(async (req, res) => {
  // Fallback jika ada yang mengakses langsung .pdf
  res.redirect(`/api/orders/${req.params.id}/receipt?print=true`);
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

  // Handle Affiliate Commission
  if (status === "Selesai" && order.status !== "Selesai" && order.affiliate_code) {
    try {
      const affiliateRows = await supabaseJson(`/affiliates`, {
        searchParams: { code: `eq.${order.affiliate_code}`, limit: "1" }
      });

      if (affiliateRows.length) {
        const affiliate = affiliateRows[0];
        const commission = Math.round((order.total || 0) * (Number(affiliate.commission_rate || 5) / 100));

        await supabaseJson(`/affiliates`, {
          method: "PATCH",
          searchParams: { id: `eq.${affiliate.id}` },
          body: {
            total_earned: Number(affiliate.total_earned || 0) + commission,
            total_orders: Number(affiliate.total_orders || 0) + 1
          }
        });
      }
    } catch (err) {
      console.error("Gagal update komisi affiliate:", err);
    }
  }

  const updatedOrder = await fetchOrderById(req.params.id);
  broadcastOrderEvent("order:updated", { orderId: req.params.id, type: "status" });
  res.json(updatedOrder);
}));

app.get("/api/affiliates", requireAdmin, asyncHandler(async (_req, res) => {
  const affiliates = await supabaseJson(`/affiliates`, {
    searchParams: {
      select: "*,users(username)",
      order: "created_at.desc"
    }
  });
  res.json(affiliates);
}));

app.get("/api/affiliate/me", requireAffiliate, asyncHandler(async (req, res) => {
  const affiliateRows = await supabaseJson(`/affiliates`, {
    searchParams: {
      select: "*",
      user_id: `eq.${req.user.id}`,
      order: "created_at.desc"
    }
  });

  res.json({
    user: req.user,
    affiliates: affiliateRows
  });
}));

app.get("/api/affiliate/orders", requireAffiliate, asyncHandler(async (req, res) => {
  // 1. Get all codes for this user
  const affiliateRows = await supabaseJson(`/affiliates`, {
    searchParams: {
      select: "code,commission_rate",
      user_id: `eq.${req.user.id}`
    }
  });

  if (!affiliateRows.length) {
    return res.json([]);
  }

  const codes = affiliateRows.map(a => a.code);
  const codeFilter = `in.("${codes.join('","')}")`;

  // 2. Fetch orders with those codes
  const orders = await supabaseJson(`/orders`, {
    searchParams: {
      select: "id,customer_name,total,status,created_at,affiliate_code",
      affiliate_code: codeFilter,
      order: "created_at.desc"
    }
  });

  // 3. Map orders to include commission calculation for current display
  const ordersWithCommission = orders.map(order => {
    const affiliate = affiliateRows.find(a => a.code === order.affiliate_code);
    const rate = affiliate ? Number(affiliate.commission_rate || 0) : 0;
    const commission = Math.round((order.total || 0) * (rate / 100));
    
    return {
      ...order,
      estimatedCommission: commission
    };
  });

  res.json(ordersWithCommission);
}));

app.post("/api/affiliates", requireAdmin, asyncHandler(async (req, res) => {
  const { code, name, username, commission_rate, password } = req.body;
  const targetUsername = String(username || code).trim().toLowerCase();

  if (!code || !name) {
    res.status(400).json({ message: "Kode dan nama diperlukan." });
    return;
  }

  try {
    let userId;

    // 1. Check if user already exists
    const existingUser = await supabaseJson(`/users`, {
      searchParams: {
        username: `eq.${targetUsername}`,
        limit: "1"
      }
    });

    if (existingUser.length > 0) {
      userId = existingUser[0].id;
    } else {
      // 2. Register new user if doesn't exist
      if (!password) {
        res.status(400).json({ message: "Password diperlukan untuk pendaftaran user baru." });
        return;
      }

      userId = await supabaseJson(`/rpc/register_user`, {
        method: "POST",
        body: {
          p_username: targetUsername,
          p_password: String(password),
          p_role: 'affiliate'
        }
      });
    }

    if (!userId) throw new Error("Gagal mengidentifikasi atau mendaftarkan user.");

    // 3. Create Affiliate entry linked to userId
    const result = await supabaseJson(`/affiliates`, {
      method: "POST",
      headers: {
        Prefer: "return=representation"
      },
      body: {
        user_id: userId,
        code: String(code).trim(),
        name: String(name).trim(),
        commission_rate: Number(commission_rate) || 5.00
      }
    });
    res.status(201).json(result[0]);
  } catch (error) {
    res.status(400).json({ message: error.message || "Gagal membuat affiliate." });
  }
}));

app.delete("/api/affiliates/:id", requireAdmin, asyncHandler(async (req, res) => {
  await supabaseJson(`/affiliates`, {
    method: "DELETE",
    searchParams: {
      id: `eq.${req.params.id}`
    }
  });
  res.status(204).end();
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
    affiliate_code: row.affiliate_code || null,
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

function buildReceiptHtmlDocument(order) {
  const subtotal = Number(order.subtotal || 0) || sumOrderItems(order.items);
  const shippingCost = Number(order.shippingCost || 0);
  const itemsHtml = order.items
    .map(
      (item) => `
        <tr>
          <td>
            <strong>${escapeHtml(item.name)}</strong>
            <div class="receipt-item-meta">${escapeHtml(item.variantLabel || "Reguler")} • Qty ${item.quantity}</div>
          </td>
          <td class="align-right">${formatCurrencyForReceipt(item.price)}</td>
          <td class="align-right">${item.quantity}</td>
          <td class="align-right">${formatCurrencyForReceipt(item.subtotal)}</td>
        </tr>
      `
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Struk ${escapeHtml(order.id)}</title>
  <style>
    :root {
      color-scheme: light;
      --text: #17130f;
      --muted: #6c645b;
      --line: #e7ded2;
      --surface: #fffdf9;
      --surface-soft: #f8f4ee;
      --accent: #0d6b4d;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f4efe7;
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .receipt-shell {
      max-width: 880px;
      margin: 0;
      padding: 0;
    }
    .receipt-card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 0px;
      overflow: hidden;
      box-shadow: 0 24px 60px rgba(22, 18, 12, 0.08);
    }
    .receipt-head {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      padding: 28px 28px 20px;
      border-bottom: 1px solid var(--line);
      background: linear-gradient(180deg, #fffefb, #fbf8f2);
    }
    .receipt-head h1 {
      margin: 8px 0 0;
      font-size: 34px;
      line-height: 1.05;
    }
    .eyebrow {
      margin: 0;
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .receipt-actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      align-items: start;
      justify-content: end;
    }
    .receipt-actions button {
      border: 1px solid var(--line);
      background: white;
      color: var(--text);
      border-radius: 999px;
      padding: 12px 16px;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    .receipt-body {
      display: grid;
      gap: 24px;
      padding: 28px;
    }
    .receipt-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }
    .receipt-block {
      padding: 18px;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: var(--surface-soft);
    }
    .receipt-block h2 {
      margin: 0 0 10px;
      font-size: 14px;
    }
    .receipt-block p {
      margin: 0;
      color: var(--muted);
      line-height: 1.55;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      padding: 14px 0;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }
    th {
      font-size: 13px;
      color: var(--muted);
      font-weight: 600;
    }
    .align-right { text-align: right; }
    .receipt-item-meta {
      margin-top: 4px;
      color: var(--muted);
      font-size: 13px;
    }
    .receipt-total-box {
      margin-left: auto;
      width: min(100%, 320px);
      display: grid;
      gap: 10px;
      padding: 18px;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: linear-gradient(180deg, #fffefb, #f8f4ee);
    }
    .receipt-total-row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
    }
    .receipt-total-row strong {
      font-size: 18px;
    }
    .receipt-footnote {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.6;
    }
    @page {
      size: A4;
      margin: 16mm;
    }
    @media print {
      body {
        background: white;
      }
      .receipt-shell {
        max-width: none;
        margin: 0;
        padding: 0;
      }
      .receipt-card {
        border: 0;
        box-shadow: none;
        border-radius: 0;
      }
      .receipt-actions {
        display: none;
      }
      .receipt-body {
        display: block;
        padding: 20px 0 0;
      }
      .receipt-grid {
        display: block;
      }
      .receipt-block,
      .receipt-total-box,
      section,
      table {
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .receipt-block {
        margin-bottom: 16px;
      }
      .receipt-total-box {
        width: 100%;
        margin: 20px 0;
      }
      table {
        margin-top: 8px;
      }
      tr, td, th {
        break-inside: avoid;
        page-break-inside: avoid;
      }
    }
    @media (max-width: 720px) {
      .receipt-head,
      .receipt-grid {
        grid-template-columns: 1fr;
        flex-direction: column;
      }
      .receipt-head h1 {
        font-size: 28px;
      }
      .receipt-body {
        padding: 20px;
      }
    }
  </style>
</head>
<body>
  <div class="receipt-shell">
    <article class="receipt-card">
      <header class="receipt-head">
        <div>
          <p class="eyebrow">Toko Kemayoran</p>
          <h1>Struk Pesanan</h1>
        </div>
        <div class="receipt-actions">
          <button type="button" onclick="window.print()">Download / Print</button>
        </div>
      </header>
      <div class="receipt-body">
        <div class="receipt-grid">
          <section class="receipt-block">
            <h2>Informasi Order</h2>
            <p>ID Order: ${escapeHtml(order.id)}<br />Tanggal: ${escapeHtml(formatDateForReceipt(order.createdAt))}<br />Status: ${escapeHtml(order.status)}<br />Pembayaran: ${escapeHtml(order.paymentStatus || "-")}</p>
          </section>
          <section class="receipt-block">
            <h2>Penerima</h2>
            <p>${escapeHtml(order.customerName)}<br />${escapeHtml(order.phone)}<br />${escapeHtml(order.address)}</p>
          </section>
        </div>

        <section>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th class="align-right">Harga</th>
                <th class="align-right">Qty</th>
                <th class="align-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
        </section>

        <div class="receipt-total-box">
          <div class="receipt-total-row">
            <span>Subtotal Produk</span>
            <span>${formatCurrencyForReceipt(subtotal)}</span>
          </div>
          <div class="receipt-total-row">
            <span>Ongkir</span>
            <span>${shippingCost > 0 ? formatCurrencyForReceipt(shippingCost) : "Dikonfirmasi penjual"}</span>
          </div>
          <div class="receipt-total-row">
            <strong>Total</strong>
            <strong>${formatCurrencyForReceipt(order.total || 0)}</strong>
          </div>
        </div>

        <div class="receipt-grid">
          <section class="receipt-block">
            <h2>Pengiriman</h2>
            <p>${escapeHtml(formatShippingLabelForReceipt(order))}<br />Estimasi: ${escapeHtml(order.shippingEtd || "-")}<br />Total Berat: ${escapeHtml(formatWeightForReceipt(order.totalWeightGrams || 0))}</p>
          </section>
          <section class="receipt-block">
            <h2>Catatan</h2>
            <p>${escapeHtml(order.notes || "Tidak ada catatan tambahan.")}</p>
          </section>
        </div>

        <p class="receipt-footnote">Struk ini dibuat oleh Toko Kemayoran.</p>
      </div>
    </article>
  </div>
  <script>
    if (window.location.search.includes("print=true")) {
      window.onload = () => {
        window.print();
        // Opsional: Tutup tab setelah print selesai/dibatalkan (beberapa browser memblokir ini)
        // window.onafterprint = () => window.close();
      };
    }
  </script>
</body>
</html>`;
}

async function buildReceiptPdf(order) {
  // Fungsi ini dinonaktifkan karena keterbatasan environment Vercel (No Chrome)
  // Sebagai gantinya kita menggunakan window.print() di sisi client.
  throw new Error("PDF generation is handled via client-side printing.");
}

function sanitizeFilename(value) {
  return String(value || "receipt").replace(/[^a-zA-Z0-9-_]+/g, "-");
}

function formatCurrencyForReceipt(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatWeightForReceipt(value) {
  const grams = Number(value || 0);
  if (!grams) {
    return "0 g";
  }

  if (grams >= 1000 && grams % 1000 === 0) {
    return `${grams / 1000} kg`;
  }

  return `${grams} g`;
}

function formatDateForReceipt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
    timeStyle: "short"
  }).format(date);
}

function formatShippingLabelForReceipt(order) {
  const segments = [order.shippingCourierName, order.shippingService].map((value) => String(value || "").trim()).filter(Boolean);
  if (segments.length) {
    return segments.join(" ");
  }

  return "Diskusi dengan Penjual";
}

function sumOrderItems(items) {
  return Array.isArray(items)
    ? items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0)
    : 0;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getReceiptCacheKey(order) {
  return JSON.stringify({
    id: order.id,
    status: order.status,
    paymentStatus: order.paymentStatus,
    total: order.total,
    subtotal: order.subtotal,
    shippingCost: order.shippingCost,
    shippingCourierName: order.shippingCourierName,
    shippingService: order.shippingService,
    shippingEtd: order.shippingEtd,
    totalWeightGrams: order.totalWeightGrams,
    notes: order.notes,
    customerName: order.customerName,
    phone: order.phone,
    address: order.address,
    items: (order.items || []).map((item) => ({
      id: item.id,
      name: item.name,
      variantLabel: item.variantLabel,
      price: item.price,
      quantity: item.quantity,
      subtotal: item.subtotal
    }))
  });
}

function trimReceiptPdfCache() {
  const now = Date.now();
  for (const [key, entry] of receiptPdfCache.entries()) {
    if ((now - entry.createdAt) >= receiptPdfCacheTtlMs) {
      receiptPdfCache.delete(key);
    }
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
    case "provinsi":
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
