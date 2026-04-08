const jwt = require('jsonwebtoken');
const token = jwt.sign({ userId: 'admin-id', role: 'admin', institutionId: 'a32ae801-f7a2-4a34-b9f6-f9798838c860' }, 'supersecret');
console.log('TOKEN=' + token);
