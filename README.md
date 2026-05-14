# Toko Kemayoran

Web toko sederhana dengan:

- halaman toko untuk user biasa
- halaman admin untuk upload dan hapus produk
- halaman checkout internal untuk kirim pesanan
- admin bisa melihat daftar checkout user
- fitur keranjang berbasis `localStorage`
- backend Express dengan penyimpanan data di Supabase
- upload gambar produk dan bukti transfer via Supabase Storage

## Menjalankan

```bash
npm install
npm run dev
```

App akan tersedia di:

- `http://localhost:3000/`
- `http://localhost:3000/admin.html`

Catatan:

- tombol admin tidak ditampilkan di halaman toko
- halaman admin tetap bisa diakses langsung lewat URL

## Konfigurasi environment

Project ini membaca konfigurasi dari `.env`.

Contoh:

```env
PORT=3000
ADMIN_TOKEN=admin123
BANK_NAME=BCA
BANK_ACCOUNT_NUMBER=1234567890
BANK_ACCOUNT_HOLDER=Toko Kemayoran
SELLER_WHATSAPP_NUMBER=6281234567890
BINDERBYTE_API_KEY=your-binderbyte-api-key
BINDERBYTE_ORIGIN=purworejo
BINDERBYTE_COURIERS=jne,sicepat,pos,tiki,anteraja
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_PRODUCT_IMAGE_BUCKET=product-images
SUPABASE_PAYMENT_PROOF_BUCKET=payment-proofs
```

Template tersedia di `.env.example`.

## Setup Supabase

1. Buat project Supabase.
2. Jalankan SQL di [supabase/schema.sql](/Users/AND5661/Learn/toko-kemayoran/supabase/schema.sql).
3. Buat bucket public:
   - `product-images`
   - `payment-proofs`
4. Isi `.env` dengan `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY`.
5. Isi `BINDERBYTE_API_KEY` dan `BINDERBYTE_ORIGIN` untuk fitur wilayah bertingkat dan cek ongkir.

Catatan:

- Bucket dibuat public karena UI admin saat ini membuka URL file langsung dari browser.
- Semua query database dan upload file dilakukan dari backend Express menggunakan `service role key`.
- Setelah update schema untuk berat varian dan ongkir, jalankan ulang SQL terbaru di Supabase agar kolom dan function `create_order_with_items` ikut diperbarui.
- JSON lokal `data/products.json`, `data/orders.json`, dan folder `uploads/` tidak lagi dipakai sebagai storage utama.
