-- Adds the express platform fee transaction type used in Stage 4 express
-- delivery fee split. Must be in a separate migration from the
-- handle_order_delivered rewrite: Postgres cannot use a newly-added enum value
-- in the same transaction that added it.

ALTER TYPE public.transaction_type ADD VALUE IF NOT EXISTS 'express_platform_fee';
