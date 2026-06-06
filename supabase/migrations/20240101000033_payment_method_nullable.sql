-- Allow orders to be created before payment is chosen (Find Store flow:
-- order is created when bidding starts, payment selected after store pick).
ALTER TABLE public.orders ALTER COLUMN payment_method DROP NOT NULL;
