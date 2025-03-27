const express = require('express');
const fs = require('fs');
const app = express();
app.use(express.json());

app.post('/webhook', (req, res) => {
  const events = req.body.events;
  if (events) {
    events.forEach(event => {
      if (event.type === 'message' && event.message.type === 'text') {
        const log = `[${new Date().toISOString()}] GROUP: ${event.source.groupId} USER: ${event.source.userId} TEXT: ${event.message.text}\n`;
        fs.appendFileSync('messages.log', log);
        console.log(log.trim());
      }
    });
  }
  res.sendStatus(200);
});

app.get('/', (req, res) => res.send('LINE bot is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
