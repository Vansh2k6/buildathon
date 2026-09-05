# Merchant Agent

An autonomous merchant commerce platform and AI-agent shopping interface built with Next.js, Supabase, Groq, and Razorpay. The system runs an automated Observe-Decide-Policy-Execute control loop that adjusts product pricing, discounts, and featured rankings based on internal sales telemetry and external market signals, while enforcing deterministic merchant safety policies and providing a machine-readable commerce surface for external AI buyer agents.

## Key Features

- **Autonomous Merchant Control Loop**:
  - **Observe**: Ingests internal product velocity, inventory aging, and external trend/market signals.
  - **Decide**: Uses Groq LLM inference with structured JSON schemas to propose pricing, discounting, and merchandising actions.
  - **Policy Engine**: Evaluates proposals against deterministic merchant constraints (margin floors, maximum discount depth, cooldown periods, and maximum featured items) with strict approve/modify/reject verdicts.
  - **Execute**: Applies approved discounts, updates featured ranks in database, and issues live Razorpay test-mode payment links.
  - **Audit & Narrative**: Persists full step-by-step audit events and human-readable narratives for every decision cycle.

- **Machine-to-Machine AI Buyer Surface**:
  - Exposes public catalog discovery and automated order creation (`/api/agent-buyer/order`) with buyer policy checks (quantity bounds, price tolerances, stock verification).
  - Integrates with Razorpay test mode for payment link creation.

- **Storefront & Operational Web Surfaces**:
  - **Storefront & Catalog** (`/`, `/browse`, `/collections/[category]`): Customer-facing catalog displaying real-time dynamic pricing and featured curation.
  - **Control Dashboard** (`/control`): Simulation management to advance days, trigger manual cycles, view state, and reset demo data.
  - **Policy Dashboard** (`/policy`): Live inspection of active merchant rules, constraints, and safety thresholds.
  - **Audit Log** (`/audit`): Chronological log of agent runs, state transitions, LLM reasoning, policy verdicts, and cycle narratives.

## Technology Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **UI & Styling**: React 19, Vanilla CSS Design System
- **Database**: Supabase (PostgreSQL with Row Level Security)
- **LLM Inference**: Groq API
- **Payments**: Razorpay (Test Mode)
- **Language & Runtime**: TypeScript 5, Node.js, `tsx`

## Project Structure

```
.
├── app/
│   ├── api/
│   │   ├── agent-buyer/order/   # AI buyer purchase endpoint
│   │   ├── catalog/             # Public catalog endpoint
│   │   └── sim/                 # Simulation endpoints (cycle, advance-day, reset, state)
│   ├── audit/                   # Audit log and run narrative UI
│   ├── browse/                  # Catalog search and filter UI
│   ├── collections/[category]/  # Category-specific catalog UI
│   ├── components/              # Shared UI components (Navbar, BookCard, etc.)
│   ├── control/                 # Simulation control panel
│   ├── policy/                  # Policy configuration and rules viewer
│   ├── globals.css              # Design system tokens and styling
│   └── page.tsx                 # Home storefront page
├── db/
│   ├── 001_schema.sql           # Database schema definition
│   ├── 002_policies.sql         # Supabase RLS security policies
│   └── 003_seed.sql             # Initial product catalog, rules, and demo_reset function
├── lib/
│   ├── agent/cycle.ts           # State machine orchestrating Observe-Decide-Policy-Execute
│   ├── audit/                   # Event logging and narrative generation
│   ├── decide/                  # Groq prompt formatting, proposal schemas, and parsing
│   ├── execute/                 # Discount, ranking, order, and Razorpay execution
│   ├── observe/                 # Internal telemetry and external signal detectors
│   └── policy/                  # Deterministic safety rule evaluation engine
└── scripts/
    ├── _env.ts                  # Environment variable loader for standalone scripts
    ├── _observe-base.ts         # Shared utilities for simulation testing
    ├── observe-buyer.ts         # End-to-end AI buyer agent order simulation
    └── push-demo-reset.ts       # Script to push demo_reset SQL RPC to Supabase
```

## Prerequisites

- Node.js 20 or higher
- npm
- Supabase account and project
- Groq API key
- Razorpay account (Test Mode keys)
- NewsAPI key (optional, for external news signals)

## Environment Configuration

Create a `.env.local` file in the root directory based on `.env.local.example`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

GROQ_API_KEY=your-groq-api-key
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_MODEL=openai/gpt-oss-120b

NEWSAPI_KEY=your-newsapi-key

RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your-razorpay-key-secret

AGENT_BUYER_KEY=demo-agent-key
```

## Database Setup

1. Run the SQL scripts in your Supabase SQL Editor in the following order:
   - `db/001_schema.sql`
   - `db/002_policies.sql`
   - `db/003_seed.sql`
2. Alternatively, use `scripts/push-demo-reset.ts` to sync the reset RPC function:
   ```bash
   npx tsx scripts/push-demo-reset.ts
   ```

## Installation & Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/Vansh2k6/buildathon.git
   cd buildathon
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run type checking:
   ```bash
   npm run typecheck
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Open `http://localhost:3000` in your browser.

## Available Scripts

- `npm run dev`: Start Next.js development server.
- `npm run build`: Build production application bundle.
- `npm run start`: Start production server.
- `npm run typecheck`: Run TypeScript compiler validation without emitting files.
- `npm run buyer:normal`: Run normal AI buyer agent (places on-policy order & generates Razorpay payment link).
- `npm run buyer:max-qty`: Run over-quantity AI buyer agent (tests threshold violation & policy engine rejection).

## API Endpoints

### Machine & Commerce Endpoints
- `GET /api/catalog`: Returns the complete catalog with prices, stock, dynamic discounts, and metadata.
- `POST /api/agent-buyer/order`: Processes an order from an external agent. Requires payload containing SKU, quantity, expected price, and agent identification header.

### Simulation Endpoints
- `POST /api/sim/cycle`: Executes one full Observe-Decide-Policy-Execute agent cycle.
- `POST /api/sim/advance-day`: Increments the simulation day and runs daily telemetry checks.
- `POST /api/sim/reset`: Resets catalog, inventory, discounts, and orders back to Day 0 baseline.
- `GET /api/sim/state`: Fetches current simulation day, metrics, and active discounts.
