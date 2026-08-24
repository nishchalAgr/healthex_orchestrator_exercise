import express, { type Express, type Request, type Response } from 'express';
import { Queue, Worker, createNodeRedisClient } from 'bullmq';
import { createClient } from 'redis';
import { stringify } from 'node:querystring';
const { setTimeout: setTimeoutPromise } = require('node:timers/promises');

const app: Express = express();

const rawClient = createClient({
  url: 'redis://localhost:6379',
});

const connection = createNodeRedisClient(rawClient);
const queueName = "myQueue";
const myQueue = new Queue(queueName);
const worker1 = new Worker(queueName, async job => {
  setTimeoutPromise(1000, 'foobar')
    .then(console.log(job.data))
    .catch((err: Error) => {
      if (err.name === 'AbortError')
        console.error('The timeout was aborted');
    });
})
const worker2 = new Worker(queueName, async job => {
  setTimeoutPromise(1000, 'foobar')
    .then(console.log(job.data))
    .catch((err: Error) => {
      if (err.name === 'AbortError')
        console.error('The timeout was aborted');
    });
})

app.get('/', (req: Request, res: Response) => {
  res.send('Hello World!');
});

app.get('/patients/:id/display', async (req: Request, res: Response) => {
  const patientId = req.params.id;
  for(let i = 0; i < 10; i++) {
    await myQueue.add(patientId + '_' + i.toString(), {patientId: })
  }
  res.send(req.params.id);
});

app.get('/patients/:id/updateData', async (req: Request, res: Response) => {
  const patientId = req.params.id;
  res.status(202).setHeader('Location', `/patients/${patientId}/display`);
});

app.listen(3000);