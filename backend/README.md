# ResQOps API

The Express API uses Node's built-in SQLite driver. Run `npm run dev:api` from the repository root or `npm run dev` in this workspace. It reads configuration from the repository root `.env` file and creates `backend/data/resqops.sqlite` automatically.

Run the backend checks from the root with `npm test`. To add optional labelled sample records, run `npm run seed` from the root.
