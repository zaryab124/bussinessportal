# Business Stock, Sales & Profit-Sharing Portal

A production-ready, secure, full-stack web application designed for managing a private multi-owner stock-trading business.

---

## Technology Stack

- **Backend:** Node.js, Express, REST APIs
- **Database:** PostgreSQL (with embedded PGlite support for zero-dependency execution, or external PostgreSQL via `DATABASE_URL`)
- **Security:** Bcrypt (10 rounds), JWT sessions, Helmet headers, CORS, Express rate limiting, Audit logging
- **Financial Arithmetic:** Decimal.js (`NUMERIC(15, 2)` decimal-safe arithmetic, zero floating-point drift)
- **Frontend:** Responsive HTML5 / CSS3 / Vanilla JavaScript dashboard

---

## Initial Credentials (Seeded)

| Account | Email | Password | Role | Share |
|---|---|---|---|---|
| **Super Admin** | `admin@business.local` | `Admin@123456` | `super_admin` | Full Management |
| **Business Owner 1** | `owner1@business.local` | `Owner1@123456` | `business_owner` | 33.00% Share |
| **Business Owner 2** | `owner2@business.local` | `Owner2@123456` | `business_owner` | 33.00% Share |
| **Reinvestment Reserve** | — | — | — | 34.00% Reserve |

---

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Database Migrations & Seed
```bash
npm run seed
```

### 3. Run Automated Tests
```bash
npm test
```

### 4. Start Server
```bash
npm start
```
Server runs at `http://localhost:5000`.

---

## Phase Status

- [x] **Phase 1:** Project setup, architecture, database migrations, security & authentication.
- [ ] **Phase 2:** Role-based access control and secure owner accounts.
- [ ] **Phase 3:** Admin dashboard and stock management.
- [ ] **Phase 4:** Product image and video uploads.
- [ ] **Phase 5:** Purchases, inventory movements, and stock costing.
- [ ] **Phase 6:** Sales management, price ranges, and sell-out handling.
- [ ] **Phase 7:** Financial ledger and net profit calculation engine.
- [ ] **Phase 8:** Owner profit-sharing and reinvestment rules.
- [ ] **Phase 9:** Owner dashboards and financial reports.
- [ ] **Phase 10:** Expenses, settlements, returns, and audit logs.
- [ ] **Phase 11:** Complete integration, security testing, and end-to-end verification.
- [ ] **Phase 12:** Production deployment, backups, monitoring, and final acceptance testing.
