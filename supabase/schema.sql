create table if not exists public.products (
  id text primary key,
  name text not null,
  description text not null default '',
  category text not null default 'Umum',
  image_url text not null default '',
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.product_variants (
  id text primary key,
  product_id text not null references public.products(id) on delete cascade,
  label text not null,
  price bigint not null check (price > 0),
  stock integer not null check (stock >= 0),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists product_variants_product_id_idx on public.product_variants(product_id);

create table if not exists public.orders (
  id text primary key,
  customer_name text not null,
  phone text not null,
  address text not null,
  notes text not null default '',
  payment_method text not null check (payment_method in ('Transfer Bank', 'WhatsApp Penjual')),
  sender_name text not null default '',
  transfer_note text not null default '',
  payment_proof_url text not null default '',
  payment_status text not null check (payment_status in ('Menunggu Verifikasi', 'Menunggu Konfirmasi', 'Sudah Dibayar', 'Ditolak')),
  paid_at timestamptz null,
  total bigint not null default 0,
  status text not null check (status in ('Baru', 'Diproses', 'Selesai')),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists orders_created_at_idx on public.orders(created_at desc);

create table if not exists public.order_items (
  id bigserial primary key,
  order_id text not null references public.orders(id) on delete cascade,
  product_id text not null,
  variant_id text not null,
  variant_label text not null,
  name text not null,
  price bigint not null check (price > 0),
  quantity integer not null check (quantity > 0),
  subtotal bigint not null check (subtotal > 0),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists order_items_order_id_idx on public.order_items(order_id);

create or replace function public.create_order_with_items(payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  current_product record;
  next_order_id text;
  next_total bigint := 0;
  next_quantity integer;
begin
  next_order_id := coalesce(payload->>'id', concat(
    floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text,
    '-',
    substr(md5(random()::text || clock_timestamp()::text), 1, 8)
  ));

  if jsonb_typeof(payload->'items') <> 'array' or jsonb_array_length(payload->'items') = 0 then
    raise exception 'Item checkout tidak valid.';
  end if;

  insert into public.orders (
    id,
    customer_name,
    phone,
    address,
    notes,
    payment_method,
    sender_name,
    transfer_note,
    payment_proof_url,
    payment_status,
    status
  )
  values (
    next_order_id,
    coalesce(payload->>'customer_name', ''),
    coalesce(payload->>'phone', ''),
    coalesce(payload->>'address', ''),
    coalesce(payload->>'notes', ''),
    coalesce(payload->>'payment_method', ''),
    coalesce(payload->>'sender_name', ''),
    coalesce(payload->>'transfer_note', ''),
    coalesce(payload->>'payment_proof_url', ''),
    coalesce(payload->>'payment_status', ''),
    coalesce(payload->>'status', 'Baru')
  );

  for item in
    select value
    from jsonb_array_elements(payload->'items')
  loop
    next_quantity := coalesce((item->>'quantity')::integer, 0);
    if next_quantity <= 0 then
      raise exception 'Item checkout tidak valid.';
    end if;

    select
      p.id as product_id,
      p.name as product_name,
      pv.id as variant_id,
      pv.label as variant_label,
      pv.price as variant_price,
      pv.stock as variant_stock
    into current_product
    from public.products p
    join public.product_variants pv on pv.product_id = p.id
    where p.id = item->>'id'
      and pv.id = item->>'variantId'
    for update of pv;

    if not found then
      raise exception 'Produk atau varian tidak ditemukan.';
    end if;

    if current_product.variant_stock < next_quantity then
      raise exception 'Stok % varian % tidak mencukupi.', current_product.product_name, current_product.variant_label;
    end if;

    update public.product_variants
    set stock = stock - next_quantity
    where id = current_product.variant_id;

    insert into public.order_items (
      order_id,
      product_id,
      variant_id,
      variant_label,
      name,
      price,
      quantity,
      subtotal
    )
    values (
      next_order_id,
      current_product.product_id,
      current_product.variant_id,
      current_product.variant_label,
      current_product.product_name,
      current_product.variant_price,
      next_quantity,
      current_product.variant_price * next_quantity
    );

    next_total := next_total + (current_product.variant_price * next_quantity);
  end loop;

  update public.orders
  set total = next_total
  where id = next_order_id;

  return next_order_id;
end;
$$;
