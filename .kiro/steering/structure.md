# Repository Structure

## Layout

```
stitched-patient/
├── services/
│   └── physiology/        # FastAPI service, Dockerfile, tests
├── apps/
│   └── web/               # Next.js app
├── cases/                 # Case definition files (YAML)
│                          # + JSON Schema for validation
├── docs/                  # Architecture notes, development log
└── .kiro/                 # Steering, specs, hooks
                           # MUST be committed (never in .gitignore)
```

## Naming Conventions

### Files
- Steering files: lowercase with hyphens (e.g., `clinical-safety.md`)
- Case files: lowercase with hyphens (e.g., `adult-tension-pneumothorax.yaml`)
- Code files: follow language conventions (snake_case for Python, camelCase for TypeScript)

### Code
- Python: snake_case for functions and variables, PascalCase for classes
- TypeScript/React: camelCase for functions and variables, PascalCase for components and types
- Constants: UPPER_SNAKE_CASE

### Git
- Branch names: lowercase with hyphens, prefix with type (e.g., `feature/patient-dialog`, `fix/vitals-websocket`)
- Commit messages: imperative mood, sentence case (e.g., "Add tension pneumothorax case")
