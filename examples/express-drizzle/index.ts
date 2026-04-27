import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createFlowlibRouter } from '@flowlib/express';
import { flowlibConfig } from './flowlib.config';

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

// Mount Flowlib routes under /flowlib (or a path of your choice)
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
