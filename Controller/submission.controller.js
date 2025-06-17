import { connectredis } from '../db/redis/redis.js';

const redis = await connectredis();

const worker_running = [
  'https://workers-judge.onrender.com/',
  'https://workers-judge-1.onrender.com/',
  'https://workers-judge-2.onrender.com/'
];

const run = async (req, res) => {
  const { ques_name, timeout, sizeout, input, output, language, code } = req.body;

  if (!code || !ques_name || !input || !output || !language) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  try {
    // ✅ Basic security check for dangerous C/C++ functions
    if (code.includes("fopen") || code.includes("system") || code.includes("fork")) {
      throw new Error("Potentially dangerous code detected.");
    }

    // ✅ Parse input/output testcases
    const inputParts = input.split('###').map(x => x.trim()).filter(Boolean);
    const outputParts = output.split('###').map(x => x.trim()).filter(Boolean);

    const testcases = inputParts.map((input, i) => ({
      input,
      expected_output: outputParts[i] || '',
      correct: null,
      timeout: timeout || "2.5",
      sizeout,
      result: null,
    }));

    // ✅ Assign testcases to workers
    const workerCount = worker_running.length;
    const workerTaskMap = {};

    if (testcases.length < 3) {
      workerTaskMap['worker_0'] = testcases;
    } else {
      testcases.forEach((tc, i) => {
        const workerId = `worker_${i % workerCount}`;
        if (!workerTaskMap[workerId]) workerTaskMap[workerId] = [];
        workerTaskMap[workerId].push(tc);
      });
    }

    // ✅ Redis payload
    const redisPayload = {
      code,
      language,
      ...Object.fromEntries(
        Object.entries(workerTaskMap).map(([key, val]) => [key, JSON.stringify(val)])
      )
    };

    await redis.hSet(ques_name, redisPayload);

    const assignedWorkers = Object.keys(workerTaskMap);

    await Promise.all(
      assignedWorkers.map(() => redis.lPush('job_queue', ques_name))
    );

    // ✅ Poll for completion
    const waitUntilCompleted = async () => {
      const POLL_INTERVAL = 500;
      const MAX_ATTEMPTS = 60;
      let attempts = 0;

      while (attempts < MAX_ATTEMPTS) {
        const status = await redis.hGetAll(`job:${ques_name}:status`);
        const completedWorkers = Object.keys(status).filter(k => status[k] === 'completed');

        if (assignedWorkers.every(worker => completedWorkers.includes(worker))) {
          return true;
        }

        await new Promise(res => setTimeout(res, POLL_INTERVAL));
        attempts++;
      }
      return false;
    };

    const completed = await waitUntilCompleted();

    if (!completed) {
      return res.status(504).json({ error: 'Timeout waiting for workers to finish' });
    }

    // ✅ Collect all results
    const results = [];
    for (const workerId of assignedWorkers) {
      const data = await redis.get(`job:${ques_name}:worker:${workerId}`);
      if (data) results.push(...JSON.parse(data));
    }

    return res.json({
      message: 'All workers completed',
      jobId: ques_name,
      results
    });

  } catch (error) {
    console.error("Error in /run:", error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export { run };
