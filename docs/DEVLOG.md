# Development Log

## 2026-11-15: Initial Setup

Created repository skeleton for Stitched Patient hackathon project (Kiroween 2026, Frankenstein category).

**Steering files created**:
- `product.md`: product summary, target users, core loop, first case (tension pneumothorax), non-goals, hackathon context
- `tech.md`: full stack description, Pulse engine API details from spike test (verified actions, data requests, performance, known pitfalls)
- `structure.md`: repository layout and naming conventions
- `clinical-safety.md`: rules for clinical content (citation requirements, disclaimers, engine limitations, "don't guess" principle)

**Repository structure**:
- `services/physiology/`: placeholder for FastAPI + Pulse engine service
- `apps/web/`: placeholder for Next.js frontend
- `cases/`: placeholder for YAML case definitions
- `docs/`: architecture notes and this log
- `.kiro/`: steering files (committed, never ignored)

**Root files**:
- `README.md` with educational disclaimer
- `LICENSE` (MIT)
- `.gitignore` for Python and Node (explicitly preserves `.kiro/`)
- `.env.example` with required environment variables

**Next steps**: implement physiology-service Docker image, FastAPI endpoints, and timeline/branching logic.

**Fixes**: removed unanchored Python packaging entries from `.gitignore` (develop-eggs/, downloads/, eggs/, .eggs/, lib/, lib64/, parts/, sdist/, var/, wheels/, env/, ENV/) that were incorrectly ignoring source folders; added complete Pulse Python imports and usage example to `tech.md`.
