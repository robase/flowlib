import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { createFlowlibRouter } from '@flowlib/express';
import { flowlibConfig } from './flowlib.config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (flowlibConfig.database.type === 'sqlite') {
  const cs = flowlibConfig.database.connectionString;
  if (cs && cs !== ':memory:' && cs !== 'file::memory:') {
    const raw = cs.startsWith('file:') ? cs.slice('file:'.length) : cs;
    const abs = path.isAbsolute(raw) ? raw : path.resolve(__dirname, raw);
    flowlibConfig.database.connectionString = `file:${abs}`;
  }
}

// Create Express app
const app = express();
const port = process.env.PORT || 3000;

app.use(
  cors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-User-ID', 'x-user-id'],
  }),
);

// Mount Flowlib routes under /flowlib (or a path of your choice).
app.use('/flowlib', await createFlowlibRouter(flowlibConfig));

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Hello from Express!',
  });
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Express server running on http://localhost:${port}`);
});
