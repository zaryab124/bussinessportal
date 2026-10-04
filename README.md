# Business Stock, Sales & Profit-Sharing Portal

A production-ready, secure, full-stack web application designed for managing a private multi-owner stock-trading business. Built with rigorous financial accuracy, immutable audit logging, balanced double-entry accounting, and strict horizontal data isolation across business partners.

---

## 🚀 Key Features & Architectural Modules

1. **Role-Based Access Control (RBAC):**
   - **Super Admin:** Full oversight of inventory, vendor purchases, price limits, sales, expenses, settlements, profit rules, and immutable audit logs.
   - **Business Owners:** Secure, horizontally-isolated private dashboards showing individual profit allocations, capital contributions, distributed payouts, and pending settlements.

2. **Stock Inventory & Multimedia Management:**
   - SKU, category, condition, location, supplier tracking.
   - Configured expected selling price ranges (`min_selling_price` to `max_selling_price`).
   - Automated stock status lifecycle: `Draft` ➔ `Available` ➔ `Partially Sold` ➔ `Sold Out` ➔ `Archived`.
   - Multipart image and video uploads with MIME validation, file size enforcement, and primary thumbnail designation.

3. **Inbound Purchases & Weighted Moving Average Costing:**
   - Multi-item Purchase Orders (PO) with batch supplier receipts.
   - Mathematical Weighted Moving Average unit cost calculations:
     $$\text{New Unit Cost} = \frac{(\text{Current Qty} \times \text{Current Cost}) + (\text{Batch Qty} \times \text{Batch Cost})}{\text{Current Qty} + \text{Batch Qty}}$$
   - Atomic inventory movement logs (`purchase_in`, `sale_out`, `sale_return_in`, `adjustment_add`, `adjustment_subtract`, `damage_loss`).

4. **Sales Register & Overselling Protection:**
   - Concurrency-safe atomic stock deduction with row-level locking (`FOR UPDATE`).
   - Configured price range checks (sales outside `[min, max]` require approval with documented justification).
   - Traceable sale cancellations with automated inventory restoration and ledger reversals.

5. **Balanced Double-Entry General Ledger:**
   - Real-time double-entry posting balancing Assets, Liabilities, Equity, Revenues, and Expenses.
   - Strict Trial Balance validation: Total Debits must always equal Total Credits.
   - Traceable adjustments requiring audit reasons and balanced journal entries.

6. **33% / 33% / 34% Automated Profit-Sharing Engine:**
   - Versioned, auditable profit distribution rules totaling exactly 100.00%.
   - Automated penny-balanced distribution upon sale confirmation:
     - Owner 1: 33.00%
     - Owner 2: 33.00%
     - Brand Reinvestment Reserve: 34.00%
   - Distinguishes allocated profit, actual disbursed settlements, retained reserves, and contributed capital.

7. **Operating Expenses & Partner Settlements:**
   - Categorized operating expenses with automatic ledger expense debiting.
   - Partner payout settlements with payable balance validation.
   - Contributed capital management credited to Partner Equity.

8. **Export & Reporting Engine:**
   - Compliant RFC 4180 CSV exports for Inventory, Sales, Purchases, Operating Expenses, Ledger, Settlements, and Owner Allocations.
   - Strict horizontal data isolation: owners can only export their personal financial allocations.

9. **Immutable Audit Logs:**
   - Persistent, traceable audit trail recording actor, action, entity, IP address, and payload.

---

## 🛠 Technology Stack

- **Backend:** Node.js, Express, REST APIs
- **Database:** PostgreSQL (with embedded PGlite for zero-dependency execution or external PostgreSQL via `DATABASE_URL`)
- **Security:** Bcrypt (10 rounds), JWT sessions, Helmet headers, CORS, Express rate limiting, Audit logging
- **Financial Arithmetic:** Decimal.js (`NUMERIC(15, 2)` fixed-precision arithmetic, zero floating-point drift)
- **Frontend:** Responsive HTML5 / CSS3 / Vanilla JavaScript dashboard with interactive widgets and real-time tabs

---

## 🔑 Initial Credentials (Seeded)

| Account | Email | Password | Role | Share |
|---|---|---|---|---|
| **Super Admin** | `admin@business.local` | `549229044ktb` | `super_admin` | Full Management |
| **Business Owner 1** | `owner1@business.local` | `549229044ktb` | `business_owner` | 33.00% Share |
| **Business Owner 2** | `owner2@business.local` | `549229044ktb` | `business_owner` | 33.00% Share |
| **Brand Reinvestment** | — | — | — | 34.00% Reserve |

---

## 🏃 Getting Started (Local Development)

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Database Migrations & Seed Initial Data
```bash
npm run seed
```

### 3. Run Comprehensive Test Suite
```bash
npm test
```

### 4. Start Local Development Server
```bash
npm start
```
Open [http://localhost:5000](http://localhost:5000) in your browser.

---

## 🚢 Production Deployment

### Option A: Docker / Container Deployment

A production-grade `Dockerfile` and `docker-compose.yml` are provided.

```bash
# Build and start container in detached mode
docker-compose up -d --build

# Inspect logs
docker-compose logs -f

# Check container health status
curl http://localhost:5000/api/health
```

Persistent data and uploads are mounted to Docker volumes (`app_data` and `app_uploads`).

### Option B: Vercel Serverless Deployment

A configured `vercel.json` is provided.

1. Install Vercel CLI or connect your GitHub repository:
   ```bash
   npm i -g vercel
   vercel
   ```
2. Set Environment Variables in the Vercel Dashboard:
   - `NODE_ENV=production`
   - `JWT_SECRET=<strong-random-64-char-secret>`
   - `DATABASE_URL=postgresql://<user>:<password>@<remote-host>:5432/<dbname>?sslmode=require`

### Option C: Standalone Node.js Linux VM (PM2 / Systemd)

```bash
# Install PM2 process manager
npm install -g pm2

# Start server under cluster / daemon mode
pm2 start src/server.js --name stock-portal -i max

# Save process list
pm2 save
pm2 startup
```

---

## 📋 Phase Roadmap & Completion Matrix

- [x] **Phase 1:** Project setup, architecture, database migrations, security & authentication.
- [x] **Phase 2:** Role-based access control and secure owner accounts.
- [x] **Phase 3:** Admin dashboard and stock management.
- [x] **Phase 4:** Product image and video uploads.
- [x] **Phase 5:** Purchases, inventory movements, and stock costing.
- [x] **Phase 6:** Sales management, price ranges, and sell-out handling.
- [x] **Phase 7:** Financial ledger and net profit calculation engine.
- [x] **Phase 8:** Owner profit-sharing and reinvestment rules.
- [x] **Phase 9:** Owner dashboards and financial reports.
- [x] **Phase 10:** Expenses, settlements, returns, and audit logs.
- [x] **Phase 11:** Complete integration, security testing, and end-to-end verification.
- [x] **Phase 12:** Production deployment readiness, export features, backups, and final verification.
