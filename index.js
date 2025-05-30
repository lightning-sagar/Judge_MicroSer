import express from 'express';
import submission from './routes/submission.route.js'

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


app.get('/', (req, res) => {
  res.send('Hello World');
});


app.use('/api/c',submission);

app.listen(3000, () => {
  console.log('Main backend server running on port 3000');
});
