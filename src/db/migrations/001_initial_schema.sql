-- Phase 1: Core Database Schema Migration
-- Normalization, Constraints, Decimal-safe numerical types, Audit capabilities

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('super_admin', 'business_owner')),
  phone VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deactivated')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles_permissions (
  id SERIAL PRIMARY KEY,
  role VARCHAR(50) NOT NULL,
  permission VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(role, permission)
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  sku VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  description TEXT,
  condition VARCHAR(100) DEFAULT 'New',
  location VARCHAR(100),
  supplier VARCHAR(255),
  purchase_date DATE,
  purchase_cost_per_unit NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  quantity_purchased INTEGER NOT NULL DEFAULT 0,
  quantity_available INTEGER NOT NULL DEFAULT 0,
  min_selling_price NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  max_selling_price NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  status VARCHAR(50) NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Available', 'Partially Sold', 'Sold Out', 'Archived')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_media (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  media_type VARCHAR(20) NOT NULL CHECK (media_type IN ('image', 'video')),
  file_url TEXT NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_size BIGINT NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  movement_type VARCHAR(50) NOT NULL CHECK (movement_type IN ('purchase_in', 'sale_out', 'sale_return_in', 'adjustment_add', 'adjustment_subtract', 'damage_loss')),
  quantity INTEGER NOT NULL,
  unit_cost NUMERIC(15, 2) NOT NULL,
  reference_type VARCHAR(50),
  reference_id INTEGER,
  notes TEXT,
  recorded_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_purchases (
  id SERIAL PRIMARY KEY,
  purchase_order_number VARCHAR(100) UNIQUE,
  supplier_name VARCHAR(255),
  purchase_date DATE NOT NULL,
  total_cost NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  status VARCHAR(50) NOT NULL DEFAULT 'completed',
  notes TEXT,
  recorded_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id SERIAL PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES stock_purchases(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  unit_cost NUMERIC(15, 2) NOT NULL,
  total_cost NUMERIC(15, 2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY,
  sale_invoice_number VARCHAR(100) UNIQUE,
  sale_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_revenue NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  total_cost_of_goods NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  total_direct_expenses NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  net_profit NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
  payment_method VARCHAR(50) NOT NULL DEFAULT 'cash',
  payment_status VARCHAR(50) NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid', 'pending', 'cancelled', 'refunded')),
  customer_reference VARCHAR(255),
  price_override_approved BOOLEAN DEFAULT FALSE,
  price_override_reason TEXT,
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  status VARCHAR(50) NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'returned')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sale_items (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  unit_purchase_cost NUMERIC(15, 2) NOT NULL,
  unit_selling_price NUMERIC(15, 2) NOT NULL,
  subtotal_revenue NUMERIC(15, 2) NOT NULL,
  subtotal_cogs NUMERIC(15, 2) NOT NULL,
  subtotal_profit NUMERIC(15, 2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  expense_code VARCHAR(100) UNIQUE,
  category VARCHAR(100) NOT NULL,
  amount NUMERIC(15, 2) NOT NULL,
  expense_date DATE NOT NULL,
  description TEXT,
  sale_id INTEGER REFERENCES sales(id),
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS owner_investments (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  amount NUMERIC(15, 2) NOT NULL,
  investment_date DATE NOT NULL,
  investment_type VARCHAR(50) DEFAULT 'initial' CHECK (investment_type IN ('initial', 'additional', 'working_capital')),
  notes TEXT,
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profit_allocation_rules (
  id SERIAL PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  rule_name VARCHAR(100) NOT NULL,
  reinvestment_percentage NUMERIC(5, 2) NOT NULL DEFAULT 34.00,
  deduct_reinvestment_before_distribution BOOLEAN NOT NULL DEFAULT FALSE,
  effective_from DATE NOT NULL,
  notes TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profit_allocation_rule_owners (
  id SERIAL PRIMARY KEY,
  rule_id INTEGER NOT NULL REFERENCES profit_allocation_rules(id) ON DELETE CASCADE,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  percentage NUMERIC(5, 2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(rule_id, owner_id)
);

CREATE TABLE IF NOT EXISTS profit_allocations (
  id SERIAL PRIMARY KEY,
  sale_id INTEGER REFERENCES sales(id),
  period_month VARCHAR(7),
  owner_id INTEGER REFERENCES users(id),
  allocated_amount NUMERIC(15, 2) NOT NULL,
  allocation_type VARCHAR(50) NOT NULL CHECK (allocation_type IN ('owner_share', 'brand_reinvestment')),
  status VARCHAR(50) NOT NULL DEFAULT 'allocated' CHECK (status IN ('allocated', 'settled', 'retained')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS owner_settlements (
  id SERIAL PRIMARY KEY,
  settlement_code VARCHAR(100) UNIQUE,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  amount NUMERIC(15, 2) NOT NULL,
  settlement_date DATE NOT NULL,
  payment_method VARCHAR(50) NOT NULL,
  reference_note TEXT,
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reinvestment_reserves (
  id SERIAL PRIMARY KEY,
  amount NUMERIC(15, 2) NOT NULL,
  source_sale_id INTEGER REFERENCES sales(id),
  period_month VARCHAR(7),
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS financial_ledger (
  id SERIAL PRIMARY KEY,
  entry_number VARCHAR(100) UNIQUE,
  entry_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  account_category VARCHAR(50) NOT NULL CHECK (account_category IN ('asset', 'liability', 'equity', 'revenue', 'expense', 'distribution')),
  entry_type VARCHAR(10) NOT NULL CHECK (entry_type IN ('DEBIT', 'CREDIT')),
  amount NUMERIC(15, 2) NOT NULL,
  reference_type VARCHAR(50) NOT NULL,
  reference_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  is_traceable_adjustment BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(100),
  old_values JSONB,
  new_values JSONB,
  ip_address VARCHAR(100),
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Performance and Integrity Indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_sales_sale_date ON sales(sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_prod ON inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_ledger_date ON financial_ledger(entry_date);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
