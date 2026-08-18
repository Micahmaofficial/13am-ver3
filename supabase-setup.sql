-- 13AM 网站数据库初始化脚本
-- 在 Supabase Dashboard → SQL Editor 中执行

-- ========== 购物车表 ==========
CREATE TABLE IF NOT EXISTS public.cart (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  size TEXT,
  qty INT NOT NULL DEFAULT 1 CHECK (qty >= 1),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, product_id, size)
);

-- 购物车 RLS 策略：用户只能访问自己的购物车
ALTER TABLE public.cart ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cart_select_own"
  ON public.cart FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "cart_insert_own"
  ON public.cart FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "cart_update_own"
  ON public.cart FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "cart_delete_own"
  ON public.cart FOR DELETE
  USING (auth.uid() = user_id);

-- ========== 订单表 ==========
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  items JSONB NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  shipping_info JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 订单 RLS：用户只能访问自己的订单
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "orders_select_own"
  ON public.orders FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "orders_insert_own"
  ON public.orders FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ========== 收藏夹表 ==========
CREATE TABLE IF NOT EXISTS public.favorites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, product_id)
);

ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "favorites_select_own"
  ON public.favorites FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "favorites_insert_own"
  ON public.favorites FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "favorites_delete_own"
  ON public.favorites FOR DELETE
  USING (auth.uid() = user_id);
