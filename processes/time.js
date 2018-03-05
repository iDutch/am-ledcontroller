const moment = require('moment');
const Timer = require('./../classes/timer');

new Timer(() => {
    process.send({time: moment()});
}, 1000);
