# G-VAMS ERP

G-VAMS ERP is a student-focused virtual attendance and academic management application.

## Repository structure

- `frontend/` — React frontend for the student ERP experience.
- `backend/` — Express, MongoDB, and JWT-backed API.

## Development

### Frontend

```bash
cd frontend
npm install
npm start
```

### Backend

```bash
cd backend
npm install
npm run dev
```

The frontend and backend are independent npm projects. Environment configuration belongs in the respective application directories; do not commit secrets or `.env` files.

## Scope

The ORAM engineering framework that was previously colocated in this repository now has its own canonical repository. G-VAMS ERP remains focused on the application itself.
