const moment = require('moment');
const Timer = require('./classes/timer');

this.clockInterval = new Timer(() => {
    process.send({time: moment()});
}, 1000);
